-- Catalog filter performance indexes (public PLP `/catalogo`).
--
-- Rationale:
-- - The catalog endpoints heavily filter by `products.category` / legacy `(category, subcategory)` combos,
--   require `imageCoverUrl` + `metadata.enrichment`, and sort by `createdAt`.
-- - They also need fast `inStock` existence checks on variants.
-- - Without these indexes, the DB may fall back to sequential scans which can push filter loads >2s.
--
-- IMPORTANT:
-- - This file uses `CREATE INDEX CONCURRENTLY`, so it MUST be run via `psql` (not inside a transaction).
-- - Safe to run multiple times.
--
-- Example:
--   psql "$NEON_DATABASE_URL" -f apps/web/scripts/catalog-filter-indexes.sql

create index concurrently if not exists idx_products_catalog_category_createdat
  on products (category, "createdAt" desc)
  where "imageCoverUrl" is not null
    and ("metadata" -> 'enrichment') is not null;

create index concurrently if not exists idx_products_catalog_category_subcategory_createdat
  on products (category, subcategory, "createdAt" desc)
  where "imageCoverUrl" is not null
    and ("metadata" -> 'enrichment') is not null;

create index concurrently if not exists idx_variants_instock_productid
  on variants ("productId")
  where (stock > 0 or "stockStatus" in ('in_stock','preorder'));

create index concurrently if not exists idx_variants_instock_price
  on variants (price)
  where price > 0
    and (stock > 0 or "stockStatus" in ('in_stock','preorder'));

