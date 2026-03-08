import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/descope";
import RecommendationsFeed from "@/components/style-discovery/RecommendationsFeed";

export const metadata: Metadata = {
  title: "Tu Selección Diaria | ODA",
};

type Props = {
  searchParams: Promise<{ session?: string }>;
};

export default async function FeedPage({ searchParams }: Props) {
  const session = await requireUser();
  if (!session) {
    redirect(`/sign-in?next=${encodeURIComponent("/style-discovery")}`);
  }

  const { session: sessionId } = await searchParams;
  if (!sessionId) {
    redirect("/style-discovery");
  }

  return (
    <div className="min-h-[100dvh] bg-[color:var(--oda-cream)]">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="mb-8">
          <h1
            className="text-2xl font-bold text-[color:var(--oda-ink)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Tu Selección Diaria
          </h1>
          <p className="mt-1 text-sm text-[color:var(--oda-taupe)]">
            Tendencias curadas para ti
          </p>
        </div>

        <RecommendationsFeed sessionId={sessionId} />
      </div>
    </div>
  );
}
