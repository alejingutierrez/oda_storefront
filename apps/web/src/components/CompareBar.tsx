"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCompare } from "@/components/CompareProvider";

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

function formatPriceRange(minPrice: string | null, maxPrice: string | null, currency: string | null) {
  if (!minPrice && !maxPrice) return "Consultar";
  if (!maxPrice || minPrice === maxPrice) return formatPrice(minPrice ?? maxPrice, currency);
  return `${formatPrice(minPrice, currency)} · ${formatPrice(maxPrice, currency)}`;
}

export default function CompareBar() {
  const compare = useCompare();
  const [open, setOpen] = useState(false);

  const items = compare?.items ?? [];
  const notice = compare?.notice ?? null;
  const canCompare = items.length >= 2;

  const title = useMemo(() => {
    if (!items.length) return "";
    if (items.length === 1) return "1 producto listo";
    return `${items.length} productos listos`;
  }, [items.length]);

  if (!compare || items.length === 0) return null;

  return (
    <>
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-40 px-4 lg:bottom-6 lg:px-6">
        <div className="mx-auto flex w-full max-w-[1320px] items-center justify-between gap-3 rounded-2xl border border-[color:var(--oda-border)] bg-white/92 px-4 py-3 shadow-[0_30px_80px_rgba(23,21,19,0.18)] backdrop-blur">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
              Comparar
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-[color:var(--oda-ink)]">
              {title}
            </p>
          </div>

          <div className="hidden min-w-0 flex-1 items-center justify-center gap-2 lg:flex">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => compare.remove(item.id)}
                className="inline-flex max-w-[14rem] items-center gap-2 rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-3 py-1 text-xs text-[color:var(--oda-ink)]"
                title="Quitar"
              >
                <span className="truncate">{item.name}</span>
                <span className="text-[12px] leading-none text-[color:var(--oda-taupe)]" aria-hidden>
                  ×
                </span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => compare.clear()}
              className="hidden rounded-full border border-[color:var(--oda-border)] bg-white px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)] lg:inline-flex"
            >
              Limpiar
            </button>
            <button
              type="button"
              onClick={() => setOpen(true)}
              disabled={!canCompare}
              className="rounded-full bg-[color:var(--oda-ink)] px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--oda-cream)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Comparar
            </button>
          </div>
        </div>

        {notice ? (
          <div className="mx-auto mt-2 w-full max-w-[1320px] text-center">
            <span className="inline-flex rounded-full bg-[color:var(--oda-stone)] px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
              {notice}
            </span>
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Cerrar comparación"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-hidden rounded-t-3xl border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] shadow-[0_-30px_80px_rgba(23,21,19,0.30)] lg:inset-x-6 lg:bottom-6 lg:mx-auto lg:max-w-4xl lg:rounded-3xl">
            <div className="flex items-center justify-between gap-3 border-b border-[color:var(--oda-border)] bg-white px-5 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                  Comparación
                </p>
                <p className="mt-1 text-sm font-semibold text-[color:var(--oda-ink)]">
                  {items.length} productos
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
              >
                Cerrar
              </button>
            </div>

            <div className="max-h-[calc(85vh-5.5rem)] overflow-auto px-5 pb-6 pt-5">
              <div className="grid gap-4 md:grid-cols-3">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-4 shadow-[0_16px_40px_rgba(23,21,19,0.10)]"
                  >
                    <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--oda-taupe)]">
                      {item.brandName}
                    </p>
                    <p className="mt-2 line-clamp-2 text-sm font-semibold text-[color:var(--oda-ink)]">
                      {item.name}
                    </p>
                    <p className="mt-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)]">
                      {formatPriceRange(item.minPrice, item.maxPrice, item.currency)}
                    </p>

                    <div className="mt-4 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => compare.remove(item.id)}
                        className="rounded-full border border-[color:var(--oda-border)] bg-white px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]"
                      >
                        Quitar
                      </button>
                      {item.sourceUrl ? (
                        <Link
                          href={item.sourceUrl}
                          className="rounded-full bg-[color:var(--oda-ink)] px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-cream)]"
                        >
                          Ver tienda
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

