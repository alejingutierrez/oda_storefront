import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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

const readEntryHex = (entry: unknown) => {
  if (!entry || typeof entry !== "object") return null;
  const hex = (entry as { hex?: unknown }).hex;
  return typeof hex === "string" ? hex : null;
};

const readEntryRole = (entry: unknown) => {
  if (!entry || typeof entry !== "object") return null;
  const role = (entry as { role?: unknown }).role;
  return typeof role === "string" ? role : null;
};

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = toInt(url.searchParams.get("page"), 1);
  const pageSize = Math.min(toInt(url.searchParams.get("pageSize"), 24), 60);
  const seasons = normalizeListParam(url.searchParams.getAll("season"));
  const temperatures = normalizeListParam(url.searchParams.getAll("temperature"));
  const contrasts = normalizeListParam(url.searchParams.getAll("contrast"));
  const moods = normalizeListParam(url.searchParams.getAll("mood"));

  const where: Prisma.ColorCombinationWhereInput = {};

  if (seasons.length) {
    where.season = { in: seasons };
  }
  if (temperatures.length) {
    where.temperature = { in: temperatures };
  }
  if (contrasts.length) {
    where.contrast = { in: contrasts };
  }
  if (moods.length) {
    where.mood = { in: moods };
  }

  const combos = await prisma.colorCombination.findMany({
    where,
    select: {
      id: true,
      imageFilename: true,
      detectedLayout: true,
      comboKey: true,
      season: true,
      temperature: true,
      contrast: true,
      mood: true,
      colorsJson: true,
    },
    orderBy: [{ imageFilename: "asc" }, { comboKey: "asc" }],
  });

  const palette = await prisma.colorCombinationPalette.findMany({
    select: {
      id: true,
      hex: true,
      pantoneCode: true,
      pantoneName: true,
    },
  });
  const paletteMap = new Map(
    palette.map((entry) => [entry.hex?.toUpperCase(), entry]),
  );

  const withColors = combos.map((combo) => {
    const raw = combo.colorsJson;
    const colorsArray = Array.isArray(raw) ? raw : [];
    const colors = colorsArray
      .map((entry, index) => {
        const rawHex = readEntryHex(entry);
        const hex = typeof rawHex === "string" ? rawHex.toUpperCase() : null;
        if (!hex) return null;
        const paletteEntry = paletteMap.get(hex);
        return {
          id: `${combo.id}:${index + 1}`,
          position: index + 1,
          role: readEntryRole(entry),
          hex,
          pantoneCode: paletteEntry?.pantoneCode ?? null,
          pantoneName: paletteEntry?.pantoneName ?? null,
        };
      })
      .filter(Boolean);
    return { ...combo, colors };
  });

  const total = withColors.length;
  const offset = (page - 1) * pageSize;
  const paged = withColors.slice(offset, offset + pageSize);

  const [seasonOptions, temperatureOptions, contrastOptions, moodOptions] = await Promise.all([
    prisma.colorCombination.findMany({ distinct: ["season"], select: { season: true } }),
    prisma.colorCombination.findMany({ distinct: ["temperature"], select: { temperature: true } }),
    prisma.colorCombination.findMany({ distinct: ["contrast"], select: { contrast: true } }),
    prisma.colorCombination.findMany({ distinct: ["mood"], select: { mood: true } }),
  ]);

  const filters = {
    seasons: sortStrings(seasonOptions.map((row) => row.season)),
    temperatures: sortStrings(temperatureOptions.map((row) => row.temperature)),
    contrasts: sortStrings(contrastOptions.map((row) => row.contrast)),
    moods: sortStrings(moodOptions.map((row) => row.mood)),
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
