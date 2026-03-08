import { NextResponse } from "next/server";
import { requireUser } from "@/lib/descope";
import { prisma } from "@/lib/prisma";
import { getRecommendations } from "@/lib/style-engine/scorer";
import type { AttributeEntry, SessionPreferences } from "@/lib/style-engine/types";

export const runtime = "nodejs";

/** GET — Paginated recommendations feed, tiered by match score. */
export async function GET(req: Request) {
  const session = await requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(40, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20));
  const tier = url.searchParams.get("tier") === "explore" ? "explore" : "top";

  if (!sessionId) {
    return NextResponse.json({ error: "missing_sessionId" }, { status: 400 });
  }

  // Verify session ownership and get preferences
  const styleSession = await prisma.styleSession.findUnique({
    where: { id: sessionId },
    select: { userId: true, preferences: true },
  });

  if (!styleSession || styleSession.userId !== session.user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Get the user's style profile
  const styleProfile = await prisma.userStyleProfile.findUnique({
    where: { userId: session.user.id },
  });

  if (!styleProfile) {
    return NextResponse.json({ error: "no_profile" }, { status: 400 });
  }

  const dims = styleProfile.dimensions as Record<string, unknown>;
  const attributeProfile = (dims?.attributeProfile ?? {}) as Record<string, AttributeEntry>;
  const prefs = (styleSession.preferences ?? {}) as SessionPreferences;

  const preferences: SessionPreferences = {
    occasion: prefs.occasion ?? null,
    fit: prefs.fit ?? null,
    palette: prefs.palette ?? null,
  };

  const result = await getRecommendations(
    session.user.id,
    attributeProfile,
    preferences,
    tier,
    page,
    limit,
  );

  return NextResponse.json(result, {
    headers: { "cache-control": "private, no-store" },
  });
}
