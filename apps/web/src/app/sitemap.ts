import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { getSiteUrl } from "@/lib/site-url";
import { GENDER_ROUTE } from "@/lib/navigation";
import { getMegaMenuData } from "@/lib/home-data";

const GENDERS = ["Femenino", "Masculino", "Unisex", "Infantil"] as const;
const STYLE_LIMIT = 500;
const BRAND_LIMIT = 600;

function buildGenderUrl(gender: (typeof GENDERS)[number]) {
  return `/${GENDER_ROUTE[gender]}`;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const now = new Date();

  const basePages = ["/", "/catalogo", "/novedades", "/femenino", "/masculino", "/unisex", "/infantil"];

  const [menu, styles, brands] = await Promise.all([
    getMegaMenuData(),
    prisma.styleProfile.findMany({
      select: { key: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: STYLE_LIMIT,
    }),
    prisma.brand.findMany({
      where: { isActive: true },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: BRAND_LIMIT,
    }),
  ]);

  const menuPagesSet = new Set<string>();
  for (const gender of GENDERS) {
    menuPagesSet.add(buildGenderUrl(gender));
    const columns = menu[gender];
    for (const section of [columns.Superiores, columns.Inferiores, columns.Accesorios]) {
      for (const category of section) {
        menuPagesSet.add(category.href);
        for (const sub of category.subcategories ?? []) {
          menuPagesSet.add(sub.href);
        }
      }
    }
  }
  const menuPages = Array.from(menuPagesSet);

  const stylePages = styles
    .filter((row) => row.key && row.key.trim().length > 0)
    .map((row) => ({
      path: `/estilo/${encodeURIComponent(row.key)}`,
      lastModified: row.updatedAt ?? now,
      changeFrequency: "daily" as const,
      priority: 0.7,
    }));

  const brandPages = brands
    .filter((row) => row.slug && row.slug.trim().length > 0)
    .map((row) => ({
      path: `/marca/${encodeURIComponent(row.slug)}`,
      lastModified: row.updatedAt ?? now,
      changeFrequency: "daily" as const,
      priority: 0.8,
    }));

  const staticEntries: MetadataRoute.Sitemap = [
    ...basePages.map((path) => ({
      url: `${siteUrl}${path}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: path === "/" ? 1 : 0.8,
    })),
    ...menuPages.map((path) => ({
      url: `${siteUrl}${path}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.75,
    })),
  ];

  const dynamicEntries: MetadataRoute.Sitemap = [
    ...stylePages.map((row) => ({
      url: `${siteUrl}${row.path}`,
      lastModified: row.lastModified,
      changeFrequency: row.changeFrequency,
      priority: row.priority,
    })),
    ...brandPages.map((row) => ({
      url: `${siteUrl}${row.path}`,
      lastModified: row.lastModified,
      changeFrequency: row.changeFrequency,
      priority: row.priority,
    })),
  ];

  const deduped = new Map<string, MetadataRoute.Sitemap[number]>();
  for (const entry of [...staticEntries, ...dynamicEntries]) {
    deduped.set(entry.url, entry);
  }
  return Array.from(deduped.values());
}
