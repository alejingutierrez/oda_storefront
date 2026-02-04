import { prisma } from "@/lib/prisma";

export type BrandConstraints = {
  city: string[];
  category: string[];
  productCategory: string[];
  market: string[];
  scale: string[];
  style: string[];
};

type BrandField = keyof Pick<
  BrandConstraints,
  "city" | "category" | "productCategory" | "market" | "scale" | "style"
>;

const CACHE_TTL_MS = 10 * 60 * 1000;
let cached: { loadedAt: number; constraints: BrandConstraints } | null = null;

const sanitizeValues = (values: Array<string | null | undefined>) => {
  const cleaned = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  return Array.from(new Set(cleaned)).sort((a, b) => a.localeCompare(b, "es"));
};

async function distinctBrandField(field: BrandField) {
  const rows = await prisma.$queryRawUnsafe<{ value: string }[]>(
    `SELECT DISTINCT \"${field}\" as value FROM \"brands\" WHERE \"${field}\" IS NOT NULL AND \"${field}\" <> ''`,
  );
  return sanitizeValues(rows.map((row) => row.value));
}

export async function loadBrandConstraints(): Promise<BrandConstraints> {
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.constraints;
  }

  const [city, category, productCategory, market, scale, style] = await Promise.all([
    distinctBrandField("city"),
    distinctBrandField("category"),
    distinctBrandField("productCategory"),
    distinctBrandField("market"),
    distinctBrandField("scale"),
    distinctBrandField("style"),
  ]);

  const constraints = { city, category, productCategory, market, scale, style };
  cached = { loadedAt: Date.now(), constraints };
  return constraints;
}
