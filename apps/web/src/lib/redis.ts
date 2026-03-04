import crypto from "node:crypto";
import IORedis from "ioredis";

const connectionUrl = process.env.REDIS_URL ?? "";

export const isRedisEnabled = () => {
  if (!connectionUrl) return false;
  try {
    const { hostname } = new URL(connectionUrl);
    if (process.env.VERCEL) {
      if (!hostname) return false;
      const host = hostname.toLowerCase();
      if (host === "localhost" || host === "127.0.0.1" || host === "redis") {
        return false;
      }
    }
  } catch {
    return false;
  }
  return true;
};

let redis: IORedis | null = null;

export const getRedis = () => {
  if (!redis) {
    redis = new IORedis(connectionUrl, {
      // Keep failures fast in serverless environments.
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });
  }
  return redis;
};

export type RedisLockHandle = {
  key: string;
  token: string;
};

export const acquireLock = async (key: string, ttlMs: number): Promise<RedisLockHandle | null> => {
  if (!isRedisEnabled()) return null;
  const client = getRedis();
  const token = crypto.randomUUID();
  try {
    const res = await client.set(key, token, "PX", Math.max(1, ttlMs), "NX");
    if (res !== "OK") return null;
    return { key, token };
  } catch {
    return null;
  }
};

export const releaseLock = async (lock: RedisLockHandle | null | undefined) => {
  if (!lock || !isRedisEnabled()) return false;
  const client = getRedis();
  const releaseScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    end
    return 0
  `;
  try {
    const released = await client.eval(releaseScript, 1, lock.key, lock.token);
    return Number(released) > 0;
  } catch {
    return false;
  }
};

export const readJsonCache = async <T>(key: string): Promise<T | null> => {
  if (!isRedisEnabled()) return null;
  const client = getRedis();
  try {
    const raw = await client.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const writeJsonCache = async (key: string, value: unknown, ttlSeconds: number) => {
  if (!isRedisEnabled()) return false;
  const client = getRedis();
  const safeTtl = Math.max(1, Math.floor(ttlSeconds));
  try {
    await client.set(key, JSON.stringify(value), "EX", safeTtl);
    return true;
  } catch {
    return false;
  }
};

export const readKeyTtlSeconds = async (key: string) => {
  if (!isRedisEnabled()) return null;
  const client = getRedis();
  try {
    const ttl = await client.ttl(key);
    return ttl >= 0 ? ttl : null;
  } catch {
    return null;
  }
};

export const setKeyWithTtl = async (key: string, value: string, ttlSeconds: number) => {
  if (!isRedisEnabled()) return false;
  const client = getRedis();
  const safeTtl = Math.max(1, Math.floor(ttlSeconds));
  try {
    await client.set(key, value, "EX", safeTtl);
    return true;
  } catch {
    return false;
  }
};

export const tryAcquireLock = async (key: string, ttlMs: number) => {
  const lock = await acquireLock(key, ttlMs);
  return Boolean(lock);
};

type HeartbeatPayload = {
  pid?: number;
  hostname?: string;
  startedAt?: string;
  now?: string;
  lastCompletedAt?: Record<string, string | null | undefined>;
};

const parseHeartbeatPayload = (value: string | null): HeartbeatPayload | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as HeartbeatPayload;
  } catch {
    return null;
  }
};

export const readHeartbeat = async (key: string) => {
  if (!isRedisEnabled()) {
    return {
      online: false,
      ttlSeconds: null as number | null,
      payload: null as HeartbeatPayload | null,
    };
  }
  const client = getRedis();
  try {
    const [ttlSeconds, raw] = await Promise.all([client.ttl(key), client.get(key)]);
    // ioredis returns -2 when key doesn't exist, -1 when exists without expiry.
    const online = ttlSeconds > 0 || ttlSeconds === -1;
    return {
      online,
      ttlSeconds: ttlSeconds >= 0 ? ttlSeconds : null,
      payload: parseHeartbeatPayload(raw),
    };
  } catch {
    return {
      online: false,
      ttlSeconds: null as number | null,
      payload: null as HeartbeatPayload | null,
    };
  }
};
