import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { isPrismaTableMissingError } from "@/lib/prisma-error-utils";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  let pin: { id: string } | null = null;
  try {
    pin = await prisma.homeHeroPin.findUnique({ where: { id }, select: { id: true } });
  } catch (error) {
    if (!isPrismaTableMissingError(error, "home_hero_pins")) throw error;
    return NextResponse.json({ error: "home_hero_pins_table_missing" }, { status: 503 });
  }
  if (!pin) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parseDate = (value: unknown) => {
    if (value === null) return null;
    if (!value || typeof value !== "string") return undefined;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };

  const data: Record<string, unknown> = {};
  if ("active" in body && typeof body.active === "boolean") data.active = body.active;
  if ("position" in body && typeof body.position === "number") data.position = Math.max(0, Math.floor(body.position));
  if ("note" in body) data.note = typeof body.note === "string" ? body.note.trim() || null : null;
  if ("startsAt" in body) {
    const d = parseDate(body.startsAt);
    if (d !== undefined) data.startsAt = d;
  }
  if ("endsAt" in body) {
    const d = parseDate(body.endsAt);
    if (d !== undefined) data.endsAt = d;
  }

  try {
    const updated = await prisma.homeHeroPin.update({
      where: { id },
      data,
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
    return NextResponse.json({ ok: true, pin: updated });
  } catch (error) {
    if (!isPrismaTableMissingError(error, "home_hero_pins")) throw error;
    return NextResponse.json({ error: "home_hero_pins_table_missing" }, { status: 503 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const pin = await prisma.homeHeroPin.findUnique({ where: { id }, select: { id: true } });
    if (!pin) return NextResponse.json({ error: "not_found" }, { status: 404 });

    await prisma.homeHeroPin.delete({ where: { id } });
    revalidatePath("/");
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (!isPrismaTableMissingError(error, "home_hero_pins")) throw error;
    return NextResponse.json({ error: "home_hero_pins_table_missing" }, { status: 503 });
  }
}
