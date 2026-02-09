"use client";

import { useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type SortOption = { value: string; label: string };

export const SORT_OPTIONS: SortOption[] = [
  { value: "relevancia", label: "Relevancia" },
  { value: "new", label: "Nuevos" },
  { value: "price_asc", label: "Precio: menor" },
  { value: "price_desc", label: "Precio: mayor" },
];

export type CatalogFilterLabelMaps = Partial<
  Record<
    "category" | "subcategory" | "gender" | "brandId" | "color" | "material" | "pattern",
    Record<string, string>
  >
>;

function formatCop(value: number) {
  if (!Number.isFinite(value)) return "";
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `COP ${value.toFixed(0)}`;
  }
}

export default function CatalogToolbar({
  totalCount,
  activeBrandCount,
  searchKey,
  labels,
}: {
  totalCount: number;
  activeBrandCount: number;
  searchKey: string;
  labels?: CatalogFilterLabelMaps;
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

  const chips = useMemo(() => {
    const next: Array<{ id: string; key: string; value?: string; label: string }> = [];

    const pushList = (paramKey: string, labelKey: keyof CatalogFilterLabelMaps, prefix: string) => {
      const values = params.getAll(paramKey).filter((value) => value.trim().length > 0);
      for (const value of values) {
        const friendly = labels?.[labelKey]?.[value] ?? value;
        next.push({
          id: `${paramKey}:${value}`,
          key: paramKey,
          value,
          label: `${prefix}: ${friendly}`,
        });
      }
    };

    pushList("gender", "gender", "Género");
    pushList("category", "category", "Categoría");
    pushList("subcategory", "subcategory", "Subcategoría");
    pushList("brandId", "brandId", "Marca");
    pushList("color", "color", "Color");
    pushList("material", "material", "Material");
    pushList("pattern", "pattern", "Patrón");

    const priceMinRaw = params.get("price_min");
    const priceMaxRaw = params.get("price_max");
    const priceMin = priceMinRaw ? Number(priceMinRaw) : null;
    const priceMax = priceMaxRaw ? Number(priceMaxRaw) : null;
    if (priceMinRaw || priceMaxRaw) {
      const parts: string[] = [];
      if (Number.isFinite(priceMin)) parts.push(formatCop(priceMin!));
      if (Number.isFinite(priceMax)) parts.push(formatCop(priceMax!));
      next.push({
        id: "price",
        key: "price",
        label: `Precio: ${parts.length > 0 ? parts.join(" - ") : "—"}`,
      });
    }

    return next;
  }, [labels, params]);

  const removeChip = (chip: { key: string; value?: string }) => {
    const next = new URLSearchParams(params.toString());
    if (chip.key === "price") {
      next.delete("price_min");
      next.delete("price_max");
    } else if (chip.value) {
      const values = next.getAll(chip.key);
      next.delete(chip.key);
      values.filter((value) => value !== chip.value).forEach((value) => next.append(chip.key, value));
    } else {
      next.delete(chip.key);
    }
    next.set("page", "1");
    const query = next.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    startTransition(() => {
      router.replace(url, { scroll: false });
    });
  };

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
      router.replace(pathname, { scroll: false });
    });
  };

  const selectedOption =
    SORT_OPTIONS.find((option) => option.value === sort) ??
    SORT_OPTIONS.find((option) => option.value === "new")!;

  return (
    <div className="rounded-2xl border border-[color:var(--oda-border)] bg-white px-5 py-4 lg:sticky lg:top-24 lg:z-30 lg:shadow-[0_30px_80px_rgba(23,21,19,0.10)]">
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

        <div className="hidden flex-wrap items-center gap-3 lg:flex">
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

      {chips.length > 0 ? (
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => removeChip(chip)}
              disabled={isPending}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)] disabled:cursor-not-allowed disabled:opacity-60"
              title="Quitar filtro"
            >
              <span className="truncate">{chip.label}</span>
              <span className="text-[12px] leading-none text-[color:var(--oda-taupe)]" aria-hidden>
                ×
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
