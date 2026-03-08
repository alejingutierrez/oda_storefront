import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mocks ----

const mockQueryRaw = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

// Mock env.ts (called by prisma.ts)
vi.mock("@/lib/env", () => ({ validateEnv: vi.fn() }));

const mockIsRedisEnabled = vi.fn();
const mockGetRedis = vi.fn();
const mockReadHeartbeat = vi.fn();
vi.mock("@/lib/redis", () => ({
  isRedisEnabled: () => mockIsRedisEnabled(),
  getRedis: () => mockGetRedis(),
  readHeartbeat: (...args: unknown[]) => mockReadHeartbeat(...args),
}));

import { GET } from "@/app/api/health/route";

// ---------- tests ----------

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns ok when all checks pass", async () => {
    mockQueryRaw.mockResolvedValue([{ "?column?": 1 }]);
    mockIsRedisEnabled.mockReturnValue(true);
    mockGetRedis.mockReturnValue({ ping: vi.fn().mockResolvedValue("PONG") });
    mockReadHeartbeat.mockResolvedValue({ online: true });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.database.status).toBe("ok");
    expect(body.checks.redis.status).toBe("ok");
    expect(body.checks.worker.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
  });

  it("returns 503 when database is down", async () => {
    mockQueryRaw.mockRejectedValue(new Error("connection refused"));
    mockIsRedisEnabled.mockReturnValue(false);
    mockReadHeartbeat.mockResolvedValue({ online: false });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("down");
    expect(body.checks.database.status).toBe("down");
    expect(body.checks.database.error).toBe("connection refused");
  });

  it("returns degraded when Redis is not configured", async () => {
    mockQueryRaw.mockResolvedValue([{ "?column?": 1 }]);
    mockIsRedisEnabled.mockReturnValue(false);
    mockReadHeartbeat.mockResolvedValue({ online: true });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.redis.status).toBe("degraded");
    expect(body.checks.redis.error).toBe("not_configured");
  });

  it("returns degraded when worker heartbeat is missing", async () => {
    mockQueryRaw.mockResolvedValue([{ "?column?": 1 }]);
    mockIsRedisEnabled.mockReturnValue(true);
    mockGetRedis.mockReturnValue({ ping: vi.fn().mockResolvedValue("PONG") });
    mockReadHeartbeat.mockResolvedValue(null);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.worker.status).toBe("degraded");
  });
});
