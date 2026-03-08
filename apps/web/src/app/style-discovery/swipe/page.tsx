import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/descope";
import SwipePageClient from "./SwipePageClient";

export const metadata: Metadata = {
  title: "Descubre Looks | ODA",
};

type Props = {
  searchParams: Promise<{ session?: string }>;
};

export default async function SwipePage({ searchParams }: Props) {
  const session = await requireUser();
  if (!session) {
    redirect(`/sign-in?next=${encodeURIComponent("/style-discovery")}`);
  }

  const { session: sessionId } = await searchParams;
  if (!sessionId) {
    redirect("/style-discovery");
  }

  return <SwipePageClient sessionId={sessionId} />;
}
