import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runBrandScrapeJobV2 } from "@/lib/brand-scrape";
import { profileBrandTechnology } from "@/lib/brand-tech-profiler";
import { discoverCatalogRefs } from "@/lib/catalog/discovery";
import { enqueueCatalogItems, isCatalogQueueEnabled } from "@/lib/catalog/queue";
import {
  createRunWithItems as createCatalogRun,
  findActiveRun as findActiveCatalogRun,
  findLatestRun as findLatestCatalogRun,
  listPendingItems as listPendingCatalogItems,
  markItemsQueued as markCatalogItemsQueued,
  resetQueuedItems as resetCatalogQueuedItems,
  resetStuckItems as resetCatalogStuckItems,
  summarizeRun as summarizeCatalogRun,
  type CatalogRunSummary,
} from "@/lib/catalog/run-store";
import { drainCatalogRun } from "@/lib/catalog/processor";
import { enqueueEnrichmentItems, isEnrichmentQueueEnabled } from "@/lib/product-enrichment/queue";
import {
  createRunWithItems as createEnrichmentRun,
  findActiveRun as findActiveEnrichmentRun,
  findLatestRun as findLatestEnrichmentRun,
  listPendingItems as listPendingEnrichmentItems,
  markItemsQueued as markEnrichmentItemsQueued,
  resetQueuedItems as resetEnrichmentQueuedItems,
  resetStuckItems as resetEnrichmentStuckItems,
  summarizeRun as summarizeEnrichmentRun,
  type EnrichmentRunSummary,
} from "@/lib/product-enrichment/run-store";
import { drainEnrichmentRun } from "@/lib/product-enrichment/processor";

export type OnboardingStepKey =
  | "brand_enrich"
  | "tech_profile"
  | "catalog_extract"
  | "product_enrich";

export type OnboardingStepStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "blocked";

export type OnboardingStatus =
  | "idle"
  | "processing"
  | "completed"
  | "failed"
  | "blocked";

export type OnboardingStepInfo = {
  status: OnboardingStepStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
  jobId?: string | null;
  runId?: string | null;
  detail?: Prisma.JsonValue | null;
};

export type OnboardingState = {
  status: OnboardingStatus;
  step: OnboardingStepKey | null;
  steps: Record<OnboardingStepKey, OnboardingStepInfo>;
  updatedAt: string;
};

export type OnboardingProgress = {
  brandEnrich?: {
    jobStatus?: string | null;
    changes?: number;
    jobId?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  };
  techProfile?: {
    platform?: string | null;
    confidence?: number | null;
    risks?: string[];
  };
  catalog?: CatalogRunSummary | null;
  productEnrichment?: {
    summary?: EnrichmentRunSummary | null;
    counts?: {
      total: number;
      enriched: number;
      remaining: number;
    };
  };
};

type OnboardingResult = {
  onboarding: OnboardingState;
  progress: OnboardingProgress;
  brand: {
    id: string;
    name: string;
    ecommercePlatform: string | null;
    manualReview: boolean;
  };
};

const STEP_ORDER: OnboardingStepKey[] = [
  "brand_enrich",
  "tech_profile",
  "catalog_extract",
  "product_enrich",
];

const STEP_LABELS: Record<OnboardingStepKey, string> = {
  brand_enrich: "Enriquecimiento de marca",
  tech_profile: "Tech profiler",
  catalog_extract: "Extracción de catálogo",
  product_enrich: "Enriquecimiento de productos",
};

const allowedStepStatuses = new Set<OnboardingStepStatus>([
  "pending",
  "processing",
  "completed",
  "failed",
  "blocked",
]);

const allowedStatuses = new Set<OnboardingStatus>([
  "idle",
  "processing",
  "completed",
  "failed",
  "blocked",
]);

const createEmptySteps = (): Record<OnboardingStepKey, OnboardingStepInfo> => ({
  brand_enrich: { status: "pending" },
  tech_profile: { status: "pending" },
  catalog_extract: { status: "pending" },
  product_enrich: { status: "pending" },
});

export const createIdleOnboarding = (): OnboardingState => ({
  status: "idle",
  step: null,
  steps: createEmptySteps(),
  updatedAt: new Date().toISOString(),
});

export const normalizeOnboarding = (raw: unknown): OnboardingState => {
  const base = createIdleOnboarding();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const parsed = raw as Partial<OnboardingState> & { steps?: Record<string, OnboardingStepInfo> };
  const status = allowedStatuses.has(parsed.status as OnboardingStatus)
    ? (parsed.status as OnboardingStatus)
    : base.status;
  const step = STEP_ORDER.includes(parsed.step as OnboardingStepKey)
    ? (parsed.step as OnboardingStepKey)
    : base.step;
  const steps = createEmptySteps();
  if (parsed.steps && typeof parsed.steps === "object") {
    STEP_ORDER.forEach((key) => {
      const candidate = parsed.steps?.[key];
      if (!candidate || typeof candidate !== "object") return;
      const statusCandidate = allowedStepStatuses.has(candidate.status)
        ? candidate.status
        : steps[key].status;
      steps[key] = {
        ...candidate,
        status: statusCandidate,
      };
    });
  }
  return {
    status,
    step,
    steps,
    updatedAt: parsed.updatedAt ?? base.updatedAt,
  };
};

const getMetadataObject = (metadata: unknown) => {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
};

const persistOnboarding = async (
  brandId: string,
  onboarding: OnboardingState,
  metadataPatch?: Record<string, unknown>,
) => {
  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { metadata: true },
  });
  const base = getMetadataObject(brand?.metadata);
  const onboardingPayload = JSON.parse(
    JSON.stringify(onboarding),
  ) as Prisma.InputJsonValue;
  const nextMetadata: Prisma.InputJsonValue = {
    ...base,
    ...(metadataPatch ?? {}),
    onboarding: onboardingPayload,
  };
  await prisma.brand.update({
    where: { id: brandId },
    data: { metadata: nextMetadata },
  });
};

const getNextStep = (current: OnboardingStepKey | null): OnboardingStepKey | null => {
  if (!current) return STEP_ORDER[0];
  const index = STEP_ORDER.indexOf(current);
  if (index < 0) return STEP_ORDER[0];
  return STEP_ORDER[index + 1] ?? null;
};

const shouldBlockTechProfile = (profile: { platform?: string | null; risks?: string[] } | null) => {
  if (!profile) return true;
  if (!profile.platform || profile.platform === "unknown") return true;
  const deleteSignals = new Set([
    "social",
    "bot_protection",
    "unreachable",
    "parked_domain",
    "landing_no_store",
    "no_store",
    "no_pdp_candidates",
    "missing_site_url",
  ]);
  return profile.risks?.some((risk) => deleteSignals.has(risk)) ?? false;
};

const updateOverallStatus = (state: OnboardingState) => {
  if (STEP_ORDER.every((key) => state.steps[key].status === "completed")) {
    state.status = "completed";
    state.step = null;
    return;
  }
  const blockedStep = STEP_ORDER.find((key) => state.steps[key].status === "blocked");
  if (blockedStep) {
    state.status = "blocked";
    state.step = blockedStep;
    return;
  }
  const failedStep = STEP_ORDER.find((key) => state.steps[key].status === "failed");
  if (failedStep) {
    state.status = "failed";
    state.step = failedStep;
    return;
  }
  state.status = "processing";
};

const pickActiveStep = (state: OnboardingState) => {
  const processing = STEP_ORDER.find((key) => state.steps[key].status === "processing");
  if (processing) return processing;
  const pending = STEP_ORDER.find((key) => state.steps[key].status === "pending");
  return pending ?? null;
};

const refreshBrandEnrichStep = async (brandId: string, state: OnboardingState, progress: OnboardingProgress) => {
  const step = state.steps.brand_enrich;
  let jobId = step.jobId ?? null;
  if (!jobId) {
    const latestJob = await prisma.brandScrapeJob.findFirst({
      where: { brandId },
      orderBy: { createdAt: "desc" },
    });
    if (latestJob) {
      jobId = latestJob.id;
      step.jobId = jobId;
    }
  }
  if (!jobId) return;
  const job = await prisma.brandScrapeJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  progress.brandEnrich = {
    jobStatus: job.status,
    changes: Array.isArray((job.result as any)?.changes) ? (job.result as any)?.changes?.length ?? 0 : 0,
    jobId: job.id,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
  if (job.status === "queued" || job.status === "processing") {
    step.status = "processing";
    step.startedAt = job.startedAt?.toISOString() ?? step.startedAt ?? new Date().toISOString();
    step.error = null;
  }
  if (job.status === "completed") {
    step.status = "completed";
    step.finishedAt = job.finishedAt?.toISOString() ?? new Date().toISOString();
    step.error = null;
  }
  if (job.status === "failed") {
    step.status = "failed";
    step.finishedAt = job.finishedAt?.toISOString() ?? new Date().toISOString();
    step.error = job.lastError ?? "brand_enrich_failed";
  }
};

const startBrandEnrichStep = async (brandId: string, state: OnboardingState) => {
  const step = state.steps.brand_enrich;
  const inProgress = await prisma.brandScrapeJob.findFirst({
    where: { brandId, status: { in: ["queued", "processing"] } },
    orderBy: { createdAt: "desc" },
  });
  if (inProgress) {
    step.status = "processing";
    step.startedAt = inProgress.startedAt?.toISOString() ?? new Date().toISOString();
    step.jobId = inProgress.id;
    return;
  }

  const job = await prisma.brandScrapeJob.create({
    data: {
      brandId,
      status: "processing",
      startedAt: new Date(),
      attempts: 1,
      result: { method: "onboarding" } as Prisma.InputJsonValue,
    },
  });
  step.status = "processing";
  step.startedAt = job.startedAt?.toISOString() ?? new Date().toISOString();
  step.jobId = job.id;
  await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });

  try {
    const result = await runBrandScrapeJobV2(brandId);
    await prisma.brandScrapeJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        result: {
          method: "onboarding",
          brandId: result.updated.id,
          brandName: result.updated.name,
          changes: result.changes ?? [],
          before: result.before ?? null,
          after: result.after ?? null,
          sources: result.enrichment.sources ?? null,
          searchSources: result.enrichment.searchSources ?? null,
          evidenceSources: result.enrichment.evidenceSources ?? null,
          usage: result.enrichment.usage ?? null,
        } as Prisma.InputJsonValue,
      },
    });
    step.status = "completed";
    step.finishedAt = new Date().toISOString();
    step.error = null;
  } catch (error) {
    await prisma.brandScrapeJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        lastError: String(error),
        result: {
          method: "onboarding",
          error: String(error),
        } as Prisma.InputJsonValue,
      },
    });
    step.status = "failed";
    step.finishedAt = new Date().toISOString();
    step.error = String(error);
  }

  await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });
};

const startTechProfileStep = async (brandId: string, state: OnboardingState) => {
  const step = state.steps.tech_profile;
  step.status = "processing";
  step.startedAt = new Date().toISOString();
  await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });

  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { id: true, name: true, siteUrl: true, manualReview: true, metadata: true },
  });
  if (!brand) {
    step.status = "failed";
    step.error = "brand_not_found";
    step.finishedAt = new Date().toISOString();
    await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });
    return;
  }
  if (!brand.siteUrl) {
    step.status = "blocked";
    step.error = "missing_site_url";
    step.finishedAt = new Date().toISOString();
    await prisma.brand.update({
      where: { id: brandId },
      data: { manualReview: true },
    });
    await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });
    return;
  }

  try {
    const profile = await profileBrandTechnology({ siteUrl: brand.siteUrl } as any);
    const metadataBase = getMetadataObject(brand.metadata);
    const nextMetadata = {
      ...metadataBase,
      tech_profile: {
        ...profile,
        capturedAt: new Date().toISOString(),
      },
    } as Prisma.InputJsonValue;
    const blocked = shouldBlockTechProfile(profile);
    await prisma.brand.update({
      where: { id: brandId },
      data: {
        ecommercePlatform: profile.platform ?? null,
        manualReview: blocked ? true : brand.manualReview,
        metadata: nextMetadata,
      },
    });
    step.status = blocked ? "blocked" : "completed";
    step.error = blocked ? `tech_profile_blocked:${profile.platform ?? "unknown"}` : null;
    step.finishedAt = new Date().toISOString();
    await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });
  } catch (error) {
    step.status = "failed";
    step.error = error instanceof Error ? error.message : String(error);
    step.finishedAt = new Date().toISOString();
    await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });
  }
};

const startCatalogExtractStep = async (brandId: string, state: OnboardingState) => {
  const step = state.steps.catalog_extract;
  step.status = "processing";
  step.startedAt = new Date().toISOString();
  await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });

  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: {
      id: true,
      name: true,
      slug: true,
      siteUrl: true,
      ecommercePlatform: true,
      manualReview: true,
      metadata: true,
    },
  });
  if (!brand) {
    step.status = "failed";
    step.error = "brand_not_found";
    step.finishedAt = new Date().toISOString();
    await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });
    return;
  }
  if (!brand.siteUrl) {
    step.status = "blocked";
    step.error = "missing_site_url";
    step.finishedAt = new Date().toISOString();
    await prisma.brand.update({
      where: { id: brandId },
      data: { manualReview: true },
    });
    await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });
    return;
  }
  if (!isCatalogQueueEnabled()) {
    step.status = "blocked";
    step.error = "queue_disabled";
    step.finishedAt = new Date().toISOString();
    await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });
    return;
  }
  const metadata = getMetadataObject(brand.metadata);
  if (metadata.catalog_extract_finished) {
    step.status = "completed";
    step.finishedAt = new Date().toISOString();
    await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });
    return;
  }

  const existing = await findActiveCatalogRun(brandId);
  if (existing) {
    if (existing.status === "blocked") {
      step.status = "blocked";
      step.error = existing.blockReason ?? existing.lastError ?? "catalog_blocked";
      step.finishedAt = new Date().toISOString();
      step.runId = existing.id;
      await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });
      return;
    }
    await prisma.catalogRun.update({
      where: { id: existing.id },
      data: {
        status: "processing",
        consecutiveErrors: 0,
        lastError: null,
        blockReason: null,
        updatedAt: new Date(),
      },
    });
    const queuedStaleMs = Math.max(
      0,
      Number(process.env.CATALOG_QUEUE_STALE_MINUTES ?? 15) * 60 * 1000,
    );
    const stuckMs = Math.max(
      0,
      Number(process.env.CATALOG_ITEM_STUCK_MINUTES ?? 30) * 60 * 1000,
    );
    const resumeStuckMs = Math.max(
      0,
      Number(process.env.CATALOG_RESUME_STUCK_MINUTES ?? 2) * 60 * 1000,
    );
    await resetCatalogQueuedItems(existing.id, queuedStaleMs);
    await resetCatalogStuckItems(existing.id, resumeStuckMs ? Math.min(stuckMs, resumeStuckMs) : stuckMs);
    const enqueueLimit = Math.max(
      1,
      Number(process.env.CATALOG_QUEUE_ENQUEUE_LIMIT ?? 50),
    );
    const pendingItems = await listPendingCatalogItems(
      existing.id,
      Math.max(10, enqueueLimit),
    );
    await markCatalogItemsQueued(pendingItems.map((item) => item.id));
    await enqueueCatalogItems(pendingItems);
    const drainOnRun =
      process.env.CATALOG_DRAIN_ON_RUN !== "false" &&
      process.env.CATALOG_DRAIN_DISABLED !== "true";
    if (drainOnRun) {
      const drainBatchDefault = Number(
        process.env.CATALOG_DRAIN_ON_RUN_BATCH ?? process.env.CATALOG_DRAIN_BATCH ?? 0,
      );
      const drainConcurrencyDefault = Number(
        process.env.CATALOG_DRAIN_ON_RUN_CONCURRENCY ?? process.env.CATALOG_DRAIN_CONCURRENCY ?? 5,
      );
      const drainMaxMsDefault = Number(
        process.env.CATALOG_DRAIN_ON_RUN_MAX_RUNTIME_MS ?? 20000,
      );
      await drainCatalogRun({
        runId: existing.id,
        batch: drainBatchDefault <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, drainBatchDefault),
        concurrency: Math.max(1, drainConcurrencyDefault),
        maxMs: Math.max(1000, drainMaxMsDefault),
        queuedStaleMs,
        stuckMs,
      });
    }
    step.runId = existing.id;
    await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });
    return;
  }

  const forceSitemap = process.env.CATALOG_FORCE_SITEMAP === "true";
  const { refs, platformForRun } = await discoverCatalogRefs({
    brand: {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      siteUrl: brand.siteUrl,
      ecommercePlatform: brand.ecommercePlatform,
    },
    limit: 50,
    forceSitemap,
  });

  if (!refs.length) {
    const run = await prisma.catalogRun.create({
      data: {
        brandId: brand.id,
        status: "blocked",
        platform: platformForRun ?? brand.ecommercePlatform,
        totalItems: 0,
        lastError: "manual_review_no_products",
        blockReason: "manual_review_no_products",
      },
    });
    await prisma.brand.update({
      where: { id: brand.id },
      data: { manualReview: true },
    });
    step.status = "blocked";
    step.error = "manual_review_no_products";
    step.runId = run.id;
    step.finishedAt = new Date().toISOString();
    await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });
    return;
  }

  const run = await createCatalogRun({
    brandId: brand.id,
    platform: platformForRun ?? brand.ecommercePlatform,
    refs,
    status: "processing",
  });
  const enqueueLimit = Math.max(
    1,
    Number(process.env.CATALOG_QUEUE_ENQUEUE_LIMIT ?? 50),
  );
  const items = await listPendingCatalogItems(run.id, Math.max(10, enqueueLimit));
  await markCatalogItemsQueued(items.map((item) => item.id));
  await enqueueCatalogItems(items);
  const drainOnRun =
    process.env.CATALOG_DRAIN_ON_RUN !== "false" &&
    process.env.CATALOG_DRAIN_DISABLED !== "true";
  if (drainOnRun) {
    const drainBatchDefault = Number(
      process.env.CATALOG_DRAIN_ON_RUN_BATCH ?? process.env.CATALOG_DRAIN_BATCH ?? 0,
    );
    const drainConcurrencyDefault = Number(
      process.env.CATALOG_DRAIN_ON_RUN_CONCURRENCY ?? process.env.CATALOG_DRAIN_CONCURRENCY ?? 5,
    );
    const drainMaxMsDefault = Number(
      process.env.CATALOG_DRAIN_ON_RUN_MAX_RUNTIME_MS ?? 20000,
    );
    await drainCatalogRun({
      runId: run.id,
      batch: drainBatchDefault <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, drainBatchDefault),
      concurrency: Math.max(1, drainConcurrencyDefault),
      maxMs: Math.max(1000, drainMaxMsDefault),
      queuedStaleMs: Math.max(
        0,
        Number(process.env.CATALOG_QUEUE_STALE_MINUTES ?? 15) * 60 * 1000,
      ),
      stuckMs: Math.max(
        0,
        Number(process.env.CATALOG_ITEM_STUCK_MINUTES ?? 30) * 60 * 1000,
      ),
    });
  }
  step.runId = run.id;
  await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });
};

const startProductEnrichStep = async (brandId: string, state: OnboardingState) => {
  const step = state.steps.product_enrich;
  step.status = "processing";
  step.startedAt = new Date().toISOString();
  await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });

  if (!isEnrichmentQueueEnabled()) {
    step.status = "blocked";
    step.error = "queue_disabled";
    step.finishedAt = new Date().toISOString();
    await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });
    return;
  }

  const existing = await findActiveEnrichmentRun({ scope: "brand", brandId });
  if (existing) {
    if (existing.status === "blocked") {
      step.status = "blocked";
      step.error = existing.blockReason ?? existing.lastError ?? "product_enrich_blocked";
      step.finishedAt = new Date().toISOString();
      step.runId = existing.id;
      await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });
      return;
    }
    step.runId = existing.id;
    await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });
    return;
  }

  const productRows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "products" WHERE "brandId" = ${brandId}`,
  );
  const productIds = productRows.map((row) => row.id);
  if (!productIds.length) {
    step.status = "blocked";
    step.error = "no_products";
    step.finishedAt = new Date().toISOString();
    await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });
    return;
  }

  const run = await createEnrichmentRun({
    scope: "brand",
    brandId,
    productIds,
    status: "processing",
    metadata: {
      mode: "all",
      created_at: new Date().toISOString(),
    },
  });

  const drainOnRunDefault =
    process.env.PRODUCT_ENRICHMENT_DRAIN_ON_RUN !== "false" &&
    process.env.PRODUCT_ENRICHMENT_DRAIN_DISABLED !== "true";
  const drainBatchDefault = Number(process.env.PRODUCT_ENRICHMENT_DRAIN_BATCH ?? 0);
  const drainConcurrencyDefault = Number(process.env.PRODUCT_ENRICHMENT_DRAIN_CONCURRENCY ?? 20);
  const drainMaxMsDefault = Number(
    process.env.PRODUCT_ENRICHMENT_DRAIN_MAX_RUNTIME_MS ?? 20000,
  );
  const minConcurrency = Math.max(20, drainConcurrencyDefault);
  const enqueueLimit = Math.max(
    minConcurrency,
    Number(process.env.PRODUCT_ENRICHMENT_QUEUE_ENQUEUE_LIMIT ?? 50),
  );

  const items = await listPendingEnrichmentItems(run.id, enqueueLimit);
  await markEnrichmentItemsQueued(items.map((item) => item.id));
  await enqueueEnrichmentItems(items);

  if (drainOnRunDefault) {
    await drainEnrichmentRun({
      runId: run.id,
      batch: drainBatchDefault <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, drainBatchDefault),
      concurrency: Math.max(1, drainConcurrencyDefault),
      maxMs: Math.max(1000, drainMaxMsDefault),
      queuedStaleMs: Math.max(
        0,
        Number(process.env.PRODUCT_ENRICHMENT_QUEUE_STALE_MINUTES ?? 15) * 60 * 1000,
      ),
      stuckMs: Math.max(
        0,
        Number(process.env.PRODUCT_ENRICHMENT_ITEM_STUCK_MINUTES ?? 30) * 60 * 1000,
      ),
    });
  }

  step.runId = run.id;
  await persistOnboarding(brandId, { ...state, updatedAt: new Date().toISOString() });
};

const refreshCatalogSummary = async (
  brandId: string,
  state: OnboardingState,
  progress: OnboardingProgress,
) => {
  const step = state.steps.catalog_extract;
  let runId = step.runId ?? null;
  if (!runId) {
    const latest = await findLatestCatalogRun(brandId);
    if (latest) {
      runId = latest.id;
      step.runId = runId;
    }
  }
  if (!runId) return;
  const summary = await summarizeCatalogRun(runId);
  if (!summary) return;
  progress.catalog = summary;
  if (summary.status === "completed") {
    step.status = "completed";
    step.finishedAt = new Date().toISOString();
    step.error = null;
  } else if (summary.status === "blocked") {
    step.status = "blocked";
    step.finishedAt = new Date().toISOString();
    step.error = summary.blockReason ?? summary.lastError ?? "catalog_blocked";
  } else {
    step.status = "processing";
    step.error = null;
  }
};

const refreshEnrichmentSummary = async (
  brandId: string,
  state: OnboardingState,
  progress: OnboardingProgress,
) => {
  const step = state.steps.product_enrich;
  let runId = step.runId ?? null;
  if (!runId) {
    const latest = await findLatestEnrichmentRun({ scope: "brand", brandId });
    if (latest) {
      runId = latest.id;
      step.runId = runId;
    }
  }
  if (runId) {
    const summary = await summarizeEnrichmentRun(runId);
    if (summary) {
      progress.productEnrichment = {
        ...(progress.productEnrichment ?? {}),
        summary,
      };
      if (summary.status === "completed") {
        step.status = "completed";
        step.finishedAt = new Date().toISOString();
        step.error = null;
      } else if (summary.status === "blocked") {
        step.status = "blocked";
        step.finishedAt = new Date().toISOString();
        step.error = summary.blockReason ?? summary.lastError ?? "product_enrich_blocked";
      } else {
        step.status = "processing";
        step.error = null;
      }
    }
  }

  const [counts] = await prisma.$queryRaw<{ total: number; enriched: number }[]>(
    Prisma.sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ("metadata" -> 'enrichment') IS NOT NULL)::int AS enriched
      FROM "products"
      WHERE "brandId" = ${brandId}
    `,
  );
  const total = counts?.total ?? 0;
  const enriched = counts?.enriched ?? 0;
  const remaining = Math.max(0, total - enriched);
  progress.productEnrichment = {
    ...(progress.productEnrichment ?? {}),
    counts: { total, enriched, remaining },
  };
  if (total > 0 && remaining === 0 && step.status === "processing") {
    step.status = "completed";
    step.finishedAt = new Date().toISOString();
    step.error = null;
  }
};

export const processOnboarding = async (
  brandId: string,
  options?: { force?: boolean; advance?: boolean },
): Promise<OnboardingResult> => {
  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: {
      id: true,
      name: true,
      ecommercePlatform: true,
      manualReview: true,
      metadata: true,
      siteUrl: true,
    },
  });
  if (!brand) {
    throw new Error("brand_not_found");
  }

  const metadata = getMetadataObject(brand.metadata);
  let onboarding = normalizeOnboarding(metadata.onboarding);
  const progress: OnboardingProgress = {};
  let changed = false;

  if (options?.force || onboarding.status === "idle") {
    onboarding = {
      status: "processing",
      step: "brand_enrich",
      steps: createEmptySteps(),
      updatedAt: new Date().toISOString(),
    };
    changed = true;
  }

  await refreshBrandEnrichStep(brandId, onboarding, progress);
  progress.techProfile = metadata.tech_profile
    ? {
        platform: (metadata.tech_profile as any)?.platform ?? null,
        confidence: (metadata.tech_profile as any)?.confidence ?? null,
        risks: (metadata.tech_profile as any)?.risks ?? [],
      }
    : undefined;
  await refreshCatalogSummary(brandId, onboarding, progress);
  await refreshEnrichmentSummary(brandId, onboarding, progress);

  if (options?.advance && onboarding.status === "processing") {
    let stepKey = onboarding.step ?? getNextStep(null);
    if (!stepKey) {
      updateOverallStatus(onboarding);
    } else {
      const step = onboarding.steps[stepKey];
      if (step.status === "completed") {
        const nextStep = getNextStep(stepKey);
        onboarding.step = nextStep;
        if (nextStep) {
          onboarding.steps[nextStep].status = "pending";
        }
        changed = true;
        stepKey = nextStep;
      }
      if (stepKey) {
        const current = onboarding.steps[stepKey];
        if (current.status === "pending") {
          if (stepKey === "brand_enrich") {
            await startBrandEnrichStep(brandId, onboarding);
          }
          if (stepKey === "tech_profile") {
            await startTechProfileStep(brandId, onboarding);
          }
          if (stepKey === "catalog_extract") {
            await startCatalogExtractStep(brandId, onboarding);
          }
          if (stepKey === "product_enrich") {
            await startProductEnrichStep(brandId, onboarding);
          }
          changed = true;
        }
      }
    }
  }

  updateOverallStatus(onboarding);
  if (onboarding.status === "processing") {
    onboarding.step = pickActiveStep(onboarding);
  }
  if (onboarding.status === "completed") {
    onboarding.step = null;
  }

  if (changed) {
    onboarding.updatedAt = new Date().toISOString();
    await persistOnboarding(brandId, onboarding);
  }

  return {
    onboarding,
    progress,
    brand: {
      id: brand.id,
      name: brand.name,
      ecommercePlatform: brand.ecommercePlatform,
      manualReview: brand.manualReview,
    },
  };
};

export const stepLabels = STEP_LABELS;
