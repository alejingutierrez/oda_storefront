import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const brandId = typeof body?.brandId === "string" ? body.brandId : null;
  const reason = typeof body?.reason === "string" ? body.reason : null;
  if (!brandId) {
    return NextResponse.json({ error: "missing_brand" }, { status: 400 });
  }

  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { metadata: true } });
  if (!brand) {
    return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
  }

  const metadata =
    brand.metadata && typeof brand.metadata === "object" && !Array.isArray(brand.metadata)
      ? (brand.metadata as Record<string, unknown>)
      : {};
  const nextMetadata = { ...metadata };
  delete nextMetadata.catalog_extract;
  nextMetadata.catalog_extract_finished = {
    finishedAt: new Date().toISOString(),
    reason: reason ?? "manual_finish",
  };

  await prisma.brand.update({
    where: { id: brandId },
    data: { metadata: nextMetadata as Prisma.InputJsonValue },
  });

  return NextResponse.json({ status: "finished" });
}
