import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdminRequest } from "@/lib/auth";
import { revalidatePath, revalidateTag } from "next/cache";

export const runtime = "nodejs";

export type HomeConfigMap = Record<string, string>;

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await prisma.homeConfig.findMany({ orderBy: { key: "asc" } });
  const config: HomeConfigMap = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return NextResponse.json({ config });
}

export async function PUT(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, string> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const entries = Object.entries(body);
  if (entries.length === 0) return NextResponse.json({ error: "empty_payload" }, { status: 400 });

  for (const [key, value] of entries) {
    if (typeof key !== "string" || key.trim().length === 0) {
      return NextResponse.json({ error: `invalid_key: ${key}` }, { status: 400 });
    }
    if (typeof value !== "string") {
      return NextResponse.json({ error: `invalid_value_for: ${key}` }, { status: 400 });
    }
  }

  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.homeConfig.upsert({
        where: { key },
        create: { key, value, updatedBy: admin.email },
        update: { value, updatedBy: admin.email },
      }),
    ),
  );

  revalidatePath("/");
  revalidateTag("home-config", { expire: 0 });

  const rows = await prisma.homeConfig.findMany({ orderBy: { key: "asc" } });
  const config: HomeConfigMap = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return NextResponse.json({ ok: true, config });
}
