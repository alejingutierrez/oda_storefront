import { NextResponse } from "next/server";
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

export async function GET(req: Request, context: { params: { id: string } }) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = context.params;

  const combination = await prisma.colorCombination.findUnique({
    where: { id },
    include: {
      colors: {
        orderBy: { position: "asc" },
      },
    },
  });

  if (!combination) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const matches = await prisma.variantColorCombinationMatch.findMany({
    where: { combinationId: id },
    orderBy: { score: "asc" },
    include: {
      variant: {
        select: {
          id: true,
          images: true,
          product: {
            select: {
              id: true,
              name: true,
              imageCoverUrl: true,
              brand: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  const variantIds = matches.map((match) => match.variantId);
  if (!variantIds.length) {
    return NextResponse.json({
      combinationId: id,
      colors: combination.colors,
      groups: combination.colors.map((color) => ({
        color,
        productCount: 0,
        variantCount: 0,
        items: [],
      })),
    });
  }

  const vectors = await prisma.variantColorVector.findMany({
    where: { variantId: { in: variantIds } },
    select: { variantId: true, hex: true, labL: true, labA: true, labB: true },
  });

  const vectorMap = new Map<string, { hex: string; lab: { L: number; a: number; b: number } }[]>();
  for (const vector of vectors) {
    const lab = { L: vector.labL, a: vector.labA, b: vector.labB };
    const list = vectorMap.get(vector.variantId) ?? [];
    list.push({ hex: vector.hex, lab });
    vectorMap.set(vector.variantId, list);
  }

  const comboColors = combination.colors.map((color) => {
    let lab =
      color.labL !== null && color.labA !== null && color.labB !== null
        ? { L: color.labL, a: color.labA, b: color.labB }
        : null;
    if (!lab) {
      const normalized = normalizeHex(color.hex);
      if (normalized) {
        lab = hexToLab(normalized);
      }
    }
    return {
      ...color,
      hex: normalizeHex(color.hex) ?? color.hex,
      lab,
    };
  });

  const colorThreshold = Number(process.env.COLOR_MATCH_COLOR_THRESHOLD ?? 12);

  const groupMap = new Map<
    string,
    {
      color: (typeof comboColors)[number];
      items: Map<string, { productId: string; variantId: string; name: string; brand: string; imageUrl: string | null; distance: number }>;
      variantCount: number;
    }
  >();

  for (const color of comboColors) {
    groupMap.set(color.id, { color, items: new Map(), variantCount: 0 });
  }

  for (const match of matches) {
    const variant = match.variant;
    if (!variant) continue;
    const vectorsForVariant = vectorMap.get(match.variantId) ?? [];
    if (!vectorsForVariant.length) continue;

    const product = variant.product;
    const productId = product?.id ?? match.variantId;
    const brandName = product?.brand?.name ?? "";
    const name = product?.name ?? "Producto";
    const imageUrl = variant.images?.[0] ?? product?.imageCoverUrl ?? null;

    for (const color of comboColors) {
      if (!color.lab) continue;
      let minDistance = Number.POSITIVE_INFINITY;
      for (const vector of vectorsForVariant) {
        const distance = deltaE2000(color.lab, vector.lab);
        if (distance < minDistance) minDistance = distance;
      }

      if (minDistance > colorThreshold) continue;
      const group = groupMap.get(color.id);
      if (!group) continue;

      group.variantCount += 1;

      const existing = group.items.get(productId);
      if (!existing || minDistance < existing.distance) {
        group.items.set(productId, {
          productId,
          variantId: variant.id,
          name,
          brand: brandName,
          imageUrl,
          distance: minDistance,
        });
      }
    }
  }

  const groups = comboColors.map((color) => {
    const group = groupMap.get(color.id);
    const items = group ? Array.from(group.items.values()).sort((a, b) => a.distance - b.distance) : [];
    return {
      color,
      productCount: items.length,
      variantCount: group?.variantCount ?? 0,
      items,
    };
  });

  return NextResponse.json({
    combinationId: id,
    colors: comboColors,
    groups,
  });
}
