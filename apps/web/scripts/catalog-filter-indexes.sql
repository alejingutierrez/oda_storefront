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

-- GIN indexes for common multi-filters (material/pattern/seo tags/occasion).
-- These speed up `&& ARRAY[...]` predicates in PLP queries.
create index concurrently if not exists idx_products_catalog_materialtags_gin
  on products using gin ("materialTags")
  where "imageCoverUrl" is not null
    and ("metadata" -> 'enrichment') is not null;

create index concurrently if not exists idx_products_catalog_patterntags_gin
  on products using gin ("patternTags")
  where "imageCoverUrl" is not null
    and ("metadata" -> 'enrichment') is not null;

create index concurrently if not exists idx_products_catalog_seotags_gin
  on products using gin ("seoTags")
  where "imageCoverUrl" is not null
    and ("metadata" -> 'enrichment') is not null;

create index concurrently if not exists idx_products_catalog_occasiontags_gin
  on products using gin ("occasionTags")
  where "imageCoverUrl" is not null
    and ("metadata" -> 'enrichment') is not null;

-- Price-change direction filter (`price_change=down|up`) in PLP.
create index concurrently if not exists idx_products_catalog_price_change_direction_at
  on products ("priceChangeDirection", "priceChangeAt" desc)
  where "priceChangeDirection" is not null
    and "imageCoverUrl" is not null
    and ("metadata" -> 'enrichment') is not null;

create index concurrently if not exists idx_variants_instock_productid
  on variants ("productId")
  where (stock > 0 or "stockStatus" in ('in_stock','preorder'));

create index concurrently if not exists idx_variants_instock_price
  on variants (price)
  where price > 0
    and (stock > 0 or "stockStatus" in ('in_stock','preorder'));

-- Price-sort rollups on products (avoid `group by variants` on every request).
create index concurrently if not exists idx_products_catalog_minprice_createdat
  on products ("minPriceCop" asc, "createdAt" desc)
  where "hasInStock" = true
    and "imageCoverUrl" is not null
    and ("metadata" -> 'enrichment') is not null;

create index concurrently if not exists idx_products_catalog_maxprice_createdat
  on products ("maxPriceCop" desc, "createdAt" desc)
  where "hasInStock" = true
    and "imageCoverUrl" is not null
    and ("metadata" -> 'enrichment') is not null;

create index concurrently if not exists idx_products_catalog_category_minprice_createdat
  on products (category, "minPriceCop" asc, "createdAt" desc)
  where "hasInStock" = true
    and "imageCoverUrl" is not null
    and ("metadata" -> 'enrichment') is not null;

create index concurrently if not exists idx_products_catalog_category_maxprice_createdat
  on products (category, "maxPriceCop" desc, "createdAt" desc)
  where "hasInStock" = true
    and "imageCoverUrl" is not null
    and ("metadata" -> 'enrichment') is not null;

create index concurrently if not exists idx_products_catalog_category_subcategory_minprice_createdat
  on products (category, subcategory, "minPriceCop" asc, "createdAt" desc)
  where "hasInStock" = true
    and "imageCoverUrl" is not null
    and ("metadata" -> 'enrichment') is not null;

create index concurrently if not exists idx_products_catalog_category_subcategory_maxprice_createdat
  on products (category, subcategory, "maxPriceCop" desc, "createdAt" desc)
  where "hasInStock" = true
    and "imageCoverUrl" is not null
    and ("metadata" -> 'enrichment') is not null;
