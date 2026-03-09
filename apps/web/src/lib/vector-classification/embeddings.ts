/**
 * Core embedding generation for vector classification.
 *
 * Uses Amazon Bedrock Titan Multimodal Embeddings G1 to produce
 * 1024-d vectors for both text and images in the same vector space.
 * Once generated, vectors are stored in pgvector (Neon) and all
 * similarity operations happen in SQL — no further AWS dependency.
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
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(10_000) });
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

/**
 * Generate text + image embeddings for a batch of products and upsert
 * into `product_embeddings`.
 *
 * For `combined_embedding`, if both text and image are available we
 * average them (same vector space thanks to Titan Multimodal).
 * Otherwise combined = whichever is available.
 */
export async function generateEmbeddingsForBatch(
  productIds: string[],
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

  let generated = 0;

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
          p.imageCoverUrl ? getImageEmbedding(p.imageCoverUrl) : Promise.resolve(null),
        ]);

        // Combine: average of text + image if both exist
        let combinedEmb: number[];
        if (textEmb && imageEmb) {
          combinedEmb = textEmb.map((v, idx) => (v + imageEmb![idx]) / 2);
        } else {
          combinedEmb = textEmb;
        }

        return { id: p.id, textEmb, imageEmb, combinedEmb, hash };
      }),
    );

    // Batch upsert all embeddings in one transaction
    await prisma.$transaction(
      results.map((item) => {
        const textJson = JSON.stringify(item.textEmb);
        const combinedJson = JSON.stringify(item.combinedEmb);

        if (item.imageEmb) {
          const imageJson = JSON.stringify(item.imageEmb);
          return prisma.$executeRawUnsafe(
            `INSERT INTO product_embeddings (id, "productId", text_embedding, image_embedding, combined_embedding, embedding_model, input_hash, "createdAt", "updatedAt")
             VALUES (gen_random_uuid(), $1, $2::vector(1024), $3::vector(1024), $4::vector(1024), $5, $6, NOW(), NOW())
             ON CONFLICT ("productId")
             DO UPDATE SET
               text_embedding     = $2::vector(1024),
               image_embedding    = $3::vector(1024),
               combined_embedding = $4::vector(1024),
               embedding_model    = $5,
               input_hash         = $6,
               "updatedAt"        = NOW()`,
            item.id,
            textJson,
            imageJson,
            combinedJson,
            EMBEDDING_MODEL,
            item.hash,
          );
        }
        return prisma.$executeRawUnsafe(
          `INSERT INTO product_embeddings (id, "productId", text_embedding, combined_embedding, embedding_model, input_hash, "createdAt", "updatedAt")
           VALUES (gen_random_uuid(), $1, $2::vector(1024), $3::vector(1024), $4, $5, NOW(), NOW())
           ON CONFLICT ("productId")
           DO UPDATE SET
             text_embedding     = $2::vector(1024),
             combined_embedding = $3::vector(1024),
             embedding_model    = $4,
             input_hash         = $5,
             "updatedAt"        = NOW()`,
          item.id,
          textJson,
          combinedJson,
          EMBEDDING_MODEL,
          item.hash,
        );
      }),
    );

    generated += results.length;
  }

  return generated;
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
