import { NextResponse } from "next/server";
import { requireUser } from "@/lib/descope";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const preferencesSchema = z.object({
  occasion: z.string().min(1),
  fit: z.string().min(1),
  palette: z.string().min(1),
});

type RouteParams = { params: Promise<{ id: string }> };

/** PATCH — Save refinement preferences for a session. */
export async function PATCH(req: Request, { params }: RouteParams) {
  const session = await requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const styleSession = await prisma.styleSession.findUnique({
    where: { id },
    select: { userId: true },
  });

  if (!styleSession || styleSession.userId !== session.user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = preferencesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await prisma.styleSession.update({
    where: { id },
    data: { preferences: parsed.data },
  });

  return NextResponse.json(
    { success: true },
    { headers: { "cache-control": "private, no-store" } },
  );
}
