import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  GENDER_OPTIONS,
  SEASON_OPTIONS,
} from "@/lib/product-enrichment/constants";
import { getPublishedTaxonomyOptions } from "@/lib/taxonomy/server";

export type BulkOperation = "replace" | "add" | "remove" | "clear";
export type CurationField =
  | "category"
  | "subcategory"
  | "gender"
  | "season"
  | "stylePrimary"
  | "styleSecondary"
  | "styleTags"
  | "materialTags"
  | "patternTags"
  | "occasionTags"
  | "care"
  | "origin"
  | "editorialBadge";

export type CurationBadgeKind = "favorite" | "top_pick";

export type CurationBadgeValue = {
  kind: CurationBadgeKind;
  startPriority?: number | null;
};

export type CurationChange = {
  field: CurationField;
  op: BulkOperation;
  value: string | string[] | CurationBadgeValue | null;
};

type ScalarField =
  | "category"
  | "subcategory"
  | "gender"
  | "season"
  | "stylePrimary"
  | "styleSecondary"
  | "care"
  | "origin";

type ArrayField = "styleTags" | "materialTags" | "patternTags" | "occasionTags";

type ParsedCurationChange =
  | { field: ScalarField; op: "replace" | "clear"; kind: "scalar"; scalarValue: string | null }
  | { field: ArrayField; op: BulkOperation; kind: "array"; tagValues: string[] }
  | {
      field: "editorialBadge";
      op: "replace" | "clear";
      kind: "editorial";
      badgeKind: CurationBadgeKind | null;
      startPriority: number | null;
    };

type ParsedScalarChange = Extract<ParsedCurationChange, { kind: "scalar" }>;
type ParsedCategoryChange = ParsedScalarChange & { field: "category" };
type ParsedSubcategoryChange = ParsedScalarChange & { field: "subcategory" };

export type ApplyCurationChangesParams = {
  productIds: string[];
  changes: ParsedCurationChange[];
  actorEmail?: string | null;
  actorUserId?: string | null;
  source?: string | null;
  note?: string | null;
};

export type ApplyCurationChangesResult = {
  ok: true;
  updatedCount: number;
  unchangedCount: number;
  missingCount: number;
  missingIds: string[];
  changes: Array<{ field: CurationField; op: BulkOperation; value: unknown }>;
  globalUpdatedCount: number;
};

export const CURATION_MAX_PRODUCT_IDS = 1200;
export const CURATION_MAX_CHANGES = 20;
const TX_CHUNK_SIZE = 50;

export class CurationValidationError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;

  constructor(code: string, status = 400, details?: Record<string, unknown>) {
    super(code);
    this.name = "CurationValidationError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const isOperation = (value: unknown): value is BulkOperation => {
  return value === "replace" || value === "add" || value === "remove" || value === "clear";
};

const isField = (value: unknown): value is CurationField => {
  return (
    value === "category" ||
    value === "subcategory" ||
    value === "gender" ||
    value === "season" ||
    value === "stylePrimary" ||
    value === "styleSecondary" ||
    value === "styleTags" ||
    value === "materialTags" ||
    value === "patternTags" ||
    value === "occasionTags" ||
    value === "care" ||
    value === "origin" ||
    value === "editorialBadge"
  );
};

const isScalarField = (field: CurationField): field is ScalarField => {
  return (
    field === "category" ||
    field === "subcategory" ||
    field === "gender" ||
    field === "season" ||
    field === "stylePrimary" ||
    field === "styleSecondary" ||
    field === "care" ||
    field === "origin"
  );
};

const isArrayField = (field: CurationField): field is ArrayField => {
  return field === "styleTags" || field === "materialTags" || field === "patternTags" || field === "occasionTags";
};

const toUniqueStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[];
  const set = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const cleaned = item.trim();
    if (!cleaned) continue;
    set.add(cleaned);
  }
  return Array.from(set);
};

const toOptionalString = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length ? cleaned : null;
};

const normalizeTags = (values: string[]) => Array.from(new Set(values)).sort();

const ensureAllAllowed = (values: string[], allowed: Set<string>) => {
  const invalid = values.filter((value) => !allowed.has(value));
  return { ok: invalid.length === 0, invalid };
};

const toJsonValue = (value: Record<string, unknown>): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
};

export const normalizeProductIds = (value: unknown): string[] => {
  const set = new Set<string>();
  if (!Array.isArray(value)) return [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const cleaned = item.trim();
    if (!cleaned) continue;
    set.add(cleaned);
  }
  return Array.from(set);
};

export const coerceRawChanges = (body: unknown): unknown[] => {
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rawChanges = Array.isArray(payload.changes) ? payload.changes : [];
  if (rawChanges.length > 0) return rawChanges;
  return [
    {
      field: payload.field,
      op: payload.op ?? payload.mode ?? payload.operation,
      value: payload.value,
    },
  ];
};

export async function normalizeCurationChanges(rawChanges: unknown[]): Promise<ParsedCurationChange[]> {
  if (!Array.isArray(rawChanges) || rawChanges.length === 0) {
    throw new CurationValidationError("missing_changes");
  }
  if (rawChanges.length > CURATION_MAX_CHANGES) {
    throw new CurationValidationError("too_many_changes", 400, { limit: CURATION_MAX_CHANGES });
  }

  const taxonomy = await getPublishedTaxonomyOptions();

  const buildAllowedSet = (values: string[]) => new Set(values);
  const categorySet = buildAllowedSet(taxonomy.data.categories.map((entry) => entry.key));
  const subcategorySet = buildAllowedSet(
    taxonomy.data.categories.flatMap((entry) => (entry.subcategories ?? []).map((sub) => sub.key)),
  );
  const styleTagSet = buildAllowedSet(taxonomy.data.styleTags.map((entry) => entry.key));
  const materialSet = buildAllowedSet(taxonomy.data.materials.map((entry) => entry.key));
  const patternSet = buildAllowedSet(taxonomy.data.patterns.map((entry) => entry.key));
  const occasionSet = buildAllowedSet(taxonomy.data.occasions.map((entry) => entry.key));
  const genderSet = buildAllowedSet(GENDER_OPTIONS.map((entry) => entry.value));
  const seasonSet = buildAllowedSet(SEASON_OPTIONS.map((entry) => entry.value));
  const styleProfileSet = buildAllowedSet(taxonomy.styleProfiles.map((profile) => profile.key));

  const scalarFieldAllowed: Partial<Record<ScalarField, Set<string>>> = {
    category: categorySet,
    subcategory: subcategorySet,
    gender: genderSet,
    season: seasonSet,
    stylePrimary: styleProfileSet,
    styleSecondary: styleProfileSet,
  };

  const arrayFieldAllowed: Partial<Record<ArrayField, Set<string>>> = {
    styleTags: styleTagSet,
    materialTags: materialSet,
    patternTags: patternSet,
    occasionTags: occasionSet,
  };

  const seenFields = new Set<CurationField>();
  const parsed: ParsedCurationChange[] = [];

  for (const rawEntry of rawChanges) {
    const entry = rawEntry && typeof rawEntry === "object" ? (rawEntry as Record<string, unknown>) : {};
    const field = entry.field;
    if (!isField(field)) {
      throw new CurationValidationError("invalid_field", 400, { field });
    }
    if (seenFields.has(field)) {
      throw new CurationValidationError("duplicate_field", 400, { field });
    }
    seenFields.add(field);

    const op = entry.op ?? entry.mode ?? entry.operation;
    if (!isOperation(op)) {
      throw new CurationValidationError("invalid_operation", 400, { field, op });
    }

    if (field === "editorialBadge") {
      if (op === "add" || op === "remove") {
        throw new CurationValidationError("unsupported_operation", 400, { field, op });
      }
      if (op === "clear") {
        parsed.push({
          field,
          kind: "editorial",
          op,
          badgeKind: null,
          startPriority: null,
        });
        continue;
      }

      const value = entry.value;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new CurationValidationError("invalid_value", 400, { field, value });
      }
      const badgeValue = value as Record<string, unknown>;
      const kind = badgeValue.kind;
      if (kind !== "favorite" && kind !== "top_pick") {
        throw new CurationValidationError("invalid_value", 400, { field, kind });
      }

      const startPriorityRaw = badgeValue.startPriority;
      let startPriority: number | null = null;
      if (startPriorityRaw !== undefined && startPriorityRaw !== null && String(startPriorityRaw).trim() !== "") {
        const parsedNumber = Number(startPriorityRaw);
        if (!Number.isFinite(parsedNumber) || parsedNumber < 1) {
          throw new CurationValidationError("invalid_value", 400, { field, startPriority: startPriorityRaw });
        }
        startPriority = Math.floor(parsedNumber);
      }

      parsed.push({
        field,
        kind: "editorial",
        op,
        badgeKind: kind,
        startPriority,
      });
      continue;
    }

    if (isScalarField(field)) {
      if (op === "add" || op === "remove") {
        throw new CurationValidationError("unsupported_operation", 400, { field, op });
      }
      const scalarValue = op === "clear" ? null : toOptionalString(entry.value);
      if (op !== "clear" && !scalarValue) {
        throw new CurationValidationError("missing_value", 400, { field });
      }
      const allowed = scalarFieldAllowed[field];
      if (allowed && scalarValue && !allowed.has(scalarValue)) {
        throw new CurationValidationError("invalid_value", 400, { field, value: scalarValue });
      }
      parsed.push({ field, op, kind: "scalar", scalarValue });
      continue;
    }

    if (!isArrayField(field)) {
      throw new CurationValidationError("unsupported_field", 400, { field });
    }

    const tagValues = op === "clear" ? [] : normalizeTags(toUniqueStringArray(entry.value));
    if (op !== "clear" && tagValues.length === 0) {
      throw new CurationValidationError("missing_value", 400, { field });
    }
    const allowed = arrayFieldAllowed[field];
    if (!allowed) {
      throw new CurationValidationError("invalid_field_config", 400, { field });
    }
    const { ok, invalid } = ensureAllAllowed(tagValues, allowed);
    if (!ok) {
      throw new CurationValidationError("invalid_values", 400, { field, invalid });
    }

    parsed.push({ field, op, kind: "array", tagValues });
  }

  const categoryChange = parsed.find(
    (change): change is ParsedCategoryChange => change.kind === "scalar" && change.field === "category",
  );
  const subcategoryChange = parsed.find(
    (change): change is ParsedSubcategoryChange =>
      change.kind === "scalar" && change.field === "subcategory",
  );

  if (subcategoryChange && subcategoryChange.op === "replace" && subcategoryChange.scalarValue) {
    if (categoryChange?.op === "clear") {
      throw new CurationValidationError("subcategory_requires_category");
    }

    if (categoryChange?.op === "replace" && categoryChange.scalarValue) {
      const allowedSubs = taxonomy.subcategoryByCategory[categoryChange.scalarValue] ?? [];
      if (!allowedSubs.includes(subcategoryChange.scalarValue)) {
        throw new CurationValidationError("subcategory_not_in_category", 400, {
          category: categoryChange.scalarValue,
          subcategory: subcategoryChange.scalarValue,
        });
      }
    }
  }

  return parsed;
}

function arrayEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function buildRankMap(ids: string[]) {
  const map = new Map<string, number>();
  ids.forEach((id, index) => map.set(id, index + 1));
  return map;
}

function compactRankPlan({
  rankedIds,
  removeSet,
  insertIds,
  startPriority,
}: {
  rankedIds: string[];
  removeSet: Set<string>;
  insertIds: string[];
  startPriority: number | null;
}) {
  const existing = rankedIds.filter((id) => !removeSet.has(id));
  const cleanInsert = Array.from(new Set(insertIds.filter((id) => !existing.includes(id))));
  const insertAt = startPriority !== null ? Math.min(Math.max(startPriority - 1, 0), existing.length) : existing.length;
  const nextOrder = [
    ...existing.slice(0, insertAt),
    ...cleanInsert,
    ...existing.slice(insertAt),
  ];
  return buildRankMap(nextOrder);
}

function diffRankIds(oldMap: Map<string, number>, nextMap: Map<string, number>) {
  const changed = new Set<string>();
  const ids = new Set<string>([...Array.from(oldMap.keys()), ...Array.from(nextMap.keys())]);
  for (const id of ids) {
    const prev = oldMap.get(id) ?? null;
    const next = nextMap.get(id) ?? null;
    if (prev !== next) changed.add(id);
  }
  return changed;
}

function toAuditValue(change: ParsedCurationChange): unknown {
  if (change.kind === "array") {
    if (change.op === "clear") return null;
    return change.tagValues;
  }
  if (change.kind === "scalar") {
    if (change.op === "clear") return null;
    return change.scalarValue;
  }
  if (change.op === "clear") return null;
  return {
    kind: change.badgeKind,
    startPriority: change.startPriority,
  };
}

export async function applyCurationChanges({
  productIds,
  changes,
  actorEmail,
  actorUserId,
  source,
  note,
}: ApplyCurationChangesParams): Promise<ApplyCurationChangesResult> {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw new CurationValidationError("missing_product_ids");
  }
  if (productIds.length > CURATION_MAX_PRODUCT_IDS) {
    throw new CurationValidationError("too_many_product_ids", 400, { limit: CURATION_MAX_PRODUCT_IDS });
  }
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new CurationValidationError("missing_changes");
  }

  const taxonomy = await getPublishedTaxonomyOptions();

  const select = {
    id: true,
    metadata: true,
    category: true,
    subcategory: true,
    gender: true,
    season: true,
    stylePrimary: true,
    styleSecondary: true,
    styleTags: true,
    materialTags: true,
    patternTags: true,
    occasionTags: true,
    care: true,
    origin: true,
    editorialFavoriteRank: true,
    editorialTopPickRank: true,
  } as const;

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select,
  });

  const foundIds = new Set(products.map((product) => product.id));
  const missingIds = productIds.filter((id) => !foundIds.has(id));
  const foundProductIdsInTargetOrder = productIds.filter((id) => foundIds.has(id));

  const productById = new Map(products.map((product) => [product.id, product]));

  const categoryChange = changes.find(
    (change): change is ParsedCategoryChange => change.kind === "scalar" && change.field === "category",
  );
  const subcategoryChange = changes.find(
    (change): change is ParsedSubcategoryChange =>
      change.kind === "scalar" && change.field === "subcategory",
  );

  if (subcategoryChange && subcategoryChange.op === "replace" && subcategoryChange.scalarValue && !categoryChange) {
    const invalid: Array<{ id: string; category: string | null }> = [];
    for (const product of products) {
      const category = product.category ?? null;
      if (!category) {
        invalid.push({ id: product.id, category: null });
        continue;
      }
      const allowedSubs = taxonomy.subcategoryByCategory[category] ?? [];
      if (!allowedSubs.includes(subcategoryChange.scalarValue)) {
        invalid.push({ id: product.id, category });
      }
    }
    if (invalid.length > 0) {
      throw new CurationValidationError("subcategory_not_in_product_category", 400, {
        subcategory: subcategoryChange.scalarValue,
        invalidCount: invalid.length,
        sample: invalid.slice(0, 20),
      });
    }
  }

  const now = new Date();
  const finalDataById = new Map<string, Prisma.ProductUpdateInput>();
  const changedTargetIds = new Set<string>();

  for (const product of products) {
    const data: Prisma.ProductUpdateInput = {};
    let didChange = false;

    if (categoryChange || subcategoryChange) {
      const existingCategory = product.category ?? null;
      const existingSubcategory = product.subcategory ?? null;

      let nextCategory = existingCategory;
      let nextSubcategory = existingSubcategory;

      if (categoryChange) {
        nextCategory = categoryChange.op === "clear" ? null : categoryChange.scalarValue;
      }

      if (subcategoryChange) {
        if (subcategoryChange.op === "clear") {
          nextSubcategory = null;
        } else if (subcategoryChange.op === "replace" && subcategoryChange.scalarValue) {
          nextSubcategory = subcategoryChange.scalarValue;
        }
      }

      if (!nextCategory) {
        nextSubcategory = null;
      } else if (nextSubcategory) {
        const allowedSubs = taxonomy.subcategoryByCategory[nextCategory] ?? [];
        if (!allowedSubs.includes(nextSubcategory)) {
          nextSubcategory = null;
        }
      }

      if (existingCategory !== nextCategory) {
        didChange = true;
        data.category = nextCategory;
      }
      if (existingSubcategory !== nextSubcategory) {
        didChange = true;
        data.subcategory = nextSubcategory;
      }
    }

    for (const change of changes) {
      if (change.kind === "editorial") continue;
      if (change.kind === "scalar" && (change.field === "category" || change.field === "subcategory")) continue;

      if (change.kind === "array") {
        const existing = Array.isArray(product[change.field]) ? (product[change.field] as string[]) : [];
        const existingNorm = normalizeTags(existing);
        let next: string[] = existingNorm;

        if (change.op === "clear") next = [];
        if (change.op === "replace") next = change.tagValues;
        if (change.op === "add") next = normalizeTags([...existingNorm, ...change.tagValues]);
        if (change.op === "remove") {
          const removeSet = new Set(change.tagValues);
          next = existingNorm.filter((value) => !removeSet.has(value));
        }

        if (!arrayEqual(existingNorm, next)) {
          didChange = true;
          data[change.field] = next;
        }
        continue;
      }

      const existing = product[change.field] ?? null;
      const next = change.op === "clear" ? null : change.scalarValue;
      if (existing !== next) {
        didChange = true;
        data[change.field] = next;
      }
    }

    if (didChange) {
      finalDataById.set(product.id, data);
      changedTargetIds.add(product.id);
    }
  }

  const editorialChange = changes.find((change) => change.kind === "editorial") as
    | Extract<ParsedCurationChange, { kind: "editorial" }>
    | undefined;

  if (editorialChange) {
    const targetSet = new Set(foundProductIdsInTargetOrder);

    const [favoriteRows, topPickRows] = await Promise.all([
      prisma.product.findMany({
        where: { editorialFavoriteRank: { not: null } },
        select: { id: true, editorialFavoriteRank: true },
        orderBy: [{ editorialFavoriteRank: "asc" }, { id: "asc" }],
      }),
      prisma.product.findMany({
        where: { editorialTopPickRank: { not: null } },
        select: { id: true, editorialTopPickRank: true },
        orderBy: [{ editorialTopPickRank: "asc" }, { id: "asc" }],
      }),
    ]);

    const oldFavoriteMap = new Map<string, number>(
      favoriteRows
        .filter((row): row is { id: string; editorialFavoriteRank: number } => typeof row.editorialFavoriteRank === "number")
        .map((row) => [row.id, row.editorialFavoriteRank]),
    );
    const oldTopPickMap = new Map<string, number>(
      topPickRows
        .filter((row): row is { id: string; editorialTopPickRank: number } => typeof row.editorialTopPickRank === "number")
        .map((row) => [row.id, row.editorialTopPickRank]),
    );

    const favoriteRankedIds = favoriteRows.map((row) => row.id);
    const topPickRankedIds = topPickRows.map((row) => row.id);

    let nextFavoriteMap = oldFavoriteMap;
    let nextTopPickMap = oldTopPickMap;

    if (editorialChange.op === "clear") {
      nextFavoriteMap = compactRankPlan({
        rankedIds: favoriteRankedIds,
        removeSet: targetSet,
        insertIds: [],
        startPriority: null,
      });
      nextTopPickMap = compactRankPlan({
        rankedIds: topPickRankedIds,
        removeSet: targetSet,
        insertIds: [],
        startPriority: null,
      });
    } else if (editorialChange.badgeKind === "favorite") {
      nextFavoriteMap = compactRankPlan({
        rankedIds: favoriteRankedIds,
        removeSet: targetSet,
        insertIds: foundProductIdsInTargetOrder,
        startPriority: editorialChange.startPriority,
      });
      nextTopPickMap = compactRankPlan({
        rankedIds: topPickRankedIds,
        removeSet: targetSet,
        insertIds: [],
        startPriority: null,
      });
    } else {
      nextTopPickMap = compactRankPlan({
        rankedIds: topPickRankedIds,
        removeSet: targetSet,
        insertIds: foundProductIdsInTargetOrder,
        startPriority: editorialChange.startPriority,
      });
      nextFavoriteMap = compactRankPlan({
        rankedIds: favoriteRankedIds,
        removeSet: targetSet,
        insertIds: [],
        startPriority: null,
      });
    }

    const changedFavoriteIds = diffRankIds(oldFavoriteMap, nextFavoriteMap);
    const changedTopPickIds = diffRankIds(oldTopPickMap, nextTopPickMap);

    const applyRankPatch = (
      id: string,
      key: "editorialFavoriteRank" | "editorialTopPickRank",
      value: number | null,
    ) => {
      const current = finalDataById.get(id) ?? {};
      current[key] = value;
      current.editorialUpdatedAt = now;
      finalDataById.set(id, current);
      if (targetSet.has(id)) {
        changedTargetIds.add(id);
      }
    };

    for (const id of changedFavoriteIds) {
      applyRankPatch(id, "editorialFavoriteRank", nextFavoriteMap.get(id) ?? null);
    }

    for (const id of changedTopPickIds) {
      applyRankPatch(id, "editorialTopPickRank", nextTopPickMap.get(id) ?? null);
    }
  }

  const auditChanges = changes.map((change) => ({
    field: change.field,
    op: change.op,
    value: toAuditValue(change),
  }));

  const auditAction: Record<string, unknown> = {
    updatedAt: now.toISOString(),
    updatedBy: actorEmail ?? null,
    updatedByUserId: actorUserId ?? null,
    changes: auditChanges,
  };
  if (source) {
    auditAction.source = source;
  }
  if (note) {
    auditAction.note = note;
  }

  for (const productId of changedTargetIds) {
    const product = productById.get(productId);
    if (!product) continue;
    const existingMetadata =
      product.metadata && typeof product.metadata === "object" && !Array.isArray(product.metadata)
        ? (product.metadata as Record<string, unknown>)
        : {};
    const nextMetadata = {
      ...existingMetadata,
      enrichment_human: auditAction,
    };

    const data = finalDataById.get(productId) ?? {};
    data.metadata = toJsonValue(nextMetadata);
    finalDataById.set(productId, data);
  }

  const updates: Prisma.PrismaPromise<{ id: string }>[] = [];
  for (const [productId, data] of finalDataById.entries()) {
    updates.push(
      prisma.product.update({
        where: { id: productId },
        data,
        select: { id: true },
      }),
    );
  }

  for (let i = 0; i < updates.length; i += TX_CHUNK_SIZE) {
    await prisma.$transaction(updates.slice(i, i + TX_CHUNK_SIZE));
  }

  return {
    ok: true,
    updatedCount: changedTargetIds.size,
    unchangedCount: products.length - changedTargetIds.size,
    missingCount: missingIds.length,
    missingIds,
    changes: auditChanges,
    globalUpdatedCount: finalDataById.size,
  };
}

export type { ParsedCurationChange };
