export type ProductRef = {
  url: string;
  externalId?: string | null;
  handle?: string | null;
};

export type RawVariant = {
  id?: string | null;
  sku?: string | null;
  options?: Record<string, string>;
  price?: number | null;
  compareAtPrice?: number | null;
  currency?: string | null;
  available?: boolean | null;
  stock?: number | null;
  image?: string | null;
  images?: string[];
};

export type RawProduct = {
  sourceUrl: string;
  externalId?: string | null;
  title?: string | null;
  description?: string | null;
  vendor?: string | null;
  currency?: string | null;
  images: string[];
  options?: Array<{ name: string; values: string[] }>;
  variants: RawVariant[];
  metadata?: Record<string, unknown>;
};

export type CanonicalVariant = {
  sku?: string | null;
  color?: string | null;
  size?: string | null;
  fit?: string | null;
  material?: string | null;
  price?: number | null;
  currency?: string | null;
  stock?: number | null;
  stock_status?: string | null;
  images?: string[] | null;
};

export type CanonicalProduct = {
  name: string;
  description?: string | null;
  category?: string | null;
  subcategory?: string | null;
  style_tags?: string[];
  material_tags?: string[];
  pattern_tags?: string[];
  occasion_tags?: string[];
  gender?: string | null;
  season?: string | null;
  care?: string | null;
  origin?: string | null;
  status?: string | null;
  source_url?: string | null;
  image_cover_url?: string | null;
  variants: CanonicalVariant[];
  metadata?: Record<string, unknown>;
};

export type CatalogAdapter = {
  platform: string;
  discoverProducts: (ctx: AdapterContext, limit?: number) => Promise<ProductRef[]>;
  fetchProduct: (ctx: AdapterContext, ref: ProductRef) => Promise<RawProduct | null>;
  healthcheck?: (ctx: AdapterContext) => Promise<Record<string, unknown>>;
};

export type AdapterContext = {
  brand: {
    id: string;
    name: string;
    slug: string;
    siteUrl: string;
    ecommercePlatform: string | null;
  };
};

export type ExtractSummary = {
  brandId: string;
  platform: string;
  discovered: number;
  processed: number;
  created: number;
  updated: number;
  errors: Array<{ url: string; error: string }>;
  status?: string;
  runId?: string;
  pending?: number;
  failed?: number;
  total?: number;
  lastError?: string | null;
  blockReason?: string | null;
};
