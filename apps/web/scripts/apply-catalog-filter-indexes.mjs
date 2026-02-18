import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, "..", "..", "..");
const envPath = path.join(rootDir, ".env");
const envLocalPath = path.join(rootDir, ".env.local");
const sqlPath = path.join(rootDir, "apps/web/scripts/catalog-filter-indexes.sql");

function readEnvValueFromFile(filePath, key) {
  if (!fs.existsSync(filePath)) return "";
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const k = line.slice(0, idx).trim();
    if (k !== key) continue;
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

function readEnvValue(key) {
  // `.env.local` overrides `.env`.
  return readEnvValueFromFile(envLocalPath, key) || readEnvValueFromFile(envPath, key);
}

function parseSqlStatements(raw) {
  const withoutComments = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, "")) // strip line comments
    .join("\n");

  return withoutComments
    .split(";")
    .map((stmt) => stmt.trim())
    .filter(Boolean);
}

async function main() {
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`Missing SQL file: ${sqlPath}`);
  }

  const connectionString =
    readEnvValue("NEON_DATABASE_URL") || readEnvValue("DATABASE_URL") || readEnvValue("POSTGRES_URL");
  if (!connectionString) {
    throw new Error("Missing NEON_DATABASE_URL/DATABASE_URL/POSTGRES_URL in .env/.env.local");
  }

  const sqlRaw = fs.readFileSync(sqlPath, "utf8");
  const statements = parseSqlStatements(sqlRaw);
  if (statements.length === 0) {
    throw new Error(`No SQL statements found in ${sqlPath}`);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("set statement_timeout = 0;");
    await client.query("set lock_timeout = 0;");

    console.log(`Applying ${statements.length} catalog index statements...`);
    for (const stmt of statements) {
      const label = stmt.split(/\s+/).slice(0, 6).join(" ");
      const t0 = performance.now();
      console.log(`\n> ${label} ...`);
      await client.query(stmt);
      const ms = Math.max(0, Math.round(performance.now() - t0));
      console.log(`OK (${ms}ms)`);
    }
  } finally {
    await client.end();
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
