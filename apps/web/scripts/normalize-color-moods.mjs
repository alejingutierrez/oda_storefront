import fs from "fs";
import path from "path";
import { Client } from "pg";

const envPath = path.resolve(process.cwd(), "..", "..", ".env");
const content = fs.readFileSync(envPath, "utf8");
let neon = "";
let db = "";
for (const rawLine of content.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const idx = line.indexOf("=");
  const key = line.slice(0, idx).trim();
  let value = line.slice(idx + 1).trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (key === "NEON_DATABASE_URL") neon = value;
  if (key === "DATABASE_URL") db = value;
}
const connectionString = neon || db;
if (!connectionString) {
  throw new Error("Missing NEON_DATABASE_URL or DATABASE_URL in .env");
}

const normalize = (text) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const moodPriority = [
  "vibrante",
  "sofisticado",
  "elegante",
  "terroso",
  "natural",
  "fresco",
  "dramatico",
  "audaz",
  "calido",
  "energetico",
  "equilibrado",
  "sereno",
  "romantico",
  "suave",
  "profundo",
  "refrescante",
  "tropical",
  "eclectico",
  "luminoso",
  "misterioso",
  "femenino",
  "clasico",
  "artistico",
  "complementario",
  "patriotico",
];

const moodLabels = {
  vibrante: "Vibrante",
  sofisticado: "Sofisticado",
  elegante: "Elegante",
  terroso: "Terroso",
  natural: "Natural",
  fresco: "Fresco",
  dramatico: "Dramático",
  audaz: "Audaz",
  calido: "Cálido",
  energetico: "Energético",
  equilibrado: "Equilibrado",
  sereno: "Sereno",
  romantico: "Romántico",
  suave: "Suave",
  profundo: "Profundo",
  refrescante: "Refrescante",
  tropical: "Tropical",
  eclectico: "Ecléctico",
  luminoso: "Luminoso",
  misterioso: "Misterioso",
  femenino: "Femenino",
  clasico: "Clásico",
  artistico: "Artístico",
  complementario: "Complementario",
  patriotico: "Patriótico",
};

const mapMood = (raw) => {
  if (!raw) return "Otros";
  const text = normalize(raw);
  for (const key of moodPriority) {
    if (text.includes(key)) return moodLabels[key] || key;
  }
  return "Otros";
};

const run = async () => {
  const client = new Client({ connectionString });
  await client.connect();
  const { rows } = await client.query('SELECT id, mood FROM "color_combinations"');

  const before = new Map();
  for (const row of rows) {
    const value = row.mood ?? "";
    before.set(value, (before.get(value) || 0) + 1);
  }

  let updated = 0;
  const after = new Map();

  await client.query("BEGIN");
  try {
    for (const row of rows) {
      const nextMood = mapMood(row.mood);
      after.set(nextMood, (after.get(nextMood) || 0) + 1);
      if (row.mood !== nextMood) {
        await client.query('UPDATE "color_combinations" SET mood = $1 WHERE id = $2', [nextMood, row.id]);
        updated += 1;
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }

  const afterSorted = [...after.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`Updated moods: ${updated}`);
  console.log(`Distinct moods after: ${afterSorted.length}`);
  console.log(afterSorted);
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
