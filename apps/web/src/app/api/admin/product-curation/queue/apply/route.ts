import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { invalidateCatalogCache } from "@/lib/catalog-cache";
import { prisma } from "@/lib/prisma";
import {
  CURATION_MAX_PRODUCT_IDS,
  CurationValidationError,
  applyCurationChanges,
  normalizeCurationChanges,
  normalizeProductIds,
} from "@/lib/product-curation/apply-engine";

export const runtime = "nodejs";
export const maxDuration = 300;

const toInputJson = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
};

const readArray = (value: unknown) => {
  if (!Array.isArray(value)) return [] as unknown[];
  return value;
};

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const actorUserId = typeof (admin as { id?: unknown }).id === "string" ? (admin as { id: string }).id : null;
  const actorEmail = typeof (admin as { email?: unknown }).email === "string" ? (admin as { email: string }).email : null;
  let runId: string | null = null;

  try {
    const body = await req.json().catch(() => null);
    const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const requestedIds = normalizeProductIds(payload.itemIds);

    const where: Prisma.ProductCurationQueueItemWhereInput = {
      status: "pending",
      ...(requestedIds.length ? { id: { in: requestedIds } } : {}),
    };

    const items = await prisma.productCurationQueueItem.findMany({
      where,
      orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        status: true,
        orderIndex: true,
        note: true,
        source: true,
        targetIdsJson: true,
        targetCount: true,
        changesJson: true,
      },
    });

    if (!items.length) {
      return NextResponse.json({
        ok: true,
        applied: 0,
        failed: 0,
        skipped: 0,
        message: "No hay operaciones pendientes para aplicar.",
      });
    }

    const run = await prisma.productCurationApplyRun.create({
      data: {
        requestedItemIdsJson: requestedIds.length ? toInputJson(requestedIds) : undefined,
        requestedByUserId: actorUserId,
        requestedByEmail: actorEmail,
        status: "processing",
      },
      select: { id: true, status: true, createdAt: true },
    });
    runId = run.id;

    const itemResults: Array<Record<string, unknown>> = [];
    let applied = 0;
    let failed = 0;
    const skipped = 0;
    let cacheDirty = false;

    for (const item of items) {
      await prisma.productCurationQueueItem.update({
        where: { id: item.id },
        data: {
          status: "applying",
          runId: run.id,
          lastError: null,
        },
      });

      try {
        const productIds = normalizeProductIds(readArray(item.targetIdsJson));
        if (!productIds.length) {
          failed += 1;
          await prisma.productCurationQueueItem.update({
            where: { id: item.id },
            data: {
              status: "failed",
              runId: run.id,
              lastError: "missing_product_ids",
              applyReportJson: toInputJson({ error: "missing_product_ids" }),
            },
          });
          itemResults.push({ id: item.id, status: "failed", error: "missing_product_ids" });
          continue;
        }
        if (productIds.length > CURATION_MAX_PRODUCT_IDS) {
          failed += 1;
          await prisma.productCurationQueueItem.update({
            where: { id: item.id },
            data: {
              status: "failed",
              runId: run.id,
              lastError: "too_many_product_ids",
              applyReportJson: toInputJson({ error: "too_many_product_ids", limit: CURATION_MAX_PRODUCT_IDS }),
            },
          });
          itemResults.push({ id: item.id, status: "failed", error: "too_many_product_ids" });
          continue;
        }

        const rawChanges = readArray(item.changesJson);
        const parsedChanges = await normalizeCurationChanges(rawChanges);

        const result = await applyCurationChanges({
          productIds,
          changes: parsedChanges,
          actorEmail,
          actorUserId,
          source: item.source ?? "queue_apply",
          note: item.note,
        });

        if (result.globalUpdatedCount > 0) {
          cacheDirty = true;
        }

        applied += 1;

        await prisma.productCurationQueueItem.update({
          where: { id: item.id },
          data: {
            status: "applied",
            appliedAt: new Date(),
            appliedByUserId: actorUserId,
            runId: run.id,
            lastError: null,
            applyReportJson: toInputJson(result),
          },
        });

        itemResults.push({
          id: item.id,
          status: "applied",
          updatedCount: result.updatedCount,
          missingCount: result.missingCount,
          unchangedCount: result.unchangedCount,
        });
      } catch (error) {
        failed += 1;
        const code = error instanceof CurationValidationError ? error.code : "internal_error";
        const details = error instanceof CurationValidationError ? error.details : undefined;

        await prisma.productCurationQueueItem.update({
          where: { id: item.id },
          data: {
            status: "failed",
            runId: run.id,
            lastError: code,
            applyReportJson: toInputJson({
              error: code,
              ...(details ? { details } : {}),
            }),
          },
        });

        itemResults.push({
          id: item.id,
          status: "failed",
          error: code,
          ...(details ? { details } : {}),
        });
      }
    }

    const runStatus = failed > 0 ? "completed_with_errors" : "completed";
    const summary = {
      total: items.length,
      applied,
      failed,
      skipped,
      requestedIds,
      itemResults,
    };

    const updatedRun = await prisma.productCurationApplyRun.update({
      where: { id: run.id },
      data: {
        status: runStatus,
        summaryJson: toInputJson(summary),
        finishedAt: new Date(),
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        finishedAt: true,
        summaryJson: true,
      },
    });

    if (cacheDirty) {
      invalidateCatalogCache();
    }

    return NextResponse.json({
      ok: true,
      run: updatedRun,
      summary,
    });
  } catch (error) {
    if (runId) {
      try {
        await prisma.productCurationApplyRun.update({
          where: { id: runId },
          data: {
            status: "failed",
            summaryJson: toInputJson({ error: "internal_error" }),
            finishedAt: new Date(),
          },
        });
      } catch (runUpdateError) {
        console.error("product-curation.queue.apply.run-update.failed", runUpdateError);
      }
    }
    console.error("product-curation.queue.apply.failed", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
