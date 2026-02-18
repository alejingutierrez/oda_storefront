import "server-only";

import { prisma } from "@/lib/prisma";
import { enqueuePlpSeoItems } from "@/lib/plp-seo/queue";
import { generatePlpSeoCopy } from "@/lib/plp-seo/generator";
import { listPendingItems, markItemsQueued } from "@/lib/plp-seo/run-store";

const MAX_ATTEMPTS = Math.max(1, Number(process.env.PLP_SEO_MAX_ATTEMPTS ?? 3));

export type ProcessPlpSeoItemResult = {
  status: string;
  error?: string;
  path?: string;
};

export type ProcessPlpSeoItemOptions = {
  allowQueueRefill?: boolean;
  enqueueLimit?: number;
  stuckMs?: number;
};

export const finalizeRunIfDone = async (runId: string) => {
  const remaining = await prisma.plpSeoItem.count({
    where: {
      runId,
      status: { in: ["pending", "queued", "in_progress", "failed"] },
      attempts: { lt: MAX_ATTEMPTS },
    },
  });

  if (remaining > 0) return null;

  const terminalFailed = await prisma.plpSeoItem.count({
    where: {
      runId,
      status: "failed",
      attempts: { gte: MAX_ATTEMPTS },
    },
  });

  const now = new Date();
  if (terminalFailed > 0) {
    await prisma.plpSeoRun.update({
      where: { id: runId },
      data: {
        status: "blocked",
        lastError: `max_attempts:${terminalFailed}`,
        finishedAt: now,
        updatedAt: now,
      },
    });
    return { status: "blocked", terminalFailed };
  }

  await prisma.plpSeoRun.update({
    where: { id: runId },
    data: { status: "completed", finishedAt: now, updatedAt: now },
  });
  return { status: "completed", terminalFailed: 0 };
};

function truncateError(err: unknown, max = 800) {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "unknown_error";
  const cleaned = String(message || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "unknown_error";
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, Math.max(0, max - 1)).trim()}…`;
}

export const processPlpSeoItemById = async (
  itemId: string,
  options: ProcessPlpSeoItemOptions = {},
): Promise<ProcessPlpSeoItemResult> => {
  const item = await prisma.plpSeoItem.findUnique({
    where: { id: itemId },
    include: { run: true },
  });

  if (!item) return { status: "not_found" };
  const run = item.run;
  const now = new Date();

  if (!run || run.status !== "processing") {
    if (item.status === "queued" || item.status === "in_progress") {
      await prisma.plpSeoItem.update({
        where: { id: item.id },
        data: { status: "pending", updatedAt: now },
      });
    }
    return { status: "skipped", error: run?.status ?? "missing_run" };
  }

  if (item.status === "completed") return { status: "already_completed", path: item.path };
  if (item.attempts >= MAX_ATTEMPTS) return { status: "max_attempts", path: item.path };

  const stuckMs = Math.max(
    0,
    Number(options.stuckMs ?? process.env.PLP_SEO_ITEM_STUCK_MINUTES ?? 30) * 60 * 1000,
  );

  if (item.status === "in_progress" && item.startedAt && stuckMs > 0) {
    const age = Date.now() - item.startedAt.getTime();
    if (age < stuckMs) return { status: "in_progress", path: item.path };
  }

  const claimed = await prisma.plpSeoItem.updateMany({
    where: {
      id: item.id,
      status: { in: ["pending", "failed", "queued", "in_progress"] },
      attempts: { lt: MAX_ATTEMPTS },
    },
    data: {
      status: "in_progress",
      attempts: { increment: 1 },
      lastError: null,
      startedAt: now,
      updatedAt: now,
    },
  });

  if (!claimed.count) return { status: "skipped", error: "already_claimed", path: item.path };

  const enqueueLimit = Math.max(
    1,
    Number(options.enqueueLimit ?? process.env.PLP_SEO_QUEUE_ENQUEUE_LIMIT ?? 50),
  );

  try {
    const generated = await generatePlpSeoCopy({
      genderSlug: item.genderSlug,
      categoryKey: item.categoryKey,
      subcategoryKey: item.subcategoryKey,
    });

    await prisma.$transaction(async (tx) => {
      await tx.plpSeoPage.upsert({
        where: { path: generated.path },
        create: {
          path: generated.path,
          genderSlug: generated.genderSlug,
          categoryKey: generated.categoryKey,
          subcategoryKey: generated.subcategoryKey,
          metaTitle: generated.metaTitle,
          metaDescription: generated.metaDescription,
          subtitle: generated.subtitle,
          provider: generated.provider,
          model: generated.model,
          promptVersion: generated.promptVersion,
          schemaVersion: generated.schemaVersion,
          inputHash: generated.inputHash,
          metadata: generated.metadata,
        },
        update: {
          genderSlug: generated.genderSlug,
          categoryKey: generated.categoryKey,
          subcategoryKey: generated.subcategoryKey,
          metaTitle: generated.metaTitle,
          metaDescription: generated.metaDescription,
          subtitle: generated.subtitle,
          provider: generated.provider,
          model: generated.model,
          promptVersion: generated.promptVersion,
          schemaVersion: generated.schemaVersion,
          inputHash: generated.inputHash,
          metadata: generated.metadata,
          updatedAt: new Date(),
        },
      });

      await tx.plpSeoItem.update({
        where: { id: item.id },
        data: {
          status: "completed",
          lastError: null,
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      await tx.plpSeoRun.update({
        where: { id: run.id },
        data: { lastError: null, updatedAt: new Date() },
      });
    });

    const finalized = await finalizeRunIfDone(run.id);
    if (!finalized && options.allowQueueRefill) {
      const pending = await listPendingItems(run.id, enqueueLimit);
      await markItemsQueued(pending.map((candidate) => candidate.id));
      await enqueuePlpSeoItems(pending);
    }

    return { status: "completed", path: generated.path };
  } catch (err) {
    const message = truncateError(err);
    await prisma.$transaction(async (tx) => {
      await tx.plpSeoItem.update({
        where: { id: item.id },
        data: {
          status: "failed",
          lastError: message,
          updatedAt: new Date(),
        },
      });
      await tx.plpSeoRun.update({
        where: { id: run.id },
        data: { lastError: message, updatedAt: new Date() },
      });
    });

    const finalized = await finalizeRunIfDone(run.id);
    if (!finalized && options.allowQueueRefill) {
      const pending = await listPendingItems(run.id, enqueueLimit);
      await markItemsQueued(pending.map((candidate) => candidate.id));
      await enqueuePlpSeoItems(pending);
    }

    return { status: "failed", error: message, path: item.path };
  }
};
