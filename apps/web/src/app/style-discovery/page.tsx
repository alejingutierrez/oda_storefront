import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/descope";
import StyleDiscoveryOnboarding from "@/components/style-discovery/StyleDiscoveryOnboarding";

export const metadata: Metadata = {
  title: "Descubre tu Estilo | ODA",
  description:
    "Desliza prendas y deja que nuestra IA aprenda tu estilo personal. Recibe recomendaciones curadas solo para ti.",
};

export default async function StyleDiscoveryPage() {
  const session = await requireUser();
  if (!session) {
    redirect(`/sign-in?next=${encodeURIComponent("/style-discovery")}`);
  }

  return <StyleDiscoveryOnboarding />;
}
