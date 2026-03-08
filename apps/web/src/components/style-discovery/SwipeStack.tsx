"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDrag } from "@use-gesture/react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { X, Bookmark, Heart } from "lucide-react";
import SwipeCard from "./SwipeCard";
import type { SwipeItem, SwipeAction } from "@/lib/style-engine/types";
import { MIN_LIKES_THRESHOLD } from "@/lib/style-engine/types";

const SWIPE_THRESHOLD = 100;
const VELOCITY_THRESHOLD = 0.3;

type SwipeStackProps = {
  initialItems: SwipeItem[];
  sessionId: string;
};

export default function SwipeStack({ initialItems, sessionId }: SwipeStackProps) {
  const router = useRouter();
  const [items, setItems] = useState<SwipeItem[]>(initialItems);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalLikes, setTotalLikes] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [extending, setExtending] = useState(false);

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const offsetX = useTransform(x, (v) => v);

  const [currentOffsetX, setCurrentOffsetX] = useState(0);

  // Track offsetX for feedback labels
  offsetX.on("change", setCurrentOffsetX);

  const recordInteraction = useCallback(
    async (productId: string, action: SwipeAction, timeSpentMs?: number) => {
      try {
        const res = await fetch(
          `/api/style-sessions/${sessionId}/interactions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId, action, timeSpentMs }),
          },
        );
        if (res.ok) {
          const data = await res.json();
          setTotalLikes(data.totalLikes);
          return data.totalLikes as number;
        }
      } catch {
        // Fire and forget — don't block UI
      }
      return totalLikes;
    },
    [sessionId, totalLikes],
  );

  const extendDeck = useCallback(async () => {
    if (extending) return;
    setExtending(true);
    try {
      const res = await fetch(
        `/api/style-sessions/${sessionId}/items?extend=true`,
      );
      if (res.ok) {
        const data = await res.json();
        if (data.items.length > 0) {
          setItems((prev) => [...prev, ...data.items]);
        } else {
          // No more products available — proceed anyway
          router.push(`/style-discovery/refine?session=${sessionId}`);
        }
      }
    } catch {
      // If extend fails, proceed to refine
      router.push(`/style-discovery/refine?session=${sessionId}`);
    } finally {
      setExtending(false);
    }
  }, [extending, sessionId, router]);

  const handleSwipe = useCallback(
    async (action: SwipeAction) => {
      if (swiping || currentIndex >= items.length) return;
      setSwiping(true);

      const product = items[currentIndex];
      const direction = action === "dislike" ? -1 : 1;

      // Animate card out
      await animate(x, direction * 500, { duration: 0.3, ease: "easeOut" });

      // Record interaction (fire & forget but await for like count)
      const newLikes = await recordInteraction(product.id, action);

      // Move to next card
      x.set(0);
      setCurrentIndex((prev) => prev + 1);
      setSwiping(false);

      // Check if we need to extend or complete
      const nextIndex = currentIndex + 1;
      if (nextIndex >= items.length) {
        if (newLikes < MIN_LIKES_THRESHOLD) {
          // Auto-extend: load more items
          await extendDeck();
        } else {
          // Done — go to refinement
          router.push(`/style-discovery/refine?session=${sessionId}`);
        }
      }
    },
    [swiping, currentIndex, items, x, recordInteraction, router, sessionId, extendDeck],
  );

  const bind = useDrag(
    ({ active, movement: [mx], velocity: [vx], cancel }) => {
      if (swiping) {
        cancel();
        return;
      }

      if (active) {
        x.set(mx);
      } else {
        // Check if swipe threshold was met
        const isSwipe =
          Math.abs(mx) > SWIPE_THRESHOLD || vx > VELOCITY_THRESHOLD;
        if (isSwipe) {
          const action: SwipeAction = mx > 0 ? "like" : "dislike";
          handleSwipe(action);
        } else {
          // Snap back
          animate(x, 0, { type: "spring", stiffness: 300, damping: 30 });
        }
      }
    },
    { axis: "x", filterTaps: true },
  );

  const currentProduct = items[currentIndex];
  const progress = Math.min(currentIndex, items.length);
  const progressPercent = items.length > 0 ? (progress / items.length) * 100 : 0;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[color:var(--oda-cream)]">
      {/* Progress bar */}
      <div className="px-6 pt-4">
        <div className="flex items-center justify-between text-xs text-[color:var(--oda-taupe)]">
          <span>
            {progress} de {items.length}
          </span>
          <span>
            {totalLikes} {totalLikes === 1 ? "like" : "likes"}
          </span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[color:var(--oda-stone)]">
          <div
            className="h-full rounded-full bg-[color:var(--oda-gold)] transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Card stack */}
      <div className="relative mx-auto mt-6 flex flex-1 items-start justify-center px-6">
        <div className="relative aspect-[3/4] w-full max-w-[340px] sm:max-w-[400px] lg:max-w-[440px]">
          {/* Background cards (stack effect) */}
          {items.slice(currentIndex + 1, currentIndex + 3).map((item, i) => (
            <div
              key={item.id}
              className="absolute inset-0 overflow-hidden rounded-2xl bg-[color:var(--oda-stone)]"
              style={{
                transform: `scale(${1 - (i + 1) * 0.05}) translateY(${(i + 1) * 10}px)`,
                zIndex: 2 - i,
                opacity: 1 - (i + 1) * 0.15,
              }}
            >
              <SwipeCard product={item} />
            </div>
          ))}

          {/* Active card */}
          {currentProduct && (
            <div
              {...bind()}
              className="absolute inset-0 touch-none"
              style={{ zIndex: 3 }}
            >
              <motion.div
                className="h-full w-full"
                style={{ x, rotate }}
              >
                <SwipeCard product={currentProduct} offsetX={currentOffsetX} />
              </motion.div>
            </div>
          )}

          {/* Extending message */}
          {extending && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-[color:var(--oda-cream)]/90">
              <p className="text-center text-sm text-[color:var(--oda-taupe)]">
                Necesitamos conocerte un poco más...
                <br />
                Cargando más prendas.
              </p>
            </div>
          )}

          {/* Empty state */}
          {!currentProduct && !extending && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-[color:var(--oda-stone)]">
              <p className="text-center text-sm text-[color:var(--oda-taupe)]">
                Procesando tus preferencias...
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-center gap-6 pb-8 pt-4">
        <button
          onClick={() => handleSwipe("dislike")}
          disabled={swiping || !currentProduct}
          className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[color:var(--oda-love)] text-[color:var(--oda-love)] transition hover:bg-[color:var(--oda-love)]/10 active:scale-90 disabled:opacity-40"
          aria-label="Paso"
        >
          <X size={24} strokeWidth={2} />
        </button>

        <button
          onClick={() => handleSwipe("maybe")}
          disabled={swiping || !currentProduct}
          className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[color:var(--oda-taupe)] text-[color:var(--oda-taupe)] transition hover:bg-[color:var(--oda-taupe)]/10 active:scale-90 disabled:opacity-40"
          aria-label="Quizás"
        >
          <Bookmark size={20} strokeWidth={2} />
        </button>

        <button
          onClick={() => handleSwipe("like")}
          disabled={swiping || !currentProduct}
          className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[color:var(--oda-gold)] text-[color:var(--oda-gold)] transition hover:bg-[color:var(--oda-gold)]/10 active:scale-90 disabled:opacity-40"
          aria-label="Me gusta"
        >
          <Heart size={24} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
