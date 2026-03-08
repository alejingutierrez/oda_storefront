"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bookmark, Check, Plus, X } from "lucide-react";
import { useSession } from "@descope/nextjs-sdk/client";

type UserList = {
  id: string;
  name: string;
  _count: { items: number };
  hasProduct: boolean;
};

type Props = {
  productId: string;
  className?: string;
};

export default function PdpAddToList({ productId, className }: Props) {
  const { isAuthenticated } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [lists, setLists] = useState<UserList[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newListName, setNewListName] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  const fetchLists = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/user/lists?productId=${productId}`);
      if (res.ok) {
        const data = await res.json();
        setLists(data.lists ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [productId]);

  const handleOpen = useCallback(() => {
    if (!isAuthenticated) {
      window.location.href = `/sign-in?next=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    setIsOpen(true);
    fetchLists();
  }, [isAuthenticated, fetchLists]);

  const handleToggleItem = useCallback(
    async (listId: string, hasProduct: boolean) => {
      if (hasProduct) {
        await fetch(
          `/api/user/lists/${listId}/items?productId=${productId}`,
          { method: "DELETE" },
        );
      } else {
        await fetch(`/api/user/lists/${listId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId }),
        });
      }
      fetchLists();
    },
    [productId, fetchLists],
  );

  const handleCreateList = useCallback(async () => {
    if (!newListName.trim()) return;
    await fetch("/api/user/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newListName.trim() }),
    });
    setNewListName("");
    setCreating(false);
    fetchLists();
  }, [newListName, fetchLists]);

  const hasAny = lists.some((l) => l.hasProduct);

  return (
    <div ref={popoverRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={handleOpen}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition ${
          hasAny
            ? "border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
            : "border-[color:var(--oda-border)] text-[color:var(--oda-taupe)] hover:border-[color:var(--oda-ink)] hover:text-[color:var(--oda-ink)]"
        }`}
        aria-label="Guardar en lista"
        title="Guardar en lista"
      >
        <Bookmark
          className="h-4 w-4"
          fill={hasAny ? "currentColor" : "none"}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 bottom-full mb-2 z-50 w-56 rounded-xl border border-[color:var(--oda-border)] bg-white shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[color:var(--oda-border)] px-3 py-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--oda-taupe)]">
              Guardar en lista
            </span>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setCreating(false);
              }}
              className="text-[color:var(--oda-taupe)] hover:text-[color:var(--oda-ink)]"
              aria-label="Cerrar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* List items */}
          <div className="max-h-48 overflow-y-auto p-1.5">
            {loading ? (
              <p className="px-2.5 py-2 text-xs text-[color:var(--oda-taupe)]">
                Cargando...
              </p>
            ) : lists.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-[color:var(--oda-taupe)]">
                No tienes listas aún
              </p>
            ) : (
              lists.map((list) => (
                <button
                  key={list.id}
                  type="button"
                  onClick={() => handleToggleItem(list.id, list.hasProduct)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
                >
                  {list.hasProduct ? (
                    <Check className="h-4 w-4 shrink-0 text-[color:var(--oda-gold)]" />
                  ) : (
                    <span className="h-4 w-4 shrink-0" />
                  )}
                  <span className="truncate">{list.name}</span>
                  <span className="ml-auto text-[10px] text-[color:var(--oda-taupe)]">
                    {list._count.items}
                  </span>
                </button>
              ))
            )}
          </div>

          {/* Create new list */}
          <div className="border-t border-[color:var(--oda-border)] p-1.5">
            {creating ? (
              <div className="flex items-center gap-2 px-2">
                <input
                  type="text"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateList()}
                  placeholder="Nombre de la lista"
                  className="flex-1 border-b border-[color:var(--oda-border)] bg-transparent py-1 text-sm text-[color:var(--oda-ink)] outline-none placeholder:text-[color:var(--oda-taupe)]"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleCreateList}
                  className="text-[color:var(--oda-ink)] hover:text-[color:var(--oda-gold)]"
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[color:var(--oda-taupe)] transition hover:bg-[color:var(--oda-stone)] hover:text-[color:var(--oda-ink)]"
              >
                <Plus className="h-4 w-4" />
                Crear nueva lista
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
