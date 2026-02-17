import fs from "node:fs/promises";
import path from "node:path";
import * as constantsModule from "../src/lib/product-enrichment/constants";
import * as dictionariesModule from "../src/lib/product-enrichment/keyword-dictionaries";

type ReportEntry = {
  subcategory: string;
  docs: number;
  topFrequentTerms: Array<{ term: string; count: number }>;
  topFrequentBigrams: Array<{ term: string; count: number }>;
  topDisambiguationTerms: Array<{ term: string; count: number; score: number }>;
};

type ReportPayload = {
  generatedAt: string;
  sampleSizePerSubcategory: number;
  totalSubcategories: number;
  totalSampledDocs: number;
  reports: ReportEntry[];
};

type CandidateSource = "freq" | "bigram" | "disamb";

type CandidateMeta = {
  term: string;
  score: number;
  sources: Set<CandidateSource>;
};

type SubcategoryKeywordRule = {
  category: string;
  subcategory: string;
  keywords: string[];
};

const constantsExports = (
  (constantsModule as unknown as { default?: Record<string, unknown> }).default ??
  (constantsModule as unknown as Record<string, unknown>)
) as Record<string, unknown>;
const dictionariesExports = (
  (dictionariesModule as unknown as { default?: Record<string, unknown> }).default ??
  (dictionariesModule as unknown as Record<string, unknown>)
) as Record<string, unknown>;

const SUBCATEGORY_BY_CATEGORY = (constantsExports.SUBCATEGORY_BY_CATEGORY ?? {}) as Record<
  string,
  string[]
>;
const SUBCATEGORY_KEYWORD_RULES = (dictionariesExports.SUBCATEGORY_KEYWORD_RULES ??
  []) as SubcategoryKeywordRule[];
let GLOBAL_KEYWORD_TOKEN_SET = new Set<string>();

const REPORT_PREFIX = "taxonomy_remap_title_description_terms_";

const CONNECTOR_STOPWORDS = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "y",
  "e",
  "o",
  "u",
  "con",
  "sin",
  "para",
  "por",
  "en",
  "un",
  "una",
  "unos",
  "unas",
]);

const GENERIC_NOISE_TERMS = new Set([
  "diseno",
  "diseño",
  "casual",
  "elegante",
  "moderno",
  "moderna",
  "clasico",
  "clasica",
  "tono",
  "detall",
  "detalle",
  "alta calidad",
  "calidad",
  "comodidad",
  "confort",
  "material",
  "materiales",
  "pieza",
  "estilo",
  "envio",
  "garantia",
  "producto",
  "productos",
  "articulo",
  "articulos",
  "objeto",
  "usar",
  "uso",
  "perfecto",
  "perfecta",
  "ideal",
  "negro",
  "blanco",
  "rojo",
  "azul",
  "verde",
  "dorado",
  "plateado",
]);

const ACTION_NOISE_TOKENS = new Set([
  "haz",
  "compralo",
  "compra",
  "transforma",
  "deben",
  "recibir",
  "incluye",
  "incluyen",
  "puede",
  "pueden",
  "fue",
  "ser",
  "tiempo",
  "elaboracion",
  "elaborado",
  "elaborada",
]);

const JEWELRY_METAL_TOKENS = new Set([
  "oro",
  "gold",
  "silver",
  "plata",
  "bronce",
  "chapado",
  "chapada",
  "banado",
  "banada",
  "plated",
]);

const TERM_POLISH_MAP: Record<string, string> = {
  decoraticvo: "decorativo",
  scrunchi: "scrunchie",
  aret: "arete",
  billet: "billetera",
  viaj: "viaje",
  halfzip: "half zip",
  totebag: "tote bag",
};

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const singularizeToken = (token: string) => {
  if (token.length > 5 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
};

GLOBAL_KEYWORD_TOKEN_SET = new Set(
  SUBCATEGORY_KEYWORD_RULES.flatMap((rule) =>
    rule.keywords
      .map((keyword) => normalizeText(keyword))
      .flatMap((keyword) =>
        keyword
          .split(" ")
          .map((token) => token.trim())
          .filter((token) => token.length >= 3)
          .map(singularizeToken),
      ),
  ),
);

const toStemSet = (value: string) =>
  new Set(
    normalizeText(value)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
      .filter((token) => !CONNECTOR_STOPWORDS.has(token))
      .map(singularizeToken),
  );

const canonicalTerm = (value: string) =>
  normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .map(singularizeToken)
    .join(" ");

const isLowSignalGarbage = (term: string) => {
  if (!term) return true;
  if (term.length < 3) return true;
  if (term.split(" ").length > 5) return true;
  if (/^\d+$/.test(term)) return true;
  const digitCount = (term.match(/\d/g) ?? []).length;
  if (digitCount >= 2) return true;
  if (/^[a-f0-9]{8,}$/i.test(term)) return true;
  return false;
};

const isActionLikePhrase = (term: string) => {
  const tokens = normalizeText(term).split(" ").filter(Boolean);
  if (!tokens.length) return false;
  return ACTION_NOISE_TOKENS.has(tokens[0]);
};

const keywordMatchLevel = (term: string, keywords: string[]) => {
  if (!keywords.length) return 0;
  if (keywords.includes(term)) return 2;
  for (const keyword of keywords) {
    if (keyword.includes(term) || term.includes(keyword)) return 1;
  }
  return 0;
};

const anchorLevel = (term: string, slugPhrase: string, slugStemSet: Set<string>) => {
  if (!term) return 0;
  if (term === slugPhrase) return 2;
  if (term.includes(slugPhrase) || slugPhrase.includes(term)) return 2;
  const termStems = toStemSet(term);
  for (const stem of termStems) {
    if (slugStemSet.has(stem)) return 1;
  }
  return 0;
};

const isNearDuplicate = (term: string, selected: string[]) => {
  const canonical = canonicalTerm(term);
  if (!canonical) return true;
  for (const current of selected) {
    const existing = canonicalTerm(current);
    if (!existing) continue;
    if (canonical === existing) return true;
  }
  return false;
};

const polishTerm = (term: string) => {
  const normalized = normalizeText(term);
  if (!normalized) return "";
  const mapped = TERM_POLISH_MAP[normalized] ?? normalized;
  const tokens = mapped.split(" ").filter(Boolean);
  if (tokens.length >= 2 && tokens.every((token) => token === tokens[0])) {
    return tokens[0];
  }
  return mapped;
};

const finalizeTermList = (
  base: string[],
  reserve: string[],
  subcategory: string,
  category: string,
  limit: number,
) => {
  const output: string[] = [];
  const addCandidate = (raw: string) => {
    const polished = polishTerm(raw);
    if (!polished) return;
    if (isNearDuplicate(polished, output)) return;
    output.push(polished);
  };
  for (const term of base) {
    if (output.length >= limit) break;
    addCandidate(term);
  }
  for (const term of reserve) {
    if (output.length >= limit) break;
    addCandidate(term);
  }
  const fallback = [
    ...buildSlugFallbackTerms(subcategory),
    ...buildCategoryFallbackTerms(category),
    subcategory.replace(/_/g, " "),
    category.replace(/_/g, " "),
  ];
  for (const term of fallback) {
    if (output.length >= limit) break;
    addCandidate(term);
  }
  return output.slice(0, limit);
};

const pickTopUnique = (
  terms: Array<{ term: string; score: number }>,
  limit: number,
  initial: string[] = [],
) => {
  const output = [...initial];
  for (const candidate of terms) {
    if (output.length >= limit) break;
    if (isNearDuplicate(candidate.term, output)) continue;
    output.push(candidate.term);
  }
  return output.slice(0, limit);
};

const buildSlugFallbackTerms = (subcategory: string) => {
  const slugPhrase = subcategory.replace(/_/g, " ");
  const tokens = slugPhrase
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !CONNECTOR_STOPWORDS.has(token));
  const singularTokens = tokens.map(singularizeToken);
  return [...new Set([slugPhrase, ...tokens, ...singularTokens])].filter(Boolean);
};

const buildCategoryFallbackTerms = (category: string) => {
  const categoryPhrase = category.replace(/_/g, " ");
  const tokens = categoryPhrase
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !CONNECTOR_STOPWORDS.has(token));
  const singularTokens = tokens.map(singularizeToken);
  return [...new Set([categoryPhrase, ...tokens, ...singularTokens])].filter(Boolean);
};

const buildSyntheticTermsFromSubcategory = (subcategory: string, seed: string) => {
  const slugTokens = buildSlugFallbackTerms(subcategory)
    .flatMap((term) => term.split(" "))
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !CONNECTOR_STOPWORDS.has(token));
  const output: string[] = [];
  const normalizedSeed = normalizeText(seed);
  for (const token of slugTokens) {
    if (!token || normalizedSeed.includes(token)) continue;
    output.push(`${seed} ${token}`);
  }
  return [...new Set(output)];
};

const buildSubcategoryLookup = () => {
  const lookup = new Map<string, string>();
  for (const [category, subcategories] of Object.entries(SUBCATEGORY_BY_CATEGORY)) {
    for (const subcategory of subcategories) {
      lookup.set(subcategory, category);
    }
  }
  return lookup;
};

const buildKeywordLookup = () => {
  const lookup = new Map<string, string[]>();
  for (const rule of SUBCATEGORY_KEYWORD_RULES) {
    const normalizedKeywords = rule.keywords
      .map((keyword) => normalizeText(keyword))
      .filter(Boolean)
      .filter((keyword) => !isLowSignalGarbage(keyword));
    const current = lookup.get(rule.subcategory) ?? [];
    lookup.set(rule.subcategory, [...new Set([...current, ...normalizedKeywords])]);
  }
  return lookup;
};

const findLatestReport = async (reportsDir: string) => {
  const files = await fs.readdir(reportsDir);
  const candidates = files
    .filter((name) => name.startsWith(REPORT_PREFIX) && name.endsWith(".json"))
    .sort();
  if (!candidates.length) {
    throw new Error(`No ${REPORT_PREFIX}*.json files found in ${reportsDir}`);
  }
  return path.join(reportsDir, candidates[candidates.length - 1]);
};

const scoreCandidate = (
  params: {
    source: CandidateSource;
    term: string;
    baseScore: number;
    category: string;
  },
  context: {
    keywords: string[];
    slugPhrase: string;
    slugStemSet: Set<string>;
  },
) => {
  const normalized = normalizeText(params.term);
  if (!normalized) return null;
  const keywordLevel = keywordMatchLevel(normalized, context.keywords);
  const slugLevel = anchorLevel(normalized, context.slugPhrase, context.slugStemSet);
  const wordCount = normalized.split(" ").filter(Boolean).length;
  const tokens = normalized.split(" ").filter(Boolean);
  const isExactKeyword = context.keywords.includes(normalized);
  const unknownTokens = tokens.filter((token) => {
    const stem = singularizeToken(token);
    return !GLOBAL_KEYWORD_TOKEN_SET.has(stem) && !context.slugStemSet.has(stem);
  });
  if (wordCount > 3) return null;
  if (isLowSignalGarbage(normalized) && keywordLevel === 0 && slugLevel === 0) return null;
  if (GENERIC_NOISE_TERMS.has(normalized) && keywordLevel < 2 && slugLevel === 0) return null;
  if (isActionLikePhrase(normalized) && keywordLevel < 2) return null;
  if (keywordLevel === 0 && slugLevel === 0) return null;
  if (
    params.category !== "joyeria_y_bisuteria" &&
    tokens.some((token) => JEWELRY_METAL_TOKENS.has(singularizeToken(token)))
  ) {
    return null;
  }
  if (unknownTokens.length > 0) {
    if (wordCount >= 2 && !isExactKeyword && keywordLevel < 2) return null;
    if (wordCount === 1 && keywordLevel === 0 && slugLevel === 0) return null;
  }

  let score = params.baseScore;
  if (keywordLevel === 2) score += 130;
  else if (keywordLevel === 1) score += 70;
  if (slugLevel === 2) score += 90;
  else if (slugLevel === 1) score += 45;
  if (normalized.includes(" ")) score += 10;
  if (params.source === "disamb" && (keywordLevel > 0 || slugLevel > 0)) score += 20;
  if (GENERIC_NOISE_TERMS.has(normalized)) score -= 8;
  if (unknownTokens.length) score -= unknownTokens.length * 16;
  if (score <= 0) return null;

  return {
    term: normalized,
    score,
    keywordLevel,
    slugLevel,
  };
};

const main = async () => {
  const repoRoot = path.resolve(process.cwd(), "..", "..");
  const reportsDir = path.join(repoRoot, "reports");
  const reportPath = process.env.REMAP_TERM_REPORT_PATH
    ? path.resolve(process.env.REMAP_TERM_REPORT_PATH)
    : await findLatestReport(reportsDir);

  const raw = await fs.readFile(reportPath, "utf8");
  const report = JSON.parse(raw) as ReportPayload;
  const subcategoryToCategory = buildSubcategoryLookup();
  const subcategoryKeywords = buildKeywordLookup();

  const markdownLines: string[] = [];
  markdownLines.push("# SIGNALS · Curacion para Taxonomy Remap");
  markdownLines.push("");
  markdownLines.push(
    "Documento de revision manual. Contiene 3 senales nucleo y 3 desambiguadores por subcategoria.",
  );
  markdownLines.push("");
  markdownLines.push(`- Fuente: \`${path.basename(reportPath)}\``);
  markdownLines.push(`- Generado de fuente: ${report.generatedAt}`);
  markdownLines.push(`- Subcategorias: ${report.totalSubcategories}`);
  markdownLines.push(`- Documentos muestreados: ${report.totalSampledDocs}`);
  markdownLines.push("");
  markdownLines.push("## Criterio de curacion");
  markdownLines.push("");
  markdownLines.push(
    "- Se priorizan terminos que aparezcan en title+description y que coincidan con la taxonomia de keywords por subcategoria.",
  );
  markdownLines.push(
    "- Se penalizan o excluyen tokens de ruido (HTML, codigos, marcas internas, terminos demasiado genericos).",
  );
  markdownLines.push(
    "- Los desambiguadores se enfocan en separar subcategorias cercanas y reducir empates del remap.",
  );
  markdownLines.push("");

  const sortedEntries = [...report.reports].sort((a, b) => a.subcategory.localeCompare(b.subcategory));

  for (const entry of sortedEntries) {
    const subcategory = String(entry.subcategory ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
    if (!subcategory) continue;
    const category = subcategoryToCategory.get(subcategory) ?? "desconocida";
    const keywords = subcategoryKeywords.get(subcategory) ?? [];
    const slugPhrase = subcategory.replace(/_/g, " ");
    const slugStemSet = toStemSet(slugPhrase);

    const candidates = new Map<string, CandidateMeta>();
    const add = (term: string, score: number, source: CandidateSource) => {
      const current = candidates.get(term);
      if (current) {
        current.score += score;
        current.sources.add(source);
        return;
      }
      candidates.set(term, { term, score, sources: new Set([source]) });
    };

    for (const item of entry.topFrequentTerms ?? []) {
      const scored = scoreCandidate(
        {
          source: "freq",
          term: item.term,
          baseScore: Math.max(1, Number(item.count ?? 0) * 1.1),
          category,
        },
        { keywords, slugPhrase, slugStemSet },
      );
      if (!scored) continue;
      add(scored.term, scored.score, "freq");
    }

    for (const item of entry.topFrequentBigrams ?? []) {
      const scored = scoreCandidate(
        {
          source: "bigram",
          term: item.term,
          baseScore: Math.max(1, Number(item.count ?? 0) * 1.45 + 4),
          category,
        },
        { keywords, slugPhrase, slugStemSet },
      );
      if (!scored) continue;
      add(scored.term, scored.score, "bigram");
    }

    for (const item of entry.topDisambiguationTerms ?? []) {
      const scored = scoreCandidate(
        {
          source: "disamb",
          term: item.term,
          baseScore: Math.max(
            1,
            Number(item.score ?? 0) * 2 + Number(item.count ?? 0) * 0.65,
          ),
          category,
        },
        { keywords, slugPhrase, slugStemSet },
      );
      if (!scored) continue;
      add(scored.term, scored.score, "disamb");
    }

    const rankedAll = [...candidates.values()]
      .sort((a, b) => {
        const diff = b.score - a.score;
        if (diff !== 0) return diff;
        return a.term.localeCompare(b.term);
      })
      .map((entryMeta) => ({ term: entryMeta.term, score: entryMeta.score }));

    const rankedPhrases = rankedAll.filter((item) => item.term.includes(" "));
    const primarySeed = rankedPhrases.length ? [rankedPhrases[0].term] : [];
    const primary = pickTopUnique(rankedAll, 3, primarySeed);

    if (primary.length < 3) {
      const fallbackKeywords = keywords
        .filter((term) => term.length >= 3)
        .filter((term) => !GENERIC_NOISE_TERMS.has(term))
        .filter((term) => !isActionLikePhrase(term))
        .sort((a, b) => {
          const phraseDiff = Number(b.includes(" ")) - Number(a.includes(" "));
          if (phraseDiff !== 0) return phraseDiff;
          const aSlug = anchorLevel(a, slugPhrase, slugStemSet);
          const bSlug = anchorLevel(b, slugPhrase, slugStemSet);
          if (bSlug !== aSlug) return bSlug - aSlug;
          const aKw = keywordMatchLevel(a, keywords);
          const bKw = keywordMatchLevel(b, keywords);
          if (bKw !== aKw) return bKw - aKw;
          return a.localeCompare(b);
        })
        .map((term) => ({ term, score: 0 }));
      primary.push(...pickTopUnique(fallbackKeywords, 3, primary).slice(primary.length));
    }
    if (primary.length < 3) {
      const slugFallback = buildSlugFallbackTerms(subcategory).map((term) => ({
        term,
        score: 0,
      }));
      primary.push(...pickTopUnique(slugFallback, 3, primary).slice(primary.length));
    }
    if (primary.length < 3) {
      const hardFallback = [
        ...new Set([
          subcategory.replace(/_/g, " "),
          ...keywords,
          ...buildSlugFallbackTerms(subcategory),
        ]),
      ];
      for (const term of hardFallback) {
        if (primary.length >= 3) break;
        if (isNearDuplicate(term, primary)) continue;
        primary.push(term);
      }
    }
    if (primary.length < 3) {
      const seed = primary[0] ?? subcategory.replace(/_/g, " ");
      for (const term of buildSyntheticTermsFromSubcategory(subcategory, seed)) {
        if (primary.length >= 3) break;
        if (isNearDuplicate(term, primary)) continue;
        primary.push(term);
      }
    }
    if (primary.length < 3) {
      for (const token of buildSlugFallbackTerms(subcategory)) {
        if (primary.length >= 3) break;
        if (isNearDuplicate(token, primary)) continue;
        primary.push(token);
      }
    }
    if (primary.length < 3) {
      for (const token of buildCategoryFallbackTerms(category)) {
        if (primary.length >= 3) break;
        if (isNearDuplicate(token, primary)) continue;
        primary.push(token);
      }
    }

    const disambiguators = pickTopUnique(
      rankedAll
        .filter((item) => !isNearDuplicate(item.term, primary))
        .filter((item) => !isActionLikePhrase(item.term)),
      3,
      [],
    );

    if (disambiguators.length < 3) {
      const fallbackDisamb = keywords
        .filter((term) => !isNearDuplicate(term, primary))
        .filter((term) => !isNearDuplicate(term, disambiguators))
        .filter((term) => term.length >= 3)
        .filter((term) => !GENERIC_NOISE_TERMS.has(term))
        .filter((term) => !isActionLikePhrase(term))
        .sort((a, b) => {
          const phraseDiff = Number(b.includes(" ")) - Number(a.includes(" "));
          if (phraseDiff !== 0) return phraseDiff;
          const aKw = keywordMatchLevel(a, keywords);
          const bKw = keywordMatchLevel(b, keywords);
          if (bKw !== aKw) return bKw - aKw;
          return a.localeCompare(b);
        })
        .map((term) => ({ term, score: 0 }));
      disambiguators.push(
        ...pickTopUnique(fallbackDisamb, 3, disambiguators).slice(disambiguators.length),
      );
    }
    if (disambiguators.length < 3) {
      const slugFallback = buildSlugFallbackTerms(subcategory)
        .filter((term) => !isNearDuplicate(term, primary))
        .map((term) => ({ term, score: 0 }));
      disambiguators.push(
        ...pickTopUnique(slugFallback, 3, disambiguators).slice(disambiguators.length),
      );
    }
    if (disambiguators.length < 3) {
      const softFallback = [
        ...new Set([
          ...keywords,
          ...buildSlugFallbackTerms(subcategory),
        ]),
      ];
      for (const term of softFallback) {
        if (disambiguators.length >= 3) break;
        if (isNearDuplicate(term, disambiguators)) continue;
        if (isNearDuplicate(term, primary)) continue;
        disambiguators.push(term);
      }
    }
    if (disambiguators.length < 3) {
      const seed = primary[0] ?? subcategory.replace(/_/g, " ");
      for (const term of buildSyntheticTermsFromSubcategory(subcategory, seed)) {
        if (disambiguators.length >= 3) break;
        if (isNearDuplicate(term, disambiguators)) continue;
        if (isNearDuplicate(term, primary)) continue;
        disambiguators.push(term);
      }
    }
    if (
      disambiguators.length < 3 &&
      !isNearDuplicate(subcategory.replace(/_/g, " "), disambiguators) &&
      !isNearDuplicate(subcategory.replace(/_/g, " "), primary)
    ) {
      disambiguators.push(subcategory.replace(/_/g, " "));
    }
    if (disambiguators.length < 3) {
      for (const token of buildCategoryFallbackTerms(category)) {
        if (disambiguators.length >= 3) break;
        if (isNearDuplicate(token, disambiguators)) continue;
        if (isNearDuplicate(token, primary)) continue;
        disambiguators.push(token);
      }
    }
    if (disambiguators.length < 3) {
      const finalFallback = [
        category.replace(/_/g, " "),
        subcategory.replace(/_/g, " "),
        `${subcategory.replace(/_/g, " ")} ${category.replace(/_/g, " ")}`,
        `${subcategory.replace(/_/g, " ")} clave`,
      ];
      for (const term of finalFallback) {
        if (disambiguators.length >= 3) break;
        if (isNearDuplicate(term, disambiguators)) continue;
        disambiguators.push(term);
      }
    }

    const finalPrimary = finalizeTermList(
      primary.slice(0, 3),
      [...keywords, ...buildSlugFallbackTerms(subcategory)],
      subcategory,
      category,
      3,
    );
    const finalDisambiguators = finalizeTermList(
      disambiguators.slice(0, 3),
      [...keywords, ...buildSlugFallbackTerms(subcategory), ...finalPrimary],
      subcategory,
      category,
      3,
    );

    markdownLines.push(`## ${subcategory}`);
    markdownLines.push("");
    markdownLines.push(`- Categoria: \`${category}\``);
    markdownLines.push(`- Muestra analizada: ${entry.docs} productos`);
    markdownLines.push(
      `- Senales nucleo (3): ${finalPrimary.map((term) => `\`${term}\``).join(", ")}`,
    );
    markdownLines.push(
      `- Desambiguadores (3): ${finalDisambiguators
        .map((term) => `\`${term}\``)
        .join(", ")}`,
    );
    markdownLines.push("");
  }

  const outputPath = path.join(repoRoot, "SIGNALS.md");
  await fs.writeFile(outputPath, `${markdownLines.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        reportPath,
        outputPath,
        subcategories: sortedEntries.length,
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
