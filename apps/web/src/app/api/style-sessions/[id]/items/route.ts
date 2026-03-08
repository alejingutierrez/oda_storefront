import { NextResponse } from "next/server";
import { requireUser } from "@/lib/descope";
import { prisma } from "@/lib/prisma";
import { getSwipeItems } from "@/lib/style-engine/seeder";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

/** GET — Get swipe items for a session. Supports ?extend=true for auto-extension. */
export async function GET(req: Request, { params }: RouteParams) {
  const session = await requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify session ownership
  const styleSession = await prisma.styleSession.findUnique({
    where: { id },
    select: { userId: true, status: true },
  });

  if (!styleSession || styleSession.userId !== session.user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const extend = url.searchParams.get("extend") === "true";

  const items = await getSwipeItems(session.user.id, id, extend);

  // Count total likes in this session
  const likeCount = await prisma.styleInteraction.count({
    where: { sessionId: id, action: "like" },
  });

  return NextResponse.json(
    { items, total: items.length, likeCount },
    { headers: { "cache-control": "private, no-store" } },
  );
}
