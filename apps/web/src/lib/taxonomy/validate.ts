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

const categorySchema = termSchema
  .extend({
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

export function parseTaxonomyDataV1(value: unknown): TaxonomyDataV1 {
  return taxonomyDataV1Schema.parse(value);
}
