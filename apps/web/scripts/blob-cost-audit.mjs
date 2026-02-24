import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";
import { list } from "@vercel/blob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../");
const reportsDir = path.resolve(repoRoot, "reports/blob-cost");

dotenv.config({ path: path.resolve(repoRoot, ".env") });

const connectionString =
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  "";
const blobToken = process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_READ_WRITE_TOKEN || "";

if (!connectionString) {
  console.error("Missing NEON_DATABASE_URL/DATABASE_URL/POSTGRES_URL/POSTGRES_PRISMA_URL");
  process.exit(1);
}
if (!blobToken) {
  console.error("Missing BLOB_READ_WRITE_TOKEN/VERCEL_BLOB_READ_WRITE_TOKEN");
  process.exit(1);
}

const BLOB_HOST_FRAGMENT = "blob.vercel-storage.com";
const ORPHAN_THRESHOLDS_DAYS = [7, 14, 30, 60];
const LIST_LIMIT = Math.max(1, Math.min(1000, Number(process.env.BLOB_COST_AUDIT_LIST_LIMIT ?? 1000)));
const LIST_RETRIES = Math.max(1, Number(process.env.BLOB_COST_AUDIT_LIST_RETRIES ?? 4));
const LIST_LOG_EVERY = Math.max(1000, Number(process.env.BLOB_COST_AUDIT_LOG_EVERY ?? 20000));
const TOP_LIMIT = Math.max(1, Number(process.env.BLOB_COST_AUDIT_TOP_LIMIT ?? 25));
const MAX_BLOBS = Math.max(0, Number(process.env.BLOB_COST_AUDIT_MAX_BLOBS ?? 0));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toGb = (bytes) => Number((bytes / (1024 ** 3)).toFixed(4));
const toPct = (num, den) => (den > 0 ? Number(((num / den) * 100).toFixed(2)) : 0);

const csvEscape = (value) => {
  const str = value == null ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const writeCsv = async (filePath, columns, rows) => {
  const header = columns.join(",");
  const body = rows
    .map((row) => columns.map((col) => csvEscape(row[col])).join(","))
    .join("\n");
  const output = body ? `${header}\n${body}\n` : `${header}\n`;
  await fs.writeFile(filePath, output, "utf8");
};

const normalizeBlobPath = (value) => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const [withoutQuery] = trimmed.split(/[?#]/, 1);
  const cleaned = withoutQuery.replace(/^\/+/, "");
  if (!cleaned || !cleaned.includes("/")) return null;
  return cleaned;
};

const extractBlobPathFromUrl = (value) => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !trimmed.includes(BLOB_HOST_FRAGMENT)) return null;
  const normalized = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
  try {
    const target = /^https?:\/\//i.test(normalized)
      ? normalized
      : `https://${normalized.replace(/^\/+/, "")}`;
    const pathname = new URL(target).pathname.replace(/^\/+/, "");
    return pathname || null;
  } catch {
    return null;
  }
};

const extractExternalHost = (value) => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes(BLOB_HOST_FRAGMENT)) return null;
  if (trimmed.startsWith("data:") || trimmed.startsWith("/")) return null;
  const normalized = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
  const target = /^https?:\/\//i.test(normalized)
    ? normalized
    : `https://${normalized.replace(/^\/+/, "")}`;
  try {
    const hostname = new URL(target).hostname.toLowerCase();
    return hostname || null;
  } catch {
    return null;
  }
};

const registerHost = (hostStats, rawUrl, source) => {
  const host = extractExternalHost(rawUrl);
  if (!host) return false;
  const key = host;
  let entry = hostStats.get(key);
  if (!entry) {
    entry = {
      host,
      occurrences: 0,
      coverOccurrences: 0,
      variantOccurrences: 0,
      assetOccurrences: 0,
      uniqueUrls: new Set(),
    };
    hostStats.set(key, entry);
  }
  entry.occurrences += 1;
  if (source === "cover") entry.coverOccurrences += 1;
  if (source === "variant") entry.variantOccurrences += 1;
  if (source === "asset") entry.assetOccurrences += 1;
  if (entry.uniqueUrls.size < 20000) {
    entry.uniqueUrls.add(String(rawUrl));
  }
  return true;
};

const listWithRetry = async ({ token, cursor }) => {
  let attempt = 0;
  let lastError = null;
  while (attempt < LIST_RETRIES) {
    attempt += 1;
    try {
      return await list({ token, limit: LIST_LIMIT, cursor });
    } catch (error) {
      lastError = error;
      if (attempt >= LIST_RETRIES) break;
      const waitMs = Math.min(5000, 250 * 2 ** (attempt - 1));
      console.warn("blob-cost-audit.list.retry", { attempt, waitMs });
      await sleep(waitMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "list_failed"));
};

const loadBrandExternalStats = async (client) => {
  const coverRes = await client.query(`
    select
      b.slug,
      b.name,
      count(*)::int as "coverNonBlobCount"
    from products p
    join brands b on b.id = p."brandId"
    where p."imageCoverUrl" is not null
      and p."imageCoverUrl" not like '%blob.vercel-storage.com%'
    group by b.slug, b.name
  `);

  const variantRes = await client.query(`
    select
      b.slug,
      b.name,
      count(distinct p.id)::int as "productsWithExternalVariant",
      count(*)::int as "variantsWithExternalImages",
      count(*) filter (where media.blob_cnt = 0)::int as "variantsAllExternal",
      count(*) filter (where media.blob_cnt > 0)::int as "variantsMixed",
      coalesce(sum(media.external_cnt), 0)::int as "externalVariantImageCount"
    from variants v
    join products p on p.id = v."productId"
    join brands b on b.id = p."brandId"
    join lateral (
      select
        count(*) filter (
          where img is not null
            and img <> ''
            and img like '%blob.vercel-storage.com%'
        )::int as blob_cnt,
        count(*) filter (
          where img is not null
            and img <> ''
            and img not like '%blob.vercel-storage.com%'
        )::int as external_cnt
      from unnest(v.images) as img
    ) media on true
    where media.external_cnt > 0
    group by b.slug, b.name
  `);

  const brandMap = new Map();

  for (const row of coverRes.rows ?? []) {
    const slug = String(row.slug ?? "unknown");
    const current = brandMap.get(slug) ?? {
      brandSlug: slug,
      brandName: String(row.name ?? slug),
      coverNonBlobCount: 0,
      productsWithExternalVariant: 0,
      variantsWithExternalImages: 0,
      variantsAllExternal: 0,
      variantsMixed: 0,
      externalVariantImageCount: 0,
    };
    current.coverNonBlobCount = Number(row.coverNonBlobCount ?? 0);
    brandMap.set(slug, current);
  }

  for (const row of variantRes.rows ?? []) {
    const slug = String(row.slug ?? "unknown");
    const current = brandMap.get(slug) ?? {
      brandSlug: slug,
      brandName: String(row.name ?? slug),
      coverNonBlobCount: 0,
      productsWithExternalVariant: 0,
      variantsWithExternalImages: 0,
      variantsAllExternal: 0,
      variantsMixed: 0,
      externalVariantImageCount: 0,
    };
    current.productsWithExternalVariant = Number(row.productsWithExternalVariant ?? 0);
    current.variantsWithExternalImages = Number(row.variantsWithExternalImages ?? 0);
    current.variantsAllExternal = Number(row.variantsAllExternal ?? 0);
    current.variantsMixed = Number(row.variantsMixed ?? 0);
    current.externalVariantImageCount = Number(row.externalVariantImageCount ?? 0);
    brandMap.set(slug, current);
  }

  const rows = Array.from(brandMap.values())
    .map((item) => ({
      ...item,
      totalSignals: item.coverNonBlobCount + item.productsWithExternalVariant,
    }))
    .sort((a, b) => {
      if (b.totalSignals !== a.totalSignals) return b.totalSignals - a.totalSignals;
      if (b.externalVariantImageCount !== a.externalVariantImageCount) {
        return b.externalVariantImageCount - a.externalVariantImageCount;
      }
      return b.coverNonBlobCount - a.coverNonBlobCount;
    });

  return {
    rows,
    totals: {
      coverNonBlob: rows.reduce((acc, item) => acc + item.coverNonBlobCount, 0),
      productsWithExternalVariant: rows.reduce((acc, item) => acc + item.productsWithExternalVariant, 0),
      variantsWithExternalImages: rows.reduce((acc, item) => acc + item.variantsWithExternalImages, 0),
      variantsAllExternal: rows.reduce((acc, item) => acc + item.variantsAllExternal, 0),
      variantsMixed: rows.reduce((acc, item) => acc + item.variantsMixed, 0),
      externalVariantImageCount: rows.reduce((acc, item) => acc + item.externalVariantImageCount, 0),
    },
  };
};

const loadOptimizationStats = async (client) => {
  const res = await client.query(`
    with samples as (
      select
        p.metadata -> 'image_optimization' ->> 'originalBytes' as original_bytes_raw,
        p.metadata -> 'image_optimization' ->> 'optimizedBytes' as optimized_bytes_raw
      from products p
      where p.metadata ? 'image_optimization'
      union all
      select
        v.metadata -> 'image_optimization' ->> 'originalBytes' as original_bytes_raw,
        v.metadata -> 'image_optimization' ->> 'optimizedBytes' as optimized_bytes_raw
      from variants v
      where v.metadata ? 'image_optimization'
    ),
    parsed as (
      select
        case
          when coalesce(original_bytes_raw, '') ~ '^[0-9]+(\\.[0-9]+)?$' then (original_bytes_raw)::numeric
          else null
        end as original_bytes,
        case
          when coalesce(optimized_bytes_raw, '') ~ '^[0-9]+(\\.[0-9]+)?$' then (optimized_bytes_raw)::numeric
          else null
        end as optimized_bytes
      from samples
    ),
    valid as (
      select
        original_bytes,
        optimized_bytes,
        ((original_bytes - optimized_bytes) / nullif(original_bytes, 0)) * 100 as saved_pct
      from parsed
      where original_bytes is not null
        and optimized_bytes is not null
        and original_bytes > 0
        and optimized_bytes >= 0
    )
    select
      count(*)::int as count,
      coalesce(sum(original_bytes), 0)::numeric as total_original_bytes,
      coalesce(sum(optimized_bytes), 0)::numeric as total_optimized_bytes,
      coalesce(sum(original_bytes - optimized_bytes), 0)::numeric as total_saved_bytes,
      coalesce(percentile_cont(0.5) within group (order by saved_pct), 0)::numeric as p50_saved_pct,
      coalesce(percentile_cont(0.9) within group (order by saved_pct), 0)::numeric as p90_saved_pct
    from valid
  `);
  const row = res.rows?.[0] ?? {};
  return {
    count: Number(row.count ?? 0),
    total_original_bytes: Number(row.total_original_bytes ?? 0),
    total_optimized_bytes: Number(row.total_optimized_bytes ?? 0),
    total_saved_bytes: Number(row.total_saved_bytes ?? 0),
    p50_saved_pct: Number(Number(row.p50_saved_pct ?? 0).toFixed(2)),
    p90_saved_pct: Number(Number(row.p90_saved_pct ?? 0).toFixed(2)),
  };
};

const collectDbReferences = async (client) => {
  const referencedBlobPaths = new Set();
  const hostStats = new Map();

  const counters = {
    coverRows: 0,
    coverBlobRefs: 0,
    coverExternalUrls: 0,
    variantRows: 0,
    variantImageUrls: 0,
    variantBlobRefs: 0,
    variantExternalUrls: 0,
    assetRows: 0,
    assetBlobRefs: 0,
    assetExternalUrls: 0,
    assetBlobPathRows: 0,
    assetBlobPathRefs: 0,
  };

  const coversRes = await client.query(`
    select "imageCoverUrl" as url
    from products
    where "imageCoverUrl" is not null
  `);

  for (const row of coversRes.rows ?? []) {
    counters.coverRows += 1;
    const blobPath = extractBlobPathFromUrl(row.url);
    if (blobPath) {
      referencedBlobPaths.add(blobPath);
      counters.coverBlobRefs += 1;
      continue;
    }
    if (registerHost(hostStats, row.url, "cover")) {
      counters.coverExternalUrls += 1;
    }
  }

  const variantsRes = await client.query(`
    select images
    from variants
    where cardinality(images) > 0
  `);

  for (const row of variantsRes.rows ?? []) {
    counters.variantRows += 1;
    const images = Array.isArray(row.images) ? row.images : [];
    for (const imageUrl of images) {
      counters.variantImageUrls += 1;
      const blobPath = extractBlobPathFromUrl(imageUrl);
      if (blobPath) {
        referencedBlobPaths.add(blobPath);
        counters.variantBlobRefs += 1;
        continue;
      }
      if (registerHost(hostStats, imageUrl, "variant")) {
        counters.variantExternalUrls += 1;
      }
    }
  }

  const assetsRes = await client.query(`
    select url
    from assets
    where url is not null
  `);

  for (const row of assetsRes.rows ?? []) {
    counters.assetRows += 1;
    const blobPath = extractBlobPathFromUrl(row.url);
    if (blobPath) {
      referencedBlobPaths.add(blobPath);
      counters.assetBlobRefs += 1;
      continue;
    }
    if (registerHost(hostStats, row.url, "asset")) {
      counters.assetExternalUrls += 1;
    }
  }

  const assetBlobPathRes = await client.query(`
    select "blobPath"
    from assets
    where "blobPath" is not null
      and "blobPath" <> ''
  `);

  for (const row of assetBlobPathRes.rows ?? []) {
    counters.assetBlobPathRows += 1;
    const normalizedPath = normalizeBlobPath(row.blobPath);
    if (!normalizedPath) continue;
    referencedBlobPaths.add(normalizedPath);
    counters.assetBlobPathRefs += 1;
  }

  return { referencedBlobPaths, hostStats, counters };
};

const main = async () => {
  await fs.mkdir(reportsDir, { recursive: true });

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    const dbReferences = await collectDbReferences(client);
    const brandStats = await loadBrandExternalStats(client);
    const optimizationStats = await loadOptimizationStats(client);

    console.log(
      JSON.stringify(
        {
          stage: "db_references_loaded",
          referencedBlobPaths: dbReferences.referencedBlobPaths.size,
          counters: dbReferences.counters,
          brandRows: brandStats.rows.length,
        },
        null,
        2,
      ),
    );

    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;
    const prefixStats = new Map();
    const orphanBuckets = new Map(ORPHAN_THRESHOLDS_DAYS.map((days) => [days, { count: 0, bytes: 0 }]));

    let totalBlobs = 0;
    let totalBytes = 0;
    let orphanCount = 0;
    let orphanBytes = 0;
    let partial = false;

    let cursor = undefined;
    let hasMore = true;

    while (hasMore) {
      const page = await listWithRetry({ token: blobToken, cursor });
      const blobs = Array.isArray(page.blobs) ? page.blobs : [];

      for (const blob of blobs) {
        totalBlobs += 1;
        totalBytes += Number(blob.size ?? 0);

        const pathname = String(blob.pathname ?? "");
        const prefix = pathname.split("/")[0] || "(root)";
        const prefixEntry = prefixStats.get(prefix) ?? { prefix, count: 0, bytes: 0 };
        prefixEntry.count += 1;
        prefixEntry.bytes += Number(blob.size ?? 0);
        prefixStats.set(prefix, prefixEntry);

        if (!dbReferences.referencedBlobPaths.has(pathname)) {
          orphanCount += 1;
          orphanBytes += Number(blob.size ?? 0);

          const uploadedAtMs = Date.parse(String(blob.uploadedAt ?? ""));
          if (Number.isFinite(uploadedAtMs)) {
            const ageDays = Math.floor((now - uploadedAtMs) / msPerDay);
            for (const threshold of ORPHAN_THRESHOLDS_DAYS) {
              if (ageDays >= threshold) {
                const bucket = orphanBuckets.get(threshold);
                if (bucket) {
                  bucket.count += 1;
                  bucket.bytes += Number(blob.size ?? 0);
                }
              }
            }
          }
        }

        if (MAX_BLOBS > 0 && totalBlobs >= MAX_BLOBS) {
          partial = true;
          hasMore = false;
          break;
        }
      }

      if (totalBlobs % LIST_LOG_EVERY === 0 || !page.hasMore || !hasMore) {
        console.log(
          JSON.stringify(
            {
              stage: "blob_scan_progress",
              totalBlobs,
              totalBytes,
              orphanCount,
              orphanBytes,
              hasMore: Boolean(page.hasMore && hasMore),
            },
            null,
            2,
          ),
        );
      }

      if (!hasMore) break;
      hasMore = Boolean(page.hasMore);
      cursor = page.cursor;
    }

    const prefixRows = Array.from(prefixStats.values())
      .sort((a, b) => b.bytes - a.bytes)
      .map((row) => ({
        prefix: row.prefix,
        blob_count: row.count,
        size_bytes: row.bytes,
        size_gb: toGb(row.bytes),
        pct_store_bytes: toPct(row.bytes, totalBytes),
      }));

    const orphanAgeRows = ORPHAN_THRESHOLDS_DAYS.map((days) => {
      const bucket = orphanBuckets.get(days) ?? { count: 0, bytes: 0 };
      return {
        min_age_days: days,
        orphan_count: bucket.count,
        orphan_size_bytes: bucket.bytes,
        orphan_size_gb: toGb(bucket.bytes),
        pct_store_bytes: toPct(bucket.bytes, totalBytes),
      };
    });

    const topExternalHosts = Array.from(dbReferences.hostStats.values())
      .map((entry) => ({
        host: entry.host,
        occurrences: entry.occurrences,
        unique_urls: entry.uniqueUrls.size,
        cover_occurrences: entry.coverOccurrences,
        variant_occurrences: entry.variantOccurrences,
        asset_occurrences: entry.assetOccurrences,
      }))
      .sort((a, b) => {
        if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
        return b.unique_urls - a.unique_urls;
      });

    const topNonBlobBrands = brandStats.rows.slice(0, TOP_LIMIT);

    const summary = {
      generatedAt: new Date().toISOString(),
      partial,
      maxBlobs: MAX_BLOBS,
      blobScan: {
        totalBlobs,
        totalBytes,
        totalGb: toGb(totalBytes),
        prefixes: prefixRows,
      },
      orphanBlobs: {
        totalCount: orphanCount,
        totalBytes: orphanBytes,
        totalGb: toGb(orphanBytes),
        pctStoreBytes: toPct(orphanBytes, totalBytes),
        byMinAgeDays: orphanAgeRows,
      },
      references: {
        referencedBlobPaths: dbReferences.referencedBlobPaths.size,
        counters: dbReferences.counters,
        coverNonBlob: brandStats.totals.coverNonBlob,
        productsWithExternalVariant: brandStats.totals.productsWithExternalVariant,
        variantsWithExternalImages: brandStats.totals.variantsWithExternalImages,
        variantsAllExternal: brandStats.totals.variantsAllExternal,
        variantsMixed: brandStats.totals.variantsMixed,
        externalVariantImageCount: brandStats.totals.externalVariantImageCount,
      },
      optimization: optimizationStats,
      topNonBlobBrands,
      topExternalHosts: topExternalHosts.slice(0, TOP_LIMIT),
      files: {},
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const summaryPath = path.join(reportsDir, `blob-cost-audit-${stamp}.json`);
    const latestSummaryPath = path.join(reportsDir, "blob-cost-audit-latest.json");
    const prefixCsvPath = path.join(reportsDir, `blob-cost-prefixes-${stamp}.csv`);
    const prefixCsvLatestPath = path.join(reportsDir, "blob-cost-prefixes-latest.csv");
    const orphanCsvPath = path.join(reportsDir, `blob-cost-orphans-by-age-${stamp}.csv`);
    const orphanCsvLatestPath = path.join(reportsDir, "blob-cost-orphans-by-age-latest.csv");
    const brandsCsvPath = path.join(reportsDir, `blob-cost-top-brands-${stamp}.csv`);
    const brandsCsvLatestPath = path.join(reportsDir, "blob-cost-top-brands-latest.csv");
    const hostsCsvPath = path.join(reportsDir, `blob-cost-top-hosts-${stamp}.csv`);
    const hostsCsvLatestPath = path.join(reportsDir, "blob-cost-top-hosts-latest.csv");

    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
    await fs.writeFile(latestSummaryPath, JSON.stringify(summary, null, 2), "utf8");

    await writeCsv(prefixCsvPath, ["prefix", "blob_count", "size_bytes", "size_gb", "pct_store_bytes"], prefixRows);
    await writeCsv(prefixCsvLatestPath, ["prefix", "blob_count", "size_bytes", "size_gb", "pct_store_bytes"], prefixRows);

    await writeCsv(
      orphanCsvPath,
      ["min_age_days", "orphan_count", "orphan_size_bytes", "orphan_size_gb", "pct_store_bytes"],
      orphanAgeRows,
    );
    await writeCsv(
      orphanCsvLatestPath,
      ["min_age_days", "orphan_count", "orphan_size_bytes", "orphan_size_gb", "pct_store_bytes"],
      orphanAgeRows,
    );

    await writeCsv(
      brandsCsvPath,
      [
        "brandSlug",
        "brandName",
        "coverNonBlobCount",
        "productsWithExternalVariant",
        "variantsWithExternalImages",
        "variantsAllExternal",
        "variantsMixed",
        "externalVariantImageCount",
        "totalSignals",
      ],
      brandStats.rows,
    );
    await writeCsv(
      brandsCsvLatestPath,
      [
        "brandSlug",
        "brandName",
        "coverNonBlobCount",
        "productsWithExternalVariant",
        "variantsWithExternalImages",
        "variantsAllExternal",
        "variantsMixed",
        "externalVariantImageCount",
        "totalSignals",
      ],
      brandStats.rows,
    );

    await writeCsv(
      hostsCsvPath,
      ["host", "occurrences", "unique_urls", "cover_occurrences", "variant_occurrences", "asset_occurrences"],
      topExternalHosts,
    );
    await writeCsv(
      hostsCsvLatestPath,
      ["host", "occurrences", "unique_urls", "cover_occurrences", "variant_occurrences", "asset_occurrences"],
      topExternalHosts,
    );

    summary.files = {
      summaryPath,
      latestSummaryPath,
      prefixCsvPath,
      prefixCsvLatestPath,
      orphanCsvPath,
      orphanCsvLatestPath,
      brandsCsvPath,
      brandsCsvLatestPath,
      hostsCsvPath,
      hostsCsvLatestPath,
    };

    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
    await fs.writeFile(latestSummaryPath, JSON.stringify(summary, null, 2), "utf8");

    console.log(
      JSON.stringify(
        {
          done: true,
          partial,
          totalBlobs,
          totalGb: toGb(totalBytes),
          orphanGb: toGb(orphanBytes),
          orphanPctBytes: toPct(orphanBytes, totalBytes),
          coverNonBlob: brandStats.totals.coverNonBlob,
          productsWithExternalVariant: brandStats.totals.productsWithExternalVariant,
          variantsAllExternal: brandStats.totals.variantsAllExternal,
          variantsMixed: brandStats.totals.variantsMixed,
          optimizationP50SavedPct: optimizationStats.p50_saved_pct,
          optimizationP90SavedPct: optimizationStats.p90_saved_pct,
          output: summary.files,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error("blob-cost-audit.failed", error);
  process.exit(1);
});
