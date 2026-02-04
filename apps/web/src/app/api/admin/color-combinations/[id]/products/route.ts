import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";

const hexRegex = /^#?[0-9a-fA-F]{6}$/;

const normalizeHex = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!hexRegex.test(trimmed)) return null;
  return trimmed.startsWith("#") ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`;
};

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

const hexToRgb = (hex: string) => {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  return { r, g, b };
};

const rgbToXyz = ({ r, g, b }: { r: number; g: number; b: number }) => {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  const z = rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041;
  return { x, y, z };
};

const pivotXyz = (t: number) => (t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116);

const xyzToLab = ({ x, y, z }: { x: number; y: number; z: number }) => {
  const refX = 0.95047;
  const refY = 1.0;
  const refZ = 1.08883;
  const fx = pivotXyz(x / refX);
  const fy = pivotXyz(y / refY);
  const fz = pivotXyz(z / refZ);
  const L = Math.max(0, 116 * fy - 16);
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);
  return { L, a, b };
};

const hexToLab = (hex: string) => {
  const rgb = hexToRgb(hex);
  const xyz = rgbToXyz(rgb);
  return xyzToLab(xyz);
};

const degToRad = (deg: number) => (deg * Math.PI) / 180;
const radToDeg = (rad: number) => (rad * 180) / Math.PI;

const deltaE2000 = (lab1: { L: number; a: number; b: number }, lab2: { L: number; a: number; b: number }) => {
  const L1 = lab1.L;
  const a1 = lab1.a;
  const b1 = lab1.b;
  const L2 = lab2.L;
  const a2 = lab2.a;
  const b2 = lab2.b;

  const avgLp = (L1 + L2) / 2;
  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const avgC = (C1 + C2) / 2;

  const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);
  const avgCp = (C1p + C2p) / 2;

  const h1p = Math.atan2(b1, a1p);
  const h2p = Math.atan2(b2, a2p);
  const h1pDeg = h1p >= 0 ? radToDeg(h1p) : radToDeg(h1p) + 360;
  const h2pDeg = h2p >= 0 ? radToDeg(h2p) : radToDeg(h2p) + 360;

  let deltahp = 0;
  if (Math.abs(h1pDeg - h2pDeg) <= 180) {
    deltahp = h2pDeg - h1pDeg;
  } else if (h2pDeg <= h1pDeg) {
    deltahp = h2pDeg - h1pDeg + 360;
  } else {
    deltahp = h2pDeg - h1pDeg - 360;
  }

  const deltaLp = L2 - L1;
  const deltaCp = C2p - C1p;
  const deltaHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(degToRad(deltahp / 2));

  let avgHp = 0;
  if (Math.abs(h1pDeg - h2pDeg) <= 180) {
    avgHp = (h1pDeg + h2pDeg) / 2;
  } else if (h1pDeg + h2pDeg < 360) {
    avgHp = (h1pDeg + h2pDeg + 360) / 2;
  } else {
    avgHp = (h1pDeg + h2pDeg - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(degToRad(avgHp - 30)) +
    0.24 * Math.cos(degToRad(2 * avgHp)) +
    0.32 * Math.cos(degToRad(3 * avgHp + 6)) -
    0.2 * Math.cos(degToRad(4 * avgHp - 63));

  const deltaTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(avgLp - 50, 2)) / Math.sqrt(20 + Math.pow(avgLp - 50, 2));
  const Sc = 1 + 0.045 * avgCp;
  const Sh = 1 + 0.015 * avgCp * T;
  const Rt = -Math.sin(degToRad(2 * deltaTheta)) * Rc;

  const deltaE = Math.sqrt(
    Math.pow(deltaLp / Sl, 2) +
      Math.pow(deltaCp / Sc, 2) +
      Math.pow(deltaHp / Sh, 2) +
      Rt * (deltaCp / Sc) * (deltaHp / Sh),
  );

  return deltaE;
};

const normalizeRole = (role: string | null | undefined) => {
  if (!role) return null;
  const value = role.trim().toLowerCase();
  if (!value) return null;
  if (["dominante", "dominant", "primary", "principal"].includes(value)) return "dominant";
  if (["secundario", "secondary"].includes(value)) return "secondary";
  if (["acento", "accent"].includes(value)) return "accent";
  return value;
};

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

const categoryAllowListByRole: Record<string, Set<string>> = {
  dominant: new Set([
    "blazers_y_sastreria",
    "buzos_hoodies_y_sueteres",
    "camisas_y_blusas",
    "chaquetas_y_abrigos",
    "enterizos_y_overoles",
    "faldas",
    "jeans_y_denim",
    "pantalones_no_denim",
    "vestidos",
  ]),
  secondary: new Set([
    "shorts_y_bermudas",
    "pantalones_no_denim",
    "jeans_y_denim",
    "camisetas_y_tops",
    "blazers_y_sastreria",
  ]),
  accent: new Set([
    "accesorios_textiles_y_medias",
    "bolsos_y_marroquineria",
    "calzado",
    "gafas_y_optica",
    "joyeria_y_bisuteria",
  ]),
};

const categoryAllowListAll = new Set(
  Object.values(categoryAllowListByRole).flatMap((set) => Array.from(set)),
);

type RouteContext = { params: Promise<{ id: string }> };

const parseIntParam = (value: string | null | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
};

const parseListParam = (params: URLSearchParams, key: string) => {
  const values = params
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return Array.from(new Set(values));
};

const mapColorSummary = (color: {
  id: string;
  position: number;
  role: string | null;
  hex: string | null;
  pantoneCode: string | null;
  pantoneName: string | null;
}) => ({
  id: color.id,
  position: color.position,
  role: color.role,
  hex: color.hex,
  pantoneCode: color.pantoneCode ?? null,
  pantoneName: color.pantoneName ?? null,
});

export async function GET(req: NextRequest, context: RouteContext) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const url = new URL(req.url);
  const colorIdParam = url.searchParams.get("colorId");
  const limit = parseIntParam(url.searchParams.get("limit"), 24);
  const offset = parseIntParam(url.searchParams.get("offset"), 0);
  const genderFilter = parseListParam(url.searchParams, "gender");
  const categoryFilter = parseListParam(url.searchParams, "category");
  const subcategoryFilter = parseListParam(url.searchParams, "subcategory");

  const combination = await prisma.colorCombination.findUnique({
    where: { id },
    select: {
      id: true,
      colorsJson: true,
    },
  });

  if (!combination) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const rawColors = Array.isArray(combination.colorsJson) ? combination.colorsJson : [];
  const paletteHexes = rawColors
    .map((entry) => normalizeHex(readEntryHex(entry)))
    .filter((value): value is string => Boolean(value));

  const paletteRows = paletteHexes.length
    ? await prisma.colorCombinationPalette.findMany({
        where: { hex: { in: paletteHexes } },
        select: {
          id: true,
          hex: true,
          pantoneCode: true,
          pantoneName: true,
          standardColorId: true,
        },
      })
    : [];
  const paletteMap = new Map(
    paletteRows.map((row) => [row.hex.toUpperCase(), row]),
  );

  const standardRows = await prisma.standardColor.findMany({
    select: { id: true, hex: true, labL: true, labA: true, labB: true },
  });
  const standardMap = new Map(
    standardRows.map((row) => [row.id, { L: row.labL, a: row.labA, b: row.labB }]),
  );

  const comboColors = rawColors
    .map((entry, index) => {
      const rawHex = readEntryHex(entry);
      const hex = normalizeHex(rawHex) ?? rawHex ?? null;
      const paletteEntry = hex ? paletteMap.get(hex.toUpperCase()) : null;
      const standardLab = paletteEntry?.standardColorId
        ? standardMap.get(paletteEntry.standardColorId)
        : null;
      let lab = standardLab ?? null;
      if (!lab && hex) {
        lab = hexToLab(hex);
      }
      return {
        id: `${combination.id}:${index + 1}`,
        position: index + 1,
        role: readEntryRole(entry),
        hex,
        pantoneCode: paletteEntry?.pantoneCode ?? null,
        pantoneName: paletteEntry?.pantoneName ?? null,
        labL: lab?.L ?? null,
        labA: lab?.a ?? null,
        labB: lab?.b ?? null,
        standardColorId: paletteEntry?.standardColorId ?? null,
        lab,
      };
    })
    .filter((color) => Boolean(color.hex));

  if (!colorIdParam) {
    return NextResponse.json({
      combinationId: id,
      colors: comboColors.map((color) =>
        mapColorSummary({
          id: color.id,
          position: color.position,
          role: color.role,
          hex: color.hex,
          pantoneCode: color.pantoneCode ?? null,
          pantoneName: color.pantoneName ?? null,
        }),
      ),
    });
  }

  const targetColor = comboColors.find((color) => color.id === colorIdParam);
  if (!targetColor) {
    return NextResponse.json({ error: "color_not_found" }, { status: 404 });
  }

  const colorThreshold = Number(process.env.COLOR_MATCH_COLOR_THRESHOLD ?? 26);
  const targetLab = targetColor.lab ?? (targetColor.hex ? hexToLab(targetColor.hex) : null);
  const standardColors = standardRows
    .map((row) => ({
      id: row.id,
      hex: normalizeHex(row.hex) ?? null,
      lab: { L: row.labL, a: row.labA, b: row.labB },
    }))
    .filter((row) => row.hex);

  const distanceByHex = new Map<string, number>();
  const allowedHexes: string[] = [];
  if (targetLab) {
    for (const color of standardColors) {
      if (!color.hex) continue;
      const distance = deltaE2000(targetLab, color.lab);
      if (distance <= colorThreshold) {
        allowedHexes.push(color.hex);
        distanceByHex.set(color.hex, distance);
      }
    }
  }
  if (!allowedHexes.length && targetColor.hex) {
    const fallbackHex = normalizeHex(targetColor.hex) ?? targetColor.hex;
    allowedHexes.push(fallbackHex);
    distanceByHex.set(fallbackHex, 0);
  }

  const roleKey = normalizeRole(targetColor.role);
  const allowList = roleKey ? categoryAllowListByRole[roleKey] : null;
  const allowedCategories = allowList ? Array.from(allowList) : Array.from(categoryAllowListAll);

  if (!allowedHexes.length || !allowedCategories.length) {
    return NextResponse.json({
      combinationId: id,
      color: mapColorSummary({
        id: targetColor.id,
        position: targetColor.position,
        role: targetColor.role,
        hex: targetColor.hex,
        pantoneCode: targetColor.pantoneCode ?? null,
        pantoneName: targetColor.pantoneName ?? null,
      }),
      totalProductCount: 0,
      filteredProductCount: 0,
      variantCount: 0,
      filterOptions: { genders: [], categories: [], subcategories: [] },
      items: [],
    });
  }

  const rows = await prisma.$queryRaw<
    Array<{
      variantId: string;
      productId: string;
      images: string[] | null;
      productName: string | null;
      category: string | null;
      subcategory: string | null;
      gender: string | null;
      imageCoverUrl: string | null;
      brandName: string | null;
      hex: string;
    }>
  >(
    Prisma.sql`
      SELECT
        m."variantId" as "variantId",
        v."productId" as "productId",
        v.images as images,
        p.name as "productName",
        p.category as category,
        p.subcategory as subcategory,
        p.gender as gender,
        p."imageCoverUrl" as "imageCoverUrl",
        b.name as "brandName",
        vec.hex as hex
      FROM "variant_color_combination_matches" m
      JOIN "variant_color_vectors" vec ON vec."variantId" = m."variantId"
      JOIN "variants" v ON v.id = m."variantId"
      JOIN "products" p ON p.id = v."productId"
      LEFT JOIN "brands" b ON b.id = p."brandId"
      WHERE m."combinationId" = ${id}
        AND vec.hex IN (${Prisma.join(allowedHexes)})
        AND p.category IN (${Prisma.join(allowedCategories)})
    `,
  );

  const productMap = new Map<
    string,
    {
      productId: string;
      variantId: string;
      name: string;
      brand: string;
      imageUrl: string | null;
      distance: number;
      gender: string | null;
      category: string | null;
      subcategory: string | null;
    }
  >();
  const variantSet = new Set<string>();

  for (const row of rows) {
    const hex = normalizeHex(row.hex) ?? row.hex;
    const distance = distanceByHex.get(hex);
    if (distance === undefined) continue;
    variantSet.add(row.variantId);
    const productId = row.productId ?? row.variantId;
    const imageUrl =
      (Array.isArray(row.images) && row.images.length ? row.images[0] : null) ??
      row.imageCoverUrl ??
      null;
    const existing = productMap.get(productId);
    if (!existing || distance < existing.distance) {
      productMap.set(productId, {
        productId,
        variantId: row.variantId,
        name: row.productName ?? "Producto",
        brand: row.brandName ?? "",
        imageUrl,
        distance,
        gender: row.gender ?? null,
        category: row.category ?? null,
        subcategory: row.subcategory ?? null,
      });
    }
  }

  const variantCount = variantSet.size;

  const allItems = Array.from(productMap.values()).sort((a, b) => a.distance - b.distance);
  const genderOptions = new Set<string>();
  const categoryOptions = new Set<string>();
  const subcategoryOptions = new Set<string>();

  for (const item of allItems) {
    if (item.gender) genderOptions.add(item.gender);
    if (item.category) categoryOptions.add(item.category);
    if (item.subcategory) subcategoryOptions.add(item.subcategory);
  }

  const totalProductCount = allItems.length;
  const filteredItems = allItems.filter((item) => {
    if (genderFilter.length && (!item.gender || !genderFilter.includes(item.gender))) return false;
    if (categoryFilter.length && (!item.category || !categoryFilter.includes(item.category))) return false;
    if (subcategoryFilter.length && (!item.subcategory || !subcategoryFilter.includes(item.subcategory))) return false;
    return true;
  });
  const filteredProductCount = filteredItems.length;
  const pageItems = filteredItems.slice(offset, offset + limit);

  return NextResponse.json({
    combinationId: id,
    color: mapColorSummary({
      id: targetColor.id,
      position: targetColor.position,
      role: targetColor.role,
      hex: targetColor.hex,
      pantoneCode: targetColor.pantoneCode ?? null,
      pantoneName: targetColor.pantoneName ?? null,
    }),
    totalProductCount,
    filteredProductCount,
    variantCount,
    filterOptions: {
      genders: Array.from(genderOptions).sort(),
      categories: Array.from(categoryOptions).sort(),
      subcategories: Array.from(subcategoryOptions).sort(),
    },
    items: pageItems,
  });
}
