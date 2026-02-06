"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@descope/nextjs-sdk/client";

type FavoriteToggleProps = {
  productId: string;
  variantId?: string | null;
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
  className,
  ariaLabel,
}: FavoriteToggleProps) {
  const router = useRouter();
  const { isAuthenticated, isSessionLoading } = useSession();
  const [favoriteId, setFavoriteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const label = useMemo(() => {
    if (ariaLabel) return ariaLabel;
    return favoriteId ? "Quitar de favoritos" : "Guardar en favoritos";
  }, [ariaLabel, favoriteId]);

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
    setSaving(true);
    try {
      if (favoriteId) {
        const res = await fetch(`/api/user/favorites/${favoriteId}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (res.status === 401) {
          router.push(buildSignInHref("/catalogo"));
          return;
        }
        if (!res.ok) throw new Error("favorite_delete_failed");
        setFavoriteId(null);
        return;
      }

      const res = await fetch("/api/user/favorites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ productId, variantId: variantId ?? null }),
      });
      if (res.status === 401) {
        router.push(buildSignInHref("/catalogo"));
        return;
      }
      if (!res.ok) throw new Error("favorite_add_failed");
      const data = (await res.json()) as { favorite: { id: string } };
      setFavoriteId(data.favorite?.id ?? null);
    } catch (error) {
      console.error("Favorite toggle failed", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      className={
        className ??
        "inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/50 bg-white/70 text-[color:var(--oda-ink)] shadow-[0_18px_50px_rgba(23,21,19,0.16)] backdrop-blur transition hover:bg-white"
      }
      onClick={handleClick}
      aria-label={label}
      disabled={saving}
    >
      <span className={saving ? "opacity-40" : ""}>
        <HeartIcon filled={Boolean(favoriteId)} />
      </span>
    </button>
  );
}

