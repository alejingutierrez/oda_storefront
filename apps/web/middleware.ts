import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PATHS = ["/api/normalize"];

function isAuthorized(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const token = auth?.replace(/^Bearer\s+/i, "").trim();
  const cookieToken = req.cookies.get("admin_session")?.value;
  return Boolean(token || cookieToken);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const shouldProtect = PROTECTED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

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
  matcher: ["/api/normalize"],
};
