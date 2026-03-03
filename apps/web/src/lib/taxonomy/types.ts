export type TaxonomyStage = "draft" | "published";
export type MenuGroup = "Superiores" | "Completos" | "Inferiores" | "Accesorios" | "Lifestyle";

export type TaxonomyTerm = {
  key: string;
  label: string;
  description?: string | null;
  synonyms?: string[];
  isActive?: boolean;
  sortOrder?: number;
};

export type TaxonomyCategory = TaxonomyTerm & {
  menuGroup?: MenuGroup | null;
  subcategories: TaxonomyTerm[];
};

export type TaxonomyDataV1 = {
  schemaVersion: 1;
  categories: TaxonomyCategory[];
  materials: TaxonomyTerm[];
  patterns: TaxonomyTerm[];
  occasions: TaxonomyTerm[];
  styleTags: TaxonomyTerm[];
};

export type StyleProfileRow = { key: string; label: string; tags: string[] };

export type TaxonomyOptions = {
  source: "db" | "base";
  version: number;
  updatedAt: string | null;
  data: TaxonomyDataV1;
  categoryLabels: Record<string, string>;
  categoryDescriptions: Record<string, string | null>;
  categoryMenuGroups: Record<string, MenuGroup>;
  subcategoryLabels: Record<string, string>;
  subcategoryDescriptions: Record<string, string | null>;
  subcategoryByCategory: Record<string, string[]>;
  materialLabels: Record<string, string>;
  patternLabels: Record<string, string>;
  occasionLabels: Record<string, string>;
  styleTagLabels: Record<string, string>;
  styleProfiles: StyleProfileRow[];
  styleProfileLabels: Record<string, string>;
};
