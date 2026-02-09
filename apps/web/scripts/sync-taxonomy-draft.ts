import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

import {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_OPTIONS,
  MATERIAL_TAGS,
  MATERIAL_TAG_FRIENDLY,
  OCCASION_TAGS,
  OCCASION_TAG_FRIENDLY,
  PATTERN_TAGS,
  PATTERN_TAG_FRIENDLY,
  STYLE_TAGS,
  STYLE_TAG_FRIENDLY,
  SUBCATEGORY_DESCRIPTIONS,
} from "@/lib/product-enrichment/constants";
import type { TaxonomyDataV1, TaxonomyTerm } from "../src/lib/taxonomy/types";
import { parseTaxonomyDataV1 } from "../src/lib/taxonomy/validate";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env.local") });

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL_UNPOOLED/DATABASE_URL in environment (.env/.env.local).");
}

const toTerm = (key: string, label: string, description?: string | null, sortOrder?: number): TaxonomyTerm => ({
  key,
  label,
  description: description ?? null,
  synonyms: [],
  isActive: true,
  ...(typeof sortOrder === "number" ? { sortOrder } : {}),
});

const normalizeTerms = <T extends TaxonomyTerm>(terms: T[]): T[] =>
  (terms ?? [])
    .slice()
    .sort((a, b) => {
      const aOrder = typeof a.sortOrder === "number" ? a.sortOrder : Number.POSITIVE_INFINITY;
      const bOrder = typeof b.sortOrder === "number" ? b.sortOrder : Number.POSITIVE_INFINITY;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.key.localeCompare(b.key);
    });

const normalizeData = (data: TaxonomyDataV1): TaxonomyDataV1 => ({
  ...data,
  categories: normalizeTerms(data.categories).map((cat) => ({
    ...cat,
    subcategories: normalizeTerms(cat.subcategories ?? []),
  })),
  materials: normalizeTerms(data.materials ?? []),
  patterns: normalizeTerms(data.patterns ?? []),
  occasions: normalizeTerms(data.occasions ?? []),
  styleTags: normalizeTerms(data.styleTags ?? []),
});

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function buildBaseTaxonomyDataV1(): TaxonomyDataV1 {
  return {
    schemaVersion: 1,
    categories: CATEGORY_OPTIONS.map((category, categoryIndex) => ({
      key: category.value,
      label: category.label,
      description: CATEGORY_DESCRIPTIONS[category.value] ?? null,
      synonyms: [],
      isActive: true,
      sortOrder: categoryIndex,
      subcategories: category.subcategories.map((subcategory, subIndex) =>
        toTerm(
          subcategory.value,
          subcategory.label,
          SUBCATEGORY_DESCRIPTIONS[subcategory.value] ?? null,
          subIndex,
        ),
      ),
    })),
    materials: MATERIAL_TAGS.map((key, index) => toTerm(key, MATERIAL_TAG_FRIENDLY[key] ?? key, null, index)),
    patterns: PATTERN_TAGS.map((key, index) => toTerm(key, PATTERN_TAG_FRIENDLY[key] ?? key, null, index)),
    occasions: OCCASION_TAGS.map((key, index) => toTerm(key, OCCASION_TAG_FRIENDLY[key] ?? key, null, index)),
    styleTags: STYLE_TAGS.map((key, index) => toTerm(key, STYLE_TAG_FRIENDLY[key] ?? key, null, index)),
  };
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

  return { changed, data: normalizeData(changed ? next : params.draft) };
}

function collectKeys(data: TaxonomyDataV1) {
  return {
    categories: new Set(data.categories.map((entry) => entry.key)),
    subcategories: new Set(data.categories.flatMap((entry) => (entry.subcategories ?? []).map((sub) => sub.key))),
    materials: new Set(data.materials.map((entry) => entry.key)),
    patterns: new Set(data.patterns.map((entry) => entry.key)),
    occasions: new Set(data.occasions.map((entry) => entry.key)),
    styleTags: new Set(data.styleTags.map((entry) => entry.key)),
  };
}

async function ensureTable(client: pg.Client) {
  // Match the server-side helper. If the role can't CREATE, this should still be safe.
  await client.query(`
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
  await client.query(`
    create unique index if not exists "taxonomy_snapshots_status_version_key"
    on "taxonomy_snapshots"("status","version");
  `);
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await ensureTable(client);

    const base = normalizeData(parseTaxonomyDataV1(buildBaseTaxonomyDataV1()));

    const published = await client.query(
      `select version, data from "taxonomy_snapshots" where status='published' order by version desc limit 1`,
    );
    const publishedVersion = published.rows[0]?.version ?? 0;

    const draftRes = await client.query(
      `select id, version, data, "updatedAt" as updated_at from "taxonomy_snapshots" where status='draft' order by version desc limit 1`,
    );

    if (draftRes.rowCount === 0) {
      const id = crypto.randomUUID();
      const version = publishedVersion + 1;
      await client.query(
        `insert into "taxonomy_snapshots" (id, status, version, data, "updatedAt") values ($1, 'draft', $2, $3::jsonb, now())`,
        [id, version, JSON.stringify(base)],
      );
      console.log(JSON.stringify({ ok: true, action: "created_draft", id, version }, null, 2));
      return;
    }

    const draftRow = draftRes.rows[0] as { id: string; version: number; data: unknown; updated_at: Date | null };

    let parsedDraft: TaxonomyDataV1;
    try {
      parsedDraft = normalizeData(parseTaxonomyDataV1(draftRow.data));
    } catch (err) {
      // If the draft is invalid, reset it to base to unblock publishing.
      parsedDraft = base;
      await client.query(
        `update "taxonomy_snapshots" set data=$1::jsonb, "updatedAt"=now() where id=$2`,
        [JSON.stringify(base), draftRow.id],
      );
      console.log(JSON.stringify({ ok: true, action: "reset_invalid_draft", id: draftRow.id, version: draftRow.version }, null, 2));
      return;
    }

    const beforeKeys = collectKeys(parsedDraft);
    const merged = mergeDraftWithBaseAdditions({ draft: parsedDraft, base });
    const afterKeys = collectKeys(merged.data);

    const missingBefore = {
      categories: [...collectKeys(base).categories].filter((k) => !beforeKeys.categories.has(k)),
      subcategories: [...collectKeys(base).subcategories].filter((k) => !beforeKeys.subcategories.has(k)),
      materials: [...collectKeys(base).materials].filter((k) => !beforeKeys.materials.has(k)),
      patterns: [...collectKeys(base).patterns].filter((k) => !beforeKeys.patterns.has(k)),
      occasions: [...collectKeys(base).occasions].filter((k) => !beforeKeys.occasions.has(k)),
      styleTags: [...collectKeys(base).styleTags].filter((k) => !beforeKeys.styleTags.has(k)),
    };

    const missingAfter = {
      categories: [...collectKeys(base).categories].filter((k) => !afterKeys.categories.has(k)),
      subcategories: [...collectKeys(base).subcategories].filter((k) => !afterKeys.subcategories.has(k)),
      materials: [...collectKeys(base).materials].filter((k) => !afterKeys.materials.has(k)),
      patterns: [...collectKeys(base).patterns].filter((k) => !afterKeys.patterns.has(k)),
      occasions: [...collectKeys(base).occasions].filter((k) => !afterKeys.occasions.has(k)),
      styleTags: [...collectKeys(base).styleTags].filter((k) => !afterKeys.styleTags.has(k)),
    };

    if (!merged.changed) {
      console.log(JSON.stringify({ ok: true, action: "noop", id: draftRow.id, version: draftRow.version }, null, 2));
      return;
    }

    await client.query(
      `update "taxonomy_snapshots" set data=$1::jsonb, "updatedAt"=now() where id=$2`,
      [JSON.stringify(merged.data), draftRow.id],
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          action: "merged_base_additions",
          id: draftRow.id,
          version: draftRow.version,
          missing_before: Object.fromEntries(Object.entries(missingBefore).map(([k, v]) => [k, v.length])),
          missing_after: Object.fromEntries(Object.entries(missingAfter).map(([k, v]) => [k, v.length])),
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

