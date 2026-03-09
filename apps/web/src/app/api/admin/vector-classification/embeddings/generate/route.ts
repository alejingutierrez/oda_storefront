import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRedis, isRedisEnabled } from "@/lib/redis";
import { generateEmbeddingsForBatch } from "@/lib/vector-classification/embeddings";

export const runtime = "nodejs";
export const maxDuration = 300;

const JOB_KEY = "vector-emb-job";
const JOB_TTL = 3600; // 1 hour

// Keep time budget conservative to avoid connection pool exhaustion.
// Neon idle timeout is 30s so batches must complete within that window.
const TIME_BUDGET_MS = 180_000; // 3 min of 5 min maxDuration
const BATCH_SIZE = 20; // products per DB query batch
const MAX_RETRIES = 2;

// ── Redis helpers ────────────────────────────────────────────────────

async function getJobStatus(): Promise<string> {
  if (!isRedisEnabled()) return "idle";
  try {
    return (await getRedis().get(`${JOB_KEY}:status`)) ?? "idle";
  } catch {
    return "idle";
  }
}

async function setJobState(status: string, extra?: Record<string, string>) {
  if (!isRedisEnabled()) return;
  try {
    const r = getRedis();
    const pipe = r.pipeline();
    pipe.set(`${JOB_KEY}:status`, status, "EX", JOB_TTL);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        pipe.set(`${JOB_KEY}:${k}`, v, "EX", JOB_TTL);
      }
    }
    await pipe.exec();
  } catch {
    // Redis failures should not block embedding generation
  }
}

async function updateProgress(generated: number, remaining: number) {
  if (!isRedisEnabled()) return;
  try {
    const r = getRedis();
    await r
      .pipeline()
      .set(`${JOB_KEY}:generated`, String(generated), "EX", JOB_TTL)
      .set(`${JOB_KEY}:remaining`, String(remaining), "EX", JOB_TTL)
      .set(`${JOB_KEY}:lastBatchAt`, new Date().toISOString(), "EX", JOB_TTL)
      .exec();
  } catch {
    // best effort
  }
}

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function isConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("Connection terminated") ||
    msg.includes("connection timeout") ||
    msg.includes("timeout exceeded") ||
    msg.includes("Cannot reach database") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("socket hang up")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main handler ─────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Accept admin auth OR internal job token for self-chaining
  const jobToken = req.headers.get("x-job-token");
  let isInternalCall = false;

  if (jobToken && isRedisEnabled()) {
    const storedToken = await getRedis()
      .get(`${JOB_KEY}:token`)
      .catch(() => null);
    if (storedToken && jobToken === storedToken) {
      isInternalCall = true;
    }
  }

  if (!isInternalCall) {
    const admin = await validateAdminRequest(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    // Check if job was stopped
    const currentStatus = await getJobStatus();
    if (currentStatus === "stopping") {
      await setJobState("idle");
      return NextResponse.json({
        ok: true,
        generated: 0,
        remaining: 0,
        jobStatus: "idle",
      });
    }

    // Set job as running with a token for self-chaining
    let token: string | null = null;
    if (isRedisEnabled()) {
      token = await getRedis()
        .get(`${JOB_KEY}:token`)
        .catch(() => null);
      if (!token) {
        token = crypto.randomUUID();
        await getRedis()
          .set(`${JOB_KEY}:token`, token, "EX", JOB_TTL)
          .catch(() => {});
      }
    }
    await setJobState("running");

    const startTime = Date.now();
    let totalGenerated = 0;
    let consecutiveErrors = 0;

    // ── Inner loop: process multiple batches within this invocation ──
    while (Date.now() - startTime < TIME_BUDGET_MS) {
      // Check if stopped between batches
      const status = await getJobStatus();
      if (status === "stopping") {
        await setJobState("idle");
        break;
      }

      // Find products without embeddings
      let rows: Array<{ id: string }>;
      try {
        rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT p.id
          FROM products p
          LEFT JOIN product_embeddings pe ON pe."productId" = p.id
          WHERE pe.id IS NULL
            AND (p.status = 'active' OR p.status IS NULL)
            AND p."imageCoverUrl" IS NOT NULL
          LIMIT ${BATCH_SIZE}
        `);
      } catch (err) {
        if (isConnectionError(err)) {
          console.warn(
            "[embeddings/generate] DB connection error on query, will self-chain:",
            (err as Error).message,
          );
          // Break and self-chain for a fresh connection
          break;
        }
        throw err;
      }

      if (rows.length === 0) {
        // All done
        await setJobState("idle");
        return NextResponse.json({
          ok: true,
          generated: totalGenerated,
          remaining: 0,
          jobStatus: "idle",
        });
      }

      const productIds = rows.map((r) => r.id);

      // Process batch with retry
      let batchGenerated = 0;
      let success = false;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          batchGenerated = await generateEmbeddingsForBatch(productIds);
          success = true;
          consecutiveErrors = 0;
          break;
        } catch (err) {
          if (isConnectionError(err) && attempt < MAX_RETRIES) {
            console.warn(
              `[embeddings/generate] Connection error attempt ${attempt + 1}, retrying in ${(attempt + 1) * 2}s...`,
            );
            await sleep((attempt + 1) * 2000);
            continue;
          }
          if (isConnectionError(err)) {
            console.warn(
              "[embeddings/generate] Connection error after retries, will self-chain",
            );
            consecutiveErrors++;
            break; // Exit retry loop, will break outer loop below
          }
          throw err; // Non-connection error, propagate
        }
      }

      if (!success) {
        // If too many consecutive errors, stop job to avoid infinite loop
        if (consecutiveErrors >= 3) {
          await setJobState("error", {
            error: "Too many consecutive connection errors",
          });
          return NextResponse.json({
            ok: false,
            generated: totalGenerated,
            remaining: -1,
            jobStatus: "error",
            error: "Too many consecutive connection errors",
          });
        }
        // Break to self-chain (fresh invocation = fresh DB connection)
        break;
      }

      totalGenerated += batchGenerated;
      await updateProgress(totalGenerated, -1); // remaining unknown mid-loop
    }

    // Count remaining
    let remaining = -1;
    try {
      const remainingRows = await prisma.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(*) as count
          FROM products p
          LEFT JOIN product_embeddings pe ON pe."productId" = p.id
          WHERE pe.id IS NULL
            AND (p.status = 'active' OR p.status IS NULL)
            AND p."imageCoverUrl" IS NOT NULL
        `,
      );
      remaining = Number(remainingRows[0]?.count ?? 0);
    } catch {
      // If count query fails, assume there is more work
      remaining = 1;
    }

    await updateProgress(totalGenerated, remaining);

    // Self-chain: if more work and not stopped, trigger next invocation
    if (remaining > 0 && token) {
      const checkStatus = await getJobStatus();
      if (checkStatus === "running") {
        const baseUrl = getBaseUrl();
        fetch(
          `${baseUrl}/api/admin/vector-classification/embeddings/generate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-job-token": token,
            },
            body: JSON.stringify({}),
          },
        ).catch(() => {
          // Fire-and-forget; if it fails the job just stops and can be resumed
        });
      } else {
        await setJobState("idle");
      }
    } else if (remaining === 0) {
      await setJobState("idle");
    }

    return NextResponse.json({
      ok: true,
      generated: totalGenerated,
      remaining,
      jobStatus: remaining > 0 ? "running" : "idle",
    });
  } catch (error) {
    console.error(
      "[vector-classification/embeddings/generate] POST error:",
      error,
    );
    await setJobState("error", {
      error: error instanceof Error ? error.message : "internal_error",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
