export const slugify = (value: string) => {
  if (!value) return "";
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
};

export const normalizeEnumValue = (value: string | null | undefined, allowed: string[]) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (allowed.includes(trimmed)) return trimmed;
  const normalized = slugify(trimmed);
  if (!normalized) return null;
  const match = allowed.find((entry) => slugify(entry) === normalized || entry === normalized);
  return match ?? null;
};

export const normalizeEnumArray = (values: Array<string | null | undefined>, allowed: string[]) => {
  const output: string[] = [];
  values.forEach((value) => {
    const normalized = normalizeEnumValue(value ?? "", allowed);
    if (normalized && !output.includes(normalized)) output.push(normalized);
  });
  return output;
};

export const normalizeHexColor = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  const match = trimmed.match(/#([0-9a-fA-F]{6})/);
  if (!match) return null;
  return `#${match[1].toUpperCase()}`;
};

export const normalizePantoneCode = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = String(value).trim().toUpperCase();
  const cleaned = trimmed.replace(/PANTONE\s*/i, "");
  const match = cleaned.match(/(\d{2}-\d{4})/);
  if (!match) return null;
  return match[1];
};

export const chunkArray = <T>(values: T[], size: number) => {
  if (size <= 0) return [values];
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
};
