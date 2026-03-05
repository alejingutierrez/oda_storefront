/**
 * Generates a URL-friendly slug from a product name.
 * Handles Spanish accents, special characters, and length limits.
 */
export function generateProductSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9\s-]/g, "") // keep only alphanumeric, spaces, hyphens
    .trim()
    .replace(/\s+/g, "-") // spaces → hyphens
    .replace(/-+/g, "-") // collapse consecutive hyphens
    .replace(/^-|-$/g, "") // trim leading/trailing hyphens
    .slice(0, 120);
}

/**
 * Generates a unique slug within a brand by appending numeric suffix on collision.
 * `existingSlugs` should contain all current slugs for the same brand.
 */
export function generateUniqueSlug(
  name: string,
  existingSlugs: Set<string>,
): string {
  const base = generateProductSlug(name);
  if (!base) return "producto";
  if (!existingSlugs.has(base)) return base;
  let suffix = 2;
  while (existingSlugs.has(`${base}-${suffix}`)) {
    suffix++;
  }
  return `${base}-${suffix}`;
}
