import { NextResponse } from "next/server";
import { requireUser } from "@/lib/descope";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const interactionSchema = z.object({
  productId: z.string().uuid(),
  action: z.enum(["like", "dislike", "maybe"]),
  timeSpentMs: z.number().int().positive().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

/** POST — Record a swipe interaction. */
export async function POST(req: Request, { params }: RouteParams) {
  const session = await requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify session ownership
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

  const parsed = interactionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await prisma.styleInteraction.create({
    data: {
      sessionId: id,
      productId: parsed.data.productId,
      action: parsed.data.action,
      timeSpentMs: parsed.data.timeSpentMs ?? null,
    },
  });

  // Return current like count so frontend knows when threshold is met
  const totalLikes = await prisma.styleInteraction.count({
    where: { sessionId: id, action: "like" },
  });

  return NextResponse.json(
    { success: true, totalLikes },
    { headers: { "cache-control": "private, no-store" } },
  );
}
