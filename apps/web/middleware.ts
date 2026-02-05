import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authMiddleware } from "@descope/nextjs-sdk/server";

const ADMIN_PROTECTED_PATHS = ["/api/normalize"];
const DESCOPE_PROTECTED_PREFIXES = ["/perfil", "/api/user"];

const descope = authMiddleware({
  projectId: process.env.NEXT_PUBLIC_DESCOPE_PROJECT_ID!,
  baseUrl: process.env.NEXT_PUBLIC_DESCOPE_BASE_URL,
  redirectUrl: "/sign-in",
  publicRoutes: ["/sign-in", "/sign-up", "/api/experience/events"],
});

function isAdminAuthorized(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const token = auth?.replace(/^Bearer\s+/i, "").trim();
  const cookieToken = req.cookies.get("admin_session")?.value;
  return Boolean(token || cookieToken);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    return NextResponse.next();
  }

  const shouldProtectAdmin = ADMIN_PROTECTED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (shouldProtectAdmin) {
    if (!isAdminAuthorized(req)) {
      return new NextResponse(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return NextResponse.next();
  }

  const requiresDescope = DESCOPE_PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (requiresDescope) {
    return descope(req);
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/((?!.+\\.[\\w]+$|_next).*)",
};
