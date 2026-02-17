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

const asPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const toText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

let cachedPrismaClient: PrismaClient | null = null;
const getPrisma = async (): Promise<PrismaClient> => {
  if (cachedPrismaClient) return cachedPrismaClient;
  const mod = (await import("../src/lib/prisma")) as {
    prisma?: PrismaClient;
    default?: { prisma?: PrismaClient };
  };
  const client = mod.prisma ?? mod.default?.prisma;
  if (!client) throw new Error("Failed to import prisma client from ../src/lib/prisma");
  cachedPrismaClient = client;
  return cachedPrismaClient;
};

const resolveAdminUserId = async (prisma: PrismaClient) => {
  const adminEmail = toText(process.env.ADMIN_EMAIL);
  if (!adminEmail) return null;
  const user = await prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true } });
  return user?.id ?? null;
};

const countPending = async (prisma: PrismaClient) => {
  return prisma.taxonomyRemapReview.count({ where: { status: "pending" } });
};

const listPendingRunKeys = async (prisma: PrismaClient) => {
  const keys = await prisma.taxonomyRemapReview.findMany({
    where: { status: "pending" },
    select: { runKey: true },
    distinct: ["runKey"],
  });
  return [...new Set(keys.map((entry) => entry.runKey ?? ""))].map((key) => (key ? key : null));
};

const countEligibleUndecided = async (prisma: PrismaClient) => {
  // "Eligible" for taxonomy remap = enriched products.
  // "Undecided" = no accepted/rejected review yet.
  const [row] = await prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS total
    FROM "products" p
    WHERE (p.metadata -> 'enrichment') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "taxonomy_remap_reviews" r
        WHERE r."productId" = p.id
          AND r."status" IN ('accepted', 'rejected')
      );
  `);
  return row?.total ?? 0;
};

const acceptPendingByRunKey = async (
  prisma: PrismaClient,
  runKey: string | null,
  note: string,
) => {
  const decidedAt = new Date().toISOString();
  const decidedByUserId = await resolveAdminUserId(prisma);

  const empty = "";
  const pendingStatus = "pending";
  const changedSql = Prisma.sql`(
    COALESCE(r."toCategory", ${empty}) <> COALESCE(r."fromCategory", ${empty})
    OR COALESCE(r."toSubcategory", ${empty}) <> COALESCE(r."fromSubcategory", ${empty})
    OR COALESCE(r."toGender", ${empty}) <> COALESCE(r."fromGender", ${empty})
  )`;

  const runKeySql =
    runKey === null
      ? Prisma.sql`r."runKey" IS NULL`
      : Prisma.sql`r."runKey" = ${runKey}`;

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
        AND ${runKeySql}
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
        AND ${runKeySql}
        AND ${changedSql};
    `),
  ]);

  return { updatedProducts, updatedReviews };
};

const main = async () => {
  const prisma = await getPrisma();

  // Safety: default to dry-run unless explicitly enabled.
  const apply = asBool(process.env.TAXONOMY_REMAP_AUTO_APPLY, false);
  const limit = asPositiveInt(process.env.TAXONOMY_REMAP_AUTO_RESEED_LIMIT_OVERRIDE, 10_000);
  const maxPasses = asPositiveInt(process.env.TAXONOMY_REMAP_AUTO_APPLY_MAX_PASSES, 25);
  const force = asBool(process.env.TAXONOMY_REMAP_AUTO_RESEED_FORCE, true);

  const startedPending = await countPending(prisma);
  const startedEligible = await countEligibleUndecided(prisma);

  console.log(
    JSON.stringify(
      {
        apply,
        limit,
        maxPasses,
        force,
        started: {
          pending: startedPending,
          eligibleUndecided: startedEligible,
        },
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.log("Dry-run only. Set TAXONOMY_REMAP_AUTO_APPLY=true to apply.");
    return;
  }

  const { runTaxonomyAutoReseedBatch } = await import("../src/lib/taxonomy-remap/auto-reseed");

  // 1) Apply anything already pending first (usually from cron runs).
  const pendingRunKeys = await listPendingRunKeys(prisma);
  if (pendingRunKeys.length) {
    console.log(JSON.stringify({ pendingRunKeys }, null, 2));
    for (const pendingRunKey of pendingRunKeys) {
      const note = `auto_apply existing pending runKey=${pendingRunKey ?? "null"}`;
      const applied = await acceptPendingByRunKey(prisma, pendingRunKey, note);
      const pendingAfter = await countPending(prisma);
      console.log(
        JSON.stringify(
          {
            phase: "apply_existing_pending",
            runKey: pendingRunKey,
            applied,
            pendingAfter,
          },
          null,
          2,
        ),
      );
    }
  }

  // 2) Generate new proposals for eligible undecided products and apply them in passes.
  let passes = 0;
  for (; passes < maxPasses; passes += 1) {
    const result = await runTaxonomyAutoReseedBatch({
      trigger: "manual",
      force,
      limit,
    });

    console.log(JSON.stringify({ pass: passes + 1, result }, null, 2));

    if (!result.triggered || !result.runKey) {
      break;
    }

    const note = `auto_apply eligible undecided (pass=${passes + 1}) runKey=${result.runKey}`;
    const applied = await acceptPendingByRunKey(prisma, result.runKey, note);
    const pendingAfter = await countPending(prisma);

    console.log(
      JSON.stringify(
        {
          pass: passes + 1,
          runKey: result.runKey,
          applied,
          pendingAfter,
        },
        null,
        2,
      ),
    );

    // Fast exit if nothing was proposed/enqueued.
    if (!result.enqueued || result.enqueued <= 0) {
      break;
    }
  }

  const endedPending = await countPending(prisma);
  const endedEligible = await countEligibleUndecided(prisma);

  console.log(
    JSON.stringify(
      {
        passesRun: passes,
        ended: {
          pending: endedPending,
          eligibleUndecided: endedEligible,
        },
      },
      null,
      2,
    ),
  );
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
