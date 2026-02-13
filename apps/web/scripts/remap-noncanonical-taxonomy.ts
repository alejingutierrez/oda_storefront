import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

import {
  CATEGORY_VALUES,
  GENDER_OPTIONS,
  SUBCATEGORY_BY_CATEGORY,
} from "../src/lib/product-enrichment/constants";

const { Client } = pg;

type Scope = "enriched" | "all";

type Row = {
  product_id: string;
  brand_name: string;
  product_name: string;
  image_cover_url: string | null;
  description: string | null;
  original_description: string | null;
  seo_title: string | null;
  seo_description: string | null;
  seo_tags: string[] | null;
  category: string | null;
  subcategory: string | null;
  gender: string | null;
  source_url: string | null;
  updated_at: string | null;
  is_enriched: boolean;
};

type Suggestion = {
  category: string;
  subcategory: string | null;
  confidence: number;
  reasons: string[];
  kind: "primary" | "fallback" | "subcategory";
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..", "..");

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env.local") });

const args = new Set(process.argv.slice(2));
const getArgValue = (flag: string) => {
  const prefix = `${flag}=`;
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith(prefix)) return raw.slice(prefix.length);
  }
  return null;
};

const apply = args.has("--apply") || String(process.env.TAXON_APPLY || "").toLowerCase() === "true";
const scope = ((getArgValue("--scope") || process.env.TAXON_SCOPE || "enriched").toLowerCase() as Scope);
const includeGender =
  args.has("--include-gender") ||
  String(process.env.TAXON_INCLUDE_GENDER || "").toLowerCase() === "true";
const genderOnly =
  args.has("--gender-only") ||
  String(process.env.TAXON_GENDER_ONLY || "").toLowerCase() === "true";
const genderAllCandidates =
  args.has("--gender-all-candidates") ||
  String(process.env.TAXON_GENDER_ALL_CANDIDATES || "").toLowerCase() === "true";
const minGenderConfidence = Number(
  getArgValue("--min-gender-confidence") ||
    process.env.TAXON_MIN_GENDER_CONFIDENCE ||
    0.88,
);
const minMoveGenderConfidence = Number(
  getArgValue("--min-move-gender-confidence") ||
    process.env.TAXON_MIN_MOVE_GENDER_CONFIDENCE ||
    0.93,
);
const noSaveReport =
  args.has("--no-save-report") ||
  String(process.env.TAXON_NO_SAVE_REPORT || "").toLowerCase() === "true";
const includeNullCategory = args.has("--include-null-category") || String(process.env.TAXON_INCLUDE_NULL_CATEGORY || "").toLowerCase() === "true";
const includeMissingSubcategory =
  args.has("--include-missing-subcategory") ||
  String(process.env.TAXON_INCLUDE_MISSING_SUBCATEGORY || "").toLowerCase() === "true";
const allCategoryCandidates =
  args.has("--all-category-candidates") ||
  String(process.env.TAXON_ALL_CATEGORY_CANDIDATES || "").toLowerCase() === "true";
const minCategoryConfidence = Number(
  getArgValue("--min-cat-confidence") || process.env.TAXON_MIN_CAT_CONFIDENCE || 0.9,
);
const minMoveCategoryConfidence = Number(
  getArgValue("--min-move-cat-confidence") || process.env.TAXON_MIN_MOVE_CAT_CONFIDENCE || 0.92,
);
const minReviewCategoryConfidence = Number(
  getArgValue("--min-review-cat-confidence") ||
    process.env.TAXON_MIN_REVIEW_CAT_CONFIDENCE ||
    0.9,
);
const minAutoApplyCategoryConfidence = Number(
  getArgValue("--min-auto-apply-cat-confidence") ||
    process.env.TAXON_MIN_AUTO_APPLY_CAT_CONFIDENCE ||
    0.965,
);
const allowSeoOnlyCanonicalMoves =
  args.has("--allow-seo-only-canonical-moves") ||
  String(process.env.TAXON_ALLOW_SEO_ONLY_CANONICAL_MOVES || "").toLowerCase() ===
    "true";
const enqueueReview =
  args.has("--enqueue-review") ||
  String(process.env.TAXON_ENQUEUE_REVIEW || "").toLowerCase() === "true";
const enqueueReviewIncludeAuto =
  args.has("--enqueue-review-include-auto") ||
  String(process.env.TAXON_ENQUEUE_REVIEW_INCLUDE_AUTO || "").toLowerCase() ===
    "true";
const enqueueReviewSource =
  getArgValue("--enqueue-review-source") ||
  process.env.TAXON_ENQUEUE_REVIEW_SOURCE ||
  "taxonomy_remap_noncanonical";
const minSubcategoryConfidence = Number(getArgValue("--min-sub-confidence") || process.env.TAXON_MIN_SUB_CONFIDENCE || 0.9);
const limit = Number(getArgValue("--limit") || process.env.TAXON_LIMIT || 0) || null;
const chunkSize = Math.max(50, Number(getArgValue("--chunk-size") || process.env.TAXON_CHUNK_SIZE || 300));
const evaluateSubsets =
  args.has("--evaluate-subsets") ||
  String(process.env.TAXON_EVALUATE_SUBSETS || "").toLowerCase() === "true";
const evalSeed = getArgValue("--eval-seed") || process.env.TAXON_EVAL_SEED || "2026-02-12";
const evalSamplePerSubset = Math.max(
  200,
  Number(getArgValue("--eval-sample-per-subset") || process.env.TAXON_EVAL_SAMPLE_PER_SUBSET || 1500),
);
const randomSampleSize = Math.max(
  0,
  Number(getArgValue("--sample-random") || process.env.TAXON_SAMPLE_RANDOM || 0),
);
const onlyFile =
  getArgValue("--only-file") ||
  process.env.TAXON_ONLY_FILE ||
  null;

type OnlyCase = {
  brand: string;
  name: string;
  expected?: {
    category?: string;
    subcategory?: string;
    gender?: string;
  };
};

const loadOnlyCases = (filePath: string): OnlyCase[] => {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
  const raw = fs.readFileSync(resolved, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`--only-file must be a JSON array. Got: ${typeof parsed}`);
  }
  const cases: OnlyCase[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const brand = String(obj.brand ?? obj.brand_name ?? "").trim();
    const name = String(obj.name ?? obj.product_name ?? "").trim();
    if (!brand || !name) continue;

    let expected: OnlyCase["expected"];
    if (obj.expected && typeof obj.expected === "object") {
      const expectedObj = obj.expected as Record<string, unknown>;
      const category =
        typeof expectedObj.category === "string" && expectedObj.category.trim()
          ? expectedObj.category.trim()
          : undefined;
      const subcategory =
        typeof expectedObj.subcategory === "string" && expectedObj.subcategory.trim()
          ? expectedObj.subcategory.trim()
          : undefined;
      const gender =
        typeof expectedObj.gender === "string" && expectedObj.gender.trim()
          ? expectedObj.gender.trim()
          : undefined;
      if (category || subcategory || gender) {
        expected = { category, subcategory, gender };
      }
    }

    cases.push({ brand, name, expected });
  }
  return cases;
};

const onlyCases: OnlyCase[] = onlyFile ? loadOnlyCases(onlyFile) : [];
const onlyMode = onlyCases.length > 0;

if (scope !== "enriched" && scope !== "all") {
  throw new Error(`Invalid --scope=${scope}. Expected enriched|all.`);
}

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL_UNPOOLED/DATABASE_URL in environment (.env/.env.local).");
}

const ensureDir = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const now = new Date();
const dateKey = now.toISOString().slice(0, 10).replaceAll("-", "");
const timeKey = now.toISOString().slice(11, 19).replaceAll(":", "");
const runKey = `${dateKey}_${timeKey}`;
const outRoot = ensureDir(path.join(repoRoot, "reports"));
const outDir = path.join(outRoot, `taxonomy_remap_noncanonical_${runKey}`);
if (!noSaveReport) ensureDir(outDir);

const canonicalCategorySet = new Set(CATEGORY_VALUES);
const isCanonicalCategory = (value: string) => canonicalCategorySet.has(value);

const normalizeText = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripHtml = (value: unknown) => {
  const raw = String(value || "");
  return raw
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
};

const escapeRe = (value: string) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (word: string) => new RegExp(`(^|\\s)${escapeRe(word)}(\\s|$)`, "i");
const phraseRe = (phrase: string) => new RegExp(`\\b${escapeRe(phrase).replace(/\\s+/g, "\\\\s+")}\\b`, "i");
const includesAny = (text: string, patterns: RegExp[]) => patterns.some((re) => re.test(text));
const dedupe = (values: string[]) => [...new Set(values.filter(Boolean))];

const toStringArray = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const normalizeTagToken = (value: string) =>
  normalizeText(value).replace(/\s+/g, "_").trim();

const toCsv = (value: unknown) => {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  if (!/[",\n]/.test(raw)) return raw;
  return `"${raw.replaceAll('"', '""')}"`;
};

const writeCsv = (filePath: string, rows: Record<string, unknown>[], headers: string[]) => {
  const out: string[] = [];
  out.push(headers.join(","));
  for (const row of rows) {
    out.push(headers.map((key) => toCsv(row[key])).join(","));
  }
  fs.writeFileSync(filePath, out.join("\n") + "\n", "utf8");
};

const stableSample = <T extends { product_id: string }>(
  items: T[],
  seed: string,
  limitPerSubset: number,
) => {
  return [...items]
    .sort((a, b) => {
      const ka = crypto.createHash("md5").update(`${a.product_id}:${seed}`).digest("hex");
      const kb = crypto.createHash("md5").update(`${b.product_id}:${seed}`).digest("hex");
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    })
    .slice(0, limitPerSubset);
};

const wilsonLowerBound = (success: number, total: number, z = 1.96) => {
  if (total <= 0) return 0;
  const p = success / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return (center - margin) / denominator;
};

// --- Category detectors (copied from audit-taxonomy.ts, but scoped to remap needs) ---

const BEAUTY_STRONG_PATTERNS = [
  wordRe("perfume"),
  wordRe("perfumes"),
  phraseRe("body splash"),
  phraseRe("splash corporal"),
  phraseRe("eau de parfum"),
  phraseRe("eau de toilette"),
  wordRe("edp"),
  wordRe("edt"),
  wordRe("parfum"),
];

const BEAUTY_COLONIA_PATTERNS = [wordRe("colonia"), wordRe("colonias")];

const BEAUTY_FRAGANCIA_PATTERNS = [
  wordRe("fragancia"),
  wordRe("fragancias"),
  wordRe("fragrance"),
  wordRe("fragrances"),
];

// Skin / body care signals. Keep these high precision to avoid color "crema" false-positives.
const BEAUTY_CARE_PATTERNS = [
  phraseRe("crema corporal"),
  phraseRe("body cream"),
  phraseRe("body lotion"),
  phraseRe("hand cream"),
  phraseRe("crema manos"),
  phraseRe("crema de manos"),
  phraseRe("locion corporal"),
  phraseRe("locion"),
  phraseRe("lotion"),
  wordRe("shampoo"),
  wordRe("champu"),
  wordRe("acondicionador"),
  wordRe("conditioner"),
  wordRe("jabon"),
  wordRe("jabones"),
  phraseRe("gel ducha"),
  phraseRe("body wash"),
];

const HOME_AROMA_PATTERNS = [
  wordRe("hogar"),
  wordRe("home"),
  wordRe("ambiente"),
  wordRe("ambientador"),
  wordRe("difusor"),
  wordRe("difusores"),
  wordRe("incienso"),
  wordRe("vela"),
  wordRe("velas"),
  wordRe("candle"),
  wordRe("candles"),
  phraseRe("fragancia de hogar"),
  phraseRe("fragancia ambiente"),
  phraseRe("room spray"),
  phraseRe("home spray"),
  phraseRe("en sticks"),
];

const mlAmountRe = /\b\d{2,4}\s?ml\b/i;

const JEWELRY_STRONG_CONTEXT_PATTERNS = [
  wordRe("joyeria"),
  wordRe("bisuteria"),
  wordRe("arete"),
  wordRe("aretes"),
  wordRe("pendiente"),
  wordRe("pendientes"),
  wordRe("topo"),
  wordRe("topos"),
  wordRe("collar"),
  wordRe("collares"),
  wordRe("pulsera"),
  wordRe("pulseras"),
  wordRe("brazalete"),
  wordRe("brazaletes"),
  wordRe("anillo"),
  wordRe("anillos"),
  wordRe("dije"),
  wordRe("dijes"),
  wordRe("charm"),
  wordRe("charms"),
];

const detectBeauty = (text: string): Suggestion | null => {
  if (includesAny(text, HOME_AROMA_PATTERNS)) return null;

  // Leather/shoe care is not "beauty" in our taxonomy; route to home/lifestyle instead.
  // Important: do not treat "cuero cabelludo" (scalp) as leather.
  const hasLeatherMaterial =
    includesAny(text, [wordRe("cuero"), wordRe("leather")]) &&
    !phraseRe("cuero cabelludo").test(text);
  if (hasLeatherMaterial) {
    const leatherCareOnlyActions = [
      wordRe("grasa"),
      wordRe("betun"),
      wordRe("betún"),
      wordRe("limpiador"),
      phraseRe("leather cleaner"),
      phraseRe("leather conditioner"),
      phraseRe("shoe polish"),
      phraseRe("shoe cream"),
      phraseRe("acondicionador de cuero"),
      phraseRe("acondicionador para cuero"),
    ];
    if (includesAny(text, leatherCareOnlyActions)) return null;
  }

  const hasStrong = includesAny(text, BEAUTY_STRONG_PATTERNS);
  const hasColonia = includesAny(text, BEAUTY_COLONIA_PATTERNS);
  const hasFragancia = includesAny(text, BEAUTY_FRAGANCIA_PATTERNS);
  const hasCare = includesAny(text, BEAUTY_CARE_PATTERNS);
  const hasSplash =
    wordRe("splash").test(text) &&
    (mlAmountRe.test(text) || wordRe("corporal").test(text) || wordRe("body").test(text));
  const hasPerfumeContext =
    hasStrong ||
    hasSplash ||
    hasCare ||
    hasFragancia ||
    mlAmountRe.test(text) ||
    wordRe("perfume").test(text) ||
    wordRe("parfum").test(text) ||
    wordRe("fragrance").test(text);
  const hasJewelryContext = includesAny(text, JEWELRY_STRONG_CONTEXT_PATTERNS);

  // "Colonia/Colonias" often appears in jewelry names; require true fragrance context.
  if (hasColonia && !hasPerfumeContext) return null;
  if (hasColonia && hasJewelryContext && !hasStrong && !hasSplash) return null;
  if (!hasStrong && !hasFragancia && !hasCare && !hasSplash && !hasColonia) return null;

  const strongBeautySignal = hasStrong || hasSplash || hasCare || (hasColonia && hasPerfumeContext);
  return {
    category: "hogar_y_lifestyle",
    subcategory: "cuidado_personal_y_belleza",
    confidence: strongBeautySignal ? 0.99 : 0.96,
    reasons: [
      hasStrong || hasSplash || (hasColonia && hasPerfumeContext)
        ? "kw:beauty_strong"
        : hasCare
          ? "kw:beauty_care"
          : "kw:beauty_fragancia",
    ],
    kind: "primary",
  };
};

const detectGiftCard = (text: string): Suggestion | null => {
  const patterns = [
    phraseRe("gift card"),
    wordRe("giftcard"),
    phraseRe("tarjeta regalo"),
    phraseRe("tarjeta de regalo"),
    phraseRe("bono de regalo"),
    wordRe("voucher"),
  ];
  if (!includesAny(text, patterns)) return null;
  return {
    category: "tarjeta_regalo",
    subcategory: "gift_card",
    confidence: 0.99,
    reasons: ["kw:gift_card"],
    kind: "primary",
  };
};

const hasSockContext = (text: string) =>
  includesAny(text, [
    // Avoid matching singular "media" (very ambiguous: "media bota", "media pierna", etc).
    wordRe("medias"),
    wordRe("calcetin"),
    wordRe("calcetines"),
    wordRe("sock"),
    wordRe("socks"),
    wordRe("soquete"),
    wordRe("soquetes"),
  ]);

const hasHairContext = (text: string) =>
  includesAny(text, [
    wordRe("cabello"),
    wordRe("pelo"),
    wordRe("hair"),
    phraseRe("hair pin"),
    phraseRe("bobby pin"),
    wordRe("pasador"),
    wordRe("pasadores"),
    wordRe("gancho"),
    wordRe("ganchos"),
    wordRe("pinza"),
    wordRe("pinzas"),
    wordRe("diadema"),
    wordRe("diademas"),
    wordRe("balaca"),
    wordRe("balacas"),
    wordRe("scrunchie"),
    wordRe("scrunchies"),
  ]);

const detectCharmKeychain = (text: string): Suggestion | null => {
  // User/business decision: treat keychains as "dijes/charms" (jewelry), not as bags accessories.
  //
  // Important: descriptions for bags often contain "incluye llavero" which should NOT
  // flip the category. So we only accept keychain as a primary intent when the text
  // looks like a product title/slug, not like a bundle mention.
  const keychainPatterns = [
    wordRe("llavero"),
    wordRe("llaveros"),
    wordRe("keychain"),
    wordRe("keychains"),
  ];
  if (!includesAny(text, keychainPatterns)) return null;

  const looksTitleLikeKeychain =
    /^llaveros?\b/i.test(text) ||
    /^keychains?\b/i.test(text) ||
    phraseRe("ref llavero").test(text);

  const bundleMentions = [
    phraseRe("incluye llavero"),
    phraseRe("incluye llaveros"),
    phraseRe("incluye un llavero"),
    phraseRe("con llavero"),
    phraseRe("con llaveros"),
  ];
  const hasBundleMention = includesAny(text, bundleMentions);

  const bagContext = includesAny(text, [
    wordRe("bolso"),
    wordRe("bolsos"),
    wordRe("cartera"),
    wordRe("carteras"),
    wordRe("mochila"),
    wordRe("mochilas"),
    wordRe("morral"),
    wordRe("morrales"),
    wordRe("rinonera"),
    wordRe("rinoneras"),
    wordRe("canguro"),
    wordRe("billetera"),
    wordRe("billeteras"),
    wordRe("maleta"),
    wordRe("maletas"),
    wordRe("equipaje"),
    wordRe("cartuchera"),
    wordRe("cartucheras"),
    wordRe("neceser"),
    wordRe("neceseres"),
    wordRe("lonchera"),
    wordRe("loncheras"),
  ]);

  if (!looksTitleLikeKeychain && hasBundleMention) return null;
  if (!looksTitleLikeKeychain && bagContext) return null;

  return {
    category: "joyeria_y_bisuteria",
    subcategory: "dijes_charms",
    confidence: looksTitleLikeKeychain ? 0.99 : 0.96,
    reasons: ["kw:keychain"],
    kind: "primary",
  };
};

const detectJewelry = (text: string): Suggestion | null => {
  // NOTE: some jewelry words are ambiguous in product copy for apparel/accessories:
  // - "anillo/ring" can describe hardware on swimwear ("ring bottom") or clothing.
  // - "charm" can describe a bag add-on ("bolso con charm").
  // - "broche" can be a closure on garments.
  //
  // We only classify as jewelry when we see strong jewelry intent, or when ambiguous cues
  // appear without strong bag/swim/apparel context.
  const strong = [
    wordRe("joyeria"),
    wordRe("bisuteria"),
    wordRe("arete"),
    wordRe("aretes"),
    wordRe("pendiente"),
    wordRe("pendientes"),
    wordRe("candonga"),
    wordRe("candongas"),
    wordRe("topo"),
    wordRe("topos"),
    wordRe("collar"),
    wordRe("collares"),
    wordRe("gargantilla"),
    wordRe("choker"),
    wordRe("pulsera"),
    wordRe("pulseras"),
    wordRe("brazalete"),
    wordRe("brazaletes"),
    wordRe("tobillera"),
    wordRe("tobilleras"),
    wordRe("piercing"),
    wordRe("piercings"),
    wordRe("earcuff"),
    wordRe("dije"),
    wordRe("dijes"),
    wordRe("reloj"),
    wordRe("relojes"),
  ];
  const ambiguous = [
    wordRe("anillo"),
    wordRe("anillos"),
    wordRe("charm"),
    wordRe("charms"),
    wordRe("broche"),
    wordRe("broches"),
    wordRe("pin"),
    wordRe("pins"),
  ];

  const hasStrong = includesAny(text, strong);
  const hasAmbiguous = includesAny(text, ambiguous);
  if (!hasStrong && !hasAmbiguous) return null;

  // "tobillera" is ambiguous: can mean jewelry anklet or ankle socks.
  const hasTobillera = wordRe("tobillera").test(text) || wordRe("tobilleras").test(text);
  if (hasTobillera && hasSockContext(text)) return null;

  const hasPin = wordRe("pin").test(text) || wordRe("pins").test(text);
  if (hasPin && hasHairContext(text)) return null;

  if (!hasStrong) {
    const bagContext = [
      wordRe("bolso"),
      wordRe("bolsos"),
      wordRe("cartera"),
      wordRe("canasto"),
      wordRe("mochila"),
      wordRe("morral"),
      wordRe("rinonera"),
      wordRe("canguro"),
      wordRe("billetera"),
    wordRe("maleta"),
    wordRe("equipaje"),
    wordRe("estuche"),
    wordRe("cartuchera"),
    wordRe("neceser"),
    wordRe("lonchera"),
  ];
    const swimApparelContext = [
      phraseRe("traje de bano"),
      phraseRe("vestido de bano"),
      wordRe("bikini"),
      wordRe("trikini"),
      wordRe("tankini"),
      wordRe("swim"),
      wordRe("swimwear"),
      phraseRe("one piece"),
      phraseRe("one-piece"),
      phraseRe("ring bottom"),
      phraseRe("ring top"),
      wordRe("bottom"),
    ];

    if (includesAny(text, bagContext) || includesAny(text, swimApparelContext)) return null;
  }

  return {
    category: "joyeria_y_bisuteria",
    subcategory: null,
    confidence: hasStrong ? 0.98 : 0.94,
    reasons: [hasStrong ? "kw:jewelry" : "kw:jewelry_ambiguous"],
    kind: "primary",
  };
};

const detectGlasses = (text: string): Suggestion | null => {
  const patterns = [
    wordRe("gafas"),
    wordRe("lentes"),
    wordRe("montura"),
    wordRe("monturas"),
    wordRe("optica"),
    wordRe("sunglasses"),
    wordRe("goggles"),
  ];
  if (!includesAny(text, patterns)) return null;
  return { category: "gafas_y_optica", subcategory: null, confidence: 0.98, reasons: ["kw:glasses"], kind: "primary" };
};

const looksLikePantsBotaFit = (text: string) => {
  const botaFitPantsPatterns = [
    phraseRe("bota recta"),
    phraseRe("bota ancha"),
    phraseRe("bota amplia"),
    phraseRe("bota muy ancha"),
    phraseRe("bota campana"),
    phraseRe("bota flare"),
    phraseRe("bota resortada"),
    phraseRe("bota tubo"),
    phraseRe("bota recto"),
    phraseRe("bota skinny"),
    phraseRe("bota medio"),
    phraseRe("bota media"),
    phraseRe("bota palazzo"),
    phraseRe("bota ajustable"),
    phraseRe("botas ajustables"),
    phraseRe("efecto en bota"),
  ];
  if (includesAny(text, botaFitPantsPatterns)) return true;
  const bottomsContext = [
    wordRe("pantalon"),
    wordRe("pantalones"),
    wordRe("jogger"),
    wordRe("cargo"),
    wordRe("palazzo"),
    wordRe("culotte"),
    wordRe("legging"),
    wordRe("leggings"),
  ];
  return includesAny(text, bottomsContext) && includesAny(text, [wordRe("bota"), wordRe("botas")]);
};

const detectFootwear = (text: string): Suggestion | null => {
  // Brand/domain heuristic: some catalogs omit "zapato/tenis" in titles, but the domain is an explicit shoe store.
  if (text.includes("kannibalshoes")) {
    return { category: "calzado", subcategory: null, confidence: 0.96, reasons: ["kw:footwear_domain"], kind: "primary" };
  }

  const strongPatterns = [
    wordRe("zapato"),
    wordRe("zapatos"),
    wordRe("tenis"),
    wordRe("sneaker"),
    wordRe("sneakers"),
    wordRe("sandalia"),
    wordRe("sandalias"),
    wordRe("tacon"),
    wordRe("tacones"),
    wordRe("botin"),
    wordRe("botines"),
    wordRe("mocasin"),
    wordRe("mocasines"),
    wordRe("loafers"),
    wordRe("balerina"),
    wordRe("balerinas"),
    wordRe("flats"),
    wordRe("alpargata"),
    wordRe("alpargatas"),
    wordRe("espadrille"),
    wordRe("espadrilles"),
    wordRe("zueco"),
    wordRe("zuecos"),
    wordRe("chancla"),
    wordRe("chanclas"),
    phraseRe("flip flops"),
    phraseRe("flip flop"),
    phraseRe("low top"),
    phraseRe("high top"),
  ];
  const bootPatterns = [wordRe("bota"), wordRe("botas"), wordRe("boot"), wordRe("boots")];

  if (includesAny(text, strongPatterns)) {
    return { category: "calzado", subcategory: null, confidence: 0.98, reasons: ["kw:footwear"], kind: "primary" };
  }

  if (includesAny(text, bootPatterns)) {
    if (looksLikePantsBotaFit(text)) return null;
    return { category: "calzado", subcategory: null, confidence: 0.98, reasons: ["kw:footwear"], kind: "primary" };
  }

  return null;
};

const detectMalaiSwimPiece = (text: string): Suggestion | null => {
  // Brand/domain heuristic: Malai catalogs name pieces as "Top"/"Bottom"/"Thong" without the word "bikini".
  // We rely on the domain being present in the URL and a swim-piece keyword in the title/slug.
  if (!text.includes("malaiswimwear")) return null;

  const hasCoverup = includesAny(text, [
    wordRe("kimono"),
    wordRe("kaftan"),
    wordRe("caftan"),
    wordRe("coverup"),
    phraseRe("cover up"),
    phraseRe("cover-up"),
  ]);
  if (hasCoverup) {
    return {
      category: "trajes_de_bano_y_playa",
      subcategory: "salida_de_bano_kaftan",
      confidence: 0.94,
      reasons: ["kw:swim", "dom:malai", "kw:coverup"],
      kind: "primary",
    };
  }

  const hasOnePiece = includesAny(text, [phraseRe("one piece"), phraseRe("one-piece")]);
  const hasTop = includesAny(text, [
    wordRe("top"),
    wordRe("bandeau"),
    wordRe("triangle"),
    wordRe("underwire"),
    wordRe("bralette"),
    wordRe("basal"),
  ]);
  const hasBottom = includesAny(text, [wordRe("bottom"), wordRe("bottoms"), wordRe("thong"), wordRe("thongs")]);
  if (!hasOnePiece && !hasTop && !hasBottom) return null;

  if (hasOnePiece) {
    return {
      category: "trajes_de_bano_y_playa",
      subcategory: "vestido_de_bano_entero",
      confidence: 0.96,
      reasons: ["kw:swim", "dom:malai", "kw:one_piece"],
      kind: "primary",
    };
  }

  return {
    category: "trajes_de_bano_y_playa",
    subcategory: "bikini",
    confidence: 0.94,
    reasons: ["kw:swim", "dom:malai", hasBottom ? "kw:bottom" : "kw:top"],
    kind: "primary",
  };
};

const detectWalletLike = (text: string): Suggestion | null => {
  // Wallet/cardholder type products can be mis-tagged as lifestyle/paper goods.
  // Treat them as bags category, but keep a specific reason so category moves can override SEO contradictions safely.
  const patterns = [
    wordRe("billetera"),
    wordRe("billeteras"),
    wordRe("monedero"),
    wordRe("monederos"),
    wordRe("tarjetero"),
    wordRe("tarjeteros"),
    wordRe("wallet"),
    wordRe("wallets"),
    wordRe("cardholder"),
    wordRe("cardholders"),
    phraseRe("card holder"),
    phraseRe("card holders"),
    phraseRe("money clip"),
    wordRe("moneyclip"),
  ];
  if (!includesAny(text, patterns)) return null;
  return {
    category: "bolsos_y_marroquineria",
    subcategory: "billetera",
    confidence: 0.985,
    reasons: ["kw:wallet_like"],
    kind: "primary",
  };
};

const detectBags = (text: string): Suggestion | null => {
  // Brand-specific: Mercedes Salazar "Lupita" are small bags/pouches, and titles don't include "bolso".
  if (text.includes("mercedessalazar") && includesAny(text, [wordRe("lupita"), wordRe("lupitas")])) {
    return {
      category: "bolsos_y_marroquineria",
      subcategory: "cartera_bolso_de_mano",
      confidence: 0.96,
      reasons: ["kw:bags", "dom:mercedes", "kw:lupita"],
      kind: "primary",
    };
  }

  const patterns = [
    wordRe("bolso"),
    wordRe("bolsos"),
    wordRe("bolsa"),
    wordRe("bolsas"),
    wordRe("bag"),
    wordRe("bags"),
    wordRe("cartera"),
    wordRe("carteras"),
    phraseRe("bolsa de golf"),
    phraseRe("bolsa golf"),
    phraseRe("golf bag"),
    wordRe("billetera"),
    wordRe("billeteras"),
    wordRe("tarjetero"),
    wordRe("tarjeteros"),
    phraseRe("money clip"),
    wordRe("moneyclip"),
    wordRe("monedero"),
    wordRe("monederos"),
    wordRe("mochila"),
    wordRe("mochilas"),
    wordRe("morral"),
    wordRe("morrales"),
    wordRe("rinonera"),
    wordRe("rinoneras"),
    wordRe("canguro"),
    wordRe("clutch"),
    wordRe("sobre"),
    wordRe("bandolera"),
    wordRe("crossbody"),
    phraseRe("manos libres"),
    wordRe("cartuchera"),
    wordRe("cartucheras"),
    wordRe("estuche"),
    wordRe("estuches"),
    wordRe("neceser"),
    wordRe("neceseres"),
    wordRe("cosmetiquera"),
    wordRe("cosmetiqueras"),
    wordRe("pouch"),
    wordRe("pouches"),
    wordRe("lapicera"),
    wordRe("lapiceras"),
    wordRe("lonchera"),
    wordRe("loncheras"),
    wordRe("lunchbox"),
    wordRe("tula"),
    wordRe("tulas"),
    wordRe("canasto"),
    wordRe("canastos"),
    wordRe("maleta"),
    wordRe("maletas"),
    wordRe("equipaje"),
    wordRe("trolley"),
    wordRe("luggage"),
    wordRe("suitcase"),
    phraseRe("porta pasaporte"),
    phraseRe("porta documentos"),
    phraseRe("portadocumentos"),
  ];
  if (!includesAny(text, patterns)) return null;
  return { category: "bolsos_y_marroquineria", subcategory: null, confidence: 0.98, reasons: ["kw:bags"], kind: "primary" };
};

const detectHomeLifestyle = (text: string): Suggestion | null => {
  const leatherCareActions = [
    wordRe("grasa"),
    wordRe("betun"),
    wordRe("betún"),
    wordRe("limpiador"),
    wordRe("limpiadores"),
    wordRe("crema"),
    wordRe("balsamo"),
    wordRe("bálsamo"),
    wordRe("polish"),
    phraseRe("shoe polish"),
    phraseRe("shoe cream"),
    phraseRe("leather cleaner"),
    phraseRe("leather conditioner"),
    phraseRe("acondicionador de cuero"),
    phraseRe("acondicionador para cuero"),
  ];
  const hasLeatherMaterial =
    includesAny(text, [wordRe("cuero"), wordRe("leather")]) &&
    !phraseRe("cuero cabelludo").test(text);
  const hasLeatherCare = hasLeatherMaterial && includesAny(text, leatherCareActions);
  if (hasLeatherCare) {
    return {
      category: "hogar_y_lifestyle",
      subcategory: "hogar_otros",
      confidence: 0.95,
      reasons: ["kw:home_other", "kw:leather_care"],
      kind: "primary",
    };
  }

  const kitchen = [
    wordRe("plato"),
    wordRe("platos"),
    wordRe("plate"),
    wordRe("plates"),
    wordRe("vajilla"),
    wordRe("taza"),
    wordRe("tazas"),
    wordRe("mug"),
    wordRe("mugs"),
    wordRe("bowl"),
    wordRe("bowls"),
    phraseRe("copa de vino"),
    phraseRe("copas de vino"),
    phraseRe("copa vino"),
    phraseRe("copas vino"),
    phraseRe("copa de champagne"),
    phraseRe("copas de champagne"),
    phraseRe("copa martini"),
    phraseRe("copas martini"),
    phraseRe("wine glass"),
    phraseRe("wine glasses"),
  ];
  if (includesAny(text, kitchen)) {
    return { category: "hogar_y_lifestyle", subcategory: "cocina_y_vajilla", confidence: 0.95, reasons: ["kw:home_kitchen"], kind: "primary" };
  }

  const tableTextiles = [
    wordRe("mantel"),
    wordRe("manteles"),
    wordRe("individual"),
    wordRe("individuales"),
    wordRe("posavasos"),
    wordRe("servilleta"),
    wordRe("servilletas"),
    wordRe("servilletero"),
    wordRe("servilleteros"),
    phraseRe("camino de mesa"),
    wordRe("placemat"),
    wordRe("placemats"),
    wordRe("napkin"),
    wordRe("napkins"),
    phraseRe("napkin ring"),
    phraseRe("napkin rings"),
    wordRe("coaster"),
    wordRe("coasters"),
  ];
  if (includesAny(text, tableTextiles)) {
    return { category: "hogar_y_lifestyle", subcategory: "textiles_de_mesa", confidence: 0.95, reasons: ["kw:home_table"], kind: "primary" };
  }

  const pillows = [
    wordRe("cojin"),
    wordRe("cojines"),
    wordRe("funda"),
    wordRe("fundas"),
    wordRe("pillow"),
    wordRe("pillows"),
    phraseRe("pillowcase"),
  ];
  if (includesAny(text, pillows)) {
    return { category: "hogar_y_lifestyle", subcategory: "cojines_y_fundas", confidence: 0.94, reasons: ["kw:home_pillow"], kind: "primary" };
  }

  const candles = [
    wordRe("vela"),
    wordRe("velas"),
    wordRe("candle"),
    wordRe("candles"),
    wordRe("difusor"),
    wordRe("difusores"),
    wordRe("incienso"),
    phraseRe("room spray"),
    phraseRe("home spray"),
  ];
  if (includesAny(text, candles)) {
    return { category: "hogar_y_lifestyle", subcategory: "velas_y_aromas", confidence: 0.94, reasons: ["kw:home_aroma"], kind: "primary" };
  }

  const towels = [
    wordRe("toalla"),
    wordRe("toallas"),
    phraseRe("toalla de bano"),
    phraseRe("toalla de baño"),
    phraseRe("bath towel"),
  ];
  if (includesAny(text, towels) && !includesAny(text, [phraseRe("traje de bano"), phraseRe("traje de baño")])) {
    return { category: "hogar_y_lifestyle", subcategory: "toallas_y_bano", confidence: 0.9, reasons: ["kw:home_towel"], kind: "primary" };
  }

  const blankets = [wordRe("manta"), wordRe("mantas"), wordRe("cobija"), wordRe("cobijas"), wordRe("blanket"), wordRe("blankets")];
  if (includesAny(text, blankets)) {
    return { category: "hogar_y_lifestyle", subcategory: "mantas_y_cobijas", confidence: 0.9, reasons: ["kw:home_blanket"], kind: "primary" };
  }

  const art = [
    wordRe("poster"),
    wordRe("posters"),
    wordRe("lamina"),
    wordRe("laminas"),
    phraseRe("wall art"),
    wordRe("ilustracion"),
    wordRe("illustration"),
    wordRe("arte"),
  ];
  if (includesAny(text, art)) {
    return { category: "hogar_y_lifestyle", subcategory: "arte_y_posters", confidence: 0.9, reasons: ["kw:home_art"], kind: "primary" };
  }

  const paper = [
    wordRe("papeleria"),
    wordRe("libro"),
    wordRe("libros"),
    wordRe("cuaderno"),
    wordRe("cuadernos"),
    wordRe("agenda"),
    wordRe("agendas"),
    wordRe("stationery"),
    wordRe("notebook"),
    wordRe("notebooks"),
    wordRe("portalapicero"),
    phraseRe("porta lapicero"),
    phraseRe("porta lapiceros"),
    wordRe("lapicero"),
    wordRe("lapiceros"),
    wordRe("organizador"),
    phraseRe("desk organizer"),
    phraseRe("office organizer"),
  ];
  if (includesAny(text, paper)) {
    return { category: "hogar_y_lifestyle", subcategory: "papeleria_y_libros", confidence: 0.9, reasons: ["kw:home_paper"], kind: "primary" };
  }

  const other = [
    wordRe("termo"),
    wordRe("termos"),
    wordRe("botilito"),
    wordRe("botilitos"),
    wordRe("botella"),
    wordRe("botellas"),
    phraseRe("water bottle"),
    phraseRe("bottle"),
    wordRe("stanley"),
    wordRe("portacomidas"),
    phraseRe("porta comidas"),
    wordRe("lunch"),
    wordRe("tupper"),
    wordRe("abanico"),
    wordRe("abanicos"),
    // Desk/work accessories are treated as lifestyle.
    wordRe("escritorio"),
    phraseRe("desk mat"),
    phraseRe("mat escritorio"),
    wordRe("mousepad"),
    phraseRe("mouse pad"),
    wordRe("mascota"),
    wordRe("mascotas"),
    wordRe("pet"),
    wordRe("pets"),
    wordRe("perro"),
    wordRe("perros"),
    wordRe("gato"),
    wordRe("gatos"),
    phraseRe("pet toy"),
    phraseRe("dog toy"),
    phraseRe("cat toy"),
    wordRe("juguete"),
    wordRe("juguetes"),
  ];
  if (includesAny(text, other)) {
    return { category: "hogar_y_lifestyle", subcategory: "hogar_otros", confidence: 0.9, reasons: ["kw:home_other"], kind: "primary" };
  }

  return null;
};

const detectTextileAccessory = (text: string): Suggestion | null => {
  const patterns = [
    // socks
    wordRe("medias"),
    wordRe("calcetin"),
    wordRe("calcetines"),
    wordRe("pantimedia"),
    wordRe("pantimedias"),
    // textile accessories
    wordRe("cinturon"),
    wordRe("cinturones"),
    wordRe("correa"),
    wordRe("belt"),
    wordRe("gorro"),
    wordRe("gorros"),
    wordRe("beanie"),
    wordRe("gorra"),
    wordRe("gorras"),
    wordRe("sombrero"),
    wordRe("sombreros"),
    wordRe("bufanda"),
    wordRe("bufandas"),
    wordRe("guante"),
    wordRe("guantes"),
    wordRe("panuelo"),
    wordRe("panuelos"),
    wordRe("bandana"),
    wordRe("bandanas"),
    wordRe("corbata"),
    wordRe("corbatas"),
    wordRe("pajarita"),
    wordRe("pajaritas"),
    wordRe("corbatin"),
    wordRe("corbatines"),
    wordRe("tirante"),
    wordRe("tirantes"),
    wordRe("chal"),
    wordRe("chales"),
    wordRe("pashmina"),
    wordRe("pashminas"),
    wordRe("tapabocas"),
    wordRe("mascarilla"),
    wordRe("mascarillas"),
    // hair
    wordRe("diadema"),
    wordRe("balaca"),
    wordRe("tiara"),
    wordRe("pinza"),
    wordRe("gancho"),
    wordRe("scrunchie"),
    phraseRe("para el cabello"),
    phraseRe("para cabello"),
    wordRe("hair"),
  ];
  if (!includesAny(text, patterns)) return null;
  return {
    category: "accesorios_textiles_y_medias",
    subcategory: null,
    confidence: 0.9,
    reasons: ["kw:textile_accessory"],
    kind: "primary",
  };
};

const detectApparelCategory = (text: string): Suggestion | null => {
  // High-precision only; when ambiguous, return null.
  const rules: Array<{ category: string; confidence: number; reasons: string[]; patterns: RegExp[] }> = [
    { category: "uniformes_y_ropa_de_trabajo_escolar", confidence: 0.95, reasons: ["kw:uniform"], patterns: [wordRe("uniforme"), wordRe("scrubs"), wordRe("dotacion"), wordRe("industrial"), phraseRe("alta visibilidad")] },
    { category: "ropa_de_bebe_0_24_meses", confidence: 0.95, reasons: ["kw:bebe"], patterns: [wordRe("bebe"), wordRe("recien"), wordRe("mameluco"), wordRe("pelele"), phraseRe("0 24"), phraseRe("0-24")] },
    {
      category: "trajes_de_bano_y_playa",
      confidence: 0.95,
      reasons: ["kw:swim"],
      patterns: [
        wordRe("bikini"),
        wordRe("trikini"),
        phraseRe("traje de bano"),
        phraseRe("vestido de bano"),
        wordRe("tankini"),
        wordRe("rashguard"),
        phraseRe("licra uv"),
        phraseRe("salida de bano"),
        wordRe("pareo"),
        // Often used in catalogs for swim shorts/pieces.
        wordRe("pantaloneta"),
        wordRe("pantalonetas"),
        wordRe("boardshort"),
        wordRe("boardshorts"),
        wordRe("swimwear"),
        wordRe("swimsuit"),
      ],
    },
    { category: "pijamas_y_ropa_de_descanso_loungewear", confidence: 0.93, reasons: ["kw:pijama"], patterns: [wordRe("pijama"), wordRe("camison"), wordRe("batola"), wordRe("bata"), wordRe("robe"), wordRe("loungewear")] },
    { category: "lenceria_y_fajas_shapewear", confidence: 0.93, reasons: ["kw:shapewear"], patterns: [wordRe("faja"), wordRe("shapewear"), wordRe("corse"), wordRe("corset"), wordRe("liguero"), wordRe("babydoll")] },
    {
      category: "ropa_interior_basica",
      confidence: 0.92,
      reasons: ["kw:underwear"],
      patterns: [
        wordRe("brasier"),
        wordRe("bralette"),
        wordRe("panty"),
        wordRe("trusa"),
        wordRe("tanga"),
        wordRe("tangas"),
        wordRe("brasilera"),
        wordRe("cachetero"),
        wordRe("cachetera"),
        wordRe("boxer"),
        wordRe("brief"),
        wordRe("briefs"),
        wordRe("interior"),
      ],
    },
    { category: "ropa_deportiva_y_performance", confidence: 0.9, reasons: ["kw:sport"], patterns: [wordRe("deportivo"), wordRe("running"), wordRe("ciclismo"), wordRe("gym"), wordRe("entrenamiento"), wordRe("compresion"), wordRe("compression")] },
    // English/shortcodes used by some brands (Tinta Latina, etc).
    { category: "camisas_y_blusas", confidence: 0.95, reasons: ["kw:blouse"], patterns: [wordRe("blouse"), wordRe("blouses"), wordRe("bluson")] },
    { category: "pantalones_no_denim", confidence: 0.95, reasons: ["kw:pants"], patterns: [wordRe("pants"), wordRe("trousers")] },
    { category: "faldas", confidence: 0.95, reasons: ["kw:skirt"], patterns: [wordRe("skirt"), wordRe("skirts")] },
    { category: "blazers_y_sastreria", confidence: 0.94, reasons: ["kw:vest"], patterns: [wordRe("vest"), wordRe("waistcoat")] },
    { category: "vestidos", confidence: 0.92, reasons: ["kw:vestido"], patterns: [wordRe("vestido"), wordRe("dress")] },
    { category: "enterizos_y_overoles", confidence: 0.92, reasons: ["kw:enterizo"], patterns: [wordRe("enterizo"), wordRe("jumpsuit"), wordRe("jumpsit"), wordRe("romper"), wordRe("overol"), wordRe("jardinera")] },
    { category: "conjuntos_y_sets_2_piezas", confidence: 0.9, reasons: ["kw:set"], patterns: [wordRe("set"), wordRe("sets"), wordRe("conjunto"), wordRe("conjuntos"), phraseRe("2 piezas"), phraseRe("2pzs"), phraseRe("matching set")] },
    { category: "faldas", confidence: 0.92, reasons: ["kw:falda"], patterns: [wordRe("falda"), wordRe("skort")] },
    { category: "shorts_y_bermudas", confidence: 0.92, reasons: ["kw:short"], patterns: [wordRe("short"), wordRe("shorts"), wordRe("bermuda"), wordRe("bermudas")] },
    { category: "jeans_y_denim", confidence: 0.92, reasons: ["kw:jean"], patterns: [wordRe("jean"), wordRe("jeans"), wordRe("denim")] },
    { category: "pantalones_no_denim", confidence: 0.92, reasons: ["kw:jogger"], patterns: [wordRe("jogger")] },
    { category: "pantalones_no_denim", confidence: 0.92, reasons: ["kw:leggings"], patterns: [wordRe("leggins"), wordRe("legging"), wordRe("leggings")] },
    { category: "pantalones_no_denim", confidence: 0.92, reasons: ["kw:pantalon"], patterns: [wordRe("pantalon"), wordRe("pantalones"), wordRe("cargo"), wordRe("palazzo"), wordRe("culotte")] },
    { category: "blazers_y_sastreria", confidence: 0.92, reasons: ["kw:blazer"], patterns: [wordRe("blazer"), wordRe("sastr"), wordRe("smoking"), wordRe("tuxedo")] },
    { category: "chaquetas_y_abrigos", confidence: 0.92, reasons: ["kw:chaleco"], patterns: [wordRe("chaleco"), wordRe("chalecos")] },
    { category: "chaquetas_y_abrigos", confidence: 0.92, reasons: ["kw:chaqueta"], patterns: [wordRe("chaqueta"), wordRe("abrigo"), wordRe("trench"), wordRe("parka"), wordRe("bomber"), wordRe("impermeable"), wordRe("rompevientos")] },
    { category: "buzos_hoodies_y_sueteres", confidence: 0.92, reasons: ["kw:buzo"], patterns: [wordRe("hoodie"), wordRe("buzo"), wordRe("sueter"), wordRe("sweater"), wordRe("cardigan"), wordRe("ruana"), wordRe("saco"), phraseRe("half zip"), phraseRe("full zip"), phraseRe("hal zip"), wordRe("halfzip"), wordRe("fullzip"), wordRe("halzip"), wordRe("half-zip"), wordRe("full-zip")] },
    { category: "camisas_y_blusas", confidence: 0.92, reasons: ["kw:camisa"], patterns: [wordRe("camisa"), wordRe("blusa"), wordRe("guayabera"), wordRe("bluson")] },
    { category: "camisetas_y_tops", confidence: 0.94, reasons: ["kw:polo"], patterns: [wordRe("polo"), phraseRe("camiseta polo")] },
    { category: "camisetas_y_tops", confidence: 0.92, reasons: ["kw:body"], patterns: [wordRe("body"), wordRe("bodysuit")] },
    { category: "camisetas_y_tops", confidence: 0.9, reasons: ["kw:camiseta"], patterns: [wordRe("camiseta"), wordRe("camisilla"), wordRe("esqueleto"), phraseRe("t shirt"), wordRe("tshirt"), wordRe("tee"), wordRe("top")] },
  ];

  for (const rule of rules) {
    if (includesAny(text, rule.patterns)) {
      return { category: rule.category, subcategory: null, confidence: rule.confidence, reasons: rule.reasons, kind: "primary" };
    }
  }
  return null;
};

const inferCanonicalCategory = (text: string): Suggestion | null => {
  // Order matters: strong non-fashion buckets first, then fashion categories.
  return (
    detectGiftCard(text) ||
    detectBeauty(text) ||
    detectHomeLifestyle(text) ||
    detectCharmKeychain(text) ||
    detectJewelry(text) ||
    detectGlasses(text) ||
    detectWalletLike(text) ||
    detectBags(text) ||
    detectFootwear(text) ||
    detectMalaiSwimPiece(text) ||
    detectTextileAccessory(text) ||
    detectApparelCategory(text)
  );
};

type SourceName =
  | "name"
  | "seo_tags"
  | "seo_title"
  | "seo_description"
  | "url"
  | "description"
  | "original_description";

type CategoryInferenceResult = {
  suggestion: Suggestion | null;
  sourceCount: number;
  scoreSupport: number;
  marginRatio: number;
  seoCategoryHints: string[];
  topSources: SourceName[];
  hasNonSeoSupport: boolean;
};

type GenderSuggestion = {
  gender: string;
  confidence: number;
  reasons: string[];
};

type GenderInferenceResult = {
  suggestion: GenderSuggestion | null;
  sourceCount: number;
  scoreSupport: number;
  marginRatio: number;
  hasExplicitUnisex: boolean;
  hasMixedBinary: boolean;
};

type ChangeRow = {
  product_id: string;
  brand_name: string;
  product_name: string;
  image_cover_url: string | null;
  source_url: string | null;
  updated_at: string | null;
  is_enriched: boolean;
  from_category: string | null;
  from_subcategory: string | null;
  to_category: string | null;
  to_subcategory: string | null;
  from_gender: string | null;
  to_gender: string | null;
  confidence: number;
  kind: Suggestion["kind"];
  reasons: string;
  seo_category_hints: string;
  source_count: number;
  score_support: number;
  margin_ratio: number;
  gender_confidence: number | null;
  category_decision: "none" | "auto_apply" | "review_required";
  gender_decision:
    | "none"
    | "alias_normalize"
    | "fill_missing"
    | "move_canonical"
    | "move_to_unisex";
  taxonomy_changed: boolean;
  gender_changed: boolean;
  _rule: Suggestion | null;
  _genderRule: GenderSuggestion | null;
};

const CATEGORY_SOURCE_WEIGHTS: Record<SourceName, number> = {
  name: 4.6,
  seo_tags: 5.2,
  seo_title: 3.2,
  seo_description: 2.4,
  url: 1.3,
  description: 1.1,
  original_description: 1.6,
};

const SUBCATEGORY_SOURCE_WEIGHTS: Record<SourceName, number> = {
  name: 4.2,
  seo_tags: 4.8,
  seo_title: 3.0,
  seo_description: 2.2,
  url: 2.0,
  description: 1.1,
  original_description: 1.4,
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const GENDER_VALUES = GENDER_OPTIONS.map((entry) => entry.value);
const canonicalGenderSet = new Set(GENDER_VALUES);

const GENDER_ALIAS_MAP: Record<string, string> = {
  masculino: "masculino",
  hombre: "masculino",
  men: "masculino",
  mens: "masculino",
  male: "masculino",
  caballero: "masculino",
  femenino: "femenino",
  mujer: "femenino",
  women: "femenino",
  womens: "femenino",
  female: "femenino",
  dama: "femenino",
  ladies: "femenino",
  no_binario_unisex: "no_binario_unisex",
  no_binario: "no_binario_unisex",
  unisex: "no_binario_unisex",
  genderless: "no_binario_unisex",
  neutral: "no_binario_unisex",
  gender_neutral: "no_binario_unisex",
  unknown: "no_binario_unisex",
  infantil: "infantil",
  nino: "infantil",
  nina: "infantil",
  kids: "infantil",
  kid: "infantil",
  baby: "infantil",
  bebe: "infantil",
  newborn: "infantil",
  toddler: "infantil",
};

const normalizeGenderValue = (value: string | null | undefined) => {
  if (!value) return null;
  const compact = normalizeText(value).replace(/\s+/g, "_").trim();
  if (!compact) return null;
  if (canonicalGenderSet.has(compact)) return compact;
  return GENDER_ALIAS_MAP[compact] ?? null;
};

const GENDER_FEMALE_PATTERNS = [
  wordRe("mujer"),
  wordRe("women"),
  wordRe("womens"),
  wordRe("dama"),
  wordRe("ladies"),
  wordRe("female"),
  wordRe("femenina"),
  wordRe("femenino"),
  phraseRe("para mujer"),
  phraseRe("de mujer"),
  phraseRe("ropa interior femenina"),
  phraseRe("lenceria femenina"),
  phraseRe("swimwear mujer"),
];

const GENDER_MALE_PATTERNS = [
  wordRe("hombre"),
  wordRe("men"),
  wordRe("mens"),
  wordRe("caballero"),
  wordRe("male"),
  wordRe("masculino"),
  wordRe("masculina"),
  phraseRe("para hombre"),
  phraseRe("de hombre"),
  phraseRe("ropa interior masculina"),
];

const GENDER_UNISEX_PATTERNS = [
  wordRe("unisex"),
  wordRe("genderless"),
  phraseRe("sin genero"),
  phraseRe("sin genero"),
  phraseRe("genero neutro"),
  phraseRe("gender neutral"),
];

const GENDER_CHILD_STRICT_PATTERNS = [
  wordRe("infantil"),
  wordRe("kids"),
  wordRe("kid"),
  wordRe("newborn"),
  wordRe("toddler"),
  phraseRe("0 24 meses"),
  phraseRe("0-24 meses"),
];

const GENDER_CHILD_BABY_PATTERNS = [wordRe("baby")];

const GENDER_CHILD_NAME_PATTERNS = [
  wordRe("nino"),
  wordRe("nina"),
];

const GENDER_CHILD_PATTERNS = [
  ...GENDER_CHILD_STRICT_PATTERNS,
  ...GENDER_CHILD_NAME_PATTERNS,
  wordRe("bebe"),
];

const GENDER_CHILD_COLOR_PATTERNS = [
  phraseRe("baby blue"),
  phraseRe("baby pink"),
  phraseRe("baby rose"),
  phraseRe("baby pastel"),
  phraseRe("azul baby"),
  phraseRe("rosa baby"),
];

const GENDER_CHILD_ADULT_FALSE_POSITIVE_PATTERNS = [
  phraseRe("baby doll"),
  wordRe("babydoll"),
  phraseRe("baby tee"),
];

const GENDER_SOURCE_WEIGHTS: Record<SourceName, number> = {
  name: 4.4,
  seo_tags: 5.2,
  seo_title: 3.2,
  seo_description: 2.4,
  url: 1.8,
  description: 1.1,
  original_description: 1.5,
};

const GENDER_FEMALE_PRODUCT_PATTERNS = [
  wordRe("brasier"),
  wordRe("bralette"),
  wordRe("panty"),
  wordRe("cachetero"),
  wordRe("cachetera"),
  wordRe("brasilera"),
  wordRe("bikini"),
  phraseRe("vestido de bano entero"),
  phraseRe("traje de bano entero"),
];

const GENDER_MALE_PRODUCT_PATTERNS = [
  phraseRe("boxer de hombre"),
  phraseRe("boxer hombre"),
  phraseRe("traje de bano hombre"),
  phraseRe("bermuda de bano hombre"),
];

const inferGenderFromSources = (
  sourceTexts: Record<SourceName, string>,
  context: { category: string | null; subcategory: string | null },
): GenderInferenceResult => {
  const buckets = new Map<
    string,
    { score: number; reasons: Set<string>; sources: Set<SourceName> }
  >();

  const addScore = (
    gender: string,
    source: SourceName,
    amount: number,
    reason: string,
  ) => {
    const current = buckets.get(gender) ?? {
      score: 0,
      reasons: new Set<string>(),
      sources: new Set<SourceName>(),
    };
    current.score += amount;
    current.sources.add(source);
    current.reasons.add(reason);
    current.reasons.add(`src:${source}`);
    buckets.set(gender, current);
  };

  let hasExplicitUnisex = false;
  let hasMixedBinary = false;

  const sources: SourceName[] = [
    "name",
    "seo_tags",
    "seo_title",
    "seo_description",
    "url",
    "original_description",
    "description",
  ];

  for (const source of sources) {
    const text = sourceTexts[source];
    if (!text) continue;
    const w = GENDER_SOURCE_WEIGHTS[source];
    const hasFemale = includesAny(text, GENDER_FEMALE_PATTERNS);
    const hasMale = includesAny(text, GENDER_MALE_PATTERNS);
    const hasFemaleProductType = includesAny(text, GENDER_FEMALE_PRODUCT_PATTERNS);
    const hasMaleProductType = includesAny(text, GENDER_MALE_PRODUCT_PATTERNS);
    const hasUnisex = includesAny(text, GENDER_UNISEX_PATTERNS);
    const hasChildRaw = includesAny(text, GENDER_CHILD_PATTERNS);
    const hasChildStrict = includesAny(text, GENDER_CHILD_STRICT_PATTERNS);
    const hasChildName = includesAny(text, GENDER_CHILD_NAME_PATTERNS);
    const hasChildBaby = includesAny(text, GENDER_CHILD_BABY_PATTERNS);
    const hasChildColorOnly =
      hasChildRaw &&
      !hasChildStrict &&
      includesAny(text, GENDER_CHILD_COLOR_PATTERNS);
    const hasChildAdultFalsePositive = includesAny(text, GENDER_CHILD_ADULT_FALSE_POSITIVE_PATTERNS);
    const allowBabyAsChildSignal = hasChildBaby && !hasChildColorOnly && !hasChildAdultFalsePositive;

    if (hasFemale) addScore("femenino", source, w * 1.0, "kw:gender_female");
    if (hasMale) addScore("masculino", source, w * 1.0, "kw:gender_male");
    if (hasFemaleProductType) addScore("femenino", source, w * 0.55, "kw:gender_female_product");
    if (hasMaleProductType) addScore("masculino", source, w * 0.55, "kw:gender_male_product");
    if (hasChildStrict) addScore("infantil", source, w * 1.25, "kw:gender_child_strict");
    if (hasChildName) addScore("infantil", source, w * 0.85, "kw:gender_child_name");
    if (allowBabyAsChildSignal) addScore("infantil", source, w * 0.78, "kw:gender_child_baby");
    if (hasUnisex) {
      hasExplicitUnisex = true;
      addScore("no_binario_unisex", source, w * 1.35, "kw:gender_unisex");
    }
    if (hasFemale && hasMale) {
      hasMixedBinary = true;
      addScore("no_binario_unisex", source, w * 1.5, "kw:gender_mixed_binary");
    }
  }

  const category = context.category ?? "";
  const subcategory = context.subcategory ?? "";
  if (category === "ropa_de_bebe_0_24_meses" || subcategory.includes("bebe")) {
    addScore("infantil", "name", 2.5, "cat:gender_child");
  }
  if (
    category === "vestidos" ||
    category === "lenceria_y_fajas_shapewear" ||
    (category === "ropa_interior_basica" && subcategory !== "boxer")
  ) {
    addScore("femenino", "name", 0.9, "cat:gender_feminine_prior");
  }
  if (
    category === "trajes_de_bano_y_playa" &&
    ["bikini", "vestido_de_bano_entero"].includes(subcategory)
  ) {
    addScore("femenino", "name", 0.9, "cat:gender_feminine_swim");
  }
  if (category === "trajes_de_bano_y_playa" && subcategory === "bermuda_boxer_de_bano") {
    addScore("masculino", "name", 0.7, "cat:gender_masculine_swim");
  }
  if (
    [
      "joyeria_y_bisuteria",
      "bolsos_y_marroquineria",
      "accesorios_textiles_y_medias",
      "gafas_y_optica",
      "hogar_y_lifestyle",
      "tarjeta_regalo",
    ].includes(category)
  ) {
    addScore("no_binario_unisex", "name", 0.7, "cat:gender_neutral");
  }

  const femaleScore = buckets.get("femenino")?.score ?? 0;
  const maleScore = buckets.get("masculino")?.score ?? 0;
  if (femaleScore > 0 && maleScore > 0) {
    const overlapBoost = Math.min(femaleScore, maleScore) * 0.7;
    if (overlapBoost > 0) {
      addScore("no_binario_unisex", "seo_tags", overlapBoost, "rule:gender_dual_binary_overlap");
      hasMixedBinary = true;
    }
  }

  const ranked = [...buckets.entries()].sort((a, b) => b[1].score - a[1].score);
  if (!ranked.length) {
    return {
      suggestion: null,
      sourceCount: 0,
      scoreSupport: 0,
      marginRatio: 0,
      hasExplicitUnisex,
      hasMixedBinary,
    };
  }

  const [topGender, topBucket] = ranked[0];
  const secondScore = ranked[1]?.[1].score ?? 0;
  const totalScore = ranked.reduce((acc, [, bucket]) => acc + bucket.score, 0);
  const scoreSupport = topBucket.score / Math.max(totalScore, 0.0001);
  const marginRatio = secondScore > 0 ? topBucket.score / secondScore : 99;

  let confidence =
    0.5 +
    scoreSupport * 0.32 +
    Math.min(0.12, Math.max(0, topBucket.sources.size - 1) * 0.04);
  if (marginRatio >= 1.7) confidence += 0.1;
  else if (marginRatio >= 1.4) confidence += 0.05;
  else if (marginRatio < 1.2) confidence -= 0.08;

  if (hasExplicitUnisex && topGender === "no_binario_unisex") confidence += 0.08;
  if (hasMixedBinary && topGender === "no_binario_unisex") confidence += 0.06;
  if (topBucket.reasons.has("cat:gender_child")) confidence += 0.05;

  confidence = clamp(confidence, 0.45, 0.99);

  return {
    suggestion: {
      gender: topGender,
      confidence,
      reasons: [...topBucket.reasons],
    },
    sourceCount: topBucket.sources.size,
    scoreSupport,
    marginRatio,
    hasExplicitUnisex,
    hasMixedBinary,
  };
};

const shouldAllowGenderMove = (
  currentGender: string | null,
  inference: GenderInferenceResult,
  minFillConfidence: number,
  minMoveConfidence: number,
) => {
  const suggestion = inference.suggestion;
  if (!suggestion) return false;
  const target = suggestion.gender;
  const from = currentGender;
  if (!target) return false;
  if (!from) return suggestion.confidence >= minFillConfidence;
  if (from === target) return false;

  if (from === "infantil" || target === "infantil") {
    const hasStrictChildReason = suggestion.reasons.some((reason) =>
      ["kw:gender_child_strict", "cat:gender_child"].includes(reason),
    );
    if (!from) {
      return (
        suggestion.confidence >=
        (hasStrictChildReason ? Math.max(0.86, minFillConfidence - 0.02) : minFillConfidence + 0.04)
      );
    }
    return hasStrictChildReason && suggestion.confidence >= Math.max(0.95, minMoveConfidence);
  }

  if (target === "no_binario_unisex") {
    return (
      suggestion.confidence >= minMoveConfidence - 0.03 &&
      (inference.hasExplicitUnisex || inference.hasMixedBinary || inference.sourceCount >= 2)
    );
  }

  if (from === "no_binario_unisex") {
    return (
      suggestion.confidence >= minMoveConfidence + 0.04 &&
      inference.sourceCount >= 3 &&
      inference.marginRatio >= 1.7 &&
      !inference.hasExplicitUnisex
    );
  }

  return (
    suggestion.confidence >= minMoveConfidence &&
    inference.sourceCount >= 3 &&
    inference.scoreSupport >= 0.68 &&
    inference.marginRatio >= 1.55 &&
    !inference.hasExplicitUnisex
  );
};

const extractCanonicalCategoryHintsFromSeoTags = (seoTags: string[]) =>
  dedupe(
    seoTags
      .map((tag) => normalizeTagToken(tag))
      .filter((token) => canonicalCategorySet.has(token)),
  );

const extractCanonicalSubcategoryHintsFromSeoTags = (
  seoTags: string[],
  category: string,
) => {
  const allowed = new Set((SUBCATEGORY_BY_CATEGORY[category] ?? []).map((item) => normalizeTagToken(item)));
  if (!allowed.size) return [];
  return dedupe(
    seoTags
      .map((tag) => normalizeTagToken(tag))
      .filter((token) => allowed.has(token)),
  );
};

const inferCategoryFromSources = (
  sourceTexts: Record<SourceName, string>,
  seoTags: string[],
): CategoryInferenceResult => {
  const seoCategoryHints = extractCanonicalCategoryHintsFromSeoTags(seoTags);
  const buckets = new Map<
    string,
    {
      score: number;
      reasons: Set<string>;
      sources: Set<SourceName>;
      bestSubcategory: string | null;
    }
  >();

  const addSuggestion = (source: SourceName, suggestion: Suggestion, extraReason?: string) => {
    const current = buckets.get(suggestion.category) ?? {
      score: 0,
      reasons: new Set<string>(),
      sources: new Set<SourceName>(),
      bestSubcategory: null,
    };
    current.score += CATEGORY_SOURCE_WEIGHTS[source] * suggestion.confidence;
    current.sources.add(source);
    suggestion.reasons.forEach((reason) => current.reasons.add(reason));
    current.reasons.add(`src:${source}`);
    if (extraReason) current.reasons.add(extraReason);
    if (suggestion.subcategory) current.bestSubcategory = suggestion.subcategory;
    buckets.set(suggestion.category, current);
  };

  const sources: SourceName[] = [
    "name",
    "seo_title",
    "seo_description",
    "url",
    "description",
    "original_description",
  ];
  sources.forEach((source) => {
    const text = sourceTexts[source];
    if (!text) return;
    const suggestion = inferCanonicalCategory(text);
    if (!suggestion) return;
    addSuggestion(source, suggestion);
  });

  const seoTagText = sourceTexts.seo_tags;
  if (seoTagText) {
    const seoLexicalSuggestion = inferCanonicalCategory(seoTagText);
    if (seoLexicalSuggestion) {
      const shouldSkipLexicalBecauseCanonicalAlreadyMatches =
        seoCategoryHints.length === 1 && seoCategoryHints[0] === seoLexicalSuggestion.category;
      if (shouldSkipLexicalBecauseCanonicalAlreadyMatches) {
        // Avoid double-counting SEO when it already contains a canonical category key.
        // Canonical hints are the strongest SEO signal; lexical matching is redundant here and
        // makes it harder to override wrong anchored SEO tags for misclassified products.
      } else {
      addSuggestion(
        "seo_tags",
        {
          ...seoLexicalSuggestion,
          confidence: Math.min(seoLexicalSuggestion.confidence, 0.9),
          reasons: ["seo:lexical", ...seoLexicalSuggestion.reasons],
        },
        "seo:lexical",
      );
      }
    }
  }

  if (seoCategoryHints.length === 1) {
    addSuggestion(
      "seo_tags",
      {
        category: seoCategoryHints[0],
        subcategory: null,
        confidence: 0.9,
        reasons: ["seo:canonical_category"],
        kind: "primary",
      },
      "seo:canonical_category",
    );
  }

  if (seoCategoryHints.length > 1) {
    seoCategoryHints.forEach((category) => {
      addSuggestion(
        "seo_tags",
        {
          category,
          subcategory: null,
          confidence: 0.78,
          reasons: ["seo:canonical_category_multi"],
          kind: "primary",
        },
        "seo:canonical_category_multi",
      );
    });
  }

  const ranked = [...buckets.entries()].sort((a, b) => b[1].score - a[1].score);
  if (!ranked.length) {
    return {
      suggestion: null,
      sourceCount: 0,
      scoreSupport: 0,
      marginRatio: 0,
      seoCategoryHints,
      topSources: [],
      hasNonSeoSupport: false,
    };
  }

  const [topCategory, topBucket] = ranked[0];
  const secondScore = ranked[1]?.[1].score ?? 0;
  const totalScore = ranked.reduce((acc, [, bucket]) => acc + bucket.score, 0);
  const scoreSupport = topBucket.score / Math.max(totalScore, 0.0001);
  const marginRatio = secondScore > 0 ? topBucket.score / secondScore : 99;
  let confidence =
    0.52 +
    scoreSupport * 0.3 +
    Math.min(0.12, Math.max(0, topBucket.sources.size - 1) * 0.04);
  if (marginRatio >= 1.6) confidence += 0.1;
  else if (marginRatio >= 1.3) confidence += 0.05;
  else if (marginRatio < 1.15) confidence -= 0.1;
  if (topBucket.reasons.has("seo:canonical_category")) confidence += 0.09;
  if (topBucket.reasons.has("dom:malai") || topBucket.reasons.has("kw:footwear_domain")) {
    confidence += 0.04;
  }
  confidence = clamp(confidence, 0.45, 0.99);

  return {
    suggestion: {
      category: topCategory,
      subcategory: topBucket.bestSubcategory,
      confidence,
      reasons: [...topBucket.reasons],
      kind: "primary",
    },
    sourceCount: topBucket.sources.size,
    scoreSupport,
    marginRatio,
    seoCategoryHints,
    topSources: [...topBucket.sources],
    hasNonSeoSupport: [...topBucket.sources].some((source) => source !== "seo_tags"),
  };
};

const shouldAllowCategoryMove = (
  fromCategory: string,
  inference: CategoryInferenceResult,
  minConfidence: number,
) => {
  const suggestion = inference.suggestion;
  if (!suggestion) return false;
  if (suggestion.category === fromCategory) return false;
  if (!isSafeCategoryMoveSuggestion(suggestion)) return false;
  if (suggestion.confidence < minConfidence) return false;

  const seoHints = inference.seoCategoryHints;
  const hasStrongCrossSourceEvidence =
    inference.hasNonSeoSupport &&
    inference.sourceCount >= 3 &&
    inference.scoreSupport >= 0.73 &&
    inference.marginRatio >= 1.45;
  const hasSeoContradictionOverrideReason = suggestion.reasons.some((reason) =>
    SEO_CONTRADICTION_OVERRIDE_REASONS.has(reason),
  );
  if (
    seoHints.includes(fromCategory) &&
    !seoHints.includes(suggestion.category)
  ) {
    if (!hasStrongCrossSourceEvidence) return false;
    if (!hasSeoContradictionOverrideReason) return false;
  }

  const hasDirectSeoSupport = seoHints.length === 1 && seoHints[0] === suggestion.category;

  // For canonical -> canonical moves without direct SEO canonical support,
  // keep the remapper intentionally conservative to avoid churn in already-clean catalogs.
  const exceptionalNoSeoReasons = new Set<string>([
    "dom:malai",
    "kw:footwear_domain",
    "kw:gift_card",
  ]);
  const hasExceptionalNoSeoReason = suggestion.reasons.some((reason) =>
    exceptionalNoSeoReasons.has(reason),
  );

  if (!hasDirectSeoSupport) {
    if (!hasExceptionalNoSeoReason && !hasStrongCrossSourceEvidence) return false;
    if (suggestion.confidence < Math.max(minConfidence, 0.95)) return false;
    if (inference.sourceCount < 3) return false;
    if (inference.scoreSupport < 0.72) return false;
    if (inference.marginRatio < 1.45) return false;
  }

  return true;
};

const shouldAutoApplyCategoryMove = (
  fromCategory: string | null,
  toCategory: string | null,
  categoryRule: Suggestion | null,
  inference: CategoryInferenceResult,
  minConfidence: number,
  allowSeoOnlyMoves: boolean,
) => {
  if (!toCategory || !isCanonicalCategory(toCategory)) return false;
  const confidence = categoryRule?.confidence ?? inference.suggestion?.confidence ?? 0;
  if (confidence < minConfidence) return false;

  const hasDirectSeoSupport =
    inference.seoCategoryHints.length === 1 && inference.seoCategoryHints[0] === toCategory;
  const hasConflictingSingleSeoHint =
    inference.seoCategoryHints.length === 1 &&
    fromCategory &&
    inference.seoCategoryHints[0] !== fromCategory &&
    inference.seoCategoryHints[0] !== toCategory;
  if (hasConflictingSingleSeoHint) return false;
  const hasSingleSeoHintAgainstTarget =
    inference.seoCategoryHints.length === 1 &&
    fromCategory &&
    inference.seoCategoryHints[0] === fromCategory &&
    inference.seoCategoryHints[0] !== toCategory;
  if (hasSingleSeoHintAgainstTarget) return false;

  const hasNonSeoSupport = inference.hasNonSeoSupport;
  const reasons = new Set<string>(categoryRule?.reasons ?? []);
  const hasExceptionalReason =
    reasons.has("dom:malai") ||
    reasons.has("kw:footwear_domain") ||
    reasons.has("kw:gift_card");

  if (fromCategory && fromCategory !== toCategory) {
    if (!hasNonSeoSupport && !hasExceptionalReason) {
      const allowStrongSeoOnlyMove =
        allowSeoOnlyMoves && hasDirectSeoSupport && confidence >= Math.max(minConfidence, 0.98);
      if (!allowStrongSeoOnlyMove) {
        return false;
      }
    }
    if (inference.scoreSupport < 0.7 || inference.marginRatio < 1.35) return false;
  }

  return true;
};

const SAFE_MOVE_REASONS = new Set([
  "kw:gift_card",
  "kw:beauty_strong",
  "kw:beauty_fragancia",
  "kw:beauty_care",
  "kw:home_kitchen",
  "kw:home_table",
  "kw:home_pillow",
  "kw:home_aroma",
  "kw:home_towel",
  "kw:home_blanket",
  "kw:home_art",
  "kw:home_paper",
  "kw:home_other",
  "kw:leather_care",
  "kw:keychain",
  "kw:jewelry",
  "kw:glasses",
  "kw:wallet_like",
  "kw:bags",
  "kw:footwear",
  "kw:footwear_domain",
  "kw:textile_accessory",
  "kw:uniform",
  "kw:bebe",
  "kw:swim",
  "kw:pijama",
  "kw:shapewear",
  "kw:underwear",
  "kw:sport",
  // Apparel moves (only when confidence is high and we are fixing missing/non-canonical rows).
  "kw:blouse",
  "kw:pants",
  "kw:skirt",
  "kw:vest",
  "kw:vestido",
  "kw:enterizo",
  "kw:falda",
  "kw:short",
  "kw:jean",
  "kw:jogger",
  "kw:leggings",
  "kw:pantalon",
  "kw:blazer",
  "kw:chaleco",
  "kw:chaqueta",
  "kw:buzo",
  "kw:camisa",
  "kw:polo",
  "kw:body",
  "seo:canonical_category",
  "seo:canonical_category_multi",
]);

const SEO_CONTRADICTION_OVERRIDE_REASONS = new Set([
  "kw:gift_card",
  "kw:beauty_strong",
  "kw:beauty_fragancia",
  "kw:beauty_care",
  "kw:home_kitchen",
  "kw:home_table",
  "kw:home_pillow",
  "kw:home_aroma",
  "kw:home_towel",
  "kw:home_blanket",
  "kw:home_art",
  "kw:home_paper",
  "kw:home_other",
  "kw:leather_care",
  "kw:keychain",
  "kw:wallet_like",
  "kw:underwear",
]);

function isSafeCategoryMoveSuggestion(suggestion: Suggestion) {
  // Explicitly block ambiguous jewelry signals (anillo/broche/charm without strong jewelry intent).
  if (suggestion.reasons.includes("kw:jewelry_ambiguous")) return false;
  return suggestion.reasons.some((reason) => SAFE_MOVE_REASONS.has(reason));
}

// --- Subcategory inference rules (within canonical categories) ---

type SubRule = { key: string; confidence: number; patterns: RegExp[]; reasons: string[] };

// High value + stable subset (kept in sync with audit-taxonomy.ts).
const SUBRULES: Record<string, SubRule[]> = {
  camisetas_y_tops: [
    { key: "body_bodysuit", confidence: 0.96, reasons: ["kw:body"], patterns: [wordRe("body"), wordRe("bodysuit"), wordRe("bodi"), wordRe("bodie")] },
    { key: "polo", confidence: 0.95, reasons: ["kw:polo"], patterns: [wordRe("polo"), wordRe("pique"), phraseRe("camiseta polo")] },
    { key: "henley_camiseta_con_botones", confidence: 0.94, reasons: ["kw:henley"], patterns: [wordRe("henley")] },
    { key: "top_basico_strap_top_tiras", confidence: 0.93, reasons: ["kw:strap_top"], patterns: [wordRe("strap"), wordRe("spaghetti"), phraseRe("top tiras"), phraseRe("top de tiras"), phraseRe("strap top")] },
    { key: "tank_top", confidence: 0.93, reasons: ["kw:tank_top"], patterns: [phraseRe("tank top"), wordRe("tanktop")] },
    { key: "camisilla_esqueleto_sin_mangas", confidence: 0.92, reasons: ["kw:sin_mangas"], patterns: [wordRe("camisilla"), wordRe("esqueleto"), phraseRe("sin mangas"), wordRe("sisa"), wordRe("sleeveless")] },
    { key: "crop_top", confidence: 0.9, reasons: ["kw:crop"], patterns: [wordRe("crop"), phraseRe("crop top")] },
    { key: "camiseta_cuello_alto_tortuga", confidence: 0.9, reasons: ["kw:cuello_alto"], patterns: [wordRe("tortuga"), wordRe("turtleneck"), phraseRe("cuello alto")] },
    { key: "camiseta_manga_larga", confidence: 0.9, reasons: ["kw:manga_larga"], patterns: [phraseRe("manga larga"), phraseRe("long sleeve"), wordRe("m l")] },
    // Fallback for generic "top" (no sleeve/fit signal). Useful for catalogs that label everything as "top".
    { key: "top_basico_strap_top_tiras", confidence: 0.9, reasons: ["kw:top"], patterns: [wordRe("top")] },
    { key: "camiseta_manga_corta", confidence: 0.92, reasons: ["kw:camiseta"], patterns: [phraseRe("manga corta"), phraseRe("short sleeve"), wordRe("camiseta"), wordRe("camisetas"), phraseRe("t shirt"), wordRe("tshirt"), phraseRe("t-shirt"), wordRe("tee")] },
  ],
  camisas_y_blusas: [
    { key: "guayabera", confidence: 0.96, reasons: ["kw:guayabera"], patterns: [wordRe("guayabera")] },
    { key: "camisa_denim", confidence: 0.94, reasons: ["kw:denim"], patterns: [wordRe("denim"), wordRe("jean"), phraseRe("camisa jean")] },
    { key: "camisa_de_lino", confidence: 0.94, reasons: ["kw:lino"], patterns: [wordRe("lino"), wordRe("linen")] },
    { key: "camisa_estampada", confidence: 0.9, reasons: ["kw:estampada"], patterns: [wordRe("estampada"), wordRe("print"), wordRe("printed")] },
    { key: "camisa_formal", confidence: 0.94, reasons: ["kw:formal"], patterns: [wordRe("formal"), wordRe("office"), wordRe("vestir"), wordRe("antiarrugas"), phraseRe("wrinkle free"), phraseRe("non iron")] },
    { key: "blusa_off_shoulder_hombros_descubiertos", confidence: 0.92, reasons: ["kw:off_shoulder"], patterns: [phraseRe("off shoulder"), phraseRe("hombros descubiertos"), phraseRe("escote bandeja")] },
    { key: "blusa_tipo_tunica", confidence: 0.92, reasons: ["kw:tunica"], patterns: [wordRe("tunica"), wordRe("tunika"), wordRe("bluson"), wordRe("blusones")] },
    { key: "blusa_cuello_alto", confidence: 0.9, reasons: ["kw:cuello_alto"], patterns: [phraseRe("cuello alto"), wordRe("turtleneck")] },
    { key: "blusa_manga_larga", confidence: 0.9, reasons: ["kw:manga_larga"], patterns: [phraseRe("manga larga"), phraseRe("long sleeve")] },
    { key: "blusa_manga_corta", confidence: 0.9, reasons: ["kw:manga_corta"], patterns: [phraseRe("manga corta"), phraseRe("short sleeve")] },
    // English catalogs that only use "blouse" without sleeve hints.
    { key: "blusa_manga_larga", confidence: 0.9, reasons: ["kw:blouse"], patterns: [wordRe("blouse"), wordRe("blouses")] },
    // Fallback for Spanish "blusa" when sleeve isn't specified.
    { key: "blusa_manga_larga", confidence: 0.9, reasons: ["kw:blusa"], patterns: [wordRe("blusa"), wordRe("blusas")] },
    { key: "camisa_casual", confidence: 0.92, reasons: ["kw:camisa"], patterns: [wordRe("camisa"), wordRe("camisas"), wordRe("shirt")] },
  ],
  vestidos: [
    { key: "vestido_infantil", confidence: 0.96, reasons: ["kw:infantil"], patterns: [wordRe("infantil"), wordRe("nino"), wordRe("nina"), wordRe("bebe"), wordRe("baby"), wordRe("kids")] },
    { key: "vestido_camisero", confidence: 0.95, reasons: ["kw:camisero"], patterns: [wordRe("camisero"), phraseRe("vestido camisero")] },
    { key: "vestido_sueter", confidence: 0.94, reasons: ["kw:sweater"], patterns: [wordRe("sueter"), wordRe("sweater")] },
    { key: "vestido_coctel", confidence: 0.94, reasons: ["kw:coctel"], patterns: [wordRe("coctel"), wordRe("cocktail")] },
    { key: "vestido_formal_noche", confidence: 0.93, reasons: ["kw:noche"], patterns: [wordRe("formal"), wordRe("noche"), wordRe("gala")] },
    { key: "vestido_de_fiesta", confidence: 0.92, reasons: ["kw:fiesta"], patterns: [wordRe("fiesta"), phraseRe("party dress")] },
    { key: "vestido_de_verano", confidence: 0.92, reasons: ["kw:verano"], patterns: [wordRe("verano"), phraseRe("summer dress")] },
    { key: "vestido_midi", confidence: 0.9, reasons: ["kw:midi"], patterns: [wordRe("midi")] },
    { key: "vestido_maxi", confidence: 0.9, reasons: ["kw:maxi"], patterns: [wordRe("maxi"), wordRe("largo"), wordRe("larga")] },
    { key: "vestido_mini", confidence: 0.9, reasons: ["kw:mini"], patterns: [wordRe("mini"), wordRe("corto"), wordRe("corta")] },
    { key: "vestido_casual", confidence: 0.9, reasons: ["kw:casual"], patterns: [wordRe("casual"), wordRe("dress"), wordRe("dresses"), wordRe("vestido"), wordRe("vestidos")] },
  ],
  pantalones_no_denim: [
    { key: "pantalon_chino", confidence: 0.92, reasons: ["kw:chino"], patterns: [wordRe("chino"), wordRe("chinos")] },
    { key: "pantalon_cargo", confidence: 0.92, reasons: ["kw:cargo"], patterns: [wordRe("cargo")] },
    { key: "jogger_casual", confidence: 0.92, reasons: ["kw:jogger"], patterns: [wordRe("jogger")] },
    { key: "palazzo", confidence: 0.92, reasons: ["kw:palazzo"], patterns: [wordRe("palazzo"), phraseRe("wide leg"), phraseRe("wide-leg"), phraseRe("pantalon ancho"), phraseRe("pantalones anchos")] },
    { key: "culotte", confidence: 0.92, reasons: ["kw:culotte"], patterns: [wordRe("culotte")] },
    { key: "leggings_casual", confidence: 0.9, reasons: ["kw:leggings"], patterns: [wordRe("leggins"), wordRe("legging"), wordRe("leggings")] },
    { key: "pantalon_de_lino", confidence: 0.9, reasons: ["kw:lino"], patterns: [wordRe("lino"), wordRe("linen")] },
    { key: "pantalon_de_dril", confidence: 0.9, reasons: ["kw:dril"], patterns: [wordRe("dril"), wordRe("sarga"), wordRe("twill")] },
    { key: "pantalon_skinny_no_denim", confidence: 0.9, reasons: ["kw:skinny"], patterns: [wordRe("skinny")] },
    { key: "pantalon_flare_no_denim", confidence: 0.9, reasons: ["kw:flare"], patterns: [wordRe("flare")] },
    // Catch-all for generic "pantalón/pants" listings without more detail.
    { key: "pantalon_de_dril", confidence: 0.9, reasons: ["kw:pantalon"], patterns: [wordRe("pantalon"), wordRe("pantalones"), wordRe("pants"), wordRe("pant")] },
  ],
  jeans_y_denim: [
    { key: "jean_skinny", confidence: 0.92, reasons: ["kw:skinny"], patterns: [wordRe("skinny")] },
    { key: "jean_slim", confidence: 0.92, reasons: ["kw:slim"], patterns: [wordRe("slim")] },
    { key: "jean_straight", confidence: 0.92, reasons: ["kw:straight"], patterns: [wordRe("straight")] },
    { key: "jean_wide_leg", confidence: 0.92, reasons: ["kw:wide_leg"], patterns: [phraseRe("wide leg"), phraseRe("wide-leg")] },
    { key: "jean_mom", confidence: 0.9, reasons: ["kw:mom"], patterns: [wordRe("mom")] },
    { key: "jean_boyfriend", confidence: 0.9, reasons: ["kw:boyfriend"], patterns: [wordRe("boyfriend")] },
    { key: "jean_bootcut", confidence: 0.9, reasons: ["kw:bootcut"], patterns: [wordRe("bootcut")] },
    { key: "jean_flare", confidence: 0.9, reasons: ["kw:flare"], patterns: [wordRe("flare")] },
    { key: "jean_distressed_rotos", confidence: 0.9, reasons: ["kw:distressed"], patterns: [wordRe("distressed"), wordRe("rotos"), wordRe("destroyed")] },
    { key: "jean_infantil", confidence: 0.92, reasons: ["kw:infantil"], patterns: [wordRe("infantil"), wordRe("kids"), wordRe("kid"), wordRe("nino"), wordRe("nina"), wordRe("bebe"), wordRe("baby")] },
    // Fallback when the fit isn't stated (many catalogs only say "Jean ...").
    { key: "jean_regular", confidence: 0.9, reasons: ["kw:jean"], patterns: [wordRe("jean"), wordRe("jeans")] },
  ],
  shorts_y_bermudas: [
    { key: "bermuda", confidence: 0.92, reasons: ["kw:bermuda"], patterns: [wordRe("bermuda")] },
    { key: "biker_short", confidence: 0.92, reasons: ["kw:biker"], patterns: [wordRe("biker")] },
    { key: "short_deportivo", confidence: 0.9, reasons: ["kw:deportivo"], patterns: [wordRe("deportivo"), wordRe("sport")] },
    { key: "short_denim", confidence: 0.9, reasons: ["kw:denim"], patterns: [wordRe("denim"), wordRe("jean")] },
    { key: "short_de_lino", confidence: 0.9, reasons: ["kw:lino"], patterns: [wordRe("lino"), wordRe("linen")] },
    { key: "short_cargo", confidence: 0.9, reasons: ["kw:cargo"], patterns: [wordRe("cargo")] },
    { key: "short_de_vestir", confidence: 0.92, reasons: ["kw:vestir"], patterns: [wordRe("vestir"), wordRe("tailored"), wordRe("sastre")] },
    { key: "short_infantil", confidence: 0.92, reasons: ["kw:infantil"], patterns: [wordRe("infantil"), wordRe("kids"), wordRe("kid"), wordRe("nino"), wordRe("nina")] },
    // Catch-all (when nothing else matches).
    { key: "short_casual_algodon", confidence: 0.9, reasons: ["kw:short"], patterns: [wordRe("short"), wordRe("shorts")] },
  ],
  faldas: [
    { key: "falda_short_skort", confidence: 0.92, reasons: ["kw:skort"], patterns: [wordRe("skort"), phraseRe("falda short"), phraseRe("falda-short")] },
    { key: "falda_denim", confidence: 0.9, reasons: ["kw:denim"], patterns: [wordRe("denim"), wordRe("jean")] },
    { key: "falda_plisada", confidence: 0.92, reasons: ["kw:plisada"], patterns: [wordRe("plisada"), wordRe("pleated")] },
    { key: "falda_lapiz", confidence: 0.9, reasons: ["kw:lapiz"], patterns: [wordRe("lapiz"), phraseRe("pencil")] },
    { key: "falda_cruzada_wrap", confidence: 0.9, reasons: ["kw:wrap"], patterns: [wordRe("wrap"), wordRe("cruzada")] },
    { key: "falda_skater", confidence: 0.9, reasons: ["kw:skater"], patterns: [wordRe("skater")] },
    { key: "falda_tutu_nina", confidence: 0.92, reasons: ["kw:tutu"], patterns: [wordRe("tutu"), wordRe("tutú")] },
    { key: "mini_falda", confidence: 0.92, reasons: ["kw:mini"], patterns: [wordRe("mini")] },
    { key: "falda_midi", confidence: 0.92, reasons: ["kw:midi"], patterns: [wordRe("midi")] },
    { key: "falda_maxi", confidence: 0.92, reasons: ["kw:maxi"], patterns: [wordRe("maxi")] },
    // Fallback when no length/shape is stated.
    { key: "falda_midi", confidence: 0.9, reasons: ["kw:falda"], patterns: [wordRe("falda"), wordRe("skirt")] },
  ],
  accesorios_textiles_y_medias: [
    { key: "pantimedias_medias_veladas", confidence: 0.95, reasons: ["kw:pantimedias"], patterns: [wordRe("pantimedia"), wordRe("pantimedias"), phraseRe("media velada"), wordRe("tights"), wordRe("denier")] },
    { key: "medias_calcetines", confidence: 0.92, reasons: ["kw:medias"], patterns: [wordRe("calcetin"), wordRe("calcetines"), wordRe("media"), wordRe("medias"), wordRe("sock"), wordRe("socks"), wordRe("soquete"), wordRe("soquetes")] },
    { key: "cinturones", confidence: 0.92, reasons: ["kw:cinturon"], patterns: [wordRe("cinturon"), wordRe("cinturones"), wordRe("correa"), wordRe("belt"), wordRe("hebilla")] },
    { key: "corbatas", confidence: 0.92, reasons: ["kw:corbata"], patterns: [wordRe("corbata"), phraseRe("neck tie"), wordRe("necktie")] },
    { key: "pajaritas_monos", confidence: 0.92, reasons: ["kw:pajarita"], patterns: [wordRe("pajarita"), wordRe("corbatin"), phraseRe("bow tie"), phraseRe("bowtie")] },
    { key: "bufandas", confidence: 0.92, reasons: ["kw:bufanda"], patterns: [wordRe("bufanda"), wordRe("chalina"), wordRe("scarf")] },
    { key: "panuelos_bandanas", confidence: 0.92, reasons: ["kw:bandana"], patterns: [wordRe("panuelo"), wordRe("panuelos"), wordRe("panoleta"), wordRe("bandana"), phraseRe("head scarf"), wordRe("turbante")] },
    { key: "gorras", confidence: 0.9, reasons: ["kw:gorra"], patterns: [wordRe("gorra"), wordRe("cap"), wordRe("snapback"), wordRe("trucker"), wordRe("visera")] },
    { key: "sombreros", confidence: 0.9, reasons: ["kw:sombrero"], patterns: [wordRe("sombrero"), phraseRe("bucket hat"), wordRe("fedora"), wordRe("panama")] },
    { key: "gorros_beanies", confidence: 0.9, reasons: ["kw:gorro"], patterns: [wordRe("beanie"), wordRe("balaclava"), wordRe("pasamontanas"), wordRe("gorro"), wordRe("gorros")] },
  ],
  calzado: [
    { key: "botas", confidence: 0.92, reasons: ["kw:botas"], patterns: [wordRe("botas"), wordRe("bota")] },
    { key: "botines", confidence: 0.92, reasons: ["kw:botines"], patterns: [wordRe("botin"), wordRe("botines")] },
    { key: "tenis_sneakers", confidence: 0.92, reasons: ["kw:tenis"], patterns: [wordRe("tenis"), wordRe("sneaker"), wordRe("sneakers")] },
    { key: "tenis_sneakers", confidence: 0.9, reasons: ["dom:shoes"], patterns: [wordRe("kannibalshoes")] },
    { key: "zapatos_deportivos", confidence: 0.92, reasons: ["kw:deportivo"], patterns: [wordRe("deportivo"), wordRe("sport"), wordRe("training")] },
    { key: "zapatos_formales", confidence: 0.9, reasons: ["kw:formal"], patterns: [wordRe("oxford"), wordRe("derby"), phraseRe("zapato formal"), phraseRe("zapatos formales")] },
    { key: "sandalias", confidence: 0.9, reasons: ["kw:sandalia"], patterns: [wordRe("sandalia"), wordRe("sandalias"), wordRe("sandal"), wordRe("sandals")] },
    { key: "tacones", confidence: 0.9, reasons: ["kw:tacon"], patterns: [wordRe("tacon"), wordRe("tacones"), wordRe("heel"), wordRe("heels")] },
    { key: "mocasines_loafers", confidence: 0.9, reasons: ["kw:loafers"], patterns: [wordRe("mocasin"), wordRe("mocasines"), wordRe("loafers")] },
    { key: "balerinas_flats", confidence: 0.9, reasons: ["kw:balerinas"], patterns: [wordRe("balerina"), wordRe("balerinas"), wordRe("flats")] },
    { key: "alpargatas_espadrilles", confidence: 0.9, reasons: ["kw:alpargatas"], patterns: [wordRe("alpargata"), wordRe("alpargatas"), wordRe("espadrille"), wordRe("espadrilles")] },
    { key: "zuecos", confidence: 0.9, reasons: ["kw:zuecos"], patterns: [wordRe("zueco"), wordRe("zuecos")] },
    { key: "chanclas_flip_flops", confidence: 0.9, reasons: ["kw:chanclas"], patterns: [wordRe("chancla"), wordRe("chanclas"), phraseRe("flip flop"), phraseRe("flip flops")] },
    // Generic shoes (when the catalog only says "Zapato ...").
    { key: "zapatos_formales", confidence: 0.9, reasons: ["kw:zapato"], patterns: [wordRe("zapato"), wordRe("zapatos"), wordRe("shoe"), wordRe("shoes")] },
  ],
  bolsos_y_marroquineria: [
    { key: "maletas_y_equipaje", confidence: 0.95, reasons: ["kw:maleta"], patterns: [wordRe("maleta"), wordRe("maletas"), wordRe("equipaje"), wordRe("trolley"), wordRe("luggage"), wordRe("suitcase"), wordRe("golf"), phraseRe("bolsa de golf")] },
    { key: "estuches_cartucheras_neceseres", confidence: 0.95, reasons: ["kw:cartuchera"], patterns: [wordRe("cartuchera"), wordRe("cartucheras"), wordRe("estuche"), wordRe("estuches"), wordRe("neceser"), wordRe("neceseres"), wordRe("cosmetiquera"), wordRe("pouch"), wordRe("lapicera")] },
    { key: "portadocumentos_porta_pasaporte", confidence: 0.94, reasons: ["kw:documentos"], patterns: [phraseRe("porta pasaporte"), phraseRe("porta documentos"), phraseRe("portadocumentos"), phraseRe("passport")] },
    { key: "billetera", confidence: 0.92, reasons: ["kw:billetera"], patterns: [wordRe("billetera"), wordRe("monedero"), wordRe("tarjetero"), wordRe("wallet"), wordRe("cardholder"), phraseRe("card holder"), phraseRe("money clip"), wordRe("moneyclip")] },
    { key: "bolso_tote", confidence: 0.92, reasons: ["kw:canasto"], patterns: [wordRe("canasto"), wordRe("canastos"), wordRe("basket")] },
    { key: "cartera_bolso_de_mano", confidence: 0.92, reasons: ["kw:bolsa_regalo"], patterns: [phraseRe("bolsa regalo"), phraseRe("gift bag")] },
    { key: "cartera_bolso_de_mano", confidence: 0.9, reasons: ["kw:cartera"], patterns: [wordRe("cartera"), phraseRe("bolso de mano"), wordRe("handbag"), wordRe("handbags"), wordRe("baguette"), phraseRe("market bag")] },
    { key: "mochila", confidence: 0.92, reasons: ["kw:mochila"], patterns: [wordRe("mochila")] },
    { key: "morral", confidence: 0.92, reasons: ["kw:morral"], patterns: [wordRe("morral")] },
    { key: "rinonera_canguro", confidence: 0.92, reasons: ["kw:rinonera"], patterns: [wordRe("rinonera"), wordRe("canguro")] },
    { key: "clutch_sobre", confidence: 0.92, reasons: ["kw:clutch"], patterns: [wordRe("clutch"), wordRe("sobre")] },
    { key: "bolso_tote", confidence: 0.9, reasons: ["kw:tote"], patterns: [wordRe("tote")] },
    { key: "bolso_bandolera_crossbody", confidence: 0.9, reasons: ["kw:crossbody"], patterns: [wordRe("bandolera"), wordRe("crossbody"), phraseRe("manos libres")] },
    { key: "bolso_de_viaje_duffel", confidence: 0.9, reasons: ["kw:duffel"], patterns: [wordRe("duffel"), phraseRe("bolso de viaje")] },
    // Fallback for generic "bag" when no other shape is stated.
    { key: "cartera_bolso_de_mano", confidence: 0.9, reasons: ["kw:bag"], patterns: [wordRe("bag"), wordRe("bags")] },
  ],
  ropa_interior_basica: [
    { key: "brasier", confidence: 0.94, reasons: ["kw:brasier"], patterns: [wordRe("brasier"), wordRe("bra")] },
    { key: "bralette", confidence: 0.94, reasons: ["kw:bralette"], patterns: [wordRe("bralette")] },
    { key: "panty_trusa", confidence: 0.92, reasons: ["kw:panty"], patterns: [wordRe("panty"), wordRe("trusa"), wordRe("cachetero"), wordRe("cachetera"), wordRe("culotte"), wordRe("hipster")] },
    { key: "tanga", confidence: 0.92, reasons: ["kw:tanga"], patterns: [wordRe("tanga")] },
    { key: "brasilera", confidence: 0.92, reasons: ["kw:brasilera"], patterns: [wordRe("brasilera")] },
    { key: "boxer", confidence: 0.9, reasons: ["kw:boxer"], patterns: [wordRe("boxer")] },
    { key: "brief", confidence: 0.9, reasons: ["kw:brief"], patterns: [wordRe("brief"), wordRe("briefs")] },
  ],
  lenceria_y_fajas_shapewear: [
    { key: "faja_cintura", confidence: 0.92, reasons: ["kw:faja_cintura"], patterns: [phraseRe("faja cintura"), wordRe("cinturilla")] },
    { key: "corse", confidence: 0.92, reasons: ["kw:corse"], patterns: [wordRe("corse"), wordRe("corset")] },
    { key: "liguero", confidence: 0.92, reasons: ["kw:liguero"], patterns: [wordRe("liguero")] },
  ],
  pijamas_y_ropa_de_descanso_loungewear: [
    { key: "pijama_bebe", confidence: 0.95, reasons: ["kw:bebe"], patterns: [wordRe("bebe"), wordRe("baby")] },
    { key: "pijama_infantil", confidence: 0.94, reasons: ["kw:infantil"], patterns: [wordRe("infantil"), wordRe("kids"), wordRe("kid"), wordRe("nino"), wordRe("nina")] },
    { key: "pijama_enteriza_onesie", confidence: 0.94, reasons: ["kw:onesie"], patterns: [wordRe("onesie"), wordRe("enteriza"), wordRe("enterizo")] },
    { key: "bata_robe", confidence: 0.93, reasons: ["kw:bata"], patterns: [wordRe("bata"), wordRe("robe")] },
    { key: "camison", confidence: 0.93, reasons: ["kw:camison"], patterns: [wordRe("camison"), wordRe("batola")] },
    { key: "pijama_termica", confidence: 0.93, reasons: ["kw:termica"], patterns: [wordRe("termica"), wordRe("thermal")] },
    { key: "short_pijama", confidence: 0.92, reasons: ["kw:short"], patterns: [wordRe("short"), wordRe("shorts")] },
    { key: "pantalon_pijama", confidence: 0.92, reasons: ["kw:pantalon"], patterns: [wordRe("pantalon"), wordRe("capri")] },
    { key: "set_loungewear_jogger_buzo", confidence: 0.9, reasons: ["kw:loungewear"], patterns: [wordRe("loungewear"), phraseRe("jogger"), wordRe("buzo")] },
    { key: "pijama_2_piezas", confidence: 0.9, reasons: ["kw:pijama"], patterns: [phraseRe("2 piezas"), phraseRe("dos piezas"), phraseRe("two piece"), phraseRe("two-piece")] },
  ],
  trajes_de_bano_y_playa: [
    { key: "pareo", confidence: 0.92, reasons: ["kw:pareo"], patterns: [wordRe("pareo"), wordRe("sarong")] },
    { key: "tankini", confidence: 0.9, reasons: ["kw:tankini"], patterns: [wordRe("tankini")] },
    { key: "trikini", confidence: 0.9, reasons: ["kw:trikini"], patterns: [wordRe("trikini")] },
    {
      key: "bikini",
      confidence: 0.9,
      reasons: ["kw:bikini"],
      patterns: [
        wordRe("bikini"),
        phraseRe("dos piezas"),
        phraseRe("2 piezas"),
        phraseRe("two piece"),
        phraseRe("two pieces"),
        // Malai-style bikini pieces
        wordRe("bottom"),
        wordRe("bottoms"),
        wordRe("thong"),
        wordRe("thongs"),
        phraseRe("ring bottom"),
      ],
    },
    { key: "vestido_de_bano_entero", confidence: 0.9, reasons: ["kw:one_piece"], patterns: [phraseRe("vestido de bano entero"), phraseRe("traje de bano entero"), phraseRe("one piece"), phraseRe("one-piece"), phraseRe("una pieza"), wordRe("entero"), wordRe("entera")] },
    { key: "bermuda_boxer_de_bano", confidence: 0.9, reasons: ["kw:boxer_bano"], patterns: [phraseRe("boxer de bano"), phraseRe("boxer bano"), phraseRe("bermuda de bano"), phraseRe("bermuda bano"), wordRe("boardshort"), wordRe("boardshorts")] },
    { key: "short_de_bano", confidence: 0.9, reasons: ["kw:short_bano"], patterns: [phraseRe("short de bano"), phraseRe("short bano"), phraseRe("swim short"), phraseRe("swim shorts"), wordRe("pantaloneta"), wordRe("pantalonetas"), phraseRe("short swimwear")] },
    { key: "rashguard_licra_uv", confidence: 0.9, reasons: ["kw:rashguard"], patterns: [wordRe("rashguard"), phraseRe("licra uv"), phraseRe("licra u v"), phraseRe("proteccion uv"), phraseRe("proteccion solar"), phraseRe("uv shirt")] },
    { key: "salida_de_bano_kaftan", confidence: 0.9, reasons: ["kw:coverup"], patterns: [phraseRe("salida de bano"), phraseRe("salida bano"), wordRe("kaftan"), wordRe("caftan"), wordRe("coverup"), phraseRe("beach cover")] },
    { key: "traje_de_bano_infantil", confidence: 0.9, reasons: ["kw:infantil"], patterns: [wordRe("infantil"), wordRe("nino"), wordRe("nina"), wordRe("kids"), wordRe("kid")] },
    { key: "panal_de_agua_bebe", confidence: 0.9, reasons: ["kw:panal"], patterns: [wordRe("panal"), phraseRe("panal de agua"), wordRe("bebe"), wordRe("baby")] },
  ],
  joyeria_y_bisuteria: [
    { key: "relojes", confidence: 0.96, reasons: ["kw:reloj"], patterns: [wordRe("reloj"), wordRe("relojes"), wordRe("watch"), wordRe("watches")] },
    { key: "piercings", confidence: 0.95, reasons: ["kw:piercing"], patterns: [wordRe("piercing"), wordRe("piercings"), wordRe("earcuff"), phraseRe("ear cuff")] },
    { key: "aretes_pendientes", confidence: 0.95, reasons: ["kw:aretes"], patterns: [wordRe("arete"), wordRe("aretes"), wordRe("pendiente"), wordRe("pendientes"), wordRe("candonga"), wordRe("candongas"), wordRe("topo"), wordRe("topos"), wordRe("earring"), wordRe("earrings")] },
    { key: "collares", confidence: 0.94, reasons: ["kw:collar"], patterns: [wordRe("collar"), wordRe("collares"), wordRe("gargantilla"), wordRe("cadena"), wordRe("cadenas"), wordRe("necklace"), wordRe("necklaces"), wordRe("choker"), wordRe("chokers")] },
    { key: "pulseras_brazaletes", confidence: 0.94, reasons: ["kw:pulsera"], patterns: [wordRe("pulsera"), wordRe("pulseras"), wordRe("brazalete"), wordRe("brazaletes"), wordRe("bracelet"), wordRe("bracelets"), wordRe("bangle"), wordRe("bangles")] },
    { key: "anillos", confidence: 0.94, reasons: ["kw:anillo"], patterns: [wordRe("anillo"), wordRe("anillos")] },
    { key: "tobilleras", confidence: 0.93, reasons: ["kw:tobillera"], patterns: [wordRe("tobillera"), wordRe("tobilleras"), wordRe("anklet"), wordRe("anklets")] },
    { key: "dijes_charms", confidence: 0.93, reasons: ["kw:charm"], patterns: [wordRe("dije"), wordRe("dijes"), wordRe("charm"), wordRe("charms"), wordRe("pendant"), wordRe("pendants"), wordRe("llavero"), wordRe("llaveros"), wordRe("keychain"), wordRe("keychains")] },
    { key: "broches_prendedores", confidence: 0.93, reasons: ["kw:broche"], patterns: [wordRe("broche"), wordRe("broches"), wordRe("prendedor"), wordRe("prendedores"), wordRe("pin"), wordRe("pins"), wordRe("badge"), wordRe("badges")] },
    { key: "sets_de_joyeria", confidence: 0.9, reasons: ["kw:set"], patterns: [phraseRe("set de joyeria"), phraseRe("sets de joyeria"), phraseRe("conjunto de joyeria")] },
  ],
  gafas_y_optica: [
    { key: "gafas_opticas_formuladas", confidence: 0.94, reasons: ["kw:optica"], patterns: [wordRe("optica"), wordRe("formuladas"), wordRe("formulada"), wordRe("prescripcion"), wordRe("prescription")] },
    { key: "monturas", confidence: 0.93, reasons: ["kw:montura"], patterns: [wordRe("montura"), wordRe("monturas"), wordRe("frame"), wordRe("frames")] },
    { key: "lentes_de_proteccion", confidence: 0.92, reasons: ["kw:proteccion"], patterns: [wordRe("proteccion"), wordRe("proteccion"), phraseRe("lente de proteccion"), phraseRe("safety glasses")] },
    // Default to sunglasses when it only says "gafas".
    { key: "gafas_de_sol", confidence: 0.9, reasons: ["kw:gafas"], patterns: [wordRe("gafa"), wordRe("gafas"), wordRe("sunglass"), wordRe("sunglasses")] },
  ],
  buzos_hoodies_y_sueteres: [
    { key: "hoodie_con_cremallera", confidence: 0.94, reasons: ["kw:zip"], patterns: [phraseRe("hoodie con cremallera"), phraseRe("zip hoodie"), phraseRe("hoodie zip"), phraseRe("full zip"), wordRe("fullzip")] },
    { key: "hoodie_canguro", confidence: 0.93, reasons: ["kw:hoodie"], patterns: [wordRe("hoodie"), wordRe("canguro")] },
    { key: "buzo_cuello_alto_half_zip", confidence: 0.93, reasons: ["kw:halfzip"], patterns: [phraseRe("half zip"), phraseRe("hal zip"), wordRe("halfzip"), wordRe("halzip"), wordRe("half-zip")] },
    { key: "cardigan", confidence: 0.93, reasons: ["kw:cardigan"], patterns: [wordRe("cardigan")] },
    { key: "chaleco_tejido", confidence: 0.92, reasons: ["kw:chaleco"], patterns: [wordRe("chaleco")] },
    { key: "sueter_tejido", confidence: 0.92, reasons: ["kw:sweater"], patterns: [wordRe("sueter"), wordRe("sweater"), phraseRe("tejido")] },
    { key: "buzo_polar", confidence: 0.92, reasons: ["kw:polar"], patterns: [wordRe("polar"), wordRe("fleece")] },
    { key: "ruana_poncho", confidence: 0.92, reasons: ["kw:ruana"], patterns: [wordRe("ruana"), wordRe("poncho")] },
    { key: "saco_cuello_v", confidence: 0.9, reasons: ["kw:saco"], patterns: [wordRe("saco")] },
    // Fallback
    { key: "buzo_cuello_redondo", confidence: 0.9, reasons: ["kw:buzo"], patterns: [wordRe("buzo"), wordRe("sweatshirt")] },
  ],
  chaquetas_y_abrigos: [
    { key: "chaqueta_denim", confidence: 0.95, reasons: ["kw:denim"], patterns: [wordRe("denim"), wordRe("jean")] },
    { key: "chaqueta_tipo_cuero_cuero_o_sintetico", confidence: 0.94, reasons: ["kw:cuero"], patterns: [wordRe("cuero"), phraseRe("faux leather"), phraseRe("eco leather")] },
    { key: "bomber", confidence: 0.94, reasons: ["kw:bomber"], patterns: [wordRe("bomber"), phraseRe("estilo bomber")] },
    { key: "parka", confidence: 0.93, reasons: ["kw:parka"], patterns: [wordRe("parka")] },
    { key: "rompevientos", confidence: 0.93, reasons: ["kw:rompevientos"], patterns: [wordRe("rompevientos"), wordRe("windbreaker")] },
    { key: "impermeable", confidence: 0.93, reasons: ["kw:impermeable"], patterns: [wordRe("impermeable"), wordRe("raincoat")] },
    { key: "puffer_acolchada", confidence: 0.93, reasons: ["kw:puffer"], patterns: [wordRe("puffer"), wordRe("acolchada"), wordRe("acolchado"), wordRe("down")] },
    { key: "trench_gabardina", confidence: 0.93, reasons: ["kw:trench"], patterns: [wordRe("trench"), wordRe("gabardina")] },
    { key: "abrigo_largo", confidence: 0.92, reasons: ["kw:abrigo"], patterns: [wordRe("abrigo"), phraseRe("abrigo largo"), phraseRe("chaqueta larga"), phraseRe("long coat")] },
    { key: "chaleco_acolchado", confidence: 0.92, reasons: ["kw:chaleco"], patterns: [phraseRe("chaleco acolchado"), phraseRe("puffer vest"), phraseRe("vest acolchado"), wordRe("chaleco"), wordRe("chalecos")] },
    // Catch-all: if it's still just "chaqueta".
    { key: "rompevientos", confidence: 0.9, reasons: ["kw:chaqueta"], patterns: [wordRe("chaqueta")] },
  ],
  blazers_y_sastreria: [
    { key: "smoking_tuxedo_jacket", confidence: 0.95, reasons: ["kw:smoking"], patterns: [wordRe("smoking"), wordRe("tuxedo")] },
    { key: "chaleco_de_vestir", confidence: 0.94, reasons: ["kw:chaleco"], patterns: [phraseRe("chaleco de vestir"), wordRe("waistcoat"), wordRe("vest")] },
    { key: "traje_sastre_conjunto_blazer_pantalon_falda", confidence: 0.93, reasons: ["kw:traje"], patterns: [phraseRe("traje sastre"), phraseRe("matching set"), phraseRe("conjunto sastre")] },
    { key: "pantalon_sastre", confidence: 0.92, reasons: ["kw:pantalon_sastre"], patterns: [phraseRe("pantalon sastre"), phraseRe("pantalon de vestir"), phraseRe("tailored pants")] },
    { key: "falda_sastre", confidence: 0.92, reasons: ["kw:falda_sastre"], patterns: [phraseRe("falda sastre"), phraseRe("falda de vestir")] },
    { key: "blazer_oversize", confidence: 0.92, reasons: ["kw:oversize"], patterns: [wordRe("oversize"), phraseRe("over size")] },
    { key: "blazer_entallado", confidence: 0.92, reasons: ["kw:entallado"], patterns: [wordRe("entallado"), wordRe("fitted")] },
    // Fallback
    { key: "blazer_clasico", confidence: 0.9, reasons: ["kw:blazer"], patterns: [wordRe("blazer"), wordRe("saco")] },
  ],
  enterizos_y_overoles: [
    { key: "pelele_enterizo_bebe", confidence: 0.95, reasons: ["kw:bebe"], patterns: [wordRe("pelele"), wordRe("bebe"), wordRe("baby")] },
    { key: "romper_jumpsuit_corto", confidence: 0.93, reasons: ["kw:romper"], patterns: [wordRe("romper"), phraseRe("jumpsuit corto"), phraseRe("enterizo corto")] },
    { key: "jumpsuit_largo", confidence: 0.92, reasons: ["kw:jumpsuit"], patterns: [wordRe("jumpsuit"), wordRe("jumpsit"), phraseRe("enterizo largo")] },
    { key: "overol_denim", confidence: 0.92, reasons: ["kw:denim"], patterns: [wordRe("overol"), wordRe("denim"), wordRe("jean")] },
    { key: "jardinera_overall_tipo_tiras", confidence: 0.92, reasons: ["kw:jardinera"], patterns: [wordRe("jardinera")] },
    { key: "enterizo_deportivo", confidence: 0.92, reasons: ["kw:deportivo"], patterns: [wordRe("deportivo"), wordRe("performance")] },
    { key: "enterizo_de_fiesta", confidence: 0.92, reasons: ["kw:fiesta"], patterns: [wordRe("fiesta"), wordRe("noche"), wordRe("formal")] },
    // Fallback
    { key: "jumpsuit_largo", confidence: 0.9, reasons: ["kw:enterizo"], patterns: [wordRe("enterizo")] },
  ],
  conjuntos_y_sets_2_piezas: [
    { key: "conjunto_pijama", confidence: 0.93, reasons: ["kw:pijama"], patterns: [wordRe("pijama")] },
    { key: "conjunto_deportivo_2_piezas", confidence: 0.93, reasons: ["kw:deportivo"], patterns: [wordRe("deportivo"), wordRe("performance"), wordRe("gym")] },
    { key: "set_bebe_2_3_piezas", confidence: 0.93, reasons: ["kw:bebe"], patterns: [wordRe("bebe"), wordRe("baby")] },
    { key: "set_formal_chaleco_pantalon_sastre", confidence: 0.92, reasons: ["kw:formal"], patterns: [wordRe("sastre"), wordRe("formal"), wordRe("chaleco")] },
    // Default bucket for sets without explicit composition.
    { key: "conjunto_matching_set_casual", confidence: 0.9, reasons: ["kw:set"], patterns: [wordRe("set"), wordRe("conjunto"), phraseRe("matching set")] },
  ],
  ropa_deportiva_y_performance: [
    { key: "ropa_de_compresion", confidence: 0.94, reasons: ["kw:compresion"], patterns: [wordRe("compresion"), wordRe("compression")] },
    { key: "ropa_de_running", confidence: 0.93, reasons: ["kw:running"], patterns: [wordRe("running"), phraseRe("halfzip performance"), phraseRe("half zip performance")] },
    { key: "ropa_de_ciclismo", confidence: 0.93, reasons: ["kw:ciclismo"], patterns: [wordRe("ciclismo"), wordRe("cycling")] },
    { key: "ropa_de_futbol_entrenamiento", confidence: 0.93, reasons: ["kw:futbol"], patterns: [wordRe("futbol"), wordRe("football")] },
    { key: "top_deportivo_bra_deportivo", confidence: 0.92, reasons: ["kw:top_deportivo"], patterns: [phraseRe("top deportivo"), phraseRe("bra deportivo"), wordRe("bralette")] },
    { key: "leggings_deportivos", confidence: 0.92, reasons: ["kw:leggings"], patterns: [wordRe("legging"), wordRe("leggings")] },
    { key: "shorts_deportivos", confidence: 0.92, reasons: ["kw:short"], patterns: [wordRe("short"), wordRe("shorts")] },
    { key: "sudadera_pants_deportivos", confidence: 0.92, reasons: ["kw:pants"], patterns: [wordRe("pantalon"), wordRe("pants"), wordRe("jogger")] },
    { key: "chaqueta_deportiva", confidence: 0.92, reasons: ["kw:chaqueta"], patterns: [wordRe("chaqueta"), wordRe("jacket"), wordRe("halfzip"), phraseRe("half zip")] },
    { key: "conjunto_deportivo", confidence: 0.9, reasons: ["kw:set"], patterns: [wordRe("set"), wordRe("conjunto")] },
    // Fallback
    { key: "camiseta_deportiva", confidence: 0.9, reasons: ["kw:camiseta"], patterns: [wordRe("camiseta"), phraseRe("t shirt"), wordRe("tshirt")] },
  ],
};

// For some categories, descriptions are very helpful (materials, sleeve length, "estilo bomber", etc).
// For bags/accessories, descriptions tend to include "incluye llavero/correa" and can create false positives,
// so we keep those on textLite-only.
const SUBCATEGORY_ALLOW_TEXT_FULL = new Set<string>([
  "camisetas_y_tops",
  "camisas_y_blusas",
  "buzos_hoodies_y_sueteres",
  "chaquetas_y_abrigos",
  "blazers_y_sastreria",
  "pantalones_no_denim",
  "jeans_y_denim",
  "shorts_y_bermudas",
  "faldas",
  "vestidos",
  "enterizos_y_overoles",
  "conjuntos_y_sets_2_piezas",
  "ropa_deportiva_y_performance",
  "ropa_interior_basica",
  "lenceria_y_fajas_shapewear",
  "pijamas_y_ropa_de_descanso_loungewear",
  "trajes_de_bano_y_playa",
  "calzado",
  "joyeria_y_bisuteria",
  "gafas_y_optica",
]);

const inferSubcategory = (category: string, text: string): Suggestion | null => {
  const rules = SUBRULES[category] || [];
  let best: Suggestion | null = null;
  for (const rule of rules) {
    if (!includesAny(text, rule.patterns)) continue;
    if (!best || rule.confidence > best.confidence) {
      best = {
        category,
        subcategory: rule.key,
        confidence: rule.confidence,
        reasons: rule.reasons,
        kind: "subcategory",
      };
    }
  }
  return best;
};

const inferSubcategoryFromSources = (
  category: string,
  sourceTexts: Record<SourceName, string>,
  seoTags: string[],
): Suggestion | null => {
  const seoSubcategoryHints = extractCanonicalSubcategoryHintsFromSeoTags(seoTags, category);
  if (seoSubcategoryHints.length === 1) {
    return {
      category,
      subcategory: seoSubcategoryHints[0],
      confidence: 0.98,
      reasons: ["seo:canonical_subcategory", "src:seo_tags"],
      kind: "subcategory",
    };
  }

  const buckets = new Map<
    string,
    {
      score: number;
      reasons: Set<string>;
      sources: Set<SourceName>;
      bestConfidence: number;
    }
  >();

  const allowDescriptionSources = SUBCATEGORY_ALLOW_TEXT_FULL.has(category);
  const sources: SourceName[] = [
    "name",
    "seo_tags",
    "seo_title",
    "seo_description",
    "url",
    "original_description",
    "description",
  ];

  for (const source of sources) {
    if (!allowDescriptionSources && (source === "description" || source === "original_description")) {
      continue;
    }
    const text = sourceTexts[source];
    if (!text) continue;
    const suggestion = inferSubcategory(category, text);
    if (!suggestion?.subcategory) continue;
    const bucket = buckets.get(suggestion.subcategory) ?? {
      score: 0,
      reasons: new Set<string>(),
      sources: new Set<SourceName>(),
      bestConfidence: 0,
    };
    bucket.score += SUBCATEGORY_SOURCE_WEIGHTS[source] * suggestion.confidence;
    bucket.sources.add(source);
    bucket.bestConfidence = Math.max(bucket.bestConfidence, suggestion.confidence);
    suggestion.reasons.forEach((reason) => bucket.reasons.add(reason));
    bucket.reasons.add(`src:${source}`);
    buckets.set(suggestion.subcategory, bucket);
  }

  const ranked = [...buckets.entries()].sort((a, b) => b[1].score - a[1].score);
  if (!ranked.length) return null;

  const [topSubcategory, topBucket] = ranked[0];
  const secondScore = ranked[1]?.[1].score ?? 0;
  const totalScore = ranked.reduce((acc, [, bucket]) => acc + bucket.score, 0);
  const scoreSupport = topBucket.score / Math.max(totalScore, 0.0001);
  const marginRatio = secondScore > 0 ? topBucket.score / secondScore : 99;

  let confidence =
    0.5 +
    scoreSupport * 0.28 +
    Math.min(0.1, Math.max(0, topBucket.sources.size - 1) * 0.04) +
    Math.min(0.1, topBucket.bestConfidence * 0.1);
  if (marginRatio >= 1.6) confidence += 0.06;
  else if (marginRatio < 1.15) confidence -= 0.1;
  confidence = clamp(confidence, 0.45, 0.98);

  return {
    category,
    subcategory: topSubcategory,
    confidence,
    reasons: [...topBucket.reasons],
    kind: "subcategory",
  };
};

const fallbackFromLegacy = (category: string, subcategory: string | null, text: string): Suggestion | null => {
  const cat = String(category || "").trim().toLowerCase();
  const sub = String(subcategory || "").trim().toLowerCase();

  if (cat === "tops") {
    if (sub === "camisas" || sub === "blusas") {
      return { category: "camisas_y_blusas", subcategory: null, confidence: 0.7, reasons: ["legacy:tops"], kind: "fallback" };
    }
    return { category: "camisetas_y_tops", subcategory: null, confidence: 0.7, reasons: ["legacy:tops"], kind: "fallback" };
  }

  if (cat === "bottoms") {
    if (sub === "jeans") return { category: "jeans_y_denim", subcategory: null, confidence: 0.7, reasons: ["legacy:bottoms"], kind: "fallback" };
    if (sub === "shorts") return { category: "shorts_y_bermudas", subcategory: null, confidence: 0.7, reasons: ["legacy:bottoms"], kind: "fallback" };
    if (sub === "faldas") return { category: "faldas", subcategory: null, confidence: 0.7, reasons: ["legacy:bottoms"], kind: "fallback" };
    return { category: "pantalones_no_denim", subcategory: null, confidence: 0.7, reasons: ["legacy:bottoms"], kind: "fallback" };
  }

  if (cat === "outerwear") {
    if (sub === "blazers") return { category: "blazers_y_sastreria", subcategory: null, confidence: 0.7, reasons: ["legacy:outerwear"], kind: "fallback" };
    if (sub === "buzos") return { category: "buzos_hoodies_y_sueteres", subcategory: null, confidence: 0.7, reasons: ["legacy:outerwear"], kind: "fallback" };
    if (sub === "chaquetas" || sub === "abrigos") return { category: "chaquetas_y_abrigos", subcategory: null, confidence: 0.7, reasons: ["legacy:outerwear"], kind: "fallback" };
    return { category: "chaquetas_y_abrigos", subcategory: null, confidence: 0.6, reasons: ["legacy:outerwear"], kind: "fallback" };
  }

  if (cat === "knitwear") {
    return { category: "buzos_hoodies_y_sueteres", subcategory: null, confidence: 0.7, reasons: ["legacy:knitwear"], kind: "fallback" };
  }

  if (cat === "enterizos") {
    return { category: "enterizos_y_overoles", subcategory: null, confidence: 0.7, reasons: ["legacy:enterizos"], kind: "fallback" };
  }

  if (cat === "deportivo") {
    return { category: "ropa_deportiva_y_performance", subcategory: null, confidence: 0.7, reasons: ["legacy:deportivo"], kind: "fallback" };
  }

  if (cat === "trajes_de_bano") {
    return { category: "trajes_de_bano_y_playa", subcategory: null, confidence: 0.7, reasons: ["legacy:trajes_de_bano"], kind: "fallback" };
  }

  if (cat === "ropa interior" || cat === "ropa_interior") {
    // Prefer shapewear/pijama cues if present.
    const inferred = detectApparelCategory(text);
    if (inferred && inferred.category !== "ropa_interior_basica") {
      return { ...inferred, kind: "fallback", confidence: Math.max(0.7, inferred.confidence), reasons: ["legacy:ropa_interior", ...inferred.reasons] };
    }
    return { category: "ropa_interior_basica", subcategory: null, confidence: 0.7, reasons: ["legacy:ropa_interior"], kind: "fallback" };
  }

  if (cat === "belleza") {
    return { category: "hogar_y_lifestyle", subcategory: "cuidado_personal_y_belleza", confidence: 0.99, reasons: ["legacy:belleza"], kind: "fallback" };
  }

  if (cat === "chalecos") {
    return { category: "buzos_hoodies_y_sueteres", subcategory: null, confidence: 0.6, reasons: ["legacy:chalecos"], kind: "fallback" };
  }

  if (cat === "accesorios") {
    // Last resort: eliminate the legacy bucket while keeping the item visible for manual QA.
    return { category: "hogar_y_lifestyle", subcategory: "hogar_otros", confidence: 0.4, reasons: ["legacy:accesorios_fallback"], kind: "fallback" };
  }

  // Unknown legacy bucket: keep.
  return null;
};

function isAllowedSubcategory(category: string, subcategory: string | null) {
  if (!subcategory) return true;
  const allowed = SUBCATEGORY_BY_CATEGORY[category] ?? [];
  return allowed.includes(subcategory);
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const canon = CATEGORY_VALUES;
    const canonGender = GENDER_VALUES;
    const queryParams: string[] = [];
    const buildPlaceholders = (values: string[]) =>
      values
        .map((value) => {
          queryParams.push(value);
          return `$${queryParams.length}`;
        })
        .join(",");
    // In only-mode, selection is driven by the explicit brand+name filter, so we do not need SQL candidate sets.
    const useCategoryCandidates = !genderOnly && !onlyMode;
    const needsCanonicalCategorySet = useCategoryCandidates && !allCategoryCandidates;
    const canonPlaceholders = needsCanonicalCategorySet ? buildPlaceholders(canon) : "";
    const needsGenderCanonicalSet = (includeGender || genderOnly) && !genderAllCandidates && !onlyMode;
    const genderPlaceholders = needsGenderCanonicalSet
      ? buildPlaceholders(canonGender)
      : "";
    const whereScope =
      scope === "enriched"
        ? `and (p.metadata -> 'enrichment') is not null`
        : "";

    const whereNull = useCategoryCandidates && includeNullCategory
      ? `or p.category is null or btrim(p.category) = ''`
      : "";

    const whereMissingSub = needsCanonicalCategorySet && includeMissingSubcategory
      ? `or (
          p.category is not null
          and btrim(p.category) <> ''
          and btrim(p.category) in (${canonPlaceholders})
          and (p.subcategory is null or btrim(p.subcategory) = '')
        )`
      : "";

    const whereCategoryCandidate = useCategoryCandidates
      ? allCategoryCandidates
        ? `(true)`
        : `
          (
            (p.category is not null and btrim(p.category) <> '' and btrim(p.category) not in (${canonPlaceholders}))
            ${whereNull}
            ${whereMissingSub}
          )
        `
      : `(false)`;

    const whereGenderCandidate = genderAllCandidates
      ? `(p.id is not null)`
      : `
          (
            p.gender is null
            or btrim(p.gender) = ''
            or lower(btrim(p.gender)) not in (${genderPlaceholders})
          )
        `;

    const whereCandidates = genderOnly
      ? whereGenderCandidate
      : includeGender
        ? `(${whereCategoryCandidate} or ${whereGenderCandidate})`
        : whereCategoryCandidate;

    const whereOnly = onlyMode
      ? (() => {
          const clauses: string[] = [];
          for (const entry of onlyCases) {
            queryParams.push(entry.brand);
            const brandPlaceholder = `$${queryParams.length}`;
            queryParams.push(entry.name);
            const namePlaceholder = `$${queryParams.length}`;
            clauses.push(
              `(lower(btrim(b.name)) = lower(${brandPlaceholder}::text) and lower(btrim(p.name)) = lower(${namePlaceholder}::text))`,
            );
          }
          return clauses.length ? `and (${clauses.join(" or ")})` : "";
        })()
      : "";

    const effectiveWhereCandidates = onlyMode ? `(true)` : whereCandidates;

    const appliedLimit = randomSampleSize > 0
      ? randomSampleSize
      : limit
        ? Math.max(1, Math.floor(limit))
        : 0;
    const limitClause = onlyMode ? "" : appliedLimit ? `limit ${appliedLimit}` : "";
    const orderClause =
      onlyMode ? `order by p."updatedAt" desc` : randomSampleSize > 0 ? `order by random()` : `order by p."updatedAt" desc`;

    const query = `
      select
        p.id::text as product_id,
        b.name as brand_name,
        p.name as product_name,
        p."imageCoverUrl" as image_cover_url,
        p.description as description,
        p.metadata -> 'enrichment' ->> 'original_description' as original_description,
        p."seoTitle" as seo_title,
        p."seoDescription" as seo_description,
        p."seoTags" as seo_tags,
        p.category as category,
        p.subcategory as subcategory,
        p.gender as gender,
        p."sourceUrl" as source_url,
        p."updatedAt" as updated_at,
        (p.metadata -> 'enrichment') is not null as is_enriched
      from products p
      join brands b on b.id = p."brandId"
      where ${effectiveWhereCandidates}
      ${whereScope}
      ${whereOnly}
      ${orderClause}
      ${limitClause}
    `;

    const res = await client.query<Row>(query, queryParams);
    const rows = res.rows;

    const changes: ChangeRow[] = [];
    const onlyResults: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const rawCategory = row.category ? String(row.category).trim() : "";
      const rawSubcategory = row.subcategory ? String(row.subcategory).trim() : "";

      const fromCategory = rawCategory.length ? rawCategory : null;
      const fromSubcategory = rawSubcategory.length ? rawSubcategory : null;
      const fromIsCanonical = fromCategory ? isCanonicalCategory(fromCategory) : false;
      const fromGenderRaw = row.gender ? String(row.gender).trim() : null;
      const fromGenderNormalized = normalizeGenderValue(fromGenderRaw);
      const rawGenderToken = fromGenderRaw ? normalizeTagToken(fromGenderRaw) : null;
      const fromGenderRawIsCanonical = rawGenderToken ? canonicalGenderSet.has(rawGenderToken) : false;

      const seoTags = toStringArray(row.seo_tags);
      // Two text views:
      // - `textLite`: name + URL only (safer for category moves).
      // - `textFull`: includes descriptions (LLM + original scraping) for richer signals.
      const textLite = normalizeText([row.product_name, row.source_url].filter(Boolean).join(" "));
      const textFull = normalizeText(
        [
          row.product_name,
          stripHtml(row.description),
          stripHtml(row.original_description),
          row.source_url,
        ]
          .filter(Boolean)
          .join(" "),
      );
      const sourceTexts: Record<SourceName, string> = {
        name: normalizeText(row.product_name),
        seo_tags: normalizeText(seoTags.join(" ")),
        seo_title: normalizeText(row.seo_title),
        seo_description: normalizeText(row.seo_description),
        url: normalizeText(row.source_url),
        description: normalizeText(stripHtml(row.description)),
        original_description: normalizeText(stripHtml(row.original_description)),
      };

      const primaryBySource = inferCategoryFromSources(sourceTexts, seoTags);
      const primaryLite = inferCanonicalCategory(textLite);
      const primaryFull = inferCanonicalCategory(textFull);
      const fallback = fromCategory ? fallbackFromLegacy(fromCategory, fromSubcategory, textLite) : null;

      const nameOnly = normalizeText(row.product_name);
      const looksLikeSockNamedMedia =
        (nameOnly.startsWith("media ") || nameOnly.startsWith("medias ")) &&
        !includesAny(nameOnly, [phraseRe("media bota"), phraseRe("media cana"), phraseRe("media pierna")]);
      const specialMissingCategory: Suggestion | null = looksLikeSockNamedMedia
        ? {
            category: "accesorios_textiles_y_medias",
            subcategory: null,
            confidence: 0.9,
            reasons: ["kw:media_product_name"],
            kind: "primary",
          }
        : null;

      let toCategory: string | null = fromCategory;
      let toSubcategory: string | null = fromSubcategory;
      let categoryRule: Suggestion | null = null;
      let subcategoryRule: Suggestion | null = null;
      let categoryDecision: ChangeRow["category_decision"] = "none";

      if (!genderOnly) {
        // 1) Category repair:
        // - If category is missing/non-canonical: infer it (high precision).
        // - If category is canonical but subcategory is missing: allow moving category only when the signal is very strong.
        if (!fromCategory || !fromIsCanonical) {
          const candidates = [
            specialMissingCategory,
            primaryBySource.suggestion,
            primaryLite,
            primaryFull,
            fallback,
          ]
            .filter((item): item is Suggestion => Boolean(item))
            .filter((item) => isCanonicalCategory(item.category))
            .sort((a, b) => b.confidence - a.confidence);
          const chosen = candidates[0] ?? null;
          if (!chosen) continue;
          if (chosen.confidence < minCategoryConfidence) continue;
          toCategory = chosen.category;
          toSubcategory = chosen.subcategory ?? null;
          categoryRule = chosen;
        } else if (
          primaryBySource.suggestion &&
          isCanonicalCategory(primaryBySource.suggestion.category) &&
          primaryBySource.suggestion.category !== fromCategory
        ) {
          if (
            shouldAllowCategoryMove(
              fromCategory,
              primaryBySource,
              minMoveCategoryConfidence,
            )
          ) {
            toCategory = primaryBySource.suggestion.category;
            toSubcategory = primaryBySource.suggestion.subcategory ?? null;
            categoryRule = {
              ...primaryBySource.suggestion,
              reasons: ["move:primary", ...primaryBySource.suggestion.reasons],
            };
          }
        } else if (
          primaryBySource.suggestion &&
          primaryBySource.suggestion.category === fromCategory &&
          primaryBySource.suggestion.subcategory
        ) {
          // When aggregated signals infer an in-category subcategory, use it as backfill.
          toCategory = fromCategory;
          if (!toSubcategory) {
            toSubcategory = primaryBySource.suggestion.subcategory;
            subcategoryRule = {
              ...primaryBySource.suggestion,
              reasons: ["fill_sub:source_mix", ...primaryBySource.suggestion.reasons],
              kind: "subcategory",
            };
          } else if (toSubcategory !== primaryBySource.suggestion.subcategory) {
            const hasDirectSeoSubcategoryHint = primaryBySource.suggestion.reasons.includes(
              "seo:canonical_subcategory",
            );
            const hasStrongSourceSupport =
              primaryBySource.sourceCount >= 2 &&
              primaryBySource.scoreSupport >= 0.72 &&
              primaryBySource.marginRatio >= 1.25;
            if (hasDirectSeoSubcategoryHint || hasStrongSourceSupport) {
              toSubcategory = primaryBySource.suggestion.subcategory;
              subcategoryRule = {
                ...primaryBySource.suggestion,
                confidence: Math.max(
                  primaryBySource.suggestion.confidence,
                  hasDirectSeoSubcategoryHint ? 0.95 : 0.9,
                ),
                reasons: [
                  hasDirectSeoSubcategoryHint
                    ? "move_sub:seo_canonical"
                    : "move_sub:source_mix",
                  ...primaryBySource.suggestion.reasons,
                ],
                kind: "subcategory",
              };
            }
          }
        } else if (primaryFull && primaryFull.category === fromCategory && primaryFull.subcategory) {
          // When the model inferred an in-category subcategory, use it to backfill.
          toCategory = fromCategory;
          if (!toSubcategory) {
            toSubcategory = primaryFull.subcategory;
            subcategoryRule = { ...primaryFull, reasons: ["fill_sub:primary", ...primaryFull.reasons], kind: "primary" };
          }
        }

        if (!toCategory && !(includeGender || genderOnly)) continue;

        if (toCategory) {
          // Preserve subcategory if it's already valid for the new canonical category.
          if (!toSubcategory && fromSubcategory && isAllowedSubcategory(toCategory, fromSubcategory)) {
            toSubcategory = fromSubcategory;
          }

          // If still missing/invalid, infer subcategory inside the canonical category (high precision only).
          if (!isAllowedSubcategory(toCategory, toSubcategory)) {
            toSubcategory = null;
          }
          let inferred = inferSubcategoryFromSources(toCategory, sourceTexts, seoTags);
          // Targeted correction: many catalogs use "blusa_*" as a default bucket in enrichment,
          // but the product name is explicit "camisa ...". Prefer "camisa_casual" when the *name*
          // says "camisa" and current subcategory is a blusa bucket.
          if (
            toCategory === "camisas_y_blusas" &&
            toSubcategory &&
            toSubcategory.startsWith("blusa_") &&
            includesAny(sourceTexts.name, [wordRe("camisa")]) &&
            !includesAny(sourceTexts.name, [wordRe("blusa")])
          ) {
            const inferredSub = inferred?.subcategory ?? null;
            const inferredIsCamisaFamily = inferredSub
              ? inferredSub === "guayabera" || inferredSub.startsWith("camisa_")
              : false;
            const shouldOverrideToCamisaCasual =
              !inferred || !inferredIsCamisaFamily || inferredSub === "camisa_casual";
            if (shouldOverrideToCamisaCasual) {
              inferred = {
                category: toCategory,
                subcategory: "camisa_casual",
                confidence: Math.max(inferred?.confidence ?? 0, 0.96),
                reasons: ["name:camisa_override", "src:name", ...(inferred?.reasons ?? [])],
                kind: "subcategory",
              };
            }
          }
          if (!inferred && !toSubcategory) {
            // Keep deterministic fallback for edge cases where the source mix returns null.
            inferred = inferSubcategory(toCategory, textLite);
            if (!inferred && SUBCATEGORY_ALLOW_TEXT_FULL.has(toCategory)) {
              inferred = inferSubcategory(toCategory, textFull);
              if (inferred) {
                inferred = { ...inferred, reasons: ["src:text_full", ...inferred.reasons] };
              }
            }
          }
          if (inferred && inferred.subcategory && inferred.confidence >= minSubcategoryConfidence) {
            if (isAllowedSubcategory(toCategory, inferred.subcategory)) {
              if (!toSubcategory) {
                toSubcategory = inferred.subcategory;
                subcategoryRule = inferred;
              } else if (toSubcategory !== inferred.subcategory) {
                const hasDirectSeoSubcategoryHint = inferred.reasons.includes(
                  "seo:canonical_subcategory",
                );
                const hasVeryHighConfidenceMove =
                  inferred.confidence >= Math.max(minSubcategoryConfidence, 0.95);
                const allowCamisaOverBlusaNameOverride =
                  toCategory === "camisas_y_blusas" &&
                  inferred.subcategory === "camisa_casual" &&
                  toSubcategory.startsWith("blusa_") &&
                  includesAny(sourceTexts.name, [wordRe("camisa")]) &&
                  !includesAny(sourceTexts.name, [wordRe("blusa")]);
                const hasNameOverrideMove =
                  allowCamisaOverBlusaNameOverride &&
                  inferred.confidence >= minSubcategoryConfidence;
                if (hasDirectSeoSubcategoryHint || hasVeryHighConfidenceMove || hasNameOverrideMove) {
                  toSubcategory = inferred.subcategory;
                  subcategoryRule = {
                    ...inferred,
                    confidence: Math.max(
                      inferred.confidence,
                      hasDirectSeoSubcategoryHint || hasNameOverrideMove ? 0.95 : inferred.confidence,
                    ),
                    reasons: [
                      hasDirectSeoSubcategoryHint
                        ? "move_sub:seo_canonical"
                        : hasNameOverrideMove
                          ? "move_sub:name_override"
                        : "move_sub:high_confidence",
                      ...inferred.reasons,
                    ],
                  };
                }
              }
            }
          }
        } else {
          toSubcategory = null;
        }
      }

      if (toCategory !== fromCategory && toCategory && isCanonicalCategory(toCategory)) {
        const isCanonicalMove = Boolean(fromCategory && fromCategory !== toCategory && fromIsCanonical);
        const isSeoOnlyMove =
          primaryBySource.topSources.length === 1 &&
          primaryBySource.topSources[0] === "seo_tags";
        if (isCanonicalMove && isSeoOnlyMove && !allowSeoOnlyCanonicalMoves) {
          continue;
        }
        const categoryConfidence =
          categoryRule?.confidence ?? primaryBySource.suggestion?.confidence ?? 0;
        if (categoryConfidence < minReviewCategoryConfidence) {
          continue;
        }
        if (
          shouldAutoApplyCategoryMove(
            fromCategory,
            toCategory,
            categoryRule,
            primaryBySource,
            minAutoApplyCategoryConfidence,
            allowSeoOnlyCanonicalMoves,
          )
        ) {
          categoryDecision = "auto_apply";
        } else {
          categoryDecision = "review_required";
        }
      }

      const isSubcategoryOnlyTaxonomyMove =
        fromCategory === toCategory && fromSubcategory !== toSubcategory;
      if (isSubcategoryOnlyTaxonomyMove && categoryDecision === "none") {
        const subConfidence = subcategoryRule?.confidence ?? 0;
        if (subConfidence >= minSubcategoryConfidence) {
          categoryDecision = "review_required";
        }
      }

      let toGender: string | null = fromGenderRaw;
      let genderRule: GenderSuggestion | null = null;
      let genderMoveDecision:
        | "none"
        | "alias_normalize"
        | "fill_missing"
        | "move_canonical"
        | "move_to_unisex" = "none";

      if (includeGender || genderOnly) {
        const genderInference = inferGenderFromSources(sourceTexts, {
          category: toCategory,
          subcategory: toSubcategory,
        });

        // Legacy aliases (e.g. "hombre"/"mujer") are treated as weak priors:
        // if inference has enough confidence, prefer inferred gender over alias normalization.
        const currentCanonicalForMove = fromGenderRawIsCanonical ? fromGenderNormalized : null;

        if (
          genderInference.suggestion &&
          shouldAllowGenderMove(
            currentCanonicalForMove,
            genderInference,
            minGenderConfidence,
            minMoveGenderConfidence,
          )
        ) {
          const nextGender = genderInference.suggestion.gender;
          const currentCanonical = currentCanonicalForMove;
          toGender = nextGender;
          genderRule = {
            gender: nextGender,
            confidence: genderInference.suggestion.confidence,
            reasons: genderInference.suggestion.reasons,
          };
          if (!currentCanonical) {
            genderMoveDecision = "fill_missing";
          } else if (nextGender === "no_binario_unisex") {
            genderMoveDecision = "move_to_unisex";
          } else {
            genderMoveDecision = "move_canonical";
          }
        } else if (!fromGenderRawIsCanonical && fromGenderNormalized) {
          toGender = fromGenderNormalized;
          genderRule = {
            gender: fromGenderNormalized,
            confidence: 1,
            reasons: ["norm:gender_alias"],
          };
          genderMoveDecision = "alias_normalize";
        }
      }

      const changedCategoryOrSub =
        fromCategory !== toCategory || fromSubcategory !== toSubcategory;
      const changedGender = (includeGender || genderOnly) && (fromGenderRaw ?? null) !== (toGender ?? null);
      const changed = changedCategoryOrSub || changedGender;

      const combinedReasons = Array.from(
        new Set(
          [
            ...(categoryRule?.reasons ?? []),
            ...(subcategoryRule?.reasons ?? []),
            ...(genderRule?.reasons ?? []),
          ].filter(Boolean),
        ),
      );
      const confidenceCandidates = [
        categoryRule?.confidence,
        subcategoryRule?.confidence,
        genderRule?.confidence,
      ].filter((value): value is number => typeof value === "number");
      const combinedConfidence = confidenceCandidates.length
        ? Math.min(...confidenceCandidates)
        : 1;
      const combinedKind: Suggestion["kind"] = categoryRule
        ? categoryRule.kind
        : subcategoryRule
          ? subcategoryRule.kind
          : "fallback";
      const combined: Suggestion | null = toCategory
        ? {
            category: toCategory,
            subcategory: toSubcategory,
            confidence: combinedConfidence,
            reasons: combinedReasons,
            kind: combinedKind,
          }
        : null;
      if (onlyMode) {
        onlyResults.push({
          product_id: row.product_id,
          brand_name: row.brand_name,
          product_name: row.product_name,
          is_enriched: row.is_enriched,
          from_category: fromCategory,
          from_subcategory: fromSubcategory,
          from_gender: fromGenderRaw,
          inference: primaryBySource.suggestion
            ? {
                category: primaryBySource.suggestion.category,
                subcategory: primaryBySource.suggestion.subcategory,
                confidence: primaryBySource.suggestion.confidence,
                reasons: primaryBySource.suggestion.reasons,
              }
            : null,
          inference_metrics: {
            source_count: primaryBySource.sourceCount,
            score_support: Number(primaryBySource.scoreSupport.toFixed(3)),
            margin_ratio:
              primaryBySource.marginRatio > 98
                ? 99
                : Number(primaryBySource.marginRatio.toFixed(3)),
            top_sources: primaryBySource.topSources,
            seo_category_hints: primaryBySource.seoCategoryHints,
            has_non_seo_support: primaryBySource.hasNonSeoSupport,
          },
          to_category: toCategory,
          to_subcategory: toSubcategory,
          to_gender: toGender,
          taxonomy_changed: changedCategoryOrSub,
          gender_changed: changedGender,
          category_decision: categoryDecision,
          gender_decision: genderMoveDecision,
          combined_confidence: combinedConfidence,
          reasons: combinedReasons,
          would_enqueue_review: changed && (changedGender || categoryDecision === "review_required"),
          would_auto_apply: changed && categoryDecision === "auto_apply",
        });
      }
      if (!changed) continue;

      changes.push({
        product_id: row.product_id,
        brand_name: row.brand_name,
        product_name: row.product_name,
        image_cover_url: row.image_cover_url,
        source_url: row.source_url,
        updated_at: row.updated_at,
        is_enriched: row.is_enriched,
        from_category: fromCategory,
        from_subcategory: fromSubcategory,
        to_category: toCategory,
        to_subcategory: toSubcategory,
        from_gender: fromGenderRaw,
        to_gender: toGender,
        confidence: combined?.confidence ?? combinedConfidence,
        kind: combined?.kind ?? combinedKind,
        reasons: combinedReasons.join("|"),
        seo_category_hints: primaryBySource.seoCategoryHints.join("|"),
        source_count: primaryBySource.sourceCount,
        score_support: Number(primaryBySource.scoreSupport.toFixed(3)),
        margin_ratio:
          primaryBySource.marginRatio > 98
            ? 99
            : Number(primaryBySource.marginRatio.toFixed(3)),
        gender_confidence: genderRule ? Number(genderRule.confidence.toFixed(3)) : null,
        category_decision: categoryDecision,
        gender_decision: genderMoveDecision,
        taxonomy_changed: changedCategoryOrSub,
        gender_changed: changedGender,
        _rule: combined,
        _genderRule: genderRule,
      });
    }

    if (onlyMode) {
      const expectedKeys = onlyCases.map((entry) => `${normalizeText(entry.brand)}|${normalizeText(entry.name)}`);
      const foundKeys = new Set(
        rows.map((row) => `${normalizeText(row.brand_name)}|${normalizeText(row.product_name)}`),
      );
      const missing = expectedKeys
        .filter((key) => !foundKeys.has(key))
        .map((key) => {
          const [brand, name] = key.split("|");
          return { brand, name };
        });

      console.log(
        JSON.stringify(
          {
            ok: true,
            onlyMode: true,
            scope,
            includeGender: includeGender || genderOnly,
            totalRequested: onlyCases.length,
            totalFound: rows.length,
            missing,
            results: onlyResults,
          },
          null,
          2,
        ),
      );
      return;
    }

    const byFromTo = new Map<string, number>();
    for (const change of changes) {
      const key = `${change.from_category ?? "__NULL__"} -> ${change.to_category}`;
      byFromTo.set(key, (byFromTo.get(key) ?? 0) + 1);
    }
    const byGenderFromTo = new Map<string, number>();
    let genderChangesCount = 0;
    let genderAliasNormalizations = 0;
    let genderMoveToUnisex = 0;
    const autoApplyTaxonomy = changes.filter(
      (change) => change.taxonomy_changed && change.category_decision === "auto_apply",
    ).length;
    const reviewTaxonomy = changes.filter(
      (change) => change.taxonomy_changed && change.category_decision === "review_required",
    ).length;
    for (const change of changes) {
      if (!change.gender_changed) continue;
      genderChangesCount += 1;
      const key = `${change.from_gender ?? "__NULL__"} -> ${change.to_gender ?? "__NULL__"}`;
      byGenderFromTo.set(key, (byGenderFromTo.get(key) ?? 0) + 1);
      if (change.gender_decision === "alias_normalize") genderAliasNormalizations += 1;
      if (change.gender_decision === "move_to_unisex") genderMoveToUnisex += 1;
    }

    const md: string[] = [];
    md.push(`# Reparacion de taxonomia (enriched): remap + backfill`);
    md.push("");
    md.push(`- Run: \`${runKey}\``);
    md.push(`- Apply: **${apply ? "YES" : "NO"}**`);
    md.push(`- Scope: \`${scope}\``);
    md.push(`- Include gender: **${includeGender || genderOnly ? "YES" : "NO"}**`);
    md.push(`- Gender only mode: **${genderOnly ? "YES" : "NO"}**`);
    md.push(`- Gender all candidates: **${genderAllCandidates ? "YES" : "NO"}**`);
    md.push(`- Random sample size: **${randomSampleSize > 0 ? randomSampleSize : 0}**`);
    md.push(`- Include NULL category: **${includeNullCategory ? "YES" : "NO"}**`);
    md.push(`- Include missing subcategory: **${includeMissingSubcategory ? "YES" : "NO"}**`);
    md.push(`- All category candidates: **${allCategoryCandidates ? "YES" : "NO"}**`);
    md.push(`- Min category confidence: **${minCategoryConfidence}**`);
    md.push(`- Min move-category confidence: **${minMoveCategoryConfidence}**`);
    md.push(`- Min review-category confidence: **${minReviewCategoryConfidence}**`);
    md.push(`- Min auto-apply category confidence: **${minAutoApplyCategoryConfidence}**`);
    md.push(`- Allow SEO-only canonical moves: **${allowSeoOnlyCanonicalMoves ? "YES" : "NO"}**`);
    md.push(`- Enqueue review queue: **${enqueueReview ? "YES" : "NO"}**`);
    md.push(`- Enqueue includes auto_apply: **${enqueueReviewIncludeAuto ? "YES" : "NO"}**`);
    md.push(`- Enqueue source: **${enqueueReviewSource}**`);
    md.push(`- Min subcategory confidence: **${minSubcategoryConfidence}**`);
    md.push(`- Min gender confidence: **${minGenderConfidence}**`);
    md.push(`- Min move-gender confidence: **${minMoveGenderConfidence}**`);
    md.push(`- Productos candidatos: **${rows.length}**`);
    md.push(`- Cambios propuestos: **${changes.length}**`);
    md.push(`- Cambios taxonomía auto-apply: **${autoApplyTaxonomy}**`);
    md.push(`- Cambios taxonomía para revisión: **${reviewTaxonomy}**`);
    md.push(`- Cambios de género propuestos: **${genderChangesCount}**`);
    md.push(`- Alias de género normalizados: **${genderAliasNormalizations}**`);
    md.push(`- Movimientos hacia unisex: **${genderMoveToUnisex}**`);
    md.push("");

    md.push(`## Top remaps (from -> to)`);
    md.push("");
    md.push(`| from -> to | count |`);
    md.push(`|---|---:|`);
    for (const [key, count] of [...byFromTo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
      md.push(`| \`${key}\` | ${count} |`);
    }
    md.push("");

    if (includeGender || genderOnly) {
      md.push(`## Top remaps de género (from -> to)`);
      md.push("");
      md.push(`| from -> to | count |`);
      md.push(`|---|---:|`);
      for (const [key, count] of [...byGenderFromTo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
        md.push(`| \`${key}\` | ${count} |`);
      }
      md.push("");
    }

    let subsetEvalSummary: Record<string, unknown> | null = null;
    if (evaluateSubsets) {
      const evalCanonPlaceholders = canon.map((_, index) => `$${index + 1}`).join(",");
      const evalQuery = `
        select
          p.id::text as product_id,
          b.name as brand_name,
          p.name as product_name,
          p."imageCoverUrl" as image_cover_url,
          p.description as description,
          p.metadata -> 'enrichment' ->> 'original_description' as original_description,
          p."seoTitle" as seo_title,
          p."seoDescription" as seo_description,
          p."seoTags" as seo_tags,
          p.category as category,
          p.subcategory as subcategory,
          p.gender as gender,
          p."sourceUrl" as source_url,
          p."updatedAt" as updated_at,
          (p.metadata -> 'enrichment') is not null as is_enriched
        from products p
        join brands b on b.id = p."brandId"
        where
          (p.metadata -> 'enrichment') is not null
          and p.category is not null
          and btrim(p.category) in (${evalCanonPlaceholders})
      `;
      const evalRes = await client.query<Row>(evalQuery, canon);
      const evalRows = evalRes.rows;

      const buildTexts = (row: Row) => {
        const seoTags = toStringArray(row.seo_tags);
        const sourceTexts: Record<SourceName, string> = {
          name: normalizeText(row.product_name),
          seo_tags: normalizeText(seoTags.join(" ")),
          seo_title: normalizeText(row.seo_title),
          seo_description: normalizeText(row.seo_description),
          url: normalizeText(row.source_url),
          description: normalizeText(stripHtml(row.description)),
          original_description: normalizeText(stripHtml(row.original_description)),
        };
        return { seoTags, sourceTexts };
      };

      const categoryConsensusRows = evalRows.filter((row) => {
        const seoTags = toStringArray(row.seo_tags);
        return extractCanonicalCategoryHintsFromSeoTags(seoTags).length === 1;
      });
      const sampledCategory = stableSample(
        categoryConsensusRows,
        `${evalSeed}:category`,
        evalSamplePerSubset,
      );
      let categoryCorrect = 0;
      for (const row of sampledCategory) {
        const { seoTags, sourceTexts } = buildTexts(row);
        const expected = extractCanonicalCategoryHintsFromSeoTags(seoTags)[0] ?? null;
        const inferred = inferCategoryFromSources(sourceTexts, seoTags);
        const predicted =
          inferred.suggestion?.category ??
          (row.category ? normalizeTagToken(row.category) : null);
        if (expected && predicted === expected) categoryCorrect += 1;
      }

      const subcategoryConsensusRows = evalRows.filter((row) => {
        if (!row.category || !isCanonicalCategory(row.category)) return false;
        const seoTags = toStringArray(row.seo_tags);
        const categoryHints = extractCanonicalCategoryHintsFromSeoTags(seoTags);
        if (categoryHints.length !== 1 || categoryHints[0] !== row.category) return false;
        const subHints = extractCanonicalSubcategoryHintsFromSeoTags(seoTags, row.category);
        return subHints.length === 1;
      });
      const sampledSubcategory = stableSample(
        subcategoryConsensusRows,
        `${evalSeed}:subcategory`,
        evalSamplePerSubset,
      );
      let subcategoryCorrect = 0;
      for (const row of sampledSubcategory) {
        if (!row.category) continue;
        const { seoTags, sourceTexts } = buildTexts(row);
        const expected = extractCanonicalSubcategoryHintsFromSeoTags(seoTags, row.category)[0] ?? null;
        const inferred = inferSubcategoryFromSources(row.category, sourceTexts, seoTags);
        const predicted = inferred?.subcategory ?? row.subcategory ?? null;
        if (expected && predicted === expected) subcategoryCorrect += 1;
      }

      const ambiguousKeyword = /\b(topo|topos|top|charm|broche|colonia|colonias|llavero|keychain|bikini top|ring|gafas)\b/i;
      const adversarialRows = evalRows.filter((row) => {
        const text = normalizeText(
          [row.product_name, row.seo_title, row.seo_description, ...(toStringArray(row.seo_tags))]
            .filter(Boolean)
            .join(" "),
        );
        return ambiguousKeyword.test(text);
      });
      const sampledAdversarial = stableSample(
        adversarialRows,
        `${evalSeed}:adversarial`,
        evalSamplePerSubset,
      );
      let adversarialAnchored = 0;
      let adversarialUnsafeMoves = 0;
      for (const row of sampledAdversarial) {
        if (!row.category || !isCanonicalCategory(row.category)) continue;
        const { seoTags, sourceTexts } = buildTexts(row);
        const categoryHints = extractCanonicalCategoryHintsFromSeoTags(seoTags);
        if (!categoryHints.includes(row.category)) continue;
        adversarialAnchored += 1;
        const inferred = inferCategoryFromSources(sourceTexts, seoTags);
        const allowedMove = shouldAllowCategoryMove(
          row.category,
          inferred,
          minMoveCategoryConfidence,
        );
        const targetCategory = inferred.suggestion?.category ?? row.category;
        if (allowedMove && !categoryHints.includes(targetCategory)) {
          adversarialUnsafeMoves += 1;
        }
      }

      const heuristicOnlyRows = evalRows.filter((row) => {
        if (!row.category || !isCanonicalCategory(row.category)) return false;
        const seoTags = toStringArray(row.seo_tags);
        return extractCanonicalCategoryHintsFromSeoTags(seoTags).length === 0;
      });
      const sampledHeuristicOnly = stableSample(
        heuristicOnlyRows,
        `${evalSeed}:heuristic_only`,
        evalSamplePerSubset,
      );
      let heuristicStable = 0;
      const heuristicUnstableExamples: Array<Record<string, unknown>> = [];
      for (const row of sampledHeuristicOnly) {
        if (!row.category) continue;
        const { seoTags, sourceTexts } = buildTexts(row);
        const inferred = inferCategoryFromSources(sourceTexts, seoTags);
        const moved = shouldAllowCategoryMove(row.category, inferred, minMoveCategoryConfidence);
        const finalCategory = moved ? inferred.suggestion?.category ?? row.category : row.category;
        if (finalCategory === row.category) {
          heuristicStable += 1;
          continue;
        }
        if (heuristicUnstableExamples.length < 150) {
          heuristicUnstableExamples.push({
            product_id: row.product_id,
            brand_name: row.brand_name,
            product_name: row.product_name,
            current_category: row.category,
            inferred_category: inferred.suggestion?.category ?? null,
            inferred_subcategory: inferred.suggestion?.subcategory ?? null,
            reasons: inferred.suggestion?.reasons ?? [],
            confidence: inferred.suggestion?.confidence ?? null,
            source_count: inferred.sourceCount,
            score_support: Number(inferred.scoreSupport.toFixed(4)),
            margin_ratio:
              inferred.marginRatio > 98 ? 99 : Number(inferred.marginRatio.toFixed(4)),
            source_url: row.source_url,
            seo_tags: seoTags,
          });
        }
      }

      const categoryAccuracy =
        sampledCategory.length > 0 ? categoryCorrect / sampledCategory.length : 0;
      const subcategoryAccuracy =
        sampledSubcategory.length > 0 ? subcategoryCorrect / sampledSubcategory.length : 0;
      const categoryLower = wilsonLowerBound(categoryCorrect, sampledCategory.length);
      const subcategoryLower = wilsonLowerBound(subcategoryCorrect, sampledSubcategory.length);
      const adversarialSafety =
        adversarialAnchored > 0
          ? 1 - adversarialUnsafeMoves / adversarialAnchored
          : 1;
      const heuristicStability =
        sampledHeuristicOnly.length > 0
          ? heuristicStable / sampledHeuristicOnly.length
          : 1;
      const heuristicLower = wilsonLowerBound(heuristicStable, sampledHeuristicOnly.length);
      const gate98 =
        categoryLower >= 0.98 &&
        subcategoryLower >= 0.98 &&
        adversarialSafety >= 0.98 &&
        heuristicLower >= 0.98;

      subsetEvalSummary = {
        seed: evalSeed,
        sample_per_subset: evalSamplePerSubset,
        evaluated_at: new Date().toISOString(),
        totals: {
          eval_rows: evalRows.length,
          category_consensus_rows: categoryConsensusRows.length,
          subcategory_consensus_rows: subcategoryConsensusRows.length,
          adversarial_rows: adversarialRows.length,
        },
        category_subset: {
          sample: sampledCategory.length,
          correct: categoryCorrect,
          accuracy: Number(categoryAccuracy.toFixed(4)),
          wilson95_lower: Number(categoryLower.toFixed(4)),
        },
        subcategory_subset: {
          sample: sampledSubcategory.length,
          correct: subcategoryCorrect,
          accuracy: Number(subcategoryAccuracy.toFixed(4)),
          wilson95_lower: Number(subcategoryLower.toFixed(4)),
        },
        adversarial_subset: {
          sample: sampledAdversarial.length,
          anchored_sample: adversarialAnchored,
          unsafe_moves: adversarialUnsafeMoves,
          safety_rate: Number(adversarialSafety.toFixed(4)),
        },
        heuristic_only_subset: {
          sample: sampledHeuristicOnly.length,
          stable: heuristicStable,
          stability_rate: Number(heuristicStability.toFixed(4)),
          wilson95_lower: Number(heuristicLower.toFixed(4)),
        },
        gate_98_pass: gate98,
      };

      if (!noSaveReport) {
        fs.writeFileSync(
          path.join(outDir, "subset_eval.json"),
          JSON.stringify(subsetEvalSummary, null, 2) + "\n",
          "utf8",
        );
        fs.writeFileSync(
          path.join(outDir, "subset_heuristic_unstable_examples.json"),
          JSON.stringify(heuristicUnstableExamples, null, 2) + "\n",
          "utf8",
        );
      }

      md.push(`## Evaluación por Subsets`);
      md.push("");
      md.push(`- Seed: \`${evalSeed}\``);
      md.push(`- Sample por subset: **${evalSamplePerSubset}**`);
      md.push(
        `- Categoría (consenso SEO): **${categoryCorrect}/${sampledCategory.length}** | LB95=${categoryLower.toFixed(4)}`,
      );
      md.push(
        `- Subcategoría (consenso SEO): **${subcategoryCorrect}/${sampledSubcategory.length}** | LB95=${subcategoryLower.toFixed(4)}`,
      );
      md.push(
        `- Safety adversarial (sin moves inseguros): **${(adversarialSafety * 100).toFixed(2)}%** (${adversarialUnsafeMoves} inseguros / ${adversarialAnchored} anclados)`,
      );
      md.push(
        `- Heurístico sin tag canónico (no-move stability): **${heuristicStable}/${sampledHeuristicOnly.length}** | LB95=${heuristicLower.toFixed(4)}`,
      );
      md.push(`- Gate 98%: **${gate98 ? "PASS" : "FAIL"}**`);
      md.push("");
    }

    if (!noSaveReport) {
      md.push("## Archivos");
      md.push("");
      md.push(`- ${path.relative(repoRoot, path.join(outDir, "report.md"))}`);
      md.push(`- ${path.relative(repoRoot, path.join(outDir, "eligible_changes.csv"))}`);
      md.push(`- ${path.relative(repoRoot, path.join(outDir, "auto_apply_changes.csv"))}`);
      md.push(`- ${path.relative(repoRoot, path.join(outDir, "review_changes.csv"))}`);
      md.push(`- ${path.relative(repoRoot, path.join(outDir, "summary.json"))}`);
      if (evaluateSubsets) {
        md.push(`- ${path.relative(repoRoot, path.join(outDir, "subset_eval.json"))}`);
        md.push(
          `- ${path.relative(
            repoRoot,
            path.join(outDir, "subset_heuristic_unstable_examples.json"),
          )}`,
        );
      }
    }
    if (!noSaveReport) {
      fs.writeFileSync(path.join(outDir, "report.md"), md.join("\n") + "\n", "utf8");
    }

    const csvRows = changes.map((change) => {
      const { _rule, _genderRule, ...rest } = change;
      void _rule;
      void _genderRule;
      return rest;
    });
    if (!noSaveReport) {
      writeCsv(
        path.join(outDir, "eligible_changes.csv"),
        csvRows,
        [
          "product_id",
          "brand_name",
          "product_name",
          "image_cover_url",
          "source_url",
          "updated_at",
          "is_enriched",
          "from_category",
          "from_subcategory",
          "to_category",
          "to_subcategory",
          "from_gender",
          "to_gender",
          "confidence",
          "gender_confidence",
          "kind",
          "reasons",
          "seo_category_hints",
          "source_count",
          "score_support",
          "margin_ratio",
          "category_decision",
          "gender_decision",
          "taxonomy_changed",
          "gender_changed",
        ],
      );
      const reviewRows = csvRows.filter(
        (row) =>
          row.taxonomy_changed === true && row.category_decision === "review_required",
      );
      writeCsv(
        path.join(outDir, "review_changes.csv"),
        reviewRows,
        [
          "product_id",
          "brand_name",
          "product_name",
          "image_cover_url",
          "source_url",
          "from_category",
          "to_category",
          "from_subcategory",
          "to_subcategory",
          "confidence",
          "reasons",
          "seo_category_hints",
          "source_count",
          "score_support",
          "margin_ratio",
          "category_decision",
        ],
      );
      const autoRows = csvRows.filter(
        (row) =>
          row.taxonomy_changed === true && row.category_decision === "auto_apply",
      );
      writeCsv(
        path.join(outDir, "auto_apply_changes.csv"),
        autoRows,
        [
          "product_id",
          "brand_name",
          "product_name",
          "image_cover_url",
          "source_url",
          "from_category",
          "to_category",
          "from_subcategory",
          "to_subcategory",
          "confidence",
          "reasons",
          "seo_category_hints",
          "source_count",
          "score_support",
          "margin_ratio",
          "category_decision",
        ],
      );
    }

    let enqueuedReviewCount = 0;
    if (enqueueReview && changes.length > 0) {
      const reviewCandidates = changes.filter((change) => {
        if (!change.taxonomy_changed && !change.gender_changed) return false;
        if (enqueueReviewIncludeAuto) return true;
        if (change.taxonomy_changed && change.category_decision !== "review_required") return false;
        return true;
      });

      if (reviewCandidates.length > 0) {
        for (let i = 0; i < reviewCandidates.length; i += chunkSize) {
          const chunk = reviewCandidates.slice(i, i + chunkSize);
          const productIds = chunk.map((change) => change.product_id);
          await client.query(
            `
              DELETE FROM "taxonomy_remap_reviews"
              WHERE "status" = 'pending'
                AND "productId" = ANY($1::text[])
            `,
            [productIds],
          );

          for (const change of chunk) {
            await client.query(
              `
                INSERT INTO "taxonomy_remap_reviews" (
                  "id",
                  "status",
                  "source",
                  "runKey",
                  "productId",
                  "fromCategory",
                  "fromSubcategory",
                  "fromGender",
                  "toCategory",
                  "toSubcategory",
                  "toGender",
                  "confidence",
                  "reasons",
                  "seoCategoryHints",
                  "sourceCount",
                  "scoreSupport",
                  "marginRatio",
                  "imageCoverUrl",
                  "sourceUrl",
                  "createdAt",
                  "updatedAt"
                )
                VALUES (
                  $1,
                  'pending',
                  $2,
                  $3,
                  $4,
                  $5,
                  $6,
                  $7,
                  $8,
                  $9,
                  $10,
                  $11,
                  $12::text[],
                  $13::text[],
                  $14,
                  $15,
                  $16,
                  $17,
                  $18,
                  NOW(),
                  NOW()
                )
              `,
              [
                crypto.randomUUID(),
                enqueueReviewSource,
                runKey,
                change.product_id,
                change.from_category,
                change.from_subcategory,
                change.from_gender,
                change.to_category,
                change.to_subcategory,
                change.to_gender,
                change.confidence,
                String(change.reasons || "")
                  .split("|")
                  .map((entry) => entry.trim())
                  .filter(Boolean),
                String(change.seo_category_hints || "")
                  .split("|")
                  .map((entry) => entry.trim())
                  .filter(Boolean),
                Number.isFinite(change.source_count) ? change.source_count : null,
                Number.isFinite(change.score_support) ? change.score_support : null,
                Number.isFinite(change.margin_ratio) ? change.margin_ratio : null,
                change.image_cover_url ?? null,
                change.source_url ?? null,
              ],
            );
          }
          enqueuedReviewCount += chunk.length;
        }
      }
    }
    if (enqueueReview) {
      md.push(`- Filas encoladas para revisión: **${enqueuedReviewCount}**`);
    }

    const summaryPayload = {
      run: runKey,
      apply,
      scope,
      includeGender,
      genderOnly,
      genderAllCandidates,
      randomSampleSize,
      includeNullCategory,
      includeMissingSubcategory,
      allCategoryCandidates,
      minCategoryConfidence,
      minMoveCategoryConfidence,
      minReviewCategoryConfidence,
      minAutoApplyCategoryConfidence,
      allowSeoOnlyCanonicalMoves,
      enqueueReview,
      enqueueReviewIncludeAuto,
      enqueueReviewSource,
      minSubcategoryConfidence,
      minGenderConfidence,
      minMoveGenderConfidence,
      scanned: rows.length,
      proposed_changes: changes.length,
      taxonomy_auto_apply_changes: autoApplyTaxonomy,
      taxonomy_review_required_changes: reviewTaxonomy,
      enqueued_review_rows: enqueuedReviewCount,
      gender_changes: genderChangesCount,
      gender_alias_normalizations: genderAliasNormalizations,
      gender_move_to_unisex: genderMoveToUnisex,
      top_remaps: [...byFromTo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50),
      top_gender_remaps: [...byGenderFromTo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50),
      subset_evaluation: subsetEvalSummary,
    };
    if (!noSaveReport) {
      fs.writeFileSync(
        path.join(outDir, "summary.json"),
        JSON.stringify(summaryPayload, null, 2) + "\n",
        "utf8",
      );
    } else {
      console.log("[taxonomy_remap] summary");
      console.log(JSON.stringify(summaryPayload, null, 2));
      console.log("[taxonomy_remap] sample changes (first 15)");
      console.log(
        JSON.stringify(
          csvRows.slice(0, 15).map((row) => ({
            product_id: row.product_id,
            product_name: row.product_name,
            image_cover_url: row.image_cover_url,
            from_category: row.from_category,
            to_category: row.to_category,
            from_subcategory: row.from_subcategory,
            to_subcategory: row.to_subcategory,
            from_gender: row.from_gender,
            to_gender: row.to_gender,
            confidence: row.confidence,
            category_decision: row.category_decision,
            gender_confidence: row.gender_confidence,
            gender_decision: row.gender_decision,
            reasons: row.reasons,
          })),
          null,
          2,
        ),
      );
    }

    const applyableChanges = changes.filter((change) => {
      if (!change.taxonomy_changed) return true;
      return change.category_decision === "auto_apply";
    });

    if (!apply || applyableChanges.length === 0) {
      if (noSaveReport) {
        console.log("[taxonomy_remap] dry-run completed (no report files written).");
      } else {
        console.log(`[taxonomy_remap] dry-run report written: ${outDir}`);
      }
      return;
    }

    const applied: typeof changes = [];
    const failed: Array<Record<string, unknown>> = [];

    const patchVersion = `taxonomy_remap_noncanonical_v1_${runKey}`;

    for (let i = 0; i < applyableChanges.length; i += chunkSize) {
      const chunk = applyableChanges.slice(i, i + chunkSize);
      for (const change of chunk) {
        try {
          const patch = {
            rule_version: patchVersion,
            applied_at: new Date().toISOString(),
            from: {
              category: change.from_category ?? null,
              subcategory: change.from_subcategory ?? null,
              gender: change.from_gender ?? null,
            },
            to: {
              category: change.to_category ?? null,
              subcategory: change.to_subcategory ?? null,
              gender: change.to_gender ?? null,
            },
            confidence: change.confidence,
            kind: change.kind,
            reasons: String(change.reasons || "").split("|").filter(Boolean),
          };

          if (includeGender || genderOnly) {
            await client.query(
              `
                update products
                set
                  category = $1,
                  subcategory = $2,
                  gender = $3,
                  metadata = jsonb_set(
                    case when jsonb_typeof(metadata) = 'object' then metadata else '{}'::jsonb end,
                    '{taxonomy_remap}',
                    $4::jsonb,
                    true
                  ),
                  "updatedAt" = now()
                where id = $5
              `,
              [
                change.to_category,
                change.to_subcategory,
                change.to_gender,
                JSON.stringify(patch),
                change.product_id,
              ],
            );
          } else {
            await client.query(
              `
                update products
                set
                  category = $1,
                  subcategory = $2,
                  metadata = jsonb_set(
                    case when jsonb_typeof(metadata) = 'object' then metadata else '{}'::jsonb end,
                    '{taxonomy_remap}',
                    $3::jsonb,
                    true
                  ),
                  "updatedAt" = now()
                where id = $4
              `,
              [
                change.to_category,
                change.to_subcategory,
                JSON.stringify(patch),
                change.product_id,
              ],
            );
          }

          applied.push(change);
        } catch (err) {
          failed.push({
            ...change,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    if (!noSaveReport) {
      fs.writeFileSync(
        path.join(outDir, "apply_summary.json"),
        JSON.stringify({ ok: failed.length === 0, applied: applied.length, failed: failed.length, failed_samples: failed.slice(0, 20) }, null, 2) + "\n",
        "utf8",
      );
    }

    console.log(
      `[taxonomy_remap] applied=${applied.length} failed=${failed.length} report=${
        noSaveReport ? "none" : outDir
      }`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
