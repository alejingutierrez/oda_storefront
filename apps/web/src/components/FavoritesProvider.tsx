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
import { getSessionToken, useDescope, useSession } from "@descope/nextjs-sdk/client";

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

const FAVORITES_CACHE_KEY = "oda_favorites_cache_v1";

type PersistedFavorites = {
  version: 1;
  ts: number;
  favoritesByKey: Record<FavoriteKey, string>;
};

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
  const hydratedRef = useRef(false);

  useEffect(() => {
    favoritesRef.current = favoritesByKey;
  }, [favoritesByKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isSessionLoading) return;
    if (!isAuthenticated) {
      hydratedRef.current = false;
      try {
        window.sessionStorage.removeItem(FAVORITES_CACHE_KEY);
      } catch {
        // ignore
      }
      return;
    }

    if (hydratedRef.current) return;
    hydratedRef.current = true;
    try {
      const raw = window.sessionStorage.getItem(FAVORITES_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistedFavorites> | null;
      if (!parsed || parsed.version !== 1) return;
      if (typeof parsed.ts !== "number") return;
      if (!parsed.favoritesByKey || typeof parsed.favoritesByKey !== "object") return;
      // Cache corta: solo para evitar "flash" en recargas/back navigation.
      if (Date.now() - parsed.ts > 1000 * 60 * 45) return;
      setFavoritesByKey(parsed.favoritesByKey as Record<FavoriteKey, string>);
    } catch {
      // ignore
    }
  }, [isAuthenticated, isSessionLoading]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isSessionLoading) return;
    if (!isAuthenticated) return;
    try {
      const payload: PersistedFavorites = {
        version: 1,
        ts: Date.now(),
        favoritesByKey,
      };
      window.sessionStorage.setItem(FAVORITES_CACHE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [favoritesByKey, isAuthenticated, isSessionLoading]);

  const readToken = useCallback(() => {
    const sdkToken = getSessionToken();
    if (typeof sdkToken === "string" && sdkToken.trim().length > 0) return sdkToken.trim();
    if (typeof sessionToken === "string" && sessionToken.trim().length > 0) return sessionToken.trim();
    return null;
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

    const token = readToken();
    if (!token) {
      // Evitamos tratarlo como 401 real: puede ser un race justo después de login/hard reload.
      // Dejamos el cache local y reintentamos cuando `sessionToken`/SDK emitan el token.
      setLoaded(true);
      return;
    }

    setLoaded(false);
    try {
      const headers: HeadersInit = { Authorization: `Bearer ${token}` };
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
  }, [isAuthenticated, isSessionLoading, readToken, sdk]);

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
      const token = readToken();
      if (!token) {
        throw new Error("session_loading");
      }
      const headersBase: HeadersInit = { Authorization: `Bearer ${token}` };

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
    [isAuthenticated, isSessionLoading, readToken, sdk],
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
