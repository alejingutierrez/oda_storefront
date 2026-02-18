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

export const tryAcquireLock = async (key: string, ttlMs: number) => {
  if (!isRedisEnabled()) return false;
  const client = getRedis();
  const value = crypto.randomUUID();
  try {
    const res = await client.set(key, value, "PX", Math.max(1, ttlMs), "NX");
    return res === "OK";
  } catch {
    return false;
  }
};

export const readHeartbeat = async (key: string) => {
  if (!isRedisEnabled()) return { online: false, ttlSeconds: null as number | null };
  const client = getRedis();
  try {
    const ttlSeconds = await client.ttl(key);
    // ioredis returns -2 when key doesn't exist, -1 when exists without expiry.
    const online = ttlSeconds > 0 || ttlSeconds === -1;
    return { online, ttlSeconds: ttlSeconds >= 0 ? ttlSeconds : null };
  } catch {
    return { online: false, ttlSeconds: null as number | null };
  }
};

