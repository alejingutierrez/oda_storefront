import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildBaseTaxonomyDataV1 } from "./base";
import type { StyleProfileRow, TaxonomyDataV1, TaxonomyOptions, TaxonomyStage, TaxonomyTerm } from "./types";
import { parseTaxonomyDataV1 } from "./validate";

type SnapshotMeta = {
  source: "db" | "base";
  version: number;
  updatedAt: Date | null;
  data: TaxonomyDataV1;
};

let cachedOptions: { value: TaxonomyOptions; expiresAt: number } | null = null;
let taxonomySnapshotsTableState: "unknown" | "missing" | "ready" = "unknown";

export function invalidateTaxonomyCache() {
  cachedOptions = null;
}

function isMissingTableError(err: unknown, tableName: string) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code === "P2021" || err.code === "P2022";
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes("does not exist") && msg.includes(tableName);
  }
  return false;
}

export async function ensureTaxonomySnapshotsTable() {
  if (taxonomySnapshotsTableState === "ready") return;

  // Avoid running CREATE statements on environments where the table already exists but the runtime role
  // does not have CREATE privileges (common with pooled/proxied DB users).
  try {
    const rows = await prisma.$queryRaw<Array<{ name: string | null }>>(Prisma.sql`
      select to_regclass('public.taxonomy_snapshots') as name
    `);
    if (rows?.[0]?.name) {
      taxonomySnapshotsTableState = "ready";
      return;
    }
  } catch (err) {
    console.warn("[taxonomy] to_regclass check failed", err);
  }

  // We cannot rely on Prisma migrations here because the target DB may have drift.
  // This is an additive, idempotent DDL guarded behind admin endpoints.
  await prisma.$executeRaw(Prisma.sql`
    create table if not exists "taxonomy_snapshots" (
      "id" text not null,
      "status" text not null,
      "version" integer not null,
      "data" jsonb not null,
      "createdAt" timestamp(3) not null default current_timestamp,
      "updatedAt" timestamp(3),
      "publishedAt" timestamp(3),
      "createdBy" text,
      constraint "taxonomy_snapshots_pkey" primary key ("id")
    );
  `);

  await prisma.$executeRaw(Prisma.sql`
    create unique index if not exists "taxonomy_snapshots_status_version_key"
    on "taxonomy_snapshots"("status","version");
  `);

  await prisma.$executeRaw(Prisma.sql`
    create index if not exists "taxonomy_snapshots_status_version_idx"
    on "taxonomy_snapshots"("status","version");
  `);

  taxonomySnapshotsTableState = "ready";
}

function normalizeTerms<T extends TaxonomyTerm>(terms: T[]): T[] {
  return (terms ?? [])
    .slice()
    .sort((a, b) => {
      const aOrder = typeof a.sortOrder === "number" ? a.sortOrder : Number.POSITIVE_INFINITY;
      const bOrder = typeof b.sortOrder === "number" ? b.sortOrder : Number.POSITIVE_INFINITY;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.key.localeCompare(b.key);
    });
}

function normalizeData(data: TaxonomyDataV1): TaxonomyDataV1 {
  return {
    ...data,
    categories: normalizeTerms(data.categories).map((cat) => ({
      ...cat,
      subcategories: normalizeTerms(cat.subcategories ?? []),
    })),
    materials: normalizeTerms(data.materials ?? []),
    patterns: normalizeTerms(data.patterns ?? []),
    occasions: normalizeTerms(data.occasions ?? []),
    styleTags: normalizeTerms(data.styleTags ?? []),
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergeDraftWithBaseAdditions(params: { draft: TaxonomyDataV1; base: TaxonomyDataV1 }) {
  // Only add missing keys from base. Never overwrite draft edits.
  const next = cloneJson(params.draft);
  const base = params.base;
  let changed = false;

  const nextCategoryByKey = new Map(next.categories.map((entry) => [entry.key, entry]));
  for (const baseCategory of base.categories ?? []) {
    const existingCategory = nextCategoryByKey.get(baseCategory.key);
    if (!existingCategory) {
      next.categories.push(cloneJson(baseCategory));
      nextCategoryByKey.set(baseCategory.key, next.categories[next.categories.length - 1]);
      changed = true;
      continue;
    }

    const existingSubs = existingCategory.subcategories ?? [];
    const existingSubKeys = new Set(existingSubs.map((sub) => sub.key));
    for (const baseSub of baseCategory.subcategories ?? []) {
      if (existingSubKeys.has(baseSub.key)) continue;
      existingSubs.push(cloneJson(baseSub));
      existingSubKeys.add(baseSub.key);
      changed = true;
    }
    existingCategory.subcategories = existingSubs;
  }

  const mergeList = (key: "materials" | "patterns" | "occasions" | "styleTags") => {
    const existing = (next[key] ?? []) as Array<{ key: string }>;
    const existingKeys = new Set(existing.map((entry) => entry.key));
    for (const baseEntry of (base[key] ?? []) as Array<{ key: string }>) {
      if (existingKeys.has(baseEntry.key)) continue;
      (existing as any).push(cloneJson(baseEntry));
      existingKeys.add(baseEntry.key);
      changed = true;
    }
    (next as any)[key] = existing;
  };

  mergeList("materials");
  mergeList("patterns");
  mergeList("occasions");
  mergeList("styleTags");

  return { changed, data: changed ? normalizeData(next) : normalizeData(params.draft) };
}

async function loadLatestSnapshot(status: TaxonomyStage): Promise<SnapshotMeta | null> {
  if (taxonomySnapshotsTableState === "missing") return null;
  try {
    const row = await prisma.taxonomySnapshot.findFirst({
      where: { status },
      orderBy: { version: "desc" },
      select: { version: true, data: true, updatedAt: true },
    });
    if (!row) return null;
    const parsed = parseTaxonomyDataV1(row.data);
    return {
      source: "db",
      version: row.version,
      updatedAt: row.updatedAt,
      data: normalizeData(parsed),
    };
  } catch (err) {
    if (isMissingTableError(err, "taxonomy_snapshots")) {
      taxonomySnapshotsTableState = "missing";
      return null;
    }
    console.warn("[taxonomy] failed to load snapshot", { status, err });
    return null;
  }
}

export async function getPublishedTaxonomyMeta(): Promise<SnapshotMeta> {
  const published = await loadLatestSnapshot("published");
  if (published) return published;
  return {
    source: "base",
    version: 0,
    updatedAt: null,
    data: buildBaseTaxonomyDataV1(),
  };
}

export async function getOrCreateDraftTaxonomyMeta(params: { adminEmail?: string | null }): Promise<SnapshotMeta> {
  await ensureTaxonomySnapshotsTable();

  const published = await getPublishedTaxonomyMeta();
  const desiredVersion = published.version + 1;

  const draftRow = await prisma.taxonomySnapshot.findFirst({
    where: { status: "draft" },
    orderBy: { version: "desc" },
    select: { id: true, version: true, data: true, updatedAt: true },
  });

  if (draftRow) {
    try {
      const parsed = normalizeData(parseTaxonomyDataV1(draftRow.data));
      const merged = mergeDraftWithBaseAdditions({ draft: parsed, base: published.data });
      if (merged.changed) {
        const updated = await prisma.taxonomySnapshot.update({
          where: { id: draftRow.id },
          data: {
            data: JSON.parse(JSON.stringify(merged.data)),
            createdBy: params.adminEmail ?? null,
            updatedAt: new Date(),
          },
          select: { version: true, updatedAt: true },
        });
        return {
          source: "db",
          version: updated.version,
          updatedAt: updated.updatedAt,
          data: merged.data,
        };
      }
      return {
        source: "db",
        version: draftRow.version,
        updatedAt: draftRow.updatedAt,
        data: parsed,
      };
    } catch (err) {
      console.warn("[taxonomy] invalid draft snapshot, resetting to published", err);
      const updated = await prisma.taxonomySnapshot.update({
        where: { id: draftRow.id },
        data: {
          // Keep the current draft version to avoid unique collisions; saveDraftTaxonomy will realign later.
          data: JSON.parse(JSON.stringify(published.data)),
          createdBy: params.adminEmail ?? null,
          updatedAt: new Date(),
        },
        select: { version: true, data: true, updatedAt: true },
      });
      return {
        source: "db",
        version: updated.version,
        updatedAt: updated.updatedAt,
        data: normalizeData(parseTaxonomyDataV1(updated.data)),
      };
    }
  }

  const created = await prisma.taxonomySnapshot.create({
    data: {
      status: "draft",
      version: desiredVersion,
      data: JSON.parse(JSON.stringify(published.data)),
      createdBy: params.adminEmail ?? null,
      updatedAt: new Date(),
    },
    select: { version: true, data: true, updatedAt: true },
  });

  return {
    source: "db",
    version: created.version,
    updatedAt: created.updatedAt,
    data: normalizeData(parseTaxonomyDataV1(created.data)),
  };
}

export async function saveDraftTaxonomy(params: { adminEmail?: string | null; data: unknown }) {
  await ensureTaxonomySnapshotsTable();

  const parsed = normalizeData(parseTaxonomyDataV1(params.data));
  const published = await getPublishedTaxonomyMeta();
  const version = published.version + 1;

  const existingDraft = await prisma.taxonomySnapshot.findFirst({
    where: { status: "draft" },
    orderBy: { version: "desc" },
    select: { id: true },
  });

  if (!existingDraft) {
    const created = await prisma.taxonomySnapshot.create({
      data: {
        status: "draft",
        version,
        data: JSON.parse(JSON.stringify(parsed)),
        createdBy: params.adminEmail ?? null,
        updatedAt: new Date(),
      },
      select: { version: true, updatedAt: true },
    });
    invalidateTaxonomyCache();
    return { ok: true, version: created.version, updatedAt: created.updatedAt };
  }

  const updated = await prisma.taxonomySnapshot.update({
    where: { id: existingDraft.id },
    data: {
      version,
      data: JSON.parse(JSON.stringify(parsed)),
      createdBy: params.adminEmail ?? null,
      updatedAt: new Date(),
    },
    select: { version: true, updatedAt: true },
  });

  invalidateTaxonomyCache();
  return { ok: true, version: updated.version, updatedAt: updated.updatedAt };
}

export async function publishDraftTaxonomy(params: { adminEmail?: string | null }) {
  await ensureTaxonomySnapshotsTable();

  const draft = await loadLatestSnapshot("draft");
  if (!draft) {
    return { ok: false, error: "missing_draft" as const };
  }

  const categoryByKey = new Map(draft.data.categories.map((entry) => [entry.key, entry]));

  const activeStyleTags = draft.data.styleTags.filter((tag) => tag.isActive !== false);
  if (activeStyleTags.length < 10) {
    return {
      ok: false,
      error: "style_tags_min_10_active" as const,
      details: { activeCount: activeStyleTags.length },
    };
  }

  const requiredCategoryKeys = [
    "joyeria_y_bisuteria",
    "calzado",
    "bolsos_y_marroquineria",
    "gafas_y_optica",
    "accesorios_textiles_y_medias",
  ];
  const missingRequired = requiredCategoryKeys.filter((key) => !categoryByKey.has(key));
  if (missingRequired.length > 0) {
    return {
      ok: false,
      error: "missing_required_categories" as const,
      details: { missing: missingRequired },
    };
  }

  const inactiveRequired = requiredCategoryKeys.filter((key) => categoryByKey.get(key)?.isActive === false);
  if (inactiveRequired.length > 0) {
    return {
      ok: false,
      error: "required_categories_inactive" as const,
      details: { inactive: inactiveRequired },
    };
  }

  const requiredMissingSubcategories = requiredCategoryKeys.filter((key) => {
    const category = categoryByKey.get(key);
    if (!category) return true;
    const activeSubs = (category.subcategories ?? []).filter((sub) => sub.isActive !== false);
    return activeSubs.length === 0;
  });
  if (requiredMissingSubcategories.length > 0) {
    return {
      ok: false,
      error: "required_categories_missing_active_subcategories" as const,
      details: { categories: requiredMissingSubcategories },
    };
  }

  const activeCategoriesMissingSubcategories = draft.data.categories
    .filter((category) => category.isActive !== false)
    .filter((category) => (category.subcategories ?? []).every((sub) => sub.isActive === false))
    .map((category) => category.key);
  if (activeCategoriesMissingSubcategories.length > 0) {
    return {
      ok: false,
      error: "categories_missing_active_subcategories" as const,
      details: { categories: activeCategoriesMissingSubcategories },
    };
  }

  const published = await getPublishedTaxonomyMeta();

  const collectKeys = (data: TaxonomyDataV1) => ({
    categories: new Set(data.categories.map((entry) => entry.key)),
    subcategories: new Set(
      data.categories.flatMap((entry) => (entry.subcategories ?? []).map((sub) => sub.key)),
    ),
    materials: new Set(data.materials.map((entry) => entry.key)),
    patterns: new Set(data.patterns.map((entry) => entry.key)),
    occasions: new Set(data.occasions.map((entry) => entry.key)),
    styleTags: new Set(data.styleTags.map((entry) => entry.key)),
  });

  const publishedKeys = collectKeys(published.data);
  const draftKeys = collectKeys(draft.data);
  const removed: Record<string, string[]> = {};

  const diffMissing = (name: string, prev: Set<string>, next: Set<string>) => {
    const missing: string[] = [];
    for (const key of prev) {
      if (!next.has(key)) missing.push(key);
    }
    if (missing.length > 0) removed[name] = missing.sort();
  };

  diffMissing("categories", publishedKeys.categories, draftKeys.categories);
  diffMissing("subcategories", publishedKeys.subcategories, draftKeys.subcategories);
  diffMissing("materials", publishedKeys.materials, draftKeys.materials);
  diffMissing("patterns", publishedKeys.patterns, draftKeys.patterns);
  diffMissing("occasions", publishedKeys.occasions, draftKeys.occasions);
  diffMissing("styleTags", publishedKeys.styleTags, draftKeys.styleTags);

  if (Object.keys(removed).length > 0) {
    return {
      ok: false,
      error: "taxonomy_keys_removed" as const,
      details: {
        removed,
        note: "No borres keys. Para deprecarlas, mantenlas y marca isActive=false.",
      },
    };
  }

  const nextVersion = published.version + 1;
  const now = new Date();

  await prisma.taxonomySnapshot.create({
    data: {
      status: "published",
      version: nextVersion,
      data: JSON.parse(JSON.stringify(draft.data)),
      createdBy: params.adminEmail ?? null,
      publishedAt: now,
      updatedAt: now,
    },
    select: { id: true },
  });

  // Move the draft forward so it represents "next" edits, without losing the content.
  const latestDraftRow = await prisma.taxonomySnapshot.findFirst({
    where: { status: "draft" },
    orderBy: { version: "desc" },
    select: { id: true },
  });
  if (latestDraftRow) {
    await prisma.taxonomySnapshot.update({
      where: { id: latestDraftRow.id },
      data: { version: nextVersion + 1, updatedAt: now, createdBy: params.adminEmail ?? null },
      select: { id: true },
    });
  }

  invalidateTaxonomyCache();
  return { ok: true, version: nextVersion, publishedAt: now.toISOString() };
}

export async function getStyleProfiles(): Promise<StyleProfileRow[]> {
  const rows = await prisma.styleProfile.findMany({
    orderBy: { key: "asc" },
    select: { key: true, label: true, tags: true },
  });
  return rows.map((row) => ({ key: row.key, label: row.label, tags: row.tags ?? [] }));
}

function buildLabelMap(entries: Array<{ key: string; label: string }>) {
  const map: Record<string, string> = {};
  for (const entry of entries) {
    map[entry.key] = entry.label;
  }
  return map;
}

function buildTaxonomyMaps(data: TaxonomyDataV1) {
  const categoryLabels = buildLabelMap(data.categories);
  const subcategoryLabels: Record<string, string> = {};
  const subcategoryByCategory: Record<string, string[]> = {};

  for (const category of data.categories) {
    const subs = category.subcategories ?? [];
    subcategoryByCategory[category.key] = subs.map((sub) => sub.key);
    for (const sub of subs) {
      subcategoryLabels[sub.key] = sub.label;
    }
  }

  return {
    categoryLabels,
    subcategoryLabels,
    subcategoryByCategory,
    materialLabels: buildLabelMap(data.materials),
    patternLabels: buildLabelMap(data.patterns),
    occasionLabels: buildLabelMap(data.occasions),
    styleTagLabels: buildLabelMap(data.styleTags),
  };
}

export async function getPublishedTaxonomyOptions(): Promise<TaxonomyOptions> {
  const now = Date.now();
  if (cachedOptions && cachedOptions.expiresAt > now) return cachedOptions.value;

  const [taxonomy, styleProfiles] = await Promise.all([getPublishedTaxonomyMeta(), getStyleProfiles()]);
  const maps = buildTaxonomyMaps(taxonomy.data);
  const styleProfileLabels = buildLabelMap(styleProfiles);

  const value: TaxonomyOptions = {
    source: taxonomy.source,
    version: taxonomy.version,
    updatedAt: taxonomy.updatedAt ? taxonomy.updatedAt.toISOString() : null,
    data: taxonomy.data,
    ...maps,
    styleProfiles,
    styleProfileLabels,
  };

  cachedOptions = { value, expiresAt: now + 30_000 };
  return value;
}
