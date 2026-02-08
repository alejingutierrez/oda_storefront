import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });

const DEFAULT_CATEGORY = "accesorios_textiles_y_medias";
const DEFAULT_SAMPLE_PER_SUBCATEGORY = 120;

const args = new Set(process.argv.slice(2));
const getArgValue = (flag) => {
  const prefix = `${flag}=`;
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith(prefix)) return raw.slice(prefix.length);
  }
  return null;
};

const category = getArgValue("--category") || process.env.AUDIT_CATEGORY || DEFAULT_CATEGORY;
const seed =
  getArgValue("--seed") ||
  process.env.AUDIT_SEED ||
  new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const samplePerSubcategory = Number(
  getArgValue("--sample-per-sub") || process.env.AUDIT_SAMPLE_PER_SUBCATEGORY || DEFAULT_SAMPLE_PER_SUBCATEGORY,
);

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL_UNPOOLED/DATABASE_URL in .env");
}

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const outRoot = ensureDir(path.join(repoRoot, "reports"));
const outDir = ensureDir(
  path.join(outRoot, `audit_${category}_${seed.replaceAll("-", "")}`),
);

const normalizeText = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const wordRe = (word) => new RegExp(`(^|\\s)${word}(\\s|$)`, "i");
const phraseRe = (phrase) => new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "i");

const CATEGORY_OUT_RULES = [
  {
    category: "joyeria_y_bisuteria",
    patterns: [
      wordRe("arete"),
      wordRe("aretes"),
      wordRe("pendiente"),
      wordRe("pendientes"),
      wordRe("anillo"),
      wordRe("anillos"),
      wordRe("collar"),
      wordRe("collares"),
      wordRe("pulsera"),
      wordRe("pulseras"),
      wordRe("brazalete"),
      wordRe("brazaletes"),
      wordRe("tobillera"),
      wordRe("tobilleras"),
      wordRe("piercing"),
      wordRe("piercings"),
      wordRe("dije"),
      wordRe("dijes"),
      wordRe("charm"),
      wordRe("charms"),
      wordRe("broche"),
      wordRe("broches"),
      wordRe("reloj"),
      wordRe("relojes"),
    ],
  },
  { category: "gafas_y_optica", patterns: [wordRe("gafas"), wordRe("lentes"), wordRe("montura"), wordRe("monturas"), wordRe("optica"), wordRe("sunglasses"), wordRe("goggles")] },
  { category: "bolsos_y_marroquineria", patterns: [wordRe("bolso"), wordRe("bolsos"), wordRe("cartera"), wordRe("carteras"), wordRe("billetera"), wordRe("billeteras"), wordRe("monedero"), wordRe("monederos"), wordRe("mochila"), wordRe("mochilas"), wordRe("morral"), wordRe("morrales"), wordRe("rinonera"), wordRe("rinoneras"), wordRe("canguro"), wordRe("clutch"), wordRe("sobre"), wordRe("bandolera"), wordRe("crossbody"), phraseRe("porta pasaporte"), phraseRe("porta documentos"), phraseRe("portadocumentos")] },
  { category: "calzado", patterns: [wordRe("zapato"), wordRe("zapatos"), wordRe("tenis"), wordRe("sneaker"), wordRe("sneakers"), wordRe("sandalia"), wordRe("sandalias"), wordRe("tacon"), wordRe("tacones"), wordRe("bota"), wordRe("botas"), wordRe("botin"), wordRe("botines"), wordRe("mocasin"), wordRe("mocasines"), wordRe("loafers"), wordRe("balerina"), wordRe("balerinas"), wordRe("flats"), wordRe("alpargata"), wordRe("alpargatas"), wordRe("espadrille"), wordRe("espadrilles"), wordRe("zueco"), wordRe("zuecos"), wordRe("chancla"), wordRe("chanclas"), phraseRe("flip flops"), phraseRe("flip flop")] },
  // NOTE: "panty" es ambiguo (ropa interior vs panty media); se trata en reglas de subcategoría.
];

const SUBCATEGORY_LABELS = {
  medias_calcetines: "Medias / calcetines",
  pantimedias_medias_veladas: "Pantimedias / medias veladas",
  cinturones: "Cinturones",
  gorras: "Gorras",
  sombreros: "Sombreros",
  bufandas: "Bufandas",
  guantes: "Guantes",
  panuelos_bandanas: "Pañuelos / bandanas",
  corbatas: "Corbatas",
  pajaritas_monos: "Pajaritas / moños",
  tirantes: "Tirantes",
  chales_pashminas: "Chales / pashminas",
};

const SUBCATEGORY_RULES = [
  {
    key: "pantimedias_medias_veladas",
    patterns: [
      wordRe("pantimedia"),
      wordRe("pantimedias"),
      phraseRe("media velada"),
      phraseRe("medias veladas"),
      wordRe("velada"),
      wordRe("veladas"),
      wordRe("tights"),
      wordRe("stocking"),
      wordRe("stockings"),
      wordRe("denier"),
      phraseRe("panty media"),
      phraseRe("panty-medias"),
    ],
  },
  {
    key: "medias_calcetines",
    patterns: [
      wordRe("calcetin"),
      wordRe("calcetines"),
      wordRe("media"),
      wordRe("medias"),
      wordRe("sock"),
      wordRe("socks"),
      wordRe("soquete"),
      wordRe("soquetes"),
      wordRe("tobillera"),
      wordRe("tobilleras"),
    ],
  },
  {
    key: "cinturones",
    patterns: [wordRe("cinturon"), wordRe("cinturones"), wordRe("correa"), wordRe("correas"), wordRe("belt"), wordRe("hebilla"), wordRe("hebillas")],
  },
  { key: "tirantes", patterns: [wordRe("tirante"), wordRe("tirantes"), wordRe("suspender"), wordRe("suspenders")] },
  { key: "corbatas", patterns: [wordRe("corbata"), wordRe("corbatas"), phraseRe("neck tie"), wordRe("necktie"), wordRe("tie"), phraseRe("slim tie")] },
  { key: "pajaritas_monos", patterns: [wordRe("pajarita"), wordRe("pajaritas"), wordRe("corbatin"), wordRe("corbatines"), phraseRe("bow tie"), phraseRe("bowtie")] },
  { key: "guantes", patterns: [wordRe("guante"), wordRe("guantes"), wordRe("miton"), wordRe("mitones"), wordRe("mitten"), wordRe("mittens"), wordRe("manopla"), wordRe("manoplas")] },
  { key: "bufandas", patterns: [wordRe("bufanda"), wordRe("bufandas"), wordRe("chalina"), wordRe("chalinas"), wordRe("scarf"), phraseRe("cuello termico"), phraseRe("neck gaiter")] },
  {
    key: "panuelos_bandanas",
    patterns: [
      wordRe("panuelo"),
      wordRe("panuelos"),
      wordRe("panoleta"),
      wordRe("panoletas"),
      wordRe("bandana"),
      wordRe("bandanas"),
      phraseRe("head scarf"),
      phraseRe("headscarf"),
      wordRe("turbante"),
      wordRe("turbantes"),
    ],
  },
  { key: "chales_pashminas", patterns: [wordRe("chal"), wordRe("chales"), wordRe("pashmina"), wordRe("pashminas"), wordRe("estola"), wordRe("estolas"), wordRe("stole"), wordRe("stoles")] },
  { key: "gorras", patterns: [wordRe("gorra"), wordRe("gorras"), wordRe("cap"), wordRe("caps"), wordRe("visera"), wordRe("viseras"), wordRe("snapback"), wordRe("trucker")] },
  { key: "sombreros", patterns: [wordRe("sombrero"), wordRe("sombreros"), phraseRe("bucket hat"), wordRe("bucket"), wordRe("fedora"), wordRe("panama")] },
];

const NEW_BUCKETS = {
  accesorios_para_cabello: { key: "__NEW__accesorios_para_cabello", label: "Accesorios para cabello" },
  gorro_beanie: { key: "__NEW__gorro_beanie", label: "Gorros / beanies (tejidos)" },
  tapabocas_mascarillas: { key: "__NEW__tapabocas_mascarillas", label: "Tapabocas / mascarillas" },
};

const inferCategoryOut = (text) => {
  for (const rule of CATEGORY_OUT_RULES) {
    if (rule.patterns.some((re) => re.test(text))) return rule.category;
  }
  return null;
};

const inferNewBucket = (text) => {
  // Hair accessories bucket.
  const hairPatterns = [
    wordRe("scrunchie"),
    wordRe("scrunchies"),
    wordRe("diadema"),
    wordRe("diademas"),
    wordRe("pasador"),
    wordRe("pasadores"),
    wordRe("pinza"),
    wordRe("pinzas"),
    wordRe("gancho"),
    wordRe("ganchos"),
    wordRe("coletero"),
    wordRe("coleteros"),
    wordRe("caucho"),
    wordRe("cauchos"),
    wordRe("liguita"),
    wordRe("liguitas"),
    phraseRe("para el cabello"),
    phraseRe("para cabello"),
    phraseRe("para el pelo"),
    phraseRe("para pelo"),
    wordRe("hair"),
  ];
  if (hairPatterns.some((re) => re.test(text))) return NEW_BUCKETS.accesorios_para_cabello;

  // Beanie bucket: avoid stealing "bucket hat" and classify knit caps.
  const hasBucketHat = phraseRe("bucket hat").test(text) || wordRe("bucket").test(text);
  const hasBeanie = wordRe("beanie").test(text) || wordRe("beanies").test(text);
  const hasGorro = wordRe("gorro").test(text) || wordRe("gorros").test(text);
  const hasKnitSignal =
    wordRe("tejido").test(text) ||
    wordRe("lana").test(text) ||
    wordRe("termico").test(text) ||
    wordRe("invierno").test(text) ||
    wordRe("wool").test(text);
  if (!hasBucketHat && (hasBeanie || (hasGorro && hasKnitSignal))) return NEW_BUCKETS.gorro_beanie;

  const maskPatterns = [wordRe("tapabocas"), wordRe("mascarilla"), wordRe("mascarillas")];
  if (maskPatterns.some((re) => re.test(text))) return NEW_BUCKETS.tapabocas_mascarillas;

  return null;
};

const inferAccessorySubcategory = (text) => {
  for (const rule of SUBCATEGORY_RULES) {
    if (rule.patterns.some((re) => re.test(text))) return rule.key;
  }
  // "mono" es demasiado ambiguo: puede ser corbatin o accesorio de cabello.
  if (wordRe("mono").test(text) || wordRe("monos").test(text)) {
    // Si hay señal fuerte de cuello/corbata, va a pajaritas. Si hay señal de cabello, va a nuevo bucket.
    if (wordRe("corbatin").test(text) || wordRe("pajarita").test(text) || wordRe("cuello").test(text) || wordRe("camisa").test(text)) {
      return "pajaritas_monos";
    }
    const newBucket = inferNewBucket(text);
    if (newBucket?.key === NEW_BUCKETS.accesorios_para_cabello.key) return null;
    return "pajaritas_monos";
  }
  return null;
};

const stableSampleKey = (id) =>
  crypto.createHash("md5").update(`${id}:${seed}`).digest("hex");

const toCsv = (value) => {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  if (!/[",\n]/.test(raw)) return raw;
  return `"${raw.replaceAll('"', '""')}"`;
};

const writeCsv = (filePath, rows, headers) => {
  const out = [];
  out.push(headers.join(","));
  for (const row of rows) {
    out.push(headers.map((key) => toCsv(row[key])).join(","));
  }
  fs.writeFileSync(filePath, out.join("\n") + "\n", "utf8");
};

const client = new Client({ connectionString: databaseUrl });

await client.connect();

try {
  // Detect category variants (helpful for chasing inconsistent keys).
  const categoryVariants = await client.query(
    `
      SELECT category, COUNT(*)::int AS cnt
      FROM "products"
      WHERE category ILIKE '%accesorios%' AND category ILIKE '%med%'
      GROUP BY category
      ORDER BY cnt DESC
      LIMIT 50;
    `,
  );

  const res = await client.query(
    `
      SELECT
        p.id::text AS product_id,
        p.name AS product_name,
        p.category AS category,
        p.subcategory AS subcategory,
        p."sourceUrl" AS source_url,
        p."updatedAt" AS updated_at,
        b.name AS brand_name
      FROM "products" p
      JOIN "brands" b ON b.id = p."brandId"
      WHERE p.category = $1
    `,
    [category],
  );

  const all = res.rows;
  const subKeyOf = (value) => {
    const trimmed = value === null || value === undefined ? "" : String(value).trim();
    return trimmed.length ? trimmed : "__NULL__";
  };

  const bySub = new Map();
  for (const row of all) {
    const subKey = subKeyOf(row.subcategory);
    const list = bySub.get(subKey) || [];
    list.push(row);
    bySub.set(subKey, list);
  }

  const counts = Array.from(bySub.entries())
    .map(([subcategory, rows]) => ({ subcategory, count: rows.length }))
    .sort((a, b) => b.count - a.count);

  const labeledCounts = counts.map((entry) => ({
    ...entry,
    subcategory_label: SUBCATEGORY_LABELS[entry.subcategory] || entry.subcategory,
  }));

  fs.writeFileSync(
    path.join(outDir, "counts.json"),
    JSON.stringify(
      {
        category,
        seed,
        total: all.length,
        counts: labeledCounts,
        detectedCategoryVariants: categoryVariants.rows,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const scoredAll = all.map((row) => {
    const text = normalizeText(row.product_name);
    const inferredOut = inferCategoryOut(text);
    const inferredSub = inferredOut ? null : inferAccessorySubcategory(text);
    // Nuevos buckets solo se consideran si NO hay match claro a subcategoria existente.
    const newBucket = inferredOut || inferredSub ? null : inferNewBucket(text);

    let suggestedCategory = row.category;
    let suggestedSubcategory = subKeyOf(row.subcategory);
    let suggestionKind = "keep";

    if (inferredOut) {
      suggestedCategory = inferredOut;
      suggestedSubcategory = "";
      suggestionKind = "move_category";
    } else if (newBucket) {
      // Keep in same category for now, but flag as candidate for new subcategory.
      suggestionKind = "new_subcategory_candidate";
    } else if (inferredSub) {
      const currentSub = subKeyOf(row.subcategory);
      if (currentSub !== inferredSub) {
        suggestedSubcategory = inferredSub;
        suggestionKind = "move_subcategory";
      }
    }

    return {
      product_id: row.product_id,
      brand_name: row.brand_name,
      product_name: row.product_name,
      current_category: row.category,
      current_subcategory: subKeyOf(row.subcategory),
      current_subcategory_label: SUBCATEGORY_LABELS[subKeyOf(row.subcategory)] || subKeyOf(row.subcategory),
      suggested_category: suggestedCategory,
      suggested_subcategory: suggestedSubcategory || "",
      suggested_subcategory_label: SUBCATEGORY_LABELS[suggestedSubcategory] || suggestedSubcategory || "",
      suggested_new_bucket: newBucket?.key || "",
      suggested_new_bucket_label: newBucket?.label || "",
      suggestion_kind: suggestionKind,
      source_url: row.source_url || "",
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : "",
      _sample_key: stableSampleKey(row.product_id),
    };
  });

  const byProductId = new Map(scoredAll.map((entry) => [entry.product_id, entry]));

  // Sample at least N items per current subcategory (stable across runs with same seed).
  const sampleRows = [];
  for (const [subKey, rows] of bySub.entries()) {
    const scored = rows.map((row) => byProductId.get(row.product_id)).filter(Boolean);
    scored.sort((a, b) => (a._sample_key < b._sample_key ? -1 : a._sample_key > b._sample_key ? 1 : 0));
    sampleRows.push(...scored.slice(0, samplePerSubcategory));
  }

  // Sort sample output by subcategory then sample key for readability.
  sampleRows.sort((a, b) => {
    if (a.current_subcategory === b.current_subcategory) {
      return a._sample_key < b._sample_key ? -1 : a._sample_key > b._sample_key ? 1 : 0;
    }
    return a.current_subcategory < b.current_subcategory ? -1 : 1;
  });

  // Write CSVs.
  const headers = [
    "product_id",
    "brand_name",
    "product_name",
    "current_category",
    "current_subcategory",
    "current_subcategory_label",
    "suggested_category",
    "suggested_subcategory",
    "suggested_subcategory_label",
    "suggested_new_bucket",
    "suggested_new_bucket_label",
    "suggestion_kind",
    "source_url",
    "updated_at",
  ];

  writeCsv(path.join(outDir, "samples.csv"), sampleRows, headers);

  // Full export (useful for bulk curation).
  // Note: Can be large; allow opt-out with --no-full or AUDIT_NO_FULL=true.
  const skipFull = args.has("--no-full") || String(process.env.AUDIT_NO_FULL || "").toLowerCase() === "true";
  if (!skipFull) {
    const fullRows = scoredAll
      .map(({ _sample_key, ...rest }) => rest)
      .sort((a, b) => (a.product_id < b.product_id ? -1 : a.product_id > b.product_id ? 1 : 0));
    writeCsv(path.join(outDir, "all_products.csv"), fullRows, headers);
  }

  // Aggregate findings for markdown.
  const agg = {
    total: scoredAll.length,
    move_category: 0,
    move_subcategory: 0,
    keep: 0,
    new_subcategory_candidate: 0,
  };

  const byKind = new Map();
  const byOutCategory = new Map();
  const byNewBucket = new Map();
  const bySubMismatch = new Map(); // currentSub -> suggestedSub
  const byBrandMoveCategory = new Map(); // brand -> suggested_category -> count
  const byBrandTotal = new Map(); // brand -> total in this category
  const byBrandKind = new Map(); // brand -> suggestion_kind -> count
  const subSignal = new Map(); // current_subcategory -> { total, selfSignal, outSignal }

  const patternsBySub = new Map(SUBCATEGORY_RULES.map((rule) => [rule.key, rule.patterns]));

  for (const row of scoredAll) {
    agg[row.suggestion_kind] = (agg[row.suggestion_kind] || 0) + 1;
    byKind.set(row.suggestion_kind, (byKind.get(row.suggestion_kind) || 0) + 1);

    const brand = row.brand_name || "(sin marca)";
    byBrandTotal.set(brand, (byBrandTotal.get(brand) || 0) + 1);
    const brandKinds = byBrandKind.get(brand) || new Map();
    brandKinds.set(row.suggestion_kind, (brandKinds.get(row.suggestion_kind) || 0) + 1);
    byBrandKind.set(brand, brandKinds);

    if (row.suggestion_kind === "move_category") {
      byOutCategory.set(row.suggested_category, (byOutCategory.get(row.suggested_category) || 0) + 1);
      const brandOut = byBrandMoveCategory.get(brand) || new Map();
      brandOut.set(row.suggested_category, (brandOut.get(row.suggested_category) || 0) + 1);
      byBrandMoveCategory.set(brand, brandOut);
    }
    if (row.suggestion_kind === "new_subcategory_candidate" && row.suggested_new_bucket) {
      byNewBucket.set(row.suggested_new_bucket, (byNewBucket.get(row.suggested_new_bucket) || 0) + 1);
    }
    if (row.suggestion_kind === "move_subcategory") {
      const key = `${row.current_subcategory} -> ${row.suggested_subcategory}`;
      bySubMismatch.set(key, (bySubMismatch.get(key) || 0) + 1);
    }

    // Signal rates by current subcategory.
    const text = normalizeText(row.product_name);
    const current = row.current_subcategory;
    const stat = subSignal.get(current) || { total: 0, selfSignal: 0, outSignal: 0 };
    stat.total += 1;
    const selfPatterns = patternsBySub.get(current) || [];
    if (selfPatterns.some((re) => re.test(text))) stat.selfSignal += 1;
    if (inferCategoryOut(text)) stat.outSignal += 1;
    subSignal.set(current, stat);
  }

  const toSortedPairs = (map) =>
    Array.from(map.entries())
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value);

  const topSuspiciousBySub = {};
  for (const [subKey] of bySub.entries()) {
    const candidates = scoredAll
      .filter((row) => row.current_subcategory === subKey)
      .filter((row) => row.suggestion_kind !== "keep")
      .slice(0, 20);
    topSuspiciousBySub[subKey] = candidates.map((row) => ({
      product_id: row.product_id,
      brand_name: row.brand_name,
      product_name: row.product_name,
      suggestion_kind: row.suggestion_kind,
      suggested_category: row.suggested_category,
      suggested_subcategory: row.suggested_subcategory,
      suggested_new_bucket: row.suggested_new_bucket,
      source_url: row.source_url,
    }));
  }

  const md = [];
  md.push(`# Auditoria: ${category}`);
  md.push("");
  md.push(`- Seed: \`${seed}\``);
  md.push(`- Total productos en categoria: **${scoredAll.length}**`);
  md.push(`- Sample por subcategoria (objetivo): **${samplePerSubcategory}**`);
  md.push("");
  md.push("## Conteos por subcategoria (actual)");
  md.push("");
  md.push("| subcategoria | label | count |");
  md.push("|---|---|---:|");
  for (const entry of labeledCounts) {
    md.push(
      `| \`${entry.subcategory}\` | ${entry.subcategory_label} | ${entry.count} |`,
    );
  }
  md.push("");

  md.push("## Hallazgos (reglas por titulo)");
  md.push("");
  md.push("| tipo | count |");
  md.push("|---|---:|");
  md.push(`| mantener (sin señal clara) | ${byKind.get("keep") || 0} |`);
  md.push(`| mover subcategoria (dentro de la categoria) | ${byKind.get("move_subcategory") || 0} |`);
  md.push(`| mover de categoria (parece otro tipo de producto) | ${byKind.get("move_category") || 0} |`);
  md.push(`| candidato a nueva subcategoria | ${byKind.get("new_subcategory_candidate") || 0} |`);
  md.push("");

  if (byOutCategory.size) {
    md.push("### Productos que parecen ser de otra categoria");
    md.push("");
    md.push("| categoria sugerida | count |");
    md.push("|---|---:|");
    for (const row of toSortedPairs(byOutCategory)) {
      md.push(`| \`${row.key}\` | ${row.value} |`);
    }
    md.push("");
  }

  if (bySubMismatch.size) {
    md.push("### Confusiones mas frecuentes (subcategoria actual -> sugerida)");
    md.push("");
    md.push("| cambio | count |");
    md.push("|---|---:|");
    for (const row of toSortedPairs(bySubMismatch).slice(0, 30)) {
      md.push(`| \`${row.key}\` | ${row.value} |`);
    }
    md.push("");
  }

  if (byNewBucket.size) {
    md.push("### Candidatos a nuevas subcategorias (tokens frecuentes)");
    md.push("");
    md.push("| bucket | count |");
    md.push("|---|---:|");
    for (const row of toSortedPairs(byNewBucket)) {
      const label =
        Object.values(NEW_BUCKETS).find((entry) => entry.key === row.key)?.label || "";
      md.push(`| \`${row.key}\` ${label ? `(${label})` : ""} | ${row.value} |`);
    }
    md.push("");
  }

  md.push("## Diagnostico por subcategoria (senal en el titulo)");
  md.push("");
  md.push("| subcategoria | count | % con señal propia | % que parecen otra categoria |");
  md.push("|---|---:|---:|---:|");
  for (const entry of labeledCounts) {
    const stat = subSignal.get(entry.subcategory) || { total: entry.count, selfSignal: 0, outSignal: 0 };
    const pctSelf = stat.total ? ((stat.selfSignal / stat.total) * 100).toFixed(1) : "0.0";
    const pctOut = stat.total ? ((stat.outSignal / stat.total) * 100).toFixed(1) : "0.0";
    md.push(`| \`${entry.subcategory}\` | ${entry.count} | ${pctSelf}% | ${pctOut}% |`);
  }
  md.push("");

  md.push("## Top marcas con mas posibles reclasificaciones de categoria");
  md.push("");
  const brandOutRows = [];
  for (const [brand, catMap] of byBrandMoveCategory.entries()) {
    const totalMoves = Array.from(catMap.values()).reduce((sum, v) => sum + v, 0);
    brandOutRows.push({ brand, totalMoves, catMap });
  }
  brandOutRows.sort((a, b) => b.totalMoves - a.totalMoves);
  md.push("| marca | total move_category | top destino |");
  md.push("|---|---:|---|");
  for (const row of brandOutRows.slice(0, 30)) {
    const top = Array.from(row.catMap.entries()).sort((a, b) => b[1] - a[1])[0];
    const topText = top ? `\`${top[0]}\` (${top[1]})` : "";
    md.push(`| ${toCsv(row.brand)} | ${row.totalMoves} | ${topText} |`);
  }
  md.push("");

  md.push("## Ejemplos sospechosos (top 20 por subcategoria)");
  md.push("");
  md.push(
    "Estos ejemplos son los primeros (por orden estable) que disparan una regla de cambio; usa `samples.csv` para revisar 100+ por subcategoria.",
  );
  md.push("");
  for (const entry of labeledCounts) {
    const subKey = entry.subcategory;
    const label = entry.subcategory_label;
    const examples = topSuspiciousBySub[subKey] || [];
    md.push(`### ${label} (\`${subKey}\`)`);
    md.push("");
    if (!examples.length) {
      md.push("- Sin ejemplos (no se detectaron reglas de cambio en este subset).");
      md.push("");
      continue;
    }
    md.push("| producto | sugerencia | fuente |");
    md.push("|---|---|---|");
    for (const ex of examples) {
      const suggestion = ex.suggestion_kind === "move_category"
        ? `mover a \`${ex.suggested_category}\``
        : ex.suggestion_kind === "move_subcategory"
          ? `\`${subKey}\` -> \`${ex.suggested_subcategory}\``
          : ex.suggestion_kind === "new_subcategory_candidate"
            ? `nuevo bucket: \`${ex.suggested_new_bucket}\``
            : ex.suggestion_kind;
      md.push(
        `| \`${ex.product_id}\` · ${toCsv(ex.brand_name)} · ${toCsv(ex.product_name)} | ${suggestion} | ${ex.source_url ? toCsv(ex.source_url) : ""} |`,
      );
    }
    md.push("");
  }

  md.push("## Notas");
  md.push("");
  md.push("- Esto es heuristico: reglas por titulo. Sirve para priorizar curation, no como verdad absoluta.");
  md.push(
    "- Si ves muchos `__NULL__` en subcategoria, es una inconsistencia directa (falta subcategoria).",
  );
  md.push(
    "- Si aparecen variantes de category (no slug) en `counts.json.detectedCategoryVariants`, hay que normalizar esos valores para no romper filtros/UI.",
  );
  md.push("");
  md.push("## Output");
  md.push("");
  md.push(`- ${path.relative(repoRoot, path.join(outDir, "counts.json"))}`);
  md.push(`- ${path.relative(repoRoot, path.join(outDir, "samples.csv"))}`);
  if (!skipFull) {
    md.push(`- ${path.relative(repoRoot, path.join(outDir, "all_products.csv"))}`);
  }
  md.push(`- ${path.relative(repoRoot, path.join(outDir, "report.md"))}`);
  md.push("");

  fs.writeFileSync(path.join(outDir, "report.md"), md.join("\n") + "\n", "utf8");

  console.log(`Audit written to: ${outDir}`);
} finally {
  await client.end();
}
