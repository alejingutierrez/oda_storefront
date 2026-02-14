"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSessionToken, useDescope, useSession, useUser } from "@descope/nextjs-sdk/client";

type ProfileUser = {
  id: string;
  email: string;
  displayName: string | null;
  fullName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  status: string;
  plan: string;
};

type FavoritePayload = {
  id: string;
  createdAt: string;
  product: {
    id: string;
    name: string;
    imageCoverUrl: string | null;
    sourceUrl: string | null;
    currency: string | null;
    brand: { id: string; name: string } | null;
  };
  variant: {
    id: string;
    price: string;
    currency: string;
    color: string | null;
    size: string | null;
  } | null;
};

type ListPayload = {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  createdAt: string;
  updatedAt: string;
  _count: { items: number };
};

type ListItemPayload = {
  id: string;
  position: number;
  createdAt: string;
  product: {
    id: string;
    name: string;
    imageCoverUrl: string | null;
    sourceUrl: string | null;
    currency: string | null;
    brand: { id: string; name: string } | null;
  };
  variant: {
    id: string;
    price: string;
    currency: string;
    color: string | null;
    size: string | null;
  } | null;
};

type Notice = { kind: "success" | "error"; message: string } | null;

function formatPrice(amount: string | null, currency: string | null) {
  if (!amount || Number(amount) <= 0) return "Consultar";
  const value = Number(amount);
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: currency || "COP",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency ?? "COP"} ${value.toFixed(0)}`;
  }
}

function getInitials(label: string) {
  const clean = label.trim();
  if (!clean) return "U";
  const parts = clean.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  const initials = `${first}${second}`.toUpperCase();
  return initials || "U";
}

function buildSignInHref(next: string) {
  const params = new URLSearchParams();
  params.set("next", next);
  return `/sign-in?${params.toString()}`;
}

function FavoriteCard({
  favorite,
  lists,
  onRemove,
  onAddToList,
  onCreateList,
  busy,
}: {
  favorite: FavoritePayload;
  lists: ListPayload[];
  onRemove: (favoriteId: string) => Promise<void>;
  onAddToList: (favorite: FavoritePayload, listId: string) => Promise<void>;
  onCreateList: (name: string) => Promise<ListPayload | null>;
  busy: boolean;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const [listPickerOpen, setListPickerOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!listPickerOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setListPickerOpen(false);
      if (detailsRef.current) detailsRef.current.open = false;
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [listPickerOpen]);

  const title = favorite.product.name;
  const brand = favorite.product.brand?.name ?? "Marca";
  const href = favorite.product.sourceUrl ?? "#";
  const picture = favorite.product.imageCoverUrl;
  const variantLabelParts = [favorite.variant?.color, favorite.variant?.size].filter(Boolean);
  const variantLabel = variantLabelParts.length > 0 ? variantLabelParts.join(" · ") : null;
  const price = favorite.variant?.price ?? null;
  const currency = favorite.variant?.currency ?? favorite.product.currency ?? "COP";

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-[color:var(--oda-border)] bg-white shadow-[0_16px_40px_rgba(23,21,19,0.08)]">
      <div className="grid gap-4 p-5 sm:grid-cols-[120px_1fr] sm:items-center">
        <a
          href={href}
          target={href.startsWith("http") ? "_blank" : undefined}
          rel={href.startsWith("http") ? "noreferrer" : undefined}
          className="relative block aspect-square w-full overflow-hidden rounded-xl bg-[color:var(--oda-stone)]"
        >
          {picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={picture}
              alt={title}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
              Sin imagen
            </div>
          )}
        </a>

        <div className="flex flex-col gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--oda-taupe)]">
              {brand}
            </p>
            <h3 className="mt-1 text-base font-semibold text-[color:var(--oda-ink)]">
              {title}
            </h3>
            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[color:var(--oda-ink-soft)]">
              {formatPrice(price, currency)}
              {variantLabel ? ` · ${variantLabel}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href={href}
              target={href.startsWith("http") ? "_blank" : undefined}
              rel={href.startsWith("http") ? "noreferrer" : undefined}
              className="rounded-full bg-[color:var(--oda-ink)] px-5 py-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-cream)]"
            >
              Ver en tienda
            </a>

            <details
              ref={detailsRef}
              className="relative"
              onToggle={(event) => setListPickerOpen(event.currentTarget.open)}
            >
              <summary className="cursor-pointer rounded-full border border-[color:var(--oda-ink)] px-5 py-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-ink)]">
                Guardar en lista
              </summary>
              {listPickerOpen ? (
                <button
                  type="button"
                  className="fixed inset-0 z-40 bg-black/40 lg:hidden"
                  aria-label="Cerrar listas"
                  onClick={() => {
                    setListPickerOpen(false);
                    if (detailsRef.current) detailsRef.current.open = false;
                  }}
                />
              ) : null}
              <div className="fixed inset-x-4 bottom-6 top-24 z-50 overflow-auto rounded-3xl border border-[color:var(--oda-border)] bg-white p-4 shadow-[0_30px_90px_rgba(23,21,19,0.30)] lg:absolute lg:left-0 lg:right-auto lg:top-full lg:bottom-auto lg:z-10 lg:mt-3 lg:w-[min(340px,90vw)] lg:rounded-2xl lg:p-4 lg:shadow-[0_24px_70px_rgba(23,21,19,0.18)]">
                <div className="mb-3 flex items-center justify-between gap-3 lg:hidden">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--oda-taupe)]">
                    Elige una lista
                  </p>
                  <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] text-sm font-semibold text-[color:var(--oda-ink)]"
                    aria-label="Cerrar"
                    onClick={() => {
                      setListPickerOpen(false);
                      if (detailsRef.current) detailsRef.current.open = false;
                    }}
                  >
                    ×
                  </button>
                </div>
                <p className="hidden text-[10px] uppercase tracking-[0.25em] text-[color:var(--oda-taupe)] lg:block">
                  Elige una lista
                </p>
                <div className="mt-3 grid gap-2">
                  {lists.length === 0 ? (
                    <p className="text-sm text-[color:var(--oda-ink-soft)]">
                      Aún no tienes listas.
                    </p>
                  ) : (
                    lists.map((list) => (
                      <button
                        key={list.id}
                        type="button"
                        disabled={busy}
                        className="flex items-center justify-between rounded-xl border border-[color:var(--oda-border)] px-3 py-2 text-left text-sm text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)] disabled:opacity-60"
                        onClick={async () => {
                          await onAddToList(favorite, list.id);
                          if (detailsRef.current) detailsRef.current.open = false;
                        }}
                      >
                        <span className="font-medium">{list.name}</span>
                        <span className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">
                          {list._count.items}
                        </span>
                      </button>
                    ))
                  )}
                </div>

                <div className="mt-4 border-t border-[color:var(--oda-border)] pt-4">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--oda-taupe)]">
                    Crear lista
                  </p>
                  <div className="mt-3 flex gap-2">
                    <input
                      value={newListName}
                      onChange={(event) => setNewListName(event.target.value)}
                      placeholder="Nombre de la lista"
                      className="w-full rounded-xl border border-[color:var(--oda-border)] bg-white px-3 py-2 text-base text-[color:var(--oda-ink)] lg:text-sm"
                    />
                    <button
                      type="button"
                      disabled={busy || creating}
                      className="rounded-xl bg-[color:var(--oda-ink)] px-3 py-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-cream)] disabled:opacity-60"
                      onClick={async () => {
                        const name = newListName.trim();
                        if (!name) return;
                        setCreating(true);
                        try {
                          const created = await onCreateList(name);
                          if (created) {
                            setNewListName("");
                            await onAddToList(favorite, created.id);
                            if (detailsRef.current) detailsRef.current.open = false;
                          }
                        } finally {
                          setCreating(false);
                        }
                      }}
                    >
                      Crear
                    </button>
                  </div>
                </div>
              </div>
            </details>

            <button
              type="button"
              disabled={busy}
              className="rounded-full border border-[color:var(--oda-border)] bg-white px-5 py-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-ink)] transition hover:border-[color:var(--oda-ink)] disabled:opacity-60"
              onClick={async () => onRemove(favorite.id)}
            >
              Quitar
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function PerfilClient() {
  const router = useRouter();
  const sdk = useDescope();
  const { isAuthenticated, isSessionLoading, sessionToken } = useSession();
  const { user, isUserLoading } = useUser();

  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [favorites, setFavorites] = useState<FavoritePayload[]>([]);
  const [lists, setLists] = useState<ListPayload[]>([]);
  const [activeTab, setActiveTab] = useState<"favs" | "lists">("favs");

  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [selectedListItems, setSelectedListItems] = useState<ListItemPayload[]>([]);

  const [displayName, setDisplayName] = useState("");
  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listItemsLoading, setListItemsLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const userLabel = useMemo(() => {
    if (user?.name) return user.name;
    if (profile?.displayName) return profile.displayName;
    if (profile?.email) return profile.email.split("@")[0] ?? profile.email;
    return "";
  }, [profile?.displayName, profile?.email, user?.name]);

  const avatarUrl =
    (typeof user?.picture === "string" && user.picture.length > 0 ? user.picture : null) ??
    profile?.avatarUrl ??
    null;

  const nextAfterSignIn = useMemo(() => "/perfil", []);

  const showNotice = (next: Notice) => {
    setNotice(next);
    if (!next) return;
    window.setTimeout(() => setNotice((current) => (current === next ? null : current)), 4500);
  };

  const authFetch = useCallback(
    async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      const token = (() => {
        const sdkToken = getSessionToken();
        if (typeof sdkToken === "string" && sdkToken.trim().length > 0) return sdkToken.trim();
        if (typeof sessionToken === "string" && sessionToken.trim().length > 0) return sessionToken.trim();
        return null;
      })();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers, credentials: "include" });
    },
    [sessionToken],
  );

  const handleUnauthorized = useCallback(async () => {
    try {
      await sdk.logout();
    } catch (error) {
      console.error("Perfil: fallo logout tras 401", error);
    }
    router.replace(`${buildSignInHref(nextAfterSignIn)}&error=unauthorized`);
  }, [nextAfterSignIn, router, sdk]);

  const loadProfile = useCallback(async () => {
    const res = await authFetch("/api/user/profile");
    if (res.status === 401) return null;
    if (!res.ok) throw new Error("profile_fetch_failed");
    const data = (await res.json()) as { user: ProfileUser };
    return data.user;
  }, [authFetch]);

  const loadFavorites = useCallback(async () => {
    const res = await authFetch("/api/user/favorites");
    if (res.status === 401) return null;
    if (!res.ok) throw new Error("favorites_fetch_failed");
    const data = (await res.json()) as { favorites: FavoritePayload[] };
    return data.favorites;
  }, [authFetch]);

  const loadLists = useCallback(async () => {
    const res = await authFetch("/api/user/lists");
    if (res.status === 401) return null;
    if (!res.ok) throw new Error("lists_fetch_failed");
    const data = (await res.json()) as { lists: ListPayload[] };
    return data.lists;
  }, [authFetch]);

  const loadListItems = useCallback(async (listId: string) => {
    const res = await authFetch(`/api/user/lists/${listId}/items`);
    if (res.status === 401) return null;
    if (!res.ok) throw new Error("list_items_fetch_failed");
    const data = (await res.json()) as { items: ListItemPayload[] };
    return data.items;
  }, [authFetch]);

  useEffect(() => {
    if (isSessionLoading || isUserLoading) return;
    if (!isAuthenticated) {
      router.replace(buildSignInHref(nextAfterSignIn));
      return;
    }
    // Puede haber un pequeño race justo despues de login/hard reload.
    // Evitamos pegarle a /api/user/* sin token para no provocar 401 y logout falso.
    const token = getSessionToken();
    if (!token || typeof token !== "string" || token.trim().length === 0) {
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [profileUser, favoritesPayload, listsPayload] = await Promise.all([
          loadProfile(),
          loadFavorites(),
          loadLists(),
        ]);

        if (cancelled) return;
        if (!profileUser || !favoritesPayload || !listsPayload) {
          await handleUnauthorized();
          return;
        }

        setProfile(profileUser);
        setFavorites(favoritesPayload);
        setLists(listsPayload);
        setDisplayName(profileUser.displayName ?? "");
        setFullName(profileUser.fullName ?? "");
        setBio(profileUser.bio ?? "");

        const defaultListId = listsPayload[0]?.id ?? null;
        setSelectedListId(defaultListId);
        if (defaultListId) {
          setListItemsLoading(true);
          try {
            const items = await loadListItems(defaultListId);
            if (!items) {
              await handleUnauthorized();
              return;
            }
            setSelectedListItems(items);
          } finally {
            setListItemsLoading(false);
          }
        } else {
          setSelectedListItems([]);
        }
      } catch (error) {
        console.error("Perfil: fallo cargando datos", error);
        showNotice({ kind: "error", message: "No pudimos cargar tu perfil. Reintenta." });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    handleUnauthorized,
    isAuthenticated,
    isSessionLoading,
    isUserLoading,
    loadFavorites,
    loadListItems,
    loadLists,
    loadProfile,
    nextAfterSignIn,
    router,
    sessionToken,
  ]);

  const selectedList = useMemo(() => {
    if (!selectedListId) return null;
    return lists.find((list) => list.id === selectedListId) ?? null;
  }, [lists, selectedListId]);

  const refreshListItems = async (listId: string) => {
    setListItemsLoading(true);
    try {
      const items = await loadListItems(listId);
      if (!items) {
        await handleUnauthorized();
        return;
      }
      setSelectedListItems(items);
    } catch (error) {
      console.error("Perfil: fallo cargando items de lista", error);
      showNotice({ kind: "error", message: "No pudimos cargar la lista. Reintenta." });
    } finally {
      setListItemsLoading(false);
    }
  };

  const handleSelectList = async (listId: string) => {
    setSelectedListId(listId);
    await refreshListItems(listId);
  };

  const createList = async (name: string) => {
    const res = await authFetch("/api/user/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, visibility: "private" }),
    });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error("list_create_failed");
    const data = (await res.json()) as { list: ListPayload };
    return data.list;
  };

  const handleCreateList = async (name: string) => {
    setBusy(true);
    try {
      const created = await createList(name);
      if (!created) {
        await handleUnauthorized();
        return null;
      }
      setLists((prev) => [{ ...created, _count: { items: 0 } }, ...prev]);
      setActiveTab("lists");
      setSelectedListId(created.id);
      await refreshListItems(created.id);
      showNotice({ kind: "success", message: "Lista creada." });
      return created;
    } catch (error) {
      console.error("Perfil: fallo creando lista", error);
      showNotice({ kind: "error", message: "No pudimos crear la lista." });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteList = async (listId: string) => {
    if (!confirm("¿Seguro que quieres borrar esta lista?")) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/user/lists/${listId}`, {
        method: "DELETE",
      });
      if (res.status === 401) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) throw new Error("list_delete_failed");

      let nextSelected: string | null = null;
      setLists((prev) => {
        const remaining = prev.filter((list) => list.id !== listId);
        if (selectedListId === listId) {
          nextSelected = remaining[0]?.id ?? null;
        }
        return remaining;
      });
      if (selectedListId === listId) {
        setSelectedListId(nextSelected);
        if (nextSelected) {
          await refreshListItems(nextSelected);
        } else {
          setSelectedListItems([]);
        }
      }
      showNotice({ kind: "success", message: "Lista eliminada." });
    } catch (error) {
      console.error("Perfil: fallo borrando lista", error);
      showNotice({ kind: "error", message: "No pudimos borrar la lista." });
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveListItem = async (itemId: string) => {
    if (!selectedListId) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/user/lists/${selectedListId}/items/${itemId}`, {
        method: "DELETE",
      });
      if (res.status === 401) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) throw new Error("list_item_delete_failed");

      setSelectedListItems((prev) => prev.filter((item) => item.id !== itemId));
      setLists((prev) =>
        prev.map((list) =>
          list.id === selectedListId
            ? { ...list, _count: { items: Math.max(0, list._count.items - 1) } }
            : list,
        ),
      );
      showNotice({ kind: "success", message: "Producto removido de la lista." });
    } catch (error) {
      console.error("Perfil: fallo removiendo item", error);
      showNotice({ kind: "error", message: "No pudimos remover el item." });
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveFavorite = async (favoriteId: string) => {
    setBusy(true);
    try {
      const res = await authFetch(`/api/user/favorites/${favoriteId}`, {
        method: "DELETE",
      });
      if (res.status === 401) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) throw new Error("favorite_delete_failed");
      setFavorites((prev) => prev.filter((fav) => fav.id !== favoriteId));
      showNotice({ kind: "success", message: "Quitado de favoritos." });
    } catch (error) {
      console.error("Perfil: fallo quitando favorito", error);
      showNotice({ kind: "error", message: "No pudimos quitar el favorito." });
    } finally {
      setBusy(false);
    }
  };

  const handleAddFavoriteToList = async (favorite: FavoritePayload, listId: string) => {
    setBusy(true);
    try {
      const res = await authFetch(`/api/user/lists/${listId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId: favorite.product.id,
          variantId: favorite.variant?.id ?? null,
        }),
      });
      if (res.status === 401) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) throw new Error("list_item_add_failed");

      // El endpoint puede devolver un item existente (sin crear). Para no desalinear contadores,
      // recargamos el listado desde servidor.
      const nextLists = await loadLists();
      if (!nextLists) {
        await handleUnauthorized();
        return;
      }
      setLists(nextLists);
      if (selectedListId === listId) {
        await refreshListItems(listId);
      }
      showNotice({ kind: "success", message: "Guardado en lista." });
    } catch (error) {
      console.error("Perfil: fallo agregando item", error);
      showNotice({ kind: "error", message: "No pudimos guardar en la lista." });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      const res = await authFetch("/api/user/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName, fullName, bio }),
      });
      if (res.status === 401) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) throw new Error("profile_save_failed");
      const data = (await res.json()) as { user: ProfileUser };
      setProfile(data.user);
      showNotice({ kind: "success", message: "Perfil actualizado." });
    } catch (error) {
      console.error("Perfil: fallo guardando", error);
      showNotice({ kind: "error", message: "No pudimos guardar tus cambios." });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    try {
      await sdk.logout();
    } catch (error) {
      console.error("Perfil: fallo logout", error);
    } finally {
      window.location.assign("/");
    }
  };

  const handleDeleteAccount = async () => {
    if (!confirm("¿Seguro que quieres borrar tu cuenta? Esta accion es irreversible.")) return;
    setBusy(true);
    try {
      const res = await authFetch("/api/user/delete", { method: "POST" });
      if (res.status === 401) {
        await handleUnauthorized();
        return;
      }
      await sdk.logout();
      window.location.assign("/");
    } catch (error) {
      console.error("Perfil: fallo borrando cuenta", error);
      showNotice({ kind: "error", message: "No pudimos borrar la cuenta." });
      setBusy(false);
    }
  };

  if (isSessionLoading || isUserLoading || loading) {
    return (
      <div className="oda-container py-14">
        <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-8 shadow-[0_20px_60px_rgba(23,21,19,0.08)]">
          <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--oda-taupe)]">
            Perfil
          </p>
          <p className="mt-3 text-sm text-[color:var(--oda-ink-soft)]">Cargando…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="oda-container py-14">
        <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-8 shadow-[0_20px_60px_rgba(23,21,19,0.08)]">
          <p className="text-sm text-[color:var(--oda-ink)]">
            Necesitas iniciar sesion para ver tu perfil.
          </p>
          <Link
            className="mt-4 inline-flex rounded-full bg-[color:var(--oda-ink)] px-5 py-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-cream)]"
            href={buildSignInHref(nextAfterSignIn)}
          >
            Ir a login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <section className="relative overflow-hidden border-b border-[color:var(--oda-border)] bg-[color:var(--oda-stone)]">
        <div className="oda-container relative py-12">
          <div className="absolute -left-24 top-6 h-52 w-52 rounded-full bg-[color:var(--oda-gold)] opacity-40 blur-3xl" />
          <div className="absolute -right-16 bottom-0 h-60 w-60 rounded-full bg-white opacity-50 blur-3xl" />

          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-center gap-5">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={userLabel ? `Avatar de ${userLabel}` : "Avatar"}
                  className="h-14 w-14 rounded-full border border-white/70 object-cover shadow-[0_20px_60px_rgba(23,21,19,0.18)]"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="grid h-14 w-14 place-items-center rounded-full border border-white/70 bg-white text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--oda-ink)] shadow-[0_20px_60px_rgba(23,21,19,0.14)]">
                  {getInitials(userLabel || "Usuario")}
                </div>
              )}
              <div>
                <p className="text-[10px] uppercase tracking-[0.28em] text-[color:var(--oda-taupe)]">
                  Perfil privado
                </p>
                <h1 className="mt-2 text-3xl font-semibold text-[color:var(--oda-ink)]">
                  {userLabel ? `Hola, ${userLabel}` : "Tu perfil"}
                </h1>
                <p className="mt-2 text-sm text-[color:var(--oda-ink-soft)]">
                  {profile?.email ?? ""}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy}
                className="rounded-full bg-[color:var(--oda-ink)] px-5 py-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-cream)] disabled:opacity-60"
                onClick={handleLogout}
              >
                Cerrar sesion
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded-full border border-[color:var(--oda-ink)] px-5 py-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-ink)] disabled:opacity-60"
                onClick={handleDeleteAccount}
              >
                Borrar cuenta
              </button>
            </div>
          </div>

          <div className="relative mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/60 bg-white/75 p-4 backdrop-blur">
              <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--oda-taupe)]">
                Favoritos
              </p>
              <p className="mt-2 text-2xl font-semibold text-[color:var(--oda-ink)]">
                {favorites.length}
              </p>
            </div>
            <div className="rounded-2xl border border-white/60 bg-white/75 p-4 backdrop-blur">
              <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--oda-taupe)]">
                Listas
              </p>
              <p className="mt-2 text-2xl font-semibold text-[color:var(--oda-ink)]">
                {lists.length}
              </p>
            </div>
            <div className="rounded-2xl border border-white/60 bg-white/75 p-4 backdrop-blur">
              <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--oda-taupe)]">
                Plan
              </p>
              <p className="mt-2 text-2xl font-semibold text-[color:var(--oda-ink)]">
                {profile?.plan ?? "free"}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="oda-container grid gap-10 py-12 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="flex flex-col gap-6">
          {notice ? (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${
                notice.kind === "success"
                  ? "border-[color:var(--oda-border)] bg-white text-[color:var(--oda-ink)]"
                  : "border-[color:var(--oda-ink)] bg-[color:var(--oda-stone)] text-[color:var(--oda-ink)]"
              }`}
              role="status"
            >
              {notice.message}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--oda-taupe)]">
                Tu coleccion
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-[color:var(--oda-ink)]">
                Guardados
              </h2>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-[color:var(--oda-border)] bg-white p-1">
              <button
                type="button"
                className={`rounded-full px-4 py-2 text-[10px] uppercase tracking-[0.22em] ${
                  activeTab === "favs"
                    ? "bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                    : "text-[color:var(--oda-ink)]"
                }`}
                onClick={() => setActiveTab("favs")}
              >
                Favoritos
              </button>
              <button
                type="button"
                className={`rounded-full px-4 py-2 text-[10px] uppercase tracking-[0.22em] ${
                  activeTab === "lists"
                    ? "bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                    : "text-[color:var(--oda-ink)]"
                }`}
                onClick={() => setActiveTab("lists")}
              >
                Listas
              </button>
            </div>
          </div>

          {activeTab === "favs" ? (
            favorites.length === 0 ? (
              <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-8 shadow-[0_20px_60px_rgba(23,21,19,0.08)]">
                <p className="text-sm text-[color:var(--oda-ink)]">
                  Aún no tienes favoritos.
                </p>
                <p className="mt-2 text-sm text-[color:var(--oda-ink-soft)]">
                  Explora el catálogo y guarda lo que te guste para volver después.
                </p>
                <Link
                  href="/catalogo"
                  className="mt-5 inline-flex rounded-full bg-[color:var(--oda-ink)] px-5 py-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-cream)]"
                >
                  Ir a catalogo
                </Link>
              </div>
            ) : (
              <div className="grid gap-5">
                {favorites.map((favorite) => (
                  <FavoriteCard
                    key={favorite.id}
                    favorite={favorite}
                    lists={lists}
                    onRemove={handleRemoveFavorite}
                    onAddToList={handleAddFavoriteToList}
                    onCreateList={handleCreateList}
                    busy={busy}
                  />
                ))}
              </div>
            )
          ) : (
            <div className="grid gap-6">
              <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-6 shadow-[0_20px_60px_rgba(23,21,19,0.08)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--oda-taupe)]">
                      Listas
                    </p>
                    <h3 className="mt-2 text-lg font-semibold text-[color:var(--oda-ink)]">
                      Organiza tus guardados
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-full bg-[color:var(--oda-ink)] px-5 py-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-cream)] disabled:opacity-60"
                    onClick={async () => {
                      const name = prompt("Nombre de la nueva lista:");
                      if (!name) return;
                      await handleCreateList(name);
                    }}
                  >
                    Crear lista
                  </button>
                </div>

                {lists.length === 0 ? (
                  <p className="mt-4 text-sm text-[color:var(--oda-ink-soft)]">
                    No tienes listas aún. Crea una para guardar productos por ocasión o estilo.
                  </p>
                ) : (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {lists.map((list) => {
                      const active = list.id === selectedListId;
                      return (
                        <button
                          key={list.id}
                          type="button"
                          disabled={busy}
                          className={`rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.22em] disabled:opacity-60 ${
                            active
                              ? "border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                              : "border-[color:var(--oda-border)] bg-[color:var(--oda-stone)] text-[color:var(--oda-ink)]"
                          }`}
                          onClick={() => handleSelectList(list.id)}
                        >
                          {list.name} · {list._count.items}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {selectedList ? (
                <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-6 shadow-[0_20px_60px_rgba(23,21,19,0.08)]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--oda-taupe)]">
                        Lista seleccionada
                      </p>
                      <h3 className="mt-2 text-xl font-semibold text-[color:var(--oda-ink)]">
                        {selectedList.name}
                      </h3>
                      {selectedList.description ? (
                        <p className="mt-2 text-sm text-[color:var(--oda-ink-soft)]">
                          {selectedList.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-full border border-[color:var(--oda-ink)] px-5 py-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-ink)] disabled:opacity-60"
                        onClick={async () => {
                          const next = prompt("Nuevo nombre:", selectedList.name);
                          if (!next) return;
                          setBusy(true);
                          try {
                            const res = await authFetch(`/api/user/lists/${selectedList.id}`, {
                              method: "PATCH",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({ name: next }),
                            });
                            if (res.status === 401) {
                              await handleUnauthorized();
                              return;
                            }
                            if (!res.ok) throw new Error("list_rename_failed");
                            const data = (await res.json()) as { list: ListPayload };
                            setLists((prev) => prev.map((l) => (l.id === data.list.id ? { ...l, ...data.list } : l)));
                            showNotice({ kind: "success", message: "Lista actualizada." });
                          } catch (error) {
                            console.error("Perfil: fallo renombrando lista", error);
                            showNotice({ kind: "error", message: "No pudimos renombrar la lista." });
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Renombrar
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-full bg-[color:var(--oda-ink)] px-5 py-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-cream)] disabled:opacity-60"
                        onClick={() => handleDeleteList(selectedList.id)}
                      >
                        Borrar lista
                      </button>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-4">
                    {listItemsLoading ? (
                      <p className="text-sm text-[color:var(--oda-ink-soft)]">Cargando items…</p>
                    ) : selectedListItems.length === 0 ? (
                      <div className="rounded-xl border border-[color:var(--oda-border)] bg-[color:var(--oda-stone)] p-4">
                        <p className="text-sm text-[color:var(--oda-ink)]">
                          Esta lista está vacía.
                        </p>
                        <p className="mt-2 text-sm text-[color:var(--oda-ink-soft)]">
                          Abre tus favoritos y usa “Guardar en lista”.
                        </p>
                      </div>
                    ) : (
                      selectedListItems.map((item) => (
                        <div
                          key={item.id}
                          className="flex flex-col gap-3 rounded-2xl border border-[color:var(--oda-border)] p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex items-center gap-4">
                            <div className="h-14 w-14 overflow-hidden rounded-xl bg-[color:var(--oda-stone)]">
                              {item.product.imageCoverUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={item.product.imageCoverUrl}
                                  alt={item.product.name}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                />
                              ) : null}
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                                {item.product.brand?.name ?? "Marca"}
                              </p>
                              <p className="mt-1 text-sm font-medium text-[color:var(--oda-ink)]">
                                {item.product.name}
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <a
                              href={item.product.sourceUrl ?? "#"}
                              target={item.product.sourceUrl?.startsWith("http") ? "_blank" : undefined}
                              rel={item.product.sourceUrl?.startsWith("http") ? "noreferrer" : undefined}
                              className="rounded-full border border-[color:var(--oda-ink)] px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-ink)]"
                            >
                              Ver
                            </a>
                            <button
                              type="button"
                              disabled={busy}
                              className="rounded-full bg-[color:var(--oda-ink)] px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-cream)] disabled:opacity-60"
                              onClick={() => handleRemoveListItem(item.id)}
                            >
                              Quitar
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-6">
          <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-8 shadow-[0_20px_60px_rgba(23,21,19,0.08)]">
            <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--oda-taupe)]">
              Ajustes
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-[color:var(--oda-ink)]">
              Tu informacion
            </h2>

            <div className="mt-6 grid gap-4">
              <label className="grid gap-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                Nombre para mostrar
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="rounded-xl border border-[color:var(--oda-border)] px-4 py-3 text-sm text-[color:var(--oda-ink)]"
                  placeholder="Tu nombre"
                />
              </label>

              <label className="grid gap-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                Nombre completo
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  className="rounded-xl border border-[color:var(--oda-border)] px-4 py-3 text-sm text-[color:var(--oda-ink)]"
                  placeholder="Nombre y apellido"
                />
              </label>

              <label className="grid gap-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                Biografia
                <textarea
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  className="min-h-[120px] rounded-xl border border-[color:var(--oda-border)] px-4 py-3 text-sm text-[color:var(--oda-ink)]"
                  placeholder="Cuéntanos sobre tu estilo"
                />
              </label>

              <button
                type="button"
                disabled={busy || savingProfile}
                className="rounded-full bg-[color:var(--oda-ink)] px-6 py-3 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-cream)] disabled:opacity-60"
                onClick={handleSaveProfile}
              >
                {savingProfile ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
