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

const run = async () => {
  const client = new Client({ connectionString });
  await client.connect();

  let combosInserted = 0;
  let colorsInserted = 0;

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
             "createdAt",
             "updatedAt"
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT ("imageFilename", "comboKey") DO UPDATE SET
             "detectedLayout" = EXCLUDED."detectedLayout",
             "season" = EXCLUDED."season",
             "temperature" = EXCLUDED."temperature",
             "contrast" = EXCLUDED."contrast",
             "mood" = EXCLUDED."mood",
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
            now,
            now,
          ]
        );

        const persistedComboId = insertCombo.rows[0]?.id ?? comboId;
        combosInserted += 1;

        const colors = Array.isArray(combo.colors) ? combo.colors : [];
        for (let idx = 0; idx < colors.length; idx += 1) {
          const color = colors[idx];
          const position = idx + 1;
          const colorId = crypto.randomUUID();
          const hex = color.hex;
          const pantoneCode = color.pantone_code ?? null;
          const pantoneName = color.pantone_name ?? null;
          const role = color.role ?? null;

          await client.query(
            `INSERT INTO "color_combination_colors" (
               "id",
               "combinationId",
               "position",
               "role",
               "hex",
               "pantoneCode",
               "pantoneName",
               "createdAt",
               "updatedAt"
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT ("combinationId", "position") DO UPDATE SET
               "role" = EXCLUDED."role",
               "hex" = EXCLUDED."hex",
               "pantoneCode" = EXCLUDED."pantoneCode",
               "pantoneName" = EXCLUDED."pantoneName",
               "updatedAt" = EXCLUDED."updatedAt";`,
            [
              colorId,
              persistedComboId,
              position,
              role,
              hex,
              pantoneCode,
              pantoneName,
              now,
              now,
            ]
          );
          colorsInserted += 1;
        }
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }

  console.log(`Upserted ${combosInserted} combinations and ${colorsInserted} colors.`);
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
