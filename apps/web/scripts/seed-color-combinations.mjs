import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Client } from "pg";

const rootDir = path.resolve(process.cwd(), "..", "..");
const envPath = path.join(rootDir, ".env");
const mdPath = path.join(rootDir, "COLORES_COMBINACIONES.md");

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

if (!fs.existsSync(mdPath)) {
  throw new Error(`Missing ${mdPath}`);
}

const md = fs.readFileSync(mdPath, "utf8");
const blocks = [...md.matchAll(/```json\n([\s\S]*?)\n```/g)];
if (!blocks.length) {
  throw new Error("No JSON blocks found in COLORES_COMBINACIONES.md");
}

const items = blocks.map((match) => JSON.parse(match[1]));

const now = new Date();
const toTimestamp = (date) => date.toISOString();
const hexRegex = /^#?[0-9a-fA-F]{6}$/;
const normalizeHex = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!hexRegex.test(trimmed)) return null;
  return trimmed.startsWith("#") ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`;
};

const run = async () => {
  const client = new Client({ connectionString });
  await client.connect();

  let combosInserted = 0;

  try {
    await client.query("BEGIN");

    for (const item of items) {
      const imageFilename = item.image;
      const detectedLayout = item.detected_layout;
      const combinations = Array.isArray(item.combinations) ? item.combinations : [];

      for (const combo of combinations) {
        const comboKey = combo.id ?? "A";
        const season = combo.season ?? null;
        const temperature = combo.temperature ?? null;
        const contrast = combo?.extra?.contrast ?? null;
        const mood = combo?.extra?.mood ?? null;

        const colors = Array.isArray(combo.colors) ? combo.colors : [];
        const colorsJson = colors
          .map((color) => ({
            hex: normalizeHex(color.hex) ?? color.hex,
            role: color.role ?? null,
          }))
          .filter((entry) => Boolean(entry.hex));

        const comboId = crypto.randomUUID();
        const insertCombo = await client.query(
          `INSERT INTO "color_combinations" (
             "id",
             "imageFilename",
             "detectedLayout",
             "comboKey",
             "season",
             "temperature",
             "contrast",
             "mood",
             "colorsJson",
             "createdAt",
             "updatedAt"
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT ("imageFilename", "comboKey") DO UPDATE SET
             "detectedLayout" = EXCLUDED."detectedLayout",
             "season" = EXCLUDED."season",
             "temperature" = EXCLUDED."temperature",
             "contrast" = EXCLUDED."contrast",
             "mood" = EXCLUDED."mood",
             "colorsJson" = EXCLUDED."colorsJson",
             "updatedAt" = EXCLUDED."updatedAt"
           RETURNING "id";`,
          [
            comboId,
            imageFilename,
            detectedLayout,
            comboKey,
            season,
            temperature,
            contrast,
            mood,
            JSON.stringify(colorsJson),
            now,
            now,
          ]
        );

        const persistedComboId = insertCombo.rows[0]?.id ?? comboId;
        combosInserted += 1;
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }

  console.log(`Upserted ${combosInserted} combinations.`);
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
