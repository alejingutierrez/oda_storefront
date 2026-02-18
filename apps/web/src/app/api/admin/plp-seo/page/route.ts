import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensurePlpSeoTables, normalizePlpPath, parsePlpPath } from "@/lib/plp-seo/store";

export const runtime = "nodejs";
export const maxDuration = 60;

const emojiRe =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u;

function normalizeLine(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\u0000/g, "")
    .trim();
}

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

function hash(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validateManualCopy(input: { metaTitle: string; metaDescription: string; subtitle: string }) {
  const errors: string[] = [];
  if (!input.metaTitle) errors.push("metaTitle vacio");
  if (!input.metaDescription) errors.push("metaDescription vacio");
  if (!input.subtitle) errors.push("subtitle vacio");
  if (input.metaTitle.length > 70) errors.push("metaTitle > 70 chars");
  if (input.metaDescription.length < 120 || input.metaDescription.length > 160) {
    errors.push("metaDescription fuera de 120-160 chars");
  }
  if (input.subtitle.length < 90 || input.subtitle.length > 150) {
    errors.push("subtitle fuera de 90-150 chars");
  }
  if (emojiRe.test(input.metaTitle)) errors.push("metaTitle contiene emojis");
  if (emojiRe.test(input.metaDescription)) errors.push("metaDescription contiene emojis");
  if (emojiRe.test(input.subtitle)) errors.push("subtitle contiene emojis");
  return errors;
}

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await ensurePlpSeoTables();

  const url = new URL(req.url);
  const rawPath = url.searchParams.get("path");
  const parsed = rawPath ? parsePlpPath(rawPath) : null;
  if (!parsed) {
    return NextResponse.json({ page: null });
  }

  const page = await prisma.plpSeoPage.findUnique({
    where: { path: parsed.path },
    select: {
      path: true,
      genderSlug: true,
      categoryKey: true,
      subcategoryKey: true,
      metaTitle: true,
      metaDescription: true,
      subtitle: true,
      provider: true,
      model: true,
      promptVersion: true,
      schemaVersion: true,
      inputHash: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ page });
}

export async function POST(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await ensurePlpSeoTables();

  const body = await req.json().catch(() => null);
  const rawPath = normalizePlpPath(body?.path);
  const parsed = parsePlpPath(rawPath);
  if (!parsed) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  const metaTitle = normalizeLine(body?.metaTitle);
  const metaDescription = normalizeLine(body?.metaDescription);
  const subtitle = normalizeLine(body?.subtitle);
  const errors = validateManualCopy({ metaTitle, metaDescription, subtitle });
  if (errors.length) {
    return NextResponse.json({ error: "invalid_copy", details: errors }, { status: 400 });
  }

  const existing = await prisma.plpSeoPage.findUnique({
    where: { path: parsed.path },
    select: { inputHash: true, provider: true, model: true, promptVersion: true, schemaVersion: true, metadata: true },
  });

  const now = new Date();
  const existingMeta = asRecord(existing?.metadata);
  const nextMeta = JSON.parse(
    JSON.stringify({
      ...existingMeta,
      manual_override: true,
      manual_override_at: now.toISOString(),
      manual_override_by: (admin as { email?: string | null }).email ?? "admin",
      manual_override_hash: hash({ metaTitle, metaDescription, subtitle }),
    }),
  );

  const page = await prisma.plpSeoPage.upsert({
    where: { path: parsed.path },
    create: {
      path: parsed.path,
      genderSlug: parsed.genderSlug,
      categoryKey: parsed.categoryKey,
      subcategoryKey: parsed.subcategoryKey,
      metaTitle,
      metaDescription,
      subtitle,
      provider: existing?.provider ?? "manual",
      model: existing?.model ?? "manual",
      promptVersion: existing?.promptVersion ?? "manual",
      schemaVersion: existing?.schemaVersion ?? "manual",
      inputHash: existing?.inputHash ?? `manual:${hash({ path: parsed.path })}`,
      metadata: nextMeta,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      metaTitle,
      metaDescription,
      subtitle,
      metadata: nextMeta,
      updatedAt: now,
    },
    select: {
      path: true,
      genderSlug: true,
      categoryKey: true,
      subcategoryKey: true,
      metaTitle: true,
      metaDescription: true,
      subtitle: true,
      provider: true,
      model: true,
      promptVersion: true,
      schemaVersion: true,
      inputHash: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ ok: true, page });
}

