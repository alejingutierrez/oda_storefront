-- Home core resilience indexes (critical feed queries)

-- Partial index for active products with media/in-stock to accelerate home feeds.
create index if not exists "idx_products_home_active_partial"
  on "products" ("updatedAt" desc, id)
  where "imageCoverUrl" is not null
    and "hasInStock" = true
    and (status is null or lower(status) <> 'archived');

-- Price change signal lookup for price drop rail.
create index if not exists "idx_products_price_change_direction_at"
  on "products" ("priceChangeDirection", "priceChangeAt" desc);

-- Fast historical lookup by variant and capture time.
create index if not exists "idx_price_history_variant_captured_at"
  on "price_history" ("variantId", "capturedAt" desc);

-- Daily/live trending fallback over click events.
create index if not exists "idx_experience_events_type_created_product"
  on "experience_events" (type, "createdAt" desc, "productId");
