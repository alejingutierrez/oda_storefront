import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  CATEGORY_VALUES,
  SUBCATEGORY_VALUES,
  STYLE_TAGS,
  MATERIAL_TAGS,
  PATTERN_TAGS,
  OCCASION_TAGS,
  GENDER_OPTIONS,
  SEASON_OPTIONS,
} from "@/lib/product-enrichment/constants";
import { STYLE_PROFILES } from "@/lib/product-enrichment/style-profiles";

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

const MAX_PRODUCT_IDS = 1200;
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

const buildAllowedSet = (values: string[]) => new Set(values);

const CATEGORY_SET = buildAllowedSet(CATEGORY_VALUES);
const SUBCATEGORY_SET = buildAllowedSet(SUBCATEGORY_VALUES);
const STYLE_TAG_SET = buildAllowedSet(STYLE_TAGS);
const MATERIAL_SET = buildAllowedSet(MATERIAL_TAGS);
const PATTERN_SET = buildAllowedSet(PATTERN_TAGS);
const OCCASION_SET = buildAllowedSet(OCCASION_TAGS);
const GENDER_SET = buildAllowedSet(GENDER_OPTIONS.map((entry) => entry.value));
const SEASON_SET = buildAllowedSet(SEASON_OPTIONS.map((entry) => entry.value));
const STYLE_PROFILE_SET = buildAllowedSet(STYLE_PROFILES.map((profile) => profile.key));

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

  const field = body?.field;
  if (!isField(field)) {
    return NextResponse.json({ error: "invalid_field" }, { status: 400 });
  }

  const op = body?.op ?? body?.mode ?? body?.operation;
  if (!isOperation(op)) {
    return NextResponse.json({ error: "invalid_operation" }, { status: 400 });
  }

  const now = new Date();
  const auditAction = {
    updatedAt: now.toISOString(),
    updatedBy: typeof (admin as any)?.email === "string" ? (admin as any).email : null,
    field,
    op,
    value: op === "clear" ? null : body?.value ?? null,
  };

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

  const isScalarField = field in scalarFieldAllowed || field === "care" || field === "origin";
  const isArrayField = field in arrayFieldAllowed;
  if (!isScalarField && !isArrayField) {
    return NextResponse.json({ error: "unsupported_field" }, { status: 400 });
  }

  if (isScalarField && (op === "add" || op === "remove")) {
    return NextResponse.json({ error: "unsupported_operation" }, { status: 400 });
  }

  let scalarValue: string | null = null;
  let tagValues: string[] = [];

  if (op !== "clear") {
    if (isArrayField) {
      tagValues = normalizeTags(toUniqueStringArray(body?.value));
      const allowed = arrayFieldAllowed[field];
      if (!allowed) {
        return NextResponse.json({ error: "invalid_field_config" }, { status: 400 });
      }
      const { ok, invalid } = ensureAllAllowed(tagValues, allowed);
      if (!ok) {
        return NextResponse.json({ error: "invalid_values", invalid }, { status: 400 });
      }
    } else {
      scalarValue = toOptionalString(body?.value);
      const allowed = scalarFieldAllowed[field];
      if (allowed && scalarValue) {
        if (!allowed.has(scalarValue)) {
          return NextResponse.json({ error: "invalid_value" }, { status: 400 });
        }
      }
    }
  }

  const select: Prisma.ProductSelect = { id: true, metadata: true } as any;
  (select as any)[field] = true;

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
    const existingMetadata =
      product.metadata && typeof product.metadata === "object" && !Array.isArray(product.metadata)
        ? (product.metadata as Record<string, unknown>)
        : {};
    const nextMetadata: Record<string, unknown> = {
      ...existingMetadata,
      enrichment_human: auditAction,
    };

    const data: Record<string, any> = {
      metadata: JSON.parse(JSON.stringify(nextMetadata)) as Prisma.InputJsonValue,
    };

    if (isArrayField) {
      const existing = Array.isArray((product as any)[field]) ? ((product as any)[field] as string[]) : [];
      const existingNorm = normalizeTags(existing);
      let next: string[] = existingNorm;

      if (op === "clear") next = [];
      if (op === "replace") next = tagValues;
      if (op === "add") next = normalizeTags([...existingNorm, ...tagValues]);
      if (op === "remove") {
        const removeSet = new Set(tagValues);
        next = existingNorm.filter((value) => !removeSet.has(value));
      }

      if (arrayEqual(existingNorm, next)) {
        unchangedCount += 1;
        continue;
      }

      data[field] = next;
    } else {
      const existing = (product as any)[field] ?? null;
      let next: string | null = existing;
      if (op === "clear") next = null;
      if (op === "replace") next = scalarValue;

      if (existing === next) {
        unchangedCount += 1;
        continue;
      }

      data[field] = next;
    }

    updatedCount += 1;
    updates.push(
      prisma.product.update({
        where: { id: product.id },
        data,
        select: { id: true },
      })
    );
  }

  for (let i = 0; i < updates.length; i += TX_CHUNK_SIZE) {
    await prisma.$transaction(updates.slice(i, i + TX_CHUNK_SIZE));
  }

  return NextResponse.json({
    ok: true,
    field,
    op,
    updatedCount,
    unchangedCount,
    missingCount: missingIds.length,
    missingIds,
  });
}
