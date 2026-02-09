"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { CatalogProduct } from "@/lib/catalog-data";

export type CompareItem = CatalogProduct;

type CompareContextValue = {
  items: CompareItem[];
  notice: string | null;
  isSelected: (productId: string) => boolean;
  toggle: (item: CompareItem) => void;
  remove: (productId: string) => void;
  clear: () => void;
};

const CompareContext = createContext<CompareContextValue | null>(null);

export function useCompare() {
  return useContext(CompareContext);
}

const STORAGE_KEY = "oda_compare_v1";
const MAX_ITEMS = 3;

function readStored(): CompareItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object" && typeof item.id === "string")
      .slice(0, MAX_ITEMS) as CompareItem[];
  } catch {
    return [];
  }
}

function writeStored(items: CompareItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // ignore
  }
}

export default function CompareProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CompareItem[]>(() => readStored());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    writeStored(items);
  }, [items]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const value = useMemo<CompareContextValue>(() => {
    const isSelected = (productId: string) => items.some((item) => item.id === productId);

    const remove = (productId: string) => {
      setItems((prev) => prev.filter((item) => item.id !== productId));
    };

    const clear = () => setItems([]);

    const toggle = (item: CompareItem) => {
      setItems((prev) => {
        const exists = prev.some((entry) => entry.id === item.id);
        if (exists) return prev.filter((entry) => entry.id !== item.id);
        if (prev.length >= MAX_ITEMS) {
          setNotice(`Máximo ${MAX_ITEMS} productos para comparar.`);
          return prev;
        }
        return [...prev, item];
      });
    };

    return { items, notice, isSelected, toggle, remove, clear };
  }, [items, notice]);

  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}

