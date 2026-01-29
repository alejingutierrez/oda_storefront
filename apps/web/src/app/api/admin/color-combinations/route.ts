import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";

const toInt = (value: string | null, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const normalizeListParam = (values: string[]) => {
  const items = values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return Array.from(new Set(items));
};

const sortStrings = (values: Array<string | null | undefined>) =>
  values
    .filter((value): value is string => Boolean(value && value.trim().length))
    .map((value) => value.trim())
    .sort((a, b) => a.localeCompare(b, "es"));

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = toInt(url.searchParams.get("page"), 1);
  const pageSize = Math.min(toInt(url.searchParams.get("pageSize"), 24), 60);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const seasons = normalizeListParam(url.searchParams.getAll("season"));
  const temperatures = normalizeListParam(url.searchParams.getAll("temperature"));
  const layouts = normalizeListParam(url.searchParams.getAll("layout"));
  const contrasts = normalizeListParam(url.searchParams.getAll("contrast"));
  const colorsCount = url.searchParams.get("colorsCount")?.trim();

  const where: Parameters<typeof prisma.colorCombination.findMany>[0]["where"] = {};

  if (seasons.length) {
    where.season = { in: seasons };
  }
  if (temperatures.length) {
    where.temperature = { in: temperatures };
  }
  if (layouts.length) {
    where.detectedLayout = { in: layouts };
  }
  if (contrasts.length) {
    where.contrast = { in: contrasts };
  }

  if (query) {
    where.OR = [
      { imageFilename: { contains: query, mode: "insensitive" } },
      { comboKey: { contains: query, mode: "insensitive" } },
      { season: { contains: query, mode: "insensitive" } },
      { temperature: { contains: query, mode: "insensitive" } },
      { mood: { contains: query, mode: "insensitive" } },
      {
        colors: {
          some: {
            OR: [
              { pantoneName: { contains: query, mode: "insensitive" } },
              { pantoneCode: { contains: query, mode: "insensitive" } },
              { hex: { contains: query, mode: "insensitive" } },
            ],
          },
        },
      },
    ];
  }

  const combos = await prisma.colorCombination.findMany({
    where,
    include: {
      colors: {
        orderBy: { position: "asc" },
      },
    },
    orderBy: [{ imageFilename: "asc" }, { comboKey: "asc" }],
  });

  let filtered = combos;
  const desiredCount = colorsCount ? Number(colorsCount) : null;
  if (desiredCount && Number.isFinite(desiredCount)) {
    filtered = combos.filter((combo) => combo.colors.length === desiredCount);
  }

  const total = filtered.length;
  const offset = (page - 1) * pageSize;
  const paged = filtered.slice(offset, offset + pageSize);

  const [seasonOptions, temperatureOptions, layoutOptions, contrastOptions] = await Promise.all([
    prisma.colorCombination.findMany({ distinct: ["season"], select: { season: true } }),
    prisma.colorCombination.findMany({ distinct: ["temperature"], select: { temperature: true } }),
    prisma.colorCombination.findMany({ distinct: ["detectedLayout"], select: { detectedLayout: true } }),
    prisma.colorCombination.findMany({ distinct: ["contrast"], select: { contrast: true } }),
  ]);

  const filters = {
    seasons: sortStrings(seasonOptions.map((row) => row.season)),
    temperatures: sortStrings(temperatureOptions.map((row) => row.temperature)),
    layouts: sortStrings(layoutOptions.map((row) => row.detectedLayout)),
    contrasts: sortStrings(contrastOptions.map((row) => row.contrast)),
  };

  return NextResponse.json({
    items: paged,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    filters,
  });
}
