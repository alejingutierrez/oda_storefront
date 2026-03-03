import { z } from "zod";
import type { TaxonomyDataV1 } from "./types";

const KEY_REGEX = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

const keySchema = z
  .string()
  .trim()
  .min(1, "key_required")
  .regex(KEY_REGEX, "key_must_be_slug");

const termSchema = z
  .object({
    key: keySchema,
    label: z.string().trim().min(1, "label_required"),
    description: z.string().trim().optional().nullable(),
    synonyms: z.array(z.string().trim().min(1)).optional().default([]),
    isActive: z.boolean().optional().default(true),
    sortOrder: z.number().int().optional(),
  })
  .passthrough();

const menuGroupSchema = z.enum(["Superiores", "Completos", "Inferiores", "Accesorios", "Lifestyle"]);

const categorySchema = termSchema
  .extend({
    menuGroup: menuGroupSchema.optional().nullable(),
    subcategories: z.array(termSchema).min(1, "subcategory_required"),
  })
  .passthrough();

export const taxonomyDataV1Schema: z.ZodType<TaxonomyDataV1> = z
  .object({
    schemaVersion: z.literal(1),
    categories: z.array(categorySchema).min(1, "categories_required"),
    materials: z.array(termSchema),
    patterns: z.array(termSchema),
    occasions: z.array(termSchema),
    styleTags: z.array(termSchema).min(10, "style_tags_min_10"),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const ensureUnique = (keys: string[], path: (string | number)[]) => {
      const seen = new Set<string>();
      const dupes = new Set<string>();
      for (const key of keys) {
        if (seen.has(key)) dupes.add(key);
        seen.add(key);
      }
      if (dupes.size > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate_keys:${Array.from(dupes).join(",")}`,
          path,
        });
      }
    };

    ensureUnique(
      value.categories.map((entry) => entry.key),
      ["categories"],
    );
    ensureUnique(
      value.materials.map((entry) => entry.key),
      ["materials"],
    );
    ensureUnique(
      value.patterns.map((entry) => entry.key),
      ["patterns"],
    );
    ensureUnique(
      value.occasions.map((entry) => entry.key),
      ["occasions"],
    );
    ensureUnique(
      value.styleTags.map((entry) => entry.key),
      ["styleTags"],
    );

    value.categories.forEach((category, index) => {
      ensureUnique(
        category.subcategories.map((entry) => entry.key),
        ["categories", index, "subcategories"],
      );
    });

    // We allow the same subcategory key to appear under multiple categories (some base catalogs reuse keys),
    // but the meaning of a key must remain consistent across the taxonomy.
    const subcategoryByKey = new Map<
      string,
      { label: string; description: string | null; isActive: boolean }
    >();
    const mismatched = new Set<string>();

    value.categories.forEach((category) => {
      (category.subcategories ?? []).forEach((sub) => {
        const key = sub.key;
        if (!key) return;
        const normalized = {
          label: (sub.label ?? "").trim(),
          description: (sub.description ?? null) ? String(sub.description).trim() : null,
          isActive: sub.isActive !== false,
        };
        const existing = subcategoryByKey.get(key);
        if (!existing) {
          subcategoryByKey.set(key, normalized);
          return;
        }
        if (
          existing.label !== normalized.label ||
          (existing.description ?? null) !== (normalized.description ?? null) ||
          existing.isActive !== normalized.isActive
        ) {
          mismatched.add(key);
        }
      });
    });

    if (mismatched.size > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate_subcategory_definitions:${Array.from(mismatched).join(",")}`,
        path: ["categories", "subcategories"],
      });
    }
  });

function repairDuplicateSubcategoryDefinitions(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const cloned = JSON.parse(JSON.stringify(value)) as {
    categories?: Array<{
      subcategories?: Array<Record<string, unknown>>;
    }>;
  };

  const categories = Array.isArray(cloned.categories) ? cloned.categories : [];
  const canonicalByKey = new Map<
    string,
    { label: string; description: string | null; isActive: boolean }
  >();

  for (const category of categories) {
    if (!category || typeof category !== "object") continue;
    const subcategories = Array.isArray(category.subcategories) ? category.subcategories : [];

    for (const subcategory of subcategories) {
      if (!subcategory || typeof subcategory !== "object") continue;
      const key = typeof subcategory.key === "string" ? subcategory.key.trim() : "";
      if (!key) continue;

      const existing = canonicalByKey.get(key);
      if (!existing) {
        canonicalByKey.set(key, {
          label:
            typeof subcategory.label === "string" && subcategory.label.trim().length > 0
              ? subcategory.label
              : key,
          description:
            typeof subcategory.description === "string"
              ? subcategory.description
              : subcategory.description == null
                ? null
                : String(subcategory.description),
          isActive: subcategory.isActive !== false,
        });
        continue;
      }

      subcategory.label = existing.label;
      subcategory.description = existing.description;
      subcategory.isActive = existing.isActive;
    }
  }

  return cloned;
}

export function parseTaxonomyDataV1(value: unknown): TaxonomyDataV1 {
  try {
    return taxonomyDataV1Schema.parse(value);
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    const hasDuplicateDefinitions = error.issues.some(
      (issue) =>
        typeof issue.message === "string" &&
        issue.message.startsWith("duplicate_subcategory_definitions:"),
    );
    if (!hasDuplicateDefinitions) throw error;
    const repaired = repairDuplicateSubcategoryDefinitions(value);
    return taxonomyDataV1Schema.parse(repaired);
  }
}
