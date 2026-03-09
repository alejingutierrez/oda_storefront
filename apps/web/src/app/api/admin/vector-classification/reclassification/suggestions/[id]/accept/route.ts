import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { acceptSuggestion } from "@/lib/vector-classification/reclassification";

export const runtime = "nodejs";

const resolveAdminUserId = (admin: unknown): string | null => {
  if (!admin || typeof admin !== "object") return null;
  if (!("id" in admin)) return null;
  const id = (admin as { id?: unknown }).id;
  return typeof id === "string" && id ? id : null;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const body = (await req.json().catch(() => null)) as {
      addToGroundTruth?: boolean;
      note?: string;
    } | null;

    const userId = resolveAdminUserId(admin);

    await acceptSuggestion(
      id,
      userId ?? "unknown",
      body?.addToGroundTruth ?? false,
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "[vector-classification/reclassification/suggestions/[id]/accept] POST error:",
      error,
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
