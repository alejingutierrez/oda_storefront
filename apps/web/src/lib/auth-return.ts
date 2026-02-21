const BLOCKED_RETURN_QUERY_KEYS = new Set([
  "code",
  "err",
  "error",
  "descope-login-flow",
]);

export const DEFAULT_AUTH_RETURN_PATH = "/perfil";

const normalizePathname = (value: string) => {
  if (!value) return "/";
  const trimmed = value.trim();
  if (!trimmed) return "/";
  if (trimmed === "/") return "/";
  return trimmed.replace(/\/+$/, "");
};

export const isAuthFlowPathname = (pathname: string) => {
  const normalized = normalizePathname(pathname);
  return normalized === "/sign-in" || normalized === "/auth/callback";
};

export const sanitizeAuthReturnPath = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed, "https://oda.local");
  } catch {
    return null;
  }

  if (isAuthFlowPathname(parsed.pathname)) return null;
  for (const key of BLOCKED_RETURN_QUERY_KEYS) {
    if (parsed.searchParams.has(key)) return null;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
};

export const normalizeAuthReturnPath = (
  value: string | null | undefined,
  fallback = DEFAULT_AUTH_RETURN_PATH,
) => sanitizeAuthReturnPath(value) ?? fallback;
