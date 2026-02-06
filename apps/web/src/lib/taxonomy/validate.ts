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

    const allSubs: string[] = [];
    value.categories.forEach((category, index) => {
      ensureUnique(
        category.subcategories.map((entry) => entry.key),
        ["categories", index, "subcategories"],
      );
      allSubs.push(...category.subcategories.map((entry) => entry.key));
    });
    ensureUnique(allSubs, ["categories", "subcategories"]);
  });

export function parseTaxonomyDataV1(value: unknown): TaxonomyDataV1 {
  return taxonomyDataV1Schema.parse(value);
}
