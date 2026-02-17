import path from "node:path";
import fs from "node:fs/promises";

type ReportEntry = {
  subcategory: string;
  topFrequentTerms: Array<{ term: string; count: number }>;
  topFrequentBigrams: Array<{ term: string; count: number }>;
  topDisambiguationTerms: Array<{ term: string; count: number; score: number }>;
};

type ReportPayload = {
  reports: ReportEntry[];
};

type SignalEntry = {
  subcategory: string;
  category: string | null;
  core: string[];
  disambiguators: string[];
};

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const NOISE_TOKENS = new Set([
  "span",
  "style",
  "div",
  "class",
  "data",
  "href",
  "src",
  "img",
  "http",
  "https",
  "www",
  "com",
  "xml",
  "xmlns",
  "utf",
  "charset",
  "font",
  "family",
  "sans",
  "serif",
  "mso",
  "px",
  "rem",
  "rgb",
]);

const isUsefulToken = (token: string) => {
  if (!token || token.length < 2) return false;
  if (NOISE_TOKENS.has(token)) return false;
  if (/^\d+$/.test(token)) return false;
  if (/^[a-f0-9]{10,}$/i.test(token)) return false;
  return true;
};

const normalizeCandidateTerm = (term: string) => {
  const normalized = normalizeText(term);
  if (!normalized) return "";
  const tokens = normalized.split(" ").map((token) => token.trim()).filter(Boolean);
  if (!tokens.length || tokens.length > 5) return "";
  if (tokens.some((token) => !isUsefulToken(token))) return "";
  return tokens.join(" ");
};

const toUnique = (values: string[]) => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const normalized = normalizeCandidateTerm(raw);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

const buildSlugFallbackTerms = (subcategory: string, category: string | null) => {
  const subTokens = normalizeText(subcategory)
    .split(" ")
    .filter((token) => token.length >= 3);
  const catTokens = normalizeText(category ?? "")
    .split(" ")
    .filter((token) => token.length >= 4);
  return toUnique([
    subcategory.replace(/_/g, " "),
    ...subTokens,
    ...(category ? [category.replace(/_/g, " ")] : []),
    ...catTokens,
  ]);
};

const parseInlineTerms = (line: string) => {
  const termsFromBackticks = [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
  if (termsFromBackticks.length > 0) return termsFromBackticks;
  const idx = line.indexOf(":");
  if (idx < 0) return [];
  return line
    .slice(idx + 1)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const parseSignalsMarkdown = (markdown: string): SignalEntry[] => {
  const lines = markdown.split(/\r?\n/);
  const entries: SignalEntry[] = [];
  let current: SignalEntry | null = null;

  const flush = () => {
    if (!current) return;
    entries.push(current);
    current = null;
  };

  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    const heading = line.match(/^##\s+([a-z0-9_]+)\s*$/i);
    if (heading) {
      flush();
      current = {
        subcategory: heading[1].trim(),
        category: null,
        core: [],
        disambiguators: [],
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("- Categoria:")) {
      current.category = parseInlineTerms(line)[0] ?? null;
      continue;
    }
    if (line.startsWith("- Senales nucleo")) {
      current.core = parseInlineTerms(line);
      continue;
    }
    if (line.startsWith("- Desambiguadores")) {
      current.disambiguators = parseInlineTerms(line);
      continue;
    }
  }
  flush();
  return entries.filter((entry) => entry.subcategory.length > 0);
};

const findLatestAnalysisJson = async (reportsDir: string) => {
  const files = await fs.readdir(reportsDir);
  const candidates = files
    .filter((name) => name.startsWith("taxonomy_remap_title_description_terms_") && name.endsWith(".json"))
    .sort();
  if (!candidates.length) {
    throw new Error(`No analysis report found in ${reportsDir}`);
  }
  return path.join(reportsDir, candidates[candidates.length - 1]);
};

const buildPriorsFromSignals = (entries: SignalEntry[]) => {
  const priors: Record<string, string[]> = {};
  for (const entry of entries) {
    const curated = toUnique([...entry.core, ...entry.disambiguators]);
    const fallback = buildSlugFallbackTerms(entry.subcategory, entry.category);
    const merged = toUnique([...curated, ...fallback]).slice(0, 6);
    if (merged.length > 0) {
      priors[entry.subcategory] = merged;
    }
  }
  return priors;
};

const buildPriorsFromReport = (payload: ReportPayload) => {
  const reports = Array.isArray(payload.reports) ? payload.reports : [];
  const priors: Record<string, string[]> = {};
  for (const entry of reports) {
    const subcategory = String(entry.subcategory ?? "").trim();
    if (!subcategory) continue;
    const merged = toUnique([
      ...(Array.isArray(entry.topDisambiguationTerms) ? entry.topDisambiguationTerms.slice(0, 6).map((item) => item.term) : []),
      ...(Array.isArray(entry.topFrequentTerms) ? entry.topFrequentTerms.slice(0, 4).map((item) => item.term) : []),
      ...(Array.isArray(entry.topFrequentBigrams) ? entry.topFrequentBigrams.slice(0, 2).map((item) => item.term) : []),
    ]).slice(0, 6);
    if (merged.length > 0) {
      priors[subcategory] = merged;
    }
  }
  return priors;
};

const main = async () => {
  const root = path.resolve(process.cwd(), "..", "..");
  const reportsDir = path.join(root, "reports");
  const defaultSignalsPath = path.join(root, "SIGNALS.md");

  const explicitSignalsPath = process.env.REMAP_SIGNALS_PATH
    ? path.resolve(process.env.REMAP_SIGNALS_PATH)
    : null;
  const signalsPath = explicitSignalsPath ?? defaultSignalsPath;
  const signalsExists = await fs
    .access(signalsPath)
    .then(() => true)
    .catch(() => false);

  let priors: Record<string, string[]> = {};
  let sourceLabel = "";
  let inputPath = "";

  if (signalsExists) {
    inputPath = signalsPath;
    const raw = await fs.readFile(inputPath, "utf8");
    priors = buildPriorsFromSignals(parseSignalsMarkdown(raw));
    sourceLabel = `signals:${path.basename(inputPath)}`;
  } else {
    inputPath = process.env.REMAP_TERM_REPORT_PATH
      ? path.resolve(process.env.REMAP_TERM_REPORT_PATH)
      : await findLatestAnalysisJson(reportsDir);
    const raw = await fs.readFile(inputPath, "utf8");
    priors = buildPriorsFromReport(JSON.parse(raw) as ReportPayload);
    sourceLabel = `report:${path.basename(inputPath)}`;
  }

  const outPath = path.join(
    root,
    "apps",
    "web",
    "src",
    "lib",
    "taxonomy-remap",
    "subcategory-term-priors.generated.ts",
  );
  const generatedAt = new Date().toISOString();
  const sortedPriors: Record<string, string[]> = {};
  for (const key of Object.keys(priors).sort((a, b) => a.localeCompare(b))) {
    sortedPriors[key] = priors[key];
  }
  const fileContent = `// AUTO-GENERATED FILE. DO NOT EDIT MANUALLY.
// Generated at: ${generatedAt}
// Source: ${sourceLabel}

export const SUBCATEGORY_TERM_PRIORS: Record<string, string[]> = ${JSON.stringify(sortedPriors, null, 2)} as const;
`;

  await fs.writeFile(outPath, fileContent, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        inputPath,
        source: sourceLabel,
        outPath,
        subcategoriesWithPriors: Object.keys(sortedPriors).length,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
