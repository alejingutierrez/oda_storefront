import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/descope";
import PreferenceSelector from "@/components/style-discovery/PreferenceSelector";

export const metadata: Metadata = {
  title: "Refina Tu Gusto | ODA",
};

type Props = {
  searchParams: Promise<{ session?: string }>;
};

export default async function RefinePage({ searchParams }: Props) {
  const session = await requireUser();
  if (!session) {
    redirect(`/sign-in?next=${encodeURIComponent("/style-discovery")}`);
  }

  const { session: sessionId } = await searchParams;
  if (!sessionId) {
    redirect("/style-discovery");
  }

  return <PreferenceSelector sessionId={sessionId} />;
}
