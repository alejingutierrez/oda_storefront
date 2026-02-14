"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCompare } from "@/components/CompareProvider";
import { proxiedImageUrl } from "@/lib/image-proxy";

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

type CompareDetailsItem = {
  id: string;
  brandName: string;
  imageCoverUrl: string | null;
  sourceUrl: string | null;
  minPrice: string | null;
  maxPrice: string | null;
  currency: string | null;
  materials: string[];
  sizes: string[];
};

const IMAGE_BLUR_DATA_URL =
  "data:image/gif;base64,R0lGODlhAQABAPAAAP///wAAACwAAAAAAQABAEACAkQBADs=";

function isUnoptimized(src: string | null) {
  if (!src) return false;
  return src.startsWith("/api/image-proxy");
}

function ValueChips({ values }: { values: string[] }) {
  if (!values || values.length === 0) {
    return <span className="text-sm text-[color:var(--oda-taupe)]">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <span
          key={value}
          className="inline-flex rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-2.5 py-0.5 text-[11px] text-[color:var(--oda-ink)]"
        >
          {value}
        </span>
      ))}
    </div>
  );
}

export default function CompareBar() {
  const compare = useCompare();
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<CompareDetailsItem[] | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const items = compare?.items ?? [];
  const notice = compare?.notice ?? null;
  const canCompare = items.length >= 2;

  const title = useMemo(() => {
    if (!items.length) return "";
    if (items.length === 1) return "1 producto listo";
    return `${items.length} productos listos`;
  }, [items.length]);

  const idsKey = useMemo(() => items.map((item) => item.id).join(","), [items]);

  useEffect(() => {
    if (!open) return;
    if (!idsKey) return;

    const controller = new AbortController();
    setDetailsLoading(true);

    void (async () => {
      try {
        const res = await fetch(`/api/catalog/compare-details?ids=${encodeURIComponent(idsKey)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("No se pudieron cargar detalles");
        const payload = (await res.json()) as { items?: CompareDetailsItem[] };
        setDetails(Array.isArray(payload.items) ? payload.items : []);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.warn(err);
        setDetails([]);
      } finally {
        if (!controller.signal.aborted) setDetailsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [idsKey, open]);

  const detailsById = useMemo(() => {
    const map = new Map<string, CompareDetailsItem>();
    for (const row of details ?? []) map.set(row.id, row);
    return map;
  }, [details]);

  const colsTemplate = useMemo(() => `150px repeat(${Math.max(1, items.length)}, minmax(0, 1fr))`, [items.length]);

  if (!compare || items.length === 0) return null;

  return (
    <>
      <div className="fixed inset-x-0 bottom-[calc(var(--oda-mobile-dock-h)+var(--oda-mobile-dock-gap))] z-40 px-4 lg:bottom-6 lg:px-6">
        <div className="mx-auto flex w-full max-w-[1320px] items-center justify-between gap-3 rounded-xl border border-[color:var(--oda-border)] bg-white/92 px-3 py-2 shadow-[0_24px_70px_rgba(23,21,19,0.16)] backdrop-blur">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
              Comparar
            </p>
            <p className="mt-1 truncate text-[13px] font-semibold text-[color:var(--oda-ink)]">
              {title}
            </p>
          </div>

          <div className="hidden min-w-0 flex-1 items-center justify-center gap-2 lg:flex">
            {items.map((item) => {
              const src =
                proxiedImageUrl(item.imageCoverUrl, { productId: item.id, kind: "cover" }) ??
                item.imageCoverUrl;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => compare.remove(item.id)}
                  className="inline-flex max-w-[12rem] items-center gap-2 rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-2.5 py-1 text-[11px] text-[color:var(--oda-ink)]"
                  title="Quitar"
                >
                  <span className="relative h-5 w-5 overflow-hidden rounded-full bg-[color:var(--oda-stone)]">
                    {src ? (
                      <Image
                        src={src}
                        alt=""
                        fill
                        unoptimized={isUnoptimized(src)}
                        className="object-cover object-center"
                        placeholder="blur"
                        blurDataURL={IMAGE_BLUR_DATA_URL}
                      />
                    ) : null}
                  </span>
                  <span className="truncate">{item.brandName}</span>
                  <span className="text-[12px] leading-none text-[color:var(--oda-taupe)]" aria-hidden>
                    ×
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => compare.clear()}
              className="hidden rounded-full border border-[color:var(--oda-border)] bg-white px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)] lg:inline-flex"
            >
              Limpiar
            </button>
            <button
              type="button"
              onClick={() => setOpen(true)}
              disabled={!canCompare}
              className="rounded-full bg-[color:var(--oda-ink)] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--oda-cream)] disabled:cursor-not-allowed disabled:opacity-60"
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
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-hidden rounded-t-3xl border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] shadow-[0_-30px_80px_rgba(23,21,19,0.30)] lg:inset-x-6 lg:bottom-6 lg:mx-auto lg:max-w-5xl lg:rounded-3xl">
            <div className="flex items-center justify-between gap-3 border-b border-[color:var(--oda-border)] bg-white px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                  Comparación
                </p>
                <p className="mt-1 text-[13px] font-semibold text-[color:var(--oda-ink)]">
                  {items.length} productos
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-3 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
              >
                Cerrar
              </button>
            </div>

            <div className="max-h-[calc(85vh-5.25rem)] overflow-auto px-4 pb-5 pt-4">
              {detailsLoading && !details ? (
                <div className="grid gap-4 md:grid-cols-3">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-4 shadow-[0_16px_40px_rgba(23,21,19,0.10)]"
                    >
                      <div className="aspect-square w-full rounded-xl bg-[color:var(--oda-stone)]" />
                      <div className="mt-4 grid gap-2">
                        <div className="h-3 w-20 rounded-full bg-[color:var(--oda-stone)]" />
                        <div className="h-4 w-32 rounded-full bg-[color:var(--oda-stone)]" />
                        <div className="h-3 w-24 rounded-full bg-[color:var(--oda-stone)]" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="hidden lg:block">
                <div className="grid gap-3" style={{ gridTemplateColumns: colsTemplate }}>
                  <div />
                  {items.map((item) => {
                    const info = detailsById.get(item.id);
                    const cover = proxiedImageUrl(info?.imageCoverUrl ?? item.imageCoverUrl, {
                      productId: item.id,
                      kind: "cover",
                    });
                    const src = cover ?? info?.imageCoverUrl ?? item.imageCoverUrl;
                    return (
                      <div key={item.id} className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--oda-taupe)]">
                              {info?.brandName ?? item.brandName}
                            </p>
                            <p className="mt-2 text-[13px] font-semibold text-[color:var(--oda-ink)]">
                              {formatPriceRange(
                                info?.minPrice ?? item.minPrice,
                                info?.maxPrice ?? item.maxPrice,
                                info?.currency ?? item.currency,
                              )}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => compare.remove(item.id)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-white text-[color:var(--oda-taupe)] transition hover:bg-[color:var(--oda-stone)]"
                            aria-label="Quitar"
                            title="Quitar"
                          >
                            ×
                          </button>
                        </div>

                        <div className="mt-4 overflow-hidden rounded-xl bg-[color:var(--oda-stone)]">
                          <div className="relative aspect-[3/4] w-full">
                            {src ? (
                              <Image
                                src={src}
                                alt=""
                                fill
                                unoptimized={isUnoptimized(src)}
                                className="object-cover object-center"
                                placeholder="blur"
                                blurDataURL={IMAGE_BLUR_DATA_URL}
                              />
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-4 flex items-center justify-between gap-2">
                          {info?.sourceUrl ?? item.sourceUrl ? (
                            <Link
                              href={(info?.sourceUrl ?? item.sourceUrl)!}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="rounded-full bg-[color:var(--oda-ink)] px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-cream)]"
                            >
                              Ver tienda
                            </Link>
                          ) : (
                            <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                              Sin enlace
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: colsTemplate }}>
                  <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                      Materiales
                    </p>
                  </div>
                  {items.map((item) => {
                    const info = detailsById.get(item.id);
                    return (
                      <div key={`${item.id}:materials`} className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-3">
                        <ValueChips values={info?.materials ?? []} />
                      </div>
                    );
                  })}

                  <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                      Tallas
                    </p>
                  </div>
                  {items.map((item) => {
                    const info = detailsById.get(item.id);
                    return (
                      <div key={`${item.id}:sizes`} className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-3">
                        <ValueChips values={info?.sizes ?? []} />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="lg:hidden">
                <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2">
                  {items.map((item) => {
                    const info = detailsById.get(item.id);
                    const cover = proxiedImageUrl(info?.imageCoverUrl ?? item.imageCoverUrl, {
                      productId: item.id,
                      kind: "cover",
                    });
                    const src = cover ?? info?.imageCoverUrl ?? item.imageCoverUrl;
                    return (
                      <div
                        key={item.id}
                        className="snap-center shrink-0 w-[80%] rounded-2xl border border-[color:var(--oda-border)] bg-white shadow-[0_16px_40px_rgba(23,21,19,0.10)]"
                      >
                        <div className="relative aspect-square w-full overflow-hidden rounded-t-2xl bg-[color:var(--oda-stone)]">
                          {src ? (
                            <Image
                              src={src}
                              alt=""
                              fill
                              unoptimized={isUnoptimized(src)}
                              className="object-cover object-center"
                              placeholder="blur"
                              blurDataURL={IMAGE_BLUR_DATA_URL}
                            />
                          ) : null}
                        </div>
                        <div className="p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--oda-taupe)]">
                                {info?.brandName ?? item.brandName}
                              </p>
                              <p className="mt-2 text-[13px] font-semibold text-[color:var(--oda-ink)]">
                                {formatPriceRange(
                                  info?.minPrice ?? item.minPrice,
                                  info?.maxPrice ?? item.maxPrice,
                                  info?.currency ?? item.currency,
                                )}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => compare.remove(item.id)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--oda-border)] bg-white text-[color:var(--oda-taupe)]"
                              aria-label="Quitar"
                              title="Quitar"
                            >
                              ×
                            </button>
                          </div>

                          <div className="mt-4 grid gap-4">
                            <div>
                              <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                                Materiales
                              </p>
                              <div className="mt-2">
                                <ValueChips values={info?.materials ?? []} />
                              </div>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                                Tallas
                              </p>
                              <div className="mt-2">
                                <ValueChips values={info?.sizes ?? []} />
                              </div>
                            </div>
                          </div>

                          <div className="mt-5 flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => compare.remove(item.id)}
                              className="rounded-full border border-[color:var(--oda-border)] bg-white px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]"
                            >
                              Quitar
                            </button>
                            {info?.sourceUrl ?? item.sourceUrl ? (
                              <Link
                                href={(info?.sourceUrl ?? item.sourceUrl)!}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="rounded-full bg-[color:var(--oda-ink)] px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-cream)]"
                              >
                                Ver tienda
                              </Link>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => compare.clear()}
                    className="rounded-full border border-[color:var(--oda-border)] bg-white px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]"
                  >
                    Limpiar selección
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
