import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth";
import AdminShell from "../AdminShell";
import ProductCurationPanel from "./ProductCurationPanel";

export const dynamic = "force-dynamic";

async function isAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_session")?.value;
  if (!token) return false;
  const tokenHash = hashToken(token);
  const admin = await prisma.user.findFirst({
    where: {
      role: "admin",
      sessionTokenHash: tokenHash,
    },
    select: { id: true },
  });
  return !!admin;
}

export default async function ProductCurationPage() {
  const authed = await isAdminSession();
  if (!authed) redirect("/admin");

  return (
    <AdminShell title="Curación de productos" active="product-curation">
      <ProductCurationPanel />
    </AdminShell>
  );
}

