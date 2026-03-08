"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SwipeStack from "@/components/style-discovery/SwipeStack";
import type { SwipeItem } from "@/lib/style-engine/types";

type Props = {
  sessionId: string;
};

export default function SwipePageClient({ sessionId }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<SwipeItem[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function loadItems() {
      try {
        const res = await fetch(`/api/style-sessions/${sessionId}/items`);
        if (!res.ok) {
          setError(true);
          return;
        }
        const data = await res.json();
        if (!data.items || data.items.length === 0) {
          setError(true);
          return;
        }
        setItems(data.items);
      } catch {
        setError(true);
      }
    }
    loadItems();
  }, [sessionId]);

  if (error) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[color:var(--oda-cream)] px-6">
        <p className="mb-4 text-center text-[color:var(--oda-taupe)]">
          No pudimos cargar las prendas. Intenta de nuevo.
        </p>
        <button
          onClick={() => router.push("/style-discovery")}
          className="rounded-xl bg-[color:var(--oda-ink)] px-6 py-3 text-sm font-semibold text-white"
        >
          Volver al inicio
        </button>
      </div>
    );
  }

  if (!items) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[color:var(--oda-cream)]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--oda-gold)] border-t-transparent" />
          <p className="text-sm text-[color:var(--oda-taupe)]">
            Preparando tu selección...
          </p>
        </div>
      </div>
    );
  }

  return <SwipeStack initialItems={items} sessionId={sessionId} />;
}
