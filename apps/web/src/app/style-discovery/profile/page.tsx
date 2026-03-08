import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/descope";
import StyleProfileView from "@/components/style-discovery/StyleProfileView";

export const metadata: Metadata = {
  title: "Tu Perfil de Estilo | ODA",
};

type Props = {
  searchParams: Promise<{ session?: string }>;
};

export default async function ProfilePage({ searchParams }: Props) {
  const session = await requireUser();
  if (!session) {
    redirect(`/sign-in?next=${encodeURIComponent("/style-discovery")}`);
  }

  const { session: sessionId } = await searchParams;
  if (!sessionId) {
    redirect("/style-discovery");
  }

  return <StyleProfileView sessionId={sessionId} />;
}
