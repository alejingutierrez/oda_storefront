import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth";
import { isPrismaTableMissingError } from "@/lib/prisma-error-utils";
import AdminShell from "@/app/admin/AdminShell";
import HomeManagementPanel from "./HomeManagementPanel";

export const dynamic = "force-dynamic";

async function isAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_session")?.value;
  if (!token) return false;
  const tokenHash = hashToken(token);
  const admin = await prisma.user.findFirst({
    where: { role: "admin", sessionTokenHash: tokenHash },
    select: { id: true },
  });
  return !!admin;
}

export default async function HomeAdminPage() {
  const authed = await isAdminSession();
  if (!authed) redirect("/admin");

  let configRows: Array<{ key: string; value: string }> = [];
  try {
    configRows = await prisma.homeConfig.findMany({ orderBy: { key: "asc" } });
  } catch (error) {
    if (!isPrismaTableMissingError(error, "home_config")) throw error;
    console.warn("admin.home.config.table_missing_fallback", { table: "home_config" });
  }
  const config = Object.fromEntries(configRows.map((r) => [r.key, r.value]));

  return (
    <AdminShell title="Home" active="home">
      <HomeManagementPanel initialConfig={config} />
    </AdminShell>
  );
}
