import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { invalidateCatalogCache } from "@/lib/catalog-cache";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  revalidatePath("/");
  revalidateTag("home-config", { expire: 0 });
  invalidateCatalogCache();

  return NextResponse.json({ ok: true, revalidatedAt: new Date().toISOString() });
}
