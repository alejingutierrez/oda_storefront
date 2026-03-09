import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => null)) as {
      productIds?: string[];
      subcategory?: string;
      category?: string;
      gender?: string;
    } | null;

    if (
      !body?.productIds ||
      !Array.isArray(body.productIds) ||
      body.productIds.length === 0 ||
      !body.subcategory ||
      !body.category
    ) {
      return NextResponse.json(
        { error: "productIds (non-empty array), subcategory, and category are required" },
        { status: 400 },
      );
    }

    const { productIds, subcategory, category, gender } = body;

    const result = await prisma.groundTruthProduct.createMany({
      data: productIds.map((productId) => ({
        productId,
        subcategory,
        category,
        gender: gender ?? null,
        isActive: true,
      })),
      skipDuplicates: true,
    });

    return NextResponse.json({ ok: true, confirmed: result.count });
  } catch (error) {
    console.error("[vector-classification/ground-truth/bulk-confirm] POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
