import path from "node:path";
import dotenv from "dotenv";

// Load repo-root env so Prisma can connect when running this script locally.
dotenv.config({ path: path.resolve(process.cwd(), "..", "..", ".env") });

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

const asBool = (value: string | undefined, fallback: boolean) => {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const toText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

let cachedPrisma: any = null;
let cachedPrismaClient: PrismaClient | null = null;
const getPrisma = async (): Promise<PrismaClient> => {
  if (cachedPrismaClient) return cachedPrismaClient;
  if (cachedPrisma) return cachedPrisma;
  const mod = await import("../src/lib/prisma");
  const client = (mod as any).prisma ?? (mod as any).default?.prisma;
  if (!client) throw new Error("Failed to import prisma client from ../src/lib/prisma");
  cachedPrisma = client;
  cachedPrismaClient = client as PrismaClient;
  return cachedPrismaClient;
};

const resolveRunKey = async (prisma: PrismaClient) => {
  const explicit = toText(process.env.TAXONOMY_REMAP_ACCEPT_RUN_KEY);
  if (explicit) return explicit;
  const keys = await prisma.taxonomyRemapReview.findMany({
    where: { status: "pending" },
    select: { runKey: true },
    distinct: ["runKey"],
  });
  const unique = [...new Set(keys.map((entry) => entry.runKey).filter(Boolean))] as string[];
  if (unique.length !== 1) {
    throw new Error(
      `Expected exactly 1 pending runKey (found ${unique.length}). Set TAXONOMY_REMAP_ACCEPT_RUN_KEY explicitly.`,
    );
  }
  return unique[0];
};

const main = async () => {
  const prisma = await getPrisma();
  const runKey = await resolveRunKey(prisma);
  const apply = asBool(process.env.TAXONOMY_REMAP_ACCEPT_APPLY, false);
  const note =
    toText(process.env.TAXONOMY_REMAP_ACCEPT_NOTE) ||
    `bulk_accept runKey=${runKey} (refresh_pending)`;
  const decidedAt = new Date().toISOString();

  const adminEmail = toText(process.env.ADMIN_EMAIL);
  const decidedByUserId = adminEmail
    ? (await prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true } }))?.id ?? null
    : null;

  const empty = "";
  const pendingStatus = "pending";
  const changedSql = Prisma.sql`(
    COALESCE(r."toCategory", ${empty}) <> COALESCE(r."fromCategory", ${empty})
    OR COALESCE(r."toSubcategory", ${empty}) <> COALESCE(r."fromSubcategory", ${empty})
    OR COALESCE(r."toGender", ${empty}) <> COALESCE(r."fromGender", ${empty})
  )`;

  const [summaryRow] = await prisma.$queryRaw<
    Array<{ total: number; taxonomy: number; gender_only: number }>
  >(Prisma.sql`
    SELECT
      COUNT(*)::int AS total,
      SUM(
        CASE WHEN (
          COALESCE(r."toCategory", ${empty}) <> COALESCE(r."fromCategory", ${empty})
          OR COALESCE(r."toSubcategory", ${empty}) <> COALESCE(r."fromSubcategory", ${empty})
        ) THEN 1 ELSE 0 END
      )::int AS taxonomy,
      SUM(
        CASE WHEN (
          COALESCE(r."toGender", ${empty}) <> COALESCE(r."fromGender", ${empty})
        ) AND NOT (
          COALESCE(r."toCategory", ${empty}) <> COALESCE(r."fromCategory", ${empty})
          OR COALESCE(r."toSubcategory", ${empty}) <> COALESCE(r."fromSubcategory", ${empty})
        ) THEN 1 ELSE 0 END
      )::int AS gender_only
    FROM "taxonomy_remap_reviews" r
    WHERE r."status" = ${pendingStatus}
      AND r."runKey" = ${runKey}
      AND ${changedSql};
  `);

  console.log(
    JSON.stringify(
      {
        runKey,
        apply,
        note,
        decidedAt,
        decidedByUserId,
        summary: summaryRow ?? null,
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.log("Dry-run only. Set TAXONOMY_REMAP_ACCEPT_APPLY=true to apply.");
    return;
  }

  const [updatedProducts, updatedReviews] = await prisma.$transaction([
    prisma.$executeRaw(Prisma.sql`
      UPDATE "products" p
      SET
        "category" = COALESCE(r."toCategory", p."category"),
        "subcategory" = COALESCE(r."toSubcategory", p."subcategory"),
        "gender" = COALESCE(r."toGender", p."gender"),
        "metadata" = jsonb_set(
          CASE WHEN jsonb_typeof(p."metadata") = 'object' THEN p."metadata" ELSE jsonb_build_object() END,
          '{taxonomy_remap,last_review}',
          jsonb_build_object(
            'review_id', r.id,
            'source', r."source",
            'run_key', r."runKey",
            'from', jsonb_build_object(
              'category', r."fromCategory",
              'subcategory', r."fromSubcategory",
              'gender', r."fromGender"
            ),
            'to', jsonb_build_object(
              'category', r."toCategory",
              'subcategory', r."toSubcategory",
              'gender', r."toGender"
            ),
            'confidence', r."confidence",
            'reasons', to_jsonb(r."reasons"),
            -- Cast parameters so Postgres can type them inside jsonb_build_object().
            'decided_at', ${decidedAt}::text,
            'decided_by', ${decidedByUserId}::text,
            'decision', 'accepted',
            'note', ${note}::text
          ),
          true
        ),
        "updatedAt" = NOW()
      FROM "taxonomy_remap_reviews" r
      WHERE r."status" = ${pendingStatus}
        AND r."runKey" = ${runKey}
        AND p.id = r."productId"
        AND ${changedSql};
    `),
    prisma.$executeRaw(Prisma.sql`
      UPDATE "taxonomy_remap_reviews" r
      SET
        "status" = 'accepted',
        "decisionNote" = ${note},
        "decisionError" = NULL,
        "decidedAt" = NOW(),
        "decidedByUserId" = ${decidedByUserId},
        "updatedAt" = NOW()
      WHERE r."status" = ${pendingStatus}
        AND r."runKey" = ${runKey}
        AND ${changedSql};
    `),
  ]);

  const pendingAfter = await prisma.taxonomyRemapReview.count({ where: { status: "pending" } });
  console.log(JSON.stringify({ updatedProducts, updatedReviews, pendingAfter }, null, 2));
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (cachedPrismaClient?.$disconnect) {
      await cachedPrismaClient.$disconnect().catch(() => null);
    }
  });
