import fs from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { harvestProductSignals } from "@/lib/product-enrichment/signal-harvester";
import {
  CATEGORY_LABELS,
  CATEGORY_VALUES,
  SUBCATEGORY_BY_CATEGORY,
  SUBCATEGORY_LABELS,
} from "@/lib/product-enrichment/constants";
import { SUBCATEGORY_KEYWORD_RULES, scoreKeywordHits } from "@/lib/product-enrichment/keyword-dictionaries";

type SampleRow = {
  review_id: string;
  product_id: string;
  from_category: string | null;
  from_subcategory: string | null;
  from_gender: string | null;
  to_category: string | null;
  to_subcategory: string | null;
  to_gender: string | null;
  confidence: number | null;
  reasons: string[] | null;
  seo_hints: string[] | null;
  source_count: number | null;
  score_support: number | null;
  margin_ratio: number | null;
  brand_name: string;
  product_name: string;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
  seo_tags: string[] | null;
  product_category: string | null;
  product_subcategory: string | null;
  product_gender: string | null;
  image_cover_url: string | null;
  source_url: string | null;
  metadata: unknown;
};

const nowKey = () => new Date().toISOString().replace(/[:.]/g, "-");

const normalizeText = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripHtml = (value: unknown) =>
  String(value || "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");

const truncate = (value: string, max = 220) => (value.length <= max ? value : `${value.slice(0, max - 1)}…`);

const toStringArray = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
};

const safeGetOriginalDescription = (metadata: unknown): string | null => {
  if (!metadata || typeof metadata !== "object") return null;
  const root = metadata as Record<string, unknown>;
  const enrichment = root.enrichment;
  if (!enrichment || typeof enrichment !== "object" || Array.isArray(enrichment)) return null;
  const original = (enrichment as Record<string, unknown>).original_description;
  if (typeof original !== "string") return null;
  const trimmed = original.trim();
  return trimmed ? trimmed : null;
};

const FORMAL_EVIDENCE = [
  "formal",
  "de vestir",
  "camisa de vestir",
  "office",
  "business",
  "dress shirt",
  "oxford",
  "tuxedo",
  "smoking",
  "sastreria",
  "tailoring",
];

const SWIM_EVIDENCE = [
  "bikini",
  "trikini",
  "tankini",
  "traje de bano",
  "traje de baño",
  "vestido de bano",
  "vestido de baño",
  "banador",
  "bañador",
  "swimwear",
  "beachwear",
  "swim",
  "swimsuit",
  "de bano",
  "de baño",
  "playa",
  "beach",
  "pool",
  "piscina",
  "salida de bano",
  "salida de baño",
  "cover up",
  "coverup",
  "cobertor",
  "cobertor playa",
  "cobertor de playa",
];

const BAG_EVIDENCE = [
  "bolso",
  "bolsos",
  "bag",
  "bags",
  "cartera",
  "mochila",
  "morral",
  "bandolera",
  "crossbody",
  "clutch",
  "billetera",
  "wallet",
  "maleta",
  "equipaje",
  "cartuchera",
  "neceser",
  "estuche",
  "lonchera",
];

const FOOTWEAR_EVIDENCE = [
  "calzado",
  "footwear",
  "zapato",
  "zapatos",
  "shoe",
  "shoes",
  "sneaker",
  "sneakers",
  "sandalia",
  "sandalias",
  "bota",
  "botas",
  "botin",
  "botines",
  "mocasin",
  "mocasines",
  "loafer",
  "loafers",
  "tacon",
  "tacones",
];

const SPORTS_EVIDENCE = [
  "deportivo",
  "deportiva",
  "ropa deportiva",
  "activewear",
  "athleisure",
  "sportswear",
  "gym",
  "running",
  "training",
  "entrenamiento",
  "compresion",
  "compresión",
  "compression",
  "dry fit",
  "quick dry",
];

const scoreSubcategoryCandidates = (category: string, text: string) => {
  const scored: Array<{ subcategory: string; score: number }> = [];
  for (const rule of SUBCATEGORY_KEYWORD_RULES) {
    if (rule.category !== category) continue;
    const score = scoreKeywordHits(text, rule.keywords);
    if (score <= 0) continue;
    scored.push({ subcategory: rule.subcategory, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
};

const main = async () => {
  const sampleSize = Math.max(1, Number(process.env.TAXON_SAMPLE_SIZE || 100));
  const outRoot = path.join(process.cwd(), "..", "..", "reports");
  fs.mkdirSync(outRoot, { recursive: true });
  const outJson = path.join(outRoot, `taxonomy_remap_pending_sample_${nowKey()}.json`);
  const outMd = path.join(outRoot, `taxonomy_remap_pending_sample_${nowKey()}.md`);

  const rows = await prisma.$queryRaw<SampleRow[]>`
    SELECT
      r."id" AS review_id,
      r."productId" AS product_id,
      r."fromCategory" AS from_category,
      r."fromSubcategory" AS from_subcategory,
      r."fromGender" AS from_gender,
      r."toCategory" AS to_category,
      r."toSubcategory" AS to_subcategory,
      r."toGender" AS to_gender,
      r."confidence" AS confidence,
      r."reasons" AS reasons,
      r."seoCategoryHints" AS seo_hints,
      r."sourceCount" AS source_count,
      r."scoreSupport" AS score_support,
      r."marginRatio" AS margin_ratio,
      b."name" AS brand_name,
      p."name" AS product_name,
      p."description" AS description,
      p."seoTitle" AS seo_title,
      p."seoDescription" AS seo_description,
      p."seoTags" AS seo_tags,
      p."category" AS product_category,
      p."subcategory" AS product_subcategory,
      p."gender" AS product_gender,
      p."imageCoverUrl" AS image_cover_url,
      p."sourceUrl" AS source_url,
      p."metadata" AS metadata
    FROM "taxonomy_remap_reviews" r
    JOIN "products" p ON p."id" = r."productId"
    JOIN "brands" b ON b."id" = p."brandId"
    WHERE r."status" = 'pending'
      AND p."metadata"->'enrichment' IS NOT NULL
    ORDER BY random()
    LIMIT ${sampleSize};
  `;

  const summary = {
    sampled: rows.length,
    moveType: { category: 0, subcategory: 0, gender: 0, multi: 0 },
    suspicious: {
      camisa_formal_without_evidence: 0,
      denim_without_evidence: 0,
      interior_false_positive: 0,
      mono_vs_mono: 0,
      jewelry_chain_to_aretes: 0,
      swim_to_underwear: 0,
      bikini_to_one_piece: 0,
      bag_to_puffer: 0,
      shoe_to_sportswear: 0,
      sportswear_to_generic_top: 0,
      linen_to_casual: 0,
      zip_to_crewneck: 0,
    },
    topMoves: new Map<string, number>(),
  };

  const items = rows.map((row) => {
    const originalDescription = safeGetOriginalDescription(row.metadata);
    const descriptionForSignals = originalDescription ?? row.description ?? null;
    const seoTags = toStringArray(row.seo_tags);
    const seoText = normalizeText([row.seo_title, row.seo_description, seoTags.join(" ")].filter(Boolean).join(" "));
    const nameText = normalizeText(row.product_name);
    const descText = normalizeText(stripHtml(descriptionForSignals));
    const allText = normalizeText([row.product_name, stripHtml(descriptionForSignals), seoTags.join(" ")].filter(Boolean).join(" "));

    const categoryFinal = row.to_category ?? row.from_category ?? row.product_category ?? null;
    const toSub = row.to_subcategory ?? null;

    const signals = harvestProductSignals({
      name: row.product_name,
      description: descriptionForSignals,
      metadata: (row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : null),
      sourceUrl: row.source_url,
      seoTitle: row.seo_title,
      seoDescription: row.seo_description,
      seoTags,
      currentCategory: row.from_category ?? row.product_category ?? null,
      currentGender: row.from_gender ?? row.product_gender ?? null,
      allowedCategoryValues: CATEGORY_VALUES,
      subcategoryByCategory: SUBCATEGORY_BY_CATEGORY,
    });

    const categoryChanged = (row.to_category ?? row.from_category) !== (row.from_category ?? null) && Boolean(row.to_category);
    const subChanged = (row.to_subcategory ?? row.from_subcategory) !== (row.from_subcategory ?? null) && Boolean(row.to_subcategory);
    const genderChanged = (row.to_gender ?? row.from_gender) !== (row.from_gender ?? null) && Boolean(row.to_gender);
    const changeCount = [categoryChanged, subChanged, genderChanged].filter(Boolean).length;
    if (changeCount > 1) summary.moveType.multi += 1;
    else if (categoryChanged) summary.moveType.category += 1;
    else if (subChanged) summary.moveType.subcategory += 1;
    else if (genderChanged) summary.moveType.gender += 1;

    const moveKey = `${row.from_category ?? "null"}:${row.from_subcategory ?? "null"} -> ${row.to_category ?? "null"}:${row.to_subcategory ?? "null"}`;
    summary.topMoves.set(moveKey, (summary.topMoves.get(moveKey) ?? 0) + 1);

    let suspiciousCamisaFormal = false;
    if (categoryFinal === "camisas_y_blusas" && toSub === "camisa_formal") {
      const hasFormalEvidence = FORMAL_EVIDENCE.some((kw) => allText.includes(normalizeText(kw)));
      if (!hasFormalEvidence) {
        suspiciousCamisaFormal = true;
        summary.suspicious.camisa_formal_without_evidence += 1;
      }
    }

    let suspiciousDenim = false;
    if (toSub && toSub.includes("denim")) {
      const hasDenim = ["denim", "jean", "jeans", "indigo", "jort", "jorts"].some((kw) => allText.includes(kw));
      if (!hasDenim) {
        suspiciousDenim = true;
        summary.suspicious.denim_without_evidence += 1;
      }
    }

    const proposedCategory = row.to_category ?? row.from_category ?? row.product_category ?? null;

    let suspiciousInterior = false;
    if (
      proposedCategory === "ropa_interior_basica" &&
      allText.includes("guia interior") &&
      ![
        "ropa interior",
        "underwear",
        "brasier",
        "bralette",
        "panty",
        "trusa",
        "tanga",
        "boxer",
        "brief",
        "cachetero",
        "calzon",
        "calzoncillo",
      ].some((kw) => allText.includes(normalizeText(kw)))
    ) {
      suspiciousInterior = true;
      summary.suspicious.interior_false_positive += 1;
    }

    let suspiciousMono = false;
    if (
      proposedCategory === "enterizos_y_overoles" &&
      allText.includes("mono") &&
      ["panty", "lenceria", "lingerie", "encaje", "ropa interior"].some((kw) => allText.includes(normalizeText(kw)))
    ) {
      suspiciousMono = true;
      summary.suspicious.mono_vs_mono += 1;
    }

    let suspiciousJewelryChain = false;
    if (
      proposedCategory === "joyeria_y_bisuteria" &&
      row.to_subcategory === "aretes_pendientes" &&
      ["cadena", "collar", "collares", "necklace", "choker", "gargantilla"].some((kw) => allText.includes(kw)) &&
      !["arete", "aretes", "earring", "earrings", "topos", "argolla", "argollas"].some((kw) => allText.includes(kw))
    ) {
      suspiciousJewelryChain = true;
      summary.suspicious.jewelry_chain_to_aretes += 1;
    }

    let suspiciousSwimToUnderwear = false;
    if (row.from_category === "trajes_de_bano_y_playa" && row.to_category === "ropa_interior_basica") {
      suspiciousSwimToUnderwear = true;
      summary.suspicious.swim_to_underwear += 1;
    }

    let suspiciousBikiniToOnePiece = false;
    if (
      row.from_category === "trajes_de_bano_y_playa" &&
      row.from_subcategory === "bikini" &&
      row.to_category === "trajes_de_bano_y_playa" &&
      row.to_subcategory === "vestido_de_bano_entero"
    ) {
      suspiciousBikiniToOnePiece = true;
      summary.suspicious.bikini_to_one_piece += 1;
    }

    let suspiciousBagToPuffer = false;
    if (row.from_category === "bolsos_y_marroquineria" && row.to_category === "chaquetas_y_abrigos") {
      suspiciousBagToPuffer = true;
      summary.suspicious.bag_to_puffer += 1;
    }

    let suspiciousShoeToSportswear = false;
    if (row.from_category === "calzado" && row.to_category === "ropa_deportiva_y_performance") {
      suspiciousShoeToSportswear = true;
      summary.suspicious.shoe_to_sportswear += 1;
    }

    let suspiciousSportsToGenericTop = false;
    if (
      row.from_category === "ropa_deportiva_y_performance" &&
      row.to_category === "camisetas_y_tops" &&
      SPORTS_EVIDENCE.some((kw) => allText.includes(normalizeText(kw)))
    ) {
      suspiciousSportsToGenericTop = true;
      summary.suspicious.sportswear_to_generic_top += 1;
    }

    let suspiciousLinenToCasual = false;
    if (
      row.from_category === "camisas_y_blusas" &&
      row.from_subcategory === "camisa_de_lino" &&
      row.to_category === "camisas_y_blusas" &&
      row.to_subcategory === "camisa_casual" &&
      ["lino", "linen"].some((kw) => allText.includes(kw))
    ) {
      suspiciousLinenToCasual = true;
      summary.suspicious.linen_to_casual += 1;
    }

    let suspiciousZipToCrewneck = false;
    if (
      row.from_category === "buzos_hoodies_y_sueteres" &&
      row.from_subcategory === "hoodie_con_cremallera" &&
      row.to_category === "buzos_hoodies_y_sueteres" &&
      row.to_subcategory === "buzo_cuello_redondo" &&
      ["cierre", "cremallera", "zip", "zipper", "half zip", "quarter zip"].some((kw) =>
        allText.includes(normalizeText(kw)),
      )
    ) {
      suspiciousZipToCrewneck = true;
      summary.suspicious.zip_to_crewneck += 1;
    }

    const nameScores =
      categoryFinal ? scoreSubcategoryCandidates(categoryFinal, nameText).slice(0, 6) : [];
    const seoScores =
      categoryFinal ? scoreSubcategoryCandidates(categoryFinal, seoText).slice(0, 6) : [];
    const descScores =
      categoryFinal ? scoreSubcategoryCandidates(categoryFinal, descText).slice(0, 6) : [];

    return {
      reviewId: row.review_id,
      productId: row.product_id,
      brand: row.brand_name,
      name: row.product_name,
      from: {
        category: row.from_category,
        subcategory: row.from_subcategory,
        gender: row.from_gender,
      },
      to: {
        category: row.to_category,
        subcategory: row.to_subcategory,
        gender: row.to_gender,
      },
      confidence: row.confidence,
      support: row.score_support,
      marginRatio: row.margin_ratio,
      reasons: (row.reasons ?? []).slice(0, 10),
      seoHints: (row.seo_hints ?? []).slice(0, 8),
      product: {
        imageCoverUrl: row.image_cover_url,
        sourceUrl: row.source_url,
        seoTags: seoTags.slice(0, 12),
        descriptionPreview: truncate(normalizeText(stripHtml(descriptionForSignals)), 240),
        originalDescriptionPresent: Boolean(originalDescription),
      },
      signals: {
        inferredCategory: signals.inferredCategory,
        inferredSubcategory: signals.inferredSubcategory,
        signalStrength: signals.signalStrength,
        nameSubcategory: signals.nameSubcategory,
        conflictingSignals: signals.conflictingSignals,
      },
      scoring: {
        category: categoryFinal,
        nameTop: nameScores.map((entry) => ({
          subcategory: entry.subcategory,
          label: SUBCATEGORY_LABELS[entry.subcategory] ?? entry.subcategory,
          score: entry.score,
        })),
        seoTop: seoScores.map((entry) => ({
          subcategory: entry.subcategory,
          label: SUBCATEGORY_LABELS[entry.subcategory] ?? entry.subcategory,
          score: entry.score,
        })),
        descTop: descScores.map((entry) => ({
          subcategory: entry.subcategory,
          label: SUBCATEGORY_LABELS[entry.subcategory] ?? entry.subcategory,
          score: entry.score,
        })),
      },
      flags: {
        suspiciousCamisaFormal,
        suspiciousDenim,
        suspiciousInterior,
        suspiciousMono,
        suspiciousJewelryChain,
        suspiciousSwimToUnderwear,
        suspiciousBikiniToOnePiece,
        suspiciousBagToPuffer,
        suspiciousShoeToSportswear,
        suspiciousSportsToGenericTop,
        suspiciousLinenToCasual,
        suspiciousZipToCrewneck,
      },
    };
  });

  const topMovesSorted = [...summary.topMoves.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);

  const mdLines: string[] = [];
  mdLines.push(`# Taxonomy Remap Pending Sample (${rows.length})`);
  mdLines.push("");
  mdLines.push(`- sampled: ${rows.length}`);
  mdLines.push(
    `- moveType: category=${summary.moveType.category}, subcategory=${summary.moveType.subcategory}, gender=${summary.moveType.gender}, multi=${summary.moveType.multi}`,
  );
  mdLines.push(
    `- suspicious: camisa_formal_without_evidence=${summary.suspicious.camisa_formal_without_evidence}, denim_without_evidence=${summary.suspicious.denim_without_evidence}, interior_false_positive=${summary.suspicious.interior_false_positive}, mono_vs_mono=${summary.suspicious.mono_vs_mono}, jewelry_chain_to_aretes=${summary.suspicious.jewelry_chain_to_aretes}, swim_to_underwear=${summary.suspicious.swim_to_underwear}, bikini_to_one_piece=${summary.suspicious.bikini_to_one_piece}, bag_to_puffer=${summary.suspicious.bag_to_puffer}, shoe_to_sportswear=${summary.suspicious.shoe_to_sportswear}, sportswear_to_generic_top=${summary.suspicious.sportswear_to_generic_top}, linen_to_casual=${summary.suspicious.linen_to_casual}, zip_to_crewneck=${summary.suspicious.zip_to_crewneck}`,
  );
  mdLines.push("");
  mdLines.push("## Top Moves (sample)");
  mdLines.push("");
  topMovesSorted.forEach(([key, count]) => {
    mdLines.push(`- ${count} · ${key}`);
  });
  mdLines.push("");
  mdLines.push("## Examples (first 12)");
  mdLines.push("");
  items.slice(0, 12).forEach((item) => {
    const fromCat = item.from.category ? `${item.from.category} (${CATEGORY_LABELS[item.from.category] ?? item.from.category})` : "null";
    const toCat = item.to.category ? `${item.to.category} (${CATEGORY_LABELS[item.to.category] ?? item.to.category})` : "null";
    const fromSub = item.from.subcategory ? `${item.from.subcategory} (${SUBCATEGORY_LABELS[item.from.subcategory] ?? item.from.subcategory})` : "null";
    const toSub = item.to.subcategory ? `${item.to.subcategory} (${SUBCATEGORY_LABELS[item.to.subcategory] ?? item.to.subcategory})` : "null";
    mdLines.push(`- **${item.brand}** · ${item.name}`);
    mdLines.push(`  - from: ${fromCat} / ${fromSub}`);
    mdLines.push(`  - to: ${toCat} / ${toSub}`);
    mdLines.push(`  - conf: ${item.confidence ?? "null"} · support: ${item.support ?? "null"} · margin: ${item.marginRatio ?? "null"}`);
    const flags = Object.entries(item.flags)
      .filter(([, value]) => Boolean(value))
      .map(([key]) => key);
    if (flags.length) mdLines.push(`  - flags: ${flags.join(", ")}`);
  });
  mdLines.push("");

  fs.writeFileSync(outJson, JSON.stringify({ summary: { ...summary, topMoves: topMovesSorted }, items }, null, 2), "utf8");
  fs.writeFileSync(outMd, mdLines.join("\n"), "utf8");

  console.log(`Wrote sample report:`);
  console.log(`- ${outJson}`);
  console.log(`- ${outMd}`);
  console.log(`Summary:`);
  console.log(JSON.stringify({ ...summary, topMoves: topMovesSorted }, null, 2));
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null);
  });
