export function getSiteUrl(): string {
  const explicit =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL;
  if (explicit && explicit.trim().length > 0) {
    const value = explicit.trim();
    return value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`;
  }

  // Vercel provides `VERCEL_URL` without protocol (e.g. "my-app.vercel.app").
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl && vercelUrl.trim().length > 0) {
    return `https://${vercelUrl.trim()}`;
  }

  return "http://localhost:3000";
}

