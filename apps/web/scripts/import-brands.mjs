import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import xlsx from "xlsx";
import pg from "pg";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });

const rawPath = process.env.BRANDS_XLSX_PATH || path.join(repoRoot, "Marcas colombianas.xlsx");
const filePath = path.isAbsolute(rawPath) ? rawPath : path.join(repoRoot, rawPath);
const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL_UNPOOLED/DATABASE_URL in .env");
}

if (!fs.existsSync(filePath)) {
  throw new Error(`No se encontró el archivo: ${filePath}`);
}

const normalizeKey = (value) =>
  String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const toString = (value) => {
  if (value === null || value === undefined) return undefined;
  const str = String(value).trim();
  return str.length ? str : undefined;
};

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return undefined;
  const normalized = String(value).replace(/[^0-9.,-]/g, "").replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : undefined;
};

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const normalizeRow = (row) => {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeKey(key)] = value;
  }
  return normalized;
};

const getField = (row, keys) => {
  for (const key of keys) {
    const normalized = normalizeKey(key);
    if (normalized in row) return row[normalized];
  }
  return undefined;
};

const workbook = xlsx.readFile(filePath, { cellDates: true });
const client = new Client({ connectionString: databaseUrl });

const upsertSql = `
  INSERT INTO "brands" (
    "id",
    "name",
    "slug",
    "siteUrl",
    "instagram",
    "city",
    "metadata",
    "isActive",
    "createdAt",
    "updatedAt"
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW())
  ON CONFLICT ("slug") DO UPDATE SET
    "name" = EXCLUDED."name",
    "siteUrl" = EXCLUDED."siteUrl",
    "instagram" = EXCLUDED."instagram",
    "city" = EXCLUDED."city",
    "metadata" = EXCLUDED."metadata",
    "updatedAt" = NOW()
  RETURNING (xmax = 0) AS inserted;
`;

let created = 0;
let updated = 0;
let skipped = 0;

await client.connect();

try {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: undefined });

    for (const rawRow of rows) {
      const row = normalizeRow(rawRow);
      const name = toString(
        getField(row, ["Nombre del Negocio", "Nombre", "Marca", "Brand"]),
      );

      if (!name) {
        skipped += 1;
        continue;
      }

      const siteUrl = toString(getField(row, ["URL", "Sitio web", "Website"]));
      const instagram = toString(getField(row, ["Instagram"]));
      const city = toString(getField(row, ["Ciudad", "City"]));
      const category = toString(getField(row, ["Categoría", "Categoria"]));
      const market = toString(getField(row, ["Mercado"]));
      const style = toString(getField(row, ["Estilo"]));
      const scale = toString(getField(row, ["Escala"]));
      const avgPrice = toNumber(getField(row, ["Promedio $", "Promedio", "Precio"]));
      const reviewed = toString(getField(row, ["Revisado"]));

      const slug = slugify(name);
      const metadata = {
        category,
        market,
        style,
        scale,
        avgPrice,
        reviewed,
        sheet: sheetName,
        source: "Marcas colombianas.xlsx",
      };

      const id = crypto.randomUUID();
      const result = await client.query(upsertSql, [
        id,
        name,
        slug,
        siteUrl ?? null,
        instagram ?? null,
        city ?? null,
        JSON.stringify(metadata),
      ]);

      if (result.rows[0]?.inserted) {
        created += 1;
      } else {
        updated += 1;
      }
    }
  }
} finally {
  await client.end();
}

console.log(`Import finalizado. Creados: ${created}, Actualizados: ${updated}, Omitidos: ${skipped}`);
