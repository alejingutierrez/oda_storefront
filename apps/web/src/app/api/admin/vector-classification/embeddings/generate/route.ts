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

// Process multiple batches within one invocation to reduce self-chain overhead.
// Leave 60s buffer for self-chain + cold start of next invocation.
const TIME_BUDGET_MS = 240_000; // 4 minutes of the 5 min maxDuration
const BATCH_SIZE = 25; // products per DB query batch

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
    await r.set(`${JOB_KEY}:status`, status, "EX", JOB_TTL);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        await r.set(`${JOB_KEY}:${k}`, v, "EX", JOB_TTL);
      }
    }
  } catch {
    // Redis failures should not block embedding generation
  }
}

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

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

    // ── Inner loop: process multiple batches within this invocation ──
    while (Date.now() - startTime < TIME_BUDGET_MS) {
      // Check if stopped between batches
      const status = await getJobStatus();
      if (status === "stopping") {
        await setJobState("idle");
        break;
      }

      // Find products without embeddings
      const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT p.id
        FROM products p
        LEFT JOIN product_embeddings pe ON pe."productId" = p.id
        WHERE pe.id IS NULL
          AND (p.status = 'active' OR p.status IS NULL)
          AND p."imageCoverUrl" IS NOT NULL
        LIMIT ${BATCH_SIZE}
      `);

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
      const generated = await generateEmbeddingsForBatch(productIds);
      totalGenerated += generated;
    }

    // Count remaining
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
    const remaining = Number(remainingRows[0]?.count ?? 0);

    // Self-chain: if more work and not stopped, trigger next invocation
    if (remaining > 0 && token) {
      const checkStatus = await getJobStatus();
      if (checkStatus === "running") {
        const baseUrl = getBaseUrl();
        fetch(`${baseUrl}/api/admin/vector-classification/embeddings/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-job-token": token,
          },
          body: JSON.stringify({}),
        }).catch(() => {
          // Fire-and-forget; if it fails the job just stops and can be resumed
        });
      } else {
        await setJobState("idle");
      }
    } else {
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
