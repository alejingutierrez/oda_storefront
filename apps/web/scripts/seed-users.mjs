import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import pg from "pg";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!databaseUrl) throw new Error("Missing DATABASE_URL_UNPOOLED/DATABASE_URL in .env");
if (!adminEmail || !adminPassword) throw new Error("Missing ADMIN_EMAIL/ADMIN_PASSWORD in .env");

const client = new Client({ connectionString: databaseUrl });

await client.connect();

try {
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const result = await client.query(
    `
    INSERT INTO users (id, email, role, plan, "passwordHash", "createdAt", "updatedAt")
    VALUES ($1, $2, 'admin', 'free', $3, NOW(), NOW())
    ON CONFLICT (email) DO UPDATE SET
      role = 'admin',
      "passwordHash" = EXCLUDED."passwordHash",
      "updatedAt" = NOW()
    RETURNING (xmax = 0) AS inserted;
    `,
    [crypto.randomUUID(), adminEmail, passwordHash],
  );

  const inserted = result.rows[0]?.inserted ? "creado" : "actualizado";
  console.log(`Admin ${inserted}: ${adminEmail}`);
} finally {
  await client.end();
}
