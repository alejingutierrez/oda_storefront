import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth";
import AdminShell from "../AdminShell";
import TaxonomyEditorPanel from "./TaxonomyEditorPanel";

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

export default async function AdminTaxonomyPage() {
  const authed = await isAdminSession();
  if (!authed) redirect("/admin");

  return (
    <AdminShell title="Taxonomía" active="taxonomy">
      <TaxonomyEditorPanel />
    </AdminShell>
  );
}

