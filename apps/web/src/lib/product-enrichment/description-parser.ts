const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

const toAsciiText = (value: string) =>
  value
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const stripHtmlToText = (value: string | null | undefined) => {
  if (!value) return "";
  const decoded = decodeHtmlEntities(value);
  return toAsciiText(decoded.replace(/<[^>]*>/g, " "));
};

const normalizeLower = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const unique = (values: string[]) => {
  const seen = new Set<string>();
  const output: string[] = [];
  values.forEach((entry) => {
    const cleaned = entry.trim();
    if (!cleaned) return;
    const key = normalizeLower(cleaned);
    if (!key || seen.has(key)) return;
    seen.add(key);
    output.push(cleaned);
  });
  return output;
};

const clampSentenceSafe = (value: string, maxChars: number) => {
  if (value.length <= maxChars) return value;
  const sliced = value.slice(0, maxChars);
  const idx = Math.max(sliced.lastIndexOf("."), sliced.lastIndexOf(";"), sliced.lastIndexOf(":"));
  if (idx < 120) return sliced.trim();
  return sliced.slice(0, idx + 1).trim();
};

const removeNoiseBlocks = (value: string) =>
  value
    .replace(/\b(envio|env[ií]o|shipping)\b[\s\S]{0,180}?\b(colombia|nacional|internacional|gratis)\b/gi, " ")
    .replace(/\b(cambios|devoluciones|returns?)\b[\s\S]{0,220}?\b(dias|d[ií]as|politica|pol[ií]tica)\b/gi, " ")
    .replace(/\b(medios de pago|payment methods?)\b[\s\S]{0,180}/gi, " ")
    .replace(/\b(faq|preguntas frecuentes)\b[\s\S]{0,200}/gi, " ")
    .replace(/\b(www\.|https?:\/\/)\S+/gi, " ")
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, " ");

export const cleanDescriptionForLLM = (value: string | null | undefined, maxChars = 700) => {
  const raw = stripHtmlToText(value);
  if (!raw) return "";
  const compact = toAsciiText(removeNoiseBlocks(raw));
  return clampSentenceSafe(compact, maxChars);
};

export const extractMaterialComposition = (value: string | null | undefined) => {
  const text = stripHtmlToText(value);
  if (!text) return [];
  const lower = normalizeLower(text);
  const entries: string[] = [];

  const pctRegex = /(\d{1,3}\s*%[\s\-]*(algodon|algod[oó]n|elastano|elast[aá]no|elastane|spandex|lycra|poliester|poli[eé]ster|polyester|viscosa|viscose|rayon|lino|linen|seda|silk|lana|wool|nylon|acrilico|acrylic|denim|cuero|leather))/gi;
  for (const match of lower.matchAll(pctRegex)) {
    entries.push(match[1].replace(/\s+/g, " ").trim());
  }

  const lineRegex = /\b(material|composicion|composici[oó]n|fabric|tela)\s*:\s*([^.;\n]{3,140})/gi;
  for (const match of lower.matchAll(lineRegex)) {
    entries.push(match[2].replace(/\s+/g, " ").trim());
  }

  return unique(entries).slice(0, 8);
};

export const extractCareInstructions = (value: string | null | undefined) => {
  const text = stripHtmlToText(value);
  if (!text) return [];
  const lower = normalizeLower(text);
  const patterns = [
    /\b(lavar(?:\s+a\s+mano|\s+en\s+frio|\s+en\s+fr[ií]o)?|lavado(?:\s+delicado)?|no usar secadora|no planchar|planchar a baja temperatura|lavar por separado|dry clean only|lavado en seco)\b/gi,
  ];
  const entries: string[] = [];
  patterns.forEach((re) => {
    for (const match of lower.matchAll(re)) {
      entries.push(match[1].replace(/\s+/g, " ").trim());
    }
  });
  return unique(entries).slice(0, 10);
};

export const extractMeasurements = (value: string | null | undefined) => {
  const text = stripHtmlToText(value);
  if (!text) return [];
  const lower = normalizeLower(text);
  const entries: string[] = [];
  const measureRegex = /\b(largo|ancho|alto|pecho|cintura|cadera|tiro|entrepierna|contorno|diametro|di[aá]metro)\s*[:\-]?\s*\d{1,4}(?:[.,]\d+)?\s*(cm|mm|m)\b/gi;
  for (const match of lower.matchAll(measureRegex)) {
    entries.push(`${match[1]} ${match[0].split(match[1])[1]}`.replace(/\s+/g, " ").trim());
  }
  const sizeRegex = /\b(talla unica|talla [xsml0-9]{1,4}|one size)\b/gi;
  for (const match of lower.matchAll(sizeRegex)) {
    entries.push(match[1].replace(/\s+/g, " ").trim());
  }
  return unique(entries).slice(0, 10);
};

export const extractTechnicalFeatures = (value: string | null | undefined) => {
  const text = stripHtmlToText(value);
  if (!text) return [];
  const lower = normalizeLower(text);
  const featureRegex =
    /\b(proteccion uv|uv\s*50\+|impermeable|repelente al agua|transpirable|breathable|antibacterial|antibacteriano|anti olor|termico|stretch|elastico|el[aá]stico|compresion|compresi[oó]n|secado rapido|quick dry)\b/gi;
  const entries: string[] = [];
  for (const match of lower.matchAll(featureRegex)) {
    entries.push(match[1].replace(/\s+/g, " ").trim());
  }
  return unique(entries).slice(0, 12);
};

export const buildDescriptionSignals = (value: string | null | undefined) => ({
  cleanText: cleanDescriptionForLLM(value),
  materials: extractMaterialComposition(value),
  care: extractCareInstructions(value),
  measurements: extractMeasurements(value),
  features: extractTechnicalFeatures(value),
});
