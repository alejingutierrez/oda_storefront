import { NextResponse } from "next/server";

const COOKIE_NAME = "admin_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") || "";

  let email = "";
  let password = "";

  if (contentType.includes("application/json")) {
    const body = (await req.json()) as { email?: string; password?: string };
    email = body.email?.trim() ?? "";
    password = body.password ?? "";
  } else {
    const formData = await req.formData();
    email = String(formData.get("email") ?? "").trim();
    password = String(formData.get("password") ?? "");
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminToken = process.env.ADMIN_TOKEN;

  if (!adminEmail || !adminPassword || !adminToken) {
    return NextResponse.json(
      { error: "Missing ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_TOKEN" },
      { status: 500 },
    );
  }

  if (email !== adminEmail || password !== adminPassword) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const res = NextResponse.redirect(new URL("/admin", req.url));
  res.cookies.set(COOKIE_NAME, adminToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });

  return res;
}
