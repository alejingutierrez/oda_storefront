import { createSdk, session } from "@descope/nextjs-sdk/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateExperienceSubject } from "@/lib/experience";

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

export async function loadDescopeUser(userId: string) {
  const sdk = getDescopeManagementSdk();
  const response = await sdk.management.user.loadByUserId(userId);
  if (!response.ok || !response.data) {
    const message = response.error?.errorMessage || "Unable to load Descope user";
    throw new Error(message);
  }
  return response.data as DescopeUser;
}

export async function syncUserFromDescope() {
  const authInfo = await getDescopeSession();
  if (!authInfo || !authInfo.token || typeof authInfo.token !== "object") {
    return null;
  }

  const token = authInfo.token as Record<string, unknown>;
  const descopeUserId = typeof token.sub === "string" ? token.sub : undefined;
  if (!descopeUserId) return null;

  const descopeUser = await loadDescopeUser(descopeUserId);
  const subject = await getOrCreateExperienceSubject();

  const displayName = normalizeName(descopeUser);
  const email = normalizeEmail(
    descopeUser,
    descopeUserId,
    typeof token.email === "string" ? token.email : undefined,
  );

  const user = await prisma.user.upsert({
    where: { descopeUserId },
    create: {
      email,
      descopeUserId,
      role: "user",
      plan: "free",
      displayName,
      fullName: displayName,
      avatarUrl: descopeUser.picture,
      status: descopeUser.status ?? "active",
      emailVerifiedAt: descopeUser.verifiedEmail ? new Date() : null,
      lastSeenAt: new Date(),
      experienceSubjectId: subject.id,
    },
    update: {
      email,
      displayName: displayName ?? undefined,
      fullName: displayName ?? undefined,
      avatarUrl: descopeUser.picture ?? undefined,
      status: descopeUser.status ?? "active",
      emailVerifiedAt: descopeUser.verifiedEmail ? new Date() : null,
      lastSeenAt: new Date(),
      experienceSubjectId: subject.id,
      deletedAt: null,
    },
  });

  const oauthProviders = Object.entries(descopeUser.OAuth ?? {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([provider]) => provider.toLowerCase());

  if (oauthProviders.length > 0) {
    await Promise.all(
      oauthProviders.map((provider) =>
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

  return { user, descopeUser, authInfo, subject };
}

export async function requireUser() {
  const authInfo = await getDescopeSession();
  if (!authInfo || !authInfo.token || typeof authInfo.token !== "object") {
    return null;
  }

  const token = authInfo.token as Record<string, unknown>;
  const descopeUserId = typeof token.sub === "string" ? token.sub : undefined;
  if (!descopeUserId) return null;

  const user = await prisma.user.findUnique({ where: { descopeUserId } });
  if (user) {
    const subject = await getOrCreateExperienceSubject();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastSeenAt: new Date(),
        experienceSubjectId:
          user.experienceSubjectId && user.experienceSubjectId === subject.id
            ? user.experienceSubjectId
            : subject.id,
      },
    });
    return { user, authInfo };
  }

  const synced = await syncUserFromDescope();
  if (!synced) return null;
  return { user: synced.user, authInfo: synced.authInfo };
}
