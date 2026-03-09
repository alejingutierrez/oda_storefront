/**
 * Core embedding generation for vector classification.
 *
 * Uses Amazon Bedrock Titan Multimodal Embeddings G1 to produce
 * 1024-d vectors for both text and images in the same vector space.
 * Once generated, vectors are stored in pgvector (Neon) and all
 * similarity operations happen in SQL — no further AWS dependency.
 *
 * Architecture: two-phase batch processing separates Bedrock compute
 * from DB writes to avoid Neon idle-connection timeouts.
 */

import { createHash } from "node:crypto";

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { prisma } from "@/lib/prisma";
import type { EmbeddingStats } from "./types";
import {
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_BATCH_SIZE,
  DESCRIPTION_MAX_LENGTH,
} from "./constants";

// ── Bedrock client ──────────────────────────────────────────────────

let _client: BedrockRuntimeClient | null = null;

function getBedrockClient(): BedrockRuntimeClient {
  if (!_client) {
    _client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }
  return _client;
}

// ── Helpers ─────────────────────────────────────────────────────────

function priceTier(minPriceCop: number | null | undefined): string {
  if (minPriceCop == null) return "desconocido";
  if (minPriceCop < 50_000) return "bajo (<50k COP)";
  if (minPriceCop < 150_000) return "medio (50k-150k COP)";
  if (minPriceCop < 400_000) return "alto (150k-400k COP)";
  return "premium (>400k COP)";
}

function joinTags(tags: string[] | null | undefined): string {
  if (!tags || tags.length === 0) return "";
  return tags.join(", ");
}

// ── Types ───────────────────────────────────────────────────────────

export type EmbeddingProduct = {
  id: string;
  name: string;
  description: string | null;
  imageCoverUrl: string | null;
  styleTags: string[];
  materialTags: string[];
  patternTags: string[];
  occasionTags: string[];
  season: string | null;
  minPriceCop: unknown;
  brand: { name: string };
};

export type EmbeddingResult = {
  id: string;
  textEmb: number[];
  imageEmb: number[] | null;
  combinedEmb: number[];
  hash: string;
};

// ── Public API ──────────────────────────────────────────────────────

/**
 * Build a textual representation of a product suitable for embedding.
 *
 * Intentionally excludes the product's current classification fields
 * (category, subcategory, gender) to avoid circular embeddings.
 */
export function buildEmbeddingInput(product: {
  name: string;
  description: string | null;
  styleTags: string[];
  materialTags: string[];
  patternTags: string[];
  occasionTags: string[];
  season: string | null;
  minPriceCop: unknown;
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

export function computeInputHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Call Bedrock Titan Multimodal to get a text embedding.
 */
async function getTextEmbedding(text: string): Promise<number[]> {
  const client = getBedrockClient();
  const response = await client.send(
    new InvokeModelCommand({
      modelId: EMBEDDING_MODEL,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        inputText: text,
        embeddingConfig: { outputEmbeddingLength: EMBEDDING_DIMENSIONS },
      }),
    }),
  );

  const body = JSON.parse(new TextDecoder().decode(response.body));
  return body.embedding as number[];
}

/**
 * Call Bedrock Titan Multimodal to get an image embedding.
 * The image is fetched from its URL and sent as base64.
 */
async function getImageEmbedding(imageUrl: string): Promise<number[] | null> {
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;

    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    // Titan Multimodal accepts JPEG/PNG up to ~2048x2048
    const client = getBedrockClient();
    const response = await client.send(
      new InvokeModelCommand({
        modelId: EMBEDDING_MODEL,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          inputImage: base64,
          embeddingConfig: { outputEmbeddingLength: EMBEDDING_DIMENSIONS },
        }),
      }),
    );

    const body = JSON.parse(new TextDecoder().decode(response.body));
    return body.embedding as number[];
  } catch (err) {
    console.warn(`[embeddings] Failed to embed image ${imageUrl}:`, err);
    return null;
  }
}

// ── Phase 1: Compute (Bedrock only, NO DB) ──────────────────────────

/**
 * Compute text + image embeddings for a batch of products.
 * Pure Bedrock compute — does NOT touch the database.
 *
 * @param products - Product data to embed
 * @param skipImages - If true, skip image embeddings (text-only mode)
 */
export async function computeEmbeddings(
  products: EmbeddingProduct[],
  skipImages = false,
): Promise<EmbeddingResult[]> {
  if (products.length === 0) return [];

  const allResults: EmbeddingResult[] = [];

  // Process in sub-batches with concurrency control
  for (let i = 0; i < products.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = products.slice(i, i + EMBEDDING_BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async (p) => {
        const text = buildEmbeddingInput(p);
        const hash = computeInputHash(text);

        // Parallelize text + image embedding (they are independent)
        const [textEmb, imageEmb] = await Promise.all([
          getTextEmbedding(text),
          !skipImages && p.imageCoverUrl
            ? getImageEmbedding(p.imageCoverUrl)
            : Promise.resolve(null),
        ]);

        // Combine: average of text + image if both exist
        let combinedEmb: number[];
        if (textEmb && imageEmb) {
          combinedEmb = textEmb.map((v, idx) => (v + imageEmb[idx]) / 2);
        } else {
          combinedEmb = textEmb;
        }

        return { id: p.id, textEmb, imageEmb, combinedEmb, hash };
      }),
    );

    allResults.push(...results);
  }

  return allResults;
}

// ── Phase 2: Write (DB only, NO Bedrock) ────────────────────────────

/**
 * Write embedding results to the database using a single multi-row
 * INSERT ... ON CONFLICT upsert. Fast DB operation (~500ms for 20 rows).
 */
export async function writeEmbeddingsBatch(
  results: EmbeddingResult[],
): Promise<number> {
  if (results.length === 0) return 0;

  // Build multi-row INSERT with positional parameters
  // Each row needs: productId, text_embedding, image_embedding, combined_embedding, embedding_model, input_hash
  // That's 6 params per row
  const PARAMS_PER_ROW = 6;
  const valueClauses: string[] = [];
  const params: unknown[] = [];

  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    const offset = i * PARAMS_PER_ROW;
    const textJson = JSON.stringify(item.textEmb);
    const imageJson = item.imageEmb ? JSON.stringify(item.imageEmb) : null;
    const combinedJson = JSON.stringify(item.combinedEmb);

    valueClauses.push(
      `(gen_random_uuid(), $${offset + 1}, $${offset + 2}::vector(1024), ${
        imageJson !== null ? `$${offset + 3}::vector(1024)` : "NULL"
      }, $${imageJson !== null ? offset + 4 : offset + 3}::vector(1024), $${
        imageJson !== null ? offset + 5 : offset + 4
      }, $${imageJson !== null ? offset + 6 : offset + 5}, NOW(), NOW())`,
    );

    // Params differ based on whether image exists
    if (imageJson !== null) {
      params.push(item.id, textJson, imageJson, combinedJson, EMBEDDING_MODEL, item.hash);
    } else {
      params.push(item.id, textJson, combinedJson, EMBEDDING_MODEL, item.hash);
    }
  }

  // Due to variable params per row (with/without image), it's simpler
  // and more reliable to use separate queries grouped by has-image / no-image.
  const withImage = results.filter((r) => r.imageEmb !== null);
  const withoutImage = results.filter((r) => r.imageEmb === null);

  let written = 0;

  if (withImage.length > 0) {
    const imgValueClauses: string[] = [];
    const imgParams: unknown[] = [];
    for (let i = 0; i < withImage.length; i++) {
      const item = withImage[i];
      const o = i * 6; // 6 params per row
      imgValueClauses.push(
        `(gen_random_uuid(), $${o + 1}, $${o + 2}::vector(1024), $${o + 3}::vector(1024), $${o + 4}::vector(1024), $${o + 5}, $${o + 6}, NOW(), NOW())`,
      );
      imgParams.push(
        item.id,
        JSON.stringify(item.textEmb),
        JSON.stringify(item.imageEmb),
        JSON.stringify(item.combinedEmb),
        EMBEDDING_MODEL,
        item.hash,
      );
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO product_embeddings (id, "productId", text_embedding, image_embedding, combined_embedding, embedding_model, input_hash, "createdAt", "updatedAt")
       VALUES ${imgValueClauses.join(",\n       ")}
       ON CONFLICT ("productId")
       DO UPDATE SET
         text_embedding     = EXCLUDED.text_embedding,
         image_embedding    = EXCLUDED.image_embedding,
         combined_embedding = EXCLUDED.combined_embedding,
         embedding_model    = EXCLUDED.embedding_model,
         input_hash         = EXCLUDED.input_hash,
         "updatedAt"        = NOW()`,
      ...imgParams,
    );
    written += withImage.length;
  }

  if (withoutImage.length > 0) {
    const txtValueClauses: string[] = [];
    const txtParams: unknown[] = [];
    for (let i = 0; i < withoutImage.length; i++) {
      const item = withoutImage[i];
      const o = i * 5; // 5 params per row (no image)
      txtValueClauses.push(
        `(gen_random_uuid(), $${o + 1}, $${o + 2}::vector(1024), $${o + 3}::vector(1024), $${o + 4}, $${o + 5}, NOW(), NOW())`,
      );
      txtParams.push(
        item.id,
        JSON.stringify(item.textEmb),
        JSON.stringify(item.combinedEmb),
        EMBEDDING_MODEL,
        item.hash,
      );
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO product_embeddings (id, "productId", text_embedding, combined_embedding, embedding_model, input_hash, "createdAt", "updatedAt")
       VALUES ${txtValueClauses.join(",\n       ")}
       ON CONFLICT ("productId")
       DO UPDATE SET
         text_embedding     = EXCLUDED.text_embedding,
         combined_embedding = EXCLUDED.combined_embedding,
         embedding_model    = EXCLUDED.embedding_model,
         input_hash         = EXCLUDED.input_hash,
         "updatedAt"        = NOW()`,
      ...txtParams,
    );
    written += withoutImage.length;
  }

  return written;
}

// ── Legacy wrapper (for backward compat if needed) ──────────────────

/**
 * Generate text + image embeddings for a batch of products and upsert
 * into `product_embeddings`. Uses two-phase processing internally.
 */
export async function generateEmbeddingsForBatch(
  productIds: string[],
  skipImages = false,
): Promise<number> {
  if (productIds.length === 0) return 0;

  const products = await prisma.product.findMany({
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

  if (products.length === 0) return 0;

  const results = await computeEmbeddings(products, skipImages);
  return writeEmbeddingsBatch(results);
}

/**
 * Return high-level statistics about embedding coverage.
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
