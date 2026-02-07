"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDescope, useSession } from "@descope/nextjs-sdk/client";

type FavoriteKey = string;

type FavoriteRecord = {
  id: string;
  product: { id: string };
  variant: { id: string } | null;
};

type FavoritesResponse = {
  favorites: FavoriteRecord[];
};

type ToggleResult =
  | { action: "added"; favoriteId: string }
  | { action: "removed"; favoriteId: null };

type FavoritesContextValue = {
  loaded: boolean;
  getFavoriteId: (productId: string, variantId?: string | null) => string | null;
  toggleFavorite: (productId: string, variantId?: string | null) => Promise<ToggleResult>;
  refresh: () => Promise<void>;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

function makeKey(productId: string, variantId?: string | null): FavoriteKey {
  return `${productId}::${variantId ?? ""}`;
}

export function useFavorites() {
  return useContext(FavoritesContext);
}

export default function FavoritesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const sdk = useDescope();
  const { isAuthenticated, isSessionLoading, sessionToken } = useSession();

  const [loaded, setLoaded] = useState(false);
  const [favoritesByKey, setFavoritesByKey] = useState<Record<FavoriteKey, string>>({});
  const favoritesRef = useRef(favoritesByKey);

  useEffect(() => {
    favoritesRef.current = favoritesByKey;
  }, [favoritesByKey]);

  const authHeader = useMemo(() => {
    if (!sessionToken || typeof sessionToken !== "string") return null;
    return `Bearer ${sessionToken}`;
  }, [sessionToken]);

  const getFavoriteId = useCallback(
    (productId: string, variantId?: string | null) => {
      const key = makeKey(productId, variantId);
      return favoritesByKey[key] ?? null;
    },
    [favoritesByKey],
  );

  const refresh = useCallback(async () => {
    if (isSessionLoading) return;

    if (!isAuthenticated) {
      setFavoritesByKey({});
      setLoaded(true);
      return;
    }

    setLoaded(false);
    try {
      const headers: HeadersInit = authHeader ? { Authorization: authHeader } : {};
      const res = await fetch("/api/user/favorites", {
        headers,
        credentials: "include",
      });

      if (res.status === 401) {
        try {
          await sdk.logout();
        } catch (error) {
          console.error("FavoritesProvider: fallo logout tras 401", error);
        }
        setFavoritesByKey({});
        setLoaded(true);
        return;
      }

      if (!res.ok) {
        console.error("FavoritesProvider: fallo cargando favoritos", { status: res.status });
        setLoaded(true);
        return;
      }

      const data = (await res.json()) as FavoritesResponse;
      const next: Record<FavoriteKey, string> = {};
      for (const favorite of data.favorites ?? []) {
        const key = makeKey(favorite.product.id, favorite.variant?.id ?? null);
        // Si hay duplicados (no esperado), mantenemos el primero (orden desc por createdAt).
        if (!next[key]) next[key] = favorite.id;
      }
      setFavoritesByKey(next);
    } catch (error) {
      console.error("FavoritesProvider: error cargando favoritos", error);
    } finally {
      setLoaded(true);
    }
  }, [authHeader, isAuthenticated, isSessionLoading, sdk]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleFavorite = useCallback(
    async (productId: string, variantId?: string | null): Promise<ToggleResult> => {
      if (isSessionLoading) {
        throw new Error("session_loading");
      }
      if (!isAuthenticated) {
        throw new Error("unauthorized");
      }

      const key = makeKey(productId, variantId);
      const existingId = favoritesRef.current[key] ?? null;
      const headersBase: HeadersInit = authHeader ? { Authorization: authHeader } : {};

      if (existingId) {
        const res = await fetch(`/api/user/favorites/${existingId}`, {
          method: "DELETE",
          headers: headersBase,
          credentials: "include",
        });

        if (res.status === 401) {
          try {
            await sdk.logout();
          } catch (error) {
            console.error("FavoritesProvider: fallo logout tras 401 (delete)", error);
          }
          setFavoritesByKey({});
          setLoaded(true);
          throw new Error("unauthorized");
        }

        if (!res.ok) {
          throw new Error("favorite_delete_failed");
        }

        setFavoritesByKey((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });

        return { action: "removed", favoriteId: null };
      }

      const res = await fetch("/api/user/favorites", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(headersBase ?? {}),
        },
        credentials: "include",
        body: JSON.stringify({ productId, variantId: variantId ?? null }),
      });

      if (res.status === 401) {
        try {
          await sdk.logout();
        } catch (error) {
          console.error("FavoritesProvider: fallo logout tras 401 (create)", error);
        }
        setFavoritesByKey({});
        setLoaded(true);
        throw new Error("unauthorized");
      }

      if (!res.ok) {
        throw new Error("favorite_add_failed");
      }

      const data = (await res.json()) as { favorite?: { id?: string } };
      const favoriteId = data.favorite?.id;
      if (!favoriteId) {
        throw new Error("favorite_add_missing_id");
      }

      setFavoritesByKey((prev) => ({ ...prev, [key]: favoriteId }));
      return { action: "added", favoriteId };
    },
    [authHeader, isAuthenticated, isSessionLoading, sdk],
  );

  const value = useMemo<FavoritesContextValue>(
    () => ({
      loaded,
      getFavoriteId,
      toggleFavorite,
      refresh,
    }),
    [getFavoriteId, loaded, refresh, toggleFavorite],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

