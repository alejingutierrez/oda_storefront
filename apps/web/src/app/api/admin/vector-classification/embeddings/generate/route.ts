import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRedis, isRedisEnabled } from "@/lib/redis";
import {
  computeEmbeddings,
  writeEmbeddingsBatch,
} from "@/lib/vector-classification/embeddings";
import type { EmbeddingProduct } from "@/lib/vector-classification/embeddings";

export const runtime = "nodejs";
export const maxDuration = 300;

const JOB_KEY = "vector-emb-job";
const JOB_TTL = 3600; // 1 hour
const HEARTBEAT_TTL = 90; // seconds

// Keep time budget conservative to avoid connection pool exhaustion.
const TIME_BUDGET_MS = 180_000; // 3 min of 5 min maxDuration
const BATCH_SIZE_WITH_IMAGES = 20;
const BATCH_SIZE_TEXT_ONLY = 30;
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

async function updateHeartbeat() {
  if (!isRedisEnabled()) return;
  try {
    await getRedis().set(
      `${JOB_KEY}:heartbeat`,
      Date.now().toString(),
      "EX",
      HEARTBEAT_TTL,
    );
  } catch {
    // best effort
  }
}

async function isHeartbeatAlive(): Promise<boolean> {
  if (!isRedisEnabled()) return false;
  try {
    const hb = await getRedis().get(`${JOB_KEY}:heartbeat`);
    if (!hb) return false;
    return Date.now() - Number(hb) < HEARTBEAT_TTL * 1000;
  } catch {
    return false;
  }
}

async function updateProgress(generated: number, remaining: number, startedAt: number) {
  if (!isRedisEnabled()) return;
  try {
    const r = getRedis();
    const elapsedMin = (Date.now() - startedAt) / 60_000;
    const speed = elapsedMin > 0.1 ? Math.round(generated / elapsedMin) : 0;
    await r
      .pipeline()
      .set(`${JOB_KEY}:generated`, String(generated), "EX", JOB_TTL)
      .set(`${JOB_KEY}:remaining`, String(remaining), "EX", JOB_TTL)
      .set(`${JOB_KEY}:lastBatchAt`, new Date().toISOString(), "EX", JOB_TTL)
      .set(`${JOB_KEY}:speed`, String(speed), "EX", JOB_TTL)
      .exec();
  } catch {
    // best effort
  }
}

async function logJobEvent(message: string) {
  if (!isRedisEnabled()) return;
  try {
    const entry = JSON.stringify({ t: Date.now(), m: message });
    const r = getRedis();
    await r
      .pipeline()
      .lpush(`${JOB_KEY}:log`, entry)
      .ltrim(`${JOB_KEY}:log`, 0, 49)
      .expire(`${JOB_KEY}:log`, JOB_TTL)
      .exec();
  } catch {
    // best effort
  }
}

async function incrementChainCount(): Promise<number> {
  if (!isRedisEnabled()) return 0;
  try {
    const r = getRedis();
    const count = await r.incr(`${JOB_KEY}:chainCount`);
    await r.expire(`${JOB_KEY}:chainCount`, JOB_TTL);
    return count;
  } catch {
    return 0;
  }
}

async function getSkipImages(): Promise<boolean> {
  if (!isRedisEnabled()) return false;
  try {
    const val = await getRedis().get(`${JOB_KEY}:config:skipImages`);
    return val === "true";
  } catch {
    return false;
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
    // Check if job was stopped or paused
    const currentStatus = await getJobStatus();
    if (currentStatus === "stopping") {
      await setJobState("idle");
      await logJobEvent("Job detenido por el usuario");
      return NextResponse.json({
        ok: true,
        generated: 0,
        remaining: 0,
        jobStatus: "idle",
      });
    }
    if (currentStatus === "paused") {
      return NextResponse.json({
        ok: true,
        generated: 0,
        remaining: 0,
        jobStatus: "paused",
      });
    }

    // Auto-recover stale jobs: if "running" but heartbeat expired
    if (currentStatus === "running" && !isInternalCall) {
      const alive = await isHeartbeatAlive();
      if (!alive) {
        console.warn("[embeddings/generate] Stale job detected, auto-recovering");
        await logJobEvent("Job estancado detectado, auto-recuperando");
        // Reset and proceed
      }
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

    const skipImages = await getSkipImages();
    const batchSize = skipImages ? BATCH_SIZE_TEXT_ONLY : BATCH_SIZE_WITH_IMAGES;

    // Store startedAt only on first invocation (not self-chains)
    if (!isInternalCall && isRedisEnabled()) {
      await getRedis()
        .pipeline()
        .set(`${JOB_KEY}:startedAt`, new Date().toISOString(), "EX", JOB_TTL)
        .set(`${JOB_KEY}:chainCount`, "0", "EX", JOB_TTL)
        .set(`${JOB_KEY}:totalProcessed`, "0", "EX", JOB_TTL)
        .del(`${JOB_KEY}:error`)
        .exec()
        .catch(() => {});
    }

    await setJobState("running");
    await updateHeartbeat();
    if (!isInternalCall) {
      await logJobEvent(`Job iniciado (${skipImages ? "solo texto" : "texto + imagen"})`);
    } else {
      const chainNum = await incrementChainCount();
      await logJobEvent(`Self-chain #${chainNum} iniciado`);
    }

    const invocationStart = Date.now();
    let totalGenerated = 0;
    let consecutiveErrors = 0;

    // ── Inner loop: process multiple batches within this invocation ──
    while (Date.now() - invocationStart < TIME_BUDGET_MS) {
      // Check if stopped/paused between batches
      const status = await getJobStatus();
      if (status === "stopping") {
        await setJobState("idle");
        await logJobEvent("Job detenido por el usuario");
        break;
      }
      if (status === "paused") {
        await logJobEvent("Job pausado por el usuario");
        break;
      }

      // ── Step 1: DB read — find products without embeddings (fast) ──
      let rows: Array<{ id: string }>;
      try {
        rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT p.id
          FROM products p
          LEFT JOIN product_embeddings pe ON pe."productId" = p.id
          WHERE pe.id IS NULL
            AND (p.status = 'active' OR p.status IS NULL)
            AND p."imageCoverUrl" IS NOT NULL
          LIMIT ${batchSize}
        `);
      } catch (err) {
        if (isConnectionError(err)) {
          console.warn(
            "[embeddings/generate] DB connection error on query, will self-chain:",
            (err as Error).message,
          );
          await logJobEvent("Error de conexion en query, self-chain para reconectar");
          break;
        }
        throw err;
      }

      if (rows.length === 0) {
        // All done
        await setJobState("idle");
        await logJobEvent(
          `Job completado: ${totalGenerated} embeddings en esta invocacion`,
        );
        return NextResponse.json({
          ok: true,
          generated: totalGenerated,
          remaining: 0,
          jobStatus: "idle",
        });
      }

      const productIds = rows.map((r) => r.id);

      // ── Step 2: DB read — fetch product data (fast) ──
      let products: EmbeddingProduct[];
      try {
        products = await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            name: true,
            description: true,
            imageCoverUrl: true,
            styleTags: true,
            materialTags: true,
            patternTags: true,
            occasionTags: true,
            season: true,
            minPriceCop: true,
            brand: { select: { name: true } },
          },
        });
      } catch (err) {
        if (isConnectionError(err)) {
          console.warn(
            "[embeddings/generate] DB connection error on product fetch, will self-chain:",
            (err as Error).message,
          );
          await logJobEvent("Error de conexion fetcheando productos, self-chain");
          break;
        }
        throw err;
      }

      if (products.length === 0) continue;

      // ── Step 3: Bedrock compute (slow, DB idle — that's fine now) ──
      let batchResults;
      let success = false;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          batchResults = await computeEmbeddings(products, skipImages);
          success = true;
          consecutiveErrors = 0;
          break;
        } catch (err) {
          // Bedrock errors are not connection errors, but retry anyway
          if (attempt < MAX_RETRIES) {
            console.warn(
              `[embeddings/generate] Compute error attempt ${attempt + 1}, retrying in ${(attempt + 1) * 2}s...`,
            );
            await logJobEvent(
              `Error en Bedrock (intento ${attempt + 1}), reintentando...`,
            );
            await sleep((attempt + 1) * 2000);
            continue;
          }
          throw err;
        }
      }

      if (!success || !batchResults) {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          await setJobState("error", {
            error: "Demasiados errores consecutivos en Bedrock",
          });
          await logJobEvent("Job detenido: demasiados errores consecutivos");
          return NextResponse.json({
            ok: false,
            generated: totalGenerated,
            remaining: -1,
            jobStatus: "error",
            error: "Too many consecutive errors",
          });
        }
        break;
      }

      // ── Step 4: DB write (fast, single multi-row INSERT) ──
      let batchWritten = 0;
      try {
        batchWritten = await writeEmbeddingsBatch(batchResults);
      } catch (err) {
        if (isConnectionError(err)) {
          console.warn(
            "[embeddings/generate] DB connection error on write, will self-chain:",
            (err as Error).message,
          );
          await logJobEvent("Error de conexion escribiendo embeddings, self-chain");
          // Embeddings computed but not written — they'll be re-computed next time
          break;
        }
        throw err;
      }

      totalGenerated += batchWritten;

      // Update progress + heartbeat
      await updateHeartbeat();
      await updateProgress(totalGenerated, -1, invocationStart);

      // Update totalProcessed across all chains
      if (isRedisEnabled()) {
        await getRedis()
          .incrby(`${JOB_KEY}:totalProcessed`, batchWritten)
          .catch(() => {});
      }

      await logJobEvent(`Batch completado: ${batchWritten} productos`);
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

    await updateProgress(totalGenerated, remaining, invocationStart);

    // Self-chain: if more work and not stopped/paused, trigger next invocation
    const finalStatus = await getJobStatus();
    if (remaining > 0 && token && finalStatus === "running") {
      const baseUrl = getBaseUrl();
      await logJobEvent(`Self-chain disparado, ${remaining} restantes`);
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
    } else if (remaining === 0) {
      await setJobState("idle");
      await logJobEvent(
        `Job completado: ${totalGenerated} embeddings en esta invocacion`,
      );
    } else if (finalStatus !== "running") {
      // paused or stopping
      if (finalStatus === "stopping") {
        await setJobState("idle");
      }
    }

    return NextResponse.json({
      ok: true,
      generated: totalGenerated,
      remaining,
      jobStatus: remaining > 0 && finalStatus === "running" ? "running" : finalStatus === "paused" ? "paused" : "idle",
    });
  } catch (error) {
    console.error(
      "[vector-classification/embeddings/generate] POST error:",
      error,
    );
    await setJobState("error", {
      error: error instanceof Error ? error.message : "internal_error",
    });
    await logJobEvent(
      `Error fatal: ${error instanceof Error ? error.message : "internal_error"}`,
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
