"use client";

import { useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type SortOption = { value: string; label: string };

const SORT_OPTIONS: SortOption[] = [
  { value: "relevancia", label: "Relevancia" },
  { value: "new", label: "Nuevos" },
  { value: "price_asc", label: "Precio: menor" },
  { value: "price_desc", label: "Precio: mayor" },
];

export default function CatalogToolbar({
  totalCount,
  activeBrandCount,
  searchKey,
}: {
  totalCount: number;
  activeBrandCount: number;
  searchKey: string;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const sort = params.get("sort") ?? "new";
  const hasFilters = useMemo(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("sort");
    next.delete("page");
    return next.toString().length > 0;
  }, [params]);

  const applyParams = (next: URLSearchParams) => {
    next.set("page", "1");
    const query = next.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    startTransition(() => {
      router.replace(url, { scroll: false });
    });
  };

  const handleSortChange = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "new") {
      next.delete("sort");
    } else {
      next.set("sort", value);
    }
    applyParams(next);
  };

  const handleClear = () => {
    startTransition(() => {
      router.replace("/catalogo", { scroll: false });
    });
  };

  const selectedOption =
    SORT_OPTIONS.find((option) => option.value === sort) ??
    SORT_OPTIONS.find((option) => option.value === "new")!;

  return (
    <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white px-5 py-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-sm text-[color:var(--oda-ink)]">
            <span className="font-semibold">{totalCount.toLocaleString("es-CO")}</span> productos
          </p>
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            {activeBrandCount.toLocaleString("es-CO")} marcas activas
          </p>
          {isPending ? (
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
              Actualizando…
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            Ordenar
            <select
              key={searchKey}
              value={selectedOption.value}
              onChange={(event) => handleSortChange(event.target.value)}
              className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-3 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleClear}
            disabled={!hasFilters || isPending}
            className={[
              "rounded-full border px-4 py-2 text-xs uppercase tracking-[0.2em] transition",
              hasFilters && !isPending
                ? "border-[color:var(--oda-border)] bg-white text-[color:var(--oda-ink)] hover:bg-[color:var(--oda-stone)]"
                : "cursor-not-allowed border-[color:var(--oda-border)] bg-white text-[color:var(--oda-taupe)] opacity-70",
            ].join(" ")}
          >
            Limpiar
          </button>
        </div>
      </div>
    </div>
  );
}

