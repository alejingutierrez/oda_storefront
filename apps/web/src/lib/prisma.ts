import { validateEnv } from "@/lib/env";
validateEnv();

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { safeInt } from "@/lib/safe-number";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.NEON_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL in environment");
}

const pool = global.pgPool ?? new Pool({
  connectionString: databaseUrl,
  max: safeInt(process.env.PG_POOL_MAX, { fallback: 10, min: 1, max: 50 }),
  idleTimeoutMillis: safeInt(process.env.PG_IDLE_TIMEOUT_MS, { fallback: 30_000, min: 1_000 }),
  connectionTimeoutMillis: safeInt(process.env.PG_CONNECTION_TIMEOUT_MS, { fallback: 15_000, min: 1_000 }),
});
const adapter = new PrismaPg(pool);

export const prisma = global.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
  global.pgPool = pool;
}
