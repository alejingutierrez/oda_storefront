import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { getEmbeddingStats } from "@/lib/vector-classification/embeddings";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const stats = await getEmbeddingStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error("[vector-classification/embeddings] GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
