-- PLP SEO pages + batch generation runs/items.

create table if not exists "plp_seo_pages" (
  "id" text not null,
  "path" text not null,
  "genderSlug" text not null,
  "categoryKey" text,
  "subcategoryKey" text,
  "metaTitle" text not null,
  "metaDescription" text not null,
  "subtitle" text not null,
  "provider" text not null,
  "model" text not null,
  "promptVersion" text not null,
  "schemaVersion" text not null,
  "inputHash" text not null,
  "metadata" jsonb,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  constraint "plp_seo_pages_pkey" primary key ("id")
);

create unique index if not exists "plp_seo_pages_path_key" on "plp_seo_pages"("path");
create index if not exists "plp_seo_pages_genderSlug_idx" on "plp_seo_pages"("genderSlug");
create index if not exists "plp_seo_pages_genderSlug_categoryKey_subcategoryKey_idx"
  on "plp_seo_pages"("genderSlug","categoryKey","subcategoryKey");

create table if not exists "plp_seo_runs" (
  "id" text not null,
  "status" text not null default 'processing',
  "totalItems" integer not null default 0,
  "startedAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  "finishedAt" timestamp(3),
  "lastError" text,
  "metadata" jsonb,
  constraint "plp_seo_runs_pkey" primary key ("id")
);

create index if not exists "plp_seo_runs_status_updatedAt_idx" on "plp_seo_runs"("status","updatedAt");

create table if not exists "plp_seo_items" (
  "id" text not null,
  "runId" text not null,
  "path" text not null,
  "genderSlug" text not null,
  "categoryKey" text,
  "subcategoryKey" text,
  "status" text not null default 'pending',
  "attempts" integer not null default 0,
  "lastError" text,
  "startedAt" timestamp(3),
  "completedAt" timestamp(3),
  "updatedAt" timestamp(3) not null,
  constraint "plp_seo_items_pkey" primary key ("id")
);

create unique index if not exists "plp_seo_items_runId_path_key" on "plp_seo_items"("runId","path");
create index if not exists "plp_seo_items_runId_status_idx" on "plp_seo_items"("runId","status");
create index if not exists "plp_seo_items_status_updatedAt_idx" on "plp_seo_items"("status","updatedAt");
create index if not exists "plp_seo_items_genderSlug_categoryKey_subcategoryKey_idx"
  on "plp_seo_items"("genderSlug","categoryKey","subcategoryKey");

alter table "plp_seo_items"
  add constraint "plp_seo_items_runId_fkey"
  foreign key ("runId") references "plp_seo_runs"("id") on delete cascade on update cascade;

