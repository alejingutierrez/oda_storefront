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

type CandidateRow = {
  id: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  gender: string | null;
  hasPendingReview: boolean;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoTags: string[] | null;
  sourceUrl: string | null;
  imageCoverUrl: string | null;
  metadata: unknown;
};

type AutoReseedRunStatus = "running" | "completed" | "skipped" | "failed";
type AutoReseedMode = "default" | "refresh_pending";

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

const AUTO_SOURCE_PREFIX = "auto_reseed";

const GENDER_VALUES = GENDER_OPTIONS.map((entry) => entry.value);
const GENDER_NEUTRAL_CATEGORY_SET = new Set([
  "hogar_y_lifestyle",
  "gafas_y_optica",
]);
const CHILD_UNLIKELY_CATEGORY_SET = new Set([
  "hogar_y_lifestyle",
  "gafas_y_optica",
  "joyeria_y_bisuteria",
  "bolsos_y_marroquineria",
]);

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
const AUTO_RUNNING_STALE_MINUTES = asPositiveInt(
  process.env.TAXONOMY_REMAP_AUTO_RESEED_RUNNING_STALE_MINUTES,
  30,
);
const AUTO_FORCE_RECOVER_MINUTES = asPositiveInt(
  process.env.TAXONOMY_REMAP_AUTO_RESEED_FORCE_RECOVER_MINUTES,
  8,
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


const getProductSourceCount = (row: {
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
    sourceCount: sources.length,
  };
};

const buildRunKey = () => {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const time = now.toISOString().slice(11, 19).replaceAll(":", "");
  return `${date}_${time}`;
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

const markForceRecoverableRunningRuns = async () => {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "taxonomy_remap_auto_reseed_runs"
    SET
      "status" = 'failed',
      "reason" = 'forced_timeout_recovery',
      "error" = 'Stopped by manual force run to recover a long-running execution.',
      "completedAt" = NOW(),
      "updatedAt" = NOW()
    WHERE "status" = 'running'
      AND "startedAt" < NOW() - make_interval(mins => ${AUTO_FORCE_RECOVER_MINUTES})
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
  if (strength === "strong") return 0.9;
  if (strength === "moderate") return 0.8;
  return 0.62;
};

export const runTaxonomyAutoReseedBatch = async (params: {
  trigger: "decision" | "cron" | "manual";
  force?: boolean;
  limit?: number;
  mode?: AutoReseedMode;
}): Promise<TaxonomyAutoReseedResult> => {
  const phase = await getTaxonomyAutoReseedPhaseState();
  const defaultLimit = params.trigger === "manual" ? AUTO_LIMIT : Math.min(2_000, AUTO_LIMIT);
  const requestedLimit = Math.max(100, params.limit ?? defaultLimit);
  const mode: AutoReseedMode = params.mode === "refresh_pending" ? "refresh_pending" : "default";
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
  if (params.force) {
    await markForceRecoverableRunningRuns();
  }
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
    const refreshPendingSql =
      mode === "refresh_pending"
        ? Prisma.sql`
          AND EXISTS (
            SELECT 1
            FROM "taxonomy_remap_reviews" r_pending_only
            WHERE r_pending_only."productId" = p.id
              AND r_pending_only."status" = 'pending'
          )
        `
        : Prisma.empty;
    const candidates = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
      SELECT
        p.id,
        p.name,
        p.category,
        p.subcategory,
        p.gender,
        EXISTS (
          SELECT 1
          FROM "taxonomy_remap_reviews" r_pending
          WHERE r_pending."productId" = p.id
            AND r_pending."status" = 'pending'
        ) AS "hasPendingReview",
        p.description,
        p."seoTitle",
        p."seoDescription",
        p."seoTags",
        p."sourceUrl",
        p."imageCoverUrl",
        p.metadata
      FROM "products" p
      WHERE (p.metadata -> 'enrichment') IS NOT NULL
        ${refreshPendingSql}
        AND NOT EXISTS (
          SELECT 1
          FROM "taxonomy_remap_reviews" r
          WHERE r."productId" = p.id
            AND r."status" IN ('accepted', 'rejected')
        )
      ORDER BY
        EXISTS (
          SELECT 1
          FROM "taxonomy_remap_reviews" r_pending
          WHERE r_pending."productId" = p.id
            AND r_pending."status" = 'pending'
        ) DESC,
        p."updatedAt" DESC
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
      const { sourceCount } = getProductSourceCount({
        name: row.name,
        description: row.description,
        originalDescription,
        seoTitle: row.seoTitle,
        seoDescription: row.seoDescription,
        seoTags,
        sourceUrl: row.sourceUrl,
      });
      const signals = harvestProductSignals({
        name: row.name,
        description: originalDescription,
        metadata,
        sourceUrl: row.sourceUrl,
        seoTitle: row.seoTitle,
        seoDescription: row.seoDescription,
        seoTags,
        currentCategory: row.category,
        currentGender: row.gender,
        allowedCategoryValues: CATEGORY_VALUES,
        subcategoryByCategory: SUBCATEGORY_BY_CATEGORY,
      });

      const currentCategory = normalizeEnumValue(row.category, CATEGORY_VALUES);
      const currentGender = normalizeEnumValue(row.gender, GENDER_VALUES);
      const allowedCurrentSub = currentCategory ? SUBCATEGORY_BY_CATEGORY[currentCategory] ?? [] : [];
      const currentSubcategory = normalizeEnumValue(row.subcategory, allowedCurrentSub);

      let nextCategory = currentCategory;
      let categoryConfidence = 0;
      let categorySupport = 0;
      let categoryMargin = 0;
      const reasons: string[] = [];

      if (
        signals.inferredCategory &&
        signals.inferredCategory !== currentCategory &&
        (signals.signalStrength !== "weak" || !currentCategory)
      ) {
        nextCategory = signals.inferredCategory;
        categoryConfidence = signalStrengthToConfidence(signals.signalStrength);
        categorySupport =
          signals.signalStrength === "strong"
            ? 3
            : signals.signalStrength === "moderate"
              ? 2
              : 1;
        categoryMargin =
          signals.signalStrength === "strong"
            ? 1.45
            : signals.signalStrength === "moderate"
              ? 1.22
              : 1.05;
        reasons.push(`signals:${signals.signalStrength}:category`);
      }

      const categoryChanged = nextCategory !== currentCategory;

      const allowedSub = nextCategory ? SUBCATEGORY_BY_CATEGORY[nextCategory] ?? [] : [];

      let nextSubcategory = currentSubcategory;
      let subConfidence = 0;
      let subSupport = 0;
      let subMargin = 0;
      const isNameBackedSubcategory = Boolean(
        signals.nameSubcategory && signals.inferredSubcategory === signals.nameSubcategory,
      );

      if (
        signals.inferredSubcategory &&
        allowedSub.includes(signals.inferredSubcategory) &&
        signals.inferredSubcategory !== currentSubcategory &&
        (signals.signalStrength !== "weak" || !currentSubcategory) &&
        isNameBackedSubcategory
      ) {
        nextSubcategory = signals.inferredSubcategory;
        subConfidence = signalStrengthToConfidence(signals.signalStrength) - 0.04;
        subSupport =
          signals.signalStrength === "strong"
            ? 3
            : signals.signalStrength === "moderate"
              ? 2
              : 1;
        subMargin =
          signals.signalStrength === "strong"
            ? 1.4
            : signals.signalStrength === "moderate"
              ? 1.16
              : 1.02;
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
      if (
        signals.inferredGender &&
        genderAllowed.includes(signals.inferredGender) &&
        signals.inferredGender !== currentGender &&
        ((signals.signalStrength !== "weak" && signals.inferredGenderSupport >= 1) || !currentGender)
      ) {
        nextGender = signals.inferredGender;
        genderConfidence =
          signals.inferredGenderConfidence > 0
            ? signals.inferredGenderConfidence
            : signalStrengthToConfidence(signals.signalStrength) - 0.05;
        genderSupport = Math.max(
          1,
          signals.inferredGenderSupport ||
            (signals.signalStrength === "strong" ? 3 : signals.signalStrength === "moderate" ? 2 : 1),
        );
        genderMargin = Math.max(1.01, signals.inferredGenderMargin || 1.03);
        reasons.push(`signals:${signals.signalStrength}:gender`);
        signals.inferredGenderReasons.slice(0, 3).forEach((reason) => {
          reasons.push(`gender:${reason}`);
        });
      }

      const categoryMoveThreshold = currentCategory ? 0.84 : 0.68;
      const subMoveThreshold = currentSubcategory ? 0.78 : 0.64;
      const categoryForGender =
        nextCategory ??
        currentCategory ??
        normalizeEnumValue(signals.inferredCategory, CATEGORY_VALUES);
      let genderMoveThreshold = currentGender ? 0.79 : 0.64;
      if (currentGender === "no_binario_unisex" && nextGender && nextGender !== "no_binario_unisex") {
        genderMoveThreshold = Math.max(genderMoveThreshold, 0.87);
      }
      if (nextGender === "infantil" && currentGender && currentGender !== "infantil") {
        genderMoveThreshold = Math.max(genderMoveThreshold, 0.9);
      }
      if (
        nextGender &&
        nextGender !== "no_binario_unisex" &&
        categoryForGender &&
        GENDER_NEUTRAL_CATEGORY_SET.has(categoryForGender)
      ) {
        genderMoveThreshold = Math.max(genderMoveThreshold, 0.9);
      }
      if (
        nextGender === "infantil" &&
        categoryForGender &&
        CHILD_UNLIKELY_CATEGORY_SET.has(categoryForGender)
      ) {
        genderMoveThreshold = Math.max(genderMoveThreshold, 0.92);
      }
      if (currentGender && signals.inferredGenderSupport < 2) {
        genderMoveThreshold = Math.max(genderMoveThreshold, 0.86);
      }

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
        sourceCount,
        scoreSupport: support,
        marginRatio: Number(marginRatio.toFixed(4)),
        imageCoverUrl: row.imageCoverUrl,
        sourceUrl: row.sourceUrl,
      });
    }

    const proposedProductIds = new Set(proposals.map((proposal) => proposal.productId));
    const stalePendingProductIds = candidates
      .filter((row) => row.hasPendingReview && !proposedProductIds.has(row.id))
      .map((row) => row.id);
    if (stalePendingProductIds.length) {
      await prisma.taxonomyRemapReview.deleteMany({
        where: {
          status: "pending",
          productId: { in: stalePendingProductIds },
        },
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
        learningAcceptedSamples: 0,
        learningRejectedSamples: 0,
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
        learningAcceptedSamples: 0,
        learningRejectedSamples: 0,
      };
    }

    const chunkSize = 400;
    for (let i = 0; i < proposals.length; i += chunkSize) {
      const chunk = proposals.slice(i, i + chunkSize);
      const productIds = [...new Set(chunk.map((proposal) => proposal.productId))];
      await prisma.$transaction([
        prisma.taxonomyRemapReview.deleteMany({
          where: {
            status: "pending",
            productId: { in: productIds },
          },
        }),
        prisma.taxonomyRemapReview.createMany({
          data: chunk.map((proposal) => ({
            id: proposal.id,
            status: "pending",
            source,
            runKey,
            productId: proposal.productId,
            fromCategory: proposal.fromCategory,
            fromSubcategory: proposal.fromSubcategory,
            fromGender: proposal.fromGender,
            toCategory: proposal.toCategory,
            toSubcategory: proposal.toSubcategory,
            toGender: proposal.toGender,
            confidence: proposal.confidence,
            reasons: proposal.reasons,
            seoCategoryHints: proposal.seoCategoryHints,
            sourceCount: proposal.sourceCount,
            scoreSupport: proposal.scoreSupport,
            marginRatio: proposal.marginRatio,
            imageCoverUrl: proposal.imageCoverUrl,
            sourceUrl: proposal.sourceUrl,
          })),
          skipDuplicates: true,
        }),
      ]);
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
      learningAcceptedSamples: 0,
      learningRejectedSamples: 0,
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
      learningAcceptedSamples: 0,
      learningRejectedSamples: 0,
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
