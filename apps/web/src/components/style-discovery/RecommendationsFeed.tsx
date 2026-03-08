"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import RecommendationCard from "./RecommendationCard";
import type { ScoredProduct } from "@/lib/style-engine/types";

type Props = {
  sessionId: string;
};

export default function RecommendationsFeed({ sessionId }: Props) {
  const [topItems, setTopItems] = useState<ScoredProduct[]>([]);
  const [exploreItems, setExploreItems] = useState<ScoredProduct[]>([]);
  const [topPage, setTopPage] = useState(1);
  const [explorePage, setExplorePage] = useState(1);
  const [hasMoreTop, setHasMoreTop] = useState(true);
  const [hasMoreExplore, setHasMoreExplore] = useState(true);
  const [loadingTop, setLoadingTop] = useState(false);
  const [loadingExplore, setLoadingExplore] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const topSentinelRef = useRef<HTMLDivElement>(null);
  const exploreSentinelRef = useRef<HTMLDivElement>(null);

  const fetchItems = useCallback(
    async (tier: "top" | "explore", page: number) => {
      const res = await fetch(
        `/api/recommendations?sessionId=${sessionId}&tier=${tier}&page=${page}&limit=20`,
      );
      if (!res.ok) return { items: [], hasMore: false };
      return res.json() as Promise<{
        items: ScoredProduct[];
        hasMore: boolean;
      }>;
    },
    [sessionId],
  );

  // Initial load
  useEffect(() => {
    async function loadInitial() {
      const [topData, exploreData] = await Promise.all([
        fetchItems("top", 1),
        fetchItems("explore", 1),
      ]);
      setTopItems(topData.items);
      setHasMoreTop(topData.hasMore);
      setExploreItems(exploreData.items);
      setHasMoreExplore(exploreData.hasMore);
      setInitialLoaded(true);
    }
    loadInitial();
  }, [fetchItems]);

  // Infinite scroll for top items
  useEffect(() => {
    if (!topSentinelRef.current || !hasMoreTop) return;
    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (entry.isIntersecting && !loadingTop && hasMoreTop) {
          setLoadingTop(true);
          const nextPage = topPage + 1;
          const data = await fetchItems("top", nextPage);
          setTopItems((prev) => [...prev, ...data.items]);
          setHasMoreTop(data.hasMore);
          setTopPage(nextPage);
          setLoadingTop(false);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(topSentinelRef.current);
    return () => observer.disconnect();
  }, [topPage, hasMoreTop, loadingTop, fetchItems]);

  // Infinite scroll for explore items
  useEffect(() => {
    if (!exploreSentinelRef.current || !hasMoreExplore) return;
    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (entry.isIntersecting && !loadingExplore && hasMoreExplore) {
          setLoadingExplore(true);
          const nextPage = explorePage + 1;
          const data = await fetchItems("explore", nextPage);
          setExploreItems((prev) => [...prev, ...data.items]);
          setHasMoreExplore(data.hasMore);
          setExplorePage(nextPage);
          setLoadingExplore(false);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(exploreSentinelRef.current);
    return () => observer.disconnect();
  }, [explorePage, hasMoreExplore, loadingExplore, fetchItems]);

  if (!initialLoaded) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--oda-gold)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      {/* Top Matches */}
      {topItems.length > 0 && (
        <section>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {topItems.map((product) => (
              <RecommendationCard key={product.id} product={product} />
            ))}
          </div>
          <div ref={topSentinelRef} className="h-1" />
          {loadingTop && (
            <div className="flex justify-center py-6">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[color:var(--oda-gold)] border-t-transparent" />
            </div>
          )}
        </section>
      )}

      {/* Explore Section */}
      {exploreItems.length > 0 && (
        <section className="mt-10">
          <div className="mb-6 flex items-center gap-4">
            <div className="h-px flex-1 bg-[color:var(--oda-border)]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--oda-taupe)]">
              Descubre más estilos
            </span>
            <div className="h-px flex-1 bg-[color:var(--oda-border)]" />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {exploreItems.map((product) => (
              <RecommendationCard key={product.id} product={product} />
            ))}
          </div>
          <div ref={exploreSentinelRef} className="h-1" />
          {loadingExplore && (
            <div className="flex justify-center py-6">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[color:var(--oda-gold)] border-t-transparent" />
            </div>
          )}
        </section>
      )}

      {/* Empty state */}
      {topItems.length === 0 && exploreItems.length === 0 && (
        <div className="flex min-h-[50vh] flex-col items-center justify-center">
          <p className="text-sm text-[color:var(--oda-taupe)]">
            No encontramos recomendaciones por ahora. Intenta una nueva sesión.
          </p>
        </div>
      )}
    </div>
  );
}
