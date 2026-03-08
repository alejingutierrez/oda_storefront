import { NextResponse } from "next/server";
import { requireUser } from "@/lib/descope";
import { prisma } from "@/lib/prisma";
import { calculateStyleProfile } from "@/lib/style-engine/profile-calculator";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

/** GET — Calculate and return the style profile for a session. */
export async function GET(req: Request, { params }: RouteParams) {
  const session = await requireUser(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const styleSession = await prisma.styleSession.findUnique({
    where: { id },
    select: { userId: true, status: true },
  });

  if (!styleSession || styleSession.userId !== session.user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Calculate profile
  const profile = await calculateStyleProfile(session.user.id, id);

  // Upsert the user's style profile
  await prisma.userStyleProfile.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      coherenceScore: profile.coherenceScore,
      keywords: profile.keywords,
      dimensions: {
        dimensions: profile.dimensions,
        attributeProfile: profile.attributeProfile,
      },
    },
    update: {
      coherenceScore: profile.coherenceScore,
      keywords: profile.keywords,
      dimensions: {
        dimensions: profile.dimensions,
        attributeProfile: profile.attributeProfile,
      },
    },
  });

  // Mark session as completed
  await prisma.styleSession.update({
    where: { id },
    data: { status: "completed", completedAt: new Date() },
  });

  return NextResponse.json(
    {
      coherenceScore: profile.coherenceScore,
      keywords: profile.keywords,
      dimensions: profile.dimensions,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
