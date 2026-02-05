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

const hexRegex = /^#?[0-9a-fA-F]{6}$/;
const normalizeHex = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!hexRegex.test(trimmed)) return null;
  return trimmed.startsWith("#") ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`;
};

const normalizeMood = (value) => {
  if (!value) return null;
  const raw = String(value).toLowerCase();
  const map = [
    ["vibrante", "Vibrante"],
    ["sofisticado", "Sofisticado"],
    ["terroso", "Terroso"],
    ["elegante", "Elegante"],
    ["fresco", "Fresco"],
    ["natural", "Natural"],
    ["suave", "Suave"],
    ["audaz", "Audaz"],
    ["calido", "Cálido"],
    ["cálido", "Cálido"],
    ["romantico", "Romántico"],
    ["romántico", "Romántico"],
    ["dramatico", "Dramático"],
    ["dramático", "Dramático"],
    ["equilibrado", "Equilibrado"],
    ["profundo", "Profundo"],
  ];
  for (const [needle, label] of map) {
    if (raw.includes(needle)) return label;
  }
  return "Otros";
};

const normalizeTemp = (value) => {
  if (!value) return null;
  const raw = String(value).toLowerCase();
  if (raw.includes("cal")) return "calidos";
  if (raw.includes("fri")) return "frios";
  if (raw.includes("neut")) return "neutros";
  return "mixtos";
};

const normalizeContrast = (value) => {
  if (!value) return null;
  const raw = String(value).toLowerCase();
  if (raw.includes("bajo")) return "bajo";
  if (raw.includes("medio")) return "medio";
  return "alto";
};

const TARGET_TOTAL = 200;
const TARGETS = {
  mood: {
    Vibrante: 30,
    Sofisticado: 30,
    Terroso: 20,
    Elegante: 20,
    Fresco: 15,
    Natural: 15,
    Suave: 15,
    Audaz: 10,
    Cálido: 10,
    Romántico: 10,
    Dramático: 8,
    Equilibrado: 7,
    Profundo: 10,
  },
  temperature: {
    mixtos: 75,
    calidos: 55,
    frios: 45,
    neutros: 25,
  },
  contrast: {
    alto: 90,
    medio: 70,
    bajo: 40,
  },
};

const now = new Date();

const run = async () => {
  const client = new Client({ connectionString });
  await client.connect();

  const paletteRows = await client.query(
    'SELECT id, hex, "pantoneCode", "pantoneName", "standardColorId", "standardColorDistance" FROM "color_combination_colors" WHERE "standardColorId" IS NOT NULL',
  );
  const standardRows = await client.query(
    'SELECT id, name, family FROM "standard_colors" ORDER BY family, name',
  );
  const comboRows = await client.query(
    'SELECT id, "colorsJson", season, temperature, contrast, mood FROM "color_combinations" ORDER BY id',
  );

  const standardById = new Map();
  const standardByName = new Map();
  for (const row of standardRows.rows) {
    standardById.set(row.id, { id: row.id, name: row.name, family: row.family });
    standardByName.set(row.name, { id: row.id, name: row.name, family: row.family });
  }

  const paletteByHex = new Map();
  const paletteByStandard = new Map();
  for (const row of paletteRows.rows) {
    const hex = normalizeHex(row.hex);
    if (!hex) continue;
    paletteByHex.set(hex, {
      hex,
      pantoneCode: row.pantoneCode ?? null,
      pantoneName: row.pantoneName ?? null,
      standardColorId: row.standardColorId,
      standardColorDistance: row.standardColorDistance ?? 999,
    });
    const list = paletteByStandard.get(row.standardColorId) ?? [];
    list.push({
      hex,
      pantoneCode: row.pantoneCode ?? null,
      pantoneName: row.pantoneName ?? null,
      standardColorDistance: row.standardColorDistance ?? 999,
    });
    paletteByStandard.set(row.standardColorId, list);
  }
  for (const list of paletteByStandard.values()) {
    list.sort((a, b) => a.standardColorDistance - b.standardColorDistance || a.hex.localeCompare(b.hex));
  }

  const pickHexesByName = (name, count) => {
    const standard = standardByName.get(name);
    if (!standard) return [];
    const entries = paletteByStandard.get(standard.id) ?? [];
    return entries.slice(0, count).map((entry) => entry.hex);
  };

  const syntheticSpecs = [
    { key: "mono-carbon", colors: pickHexesByName("Carbon", 2), mood: "Profundo", temperature: "neutros", contrast: "bajo", season: "Otoño/Invierno" },
    { key: "mono-grafito", colors: pickHexesByName("Grafito", 3), mood: "Profundo", temperature: "neutros", contrast: "bajo", season: "Otoño/Invierno" },
    { key: "mono-gris-oscuro", colors: pickHexesByName("Gris oscuro", 3), mood: "Dramático", temperature: "neutros", contrast: "medio", season: "Otoño/Invierno" },
    { key: "mono-gris", colors: pickHexesByName("Gris", 3), mood: "Suave", temperature: "neutros", contrast: "bajo", season: "Transicional" },
    { key: "mono-camel", colors: pickHexesByName("Camel", 3), mood: "Cálido", temperature: "calidos", contrast: "bajo", season: "Otoño/Invierno" },
    { key: "mono-greige", colors: pickHexesByName("Greige", 3), mood: "Equilibrado", temperature: "neutros", contrast: "bajo", season: "Transicional" },
    { key: "mono-beige", colors: pickHexesByName("Beige", 3), mood: "Natural", temperature: "calidos", contrast: "bajo", season: "Primavera/Verano" },
    { key: "mono-oro-champana", colors: pickHexesByName("Oro champana", 3), mood: "Elegante", temperature: "mixtos", contrast: "medio", season: "Transicional" },

    { key: "negro-carbon-grafito", colors: ["Negro", "Carbon", "Grafito"], mood: "Profundo", temperature: "neutros", contrast: "medio", season: "Otoño/Invierno" },
    { key: "negro-grisoscuro-gris", colors: ["Negro", "Gris oscuro", "Gris"], mood: "Dramático", temperature: "neutros", contrast: "alto", season: "Otoño/Invierno" },
    { key: "negro-grafito-grisclaro", colors: ["Negro", "Grafito", "Gris claro"], mood: "Dramático", temperature: "neutros", contrast: "alto", season: "Otoño/Invierno" },
    { key: "carbon-grafito-gris", colors: ["Carbon", "Grafito", "Gris"], mood: "Profundo", temperature: "neutros", contrast: "medio", season: "Transicional" },
    { key: "grafito-gris-grisclaro", colors: ["Grafito", "Gris", "Gris claro"], mood: "Suave", temperature: "neutros", contrast: "bajo", season: "Transicional" },
    { key: "grisoscuro-gris-grisclaro", colors: ["Gris oscuro", "Gris", "Gris claro"], mood: "Suave", temperature: "neutros", contrast: "bajo", season: "Transicional" },

    { key: "negro-camel-beige", colors: ["Negro", "Camel", "Beige"], mood: "Dramático", temperature: "mixtos", contrast: "alto", season: "Otoño/Invierno" },
    { key: "negro-greige-gris", colors: ["Negro", "Greige", "Gris"], mood: "Profundo", temperature: "neutros", contrast: "alto", season: "Otoño/Invierno" },
    { key: "carbon-camel-greige", colors: ["Carbon", "Camel", "Greige"], mood: "Elegante", temperature: "mixtos", contrast: "medio", season: "Otoño/Invierno" },
    { key: "grafito-camel-beige", colors: ["Grafito", "Camel", "Beige"], mood: "Elegante", temperature: "mixtos", contrast: "medio", season: "Otoño/Invierno" },
    { key: "gris-greige-camel", colors: ["Gris", "Greige", "Camel"], mood: "Equilibrado", temperature: "mixtos", contrast: "bajo", season: "Transicional" },
    { key: "gris-greige-tan", colors: ["Gris", "Greige", "Tan"], mood: "Equilibrado", temperature: "mixtos", contrast: "bajo", season: "Transicional" },
    { key: "grisoscuro-greige-beige", colors: ["Gris oscuro", "Greige", "Beige"], mood: "Suave", temperature: "mixtos", contrast: "medio", season: "Transicional" },
    { key: "carbon-greige-beige", colors: ["Carbon", "Greige", "Beige"], mood: "Elegante", temperature: "mixtos", contrast: "medio", season: "Transicional" },

    { key: "camel-greige-tan", colors: ["Camel", "Greige", "Tan"], mood: "Cálido", temperature: "calidos", contrast: "bajo", season: "Primavera/Verano" },
    { key: "camel-beige-crema", colors: ["Camel", "Beige", "Crema"], mood: "Natural", temperature: "calidos", contrast: "bajo", season: "Primavera/Verano" },
    { key: "greige-beige-tan", colors: ["Greige", "Beige", "Tan"], mood: "Suave", temperature: "calidos", contrast: "bajo", season: "Primavera/Verano" },

    { key: "orochampana-greige-beige", colors: ["Oro champana", "Greige", "Beige"], mood: "Elegante", temperature: "mixtos", contrast: "medio", season: "Transicional" },
    { key: "plata-gris-grafito", colors: ["Plata", "Gris", "Grafito"], mood: "Elegante", temperature: "neutros", contrast: "medio", season: "Transicional" },
    { key: "oro-camel-beige", colors: ["Oro", "Camel", "Beige"], mood: "Elegante", temperature: "calidos", contrast: "medio", season: "Otoño/Invierno" },
    { key: "negro-plata-grisoscuro", colors: ["Negro", "Plata", "Gris oscuro"], mood: "Dramático", temperature: "neutros", contrast: "alto", season: "Otoño/Invierno" },
    { key: "negro-orochampana-camel", colors: ["Negro", "Oro champana", "Camel"], mood: "Dramático", temperature: "mixtos", contrast: "alto", season: "Otoño/Invierno" },
  ];

  const syntheticCombos = [];
  for (const spec of syntheticSpecs) {
    const colors = [];
    for (const entry of spec.colors) {
      if (hexRegex.test(String(entry))) {
        colors.push({ hex: normalizeHex(entry), role: null });
        continue;
      }
      const picked = pickHexesByName(entry, 1)[0];
      if (picked) colors.push({ hex: picked, role: null });
    }
    if (colors.length < 2) continue;
    const roles = ["dominante", "secundario", "acento", "acento"];
    const withRoles = colors.map((color, index) => ({
      hex: color.hex,
      role: roles[index] ?? "acento",
    }));
    syntheticCombos.push({
      source: "synthetic",
      signature: withRoles
        .map((entry) => paletteByHex.get(entry.hex)?.standardColorId)
        .filter(Boolean)
        .sort()
        .join(","),
      colors: withRoles,
      season: spec.season,
      temperature: spec.temperature,
      contrast: spec.contrast,
      mood: spec.mood,
      detectedLayout: "manual",
    });
  }

  const existingCombos = [];
  for (const row of comboRows.rows) {
    const raw = row.colorsJson;
    let colors = [];
    if (Array.isArray(raw)) {
      colors = raw;
    } else if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) colors = parsed;
      } catch {
        colors = [];
      }
    }
    if (!colors.length) continue;
    const normalizedColors = colors
      .map((entry) => ({
        hex: normalizeHex(entry?.hex) ?? entry?.hex,
        role: entry?.role ?? null,
      }))
      .filter((entry) => entry.hex);

    const standardIds = normalizedColors
      .map((entry) => paletteByHex.get(entry.hex)?.standardColorId)
      .filter(Boolean);
    if (!standardIds.length) continue;
    const signature = Array.from(new Set(standardIds)).sort().join(",");
    const mood = normalizeMood(row.mood);
    if (!TARGETS.mood[mood]) continue;

    existingCombos.push({
      source: "existing",
      signature,
      colors: normalizedColors,
      season: row.season ?? "Transicional",
      temperature: normalizeTemp(row.temperature) ?? "mixtos",
      contrast: normalizeContrast(row.contrast) ?? "alto",
      mood,
      detectedLayout: "legacy",
    });
  }

  const dedupedBySignature = new Map();
  for (const combo of existingCombos) {
    const current = dedupedBySignature.get(combo.signature);
    if (!current) {
      dedupedBySignature.set(combo.signature, combo);
      continue;
    }
    const score = (candidate) => {
      const colorsCount = candidate.colors.length;
      return (colorsCount === 3 ? 3 : colorsCount === 4 ? 2 : 1) +
        (candidate.mood ? 1 : 0) +
        (candidate.temperature ? 1 : 0) +
        (candidate.contrast ? 1 : 0);
    };
    if (score(combo) > score(current)) {
      dedupedBySignature.set(combo.signature, combo);
    }
  }

  const candidates = [...syntheticCombos, ...dedupedBySignature.values()];

  const counts = {
    mood: Object.fromEntries(Object.keys(TARGETS.mood).map((key) => [key, 0])),
    temperature: Object.fromEntries(Object.keys(TARGETS.temperature).map((key) => [key, 0])),
    contrast: Object.fromEntries(Object.keys(TARGETS.contrast).map((key) => [key, 0])),
  };

  const usedSignatures = new Set();
  const selected = [];

  const scoreCombo = (combo) => {
    let score = 0;
    const moodTarget = TARGETS.mood[combo.mood] ?? 0;
    const tempTarget = TARGETS.temperature[combo.temperature] ?? 0;
    const contrastTarget = TARGETS.contrast[combo.contrast] ?? 0;
    if (counts.mood[combo.mood] < moodTarget) {
      score += (moodTarget - counts.mood[combo.mood]) * 3;
    }
    if (counts.temperature[combo.temperature] < tempTarget) {
      score += (tempTarget - counts.temperature[combo.temperature]) * 2;
    }
    if (counts.contrast[combo.contrast] < contrastTarget) {
      score += (contrastTarget - counts.contrast[combo.contrast]);
    }
    if (combo.source === "synthetic") score += 1.5;
    return score;
  };

  const pool = candidates.filter((combo) => combo.colors.length >= 2);

  while (selected.length < TARGET_TOTAL && pool.length) {
    let bestIndex = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const combo = pool[i];
      if (!combo.signature || usedSignatures.has(combo.signature)) continue;
      if (!TARGETS.mood[combo.mood]) continue;
      if (!TARGETS.temperature[combo.temperature]) continue;
      if (!TARGETS.contrast[combo.contrast]) continue;
      const score = scoreCombo(combo);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex === -1) break;
    const [chosen] = pool.splice(bestIndex, 1);
    selected.push(chosen);
    usedSignatures.add(chosen.signature);
    counts.mood[chosen.mood] += 1;
    counts.temperature[chosen.temperature] += 1;
    counts.contrast[chosen.contrast] += 1;
  }

  if (selected.length < TARGET_TOTAL) {
    const remaining = pool.filter((combo) => !usedSignatures.has(combo.signature));
    while (selected.length < TARGET_TOTAL && remaining.length) {
      const combo = remaining.shift();
      if (!combo) break;
      selected.push(combo);
      usedSignatures.add(combo.signature);
      if (counts.mood[combo.mood] !== undefined) counts.mood[combo.mood] += 1;
      if (counts.temperature[combo.temperature] !== undefined) counts.temperature[combo.temperature] += 1;
      if (counts.contrast[combo.contrast] !== undefined) counts.contrast[combo.contrast] += 1;
    }
  }

  if (selected.length !== TARGET_TOTAL) {
    throw new Error(`Selection did not reach target. Selected ${selected.length}`);
  }

  const mdBlocks = [];
  selected.forEach((combo, index) => {
    const image = `generated_${String(index + 1).padStart(3, "0")}.jpg`;
    const comboKey = "A";
    const colors = combo.colors.map((entry) => {
      const palette = paletteByHex.get(entry.hex) ?? {};
      return {
        hex: entry.hex,
        pantone_code: palette.pantoneCode ?? null,
        pantone_name: palette.pantoneName ?? null,
        role: entry.role ?? null,
      };
    });
    mdBlocks.push({
      image,
      detected_layout: combo.detectedLayout ?? "manual",
      combinations: [
        {
          id: comboKey,
          colors,
          season: combo.season,
          temperature: combo.temperature,
          extra: {
            contrast: combo.contrast,
            mood: combo.mood,
          },
        },
      ],
    });
  });

  const mdLines = [];
  mdLines.push("# COLORES_COMBINACIONES");
  mdLines.push("");
  mdLines.push(`- Generado: ${now.toISOString()}`);
  mdLines.push("- Fuente: mezcla de combinaciones existentes + nuevas (hard reset a 200)");
  mdLines.push("- Total combinaciones: 200");
  mdLines.push("");
  mdLines.push("Notas:");
  mdLines.push("- Los códigos y nombres Pantone vienen de la paleta 200.");
  mdLines.push("- `image` es generado (no corresponde a un archivo real).");
  mdLines.push("");

  mdBlocks.forEach((block) => {
    mdLines.push(`## ${block.image}`);
    mdLines.push(`- Layout detectado: ${block.detected_layout}`);
    mdLines.push("- Combinaciones detectadas: 1");
    mdLines.push(`- Combo A: temporada ${block.combinations[0].season}; temperatura ${block.combinations[0].temperature}; contraste ${block.combinations[0].extra.contrast}; mood ${block.combinations[0].extra.mood}`);
    mdLines.push("");
    mdLines.push("```json");
    mdLines.push(JSON.stringify(block, null, 2));
    mdLines.push("```");
    mdLines.push("");
  });

  fs.writeFileSync(mdPath, mdLines.join("\n"), "utf8");

  await client.query("BEGIN");
  await client.query('TRUNCATE TABLE "color_combinations" CASCADE');

  let inserted = 0;
  for (let i = 0; i < selected.length; i += 1) {
    const combo = selected[i];
    const imageFilename = `generated_${String(i + 1).padStart(3, "0")}.jpg`;
    const comboKey = "A";
    const colorsJson = combo.colors.map((entry) => ({
      hex: entry.hex,
      role: entry.role ?? null,
    }));
    await client.query(
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
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        crypto.randomUUID(),
        imageFilename,
        combo.detectedLayout ?? "manual",
        comboKey,
        combo.season,
        combo.temperature,
        combo.contrast,
        combo.mood,
        JSON.stringify(colorsJson),
        now,
        now,
      ],
    );
    inserted += 1;
  }

  await client.query("COMMIT");
  await client.end();

  console.log(`Inserted ${inserted} combinations.`);
  console.log("Mood counts:", counts.mood);
  console.log("Temperature counts:", counts.temperature);
  console.log("Contrast counts:", counts.contrast);
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
