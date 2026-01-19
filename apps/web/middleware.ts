import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PATHS = ["/admin", "/api/normalize"];
const PUBLIC_PATHS = ["/admin/login", "/api/auth/login"];

function isAuthorized(req: NextRequest) {
  const candidates = [
    process.env.ADMIN_TOKEN,
    process.env.NEXTAUTH_SECRET, // fallback
  ].filter(Boolean) as string[];

  if (!candidates.length) return false;

  const auth = req.headers.get("authorization");
  const token = auth?.replace(/^Bearer\s+/i, "").trim();
  const cookieToken = req.cookies.get("admin_session")?.value;
  const effective = token || cookieToken;
  if (!effective) return false;

  return candidates.some((t) => t.length === effective.length && t === effective);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const shouldProtect =
    PROTECTED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) &&
    !PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

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
