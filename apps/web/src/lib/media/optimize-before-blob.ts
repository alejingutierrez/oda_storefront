import path from "node:path";
import sharp from "sharp";

export type BlobOptimizeContext =
  | "catalog"
  | "image-proxy"
  | "backfill-cover"
  | "backfill-variant"
  | "unknown";

export type ImageOptimizationStats = {
  context: BlobOptimizeContext;
  sourceUrl: string;
  originalBytes: number;
  optimizedBytes: number;
  savedBytes: number;
  savedPct: number;
  convertedTo: string | null;
  skippedReason: string | null;
};

export type ImageOptimizationSummary = {
  count: number;
  originalBytes: number;
  optimizedBytes: number;
  savedBytes: number;
  avgSavedPct: number;
  p50SavedPct: number;
  p90SavedPct: number;
};

export type OptimizeBeforeBlobInput = {
  buffer: Buffer;
  sourceUrl: string;
  contentType?: string | null;
  context: BlobOptimizeContext;
};

export type OptimizeBeforeBlobResult = {
  buffer: Buffer;
  contentType: string | null;
  extension: string;
  stats: ImageOptimizationStats;
};

const ENABLE_IMAGE_OPTIMIZE = (process.env.IMAGE_OPTIMIZE_BEFORE_BLOB ?? "true").trim().toLowerCase() !== "false";
const IMAGE_OPTIMIZE_QUALITY = Math.max(1, Math.min(100, Number(process.env.IMAGE_OPTIMIZE_QUALITY ?? 88)));
const IMAGE_OPTIMIZE_EFFORT = Math.max(0, Math.min(6, Number(process.env.IMAGE_OPTIMIZE_EFFORT ?? 6)));
const IMAGE_OPTIMIZE_MIN_SAVINGS_PCT = Math.max(
  0,
  Math.min(100, Number(process.env.IMAGE_OPTIMIZE_MIN_SAVINGS_PCT ?? 8)),
);
const IMAGE_OPTIMIZE_SKIP_ANIMATED = (process.env.IMAGE_OPTIMIZE_SKIP_ANIMATED ?? "true")
  .trim()
  .toLowerCase() !== "false";
const IMAGE_OPTIMIZE_MAX_EDGE_CATALOG = Math.max(
  0,
  Number(process.env.IMAGE_OPTIMIZE_MAX_EDGE_CATALOG ?? 2200),
);
const IMAGE_OPTIMIZE_MAX_EDGE_PROXY = Math.max(
  0,
  Number(process.env.IMAGE_OPTIMIZE_MAX_EDGE_PROXY ?? 1800),
);
const IMAGE_OPTIMIZE_MAX_EDGE_DEFAULT = Math.max(
  0,
  Number(process.env.IMAGE_OPTIMIZE_MAX_EDGE_DEFAULT ?? 2200),
);

const getMaxEdgeByContext = (context: BlobOptimizeContext) => {
  if (context === "image-proxy") return IMAGE_OPTIMIZE_MAX_EDGE_PROXY;
  if (context === "catalog" || context === "backfill-cover" || context === "backfill-variant") {
    return IMAGE_OPTIMIZE_MAX_EDGE_CATALOG;
  }
  return IMAGE_OPTIMIZE_MAX_EDGE_DEFAULT;
};

const extensionFromContentType = (contentType?: string | null) => {
  if (!contentType) return null;
  const normalized = contentType.toLowerCase();
  if (normalized.includes("image/webp")) return ".webp";
  if (normalized.includes("image/avif")) return ".avif";
  if (normalized.includes("image/png")) return ".png";
  if (normalized.includes("image/gif")) return ".gif";
  if (normalized.includes("image/svg")) return ".svg";
  if (normalized.includes("image/jpeg") || normalized.includes("image/jpg")) return ".jpg";
  return null;
};

const extensionFromUrl = (url: string) => {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (!ext || ext.length > 6) return ".jpg";
    if (ext === ".jpeg") return ".jpg";
    return ext;
  } catch {
    return ".jpg";
  }
};

const toPct = (value: number) => Number(value.toFixed(2));

const buildStats = (input: {
  context: BlobOptimizeContext;
  sourceUrl: string;
  originalBytes: number;
  optimizedBytes: number;
  convertedTo?: string | null;
  skippedReason?: string | null;
}): ImageOptimizationStats => {
  const savedBytes = Math.max(0, input.originalBytes - input.optimizedBytes);
  const savedPct = input.originalBytes > 0 ? toPct((savedBytes / input.originalBytes) * 100) : 0;
  return {
    context: input.context,
    sourceUrl: input.sourceUrl,
    originalBytes: input.originalBytes,
    optimizedBytes: input.optimizedBytes,
    savedBytes,
    savedPct,
    convertedTo: input.convertedTo ?? null,
    skippedReason: input.skippedReason ?? null,
  };
};

const percentile = (values: number[], p: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return toPct(sorted[lower] ?? 0);
  const weight = index - lower;
  const value = (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
  return toPct(value);
};

export const summarizeImageOptimization = (samples: ImageOptimizationStats[]): ImageOptimizationSummary => {
  if (!samples.length) {
    return {
      count: 0,
      originalBytes: 0,
      optimizedBytes: 0,
      savedBytes: 0,
      avgSavedPct: 0,
      p50SavedPct: 0,
      p90SavedPct: 0,
    };
  }
  const originalBytes = samples.reduce((acc, item) => acc + item.originalBytes, 0);
  const optimizedBytes = samples.reduce((acc, item) => acc + item.optimizedBytes, 0);
  const savedBytes = Math.max(0, originalBytes - optimizedBytes);
  const savedPctValues = samples.map((item) => item.savedPct);
  const avgSavedPct =
    originalBytes > 0 ? toPct((savedBytes / originalBytes) * 100) : toPct(savedPctValues.reduce((a, b) => a + b, 0) / samples.length);
  return {
    count: samples.length,
    originalBytes,
    optimizedBytes,
    savedBytes,
    avgSavedPct,
    p50SavedPct: percentile(savedPctValues, 50),
    p90SavedPct: percentile(savedPctValues, 90),
  };
};

export const optimizeBeforeBlob = async (input: OptimizeBeforeBlobInput): Promise<OptimizeBeforeBlobResult> => {
  const originalBytes = input.buffer.length;
  const fallbackExt = extensionFromContentType(input.contentType) ?? extensionFromUrl(input.sourceUrl);

  if (!ENABLE_IMAGE_OPTIMIZE) {
    return {
      buffer: input.buffer,
      contentType: input.contentType ?? null,
      extension: fallbackExt,
      stats: buildStats({
        context: input.context,
        sourceUrl: input.sourceUrl,
        originalBytes,
        optimizedBytes: originalBytes,
        skippedReason: "optimize_disabled",
      }),
    };
  }

  const normalizedContentType = (input.contentType ?? "").toLowerCase();
  const looksSvg = normalizedContentType.includes("image/svg") || fallbackExt === ".svg";
  if (looksSvg) {
    return {
      buffer: input.buffer,
      contentType: input.contentType ?? "image/svg+xml",
      extension: ".svg",
      stats: buildStats({
        context: input.context,
        sourceUrl: input.sourceUrl,
        originalBytes,
        optimizedBytes: originalBytes,
        skippedReason: "svg_passthrough",
      }),
    };
  }

  try {
    const maxEdge = getMaxEdgeByContext(input.context);
    let pipeline = sharp(input.buffer, { animated: true, failOn: "none", limitInputPixels: false });
    const metadata = await pipeline.metadata();
    const isAnimated = (metadata.pages ?? 1) > 1;
    if (isAnimated && IMAGE_OPTIMIZE_SKIP_ANIMATED) {
      return {
        buffer: input.buffer,
        contentType: input.contentType ?? null,
        extension: fallbackExt,
        stats: buildStats({
          context: input.context,
          sourceUrl: input.sourceUrl,
          originalBytes,
          optimizedBytes: originalBytes,
          skippedReason: "animated_passthrough",
        }),
      };
    }

    if (maxEdge > 0 && metadata.width && metadata.height) {
      const longEdge = Math.max(metadata.width, metadata.height);
      if (longEdge > maxEdge) {
        pipeline = pipeline.resize({
          width: metadata.width >= metadata.height ? maxEdge : undefined,
          height: metadata.height > metadata.width ? maxEdge : undefined,
          fit: "inside",
          withoutEnlargement: true,
        });
      }
    }

    const optimized = await pipeline
      .rotate()
      .webp({
        quality: IMAGE_OPTIMIZE_QUALITY,
        alphaQuality: Math.min(100, IMAGE_OPTIMIZE_QUALITY + 4),
        effort: IMAGE_OPTIMIZE_EFFORT,
        smartSubsample: true,
      })
      .toBuffer();

    const minSavedBytes = Math.floor((originalBytes * IMAGE_OPTIMIZE_MIN_SAVINGS_PCT) / 100);
    if (optimized.length >= originalBytes || originalBytes - optimized.length < minSavedBytes) {
      return {
        buffer: input.buffer,
        contentType: input.contentType ?? null,
        extension: fallbackExt,
        stats: buildStats({
          context: input.context,
          sourceUrl: input.sourceUrl,
          originalBytes,
          optimizedBytes: originalBytes,
          skippedReason: "insufficient_savings",
        }),
      };
    }

    return {
      buffer: optimized,
      contentType: "image/webp",
      extension: ".webp",
      stats: buildStats({
        context: input.context,
        sourceUrl: input.sourceUrl,
        originalBytes,
        optimizedBytes: optimized.length,
        convertedTo: "image/webp",
      }),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 120) : "optimize_error";
    return {
      buffer: input.buffer,
      contentType: input.contentType ?? null,
      extension: fallbackExt,
      stats: buildStats({
        context: input.context,
        sourceUrl: input.sourceUrl,
        originalBytes,
        optimizedBytes: originalBytes,
        skippedReason: `error:${reason}`,
      }),
    };
  }
};
