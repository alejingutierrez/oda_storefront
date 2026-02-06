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

  const existing = await loadLatestSnapshot("draft");
  if (existing) return existing;

  const published = await getPublishedTaxonomyMeta();
  const version = published.version + 1;

  const created = await prisma.taxonomySnapshot.create({
    data: {
      status: "draft",
      version,
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
  const categoryKeySet = new Set(draft.data.categories.map((entry) => entry.key));
  const missingRequired = requiredCategoryKeys.filter((key) => !categoryKeySet.has(key));
  if (missingRequired.length > 0) {
    return {
      ok: false,
      error: "missing_required_categories" as const,
      details: { missing: missingRequired },
    };
  }

  const published = await getPublishedTaxonomyMeta();
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
