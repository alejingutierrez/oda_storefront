import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { harvestProductSignals } from "@/lib/product-enrichment/signal-harvester";
import {
  CATEGORY_VALUES,
  GENDER_OPTIONS,
  SUBCATEGORY_BY_CATEGORY,
} from "@/lib/product-enrichment/constants";
import { normalizeEnumValue } from "@/lib/product-enrichment/utils";

type ReviewStatus = "accepted" | "rejected";

type LearningReviewRow = {
  status: ReviewStatus;
  fromCategory: string | null;
  fromSubcategory: string | null;
  fromGender: string | null;
  toCategory: string | null;
  toSubcategory: string | null;
  toGender: string | null;
  productName: string | null;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoTags: string[] | null;
  sourceUrl: string | null;
  metadata: unknown;
};

type CandidateRow = {
  id: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  gender: string | null;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoTags: string[] | null;
  sourceUrl: string | null;
  imageCoverUrl: string | null;
  metadata: unknown;
};

type VoteStat = {
  accepted: number;
  rejected: number;
};

type FieldIndex = Map<string, Map<string, VoteStat>>;

type LearningIndex = {
  category: FieldIndex;
  subcategory: FieldIndex;
  gender: FieldIndex;
  acceptedSamples: number;
  rejectedSamples: number;
};

type LearningPrediction = {
  value: string;
  confidence: number;
  support: number;
  marginRatio: number;
  sourceCount: number;
};

type AutoReseedRunStatus = "running" | "completed" | "skipped" | "failed";

type AutoReseedRunRow = {
  id: string;
  trigger: string;
  status: AutoReseedRunStatus;
  reason: string | null;
  startedAt: Date;
  completedAt: Date | null;
  pendingCount: number | null;
  pendingThreshold: number | null;
  scanned: number | null;
  proposed: number | null;
  enqueued: number | null;
  source: string | null;
  runKey: string | null;
  learningAcceptedSamples: number | null;
  learningRejectedSamples: number | null;
  error: string | null;
};

export type TaxonomyAutoReseedPhaseState = {
  enabled: boolean;
  running: boolean;
  runningExecutionId: string | null;
  runningTrigger: string | null;
  runningSince: string | null;
  pendingThreshold: number;
  autoLimit: number;
  cooldownMinutes: number;
  pendingCount: number;
  remainingForPhase: number;
  remainingToTrigger: number;
  readyToTrigger: boolean;
  lastAutoReseedAt: string | null;
  lastAutoReseedSource: string | null;
  lastAutoReseedRunKey: string | null;
  lastAutoReseedCreated: number;
  lastAutoReseedPendingNow: number;
  reviewedSinceLastAuto: number;
  lastRunStatus: string | null;
  lastRunReason: string | null;
};

export type TaxonomyAutoReseedResult = {
  triggered: boolean;
  reason:
    | "triggered"
    | "disabled"
    | "pending_above_threshold"
    | "cooldown_active"
    | "already_running"
    | "no_candidates"
    | "error";
  pendingCount: number;
  pendingThreshold: number;
  scanned: number;
  proposed: number;
  enqueued: number;
  executionId: string | null;
  source: string | null;
  runKey: string | null;
  learningAcceptedSamples: number;
  learningRejectedSamples: number;
  error?: string;
};

const AUTO_SOURCE_PREFIX = "auto_reseed_learning";
const STOP_WORDS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "y",
  "en",
  "para",
  "con",
  "por",
  "sin",
  "un",
  "una",
  "unos",
  "unas",
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "producto",
  "marca",
  "colombia",
]);

const GENDER_VALUES = GENDER_OPTIONS.map((entry) => entry.value);

const asBool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const asPositiveInt = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
};

const AUTO_ENABLED = asBool(process.env.TAXONOMY_REMAP_AUTO_RESEED_ENABLED, true);
const AUTO_THRESHOLD = asPositiveInt(process.env.TAXONOMY_REMAP_AUTO_RESEED_THRESHOLD, 100);
const AUTO_LIMIT = asPositiveInt(process.env.TAXONOMY_REMAP_AUTO_RESEED_LIMIT, 10_000);
const AUTO_COOLDOWN_MINUTES = asPositiveInt(process.env.TAXONOMY_REMAP_AUTO_RESEED_COOLDOWN_MINUTES, 120);
const LEARNING_SAMPLE_LIMIT = asPositiveInt(process.env.TAXONOMY_REMAP_LEARNING_SAMPLE_LIMIT, 12_000);
const AUTO_RUNNING_STALE_MINUTES = asPositiveInt(
  process.env.TAXONOMY_REMAP_AUTO_RESEED_RUNNING_STALE_MINUTES,
  30,
);

const toRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 40);
};

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenizeLearningText = (value: string) => {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  const words = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && token.length <= 32 && !STOP_WORDS.has(token));

  const tokens: string[] = [];
  words.forEach((token) => tokens.push(token));
  for (let i = 0; i < words.length - 1; i += 1) {
    tokens.push(`${words[i]} ${words[i + 1]}`);
  }

  return [...new Set(tokens)].slice(0, 120);
};

const getProductTextSources = (row: {
  name?: string | null;
  description?: string | null;
  originalDescription?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoTags?: string[] | null;
  sourceUrl?: string | null;
}) => {
  const sources = [
    row.name ?? "",
    row.description ?? "",
    row.originalDescription ?? "",
    row.seoTitle ?? "",
    row.seoDescription ?? "",
    (row.seoTags ?? []).join(" "),
    row.sourceUrl ?? "",
  ].filter(Boolean);
  return {
    text: sources.join(" "),
    sourceCount: sources.length,
  };
};

const buildRunKey = () => {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const time = now.toISOString().slice(11, 19).replaceAll(":", "");
  return `${date}_${time}`;
};

const upsertVote = (index: FieldIndex, token: string, value: string, status: ReviewStatus) => {
  if (!token || !value) return;
  const byValue = index.get(token) ?? new Map<string, VoteStat>();
  const stat = byValue.get(value) ?? { accepted: 0, rejected: 0 };
  if (status === "accepted") stat.accepted += 1;
  else stat.rejected += 1;
  byValue.set(value, stat);
  index.set(token, byValue);
};

const buildLearningIndex = async (): Promise<LearningIndex> => {
  const rows = await prisma.$queryRaw<LearningReviewRow[]>(Prisma.sql`
    SELECT
      r."status"::text AS "status",
      r."fromCategory",
      r."fromSubcategory",
      r."fromGender",
      r."toCategory",
      r."toSubcategory",
      r."toGender",
      p.name AS "productName",
      p.description,
      p."seoTitle",
      p."seoDescription",
      p."seoTags",
      p."sourceUrl",
      p.metadata
    FROM "taxonomy_remap_reviews" r
    JOIN "products" p ON p.id = r."productId"
    WHERE r."status" IN ('accepted', 'rejected')
      AND (r."toCategory" IS NOT NULL OR r."toSubcategory" IS NOT NULL OR r."toGender" IS NOT NULL)
      AND (p.metadata -> 'enrichment') IS NOT NULL
    ORDER BY COALESCE(r."decidedAt", r."updatedAt") DESC
    LIMIT ${LEARNING_SAMPLE_LIMIT}
  `);

  const categoryIndex: FieldIndex = new Map();
  const subcategoryIndex: FieldIndex = new Map();
  const genderIndex: FieldIndex = new Map();

  let acceptedSamples = 0;
  let rejectedSamples = 0;

  for (const row of rows) {
    if (row.status !== "accepted" && row.status !== "rejected") continue;

    const metadata = toRecord(row.metadata);
    const enrichment = toRecord(metadata.enrichment);
    const originalDescription =
      typeof enrichment.original_description === "string"
        ? enrichment.original_description
        : null;
    const seoTags = toStringArray(row.seoTags);
    const { text } = getProductTextSources({
      name: row.productName,
      description: row.description,
      originalDescription,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      seoTags,
      sourceUrl: row.sourceUrl,
    });
    const tokens = tokenizeLearningText(text);
    if (!tokens.length) continue;

    const fromCategory = normalizeEnumValue(row.fromCategory, CATEGORY_VALUES);
    const toCategory = normalizeEnumValue(row.toCategory, CATEGORY_VALUES);
    const fromCategorySubValues = fromCategory
      ? SUBCATEGORY_BY_CATEGORY[fromCategory] ?? []
      : [];
    const toCategorySubValues = toCategory
      ? SUBCATEGORY_BY_CATEGORY[toCategory] ?? []
      : [];
    const fromSubcategory = normalizeEnumValue(
      row.fromSubcategory,
      fromCategorySubValues,
    );
    const toSubcategory = normalizeEnumValue(
      row.toSubcategory,
      toCategorySubValues.length ? toCategorySubValues : fromCategorySubValues,
    );
    const fromGender = normalizeEnumValue(row.fromGender, GENDER_VALUES);
    const toGender = normalizeEnumValue(row.toGender, GENDER_VALUES);

    const categoryChanged = Boolean(toCategory && toCategory !== fromCategory);
    const subcategoryChanged = Boolean(toSubcategory && toSubcategory !== fromSubcategory);
    const genderChanged = Boolean(toGender && toGender !== fromGender);

    if (!categoryChanged && !subcategoryChanged && !genderChanged) continue;
    if (row.status === "accepted") acceptedSamples += 1;
    else rejectedSamples += 1;

    for (const token of tokens) {
      if (categoryChanged && toCategory) upsertVote(categoryIndex, token, toCategory, row.status);
      if (subcategoryChanged && toSubcategory) {
        upsertVote(subcategoryIndex, token, toSubcategory, row.status);
      }
      if (genderChanged && toGender) upsertVote(genderIndex, token, toGender, row.status);
    }
  }

  return {
    category: categoryIndex,
    subcategory: subcategoryIndex,
    gender: genderIndex,
    acceptedSamples,
    rejectedSamples,
  };
};

const inferFromLearning = (
  index: FieldIndex,
  tokens: string[],
  allowedValues: string[],
  options: { minSupport: number; minScore: number; minConfidence: number; minMargin: number },
): LearningPrediction | null => {
  if (!tokens.length) return null;

  const scoreByValue = new Map<string, number>();
  const supportByValue = new Map<string, number>();
  const sourceByValue = new Map<string, number>();

  for (const token of tokens) {
    const byValue = index.get(token);
    if (!byValue) continue;
    for (const [rawValue, stat] of byValue.entries()) {
      const normalized = normalizeEnumValue(rawValue, allowedValues);
      if (!normalized) continue;
      const score = stat.accepted - stat.rejected * 0.75;
      if (score <= 0) continue;
      scoreByValue.set(normalized, (scoreByValue.get(normalized) ?? 0) + score);
      supportByValue.set(normalized, (supportByValue.get(normalized) ?? 0) + stat.accepted);
      sourceByValue.set(normalized, (sourceByValue.get(normalized) ?? 0) + 1);
    }
  }

  const ranked = [...scoreByValue.entries()].sort((a, b) => b[1] - a[1]);
  const best = ranked[0];
  if (!best) return null;

  const second = ranked[1]?.[1] ?? 0;
  const bestScore = best[1];
  const support = supportByValue.get(best[0]) ?? 0;
  const sourceCount = sourceByValue.get(best[0]) ?? 0;
  const totalScore = ranked.reduce((acc, entry) => acc + Math.max(0, entry[1]), 0);
  const confidence = totalScore > 0 ? bestScore / totalScore : 0;
  const marginRatio = bestScore / Math.max(0.001, second);

  if (support < options.minSupport) return null;
  if (bestScore < options.minScore) return null;
  if (confidence < options.minConfidence) return null;
  if (marginRatio < options.minMargin) return null;

  return {
    value: best[0],
    confidence,
    support,
    marginRatio,
    sourceCount,
  };
};

const getPendingCount = async () => {
  const [row] = await prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS total
    FROM "taxonomy_remap_reviews"
    WHERE "status" = 'pending'
  `);
  return row?.total ?? 0;
};

const getLastAutoReseedMeta = async () => {
  const rows = await prisma.$queryRaw<
    Array<{ source: string; runKey: string | null; createdAt: Date; total: number; pendingNow: number }>
  >(Prisma.sql`
    SELECT
      r."source" AS source,
      r."runKey" AS "runKey",
      MAX(r."createdAt") AS "createdAt",
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE r."status" = 'pending')::int AS "pendingNow"
    FROM "taxonomy_remap_reviews" r
    WHERE r."source" LIKE ${`${AUTO_SOURCE_PREFIX}%`}
    GROUP BY r."source", r."runKey"
    ORDER BY MAX(r."createdAt") DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
};

const isRunningUniqueViolation = (error: unknown) => {
  const code =
    (error as { code?: string })?.code ??
    (error as { meta?: { code?: string } })?.meta?.code ??
    null;
  if (code === "23505" || code === "P2002") return true;
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("taxonomy_remap_auto_reseed_runs_running_unique_idx") ||
    error.message.includes("taxonomy_remap_auto_reseed_runs_status_key")
  );
};

const markStaleRunningRuns = async () => {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "taxonomy_remap_auto_reseed_runs"
    SET
      "status" = 'failed',
      "reason" = 'stale_running_timeout',
      "error" = 'Marked stale by watchdog before acquiring a new run.',
      "completedAt" = NOW(),
      "updatedAt" = NOW()
    WHERE "status" = 'running'
      AND "startedAt" < NOW() - make_interval(mins => ${AUTO_RUNNING_STALE_MINUTES})
  `);
};

const getActiveAutoReseedRun = async (): Promise<AutoReseedRunRow | null> => {
  const rows = await prisma.$queryRaw<AutoReseedRunRow[]>(Prisma.sql`
    SELECT
      r.id,
      r."trigger",
      r."status"::text AS "status",
      r."reason",
      r."startedAt",
      r."completedAt",
      r."pendingCount",
      r."pendingThreshold",
      r."scanned",
      r."proposed",
      r."enqueued",
      r."source",
      r."runKey",
      r."learningAcceptedSamples",
      r."learningRejectedSamples",
      r."error"
    FROM "taxonomy_remap_auto_reseed_runs" r
    WHERE r."status" = 'running'
    ORDER BY r."startedAt" DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
};

const getLastAutoReseedRun = async (): Promise<AutoReseedRunRow | null> => {
  const rows = await prisma.$queryRaw<AutoReseedRunRow[]>(Prisma.sql`
    SELECT
      r.id,
      r."trigger",
      r."status"::text AS "status",
      r."reason",
      r."startedAt",
      r."completedAt",
      r."pendingCount",
      r."pendingThreshold",
      r."scanned",
      r."proposed",
      r."enqueued",
      r."source",
      r."runKey",
      r."learningAcceptedSamples",
      r."learningRejectedSamples",
      r."error"
    FROM "taxonomy_remap_auto_reseed_runs" r
    ORDER BY r."startedAt" DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
};

const createAutoReseedRun = async (params: {
  trigger: "decision" | "cron" | "manual";
  force: boolean;
  requestedLimit: number;
  pendingCount: number;
  pendingThreshold: number;
}): Promise<string | null> => {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO "taxonomy_remap_auto_reseed_runs" (
        "id",
        "trigger",
        "status",
        "force",
        "requestedLimit",
        "pendingCount",
        "pendingThreshold",
        "startedAt",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${randomUUID()},
        ${params.trigger},
        'running',
        ${params.force},
        ${params.requestedLimit},
        ${params.pendingCount},
        ${params.pendingThreshold},
        NOW(),
        NOW(),
        NOW()
      )
      RETURNING id
    `);
    return rows[0]?.id ?? null;
  } catch (error) {
    if (isRunningUniqueViolation(error)) return null;
    throw error;
  }
};

const completeAutoReseedRun = async (
  runId: string | null,
  payload: {
    status: Exclude<AutoReseedRunStatus, "running">;
    reason: string;
    pendingCount: number;
    pendingThreshold: number;
    scanned: number;
    proposed: number;
    enqueued: number;
    source: string | null;
    runKey: string | null;
    learningAcceptedSamples: number;
    learningRejectedSamples: number;
    error?: string;
  },
) => {
  if (!runId) return;
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "taxonomy_remap_auto_reseed_runs"
    SET
      "status" = ${payload.status},
      "reason" = ${payload.reason},
      "pendingCount" = ${payload.pendingCount},
      "pendingThreshold" = ${payload.pendingThreshold},
      "scanned" = ${payload.scanned},
      "proposed" = ${payload.proposed},
      "enqueued" = ${payload.enqueued},
      "source" = ${payload.source},
      "runKey" = ${payload.runKey},
      "learningAcceptedSamples" = ${payload.learningAcceptedSamples},
      "learningRejectedSamples" = ${payload.learningRejectedSamples},
      "error" = ${payload.error ?? null},
      "completedAt" = NOW(),
      "updatedAt" = NOW()
    WHERE "id" = ${runId}
  `);
};

export const getTaxonomyAutoReseedPhaseState = async (): Promise<TaxonomyAutoReseedPhaseState> => {
  await markStaleRunningRuns();
  const [pendingCount, lastAuto, activeRun, lastRun] = await Promise.all([
    getPendingCount(),
    getLastAutoReseedMeta(),
    getActiveAutoReseedRun(),
    getLastAutoReseedRun(),
  ]);
  const remainingToTrigger = Math.max(0, pendingCount - AUTO_THRESHOLD);
  const reviewedSinceLastAuto = lastAuto
    ? (
        await prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
          SELECT COUNT(*)::int AS total
          FROM "taxonomy_remap_reviews"
          WHERE "status" IN ('accepted', 'rejected')
            AND "updatedAt" >= ${lastAuto.createdAt}
        `)
      )[0]?.total ?? 0
    : 0;

  return {
    enabled: AUTO_ENABLED,
    running: Boolean(activeRun),
    runningExecutionId: activeRun?.id ?? null,
    runningTrigger: activeRun?.trigger ?? null,
    runningSince: activeRun?.startedAt ? activeRun.startedAt.toISOString() : null,
    pendingThreshold: AUTO_THRESHOLD,
    autoLimit: AUTO_LIMIT,
    cooldownMinutes: AUTO_COOLDOWN_MINUTES,
    pendingCount,
    remainingForPhase: pendingCount,
    remainingToTrigger,
    readyToTrigger: pendingCount <= AUTO_THRESHOLD,
    lastAutoReseedAt: lastAuto?.createdAt ? lastAuto.createdAt.toISOString() : null,
    lastAutoReseedSource: lastAuto?.source ?? null,
    lastAutoReseedRunKey: lastAuto?.runKey ?? null,
    lastAutoReseedCreated: lastAuto?.total ?? 0,
    lastAutoReseedPendingNow: lastAuto?.pendingNow ?? 0,
    reviewedSinceLastAuto,
    lastRunStatus: lastRun?.status ?? null,
    lastRunReason: lastRun?.reason ?? null,
  };
};

const createSourceLabel = (trigger: string, runKey: string) => `${AUTO_SOURCE_PREFIX}_${trigger}_${runKey}`;

const signalStrengthToConfidence = (strength: "strong" | "moderate" | "weak") => {
  if (strength === "strong") return 0.78;
  if (strength === "moderate") return 0.67;
  return 0.53;
};

export const runTaxonomyAutoReseedBatch = async (params: {
  trigger: "decision" | "cron" | "manual";
  force?: boolean;
  limit?: number;
}): Promise<TaxonomyAutoReseedResult> => {
  const phase = await getTaxonomyAutoReseedPhaseState();
  const requestedLimit = Math.max(100, params.limit ?? AUTO_LIMIT);
  if (!phase.enabled) {
    return {
      triggered: false,
      reason: "disabled",
      pendingCount: phase.pendingCount,
      pendingThreshold: phase.pendingThreshold,
      scanned: 0,
      proposed: 0,
      enqueued: 0,
      executionId: null,
      source: null,
      runKey: null,
      learningAcceptedSamples: 0,
      learningRejectedSamples: 0,
    };
  }
  if (!params.force && phase.pendingCount > phase.pendingThreshold) {
    return {
      triggered: false,
      reason: "pending_above_threshold",
      pendingCount: phase.pendingCount,
      pendingThreshold: phase.pendingThreshold,
      scanned: 0,
      proposed: 0,
      enqueued: 0,
      executionId: null,
      source: null,
      runKey: null,
      learningAcceptedSamples: 0,
      learningRejectedSamples: 0,
    };
  }

  const lastAuto = await getLastAutoReseedMeta();
  if (!params.force && lastAuto?.createdAt) {
    const cooldownMs = AUTO_COOLDOWN_MINUTES * 60_000;
    const ageMs = Date.now() - lastAuto.createdAt.getTime();
    if (ageMs < cooldownMs) {
      return {
        triggered: false,
        reason: "cooldown_active",
        pendingCount: phase.pendingCount,
        pendingThreshold: phase.pendingThreshold,
        scanned: 0,
        proposed: 0,
        enqueued: 0,
        executionId: null,
        source: lastAuto.source,
        runKey: lastAuto.runKey ?? null,
        learningAcceptedSamples: 0,
        learningRejectedSamples: 0,
      };
    }
  }

  await markStaleRunningRuns();
  const executionId = await createAutoReseedRun({
    trigger: params.trigger,
    force: params.force === true,
    requestedLimit,
    pendingCount: phase.pendingCount,
    pendingThreshold: phase.pendingThreshold,
  });
  if (!executionId) {
    return {
      triggered: false,
      reason: "already_running",
      pendingCount: phase.pendingCount,
      pendingThreshold: phase.pendingThreshold,
      scanned: 0,
      proposed: 0,
      enqueued: 0,
      executionId: null,
      source: null,
      runKey: null,
      learningAcceptedSamples: 0,
      learningRejectedSamples: 0,
    };
  }

  const runKey = buildRunKey();
  const source = createSourceLabel(params.trigger, runKey);
  try {
    const learning = await buildLearningIndex();

    const candidates = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
      SELECT
        p.id,
        p.name,
        p.category,
        p.subcategory,
        p.gender,
        p.description,
        p."seoTitle",
        p."seoDescription",
        p."seoTags",
        p."sourceUrl",
        p."imageCoverUrl",
        p.metadata
      FROM "products" p
      WHERE (p.metadata -> 'enrichment') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "taxonomy_remap_reviews" r
          WHERE r."productId" = p.id
        )
      ORDER BY p."updatedAt" DESC
      LIMIT ${requestedLimit}
    `);

    const proposals: Array<{
      id: string;
      productId: string;
      fromCategory: string | null;
      fromSubcategory: string | null;
      fromGender: string | null;
      toCategory: string | null;
      toSubcategory: string | null;
      toGender: string | null;
      confidence: number;
      reasons: string[];
      seoCategoryHints: string[];
      sourceCount: number;
      scoreSupport: number;
      marginRatio: number;
      imageCoverUrl: string | null;
      sourceUrl: string | null;
    }> = [];

    for (const row of candidates) {
      const metadata = toRecord(row.metadata);
      const enrichment = toRecord(metadata.enrichment);
      const originalDescription =
        typeof enrichment.original_description === "string"
          ? enrichment.original_description
          : row.description;
      const seoTags = toStringArray(row.seoTags);
      const sources = getProductTextSources({
        name: row.name,
        description: row.description,
        originalDescription,
        seoTitle: row.seoTitle,
        seoDescription: row.seoDescription,
        seoTags,
        sourceUrl: row.sourceUrl,
      });
      const tokens = tokenizeLearningText(sources.text);
      const signals = harvestProductSignals({
        name: row.name,
        description: originalDescription,
        metadata,
        sourceUrl: row.sourceUrl,
        allowedCategoryValues: CATEGORY_VALUES,
        subcategoryByCategory: SUBCATEGORY_BY_CATEGORY,
      });

      const currentCategory = normalizeEnumValue(row.category, CATEGORY_VALUES);
      const currentGender = normalizeEnumValue(row.gender, GENDER_VALUES);
      const allowedCurrentSub = currentCategory ? SUBCATEGORY_BY_CATEGORY[currentCategory] ?? [] : [];
      const currentSubcategory = normalizeEnumValue(row.subcategory, allowedCurrentSub);

      const learningCategory = inferFromLearning(learning.category, tokens, CATEGORY_VALUES, {
        minSupport: 3,
        minScore: 2.2,
        minConfidence: 0.62,
        minMargin: 1.15,
      });
      const learningGender = inferFromLearning(learning.gender, tokens, GENDER_VALUES, {
        minSupport: 2,
        minScore: 1.4,
        minConfidence: 0.58,
        minMargin: 1.1,
      });

      let nextCategory = currentCategory;
      let categoryConfidence = 0;
      let categorySupport = 0;
      let categoryMargin = 0;
      const reasons: string[] = [];

      if (learningCategory?.value && learningCategory.value !== currentCategory) {
        nextCategory = learningCategory.value;
        categoryConfidence = learningCategory.confidence;
        categorySupport = learningCategory.support;
        categoryMargin = learningCategory.marginRatio;
        reasons.push("learning:category");
      } else if (
        signals.inferredCategory &&
        signals.inferredCategory !== currentCategory &&
        (signals.signalStrength === "strong" || !currentCategory)
      ) {
        nextCategory = signals.inferredCategory;
        categoryConfidence = signalStrengthToConfidence(signals.signalStrength);
        categorySupport = signals.signalStrength === "strong" ? 2 : 1;
        categoryMargin = signals.signalStrength === "strong" ? 1.3 : 1.05;
        reasons.push(`signals:${signals.signalStrength}:category`);
      }

      const categoryChanged = nextCategory !== currentCategory;

      const allowedSub = nextCategory ? SUBCATEGORY_BY_CATEGORY[nextCategory] ?? [] : [];
      const learningSubcategory = inferFromLearning(learning.subcategory, tokens, allowedSub, {
        minSupport: 2,
        minScore: 1.3,
        minConfidence: 0.58,
        minMargin: 1.1,
      });

      let nextSubcategory = currentSubcategory;
      let subConfidence = 0;
      let subSupport = 0;
      let subMargin = 0;

      if (learningSubcategory?.value && learningSubcategory.value !== currentSubcategory) {
        nextSubcategory = learningSubcategory.value;
        subConfidence = learningSubcategory.confidence;
        subSupport = learningSubcategory.support;
        subMargin = learningSubcategory.marginRatio;
        reasons.push("learning:subcategory");
      } else if (
        signals.inferredSubcategory &&
        allowedSub.includes(signals.inferredSubcategory) &&
        signals.inferredSubcategory !== currentSubcategory &&
        (signals.signalStrength === "strong" || !currentSubcategory)
      ) {
        nextSubcategory = signals.inferredSubcategory;
        subConfidence = signalStrengthToConfidence(signals.signalStrength) - 0.04;
        subSupport = signals.signalStrength === "strong" ? 2 : 1;
        subMargin = signals.signalStrength === "strong" ? 1.25 : 1.03;
        reasons.push(`signals:${signals.signalStrength}:subcategory`);
      } else if (categoryChanged && nextSubcategory && !allowedSub.includes(nextSubcategory)) {
        nextSubcategory = null;
        subConfidence = 0.58;
        subSupport = 1;
        subMargin = 1.0;
        reasons.push("reset:subcategory_category_mismatch");
      }

      const genderAllowed = GENDER_VALUES;
      let nextGender = currentGender;
      let genderConfidence = 0;
      let genderSupport = 0;
      let genderMargin = 0;
      if (learningGender?.value && learningGender.value !== currentGender) {
        nextGender = learningGender.value;
        genderConfidence = learningGender.confidence;
        genderSupport = learningGender.support;
        genderMargin = learningGender.marginRatio;
        reasons.push("learning:gender");
      } else if (
        signals.inferredGender &&
        genderAllowed.includes(signals.inferredGender) &&
        signals.inferredGender !== currentGender &&
        (signals.signalStrength !== "weak" || !currentGender)
      ) {
        nextGender = signals.inferredGender;
        genderConfidence = signalStrengthToConfidence(signals.signalStrength) - 0.02;
        genderSupport = signals.signalStrength === "strong" ? 2 : 1;
        genderMargin = signals.signalStrength === "strong" ? 1.2 : 1.02;
        reasons.push(`signals:${signals.signalStrength}:gender`);
      }

      const categoryMoveThreshold = currentCategory ? 0.82 : 0.66;
      const subMoveThreshold = currentSubcategory ? 0.76 : 0.62;
      const genderMoveThreshold = currentGender ? 0.72 : 0.6;

      const finalCategory = categoryConfidence >= categoryMoveThreshold ? nextCategory : currentCategory;
      const finalSubcategory =
        subConfidence >= subMoveThreshold && finalCategory
          ? normalizeEnumValue(nextSubcategory, SUBCATEGORY_BY_CATEGORY[finalCategory] ?? [])
          : currentSubcategory;
      const finalGender = genderConfidence >= genderMoveThreshold ? nextGender : currentGender;

      const changedCategory = finalCategory !== currentCategory;
      const changedSubcategory = finalSubcategory !== currentSubcategory;
      const changedGender = finalGender !== currentGender;
      if (!changedCategory && !changedSubcategory && !changedGender) continue;

      const confidence = Math.max(categoryConfidence, subConfidence, genderConfidence);
      const support = Math.max(categorySupport, subSupport, genderSupport);
      const marginRatio = Math.max(categoryMargin, subMargin, genderMargin);
      const seoHints = seoTags.slice(0, 6);

      proposals.push({
        id: randomUUID(),
        productId: row.id,
        fromCategory: currentCategory,
        fromSubcategory: currentSubcategory,
        fromGender: currentGender,
        toCategory: finalCategory,
        toSubcategory: finalSubcategory,
        toGender: finalGender,
        confidence: Number(confidence.toFixed(4)),
        reasons: [...new Set(reasons)].slice(0, 8),
        seoCategoryHints: seoHints,
        sourceCount: sources.sourceCount,
        scoreSupport: support,
        marginRatio: Number(marginRatio.toFixed(4)),
        imageCoverUrl: row.imageCoverUrl,
        sourceUrl: row.sourceUrl,
      });
    }

    if (!proposals.length) {
      await completeAutoReseedRun(executionId, {
        status: "skipped",
        reason: "no_candidates",
        pendingCount: phase.pendingCount,
        pendingThreshold: phase.pendingThreshold,
        scanned: candidates.length,
        proposed: 0,
        enqueued: 0,
        source,
        runKey,
        learningAcceptedSamples: learning.acceptedSamples,
        learningRejectedSamples: learning.rejectedSamples,
      });
      return {
        triggered: false,
        reason: "no_candidates",
        pendingCount: phase.pendingCount,
        pendingThreshold: phase.pendingThreshold,
        scanned: candidates.length,
        proposed: 0,
        enqueued: 0,
        executionId,
        source,
        runKey,
        learningAcceptedSamples: learning.acceptedSamples,
        learningRejectedSamples: learning.rejectedSamples,
      };
    }

    const chunkSize = 400;
    for (let i = 0; i < proposals.length; i += chunkSize) {
      const chunk = proposals.slice(i, i + chunkSize);
      await prisma.$transaction(async (tx) => {
        for (const proposal of chunk) {
          await tx.$executeRaw(
            Prisma.sql`
              DELETE FROM "taxonomy_remap_reviews"
              WHERE "productId" = ${proposal.productId}
                AND "status" = 'pending'
          `,
          );
          await tx.$executeRaw(
            Prisma.sql`
              INSERT INTO "taxonomy_remap_reviews" (
                "id",
                "status",
                "source",
                "runKey",
                "productId",
                "fromCategory",
                "fromSubcategory",
                "fromGender",
                "toCategory",
                "toSubcategory",
                "toGender",
                "confidence",
                "reasons",
                "seoCategoryHints",
                "sourceCount",
                "scoreSupport",
                "marginRatio",
                "imageCoverUrl",
                "sourceUrl",
                "createdAt",
                "updatedAt"
              )
              VALUES (
                ${proposal.id},
                'pending',
                ${source},
                ${runKey},
                ${proposal.productId},
                ${proposal.fromCategory},
                ${proposal.fromSubcategory},
                ${proposal.fromGender},
                ${proposal.toCategory},
                ${proposal.toSubcategory},
                ${proposal.toGender},
                ${proposal.confidence},
                ${proposal.reasons},
                ${proposal.seoCategoryHints},
                ${proposal.sourceCount},
                ${proposal.scoreSupport},
                ${proposal.marginRatio},
                ${proposal.imageCoverUrl},
                ${proposal.sourceUrl},
                NOW(),
                NOW()
              )
          `,
          );
        }
      });
    }

    await completeAutoReseedRun(executionId, {
      status: "completed",
      reason: "triggered",
      pendingCount: phase.pendingCount,
      pendingThreshold: phase.pendingThreshold,
      scanned: candidates.length,
      proposed: proposals.length,
      enqueued: proposals.length,
      source,
      runKey,
      learningAcceptedSamples: learning.acceptedSamples,
      learningRejectedSamples: learning.rejectedSamples,
    });

    return {
      triggered: true,
      reason: "triggered",
      pendingCount: phase.pendingCount,
      pendingThreshold: phase.pendingThreshold,
      scanned: candidates.length,
      proposed: proposals.length,
      enqueued: proposals.length,
      executionId,
      source,
      runKey,
      learningAcceptedSamples: learning.acceptedSamples,
      learningRejectedSamples: learning.rejectedSamples,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 1000) : "auto_reseed_unknown_error";
    await completeAutoReseedRun(executionId, {
      status: "failed",
      reason: "error",
      pendingCount: phase.pendingCount,
      pendingThreshold: phase.pendingThreshold,
      scanned: 0,
      proposed: 0,
      enqueued: 0,
      source,
      runKey,
      learningAcceptedSamples: 0,
      learningRejectedSamples: 0,
      error: message,
    });
    return {
      triggered: false,
      reason: "error",
      pendingCount: phase.pendingCount,
      pendingThreshold: phase.pendingThreshold,
      scanned: 0,
      proposed: 0,
      enqueued: 0,
      executionId,
      source,
      runKey,
      learningAcceptedSamples: 0,
      learningRejectedSamples: 0,
      error: message,
    };
  }
};
