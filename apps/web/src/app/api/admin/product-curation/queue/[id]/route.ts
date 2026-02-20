import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_NOTE_LENGTH = 2000;

const toText = (value: unknown, maxLength: number) => {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLength);
};

const parseOrderIndex = (value: unknown) => {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
};

const isQueueStatus = (value: unknown): value is "pending" | "cancelled" => {
  return value === "pending" || value === "cancelled";
};

const readIdsJson = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[];
  return value.filter((item): item is string => typeof item === "string");
};

const toInputJson = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
};

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => null);
    const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

    if (payload.action === "duplicate") {
      const source = await prisma.productCurationQueueItem.findUnique({
        where: { id },
      });
      if (!source) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }

      const lastItem = await prisma.productCurationQueueItem.findFirst({
        orderBy: [{ orderIndex: "desc" }, { createdAt: "desc" }],
        select: { orderIndex: true },
      });

      const actorUserId = typeof (admin as { id?: unknown }).id === "string" ? (admin as { id: string }).id : null;
      const actorEmail = typeof (admin as { email?: unknown }).email === "string" ? (admin as { email: string }).email : null;

      const created = await prisma.productCurationQueueItem.create({
        data: {
          status: "pending",
          orderIndex: (lastItem?.orderIndex ?? -1) + 1,
          note: source.note,
          source: source.source ?? "duplicate",
          targetScope: source.targetScope,
          targetIdsJson: toInputJson(source.targetIdsJson ?? []),
          targetCount: source.targetCount,
          searchKeySnapshot: source.searchKeySnapshot,
          changesJson: toInputJson(source.changesJson ?? []),
          createdByUserId: actorUserId,
          createdByEmail: actorEmail,
        },
      });

      return NextResponse.json({
        ok: true,
        duplicated: {
          ...created,
          targetIds: readIdsJson(created.targetIdsJson),
        },
      });
    }

    const note = toText(payload.note, MAX_NOTE_LENGTH);
    const status = payload.status;
    const orderIndex = parseOrderIndex(payload.orderIndex);

    const data: Prisma.ProductCurationQueueItemUpdateInput = {};
    if (note !== undefined) data.note = note;
    if (status !== undefined) {
      if (!isQueueStatus(status)) {
        return NextResponse.json({ error: "invalid_status" }, { status: 400 });
      }
      data.status = status;
    }
    if (orderIndex !== undefined) data.orderIndex = orderIndex;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "missing_update" }, { status: 400 });
    }

    const updated = await prisma.productCurationQueueItem.update({
      where: { id },
      data,
    });

    return NextResponse.json({
      ok: true,
      item: {
        ...updated,
        targetIds: readIdsJson(updated.targetIdsJson),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error("product-curation.queue.patch.failed", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  try {
    await prisma.productCurationQueueItem.delete({ where: { id } });
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error("product-curation.queue.delete.failed", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
