/**
 * Core embedding generation for vector classification.
 *
 * Builds a text representation of each product (excluding its current
 * classification to avoid circular embeddings), hashes the input for
 * staleness detection, and calls OpenAI text-embedding-3-small to
 * produce 1536-d vectors stored in `product_embeddings`.
 */

import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { getOpenAIClient } from "@/lib/openai";
import type { EmbeddingStats } from "./types";
import {
  EMBEDDING_MODEL,
  EMBEDDING_BATCH_SIZE,
  DESCRIPTION_MAX_LENGTH,
} from "./constants";

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Format price as a human-readable tier label used in the embedding
 * input so the model captures rough price positioning without raw numbers.
 */
function priceTier(minPriceCop: number | null | undefined): string {
  if (minPriceCop == null) return "desconocido";
  if (minPriceCop < 50_000) return "bajo (<50k COP)";
  if (minPriceCop < 150_000) return "medio (50k-150k COP)";
  if (minPriceCop < 400_000) return "alto (150k-400k COP)";
  return "premium (>400k COP)";
}

/**
 * Join a string array into a comma-separated list, or return a fallback.
 */
function joinTags(tags: string[] | null | undefined): string {
  if (!tags || tags.length === 0) return "";
  return tags.join(", ");
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Build a textual representation of a product suitable for embedding.
 *
 * **Intentionally excludes** the product's current `category`, `subcategory`,
 * and `gender` fields so that the resulting vector captures intrinsic
 * properties (name, description, tags, price tier, etc.) rather than the
 * classification we are trying to predict.
 */
export function buildEmbeddingInput(product: {
  name: string;
  description: string | null;
  styleTags: string[];
  materialTags: string[];
  patternTags: string[];
  occasionTags: string[];
  season: string | null;
  minPriceCop: unknown; // Decimal from Prisma
  brand: { name: string };
}): string {
  const lines: string[] = [];

  lines.push(`Nombre: ${product.name}`);
  lines.push(`Marca: ${product.brand.name}`);

  if (product.description) {
    const desc =
      product.description.length > DESCRIPTION_MAX_LENGTH
        ? product.description.slice(0, DESCRIPTION_MAX_LENGTH) + "..."
        : product.description;
    lines.push(`Descripcion: ${desc}`);
  }

  const style = joinTags(product.styleTags);
  if (style) lines.push(`Estilos: ${style}`);

  const materials = joinTags(product.materialTags);
  if (materials) lines.push(`Materiales: ${materials}`);

  const patterns = joinTags(product.patternTags);
  if (patterns) lines.push(`Patrones: ${patterns}`);

  const occasions = joinTags(product.occasionTags);
  if (occasions) lines.push(`Ocasiones: ${occasions}`);

  if (product.season) lines.push(`Temporada: ${product.season}`);

  const price = product.minPriceCop != null ? Number(product.minPriceCop) : null;
  lines.push(`Rango de precio: ${priceTier(price)}`);

  return lines.join("\n");
}

/**
 * Compute a SHA-256 hash of an embedding input string.
 *
 * Used to detect whether a product's data has changed since its
 * last embedding was generated (staleness check).
 */
export function computeInputHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Generate embeddings for a batch of products and upsert into
 * `product_embeddings`.
 *
 * @param productIds - Product UUIDs to process.
 * @returns The number of embeddings successfully generated.
 */
export async function generateEmbeddingsForBatch(
  productIds: string[],
): Promise<number> {
  if (productIds.length === 0) return 0;

  // 1. Fetch products
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      subcategory: true,
      gender: true,
      styleTags: true,
      materialTags: true,
      patternTags: true,
      occasionTags: true,
      season: true,
      minPriceCop: true,
      brand: { select: { name: true } },
    },
  });

  if (products.length === 0) return 0;

  // 2. Build inputs and hashes
  const inputs: { id: string; text: string; hash: string }[] = [];
  for (const p of products) {
    const text = buildEmbeddingInput(p);
    const hash = computeInputHash(text);
    inputs.push({ id: p.id, text, hash });
  }

  // 3. Call OpenAI in sub-batches (API limit)
  const openai = getOpenAIClient();
  let generated = 0;

  for (let i = 0; i < inputs.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = inputs.slice(i, i + EMBEDDING_BATCH_SIZE);

    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch.map((b) => b.text),
    });

    // 4. Upsert each embedding
    for (let j = 0; j < response.data.length; j++) {
      const embedding = response.data[j];
      const item = batch[j];
      const vectorJson = JSON.stringify(embedding.embedding);

      await prisma.$executeRawUnsafe(
        `INSERT INTO product_embeddings (id, "productId", text_embedding, combined_embedding, embedding_model, input_hash, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2::vector(1536), $2::vector(1536), $3, $4, NOW(), NOW())
         ON CONFLICT ("productId")
         DO UPDATE SET
           text_embedding    = $2::vector(1536),
           combined_embedding = $2::vector(1536),
           embedding_model   = $3,
           input_hash        = $4,
           "updatedAt"       = NOW()`,
        item.id,
        vectorJson,
        EMBEDDING_MODEL,
        item.hash,
      );

      generated++;
    }
  }

  return generated;
}

/**
 * Return high-level statistics about embedding coverage.
 *
 * - `total`    — active in-stock products
 * - `embedded` — products that have a combined_embedding
 * - `missing`  — products without any embedding
 * - `stale`    — products whose input_hash no longer matches
 *                (we approximate by counting those whose product.updatedAt
 *                is newer than the embedding's updatedAt)
 */
export async function getEmbeddingStats(): Promise<EmbeddingStats> {
  const rows = await prisma.$queryRawUnsafe<
    { total: bigint; embedded: bigint; stale: bigint }[]
  >(
    `SELECT
       (SELECT COUNT(*) FROM products
        WHERE status = 'active' OR status IS NULL) AS total,
       (SELECT COUNT(*) FROM product_embeddings
        WHERE combined_embedding IS NOT NULL) AS embedded,
       (SELECT COUNT(*) FROM product_embeddings pe
        JOIN products p ON p.id = pe."productId"
        WHERE pe.combined_embedding IS NOT NULL
          AND p."updatedAt" > pe."updatedAt") AS stale`,
  );

  const row = rows[0];
  const total = Number(row.total);
  const embedded = Number(row.embedded);
  const stale = Number(row.stale);

  return {
    total,
    embedded,
    missing: total - embedded,
    stale,
  };
}
