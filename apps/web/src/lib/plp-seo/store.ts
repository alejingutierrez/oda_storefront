import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type TablesState = "unknown" | "missing" | "ready";

let plpSeoTablesState: TablesState = "unknown";

function isMissingTableError(err: unknown, tableName: string) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code === "P2021" || err.code === "P2022";
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes("does not exist") && msg.includes(tableName);
  }
  return false;
}

export function normalizePlpPath(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "/";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const trimmed = withSlash.replace(/\/+$/g, "");
  return trimmed.length ? trimmed : "/";
}

export function parsePlpPath(input: string): {
  path: string;
  genderSlug: string;
  categoryKey: string | null;
  subcategoryKey: string | null;
} | null {
  const path = normalizePlpPath(input);
  const parts = path.split("/").filter(Boolean);
  const genderSlug = (parts[0] ?? "").trim().toLowerCase();
  if (!genderSlug) return null;
  if (!["femenino", "masculino", "unisex", "infantil"].includes(genderSlug)) return null;
  const categoryKey = parts[1] ? parts[1].trim() : null;
  const subcategoryKey = parts[2] ? parts[2].trim() : null;
  if (subcategoryKey && !categoryKey) return null;
  const canonicalParts = [genderSlug, categoryKey, subcategoryKey].filter(Boolean);
  if (canonicalParts.length === 0) return null;
  if (canonicalParts.length > 3) return null;
  return {
    path: `/${canonicalParts.join("/")}`,
    genderSlug,
    categoryKey: categoryKey && categoryKey.length ? categoryKey : null,
    subcategoryKey: subcategoryKey && subcategoryKey.length ? subcategoryKey : null,
  };
}

export async function ensurePlpSeoTables() {
  if (plpSeoTablesState === "ready") return;

  try {
    const [pages, runs, items] = await Promise.all([
      prisma.$queryRaw<Array<{ name: string | null }>>(Prisma.sql`
        select to_regclass('public.plp_seo_pages') as name
      `),
      prisma.$queryRaw<Array<{ name: string | null }>>(Prisma.sql`
        select to_regclass('public.plp_seo_runs') as name
      `),
      prisma.$queryRaw<Array<{ name: string | null }>>(Prisma.sql`
        select to_regclass('public.plp_seo_items') as name
      `),
    ]);
    if (pages?.[0]?.name && runs?.[0]?.name && items?.[0]?.name) {
      plpSeoTablesState = "ready";
      return;
    }
  } catch (err) {
    console.warn("[plp-seo] to_regclass check failed", err);
  }

  await prisma.$executeRaw(Prisma.sql`
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
  `);
  await prisma.$executeRaw(Prisma.sql`
    create unique index if not exists "plp_seo_pages_path_key" on "plp_seo_pages"("path");
  `);
  await prisma.$executeRaw(Prisma.sql`
    create index if not exists "plp_seo_pages_genderSlug_idx" on "plp_seo_pages"("genderSlug");
  `);
  await prisma.$executeRaw(Prisma.sql`
    create index if not exists "plp_seo_pages_genderSlug_categoryKey_subcategoryKey_idx"
    on "plp_seo_pages"("genderSlug","categoryKey","subcategoryKey");
  `);

  await prisma.$executeRaw(Prisma.sql`
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
  `);
  await prisma.$executeRaw(Prisma.sql`
    create index if not exists "plp_seo_runs_status_updatedAt_idx" on "plp_seo_runs"("status","updatedAt");
  `);

  await prisma.$executeRaw(Prisma.sql`
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
  `);
  await prisma.$executeRaw(Prisma.sql`
    create unique index if not exists "plp_seo_items_runId_path_key" on "plp_seo_items"("runId","path");
  `);
  await prisma.$executeRaw(Prisma.sql`
    create index if not exists "plp_seo_items_runId_status_idx" on "plp_seo_items"("runId","status");
  `);
  await prisma.$executeRaw(Prisma.sql`
    create index if not exists "plp_seo_items_status_updatedAt_idx" on "plp_seo_items"("status","updatedAt");
  `);
  await prisma.$executeRaw(Prisma.sql`
    create index if not exists "plp_seo_items_genderSlug_categoryKey_subcategoryKey_idx"
    on "plp_seo_items"("genderSlug","categoryKey","subcategoryKey");
  `);
  await prisma.$executeRaw(Prisma.sql`
    alter table "plp_seo_items"
      add constraint "plp_seo_items_runId_fkey"
      foreign key ("runId") references "plp_seo_runs"("id") on delete cascade on update cascade;
  `);

  plpSeoTablesState = "ready";
}

export async function safeGetPlpSeoPageByPath(path: string) {
  const normalized = normalizePlpPath(path);
  if (normalized === "/") return null;
  try {
    return await prisma.plpSeoPage.findUnique({
      where: { path: normalized },
      select: {
        path: true,
        metaTitle: true,
        metaDescription: true,
        subtitle: true,
        updatedAt: true,
      },
    });
  } catch (err) {
    if (isMissingTableError(err, "plp_seo_pages")) {
      plpSeoTablesState = "missing";
      return null;
    }
    console.warn("[plp-seo] failed to load page", { path: normalized, err });
    return null;
  }
}
