"use client";

import { useEffect, useRef, useState } from "react";

export function useGalleryScroll() {
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadingRef = useRef(false);

  /* keep ref in sync so the observer callback sees fresh values */
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const loadingMoreRef = useRef(loadingMore);
  loadingMoreRef.current = loadingMore;

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          hasMoreRef.current &&
          !loadingRef.current &&
          !loadingMoreRef.current
        ) {
          setPage((p) => p + 1);
        }
      },
      { rootMargin: "400px" },
    );

    if (sentinelRef.current) {
      observerRef.current.observe(sentinelRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [hasMore, loadingMore]);

  const resetScroll = () => {
    setPage(1);
    setHasMore(false);
    setLoadingMore(false);
  };

  return {
    page,
    setPage,
    hasMore,
    setHasMore,
    loadingMore,
    setLoadingMore,
    loadingRef,
    sentinelRef,
    resetScroll,
  };
}
