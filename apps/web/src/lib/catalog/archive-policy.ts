import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { discoverCatalogRefs } from "@/lib/catalog/discovery";
import { CATALOG_MAX_ATTEMPTS } from "@/lib/catalog/constants";
import { removeCatalogJobByItemId } from "@/lib/catalog/queue";
import { removeEnrichmentJobByItemId } from "@/lib/product-enrichment/queue";

const ARCHIVE_POLICY_VERSION = process.env.CATALOG_ARCHIVE_POLICY_VERSION ?? "v5";
const HTTP_PROBE_TIMEOUT_MS = Math.max(
  3_000,
  Number(process.env.CATALOG_ARCHIVE_HTTP_TIMEOUT_MS ?? 12_000),
);
const ARCHIVE_404_MIN_ITEMS = Math.max(
  1,
  Number(process.env.CATALOG_ARCHIVE_404_MIN_ITEMS ?? 30),
);
const ARCHIVE_404_MIN_RATIO = Math.max(
  0,
  Math.min(1, Number(process.env.CATALOG_ARCHIVE_404_MIN_RATIO ?? 0.95)),
);
const ARCHIVE_404_RECHECK_SAMPLE_LIMIT = Math.max(
  1,
  Number(process.env.CATALOG_ARCHIVE_404_RECHECK_SAMPLE_LIMIT ?? 10),
);
const ARCHIVE_404_RECHECK_MIN_RATIO = Math.max(
  0,
  Math.min(1, Number(process.env.CATALOG_ARCHIVE_404_RECHECK_MIN_RATIO ?? 0.8)),
);
const ARCHIVE_NO_PRODUCTS_MIN_VALIDATIONS = Math.max(
  2,
  Number(process.env.CATALOG_ARCHIVE_NO_PRODUCTS_MIN_VALIDATIONS ?? 2),
);
const ARCHIVE_NO_PRODUCTS_MIN_VALIDATION_HOURS = Math.max(
  1,
  Number(process.env.CATALOG_ARCHIVE_NO_PRODUCTS_MIN_VALIDATION_HOURS ?? 24),
);
const ARCHIVE_NO_PRODUCTS_DISCOVERY_LIMIT = Math.max(
  20,
  Number(process.env.CATALOG_ARCHIVE_NO_PRODUCTS_DISCOVERY_LIMIT ?? 250),
);

const AGENT = "ODAArchiveBot/1.0 (+catalog-refresh)";

type JsonRecord = Record<string, unknown>;

const readRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const parseDate = (value: unknown) => {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const chunk = <T,>(items: T[], size: number) => {
  if (size <= 0 || items.length <= size) return [items];
  const slices: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    slices.push(items.slice(i, i + size));
  }
  return slices;
};

const normalizeErrorText = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export type CatalogFailureClass =
  | "dead_url_404"
  | "woocommerce_parser_or_product_endpoint"
  | "shopify_parser_or_product_endpoint"
  | "vtex_parser"
  | "timeout_abort"
  | "openai_quota_or_rate"
  | "media_guardrail_block"
  | "no_products"
  | "other";

export const classifyCatalogFailure = (rawError: unknown): CatalogFailureClass => {
  const error = normalizeErrorText(rawError);
  if (!error) return "other";

  if (
    error.includes("status=404") ||
    error.includes("status 404") ||
    error.includes("status=410") ||
    error.includes("status 410") ||
    error.includes("no se pudo obtener html (404)") ||
    error.includes("not found")
  ) {
    return "dead_url_404";
  }
  if (error.includes("manual_review_no_products") || error.includes("manual_review_vtex_no_products") || error.includes("no_refs")) {
    return "no_products";
  }
  if (error.includes("woocommerce") || error.includes("wp-json") || error.includes("/producto/")) {
    return "woocommerce_parser_or_product_endpoint";
  }
  if (error.includes("shopify") || error.includes("/products/") || error.includes("llm_pdp_false")) {
    return "shopify_parser_or_product_endpoint";
  }
  if (error.includes("vtex")) return "vtex_parser";
  if (error.includes("aborted") || error.includes("timeout")) return "timeout_abort";
  if (error.includes("quota") || error.includes("rate") || error.includes("429")) {
    return "openai_quota_or_rate";
  }
  if (
    error.includes("external_media_url_blocked") ||
    error.includes("blob_required_no_blob_images") ||
    error.includes("external_media_blocked")
  ) {
    return "media_guardrail_block";
  }
  return "other";
};

const isNoProductsSignal = (params: {
  runLastError: string | null;
  runBlockReason: string | null;
  refreshLastError: string | null;
  refreshStatus: string | null;
  extractFinishedReason: string | null;
  extractReviewReason: string | null;
  runTotalItems: number;
}) => {
  const tokens = [
    params.runLastError,
    params.runBlockReason,
    params.refreshLastError,
    params.extractFinishedReason,
    params.extractReviewReason,
  ]
    .map((value) => normalizeErrorText(value))
    .filter(Boolean);

  if (tokens.some((value) => classifyCatalogFailure(value) === "no_products")) return true;
  if (params.refreshStatus === "blocked" && params.runTotalItems <= 0) return true;
  if (params.runTotalItems <= 0 && tokens.length > 0) return true;
  return false;
};

type HttpProbe = {
  url: string;
  status: number | null;
  ok2xx3xx: boolean;
  error: string | null;
};

const withAbort = async (input: string, method: "HEAD" | "GET") => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(input, {
      method,
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "user-agent": AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
};

const probeHttp = async (url: string): Promise<HttpProbe> => {
  try {
    const head = await withAbort(url, "HEAD");
    if (head.status === 405 || head.status === 501) {
      const get = await withAbort(url, "GET");
      return {
        url,
        status: get.status,
        ok2xx3xx: get.status >= 200 && get.status < 400,
        error: null,
      };
    }
    return {
      url,
      status: head.status,
      ok2xx3xx: head.status >= 200 && head.status < 400,
      error: null,
    };
  } catch (error) {
    return {
      url,
      status: null,
      ok2xx3xx: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const probeRoot = async (siteUrl: string) => {
  try {
    const root = new URL(siteUrl);
    root.pathname = "/";
    root.search = "";
    root.hash = "";
    return probeHttp(root.toString());
  } catch {
    return {
      url: siteUrl,
      status: null,
      ok2xx3xx: false,
      error: "invalid_site_url",
    } satisfies HttpProbe;
  }
};

const probeSitemapHealth = async (siteUrl: string) => {
  let origin: string;
  try {
    origin = new URL(siteUrl).origin;
  } catch {
    return {
      healthy: false,
      sample: [] as HttpProbe[],
    };
  }

  const targets = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/robots.txt`,
  ];
  const results = await Promise.all(targets.map((target) => probeHttp(target)));
  return {
    healthy: results.some((result) => result.ok2xx3xx),
    sample: results,
  };
};

const probe404Sample = async (urls: string[]) => {
  if (!urls.length) {
    return {
      total: 0,
      statuses404or410: 0,
      ratio: 0,
      sample: [] as HttpProbe[],
    };
  }

  const probes = await Promise.all(urls.map((url) => probeHttp(url)));
  const statuses404or410 = probes.filter((probe) => probe.status === 404 || probe.status === 410)
    .length;
  return {
    total: probes.length,
    statuses404or410,
    ratio: probes.length > 0 ? statuses404or410 / probes.length : 0,
    sample: probes,
  };
};

const listFailed404Urls = async (runId: string, limit: number) => {
  const rows = await prisma.catalogItem.findMany({
    where: {
      runId,
      status: "failed",
    },
    select: { url: true, lastError: true },
    orderBy: { updatedAt: "desc" },
    take: Math.max(limit * 3, limit),
  });

  const deduped = new Set<string>();
  const selected: string[] = [];
  for (const row of rows) {
    const classification = classifyCatalogFailure(row.lastError);
    if (classification !== "dead_url_404") continue;
    const url = row.url?.trim();
    if (!url || deduped.has(url)) continue;
    deduped.add(url);
    selected.push(url);
    if (selected.length >= limit) break;
  }
  return selected;
};

const readArchiveLifecycle = (metadata: JsonRecord) => {
  const lifecycle = readRecord(metadata.catalog_lifecycle);
  const noProductsValidation = readRecord(lifecycle.noProductsValidation);
  const archiveCandidate = readRecord(lifecycle.archiveCandidate);
  return {
    lifecycle,
    noProductsValidation,
    archiveCandidate,
  };
};

const writeCatalogLifecycle = (metadata: JsonRecord, patch: JsonRecord) => {
  const current = readRecord(metadata.catalog_lifecycle);
  return {
    ...metadata,
    catalog_lifecycle: {
      ...current,
      ...patch,
    },
  };
};

const updateNoProductsValidation = (metadata: JsonRecord, params: {
  runId: string | null;
  nowIso: string;
  clear?: boolean;
}) => {
  const { noProductsValidation } = readArchiveLifecycle(metadata);
  if (params.clear) {
    const lifecycle = readRecord(metadata.catalog_lifecycle);
    const nextLifecycle = { ...lifecycle };
    delete nextLifecycle.noProductsValidation;
    delete nextLifecycle.archiveCandidate;
    return {
      ...metadata,
      catalog_lifecycle: nextLifecycle,
    };
  }

  const validationsRaw = Number(noProductsValidation.validations ?? 0);
  const validations = Number.isFinite(validationsRaw) ? Math.max(0, Math.floor(validationsRaw)) : 0;
  const firstValidatedAt =
    typeof noProductsValidation.firstValidatedAt === "string"
      ? noProductsValidation.firstValidatedAt
      : params.nowIso;

  return writeCatalogLifecycle(metadata, {
    noProductsValidation: {
      firstValidatedAt,
      lastValidatedAt: params.nowIso,
      validations: validations + 1,
      lastRunId: params.runId,
      policyVersion: ARCHIVE_POLICY_VERSION,
    },
  });
};

const setArchiveCandidateSnapshot = (metadata: JsonRecord, params: {
  reason: ArchiveCandidateReason;
  confidence: number;
  firstDetectedAt: string;
  lastValidatedAt: string;
  nextCheckAt: string | null;
  evidenceSummary: JsonRecord;
}) => {
  return writeCatalogLifecycle(metadata, {
    archiveCandidate: {
      reason: params.reason,
      confidence: params.confidence,
      firstDetectedAt: params.firstDetectedAt,
      lastValidatedAt: params.lastValidatedAt,
      nextCheckAt: params.nextCheckAt,
      evidenceSummary: params.evidenceSummary,
      policyVersion: ARCHIVE_POLICY_VERSION,
    },
  });
};

const clearArchiveCandidateSnapshot = (metadata: JsonRecord) => {
  const lifecycle = readRecord(metadata.catalog_lifecycle);
  const nextLifecycle = { ...lifecycle };
  delete nextLifecycle.archiveCandidate;
  return {
    ...metadata,
    catalog_lifecycle: nextLifecycle,
  };
};

const computeConfidence = (...values: number[]) => {
  if (!values.length) return 0;
  const cleaned = values
    .map((value) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0))
    .filter((value) => Number.isFinite(value));
  if (!cleaned.length) return 0;
  return cleaned.reduce((acc, value) => acc + value, 0) / cleaned.length;
};

export type ArchiveCandidateReason = "404_real" | "no_products_validated";

export type ArchiveCandidateRecord = {
  brandId: string;
  brandName: string;
  reason: ArchiveCandidateReason;
  confidence: number;
  qualified: boolean;
  archived: boolean;
  evidence: JsonRecord;
  firstDetectedAt: string;
  lastValidatedAt: string;
  nextCheckAt: string | null;
  runId: string | null;
  runStatus: string | null;
  skippedReason?: string;
};

export type EvaluateArchiveCandidatesParams = {
  dryRun?: boolean;
  scope?: "all" | "brand";
  brandId?: string | null;
  reasons?: ArchiveCandidateReason[];
  limit?: number;
  createdBy?: string | null;
};

export type EvaluateArchiveCandidatesResult = {
  dryRun: boolean;
  evaluated: number;
  qualified: number;
  archived: number;
  skipped: number;
  records: ArchiveCandidateRecord[];
};

export type ApplyBrandArchiveResult = {
  archived: boolean;
  skippedReason: string | null;
  eventId: string | null;
  brandId: string;
  reason: ArchiveCandidateReason;
  productArchivedCount: number;
  catalogRunsClosed: number;
  enrichmentRunsClosed: number;
  catalogItemsClosed: number;
  enrichmentItemsClosed: number;
  queueJobsRemoved: {
    catalog: number;
    enrichment: number;
  };
};

const cleanupQueueJobs = async (params: { catalogItemIds: string[]; enrichmentItemIds: string[] }) => {
  let removedCatalog = 0;
  let removedEnrichment = 0;

  for (const ids of chunk(params.catalogItemIds, 100)) {
    const results = await Promise.all(ids.map((id) => removeCatalogJobByItemId(id)));
    removedCatalog += results.filter(Boolean).length;
  }
  for (const ids of chunk(params.enrichmentItemIds, 100)) {
    const results = await Promise.all(ids.map((id) => removeEnrichmentJobByItemId(id)));
    removedEnrichment += results.filter(Boolean).length;
  }

  return {
    catalog: removedCatalog,
    enrichment: removedEnrichment,
  };
};

export const applyBrandArchive = async (params: {
  brandId: string;
  reason: ArchiveCandidateReason;
  evidence: JsonRecord;
  createdBy?: string | null;
}): Promise<ApplyBrandArchiveResult> => {
  const now = new Date();
  const nowIso = now.toISOString();

  const result = await prisma.$transaction(async (tx) => {
    const brand = await tx.brand.findUnique({
      where: { id: params.brandId },
      select: {
        id: true,
        name: true,
        isActive: true,
        metadata: true,
      },
    });

    if (!brand) {
      return {
        archived: false,
        skippedReason: "brand_not_found",
        eventId: null,
        brandId: params.brandId,
        reason: params.reason,
        productArchivedCount: 0,
        catalogRunsClosed: 0,
        enrichmentRunsClosed: 0,
        catalogItemsClosed: 0,
        enrichmentItemsClosed: 0,
        catalogItemIds: [] as string[],
        enrichmentItemIds: [] as string[],
      };
    }

    if (!brand.isActive) {
      return {
        archived: false,
        skippedReason: "already_inactive",
        eventId: null,
        brandId: params.brandId,
        reason: params.reason,
        productArchivedCount: 0,
        catalogRunsClosed: 0,
        enrichmentRunsClosed: 0,
        catalogItemsClosed: 0,
        enrichmentItemsClosed: 0,
        catalogItemIds: [] as string[],
        enrichmentItemIds: [] as string[],
      };
    }

    const catalogRunnableItems = await tx.catalogItem.findMany({
      where: {
        run: { brandId: brand.id },
        status: { in: ["pending", "queued", "in_progress"] },
      },
      select: { id: true },
    });
    const enrichmentRunnableItems = await tx.productEnrichmentItem.findMany({
      where: {
        run: { brandId: brand.id },
        status: { in: ["pending", "queued", "in_progress"] },
      },
      select: { id: true },
    });

    const [catalogRunsFailed, catalogRunsStopped, enrichmentRunsFailed, enrichmentRunsStopped] =
      await Promise.all([
        tx.catalogRun.updateMany({
          where: { brandId: brand.id, status: { in: ["processing", "blocked"] } },
          data: {
            status: "failed",
            lastError: `brand_archived:${params.reason}`,
            blockReason: `brand_archived:${params.reason}`,
            finishedAt: now,
            updatedAt: now,
          },
        }),
        tx.catalogRun.updateMany({
          where: { brandId: brand.id, status: { in: ["paused", "stopped"] } },
          data: {
            status: "stopped",
            blockReason: `brand_archived:${params.reason}`,
            finishedAt: now,
            updatedAt: now,
          },
        }),
        tx.productEnrichmentRun.updateMany({
          where: { brandId: brand.id, status: { in: ["processing", "blocked"] } },
          data: {
            status: "failed",
            lastError: `brand_archived:${params.reason}`,
            blockReason: `brand_archived:${params.reason}`,
            finishedAt: now,
            updatedAt: now,
          },
        }),
        tx.productEnrichmentRun.updateMany({
          where: { brandId: brand.id, status: { in: ["paused", "stopped"] } },
          data: {
            status: "stopped",
            blockReason: `brand_archived:${params.reason}`,
            finishedAt: now,
            updatedAt: now,
          },
        }),
      ]);

    const [catalogItemsClosed, enrichmentItemsClosed, archivedProducts] = await Promise.all([
      tx.catalogItem.updateMany({
        where: {
          run: { brandId: brand.id },
          status: { in: ["pending", "queued", "in_progress"] },
        },
        data: {
          status: "failed",
          attempts: CATALOG_MAX_ATTEMPTS,
          lastError: `brand_archived:${params.reason}`,
          lastStage: "brand_archived",
          startedAt: null,
          updatedAt: now,
          completedAt: now,
        },
      }),
      tx.productEnrichmentItem.updateMany({
        where: {
          run: { brandId: brand.id },
          status: { in: ["pending", "queued", "in_progress"] },
        },
        data: {
          status: "failed",
          attempts: Math.max(5, Number(process.env.PRODUCT_ENRICHMENT_MAX_ATTEMPTS ?? 5)),
          lastError: `brand_archived:${params.reason}`,
          lastStage: "brand_archived",
          startedAt: null,
          updatedAt: now,
          completedAt: now,
        },
      }),
      tx.product.updateMany({
        where: { brandId: brand.id },
        data: {
          status: "archived",
          updatedAt: now,
        },
      }),
    ]);

    const metadata = readRecord(brand.metadata);
    const lifecycle = readRecord(metadata.catalog_lifecycle);
    const nextLifecycle = {
      ...lifecycle,
      status: "archived",
      archivedAt: nowIso,
      archiveReason: params.reason,
      archivePolicyVersion: ARCHIVE_POLICY_VERSION,
      archiveEvidenceSummary: {
        reason: params.reason,
        runId: params.evidence.runId ?? null,
        confidence: params.evidence.confidence ?? null,
      },
    };
    delete (nextLifecycle as Record<string, unknown>).archiveCandidate;

    const event = await tx.brandArchiveEvent.create({
      data: {
        brandId: brand.id,
        reason: params.reason,
        evidenceJson: toJson(params.evidence),
        policyVersion: ARCHIVE_POLICY_VERSION,
        createdBy: params.createdBy ?? null,
      },
      select: { id: true },
    });

    await tx.brand.update({
      where: { id: brand.id },
      data: {
        isActive: false,
        manualReview: true,
        metadata: toJson({
          ...metadata,
          catalog_lifecycle: {
            ...nextLifecycle,
            lastArchiveEventId: event.id,
          },
        }),
      },
    });

    return {
      archived: true,
      skippedReason: null,
      eventId: event.id,
      brandId: brand.id,
      reason: params.reason,
      productArchivedCount: archivedProducts.count,
      catalogRunsClosed: catalogRunsFailed.count + catalogRunsStopped.count,
      enrichmentRunsClosed: enrichmentRunsFailed.count + enrichmentRunsStopped.count,
      catalogItemsClosed: catalogItemsClosed.count,
      enrichmentItemsClosed: enrichmentItemsClosed.count,
      catalogItemIds: catalogRunnableItems.map((item) => item.id),
      enrichmentItemIds: enrichmentRunnableItems.map((item) => item.id),
    };
  });

  if (!result.archived) {
    return {
      archived: false,
      skippedReason: result.skippedReason,
      eventId: result.eventId,
      brandId: result.brandId,
      reason: result.reason,
      productArchivedCount: 0,
      catalogRunsClosed: 0,
      enrichmentRunsClosed: 0,
      catalogItemsClosed: 0,
      enrichmentItemsClosed: 0,
      queueJobsRemoved: { catalog: 0, enrichment: 0 },
    };
  }

  const removed = await cleanupQueueJobs({
    catalogItemIds: result.catalogItemIds,
    enrichmentItemIds: result.enrichmentItemIds,
  });

  return {
    archived: true,
    skippedReason: null,
    eventId: result.eventId,
    brandId: result.brandId,
    reason: result.reason,
    productArchivedCount: result.productArchivedCount,
    catalogRunsClosed: result.catalogRunsClosed,
    enrichmentRunsClosed: result.enrichmentRunsClosed,
    catalogItemsClosed: result.catalogItemsClosed,
    enrichmentItemsClosed: result.enrichmentItemsClosed,
    queueJobsRemoved: removed,
  };
};

type BrandCandidateRow = {
  brandId: string;
  brandName: string;
  slug: string;
  siteUrl: string;
  metadata: unknown;
  manualReview: boolean;
  runId: string | null;
  runStatus: string | null;
  runUpdatedAt: Date | null;
  runTotalItems: number | null;
  runLastError: string | null;
  runBlockReason: string | null;
};

const loadRunItemStats = async (runId: string) => {
  const [row] = await prisma.$queryRaw<
    Array<{
      completed: number;
      failed: number;
      runnable: number;
      failed404: number;
      failedNoProducts: number;
    }>
  >(
    Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status IN ('pending', 'queued', 'in_progress'))::int AS runnable,
        COUNT(*) FILTER (
          WHERE status = 'failed'
            AND (
              LOWER(COALESCE("lastError", '')) LIKE '%status=404%'
              OR LOWER(COALESCE("lastError", '')) LIKE '%status 404%'
              OR LOWER(COALESCE("lastError", '')) LIKE '%status=410%'
              OR LOWER(COALESCE("lastError", '')) LIKE '%status 410%'
              OR LOWER(COALESCE("lastError", '')) LIKE '%no se pudo obtener html (404)%'
              OR LOWER(COALESCE("lastError", '')) LIKE '%not found%'
            )
        )::int AS "failed404",
        COUNT(*) FILTER (
          WHERE status = 'failed'
            AND (
              LOWER(COALESCE("lastError", '')) LIKE '%manual_review_no_products%'
              OR LOWER(COALESCE("lastError", '')) LIKE '%manual_review_vtex_no_products%'
              OR LOWER(COALESCE("lastError", '')) LIKE '%no_refs%'
            )
        )::int AS "failedNoProducts"
      FROM "catalog_items"
      WHERE "runId" = ${runId}
    `,
  );

  return {
    completed: row?.completed ?? 0,
    failed: row?.failed ?? 0,
    runnable: row?.runnable ?? 0,
    failed404: row?.failed404 ?? 0,
    failedNoProducts: row?.failedNoProducts ?? 0,
  };
};

const selectCandidateBrands = async (params: {
  scope: "all" | "brand";
  brandId?: string | null;
  limit: number;
}) => {
  const effectiveLimit = Math.max(params.limit * 4, params.limit);
  return prisma.$queryRaw<BrandCandidateRow[]>(
    Prisma.sql`
      SELECT
        b.id AS "brandId",
        b.name AS "brandName",
        b.slug,
        b."siteUrl" AS "siteUrl",
        b.metadata AS metadata,
        b."manualReview" AS "manualReview",
        lr.id AS "runId",
        lr.status AS "runStatus",
        lr."updatedAt" AS "runUpdatedAt",
        lr."totalItems"::int AS "runTotalItems",
        lr."lastError" AS "runLastError",
        lr."blockReason" AS "runBlockReason"
      FROM "brands" b
      LEFT JOIN LATERAL (
        SELECT
          cr.id,
          cr.status,
          cr."updatedAt",
          cr."totalItems",
          cr."lastError",
          cr."blockReason"
        FROM "catalog_runs" cr
        WHERE cr."brandId" = b.id
        ORDER BY cr."updatedAt" DESC
        LIMIT 1
      ) lr ON true
      WHERE b."isActive" = true
        AND b."siteUrl" IS NOT NULL
        AND (
          ${params.scope === "brand" ? Prisma.sql`b.id = ${params.brandId ?? ""}` : Prisma.sql`TRUE`}
        )
        AND (
          COALESCE(lr.status, '') IN ('failed', 'blocked', 'processing')
          OR COALESCE((b.metadata->'catalog_refresh'->>'lastStatus'), '') IN ('failed', 'blocked', 'processing')
          OR b."manualReview" = true
        )
      ORDER BY COALESCE(lr."updatedAt", b."updatedAt") DESC
      LIMIT ${effectiveLimit}
    `,
  );
};

const persistCandidateMetadata = async (brandId: string, metadata: JsonRecord) => {
  await prisma.brand.update({
    where: { id: brandId },
    data: {
      metadata: toJson(metadata),
    },
  });
};

export const evaluateArchiveCandidates = async (
  params: EvaluateArchiveCandidatesParams = {},
): Promise<EvaluateArchiveCandidatesResult> => {
  const dryRun = params.dryRun ?? true;
  const scope = params.scope ?? (params.brandId ? "brand" : "all");
  const limit = Math.max(1, Math.min(200, Number(params.limit ?? 50)));
  const reasons = new Set<ArchiveCandidateReason>(
    (params.reasons?.length ? params.reasons : ["404_real", "no_products_validated"]).filter(
      (reason): reason is ArchiveCandidateReason =>
        reason === "404_real" || reason === "no_products_validated",
    ),
  );

  const rows = await selectCandidateBrands({ scope, brandId: params.brandId, limit });
  const now = new Date();
  const nowIso = now.toISOString();

  const records: ArchiveCandidateRecord[] = [];
  let qualified = 0;
  let archived = 0;
  let skipped = 0;
  let evaluated = 0;

  for (const row of rows) {
    if (records.length >= limit) break;
    evaluated += 1;

    const metadata = readRecord(row.metadata);
    const refresh = readRecord(metadata.catalog_refresh);
    const extractFinished = readRecord(metadata.catalog_extract_finished);
    const extractReview = readRecord(metadata.catalog_extract_review);
    const lifecycle = readArchiveLifecycle(metadata);

    const runTotalItems = typeof row.runTotalItems === "number" ? row.runTotalItems : 0;
    const runStatus = row.runStatus ?? (typeof refresh.lastStatus === "string" ? refresh.lastStatus : null);
    const runId = row.runId;

    const itemStats = runId
      ? await loadRunItemStats(runId)
      : {
          completed: 0,
          failed: 0,
          runnable: 0,
          failed404: 0,
          failedNoProducts: 0,
        };

    const rootProbe = await probeRoot(row.siteUrl);
    const processedItems = itemStats.completed + itemStats.failed;
    const failed404Ratio = processedItems > 0 ? itemStats.failed404 / processedItems : 0;

    let selectedReason: ArchiveCandidateReason | null = null;
    let evidence: JsonRecord = {};
    let confidence = 0;
    let nextCheckAt: string | null = null;
    let firstDetectedAt = nowIso;
    let lastValidatedAt = nowIso;

    if (reasons.has("404_real") && runId) {
      const sampleUrls = await listFailed404Urls(runId, ARCHIVE_404_RECHECK_SAMPLE_LIMIT);
      const sampleProbe = await probe404Sample(sampleUrls);
      const real404Qualified =
        runTotalItems >= ARCHIVE_404_MIN_ITEMS &&
        itemStats.completed === 0 &&
        failed404Ratio >= ARCHIVE_404_MIN_RATIO &&
        rootProbe.ok2xx3xx &&
        sampleProbe.total > 0 &&
        sampleProbe.ratio >= ARCHIVE_404_RECHECK_MIN_RATIO;

      if (real404Qualified) {
        selectedReason = "404_real";
        confidence = computeConfidence(
          failed404Ratio,
          sampleProbe.ratio,
          rootProbe.ok2xx3xx ? 1 : 0,
        );
        evidence = {
          runId,
          runStatus,
          policyVersion: ARCHIVE_POLICY_VERSION,
          runTotalItems,
          completed: itemStats.completed,
          failed: itemStats.failed,
          failed404: itemStats.failed404,
          failed404Ratio,
          rootProbe,
          sampleProbe,
        };
      }
    }

    if (!selectedReason && reasons.has("no_products_validated")) {
      const noProductsSignal = isNoProductsSignal({
        runLastError: row.runLastError,
        runBlockReason: row.runBlockReason,
        refreshLastError:
          typeof refresh.lastError === "string" ? (refresh.lastError as string) : null,
        refreshStatus:
          typeof refresh.lastStatus === "string" ? (refresh.lastStatus as string) : null,
        extractFinishedReason:
          typeof extractFinished.reason === "string" ? (extractFinished.reason as string) : null,
        extractReviewReason:
          typeof extractReview.reason === "string" ? (extractReview.reason as string) : null,
        runTotalItems,
      });

      if (noProductsSignal && rootProbe.ok2xx3xx) {
        const discovery = await discoverCatalogRefs({
          brand: {
            id: row.brandId,
            name: row.brandName,
            slug: row.slug,
            siteUrl: row.siteUrl,
            ecommercePlatform: typeof refresh.platform === "string" ? (refresh.platform as string) : null,
          },
          limit: ARCHIVE_NO_PRODUCTS_DISCOVERY_LIMIT,
          forceSitemap: true,
          combineSitemapAndAdapter: true,
          sitemapBudgetMs: Math.max(2_000, HTTP_PROBE_TIMEOUT_MS),
        });

        const sitemapProbe = await probeSitemapHealth(row.siteUrl);
        const refsFound = discovery.refs.length;
        const candidateNow = refsFound === 0 && sitemapProbe.healthy;

        const firstValidationAt = parseDate(lifecycle.noProductsValidation.firstValidatedAt);
        const previousValidationsRaw = Number(lifecycle.noProductsValidation.validations ?? 0);
        const previousValidations = Number.isFinite(previousValidationsRaw)
          ? Math.max(0, Math.floor(previousValidationsRaw))
          : 0;
        const hoursSinceFirst = firstValidationAt
          ? (now.getTime() - firstValidationAt.getTime()) / (60 * 60 * 1000)
          : 0;

        const qualifiedNoProducts =
          candidateNow &&
          previousValidations + 1 >= ARCHIVE_NO_PRODUCTS_MIN_VALIDATIONS &&
          Boolean(firstValidationAt) &&
          hoursSinceFirst >= ARCHIVE_NO_PRODUCTS_MIN_VALIDATION_HOURS;

        if (candidateNow) {
          selectedReason = "no_products_validated";
          confidence = computeConfidence(
            rootProbe.ok2xx3xx ? 1 : 0,
            sitemapProbe.healthy ? 1 : 0,
            refsFound === 0 ? 1 : 0,
          );
          firstDetectedAt = firstValidationAt?.toISOString() ?? nowIso;
          lastValidatedAt = nowIso;
          nextCheckAt = qualifiedNoProducts
            ? null
            : new Date(
                (firstValidationAt ?? now).getTime() +
                  ARCHIVE_NO_PRODUCTS_MIN_VALIDATION_HOURS * 60 * 60 * 1000,
              ).toISOString();
          evidence = {
            runId,
            runStatus,
            policyVersion: ARCHIVE_POLICY_VERSION,
            noProductsSignal,
            refsFound,
            discovery: {
              adapterPlatform: discovery.adapterPlatform,
              platformForRun: discovery.platformForRun,
              sitemapRefs: discovery.sitemapRefs.length,
              adapterRefs: discovery.adapterRefs.length,
            },
            rootProbe,
            sitemapProbe,
            validation: {
              firstValidatedAt: firstDetectedAt,
              lastValidatedAt,
              previousValidations,
              nextValidationDueAt: nextCheckAt,
              minValidations: ARCHIVE_NO_PRODUCTS_MIN_VALIDATIONS,
              minHours: ARCHIVE_NO_PRODUCTS_MIN_VALIDATION_HOURS,
            },
            qualifiedNoProducts,
          };
        } else if (!dryRun) {
          const cleared = updateNoProductsValidation(metadata, {
            runId,
            nowIso,
            clear: true,
          });
          await persistCandidateMetadata(row.brandId, cleared);
        }
      }
    }

    if (!selectedReason) {
      skipped += 1;
      if (!dryRun) {
        const cleared = clearArchiveCandidateSnapshot(metadata);
        await persistCandidateMetadata(row.brandId, cleared);
      }
      continue;
    }

    const record: ArchiveCandidateRecord = {
      brandId: row.brandId,
      brandName: row.brandName,
      reason: selectedReason,
      confidence,
      qualified: selectedReason === "404_real" || evidence.qualifiedNoProducts === true,
      archived: false,
      evidence,
      firstDetectedAt,
      lastValidatedAt,
      nextCheckAt,
      runId,
      runStatus,
    };

    if (selectedReason === "no_products_validated") {
      const maybeQualified = evidence.qualifiedNoProducts === true;
      record.qualified = maybeQualified;

      if (!dryRun) {
        const nextMetadata = updateNoProductsValidation(metadata, {
          runId,
          nowIso,
        });
        const withCandidate = setArchiveCandidateSnapshot(nextMetadata, {
          reason: selectedReason,
          confidence,
          firstDetectedAt,
          lastValidatedAt,
          nextCheckAt,
          evidenceSummary: {
            refsFound: evidence.refsFound,
            firstDetectedAt,
            lastValidatedAt,
            nextCheckAt,
          },
        });
        await persistCandidateMetadata(row.brandId, withCandidate);
      }
    }

    if (selectedReason === "404_real" && !dryRun) {
      const withCandidate = setArchiveCandidateSnapshot(metadata, {
        reason: selectedReason,
        confidence,
        firstDetectedAt: nowIso,
        lastValidatedAt: nowIso,
        nextCheckAt: null,
        evidenceSummary: {
          failed404Ratio,
          runTotalItems,
          sampleCount: (evidence.sampleProbe as { total?: number } | undefined)?.total ?? 0,
        },
      });
      await persistCandidateMetadata(row.brandId, withCandidate);
    }

    if (record.qualified) {
      qualified += 1;
      if (!dryRun) {
        const archiveResult = await applyBrandArchive({
          brandId: row.brandId,
          reason: selectedReason,
          evidence: {
            ...evidence,
            confidence,
            archivedAt: nowIso,
          },
          createdBy: params.createdBy ?? "catalog_refresh",
        });
        record.archived = archiveResult.archived;
        if (!archiveResult.archived) {
          record.skippedReason = archiveResult.skippedReason ?? "archive_failed";
        } else {
          archived += 1;
        }
      }
    } else {
      skipped += 1;
      record.skippedReason = "awaiting_second_validation";
    }

    records.push(record);
  }

  return {
    dryRun,
    evaluated,
    qualified,
    archived,
    skipped,
    records,
  };
};
