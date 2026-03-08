import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mock dependencies BEFORE importing the module under test ----

// Mock prisma
const mockFindFirst = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

// Mock next/headers
const mockCookiesGet = vi.fn();
const mockCookiesSet = vi.fn();
const mockCookiesDelete = vi.fn();
const mockHeadersGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: mockCookiesGet,
      set: mockCookiesSet,
      delete: mockCookiesDelete,
    }),
  ),
  headers: vi.fn(() =>
    Promise.resolve({
      get: mockHeadersGet,
    }),
  ),
}));

// Mock env.ts (called by prisma.ts)
vi.mock("@/lib/env", () => ({ validateEnv: vi.fn() }));

import { validateCronOrAdmin, validateAdminRequest, hashToken } from "../auth";

// ---------- helpers ----------

function fakeRequest(headers: Record<string, string> = {}): Request {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as unknown as Request;
}

// ---------- tests ----------

describe("validateCronOrAdmin", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.CRON_SECRET;
    delete process.env.ADMIN_TOKEN;
  });

  it("accepts valid CRON_SECRET", async () => {
    process.env.CRON_SECRET = "my-cron-secret";
    const req = fakeRequest({ authorization: "Bearer my-cron-secret" });
    const result = await validateCronOrAdmin(req);
    expect(result).toEqual({ source: "cron-secret" });
  });

  it("accepts valid ADMIN_TOKEN", async () => {
    process.env.ADMIN_TOKEN = "my-admin-token";
    const req = fakeRequest({ authorization: "Bearer my-admin-token" });
    const result = await validateCronOrAdmin(req);
    expect(result).toEqual({ source: "admin-token", email: "env-admin" });
  });

  it("rejects spoofed x-vercel-cron header (no Bearer)", async () => {
    const req = fakeRequest({ "x-vercel-cron": "1" });
    // No CRON_SECRET set, no ADMIN_TOKEN, no session
    mockCookiesGet.mockReturnValue(undefined);
    mockFindFirst.mockResolvedValue(null);
    const result = await validateCronOrAdmin(req);
    expect(result).toBeNull();
  });

  it("rejects invalid Bearer token", async () => {
    process.env.CRON_SECRET = "real-secret";
    process.env.ADMIN_TOKEN = "real-admin-token";
    const req = fakeRequest({ authorization: "Bearer wrong-token" });
    mockCookiesGet.mockReturnValue(undefined);
    mockFindFirst.mockResolvedValue(null);
    const result = await validateCronOrAdmin(req);
    expect(result).toBeNull();
  });

  it("falls back to admin session if no token matches", async () => {
    process.env.ADMIN_TOKEN = "admin-token-123";
    const sessionToken = "session-abc";
    const req = fakeRequest({ authorization: `Bearer ${sessionToken}` });

    mockCookiesGet.mockReturnValue(undefined);
    mockFindFirst.mockResolvedValue({
      id: "u1",
      email: "admin@test.com",
      role: "admin",
      sessionTokenCreatedAt: new Date(),
    });

    const result = await validateCronOrAdmin(req);
    expect(result).toEqual({
      source: "admin-session",
      email: "admin@test.com",
      role: "admin",
    });
  });
});

describe("validateAdminRequest — session TTL", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.ADMIN_TOKEN;
  });

  it("accepts session within TTL", async () => {
    const token = "valid-session-token";
    const tokenHash = hashToken(token);
    const req = fakeRequest({ authorization: `Bearer ${token}` });

    mockCookiesGet.mockReturnValue(undefined);
    mockFindFirst.mockResolvedValue({
      id: "u1",
      email: "admin@test.com",
      role: "admin",
      sessionTokenCreatedAt: new Date(), // just created
    });

    const result = await validateAdminRequest(req);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("email", "admin@test.com");
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: "admin", sessionTokenHash: tokenHash },
      }),
    );
  });

  it("rejects expired session (>7 days) and clears hash", async () => {
    const token = "expired-session-token";
    const req = fakeRequest({ authorization: `Bearer ${token}` });

    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    mockCookiesGet.mockReturnValue(undefined);
    mockFindFirst.mockResolvedValue({
      id: "u1",
      email: "admin@test.com",
      role: "admin",
      sessionTokenCreatedAt: eightDaysAgo,
    });
    mockUpdate.mockResolvedValue({});

    const result = await validateAdminRequest(req);
    expect(result).toBeNull();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: { sessionTokenHash: null, sessionTokenCreatedAt: null },
      }),
    );
  });

  it("returns null for unknown token", async () => {
    const req = fakeRequest({ authorization: "Bearer unknown" });
    mockCookiesGet.mockReturnValue(undefined);
    mockFindFirst.mockResolvedValue(null);

    const result = await validateAdminRequest(req);
    expect(result).toBeNull();
  });

  it("returns ADMIN_TOKEN match without DB lookup", async () => {
    process.env.ADMIN_TOKEN = "static-admin-token";
    const req = fakeRequest({ authorization: "Bearer static-admin-token" });
    mockCookiesGet.mockReturnValue(undefined);

    const result = await validateAdminRequest(req);
    expect(result).toEqual({ role: "admin", email: "env-admin" });
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});
