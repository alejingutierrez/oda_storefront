/**
 * Strip HTML tags and decode common entities from a string.
 * Useful for cleaning descriptions scraped from brand sites that may
 * contain Google Sheets markup or inline `<style>` blocks.
 */
export function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    // Remove <style>…</style> blocks completely
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    // Remove all remaining HTML tags
    .replace(/<[^>]*>/g, "")
    // Decode common HTML entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}
