import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "admin_session";
const SESSION_TTL_DAYS = 7;

export const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const generateToken = () => crypto.randomBytes(32).toString("hex");

export async function ensureAdminUser() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error("Missing ADMIN_EMAIL/ADMIN_PASSWORD in environment");
  }

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  if (!existing) {
    return prisma.user.create({
      data: {
        email: adminEmail,
        role: "admin",
        plan: "free",
        passwordHash,
      },
    });
  }

  if (!existing.passwordHash || !(await bcrypt.compare(adminPassword, existing.passwordHash))) {
    return prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash },
    });
  }

  return existing;
}

export async function createAdminSession(email: string) {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const sessionTokenCreatedAt = new Date();

  await prisma.user.update({
    where: { email },
    data: {
      sessionTokenHash: tokenHash,
      sessionTokenCreatedAt,
      lastLoginAt: sessionTokenCreatedAt,
    },
  });

  return token;
}

export async function setAdminCookie(token: string) {
  const maxAge = 60 * 60 * 24 * SESSION_TTL_DAYS;
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export async function validateAdminRequest(req?: Request) {
  const headerToken = req
    ? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim()
    : (await headers()).get("authorization")?.replace(/^Bearer\s+/i, "").trim();

  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(COOKIE_NAME)?.value;
  const token = headerToken || cookieToken;

  if (!token) return null;

  if (process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN) {
    return { role: "admin", email: "env-admin" };
  }

  const tokenHash = hashToken(token);
  const user = await prisma.user.findFirst({
    where: {
      role: "admin",
      sessionTokenHash: tokenHash,
    },
    select: { id: true, email: true, role: true, sessionTokenCreatedAt: true },
  });

  if (!user) return null;

  // Enforce server-side session TTL
  if (user.sessionTokenCreatedAt) {
    const ttlMs = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(user.sessionTokenCreatedAt.getTime() + ttlMs);
    if (new Date() > expiresAt) {
      await prisma.user.update({
        where: { id: user.id },
        data: { sessionTokenHash: null, sessionTokenCreatedAt: null },
      });
      try {
        const cs = await cookies();
        cs.delete(COOKIE_NAME);
      } catch {
        /* headers may already be sent */
      }
      return null;
    }
  }

  return user;
}

/* ------------------------------------------------------------------ */
/*  Cron / Admin authentication (for scheduled & admin API routes)    */
/* ------------------------------------------------------------------ */

export type CronOrAdminResult = {
  source: "cron-secret" | "admin-token" | "admin-session";
  email?: string;
  role?: string;
};

/**
 * Validates a request as either a Vercel cron invocation (via CRON_SECRET)
 * or an admin user (via ADMIN_TOKEN or session cookie).
 *
 * Use this instead of trusting x-vercel-cron or user-agent headers.
 */
export async function validateCronOrAdmin(
  req: Request,
): Promise<CronOrAdminResult | null> {
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.replace(/^Bearer\s+/i, "").trim() || null;

  // 1. CRON_SECRET (set in Vercel dashboard, sent automatically by Vercel cron)
  if (
    bearerToken &&
    process.env.CRON_SECRET &&
    bearerToken === process.env.CRON_SECRET
  ) {
    return { source: "cron-secret" };
  }

  // 2. ADMIN_TOKEN (static env token used by workers / scripts)
  if (
    bearerToken &&
    process.env.ADMIN_TOKEN &&
    bearerToken === process.env.ADMIN_TOKEN
  ) {
    return { source: "admin-token", email: "env-admin" };
  }

  // 3. Session-based admin auth (cookie or bearer matching a DB session)
  const admin = await validateAdminRequest(req);
  if (admin) {
    return {
      source: "admin-session",
      email: (admin as { email?: string }).email,
      role: (admin as { role?: string }).role,
    };
  }

  return null;
}

export async function verifyAdminPassword(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) return false;
  return bcrypt.compare(password, user.passwordHash);
}
