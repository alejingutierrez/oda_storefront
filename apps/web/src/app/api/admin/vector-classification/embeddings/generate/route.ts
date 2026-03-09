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
const HEARTBEAT_TTL = 180; // seconds (3 min — realistic for batches with image processing)

const TIME_BUDGET_MS = 240_000; // 4 min of 5 min maxDuration
const BATCH_SIZE_WITH_IMAGES = 20;
const BATCH_SIZE_TEXT_ONLY = 40;
const MAX_RETRIES = 2;
const SELF_CHAIN_TIMEOUT_MS = 15_000; // 15s timeout for self-chain fetch

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

// ── Fire self-chain via after() with timeout ─────────────────────────

function scheduleSelfChain(chainToken: string) {
  const baseUrl = getBaseUrl();

  after(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      SELF_CHAIN_TIMEOUT_MS,
    );

    try {
      await fetch(
        `${baseUrl}/api/admin/vector-classification/embeddings/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-job-token": chainToken,
          },
          body: JSON.stringify({}),
          signal: controller.signal,
        },
      );
    } catch (err) {
      console.warn("[embeddings/generate] Self-chain fetch failed:", err);
    } finally {
      clearTimeout(timeout);
    }
  });
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

    // Auto-recover stale jobs
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
    let loopError: Error | null = null;

    // ══════════════════════════════════════════════════════════════════
    // INNER TRY: wraps the processing loop. Any error here is caught
    // WITHOUT preventing the self-chain decision below.
    // ══════════════════════════════════════════════════════════════════
    try {
      let nextProducts = await fetchNextBatch(batchSize);

      while (Date.now() - invocationStart < TIME_BUDGET_MS) {
        await updateHeartbeat();

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

        // No more products → done
        if (nextProducts === null) {
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

        // Connection error fetching products → break to self-chain
        if (nextProducts === "connection_error") {
          await logJobEvent(
            "Error de conexion fetcheando productos, self-chain para reconectar",
          );
          break;
        }

        const products = nextProducts;
        const batchStart = Date.now();

        // ── Compute embeddings via Bedrock ──
        // computeEmbeddings() NEVER throws — it returns a possibly-empty array.
        // The retry loop is a safety net for truly unexpected errors.
        let batchResults: EmbeddingResult[] = [];

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            batchResults = await computeEmbeddings(products, skipImages);
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
            // Final attempt failed: log and continue with empty results.
            // Do NOT throw — this would break the self-chain guarantee.
            console.error(
              `[embeddings/generate] Compute failed after ${MAX_RETRIES + 1} attempts:`,
              err,
            );
            await logJobEvent(
              `Error en Bedrock despues de ${MAX_RETRIES + 1} intentos, saltando batch`,
            );
            batchResults = [];
            break;
          }
        }

        const computeMs = Date.now() - batchStart;

        // ── Write results to DB + pre-fetch next batch concurrently ──
        if (batchResults.length > 0) {
          const writeStart = Date.now();

          // Pipeline: write this batch AND pre-fetch the next concurrently.
          // Both are wrapped in try/catch to prevent Promise.all from crashing.
          const [writeResult, nextBatch] = await Promise.all([
            (async (): Promise<number | "connection_error"> => {
              try {
                return await writeEmbeddingsBatch(batchResults);
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
            (async (): Promise<
              EmbeddingProduct[] | "connection_error" | null
            > => {
              try {
                return await fetchNextBatch(batchSize);
              } catch (err) {
                // Any error in pre-fetch → treat as connection error to self-chain
                console.warn(
                  "[embeddings/generate] Unexpected error pre-fetching next batch:",
                  (err as Error).message,
                );
                return "connection_error";
              }
            })(),
          ]);

          const writeMs = Date.now() - writeStart;

          if (writeResult === "connection_error") {
            await logJobEvent(
              "Error de conexion escribiendo embeddings, self-chain",
            );
            break;
          }

          totalGenerated += writeResult;

          if (isRedisEnabled()) {
            await getRedis()
              .incrby(`${JOB_KEY}:totalProcessed`, writeResult)
              .catch(() => {});
          }

          await updateHeartbeat();
          await updateProgress(totalGenerated, -1);
          await logJobEvent(
            `Batch: ${writeResult} productos (compute ${Math.round(computeMs / 1000)}s, write ${writeMs}ms)`,
          );

          nextProducts = nextBatch;
        } else {
          // Empty batch (all products failed) — pre-fetch next batch
          await logJobEvent(
            `Batch vacio: ${products.length} productos fallaron, continuando`,
          );
          nextProducts = await fetchNextBatch(batchSize).catch(
            () => "connection_error" as const,
          );
        }
      }
    } catch (err) {
      // ── Inner catch: errors from the processing loop ──
      // Captured here so we can still self-chain below.
      loopError = err instanceof Error ? err : new Error(String(err));
      console.error(
        "[embeddings/generate] Loop error:",
        loopError.message,
      );
      await logJobEvent(`Error en loop: ${loopError.message}`);
    }

    // ══════════════════════════════════════════════════════════════════
    // ALWAYS REACHED: Count remaining + decide whether to self-chain.
    // This is the KEY structural fix — self-chain fires even after errors.
    // ══════════════════════════════════════════════════════════════════

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
      remaining = 1; // assume more work on count failure
    }

    await updateProgress(totalGenerated, remaining);

    // Decide: self-chain, complete, or error
    const finalStatus = await getJobStatus();
    const wasUserStopped =
      finalStatus === "stopping" ||
      finalStatus === "paused" ||
      finalStatus === "idle"; // idle means loop already set it (completed or stopped)

    if (remaining === 0 && finalStatus !== "idle") {
      await setJobState("idle");
      await logJobEvent(
        `Job completado: ${totalGenerated} embeddings en esta invocacion`,
      );
    }

    const shouldSelfChain =
      remaining > 0 && token && !wasUserStopped;

    if (shouldSelfChain) {
      if (loopError) {
        // Error but recoverable — keep running status and self-chain
        await logJobEvent(
          `Error recuperable, self-chain para reintentar (${remaining.toLocaleString()} restantes)`,
        );
      } else {
        await logJobEvent(
          `Self-chain disparado, ${remaining.toLocaleString()} restantes`,
        );
      }
      scheduleSelfChain(token!);
    } else if (loopError && !wasUserStopped && remaining > 0) {
      // No token available — can't self-chain, permanent error
      await setJobState("error", { error: loopError.message });
    }

    return NextResponse.json({
      ok: !loopError,
      generated: totalGenerated,
      remaining,
      jobStatus: shouldSelfChain
        ? "running"
        : remaining === 0
          ? "idle"
          : finalStatus === "paused"
            ? "paused"
            : wasUserStopped
              ? "idle"
              : "error",
      ...(loopError ? { error: loopError.message } : {}),
    });
  } catch (error) {
    // ── Outermost catch: truly catastrophic pre-loop errors ──
    // (Redis setup failure, auth edge case, etc.)
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
