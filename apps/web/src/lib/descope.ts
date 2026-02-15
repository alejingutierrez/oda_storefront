import { createSdk, session } from "@descope/nextjs-sdk/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrCreateExperienceSubject } from "@/lib/experience";
import crypto from "node:crypto";

const getDescopeConfig = () => {
  const projectId = process.env.NEXT_PUBLIC_DESCOPE_PROJECT_ID;
  if (!projectId) {
    throw new Error("Missing NEXT_PUBLIC_DESCOPE_PROJECT_ID");
  }
  return {
    projectId,
    baseUrl: process.env.NEXT_PUBLIC_DESCOPE_BASE_URL,
  };
};

const extractBearerToken = (value: string | null) => {
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
};

const getCookieValue = (cookieHeader: string | null, cookieName: string) => {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${cookieName}=([^;]*)`),
  );
  const raw = match?.[1]?.trim();
  return raw && raw.length > 0 ? raw : null;
};

const parseDescopeSessionHeader = (headerValue: string | null) => {
  if (!headerValue) return null;
  try {
    const raw = Buffer.from(headerValue, "base64").toString("utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.jwt !== "string") return null;
    if (!parsed.token || typeof parsed.token !== "object") return null;
    return parsed as { jwt: string; token: Record<string, unknown> };
  } catch {
    return null;
  }
};

let validationSdk: ReturnType<typeof createSdk> | null = null;
const getValidationSdk = () => {
  if (validationSdk) return validationSdk;
  const { projectId, baseUrl } = getDescopeConfig();
  validationSdk = createSdk({ projectId, baseUrl });
  return validationSdk;
};

const getManagementKey = () => {
  const key = process.env.DESCOPE_MANAGEMENT_KEY;
  if (!key) {
    throw new Error("Missing DESCOPE_MANAGEMENT_KEY");
  }
  return key;
};

type DescopeUser = {
  userId: string;
  email?: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
  verifiedEmail?: boolean;
  OAuth?: Record<string, boolean>;
  loginIds?: string[];
  status?: string;
};

export async function getDescopeSession() {
  const { projectId, baseUrl } = getDescopeConfig();
  return session({ projectId, baseUrl });
}

async function getDescopeSessionFromRequest(req?: Request) {
  if (!req) {
    return getDescopeSession();
  }

  // 1) If middleware already injected the session, trust it.
  const headerSession = parseDescopeSessionHeader(
    req.headers.get("x-descope-session"),
  );
  if (headerSession) {
    return headerSession as unknown as Awaited<ReturnType<typeof getDescopeSession>>;
  }

  // 2) Otherwise, validate the Bearer token directly.
  const bearer = extractBearerToken(req.headers.get("authorization"));
  if (bearer) {
    try {
      return await getValidationSdk().validateSession(bearer);
    } catch {
      return undefined;
    }
  }

  // 3) Fallback: validate DS cookie if present.
  const dsCookie = getCookieValue(req.headers.get("cookie"), "DS");
  if (dsCookie) {
    try {
      return await getValidationSdk().validateSession(dsCookie);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function getDescopeManagementSdk() {
  const { projectId, baseUrl } = getDescopeConfig();
  const managementKey = getManagementKey();
  return createSdk({ projectId, baseUrl, managementKey });
}

const normalizeName = (user: DescopeUser) => {
  if (user.name) return user.name;
  const parts = [user.givenName, user.familyName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : undefined;
};

const normalizeEmail = (user: DescopeUser, fallbackId: string, tokenEmail?: string) => {
  return (
    user.email ||
    tokenEmail ||
    user.loginIds?.find((login) => login.includes("@")) ||
    `${fallbackId}@descope.local`
  );
};

const getTokenField = (token: Record<string, unknown>, key: string) => {
  const value = token[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const getTokenArray = (token: Record<string, unknown>, key: string) => {
  const value = token[key];
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : undefined;
};

export async function loadDescopeUser(userId: string) {
  let sdk;
  try {
    sdk = getDescopeManagementSdk();
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Descope management key missing, skipping user load", error);
    }
    return null;
  }
  const response = await sdk.management.user.loadByUserId(userId);
  if (!response.ok || !response.data) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Descope management user load failed", response.error);
    }
    return null;
  }
  return response.data as DescopeUser;
}

export async function syncUserFromDescope(
  fallbackUser?: Partial<DescopeUser> | null,
  req?: Request,
) {
  const authInfo = await getDescopeSessionFromRequest(req);
  if (!authInfo || !authInfo.token || typeof authInfo.token !== "object") {
    return null;
  }

  const token = authInfo.token as Record<string, unknown>;
  const descopeUserId = typeof token.sub === "string" ? token.sub : undefined;
  if (!descopeUserId) return null;

  const issuedAt =
    typeof token.iat === "number" ? new Date(token.iat * 1000) : new Date();
  const authRecord = authInfo as unknown as Record<string, unknown>;
  const sessionJwt =
    typeof authRecord.jwt === "string"
      ? authRecord.jwt
      : typeof authRecord.sessionJwt === "string"
        ? authRecord.sessionJwt
        : undefined;
  const sessionTokenHash = sessionJwt
    ? crypto.createHash("sha256").update(sessionJwt).digest("hex")
    : undefined;

  const tokenUser: DescopeUser = {
    userId: descopeUserId,
    email: getTokenField(token, "email"),
    name:
      getTokenField(token, "name") ??
      getTokenField(token, "display_name") ??
      getTokenField(token, "full_name"),
    givenName:
      getTokenField(token, "given_name") ?? getTokenField(token, "first_name"),
    familyName:
      getTokenField(token, "family_name") ?? getTokenField(token, "last_name"),
    picture: getTokenField(token, "picture"),
    loginIds: getTokenArray(token, "login_ids"),
    verifiedEmail: token.email_verified === true,
  };

  const descopeUser = await loadDescopeUser(descopeUserId);

  const mergedUser: DescopeUser = {
    ...tokenUser,
    ...(fallbackUser ?? {}),
    ...(descopeUser ?? {}),
  };
  const subject = await getOrCreateExperienceSubject();

  const email = normalizeEmail(
    mergedUser,
    descopeUserId,
    typeof token.email === "string" ? token.email : undefined,
  );
  const displayName =
    normalizeName(mergedUser) ??
    (email ? email.split("@")[0] : undefined);

  let user;
  try {
    user = await prisma.user.upsert({
      where: { descopeUserId },
      create: {
        email,
        descopeUserId,
        role: "user",
        plan: "free",
        displayName,
        fullName: displayName,
        avatarUrl: mergedUser.picture,
        status: mergedUser.status ?? "active",
        emailVerifiedAt: mergedUser.verifiedEmail ? new Date() : null,
        lastLoginAt: new Date(),
        sessionTokenCreatedAt: issuedAt,
        sessionTokenHash,
        lastSeenAt: new Date(),
        experienceSubjectId: subject.id,
      },
      update: {
        email,
        displayName: displayName ?? undefined,
        fullName: displayName ?? undefined,
        avatarUrl: mergedUser.picture ?? undefined,
        status: mergedUser.status ?? "active",
        emailVerifiedAt: mergedUser.verifiedEmail ? new Date() : null,
        lastLoginAt: new Date(),
        sessionTokenCreatedAt: issuedAt,
        sessionTokenHash: sessionTokenHash ?? undefined,
        lastSeenAt: new Date(),
        experienceSubjectId: subject.id,
        deletedAt: null,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      user = await prisma.user.update({
        where: { email },
        data: {
          descopeUserId,
          displayName: displayName ?? undefined,
          fullName: displayName ?? undefined,
          avatarUrl: mergedUser.picture ?? undefined,
          status: mergedUser.status ?? "active",
          emailVerifiedAt: mergedUser.verifiedEmail ? new Date() : null,
          lastLoginAt: new Date(),
          sessionTokenCreatedAt: issuedAt,
          sessionTokenHash: sessionTokenHash ?? undefined,
          lastSeenAt: new Date(),
          experienceSubjectId: subject.id,
          deletedAt: null,
        },
      });
    } else {
      throw error;
    }
  }

  const oauthProviders = Object.entries(mergedUser.OAuth ?? {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([provider]) => provider.toLowerCase());

  const fallbackProviders =
    typeof (fallbackUser as { providers?: unknown })?.providers !== "undefined" &&
    Array.isArray((fallbackUser as { providers?: unknown }).providers)
      ? (fallbackUser as { providers: string[] }).providers
      : [];

  const uniqueProviders = Array.from(
    new Set([...oauthProviders, ...fallbackProviders.map((p) => p.toLowerCase())]),
  ).filter(Boolean);

  if (uniqueProviders.length > 0) {
    await Promise.all(
      uniqueProviders.map((provider) =>
        prisma.userIdentity.upsert({
          where: {
            provider_providerUserId: {
              provider,
              providerUserId: descopeUserId,
            },
          },
          create: {
            userId: user.id,
            provider,
            providerUserId: descopeUserId,
            email,
            isPrimary: false,
          },
          update: {
            userId: user.id,
            email,
          },
        }),
      ),
    );
  }

  return { user, descopeUser: mergedUser, authInfo, subject };
}

export async function requireUser(req?: Request) {
  const authInfo = await getDescopeSessionFromRequest(req);
  if (!authInfo || !authInfo.token || typeof authInfo.token !== "object") {
    return null;
  }

  const token = authInfo.token as Record<string, unknown>;
  const descopeUserId = typeof token.sub === "string" ? token.sub : undefined;
  if (!descopeUserId) return null;

  const user = await prisma.user.findUnique({ where: { descopeUserId } });
  if (user) {
    const subject = await getOrCreateExperienceSubject();
    const issuedAt =
      typeof token.iat === "number" ? new Date(token.iat * 1000) : new Date();
    const authRecord = authInfo as unknown as Record<string, unknown>;
    const sessionJwt =
      typeof authRecord.jwt === "string"
        ? authRecord.jwt
        : typeof authRecord.sessionJwt === "string"
          ? authRecord.sessionJwt
          : undefined;
    const sessionTokenHash = sessionJwt
      ? crypto.createHash("sha256").update(sessionJwt).digest("hex")
      : undefined;
    const shouldUpdateLogin =
      sessionTokenHash && sessionTokenHash !== user.sessionTokenHash;

    const updateData: Prisma.UserUncheckedUpdateInput = {
      lastSeenAt: new Date(),
      experienceSubjectId:
        user.experienceSubjectId && user.experienceSubjectId === subject.id
          ? user.experienceSubjectId
          : subject.id,
    };
    if (shouldUpdateLogin) {
      updateData.sessionTokenHash = sessionTokenHash;
      updateData.sessionTokenCreatedAt = issuedAt;
      updateData.lastLoginAt = new Date();
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });
    return { user, authInfo };
  }

  const synced = await syncUserFromDescope(undefined, req);
  if (!synced) return null;
  return { user: synced.user, authInfo: synced.authInfo };
}
