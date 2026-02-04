import { NextResponse } from "next/server";
import { createAdminSession, ensureAdminUser, setAdminCookie, verifyAdminPassword } from "@/lib/auth";

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

  if (!adminEmail || !adminPassword) {
    return NextResponse.json(
      { error: "Missing ADMIN_EMAIL/ADMIN_PASSWORD" },
      { status: 500 },
    );
  }

  if (email !== adminEmail) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  await ensureAdminUser();
  const valid = await verifyAdminPassword(email, password);
  if (!valid) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const token = await createAdminSession(email);
  await setAdminCookie(token);

  return NextResponse.redirect(new URL("/admin", req.url));
}
