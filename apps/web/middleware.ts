import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PATHS = ["/admin", "/api/normalize"];
const TOKEN = process.env.NEXTAUTH_SECRET || process.env.ADMIN_TOKEN;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const shouldProtect = PROTECTED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!shouldProtect) return NextResponse.next();

  const auth = req.headers.get("authorization");
  const token = auth?.replace(/^Bearer\s+/i, "").trim();

  if (!TOKEN || !token || token !== TOKEN) {
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
