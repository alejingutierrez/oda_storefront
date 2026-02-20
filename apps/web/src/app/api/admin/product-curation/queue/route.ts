import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  CURATION_MAX_PRODUCT_IDS,
  CurationValidationError,
  coerceRawChanges,
  normalizeCurationChanges,
  normalizeProductIds,
} from "@/lib/product-curation/apply-engine";
import type { ParsedCurationChange } from "@/lib/product-curation/apply-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_NOTE_LENGTH = 2000;
const MAX_SOURCE_LENGTH = 120;
const MAX_TARGET_SCOPE_LENGTH = 64;

const parsePositiveInt = (value: string | null, fallback: number, max: number) => {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(max, Math.floor(parsed));
};

const toText = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLength);
};

const toInputJson = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
};

const toStoredChange = (change: ParsedCurationChange) => {
  if (change.kind === "scalar") {
    return {
      field: change.field,
      op: change.op,
      value: change.op === "clear" ? null : change.scalarValue,
    };
  }
  if (change.kind === "array") {
    return {
      field: change.field,
      op: change.op,
      value: change.op === "clear" ? null : change.tagValues,
    };
  }
  return {
    field: change.field,
    op: change.op,
    value:
      change.op === "clear"
        ? null
        : {
            kind: change.badgeKind,
            startPriority: change.startPriority,
          },
  };
};

const readIdsJson = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[];
  return value.filter((item): item is string => typeof item === "string");
};

type QueueStatusFilter = "all" | "pending" | "applying" | "applied" | "failed" | "cancelled";

const parseStatus = (raw: string | null): QueueStatusFilter => {
  if (!raw) return "all";
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === "all" ||
    normalized === "pending" ||
    normalized === "applying" ||
    normalized === "applied" ||
    normalized === "failed" ||
    normalized === "cancelled"
  ) {
    return normalized;
  }
  return "all";
};

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const status = parseStatus(url.searchParams.get("status"));
  const limit = parsePositiveInt(url.searchParams.get("limit"), 120, 500);

  const where: Prisma.ProductCurationQueueItemWhereInput = status === "all" ? {} : { status };

  const [items, grouped] = await Promise.all([
    prisma.productCurationQueueItem.findMany({
      where,
      orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
      take: limit,
      select: {
        id: true,
        status: true,
        orderIndex: true,
        note: true,
        source: true,
        targetScope: true,
        targetIdsJson: true,
        targetCount: true,
        searchKeySnapshot: true,
        changesJson: true,
        createdByUserId: true,
        createdByEmail: true,
        applyReportJson: true,
        lastError: true,
        runId: true,
        createdAt: true,
        updatedAt: true,
        appliedAt: true,
        appliedByUserId: true,
      },
    }),
    prisma.productCurationQueueItem.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);

  const summary = {
    pending: 0,
    applying: 0,
    applied: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const entry of grouped) {
    if (entry.status in summary) {
      summary[entry.status as keyof typeof summary] = entry._count._all;
    }
  }

  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      targetIds: readIdsJson(item.targetIdsJson),
    })),
    summary,
    limit,
  });
}

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

    const productIds = normalizeProductIds(payload.productIds);
    if (!productIds.length) {
      return NextResponse.json({ error: "missing_product_ids" }, { status: 400 });
    }
    if (productIds.length > CURATION_MAX_PRODUCT_IDS) {
      return NextResponse.json({ error: "too_many_product_ids", limit: CURATION_MAX_PRODUCT_IDS }, { status: 400 });
    }

    const rawChanges = coerceRawChanges(payload);
    const parsedChanges = await normalizeCurationChanges(rawChanges);

    const note = toText(payload.note, MAX_NOTE_LENGTH);
    const source = toText(payload.source, MAX_SOURCE_LENGTH) ?? "manual";
    const searchKeySnapshot = toText(payload.searchKeySnapshot, 4000);
    const targetScope = toText(payload.targetScope, MAX_TARGET_SCOPE_LENGTH) ?? "snapshot";

    const actorUserId = typeof (admin as { id?: unknown }).id === "string" ? (admin as { id: string }).id : null;
    const actorEmail = typeof (admin as { email?: unknown }).email === "string" ? (admin as { email: string }).email : null;

    const lastItem = await prisma.productCurationQueueItem.findFirst({
      orderBy: [{ orderIndex: "desc" }, { createdAt: "desc" }],
      select: { orderIndex: true },
    });

    const created = await prisma.productCurationQueueItem.create({
      data: {
        status: "pending",
        orderIndex: (lastItem?.orderIndex ?? -1) + 1,
        note,
        source,
        targetScope,
        targetIdsJson: toInputJson(productIds),
        targetCount: productIds.length,
        searchKeySnapshot,
        changesJson: toInputJson(parsedChanges.map(toStoredChange)),
        createdByUserId: actorUserId,
        createdByEmail: actorEmail,
      },
      select: {
        id: true,
        status: true,
        orderIndex: true,
        note: true,
        source: true,
        targetScope: true,
        targetIdsJson: true,
        targetCount: true,
        searchKeySnapshot: true,
        changesJson: true,
        createdByUserId: true,
        createdByEmail: true,
        applyReportJson: true,
        lastError: true,
        runId: true,
        createdAt: true,
        updatedAt: true,
        appliedAt: true,
        appliedByUserId: true,
      },
    });

    return NextResponse.json({
      ok: true,
      item: {
        ...created,
        targetIds: readIdsJson(created.targetIdsJson),
      },
    });
  } catch (error) {
    if (error instanceof CurationValidationError) {
      return NextResponse.json(
        {
          error: error.code,
          ...(error.details ? { details: error.details } : {}),
        },
        { status: error.status },
      );
    }
    console.error("product-curation.queue.create.failed", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
