import { NextResponse, after } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRedis, isRedisEnabled } from "@/lib/redis";
import {
  computeEmbeddings,
  writeEmbeddingsBatch,
} from "@/lib/vector-classification/embeddings";
import type {
  EmbeddingProduct,
  EmbeddingResult,
} from "@/lib/vector-classification/embeddings";

export const runtime = "nodejs";
export const maxDuration = 300;

const JOB_KEY = "vector-emb-job";
const JOB_TTL = 3600; // 1 hour
const HEARTBEAT_TTL = 90; // seconds

// Use most of the maxDuration budget — self-chain continues where we leave off.
const TIME_BUDGET_MS = 240_000; // 4 min of 5 min maxDuration
const BATCH_SIZE_WITH_IMAGES = 40;
const BATCH_SIZE_TEXT_ONLY = 60;
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

async function updateProgress(generated: number, remaining: number) {
  if (!isRedisEnabled()) return;
  try {
    const r = getRedis();
    // Speed based on overall job elapsed time (not just this invocation)
    const jobStartedAt = await r.get(`${JOB_KEY}:startedAt`);
    const totalProcessed =
      Number((await r.get(`${JOB_KEY}:totalProcessed`)) ?? 0) + generated;
    let speed = 0;
    if (jobStartedAt) {
      const elapsedMin =
        (Date.now() - new Date(jobStartedAt).getTime()) / 60_000;
      speed = elapsedMin > 0.1 ? Math.round(totalProcessed / elapsedMin) : 0;
    }
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

// ── Fetch next batch of product IDs and data ─────────────────────────

async function fetchNextBatch(
  batchSize: number,
): Promise<EmbeddingProduct[] | "connection_error" | null> {
  // Step 1: Find product IDs without embeddings
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
        "[embeddings/generate] DB connection error on query:",
        (err as Error).message,
      );
      return "connection_error";
    }
    throw err;
  }

  if (rows.length === 0) return null;

  // Step 2: Fetch product data
  try {
    const products = await prisma.product.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
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
    return products.length > 0 ? products : null;
  } catch (err) {
    if (isConnectionError(err)) {
      console.warn(
        "[embeddings/generate] DB connection error on product fetch:",
        (err as Error).message,
      );
      return "connection_error";
    }
    throw err;
  }
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
        console.warn(
          "[embeddings/generate] Stale job detected, auto-recovering",
        );
        await logJobEvent("Job estancado detectado, auto-recuperando");
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
      await logJobEvent(
        `Job iniciado (${skipImages ? "solo texto" : "texto + imagen"}, batch=${batchSize})`,
      );
    } else {
      const chainNum = await incrementChainCount();
      await logJobEvent(`Self-chain #${chainNum} iniciado`);
    }

    const invocationStart = Date.now();
    let totalGenerated = 0;
    let consecutiveErrors = 0;

    // ── Pipelined loop: overlap compute and write ──────────────────
    //
    // While writing batch N to DB, we concurrently start computing
    // batch N+1 via Bedrock. This hides DB write latency completely.
    //
    // Flow:
    //   1. Fetch + compute batch 1
    //   2. [Write batch 1] + [Fetch + compute batch 2]  (parallel)
    //   3. [Write batch 2] + [Fetch + compute batch 3]  (parallel)
    //   ...
    //
    // We keep a "pending write" promise that we await before the next
    // write, so writes are sequential (avoid DB overload) but overlap
    // with the next compute phase.

    let pendingWrite: Promise<number | "connection_error"> | null = null;

    // Pre-fetch the first batch of products
    let nextProducts = await fetchNextBatch(batchSize);

    while (Date.now() - invocationStart < TIME_BUDGET_MS) {
      await updateHeartbeat();

      // Check if stopped/paused between batches
      const status = await getJobStatus();
      if (status === "stopping") {
        // Wait for any pending write before stopping
        if (pendingWrite) {
          const writeResult = await pendingWrite;
          if (typeof writeResult === "number") {
            totalGenerated += writeResult;
            if (isRedisEnabled()) {
              await getRedis()
                .incrby(`${JOB_KEY}:totalProcessed`, writeResult)
                .catch(() => {});
            }
          }
          pendingWrite = null;
        }
        await setJobState("idle");
        await logJobEvent("Job detenido por el usuario");
        break;
      }
      if (status === "paused") {
        if (pendingWrite) {
          const writeResult = await pendingWrite;
          if (typeof writeResult === "number") {
            totalGenerated += writeResult;
            if (isRedisEnabled()) {
              await getRedis()
                .incrby(`${JOB_KEY}:totalProcessed`, writeResult)
                .catch(() => {});
            }
          }
          pendingWrite = null;
        }
        await logJobEvent("Job pausado por el usuario");
        break;
      }

      // If no products to process, we're done
      if (nextProducts === null) {
        // Wait for any pending write
        if (pendingWrite) {
          const writeResult = await pendingWrite;
          if (typeof writeResult === "number") {
            totalGenerated += writeResult;
            if (isRedisEnabled()) {
              await getRedis()
                .incrby(`${JOB_KEY}:totalProcessed`, writeResult)
                .catch(() => {});
            }
          }
          pendingWrite = null;
        }
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

      if (nextProducts === "connection_error") {
        // Wait for pending write, then break to self-chain
        if (pendingWrite) {
          const writeResult = await pendingWrite;
          if (typeof writeResult === "number") {
            totalGenerated += writeResult;
            if (isRedisEnabled()) {
              await getRedis()
                .incrby(`${JOB_KEY}:totalProcessed`, writeResult)
                .catch(() => {});
            }
          }
          pendingWrite = null;
        }
        await logJobEvent(
          "Error de conexion fetcheando productos, self-chain para reconectar",
        );
        break;
      }

      const products = nextProducts;
      const batchStart = Date.now();

      // ── Compute embeddings via Bedrock (the slow step) ──
      let batchResults: EmbeddingResult[] | null = null;
      let success = false;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          batchResults = await computeEmbeddings(products, skipImages);
          success = true;
          consecutiveErrors = 0;
          break;
        } catch (err) {
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

      const computeMs = Date.now() - batchStart;

      // ── Await any pending write from the previous iteration ──
      if (pendingWrite) {
        const writeResult = await pendingWrite;
        if (writeResult === "connection_error") {
          await logJobEvent(
            "Error de conexion escribiendo embeddings, self-chain",
          );
          // Current batchResults are lost, will be re-computed
          break;
        }
        totalGenerated += writeResult;
        if (isRedisEnabled()) {
          await getRedis()
            .incrby(`${JOB_KEY}:totalProcessed`, writeResult)
            .catch(() => {});
        }
        pendingWrite = null;
      }

      // ── Pipeline: Start writing this batch AND pre-fetching the next ──
      const writeStart = Date.now();
      const currentResults = batchResults;

      // Launch write + next fetch concurrently
      const [writePromise, nextBatch] = await Promise.all([
        // Write is wrapped to catch connection errors gracefully
        (async (): Promise<number | "connection_error"> => {
          try {
            return await writeEmbeddingsBatch(currentResults);
          } catch (err) {
            if (isConnectionError(err)) {
              console.warn(
                "[embeddings/generate] DB connection error on write:",
                (err as Error).message,
              );
              return "connection_error";
            }
            throw err;
          }
        })(),
        // Pre-fetch next batch concurrently with the write
        fetchNextBatch(batchSize),
      ]);

      // The write completed inline (since we awaited Promise.all)
      if (writePromise === "connection_error") {
        await logJobEvent(
          "Error de conexion escribiendo embeddings, self-chain",
        );
        break;
      }

      const writeMs = Date.now() - writeStart;
      const batchWritten = writePromise;
      totalGenerated += batchWritten;

      // Update totalProcessed across all chains
      if (isRedisEnabled()) {
        await getRedis()
          .incrby(`${JOB_KEY}:totalProcessed`, batchWritten)
          .catch(() => {});
      }

      // Update progress + heartbeat
      await updateHeartbeat();
      await updateProgress(totalGenerated, -1);

      await logJobEvent(
        `Batch: ${batchWritten} productos (compute ${Math.round(computeMs / 1000)}s, write ${writeMs}ms)`,
      );

      // Set up next iteration with pre-fetched products
      nextProducts = nextBatch;
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

    // Self-chain: if more work and not stopped/paused, trigger next invocation
    const finalStatus = await getJobStatus();
    if (remaining > 0 && token && finalStatus === "running") {
      const baseUrl = getBaseUrl();
      const selfChainToken = token;
      await logJobEvent(
        `Self-chain disparado, ${remaining.toLocaleString()} restantes`,
      );

      after(async () => {
        try {
          await fetch(
            `${baseUrl}/api/admin/vector-classification/embeddings/generate`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-job-token": selfChainToken,
              },
              body: JSON.stringify({}),
            },
          );
        } catch (err) {
          console.warn("[embeddings/generate] Self-chain fetch failed:", err);
        }
      });
    } else if (remaining === 0) {
      await setJobState("idle");
      await logJobEvent(
        `Job completado: ${totalGenerated} embeddings en esta invocacion`,
      );
    } else if (finalStatus !== "running") {
      if (finalStatus === "stopping") {
        await setJobState("idle");
      }
    }

    return NextResponse.json({
      ok: true,
      generated: totalGenerated,
      remaining,
      jobStatus:
        remaining > 0 && finalStatus === "running"
          ? "running"
          : finalStatus === "paused"
            ? "paused"
            : "idle",
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
