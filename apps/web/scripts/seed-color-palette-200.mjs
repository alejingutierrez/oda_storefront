import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Client } from "pg";
import xlsx from "xlsx";

const rootDir = path.resolve(process.cwd(), "..", "..");
const envPath = path.join(rootDir, ".env");
const xlsxPath = path.join(rootDir, "paleta_200_colores_pantone_y_mapeo_formateado.xlsx");

const readEnvValue = (key) => {
  if (!fs.existsSync(envPath)) return "";
  const content = fs.readFileSync(envPath, "utf8");
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
};

const connectionString = readEnvValue("NEON_DATABASE_URL") || readEnvValue("DATABASE_URL");
if (!connectionString) {
  throw new Error("Missing NEON_DATABASE_URL or DATABASE_URL in .env");
}

if (!fs.existsSync(xlsxPath)) {
  throw new Error(`Missing ${xlsxPath}`);
}

const hexRegex = /^#?[0-9a-fA-F]{6}$/;
const normalizeHex = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!hexRegex.test(trimmed)) return null;
  return trimmed.startsWith("#") ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`;
};

const workbook = xlsx.readFile(xlsxPath);
const sheet = workbook.Sheets["palette_200"];
if (!sheet) {
  throw new Error("Missing sheet palette_200 in palette file");
}

const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
const colors = rows
  .map((row) => ({
    hex: normalizeHex(row.palette_hex || row.PALETTE_HEX || row.hex || ""),
    pantoneCode: row.pantone_code || row.PANTONE_CODE || "",
    pantoneName: row.pantone_name || row.PANTONE_NAME || "",
  }))
  .filter((row) => row.hex);

const uniqueHex = new Set(colors.map((c) => c.hex));
if (uniqueHex.size !== colors.length) {
  throw new Error(`Palette hexes are not unique. Total=${colors.length}, unique=${uniqueHex.size}`);
}

if (colors.length !== 200) {
  console.warn(`Warning: expected 200 colors, got ${colors.length}`);
}

const run = async () => {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("BEGIN");
    await client.query('TRUNCATE TABLE "color_combination_colors"');

    const insertSql = `
      INSERT INTO "color_combination_colors" (
        "id",
        "hex",
        "pantoneCode",
        "pantoneName",
        "labL",
        "labA",
        "labB",
        "standardColorId",
        "standardColorDistance",
        "standardColorAssignedAt",
        "standardColorSource",
        "createdAt",
        "updatedAt"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13);
    `;

    for (const color of colors) {
      const labRes = await client.query('SELECT l, a, b FROM hex_to_lab($1) LIMIT 1', [color.hex]);
      const lab = labRes.rows[0];
      const matchRes = await client.query('SELECT standard_color_id, distance FROM standard_color_best_match($1) LIMIT 1', [color.hex]);
      const match = matchRes.rows[0] ?? {};
      const standardColorId = match.standard_color_id ?? null;
      const distance = match.distance ?? null;
      const source = standardColorId ? "auto" : null;
      const now = new Date();

      await client.query(insertSql, [
        crypto.randomUUID(),
        color.hex,
        color.pantoneCode || null,
        color.pantoneName || null,
        lab?.l ?? null,
        lab?.a ?? null,
        lab?.b ?? null,
        standardColorId,
        distance,
        now,
        source,
        now,
        now,
      ]);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }

  console.log(`Seeded ${colors.length} palette colors into color_combination_colors.`);
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
