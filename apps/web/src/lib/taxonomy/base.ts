import "server-only";

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
import type { TaxonomyDataV1, TaxonomyTerm } from "./types";

const toTerm = (key: string, label: string, description?: string | null, sortOrder?: number): TaxonomyTerm => ({
  key,
  label,
  description: description ?? null,
  synonyms: [],
  isActive: true,
  ...(typeof sortOrder === "number" ? { sortOrder } : {}),
});

export function buildBaseTaxonomyDataV1(): TaxonomyDataV1 {
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
