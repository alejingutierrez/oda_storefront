alter table "products"
  add column if not exists "hasInStock" boolean not null default false,
  add column if not exists "minPriceCop" decimal(12,2),
  add column if not exists "maxPriceCop" decimal(12,2),
  add column if not exists "priceRollupUpdatedAt" timestamp(3);
