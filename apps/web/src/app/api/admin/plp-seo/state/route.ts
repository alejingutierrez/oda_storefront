import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensurePlpSeoTables } from "@/lib/plp-seo/store";
import { findLatestRun, getItemCounts, summarizeRun } from "@/lib/plp-seo/run-store";
import { finalizeRunIfDone } from "@/lib/plp-seo/processor";

export const runtime = "nodejs";
export const maxDuration = 60;

const readJsonRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await ensurePlpSeoTables();

    let run = await findLatestRun();
    if (run && run.status === "processing") {
      await finalizeRunIfDone(run.id);
      run = await findLatestRun();
    }

    const summary = run ? await summarizeRun(run.id) : null;
    const itemCounts = run ? await getItemCounts(run.id) : null;
    const recentItems = run
      ? await prisma.plpSeoItem.findMany({
          where: { runId: run.id },
          orderBy: { updatedAt: "desc" },
          take: 50,
          select: {
            id: true,
            path: true,
            status: true,
            attempts: true,
            lastError: true,
            startedAt: true,
            completedAt: true,
            updatedAt: true,
          },
        })
      : [];

    const runMeta = run
      ? (() => {
          const metadata = readJsonRecord(run.metadata);
          const provider = typeof metadata.provider === "string" ? metadata.provider : null;
          const model = typeof metadata.model === "string" ? metadata.model : null;
          const promptVersion =
            typeof metadata.prompt_version === "string" ? metadata.prompt_version : null;
          const schemaVersion =
            typeof metadata.schema_version === "string" ? metadata.schema_version : null;
          const createdBy = typeof metadata.created_by === "string" ? metadata.created_by : null;
          const requestedItems =
            typeof metadata.requested_items === "number"
              ? metadata.requested_items
              : Number(metadata.requested_items ?? 0) || null;
          const selectedItems =
            typeof metadata.selected_items === "number"
              ? metadata.selected_items
              : Number(metadata.selected_items ?? 0) || null;
          return {
            id: run.id,
            status: run.status,
            startedAt: run.startedAt,
            updatedAt: run.updatedAt,
            finishedAt: run.finishedAt,
            lastError: run.lastError ?? null,
            provider,
            model,
            promptVersion,
            schemaVersion,
            createdBy,
            requestedItems,
            selectedItems,
            onlyMissing:
              typeof metadata.only_missing === "boolean"
                ? metadata.only_missing
                : metadata.only_missing === "true",
            filters: metadata.filters ?? null,
          };
        })()
      : null;

    return NextResponse.json({ summary, run: runMeta, itemCounts, recentItems });
  } catch (err) {
    console.error("[plp-seo] /state failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
