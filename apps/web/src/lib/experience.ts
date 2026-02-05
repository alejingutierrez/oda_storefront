import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const SUBJECT_COOKIE = "oda_anon_id";
const SUBJECT_TTL_DAYS = 365;

const buildCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SUBJECT_TTL_DAYS * 24 * 60 * 60,
});

export async function getOrCreateExperienceSubject() {
  const cookieStore = await cookies();
  const existingAnonId = cookieStore.get(SUBJECT_COOKIE)?.value;

  if (existingAnonId) {
    const existing = await prisma.experienceSubject.findUnique({
      where: { anonId: existingAnonId },
    });
    if (existing) {
      await prisma.experienceSubject.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
      });
      return existing;
    }
  }

  const anonId = crypto.randomUUID();
  const created = await prisma.experienceSubject.create({
    data: { anonId, lastSeenAt: new Date() },
  });
  cookieStore.set(SUBJECT_COOKIE, anonId, buildCookieOptions());
  return created;
}

export async function ensureExperienceSubjectCookie(subjectAnonId: string) {
  const cookieStore = await cookies();
  const current = cookieStore.get(SUBJECT_COOKIE)?.value;
  if (!current || current !== subjectAnonId) {
    cookieStore.set(SUBJECT_COOKIE, subjectAnonId, buildCookieOptions());
  }
}

export async function getRequestMeta() {
  const headerStore = await headers();
  return {
    userAgent: headerStore.get("user-agent") ?? undefined,
    referrer: headerStore.get("referer") ?? undefined,
  };
}

const normalizeJson = (value: unknown) =>
  value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);

type ExperienceEventInput = {
  type: string;
  userId?: string | null;
  subjectId?: string;
  brandId?: string;
  productId?: string;
  variantId?: string;
  listId?: string;
  sessionId?: string;
  path?: string;
  referrer?: string;
  utm?: Record<string, unknown>;
  properties?: Record<string, unknown>;
};

export async function logExperienceEvent(input: ExperienceEventInput) {
  const subjectId = input.subjectId ?? (await getOrCreateExperienceSubject()).id;
  const meta = await getRequestMeta();

  return prisma.experienceEvent.create({
    data: {
      subjectId,
      userId: input.userId ?? null,
      type: input.type,
      path: input.path ?? undefined,
      referrer: input.referrer ?? meta.referrer,
      brandId: input.brandId ?? undefined,
      productId: input.productId ?? undefined,
      variantId: input.variantId ?? undefined,
      listId: input.listId ?? undefined,
      sessionId: input.sessionId ?? undefined,
      utm: normalizeJson(input.utm),
      properties: normalizeJson(input.properties),
    },
  });
}
