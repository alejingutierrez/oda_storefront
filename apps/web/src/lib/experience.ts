import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
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
  const cookieStore = cookies();
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
  const cookieStore = cookies();
  const current = cookieStore.get(SUBJECT_COOKIE)?.value;
  if (!current || current !== subjectAnonId) {
    cookieStore.set(SUBJECT_COOKIE, subjectAnonId, buildCookieOptions());
  }
}

export function getRequestMeta() {
  return {
    userAgent: headers().get("user-agent") ?? undefined,
    referrer: headers().get("referer") ?? undefined,
  };
}
