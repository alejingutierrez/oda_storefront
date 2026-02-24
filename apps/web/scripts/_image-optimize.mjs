import path from "node:path";
import sharp from "sharp";

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

const toPct = (value) => Number(value.toFixed(2));

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return toPct(sorted[lower] ?? 0);
  const weight = index - lower;
  return toPct((sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight);
};

const extensionFromContentType = (contentType) => {
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

const extensionFromUrl = (url) => {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (!ext || ext.length > 6) return ".jpg";
    if (ext === ".jpeg") return ".jpg";
    return ext;
  } catch {
    return ".jpg";
  }
};

const buildStats = ({ context, sourceUrl, originalBytes, optimizedBytes, convertedTo = null, skippedReason = null }) => {
  const savedBytes = Math.max(0, originalBytes - optimizedBytes);
  const savedPct = originalBytes > 0 ? toPct((savedBytes / originalBytes) * 100) : 0;
  return {
    context,
    sourceUrl,
    originalBytes,
    optimizedBytes,
    savedBytes,
    savedPct,
    convertedTo,
    skippedReason,
  };
};

const contextMaxEdge = (context) => (context === "image-proxy" ? IMAGE_OPTIMIZE_MAX_EDGE_PROXY : IMAGE_OPTIMIZE_MAX_EDGE_CATALOG);

export const summarizeImageOptimization = (samples) => {
  if (!Array.isArray(samples) || !samples.length) {
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
  const originalBytes = samples.reduce((acc, item) => acc + Number(item.originalBytes ?? 0), 0);
  const optimizedBytes = samples.reduce((acc, item) => acc + Number(item.optimizedBytes ?? 0), 0);
  const savedBytes = Math.max(0, originalBytes - optimizedBytes);
  const savedPctValues = samples.map((item) => Number(item.savedPct ?? 0));
  return {
    count: samples.length,
    originalBytes,
    optimizedBytes,
    savedBytes,
    avgSavedPct: originalBytes > 0 ? toPct((savedBytes / originalBytes) * 100) : 0,
    p50SavedPct: percentile(savedPctValues, 50),
    p90SavedPct: percentile(savedPctValues, 90),
  };
};

export const optimizeBeforeBlob = async ({ buffer, sourceUrl, contentType, context = "catalog" }) => {
  const originalBytes = buffer.length;
  const fallbackExt = extensionFromContentType(contentType) ?? extensionFromUrl(sourceUrl);
  if (!ENABLE_IMAGE_OPTIMIZE) {
    return {
      buffer,
      contentType: contentType ?? null,
      extension: fallbackExt,
      stats: buildStats({
        context,
        sourceUrl,
        originalBytes,
        optimizedBytes: originalBytes,
        skippedReason: "optimize_disabled",
      }),
    };
  }

  const normalizedContentType = (contentType ?? "").toLowerCase();
  if (normalizedContentType.includes("image/svg") || fallbackExt === ".svg") {
    return {
      buffer,
      contentType: contentType ?? "image/svg+xml",
      extension: ".svg",
      stats: buildStats({
        context,
        sourceUrl,
        originalBytes,
        optimizedBytes: originalBytes,
        skippedReason: "svg_passthrough",
      }),
    };
  }

  try {
    const maxEdge = contextMaxEdge(context);
    let pipeline = sharp(buffer, { animated: true, failOn: "none", limitInputPixels: false });
    const metadata = await pipeline.metadata();
    const isAnimated = (metadata.pages ?? 1) > 1;
    if (isAnimated && IMAGE_OPTIMIZE_SKIP_ANIMATED) {
      return {
        buffer,
        contentType: contentType ?? null,
        extension: fallbackExt,
        stats: buildStats({
          context,
          sourceUrl,
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

    const optimizedBuffer = await pipeline
      .rotate()
      .webp({
        quality: IMAGE_OPTIMIZE_QUALITY,
        alphaQuality: Math.min(100, IMAGE_OPTIMIZE_QUALITY + 4),
        effort: IMAGE_OPTIMIZE_EFFORT,
        smartSubsample: true,
      })
      .toBuffer();

    const minSavedBytes = Math.floor((originalBytes * IMAGE_OPTIMIZE_MIN_SAVINGS_PCT) / 100);
    if (optimizedBuffer.length >= originalBytes || originalBytes - optimizedBuffer.length < minSavedBytes) {
      return {
        buffer,
        contentType: contentType ?? null,
        extension: fallbackExt,
        stats: buildStats({
          context,
          sourceUrl,
          originalBytes,
          optimizedBytes: originalBytes,
          skippedReason: "insufficient_savings",
        }),
      };
    }

    return {
      buffer: optimizedBuffer,
      contentType: "image/webp",
      extension: ".webp",
      stats: buildStats({
        context,
        sourceUrl,
        originalBytes,
        optimizedBytes: optimizedBuffer.length,
        convertedTo: "image/webp",
      }),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 120) : "optimize_error";
    return {
      buffer,
      contentType: contentType ?? null,
      extension: fallbackExt,
      stats: buildStats({
        context,
        sourceUrl,
        originalBytes,
        optimizedBytes: originalBytes,
        skippedReason: `error:${reason}`,
      }),
    };
  }
};
