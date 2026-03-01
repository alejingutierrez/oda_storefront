import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { isPrismaTableMissingError } from "@/lib/prisma-error-utils";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const pins = await prisma.homeHeroPin.findMany({
      orderBy: { position: "asc" },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            imageCoverUrl: true,
            brandId: true,
            brand: { select: { name: true } },
            category: true,
            hasInStock: true,
            sourceUrl: true,
          },
        },
      },
    });

    return NextResponse.json({ pins });
  } catch (error) {
    if (!isPrismaTableMissingError(error, "home_hero_pins")) throw error;
    console.warn("admin.home.api.hero_pins.table_missing_fallback", { table: "home_hero_pins" });
    return NextResponse.json({ pins: [], unavailable: true });
  }
}

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const productId = typeof body.productId === "string" ? body.productId.trim() : null;
  if (!productId) return NextResponse.json({ error: "productId_required" }, { status: 400 });

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, imageCoverUrl: true },
  });
  if (!product) return NextResponse.json({ error: "product_not_found" }, { status: 404 });

  try {
    const existing = await prisma.homeHeroPin.findFirst({ where: { productId } });
    if (existing) return NextResponse.json({ error: "already_pinned" }, { status: 409 });

    const maxPos = await prisma.homeHeroPin.aggregate({ _max: { position: true } });
    const position = (maxPos._max.position ?? -1) + 1;

    const parseDate = (value: unknown) => {
      if (!value || typeof value !== "string") return undefined;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? undefined : d;
    };

    const pin = await prisma.homeHeroPin.create({
      data: {
        productId,
        position,
        active: typeof body.active === "boolean" ? body.active : true,
        startsAt: parseDate(body.startsAt),
        endsAt: parseDate(body.endsAt),
        note: typeof body.note === "string" ? body.note.trim() || null : null,
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            imageCoverUrl: true,
            brand: { select: { name: true } },
            category: true,
            hasInStock: true,
            sourceUrl: true,
          },
        },
      },
    });

    revalidatePath("/");
    return NextResponse.json({ ok: true, pin }, { status: 201 });
  } catch (error) {
    if (!isPrismaTableMissingError(error, "home_hero_pins")) throw error;
    return NextResponse.json({ error: "home_hero_pins_table_missing" }, { status: 503 });
  }
}
