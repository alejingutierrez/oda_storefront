import fs from "fs";
import path from "path";
import crypto from "crypto";
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

const hexRegex = /^#?[0-9a-fA-F]{6}$/;

const normalizeHex = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!hexRegex.test(trimmed)) return null;
  return trimmed.startsWith("#") ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`;
};

const normalizeLabel = (value) => {
  if (!value) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
};

const hexToRgb = (hex) => {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  return { r, g, b };
};

const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

const rgbToXyz = ({ r, g, b }) => {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  const z = rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041;
  return { x, y, z };
};

const pivotXyz = (t) => (t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t) + 16 / 116);

const xyzToLab = ({ x, y, z }) => {
  const refX = 0.95047;
  const refY = 1.0;
  const refZ = 1.08883;
  const fx = pivotXyz(x / refX);
  const fy = pivotXyz(y / refY);
  const fz = pivotXyz(z / refZ);
  const L = Math.max(0, 116 * fy - 16);
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);
  return { L, a, b };
};

const hexToLab = (hex) => {
  const rgb = hexToRgb(hex);
  const xyz = rgbToXyz(rgb);
  return xyzToLab(xyz);
};

const hexSaturation = (hex) => {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
};

const degToRad = (deg) => (deg * Math.PI) / 180;
const radToDeg = (rad) => (rad * 180) / Math.PI;

const deltaE2000 = (lab1, lab2) => {
  const L1 = lab1.L;
  const a1 = lab1.a;
  const b1 = lab1.b;
  const L2 = lab2.L;
  const a2 = lab2.a;
  const b2 = lab2.b;

  const avgLp = (L1 + L2) / 2;
  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const avgC = (C1 + C2) / 2;

  const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);
  const avgCp = (C1p + C2p) / 2;

  const h1p = Math.atan2(b1, a1p);
  const h2p = Math.atan2(b2, a2p);
  const h1pDeg = h1p >= 0 ? radToDeg(h1p) : radToDeg(h1p) + 360;
  const h2pDeg = h2p >= 0 ? radToDeg(h2p) : radToDeg(h2p) + 360;

  let deltahp = 0;
  if (Math.abs(h1pDeg - h2pDeg) <= 180) {
    deltahp = h2pDeg - h1pDeg;
  } else if (h2pDeg <= h1pDeg) {
    deltahp = h2pDeg - h1pDeg + 360;
  } else {
    deltahp = h2pDeg - h1pDeg - 360;
  }

  const deltaLp = L2 - L1;
  const deltaCp = C2p - C1p;
  const deltaHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(degToRad(deltahp / 2));

  let avgHp = 0;
  if (Math.abs(h1pDeg - h2pDeg) <= 180) {
    avgHp = (h1pDeg + h2pDeg) / 2;
  } else if (h1pDeg + h2pDeg < 360) {
    avgHp = (h1pDeg + h2pDeg + 360) / 2;
  } else {
    avgHp = (h1pDeg + h2pDeg - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(degToRad(avgHp - 30)) +
    0.24 * Math.cos(degToRad(2 * avgHp)) +
    0.32 * Math.cos(degToRad(3 * avgHp + 6)) -
    0.2 * Math.cos(degToRad(4 * avgHp - 63));

  const deltaTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(avgLp - 50, 2)) / Math.sqrt(20 + Math.pow(avgLp - 50, 2));
  const Sc = 1 + 0.045 * avgCp;
  const Sh = 1 + 0.015 * avgCp * T;
  const Rt = -Math.sin(degToRad(2 * deltaTheta)) * Rc;

  const kl = 1;
  const kc = 1;
  const kh = 1;

  const deltaE = Math.sqrt(
    Math.pow(deltaLp / (kl * Sl), 2) +
      Math.pow(deltaCp / (kc * Sc), 2) +
      Math.pow(deltaHp / (kh * Sh), 2) +
      Rt * (deltaCp / (kc * Sc)) * (deltaHp / (kh * Sh)),
  );

  return deltaE;
};

const extractHexes = (row) => {
  const list = [];
  const meta = row.metadata;
  if (meta && typeof meta === "object") {
    const enrichment = meta.enrichment;
    if (enrichment && typeof enrichment === "object") {
      const colors = enrichment.colors;
      if (colors && typeof colors === "object") {
        const hex = colors.hex;
        if (Array.isArray(hex)) {
          list.push(...hex);
        } else if (typeof hex === "string") {
          list.push(hex);
        }
      }
    }
  }
  if (!list.length && row.color) list.push(row.color);
  const normalized = list
    .map((entry) => normalizeHex(entry))
    .filter(Boolean)
    .filter((value, index, self) => self.indexOf(value) === index);
  if (maxVariantHexes > 0) {
    return normalized.slice(0, maxVariantHexes);
  }
  return normalized;
};

const bucketSize = Number(process.env.COLOR_MATCH_BUCKET_SIZE ?? 6);
const bucketRadius = Number(process.env.COLOR_MATCH_BUCKET_RADIUS ?? 2);
const minCandidates = Number(process.env.COLOR_MATCH_MIN_CANDIDATES ?? 40);
const batchSize = Number(process.env.COLOR_MATCH_BATCH ?? 500);
const threshold = Number(process.env.COLOR_MATCH_THRESHOLD ?? 24);
const penaltyWeight = Number(process.env.COLOR_MATCH_PENALTY ?? 12);
const topK = Number(process.env.COLOR_MATCH_TOP_K ?? 20);
const minCoverage = Number(process.env.COLOR_MATCH_MIN_COVERAGE ?? 0.4);
const maxAvgDistance = Number(process.env.COLOR_MATCH_MAX_AVG ?? 20);
const maxMaxDistance = Number(process.env.COLOR_MATCH_MAX_DIST ?? 36);
const allowFallback = process.env.COLOR_MATCH_ALLOW_FALLBACK !== "0";
const logEvery = Number(process.env.COLOR_MATCH_LOG_EVERY ?? 2000);
const maxVariantHexes = Number(process.env.COLOR_MATCH_MAX_HEXES ?? 0);
const startId = process.env.COLOR_MATCH_START_ID ?? "";
const stopAfter = Number(process.env.COLOR_MATCH_STOP_AFTER ?? 0);

const bucketCoord = (lab) => ({
  l: Math.round(lab.L / bucketSize),
  a: Math.round((lab.a + 128) / bucketSize),
  b: Math.round((lab.b + 128) / bucketSize),
});

const bucketKey = (coord) => `${coord.l}|${coord.a}|${coord.b}`;

const buildBucketIndex = (combos) => {
  const index = new Map();
  for (const combo of combos.values()) {
    for (const color of combo.colors) {
      const key = bucketKey(bucketCoord(color.lab));
      const list = index.get(key) ?? [];
      list.push({ combinationId: combo.id, lab: color.lab });
      index.set(key, list);
    }
  }
  return index;
};

const collectCandidates = (variantColors, bucketIndex) => {
  const candidates = new Set();
  for (const color of variantColors) {
    const base = bucketCoord(color.lab);
    for (let dl = -bucketRadius; dl <= bucketRadius; dl += 1) {
      for (let da = -bucketRadius; da <= bucketRadius; da += 1) {
        for (let db = -bucketRadius; db <= bucketRadius; db += 1) {
          const key = bucketKey({ l: base.l + dl, a: base.a + da, b: base.b + db });
          const entries = bucketIndex.get(key);
          if (!entries) continue;
          for (const entry of entries) {
            candidates.add(entry.combinationId);
          }
        }
      }
    }
  }
  return candidates;
};

const insertVectors = async (client, rows) => {
  if (!rows.length) return;
  const ids = [];
  const variantIds = [];
  const positions = [];
  const hexes = [];
  const labsL = [];
  const labsA = [];
  const labsB = [];
  const sources = [];
  const createdAts = [];
  const updatedAts = [];
  for (const row of rows) {
    ids.push(row.id);
    variantIds.push(row.variantId);
    positions.push(row.position);
    hexes.push(row.hex);
    labsL.push(row.labL);
    labsA.push(row.labA);
    labsB.push(row.labB);
    sources.push(row.source ?? null);
    createdAts.push(row.createdAt);
    updatedAts.push(row.updatedAt);
  }
  await client.query(
    'INSERT INTO "variant_color_vectors" ("id", "variantId", "position", "hex", "labL", "labA", "labB", "source", "createdAt", "updatedAt") SELECT * FROM UNNEST($1::text[], $2::text[], $3::int[], $4::text[], $5::float8[], $6::float8[], $7::float8[], $8::text[], $9::timestamp[], $10::timestamp[])',
    [ids, variantIds, positions, hexes, labsL, labsA, labsB, sources, createdAts, updatedAts],
  );
};

const insertMatches = async (client, rows) => {
  if (!rows.length) return;
  const ids = [];
  const variantIds = [];
  const combinationIds = [];
  const scores = [];
  const coverages = [];
  const avgDistances = [];
  const maxDistances = [];
  const matchedColors = [];
  const totalComboColors = [];
  const createdAts = [];
  const updatedAts = [];
  for (const row of rows) {
    ids.push(row.id);
    variantIds.push(row.variantId);
    combinationIds.push(row.combinationId);
    scores.push(row.score);
    coverages.push(row.coverage);
    avgDistances.push(row.avgDistance);
    maxDistances.push(row.maxDistance);
    matchedColors.push(row.matchedColors);
    totalComboColors.push(row.totalComboColors);
    createdAts.push(row.createdAt);
    updatedAts.push(row.updatedAt);
  }
  await client.query(
    'INSERT INTO "variant_color_combination_matches" ("id", "variantId", "combinationId", "score", "coverage", "avgDistance", "maxDistance", "matchedColors", "totalComboColors", "createdAt", "updatedAt") SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::int[], $9::int[], $10::timestamp[], $11::timestamp[])',
    [
      ids,
      variantIds,
      combinationIds,
      scores,
      coverages,
      avgDistances,
      maxDistances,
      matchedColors,
      totalComboColors,
      createdAts,
      updatedAts,
    ],
  );
};

const run = async () => {
  const client = new Client({ connectionString });
  await client.connect();

  const standardRows = await client.query(
    'SELECT id, hex, "labL", "labA", "labB", family FROM "standard_colors" ORDER BY id',
  );
  const standardColors = standardRows.rows.map((row) => ({
    id: row.id,
    hex: normalizeHex(row.hex),
    family: row.family,
    lab: { L: row.labL, a: row.labA, b: row.labB },
  }));
  const standardById = new Map();
  for (const color of standardColors) {
    if (!color.id || !color.hex) continue;
    standardById.set(color.id, color);
  }

  const aliasRows = await client.query(
    'SELECT alias, "standardColorId" FROM "standard_color_aliases" ORDER BY length(alias) DESC',
  );
  const aliasList = aliasRows.rows
    .map((row) => ({
      standardColorId: row.standardColorId,
      normalized: normalizeLabel(row.alias),
    }))
    .filter((entry) => entry.standardColorId && entry.normalized.length > 0)
    .sort((a, b) => b.normalized.length - a.normalized.length);

  const mapLabelToStandardId = (label) => {
    const normalized = normalizeLabel(label);
    if (!normalized) return null;
    for (const entry of aliasList) {
      if (normalized.includes(entry.normalized)) return entry.standardColorId;
    }
    return null;
  };

  const cfgRow = await client.query(
    'SELECT "valueJson" FROM "standard_color_config" WHERE "key" = $1 LIMIT 1',
    ["low_saturation_gate"],
  );
  let cfg = cfgRow.rows[0]?.valueJson ?? null;
  if (typeof cfg === "string") {
    try {
      cfg = JSON.parse(cfg);
    } catch {
      cfg = null;
    }
  }
  let lowSatThreshold = 0.12;
  let lowSatFamilies = ["NEUTRAL", "WARM_NEUTRAL", "METALLIC"];
  let lowSatAllowHexes = ["#C0C0C0"];
  if (cfg && typeof cfg === "object") {
    if (typeof cfg.threshold === "number") lowSatThreshold = cfg.threshold;
    if (Array.isArray(cfg.families) && cfg.families.length) {
      lowSatFamilies = cfg.families.map((value) => String(value).toUpperCase());
    }
    if (Array.isArray(cfg.allow_hexes) && cfg.allow_hexes.length) {
      lowSatAllowHexes = cfg.allow_hexes.map((value) => normalizeHex(value)).filter(Boolean);
    }
  }
  const lowSatFamiliesSet = new Set(lowSatFamilies);
  const lowSatAllowHexSet = new Set(lowSatAllowHexes);

  const mapHexToStandard = (hex) => {
    const normalized = normalizeHex(hex);
    if (!normalized) return null;
    const lab = hexToLab(normalized);
    const saturation = hexSaturation(normalized);
    let candidates = standardColors;
    if (saturation !== null && saturation < lowSatThreshold) {
      candidates = standardColors.filter((color) => {
        if (!lowSatFamiliesSet.has(String(color.family).toUpperCase())) return false;
        if (String(color.family).toUpperCase() === "METALLIC") {
          return lowSatAllowHexSet.has(color.hex);
        }
        return true;
      });
    }
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const color of candidates) {
      const dl = color.lab.L - lab.L;
      const da = color.lab.a - lab.a;
      const dbb = color.lab.b - lab.b;
      const dist = Math.sqrt(dl * dl + da * da + dbb * dbb);
      if (dist < bestDistance) {
        bestDistance = dist;
        best = color;
      }
    }
    if (!best) return null;
    return { id: best.id, hex: best.hex, lab: best.lab, distance: bestDistance };
  };

  const paletteRows = await client.query(
    'SELECT id, hex, "standardColorId", "labL", "labA", "labB" FROM "color_combination_colors" ORDER BY hex',
  );
  const paletteByHex = new Map();
  const updateIds = [];
  const updateL = [];
  const updateA = [];
  const updateB = [];

  for (const row of paletteRows.rows) {
    const hex = normalizeHex(row.hex);
    if (!hex) continue;
    const hasLab = row.labL !== null && row.labA !== null && row.labB !== null;
    let lab = hasLab ? { L: row.labL, a: row.labA, b: row.labB } : null;
    if (!lab) {
      lab = hexToLab(hex);
      updateIds.push(row.id);
      updateL.push(lab.L);
      updateA.push(lab.a);
      updateB.push(lab.b);
    }
    paletteByHex.set(hex, {
      standardColorId: row.standardColorId ?? null,
      lab,
    });
  }

  if (updateIds.length) {
    await client.query(
      'UPDATE "color_combination_colors" AS cc SET "labL" = data.lab_l, "labA" = data.lab_a, "labB" = data.lab_b FROM (SELECT UNNEST($1::text[]) AS id, UNNEST($2::float8[]) AS lab_l, UNNEST($3::float8[]) AS lab_a, UNNEST($4::float8[]) AS lab_b) AS data WHERE cc.id = data.id',
      [updateIds, updateL, updateA, updateB],
    );
  }

  const comboRows = await client.query('SELECT id, "colorsJson" FROM "color_combinations" ORDER BY id');
  const combos = new Map();

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

    const combo = { id: row.id, colors: [] };
    for (const entry of colors) {
      const hex = normalizeHex(entry?.hex);
      if (!hex) continue;
      const palette = paletteByHex.get(hex);
      let standardId = palette?.standardColorId ?? null;
      let standard = standardId ? standardById.get(standardId) : null;
      if (!standard) {
        const mapped = mapHexToStandard(hex);
        if (mapped) {
          standardId = mapped.id;
          standard = standardById.get(standardId);
        }
      }
      if (!standard) continue;
      combo.colors.push({ id: standardId, hex: standard.hex, lab: standard.lab });
    }
    if (combo.colors.length) {
      combos.set(row.id, combo);
    }
  }

  const comboIds = Array.from(combos.keys());
  const bucketIndex = buildBucketIndex(combos);

  const totalResult = await client.query('SELECT count(*)::int AS count FROM "variants"');
  const totalVariants = totalResult.rows[0]?.count ?? 0;
  console.log(`Combos loaded: ${combos.size}. Variants: ${totalVariants}.`);
  console.log(
    `Config: batch=${batchSize} threshold=${threshold} penalty=${penaltyWeight} topK=${topK} minCoverage=${minCoverage} maxAvg=${maxAvgDistance} maxDist=${maxMaxDistance} bucket=${bucketSize} radius=${bucketRadius} minCandidates=${minCandidates} maxHexes=${maxVariantHexes || "all"} startId=${startId || "begin"} fallback=${allowFallback ? "yes" : "no"}`,
  );

  let lastId = startId;
  let processed = 0;
  let insertedMatches = 0;
  const startedAt = Date.now();

  while (true) {
    const batch = await client.query(
      'SELECT v.id, v.color, v.metadata, v."standardColorId", p.name AS "productName" FROM "variants" v JOIN "products" p ON p.id = v."productId" WHERE v.id > $1 ORDER BY v.id ASC LIMIT $2',
      [lastId, batchSize],
    );
    if (!batch.rows.length) break;

    lastId = batch.rows[batch.rows.length - 1].id;
    const batchVariantIds = batch.rows.map((row) => row.id);
    const vectorRows = [];
    const matchRows = [];
    const now = new Date();

    for (const row of batch.rows) {
      const hexes = extractHexes(row);
      const variantColors = [];
      const seenStandard = new Set();

      for (const hex of hexes) {
        const mapped = mapHexToStandard(hex);
        if (!mapped || !mapped.id) continue;
        if (seenStandard.has(mapped.id)) continue;
        const standard = standardById.get(mapped.id);
        if (!standard) continue;
        seenStandard.add(mapped.id);
        variantColors.push({ hex: standard.hex, lab: standard.lab, standardColorId: mapped.id });
      }

      if (!variantColors.length && row.standardColorId) {
        const standard = standardById.get(row.standardColorId);
        if (standard) {
          variantColors.push({
            hex: standard.hex,
            lab: standard.lab,
            standardColorId: row.standardColorId,
          });
        }
      }

      if (!variantColors.length) {
        const labelCandidates = [];
        if (row.color && !hexRegex.test(String(row.color).trim())) {
          labelCandidates.push(row.color);
        }
        if (row.productName) {
          labelCandidates.push(row.productName);
        }
        for (const label of labelCandidates) {
          const mappedId = mapLabelToStandardId(label);
          if (!mappedId) continue;
          if (seenStandard.has(mappedId)) break;
          const standard = standardById.get(mappedId);
          if (!standard) continue;
          seenStandard.add(mappedId);
          variantColors.push({
            hex: standard.hex,
            lab: standard.lab,
            standardColorId: mappedId,
          });
          break;
        }
      }

      if (!variantColors.length) continue;
      let position = 1;
      for (const color of variantColors) {
        vectorRows.push({
          id: crypto.randomUUID(),
          variantId: row.id,
          position,
          hex: color.hex,
          labL: color.lab.L,
          labA: color.lab.a,
          labB: color.lab.b,
          source: "standard_color",
          createdAt: now,
          updatedAt: now,
        });
        position += 1;
      }

      const candidates = collectCandidates(variantColors, bucketIndex);
      const comboIterable = candidates.size >= minCandidates ? candidates : comboIds;

      const scores = [];
      for (const comboId of comboIterable) {
        const combo = combos.get(comboId);
        if (!combo) continue;
        const distances = combo.colors.map((comboColor) => {
          let min = Number.POSITIVE_INFINITY;
          for (const variantColor of variantColors) {
            const dist = deltaE2000(comboColor.lab, variantColor.lab);
            if (dist < min) min = dist;
          }
          return min;
        });
        const avgDistance = distances.reduce((sum, value) => sum + value, 0) / distances.length;
        const maxDistance = Math.max(...distances);
        const matched = distances.filter((value) => value <= threshold).length;
        const coverage = matched / distances.length;
        const score = avgDistance + (1 - coverage) * penaltyWeight;
        scores.push({
          combinationId: combo.id,
          score,
          coverage,
          avgDistance,
          maxDistance,
          matchedColors: matched,
          totalComboColors: distances.length,
        });
      }

      scores.sort((a, b) => a.score - b.score || a.avgDistance - b.avgDistance);
      const filtered = scores.filter(
        (entry) =>
          entry.coverage >= minCoverage &&
          entry.avgDistance <= maxAvgDistance &&
          entry.maxDistance <= maxMaxDistance,
      );
      const pool = filtered.length || !allowFallback ? filtered : scores;
      const topMatches = pool.slice(0, topK);
      for (const match of topMatches) {
        matchRows.push({
          id: crypto.randomUUID(),
          variantId: row.id,
          combinationId: match.combinationId,
          score: match.score,
          coverage: match.coverage,
          avgDistance: match.avgDistance,
          maxDistance: match.maxDistance,
          matchedColors: match.matchedColors,
          totalComboColors: match.totalComboColors,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    await client.query("BEGIN");
    await client.query('DELETE FROM "variant_color_vectors" WHERE "variantId" = ANY($1::text[])', [batchVariantIds]);
    await client.query(
      'DELETE FROM "variant_color_combination_matches" WHERE "variantId" = ANY($1::text[])',
      [batchVariantIds],
    );
    await insertVectors(client, vectorRows);
    await insertMatches(client, matchRows);
    await client.query("COMMIT");

    processed += batch.rows.length;
    insertedMatches += matchRows.length;

    if (processed % logEvery < batch.rows.length) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = elapsed > 0 ? processed / elapsed : 0;
      const remaining = totalVariants - processed;
      const etaSeconds = rate > 0 ? Math.round(remaining / rate) : null;
      const eta = etaSeconds ? `${Math.floor(etaSeconds / 60)}m ${etaSeconds % 60}s` : "n/a";
      console.log(
        `Processed ${processed}/${totalVariants} variants | ${rate.toFixed(1)} v/s | matches: ${insertedMatches} | ETA ${eta}`,
      );
    }

    if (stopAfter > 0 && processed >= stopAfter) {
      console.log(`Stopping early after ${processed} variants (COLOR_MATCH_STOP_AFTER).`);
      break;
    }
  }

  await client.end();
  console.log("Color relations build complete.");
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
