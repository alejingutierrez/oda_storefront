import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  GENDER_OPTIONS,
  SEASON_OPTIONS,
} from "@/lib/product-enrichment/constants";
import { getPublishedTaxonomyOptions } from "@/lib/taxonomy/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type BulkOperation = "replace" | "add" | "remove" | "clear";
type BulkField =
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
  | "origin";

type ParsedChange =
  | { field: BulkField; op: BulkOperation; kind: "array"; tagValues: string[] }
  | { field: BulkField; op: BulkOperation; kind: "scalar"; scalarValue: string | null };

const MAX_PRODUCT_IDS = 1200;
const MAX_CHANGES = 20;
const TX_CHUNK_SIZE = 50;

const toUniqueStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  const set = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    set.add(trimmed);
  }
  return Array.from(set);
};

const toOptionalString = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const isOperation = (value: unknown): value is BulkOperation => {
  return value === "replace" || value === "add" || value === "remove" || value === "clear";
};

const isField = (value: unknown): value is BulkField => {
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
    value === "origin"
  );
};

const arrayEqual = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const normalizeTags = (values: string[]) => Array.from(new Set(values)).sort();

const ensureAllAllowed = (values: string[], allowed: Set<string>) => {
  const invalid = values.filter((value) => !allowed.has(value));
  return { ok: invalid.length === 0, invalid };
};

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const productIdsRaw = Array.isArray(body?.productIds) ? body.productIds : [];
  const productIds = toUniqueStringArray(productIdsRaw);
  if (!productIds.length) {
    return NextResponse.json({ error: "missing_product_ids" }, { status: 400 });
  }
  if (productIds.length > MAX_PRODUCT_IDS) {
    return NextResponse.json({ error: "too_many_product_ids" }, { status: 400 });
  }

  const taxonomy = await getPublishedTaxonomyOptions();

  const buildAllowedSet = (values: string[]) => new Set(values);
  const CATEGORY_SET = buildAllowedSet(taxonomy.data.categories.map((entry) => entry.key));
  const SUBCATEGORY_SET = buildAllowedSet(
    taxonomy.data.categories.flatMap((entry) => (entry.subcategories ?? []).map((sub) => sub.key)),
  );
  const SUBCATEGORY_TO_CATEGORY: Record<string, string> = {};
  for (const [categoryKey, subKeys] of Object.entries(taxonomy.subcategoryByCategory ?? {})) {
    for (const subKey of subKeys ?? []) {
      if (!subKey || typeof subKey !== "string") continue;
      SUBCATEGORY_TO_CATEGORY[subKey] = categoryKey;
    }
  }
  const STYLE_TAG_SET = buildAllowedSet(taxonomy.data.styleTags.map((entry) => entry.key));
  const MATERIAL_SET = buildAllowedSet(taxonomy.data.materials.map((entry) => entry.key));
  const PATTERN_SET = buildAllowedSet(taxonomy.data.patterns.map((entry) => entry.key));
  const OCCASION_SET = buildAllowedSet(taxonomy.data.occasions.map((entry) => entry.key));
  const GENDER_SET = buildAllowedSet(GENDER_OPTIONS.map((entry) => entry.value));
  const SEASON_SET = buildAllowedSet(SEASON_OPTIONS.map((entry) => entry.value));
  const STYLE_PROFILE_SET = buildAllowedSet(taxonomy.styleProfiles.map((profile) => profile.key));

  const scalarFieldAllowed: Partial<Record<BulkField, Set<string>>> = {
    category: CATEGORY_SET,
    subcategory: SUBCATEGORY_SET,
    gender: GENDER_SET,
    season: SEASON_SET,
    stylePrimary: STYLE_PROFILE_SET,
    styleSecondary: STYLE_PROFILE_SET,
  };

  const arrayFieldAllowed: Partial<Record<BulkField, Set<string>>> = {
    styleTags: STYLE_TAG_SET,
    materialTags: MATERIAL_SET,
    patternTags: PATTERN_SET,
    occasionTags: OCCASION_SET,
  };

  const isScalarField = (field: BulkField) =>
    field === "care" || field === "origin" || Boolean(scalarFieldAllowed[field]);
  const isArrayField = (field: BulkField) => Boolean(arrayFieldAllowed[field]);

  const rawChanges: Array<any> = Array.isArray(body?.changes) ? body.changes : [];
  const candidateChanges =
    rawChanges.length > 0
      ? rawChanges.map((entry) => ({
          field: entry?.field,
          op: entry?.op ?? entry?.mode ?? entry?.operation,
          value: entry?.value,
        }))
      : [
          {
            field: body?.field,
            op: body?.op ?? body?.mode ?? body?.operation,
            value: body?.value,
          },
        ];

  if (!candidateChanges.length) {
    return NextResponse.json({ error: "missing_changes" }, { status: 400 });
  }
  if (candidateChanges.length > MAX_CHANGES) {
    return NextResponse.json({ error: "too_many_changes" }, { status: 400 });
  }

  const seenFields = new Set<BulkField>();
  const changes: ParsedChange[] = [];

  for (const entry of candidateChanges) {
    const field = entry?.field;
    if (!isField(field)) {
      return NextResponse.json({ error: "invalid_field" }, { status: 400 });
    }
    if (seenFields.has(field)) {
      return NextResponse.json({ error: "duplicate_field", field }, { status: 400 });
    }
    seenFields.add(field);

    const op = entry?.op;
    if (!isOperation(op)) {
      return NextResponse.json({ error: "invalid_operation" }, { status: 400 });
    }

    const scalar = isScalarField(field);
    const array = isArrayField(field);
    if (!scalar && !array) {
      return NextResponse.json({ error: "unsupported_field" }, { status: 400 });
    }

    if (scalar) {
      if (op === "add" || op === "remove") {
        return NextResponse.json({ error: "unsupported_operation", field, op }, { status: 400 });
      }
      const scalarValue = op === "clear" ? null : toOptionalString(entry?.value);
      if (op !== "clear" && !scalarValue) {
        return NextResponse.json({ error: "missing_value", field }, { status: 400 });
      }
      const allowed = scalarFieldAllowed[field];
      if (allowed && scalarValue && !allowed.has(scalarValue)) {
        return NextResponse.json({ error: "invalid_value", field, value: scalarValue }, { status: 400 });
      }
      changes.push({ field, op, kind: "scalar", scalarValue });
      continue;
    }

    // array field
    const tagValues =
      op === "clear" ? [] : normalizeTags(toUniqueStringArray(entry?.value));
    if (op !== "clear" && tagValues.length === 0) {
      return NextResponse.json({ error: "missing_value", field }, { status: 400 });
    }
    const allowed = arrayFieldAllowed[field];
    if (!allowed) {
      return NextResponse.json({ error: "invalid_field_config", field }, { status: 400 });
    }
    const { ok, invalid } = ensureAllAllowed(tagValues, allowed);
    if (!ok) {
      return NextResponse.json({ error: "invalid_values", field, invalid }, { status: 400 });
    }
    changes.push({ field, op, kind: "array", tagValues });
  }

  if (!changes.length) {
    return NextResponse.json({ error: "missing_changes" }, { status: 400 });
  }

  const categoryChange = changes.find((change) => change.kind === "scalar" && change.field === "category") as
    | (ParsedChange & { kind: "scalar"; field: "category" })
    | undefined;
  const subcategoryChange = changes.find((change) => change.kind === "scalar" && change.field === "subcategory") as
    | (ParsedChange & { kind: "scalar"; field: "subcategory" })
    | undefined;
  if (subcategoryChange && subcategoryChange.op === "replace" && subcategoryChange.scalarValue) {
    const impliedCategory = SUBCATEGORY_TO_CATEGORY[subcategoryChange.scalarValue] ?? null;
    if (!impliedCategory) {
      return NextResponse.json(
        { error: "invalid_value", field: "subcategory", value: subcategoryChange.scalarValue },
        { status: 400 },
      );
    }

    if (categoryChange) {
      if (categoryChange.op === "clear") {
        return NextResponse.json({ error: "subcategory_requires_category" }, { status: 400 });
      }
      const nextCategory = categoryChange.op === "replace" ? categoryChange.scalarValue : null;
      if (nextCategory && nextCategory !== impliedCategory) {
        return NextResponse.json(
          { error: "subcategory_not_in_category", category: nextCategory, subcategory: subcategoryChange.scalarValue },
          { status: 400 },
        );
      }
    }
  }

  const now = new Date();
  const auditChanges = changes.map((change) => ({
    field: change.field,
    op: change.op,
    value:
      change.op === "clear"
        ? null
        : change.kind === "array"
          ? change.tagValues
          : change.scalarValue,
  }));

  const auditAction = {
    updatedAt: now.toISOString(),
    updatedBy: typeof (admin as any)?.email === "string" ? (admin as any).email : null,
    changes: auditChanges,
  };

  const select: Prisma.ProductSelect = { id: true, metadata: true } as any;
  for (const change of changes) {
    (select as any)[change.field] = true;
  }
  if (categoryChange || subcategoryChange) {
    // Keep category/subcategory consistent, even if only one field was requested.
    (select as any).category = true;
    (select as any).subcategory = true;
  }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select,
  });

  const foundIds = new Set(products.map((product) => product.id));
  const missingIds = productIds.filter((id) => !foundIds.has(id));

  let updatedCount = 0;
  let unchangedCount = 0;

  const updates: Prisma.PrismaPromise<any>[] = [];

  for (const product of products) {
    const data: Record<string, any> = {};
    let didChange = false;

    if (categoryChange || subcategoryChange) {
      const existingCategory = ((product as any).category ?? null) as string | null;
      const existingSubcategory = ((product as any).subcategory ?? null) as string | null;

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
          if (!categoryChange) {
            nextCategory = SUBCATEGORY_TO_CATEGORY[nextSubcategory] ?? null;
          }
        }
      }

      if (!nextCategory) {
        nextSubcategory = null;
      } else if (nextSubcategory) {
        const allowedSubs = taxonomy.subcategoryByCategory[nextCategory] ?? [];
        if (!allowedSubs.includes(nextSubcategory)) {
          // Most commonly happens when the category changed but subcategory wasn't touched.
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
      if (change.kind === "scalar" && (change.field === "category" || change.field === "subcategory")) {
        continue;
      }
      if (change.kind === "array") {
        const existing = Array.isArray((product as any)[change.field])
          ? ((product as any)[change.field] as string[])
          : [];
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

      const existing = (product as any)[change.field] ?? null;
      let next: string | null = existing;
      if (change.op === "clear") next = null;
      if (change.op === "replace") next = change.scalarValue;

      if (existing !== next) {
        didChange = true;
        data[change.field] = next;
      }
    }

    if (!didChange) {
      unchangedCount += 1;
      continue;
    }

    const existingMetadata =
      product.metadata && typeof product.metadata === "object" && !Array.isArray(product.metadata)
        ? (product.metadata as Record<string, unknown>)
        : {};
    const nextMetadata: Record<string, unknown> = {
      ...existingMetadata,
      enrichment_human: auditAction,
    };

    data.metadata = JSON.parse(JSON.stringify(nextMetadata)) as Prisma.InputJsonValue;

    updatedCount += 1;
    updates.push(
      prisma.product.update({
        where: { id: product.id },
        data,
        select: { id: true },
      }),
    );
  }

  for (let i = 0; i < updates.length; i += TX_CHUNK_SIZE) {
    await prisma.$transaction(updates.slice(i, i + TX_CHUNK_SIZE));
  }

  return NextResponse.json({
    ok: true,
    updatedCount,
    unchangedCount,
    missingCount: missingIds.length,
    missingIds,
    changes: auditChanges,
  });
}
