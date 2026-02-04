import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env.local") });

type SmokeItem = {
  id: string;
  product: {
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    subcategory: string | null;
    styleTags: string[];
    materialTags: string[];
    patternTags: string[];
    occasionTags: string[];
    gender: string | null;
    season: string | null;
    care: string | null;
    origin: string | null;
    status: string | null;
    sourceUrl: string | null;
    imageCoverUrl: string | null;
    metadata: unknown;
    brand: { name: string } | null;
    variants: Array<{
      id: string;
      sku: string | null;
      color: string | null;
      size: string | null;
      fit: string | null;
      material: string | null;
      price: any;
      currency: string | null;
      stock: number | null;
      stockStatus: string | null;
      images: string[];
      metadata: unknown;
    }>;
  };
};

const nowIso = () => new Date().toISOString();

const run = async () => {
  const limit = Math.max(1, Number(process.env.PRODUCT_ENRICHMENT_SMOKE_LIMIT ?? 20));
  const maxVariants = Math.max(1, Number(process.env.PRODUCT_ENRICHMENT_SMOKE_MAX_VARIANTS ?? 12));
  const concurrency = Math.max(1, Number(process.env.PRODUCT_ENRICHMENT_SMOKE_CONCURRENCY ?? 4));

  const { prisma } = await import("../src/lib/prisma");
  const { enrichProductWithOpenAI } = await import("../src/lib/product-enrichment/openai");

  const latestRun = await prisma.productEnrichmentRun.findFirst({
    orderBy: { updatedAt: "desc" },
  });
  if (!latestRun) {
    throw new Error("No product_enrichment_runs found.");
  }

  const candidates = await prisma.productEnrichmentItem.findMany({
    where: {
      runId: latestRun.id,
      status: { in: ["pending", "failed"] },
    },
    orderBy: { updatedAt: "asc" },
    take: limit * 5,
    include: {
      product: {
        include: {
          brand: true,
          variants: true,
        },
      },
    },
  });

  const selected: SmokeItem[] = [];
  for (const item of candidates) {
    if (!item.product?.variants?.length) continue;
    if (item.product.variants.length > maxVariants) continue;
    selected.push(item as SmokeItem);
    if (selected.length >= limit) break;
  }

  if (!selected.length) {
    throw new Error(
      `No candidates found for smoke test (limit=${limit}, maxVariants=${maxVariants}).`,
    );
  }

  const queue = [...selected];
  let success = 0;
  let failed = 0;
  const durations: number[] = [];
  const errorCounts = new Map<string, number>();

  const worker = async (workerId: number) => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      const variantCount = item.product.variants.length;
      const imageCount = item.product.variants.reduce(
        (sum, v) => sum + (v.images?.length ?? 0),
        0,
      );
      const started = Date.now();
      try {
        await enrichProductWithOpenAI({
          product: {
            id: item.product.id,
            brandName: item.product.brand?.name ?? null,
            name: item.product.name,
            description: item.product.description,
            category: item.product.category,
            subcategory: item.product.subcategory,
            styleTags: item.product.styleTags,
            materialTags: item.product.materialTags,
            patternTags: item.product.patternTags,
            occasionTags: item.product.occasionTags,
            gender: item.product.gender,
            season: item.product.season,
            care: item.product.care,
            origin: item.product.origin,
            status: item.product.status,
            sourceUrl: item.product.sourceUrl,
            imageCoverUrl: item.product.imageCoverUrl,
            metadata: (item.product.metadata as Record<string, unknown>) ?? null,
          },
          variants: item.product.variants.map((variant) => ({
            id: variant.id,
            sku: variant.sku ?? null,
            color: variant.color ?? null,
            size: variant.size ?? null,
            fit: variant.fit ?? null,
            material: variant.material ?? null,
            price: variant.price ? Number(variant.price) : null,
            currency: variant.currency ?? null,
            stock: variant.stock ?? null,
            stockStatus: variant.stockStatus ?? null,
            images: variant.images ?? [],
            metadata: (variant.metadata as Record<string, unknown>) ?? null,
          })),
        });
        success += 1;
        const elapsed = Date.now() - started;
        durations.push(elapsed);
        console.log(
          `[ok] ${nowIso()} item=${item.id} variants=${variantCount} images=${imageCount} ${elapsed}ms`,
        );
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        const key = message.split("\n")[0];
        errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
        console.log(
          `[fail] ${nowIso()} item=${item.id} variants=${variantCount} images=${imageCount} ${key}`,
        );
      }
    }
  };

  const workers = Array.from({ length: concurrency }, (_, index) => worker(index + 1));
  await Promise.all(workers);

  const total = success + failed;
  const avgMs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;
  const maxMs = durations.length ? Math.max(...durations) : 0;

  console.log("---- product enrichment smoke test summary ----");
  console.log(`run_id=${latestRun.id}`);
  console.log(`total=${total} success=${success} failed=${failed}`);
  console.log(`avg_ms=${avgMs} max_ms=${maxMs}`);
  if (errorCounts.size) {
    console.log("top_errors:");
    [...errorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .forEach(([err, count]) => {
        console.log(`- ${count}x ${err}`);
      });
  }
};

run()
  .catch((err) => {
    console.error("smoke test failed", err);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/prisma");
    await prisma.$disconnect();
  });
