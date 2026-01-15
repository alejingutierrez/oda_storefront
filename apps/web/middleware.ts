import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PATHS = ["/admin", "/api/normalize"];

function isAuthorized(req: NextRequest) {
  const candidates = [
    process.env.ADMIN_TOKEN,
    process.env.NEXTAUTH_SECRET, // fallback
  ].filter(Boolean) as string[];

  if (!candidates.length) return false;

  const auth = req.headers.get("authorization");
  const token = auth?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  return candidates.some((t) => t.length === token.length && t === token);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const shouldProtect = PROTECTED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!shouldProtect) return NextResponse.next();

  if (!isAuthorized(req)) {
    return new NextResponse(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/normalize"],
};
