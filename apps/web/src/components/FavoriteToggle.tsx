"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@descope/nextjs-sdk/client";
import { useFavorites } from "@/components/FavoritesProvider";

type FavoriteToggleProps = {
  productId: string;
  variantId?: string | null;
  productName?: string | null;
  className?: string;
  ariaLabel?: string;
};

function buildSignInHref(next: string) {
  const params = new URLSearchParams();
  params.set("next", next);
  return `/sign-in?${params.toString()}`;
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.8 4.6c-1.4-1.4-3.6-1.4-5 0L12 8.4 8.2 4.6c-1.4-1.4-3.6-1.4-5 0s-1.4 3.6 0 5l3.8 3.8L12 21l5-7.6 3.8-3.8c1.4-1.4 1.4-3.6 0-5z" />
    </svg>
  );
}

export default function FavoriteToggle({
  productId,
  variantId,
  productName,
  className,
  ariaLabel,
}: FavoriteToggleProps) {
  const router = useRouter();
  const { isAuthenticated, isSessionLoading } = useSession();
  const favorites = useFavorites();
  const [saving, setSaving] = useState(false);
  const [pulse, setPulse] = useState(false);

  const favoriteId = favorites?.getFavoriteId(productId, variantId) ?? null;
  const favoritesLoaded = favorites?.loaded ?? true;

  const label = useMemo(() => {
    if (ariaLabel) return ariaLabel;
    return favoriteId ? "Quitar de favoritos" : "Guardar en favoritos";
  }, [ariaLabel, favoriteId]);

  useEffect(() => {
    if (!pulse) return;
    const timeout = window.setTimeout(() => setPulse(false), 700);
    return () => window.clearTimeout(timeout);
  }, [pulse]);

  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (isSessionLoading) return;
    if (!isAuthenticated) {
      const next =
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}${window.location.hash}`
          : "/catalogo";
      router.push(buildSignInHref(next));
      return;
    }

    if (saving) return;
    if (!favorites) return;
    setSaving(true);
    try {
      const wasFavorite = Boolean(favoriteId);
      const result = await favorites.toggleFavorite(productId, variantId);
      if (!wasFavorite && result.action === "added") {
        setPulse(true);
        try {
          window.dispatchEvent(
            new CustomEvent("oda:fav-added", {
              detail: {
                productId,
                variantId: variantId ?? null,
                productName: productName ?? null,
              },
            }),
          );
        } catch {
          // ignore
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === "unauthorized") {
        router.push(buildSignInHref("/catalogo"));
        return;
      }
      console.error("Favorite toggle failed", error);
    } finally {
      setSaving(false);
    }
  };

  const filled = Boolean(favoriteId);
  const baseClass =
    "inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/50 bg-white/70 text-[color:var(--oda-ink)] shadow-[0_18px_50px_rgba(23,21,19,0.16)] backdrop-blur transition hover:bg-white";
  const buttonClass = [baseClass, className, filled ? "text-[color:var(--oda-love)]" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={buttonClass}
      onClick={handleClick}
      aria-label={label}
      aria-pressed={filled}
      disabled={saving || (isAuthenticated && !favoritesLoaded)}
      title={isAuthenticated && !favoritesLoaded ? "Cargando favoritos…" : undefined}
    >
      <span
        className={[
          saving ? "opacity-40" : "",
          pulse ? "animate-[oda-heartbeat_650ms_ease-in-out] motion-reduce:animate-none" : "",
          "will-change-transform",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <HeartIcon filled={filled} />
      </span>
    </button>
  );
}
