import path from "node:path";
import fs from "node:fs/promises";
import dotenv from "dotenv";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

// Load repo-root env so Prisma can connect when running this script locally.
dotenv.config({ path: path.resolve(process.cwd(), "..", "..", ".env") });

type SampleRow = {
  id: string;
  subcategory: string;
  name: string | null;
  description: string | null;
};

type SubcategoryReport = {
  subcategory: string;
  docs: number;
  topFrequentTerms: Array<{ term: string; count: number }>;
  topFrequentBigrams: Array<{ term: string; count: number }>;
  topDisambiguationTerms: Array<{ term: string; count: number; score: number }>;
};

const SAMPLE_SIZE = Math.max(20, Number(process.env.REMAP_TERM_SAMPLE_SIZE ?? 100));
const TOP_K = Math.max(5, Number(process.env.REMAP_TERM_TOP_K ?? 15));
const BIGRAM_TOP_K = Math.max(5, Number(process.env.REMAP_TERM_BIGRAM_TOP_K ?? 15));
const MIN_TOKEN_LEN = Math.max(2, Number(process.env.REMAP_TERM_MIN_TOKEN_LEN ?? 3));
const MIN_DISAMBIG_COUNT = Math.max(2, Number(process.env.REMAP_TERM_MIN_DISAMBIG_COUNT ?? 3));

const STOPWORDS = new Set([
  "para",
  "con",
  "sin",
  "por",
  "del",
  "de",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "que",
  "como",
  "mas",
  "más",
  "muy",
  "todo",
  "toda",
  "todos",
  "todas",
  "this",
  "that",
  "the",
  "and",
  "for",
  "from",
  "with",
  "without",
  "you",
  "your",
  "our",
  "its",
  "new",
  "nuevo",
  "nueva",
  "coleccion",
  "colección",
  "estilo",
  "moda",
  "prenda",
  "prendas",
  "producto",
  "productos",
  "item",
  "items",
  "ref",
  "referencia",
  "original",
  "disponible",
  "disponibles",
  "marca",
  "color",
  "talla",
  "tallas",
  "temporada",
  "look",
  "ideal",
  "perfecto",
  "perfecta",
  "esta",
  "este",
  "estas",
  "estos",
  "esa",
  "ese",
  "esas",
  "esos",
  "tu",
  "tus",
  "nos",
  "nuestra",
  "nuestro",
  "nuestras",
  "nuestros",
  "cada",
  "tipo",
  "incluye",
  "incluyen",
  "sobre",
  "span",
  "style",
  "div",
  "class",
  "data",
  "mce",
  "fragment",
  "strong",
  "href",
  "src",
  "img",
  "http",
  "https",
  "www",
  "com",
  "net",
  "org",
  "xml",
  "xmlns",
  "utf",
  "charset",
  "lang",
  "normaltextrun",
  "textrun",
  "align",
  "inherit",
  "font",
  "family",
  "sans",
  "serif",
  "mso",
  "apple",
  "tab",
  "nbsp",
  "px",
  "rem",
  "rgb",
]);

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeToken = (token: string) => {
  const clean = token.trim();
  if (!clean) return "";
  if (clean.length > 5 && clean.endsWith("es")) return clean.slice(0, -2);
  if (clean.length > 4 && clean.endsWith("s")) return clean.slice(0, -1);
  return clean;
};

const stripHtmlArtifacts = (value: string) =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;|&#38;/gi, " and ")
    .replace(/&quot;|&#34;|&apos;|&#39;/gi, " ")
    .replace(/&lt;|&#60;|&gt;|&#62;/gi, " ")
    .replace(/[\t\r\n]+/g, " ");

const isLowSignalToken = (token: string) => {
  if (STOPWORDS.has(token)) return true;
  if (/^\d+$/.test(token)) return true;
  const digitCount = (token.match(/\d/g) ?? []).length;
  if (digitCount >= 2) return true;
  if (token.length >= 10 && digitCount >= 1) return true;
  if (/^[a-f0-9]{8,}$/i.test(token)) return true;
  return false;
};

const tokenize = (text: string) => {
  const cleaned = stripHtmlArtifacts(text);
  return normalizeText(cleaned)
    .split(" ")
    .map((token) => normalizeToken(token))
    .filter((token) => token.length >= MIN_TOKEN_LEN)
    .filter((token) => !isLowSignalToken(token));
};

let prismaClient: PrismaClient | null = null;
const getPrisma = async (): Promise<PrismaClient> => {
  if (prismaClient) return prismaClient;
  const mod = (await import("../src/lib/prisma")) as {
    prisma?: PrismaClient;
    default?: { prisma?: PrismaClient };
  };
  const client = mod.prisma ?? mod.default?.prisma;
  if (!client) throw new Error("Failed to import prisma client from ../src/lib/prisma");
  prismaClient = client;
  return prismaClient;
};

const topByCount = (map: Map<string, number>, topK: number) =>
  [...map.entries()]
    .sort((a, b) => {
      const diff = b[1] - a[1];
      if (diff !== 0) return diff;
      return a[0].localeCompare(b[0]);
    })
    .slice(0, topK)
    .map(([term, count]) => ({ term, count }));

const main = async () => {
  const prisma = await getPrisma();

  const rows = await prisma.$queryRaw<SampleRow[]>(Prisma.sql`
    WITH sampled AS (
      SELECT
        p.id,
        p."subcategory" AS "subcategory",
        p."name" AS "name",
        COALESCE((p.metadata -> 'enrichment' ->> 'original_description'), p."description", '') AS "description",
        ROW_NUMBER() OVER (
          PARTITION BY p."subcategory"
          ORDER BY p."updatedAt" DESC, p.id ASC
        ) AS rn
      FROM "products" p
      WHERE p."subcategory" IS NOT NULL
        AND LENGTH(TRIM(p."subcategory")) > 0
        AND (p.metadata -> 'enrichment') IS NOT NULL
    )
    SELECT
      id,
      "subcategory",
      "name",
      "description"
    FROM sampled
    WHERE rn <= ${SAMPLE_SIZE}
    ORDER BY "subcategory" ASC, rn ASC
  `);

  const bySubcategory = new Map<
    string,
    {
      docs: number;
      tokenCounts: Map<string, number>;
      tokenDocFreq: Map<string, number>;
      bigramCounts: Map<string, number>;
      bigramDocFreq: Map<string, number>;
    }
  >();
  const globalTokenDocFreq = new Map<string, number>();
  const globalBigramDocFreq = new Map<string, number>();

  let totalDocs = 0;
  for (const row of rows) {
    const subcategory = String(row.subcategory || "").trim();
    if (!subcategory) continue;

    const bucket =
      bySubcategory.get(subcategory) ??
      {
        docs: 0,
        tokenCounts: new Map<string, number>(),
        tokenDocFreq: new Map<string, number>(),
        bigramCounts: new Map<string, number>(),
        bigramDocFreq: new Map<string, number>(),
      };
    bySubcategory.set(subcategory, bucket);
    bucket.docs += 1;
    totalDocs += 1;

    const text = `${row.name ?? ""} ${row.description ?? ""}`.trim();
    const tokens = tokenize(text);
    const uniqueTokens = new Set<string>();

    for (const token of tokens) {
      bucket.tokenCounts.set(token, (bucket.tokenCounts.get(token) ?? 0) + 1);
      uniqueTokens.add(token);
    }

    for (const token of uniqueTokens) {
      bucket.tokenDocFreq.set(token, (bucket.tokenDocFreq.get(token) ?? 0) + 1);
      globalTokenDocFreq.set(token, (globalTokenDocFreq.get(token) ?? 0) + 1);
    }

    const uniqueBigrams = new Set<string>();
    for (let i = 0; i < tokens.length - 1; i += 1) {
      const bigram = `${tokens[i]} ${tokens[i + 1]}`;
      bucket.bigramCounts.set(bigram, (bucket.bigramCounts.get(bigram) ?? 0) + 1);
      uniqueBigrams.add(bigram);
    }
    for (const bigram of uniqueBigrams) {
      bucket.bigramDocFreq.set(bigram, (bucket.bigramDocFreq.get(bigram) ?? 0) + 1);
      globalBigramDocFreq.set(bigram, (globalBigramDocFreq.get(bigram) ?? 0) + 1);
    }
  }

  const reports: SubcategoryReport[] = [...bySubcategory.entries()]
    .map(([subcategory, bucket]) => {
      const topFrequentTerms = topByCount(bucket.tokenCounts, TOP_K);
      const topFrequentBigrams = topByCount(bucket.bigramCounts, BIGRAM_TOP_K);
      const topDisambiguationTerms = [...bucket.tokenCounts.entries()]
        .filter(([, count]) => count >= MIN_DISAMBIG_COUNT)
        .map(([term, count]) => {
          const subDf = bucket.tokenDocFreq.get(term) ?? 0;
          const globalDf = globalTokenDocFreq.get(term) ?? 0;
          const inRate = subDf / Math.max(1, bucket.docs);
          const globalRate = globalDf / Math.max(1, totalDocs);
          const lift = inRate / Math.max(1e-6, globalRate);
          const score = lift * Math.log(1 + count);
          return { term, count, score: Number(score.toFixed(4)) };
        })
        .sort((a, b) => {
          const scoreDiff = b.score - a.score;
          if (scoreDiff !== 0) return scoreDiff;
          const countDiff = b.count - a.count;
          if (countDiff !== 0) return countDiff;
          return a.term.localeCompare(b.term);
        })
        .slice(0, TOP_K);

      return {
        subcategory,
        docs: bucket.docs,
        topFrequentTerms,
        topFrequentBigrams,
        topDisambiguationTerms,
      };
    })
    .sort((a, b) => a.subcategory.localeCompare(b.subcategory));

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportsDir = path.resolve(process.cwd(), "..", "..", "reports");
  await fs.mkdir(reportsDir, { recursive: true });
  const jsonPath = path.join(reportsDir, `taxonomy_remap_title_description_terms_${timestamp}.json`);
  const mdPath = path.join(reportsDir, `taxonomy_remap_title_description_terms_${timestamp}.md`);

  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sampleSizePerSubcategory: SAMPLE_SIZE,
        topK: TOP_K,
        totalSubcategories: reports.length,
        totalSampledDocs: totalDocs,
        reports,
      },
      null,
      2,
    ),
    "utf8",
  );

  const mdLines: string[] = [];
  mdLines.push("# Taxonomy Remap · Analisis Lexico (Title + Description)");
  mdLines.push("");
  mdLines.push(`- Generado: ${new Date().toISOString()}`);
  mdLines.push(`- Muestra objetivo por subcategoria: ${SAMPLE_SIZE}`);
  mdLines.push(`- Subcategorias analizadas: ${reports.length}`);
  mdLines.push(`- Documentos muestreados: ${totalDocs}`);
  mdLines.push("");

  for (const entry of reports) {
    mdLines.push(`## ${entry.subcategory}`);
    mdLines.push("");
    mdLines.push(`- Documentos analizados: ${entry.docs}`);
    mdLines.push("- Top 15 terminos frecuentes (title + description):");
    for (const term of entry.topFrequentTerms) {
      mdLines.push(`  - ${term.term}: ${term.count}`);
    }
    mdLines.push("- Top 15 frases frecuentes (bigramas):");
    for (const term of entry.topFrequentBigrams) {
      mdLines.push(`  - ${term.term}: ${term.count}`);
    }
    mdLines.push("- Top 15 terminos desambiguadores (lift * log(freq)):");
    for (const term of entry.topDisambiguationTerms) {
      mdLines.push(`  - ${term.term}: ${term.count} (score=${term.score})`);
    }
    mdLines.push("");
  }

  await fs.writeFile(mdPath, `${mdLines.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        sampleSizePerSubcategory: SAMPLE_SIZE,
        totalSubcategories: reports.length,
        totalSampledDocs: totalDocs,
        jsonPath,
        mdPath,
      },
      null,
      2,
    ),
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prismaClient?.$disconnect) {
      await prismaClient.$disconnect().catch(() => null);
    }
  });
