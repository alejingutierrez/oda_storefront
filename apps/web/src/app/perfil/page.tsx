import Header from "@/components/Header";
import { getMegaMenuData } from "@/lib/home-data";
import PerfilClient from "./PerfilClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PerfilPage() {
  const menu = await getMegaMenuData();

  return (
    <main className="min-h-screen bg-[color:var(--oda-cream)]">
      <Header menu={menu} />
      <PerfilClient />
    </main>
  );
}

