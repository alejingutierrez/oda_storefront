/**
 * Backfill product slugs for all products that don't have one yet.
 * Run with: npx tsx scripts/backfill-product-slugs.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { generateProductSlug } from "../src/lib/product-slug";

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.NEON_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL in environment");
}

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Get all brands with their products that need slugs
  const brands = await prisma.brand.findMany({
    select: { id: true, name: true },
  });

  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const brand of brands) {
    const products = await prisma.product.findMany({
      where: { brandId: brand.id },
      select: { id: true, name: true, slug: true },
      orderBy: { createdAt: "asc" },
    });

    // Collect existing slugs for this brand
    const existingSlugs = new Set<string>();
    for (const p of products) {
      if (p.slug) existingSlugs.add(p.slug);
    }

    // Generate slugs for products without one
    const updates: { id: string; slug: string }[] = [];
    for (const p of products) {
      if (p.slug) {
        totalSkipped++;
        continue;
      }
      const base = generateProductSlug(p.name);
      let slug = base || "producto";
      if (existingSlugs.has(slug)) {
        let suffix = 2;
        while (existingSlugs.has(`${slug}-${suffix}`)) suffix++;
        slug = `${base}-${suffix}`;
      }
      existingSlugs.add(slug);
      updates.push({ id: p.id, slug });
    }

    // Batch update in chunks to avoid transaction timeouts
    const CHUNK_SIZE = 50;
    for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
      const chunk = updates.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map((u) =>
          prisma.product.update({
            where: { id: u.id },
            data: { slug: u.slug },
          }),
        ),
      );
    }
    if (updates.length > 0) {
      totalUpdated += updates.length;
      console.log(
        `[${brand.name}] ${updates.length} slugs generated`,
      );
    }
  }

  console.log(
    `\nDone. Updated: ${totalUpdated}, Skipped (already had slug): ${totalSkipped}`,
  );
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
    pool.end();
  });
