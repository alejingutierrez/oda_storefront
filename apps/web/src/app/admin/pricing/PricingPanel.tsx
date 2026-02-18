"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

type PricingConfig = {
  usd_cop_trm: number;
  display_rounding: { unit_cop: number; mode: "nearest" };
  auto_usd_brand: {
    enabled: boolean;
    threshold_pct: number;
    cop_price_lt: number;
    include_usd_variants: boolean;
  };
};

type AutoUsdDryRun = {
  ok: boolean;
  config: PricingConfig;
  evaluatedBrands: number;
  candidateBrands: number;
  candidates: Array<{
    brandId: string;
    brandName: string;
    totalProducts: number;
    suspectProducts: number;
    pct: number;
  }>;
};

type UsdOverrideBrand = {
  id: string;
  name: string;
  slug: string | null;
  pricing: {
    currency_override: string | null;
    currency_override_source: string | null;
    currency_override_applied_at: string | null;
    currency_override_reason: string | null;
    currency_override_stats: {
      pct?: number;
      suspect_products?: number;
      total_products?: number;
      computed_at?: string;
    } | null;
  };
};

type AutoUsdRunSummary = {
  markedUsd: number;
  skippedManual: number;
  skippedAlreadyUsd: number;
  errors: number;
};

const readObject = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const readString = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

function toInt(value: string, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function formatPct(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

export default function PricingPanel() {
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [config, setConfig] = useState<PricingConfig | null>(null);
  const [brands, setBrands] = useState<UsdOverrideBrand[]>([]);
  const [dryRun, setDryRun] = useState<AutoUsdDryRun | null>(null);
  const [lastRun, setLastRun] = useState<AutoUsdRunSummary | null>(null);

  const [draftTrm, setDraftTrm] = useState("");
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [draftThresholdPct, setDraftThresholdPct] = useState("");
  const [draftCopLt, setDraftCopLt] = useState("");
  const [draftIncludeUsd, setDraftIncludeUsd] = useState(true);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [cfgRes, brandsRes, dryRes] = await Promise.all([
        fetch("/api/admin/pricing/config", { method: "GET" }),
        fetch("/api/admin/pricing/brands", { method: "GET" }),
        fetch("/api/admin/pricing/auto-usd-brands", { method: "GET" }),
      ]);

      const cfgJson = (await cfgRes.json().catch(() => null)) as unknown;
      const cfgObj = readObject(cfgJson);
      const cfgError = readString(cfgObj?.error);
      const nextConfig = cfgObj?.config as PricingConfig | undefined;
      if (!cfgRes.ok) throw new Error(cfgError ?? "No se pudo cargar config");
      if (!nextConfig) throw new Error("Config ausente en respuesta");

      const brandsJson = (await brandsRes.json().catch(() => null)) as unknown;
      const brandsObj = readObject(brandsJson);
      const brandsError = readString(brandsObj?.error);
      if (!brandsRes.ok) throw new Error(brandsError ?? "No se pudo cargar marcas");
      const nextBrands = Array.isArray(brandsObj?.brands) ? (brandsObj!.brands as UsdOverrideBrand[]) : [];

      const dryJson = (await dryRes.json().catch(() => null)) as unknown;
      const dryObj = readObject(dryJson);
      const dryError = readString(dryObj?.error);
      if (!dryRes.ok) throw new Error(dryError ?? "No se pudo calcular dry-run");

      setConfig(nextConfig);
      setBrands(nextBrands);
      setDryRun(dryJson as AutoUsdDryRun);

      setDraftTrm(String(nextConfig.usd_cop_trm ?? ""));
      setDraftEnabled(Boolean(nextConfig.auto_usd_brand?.enabled));
      setDraftThresholdPct(String(nextConfig.auto_usd_brand?.threshold_pct ?? ""));
      setDraftCopLt(String(nextConfig.auto_usd_brand?.cop_price_lt ?? ""));
      setDraftIncludeUsd(Boolean(nextConfig.auto_usd_brand?.include_usd_variants));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveConfig = useCallback(() => {
    startTransition(async () => {
      setError(null);
      try {
        const next = {
          usd_cop_trm: toInt(draftTrm, config?.usd_cop_trm ?? 4200),
          auto_usd_brand: {
            enabled: Boolean(draftEnabled),
            threshold_pct: toNumber(draftThresholdPct, config?.auto_usd_brand?.threshold_pct ?? 75),
            cop_price_lt: toInt(draftCopLt, config?.auto_usd_brand?.cop_price_lt ?? 1999),
            include_usd_variants: Boolean(draftIncludeUsd),
          },
        };

        const res = await fetch("/api/admin/pricing/config", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next),
        });
        const json = (await res.json().catch(() => null)) as unknown;
        const obj = readObject(json);
        const err = readString(obj?.error);
        const nextConfig = obj?.config as PricingConfig | undefined;
        if (!res.ok) throw new Error(err ?? "No se pudo guardar config");

        setConfig(nextConfig ?? null);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }, [config, draftCopLt, draftEnabled, draftIncludeUsd, draftThresholdPct, draftTrm, refresh, startTransition]);

  const runAutoMark = useCallback(() => {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch("/api/admin/pricing/auto-usd-brands", { method: "POST" });
        const json = (await res.json().catch(() => null)) as unknown;
        const obj = readObject(json);
        const err = readString(obj?.error);
        if (!res.ok) throw new Error(err ?? "No se pudo correr auto-marcado");

        setLastRun({
          markedUsd: Number(obj?.markedUsd ?? 0),
          skippedManual: Number(obj?.skippedManual ?? 0),
          skippedAlreadyUsd: Number(obj?.skippedAlreadyUsd ?? 0),
          errors: Number(obj?.errors ?? 0),
        });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }, [refresh, startTransition]);

  const patchBrandOverride = useCallback(
    (brandId: string, currencyOverride: "USD" | null) => {
      startTransition(async () => {
        setError(null);
        try {
          const res = await fetch(`/api/admin/pricing/brands/${brandId}/override`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ currency_override: currencyOverride }),
          });
          const json = (await res.json().catch(() => null)) as unknown;
          const obj = readObject(json);
          const err = readString(obj?.error);
          if (!res.ok) throw new Error(err ?? "No se pudo actualizar override");
          await refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    },
    [refresh, startTransition],
  );

  const sortedBrands = useMemo(() => {
    return [...brands].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  }, [brands]);

  return (
    <div className="grid gap-6">
      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Config global</h2>
            <p className="mt-1 text-sm text-slate-600">
              TRM USD→COP y reglas para auto-clasificar marcas como USD.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={saveConfig}
              disabled={loading || isPending}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={runAutoMark}
              disabled={loading || isPending}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              Correr auto-marcado ahora
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <label className="grid gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              TRM USD→COP
            </span>
            <input
              value={draftTrm}
              onChange={(e) => setDraftTrm(e.target.value)}
              inputMode="numeric"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2"
              placeholder="4200"
            />
          </label>

          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <input
              type="checkbox"
              checked={draftEnabled}
              onChange={(e) => setDraftEnabled(e.target.checked)}
              className="h-4 w-4 accent-slate-900"
            />
            <span className="font-semibold text-slate-800">Auto USD por marca (activo)</span>
          </label>

          <label className="grid gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Umbral % (pct &gt;)
            </span>
            <input
              value={draftThresholdPct}
              onChange={(e) => setDraftThresholdPct(e.target.value)}
              inputMode="decimal"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2"
              placeholder="75"
            />
          </label>

          <label className="grid gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              COP &lt; (sospechoso)
            </span>
            <input
              value={draftCopLt}
              onChange={(e) => setDraftCopLt(e.target.value)}
              inputMode="numeric"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2"
              placeholder="1999"
            />
          </label>

          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm lg:col-span-2">
            <input
              type="checkbox"
              checked={draftIncludeUsd}
              onChange={(e) => setDraftIncludeUsd(e.target.checked)}
              className="h-4 w-4 accent-slate-900"
            />
            <span className="font-semibold text-slate-800">
              Incluir variantes ya marcadas en USD dentro de la muestra
            </span>
          </label>
        </div>

        <div className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-semibold">Dry-run (candidatas por regla)</span>
            <span className="text-slate-600">
              {dryRun
                ? `${dryRun.candidateBrands} / ${dryRun.evaluatedBrands} marcas (pct > ${dryRun.config.auto_usd_brand.threshold_pct}%)`
                : "—"}
            </span>
          </div>
          {lastRun ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex flex-wrap gap-3">
                <span className="font-semibold">Ultimo run:</span>
                <span>marcadas: {String(lastRun.markedUsd ?? 0)}</span>
                <span>skip manual: {String(lastRun.skippedManual ?? 0)}</span>
                <span>ya USD: {String(lastRun.skippedAlreadyUsd ?? 0)}</span>
                <span>errores: {String(lastRun.errors ?? 0)}</span>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Marcas con override USD</h2>
            <p className="mt-1 text-sm text-slate-600">
              Estas marcas se tratan como USD al convertir a COP (para toda la marca).
            </p>
          </div>
          <div className="text-sm text-slate-600">
            {loading ? "Cargando…" : `${sortedBrands.length} marcas`}
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-y-2 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.2em] text-slate-500">
                <th className="px-3">Marca</th>
                <th className="px-3">Source</th>
                <th className="px-3">Pct</th>
                <th className="px-3">Sospechosos</th>
                <th className="px-3">Total</th>
                <th className="px-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sortedBrands.map((brand) => {
                const stats = brand.pricing.currency_override_stats;
                const pct = typeof stats?.pct === "number" ? stats.pct : null;
                const suspect = typeof stats?.suspect_products === "number" ? stats.suspect_products : null;
                const total = typeof stats?.total_products === "number" ? stats.total_products : null;
                const source = brand.pricing.currency_override_source ?? "—";

                return (
                  <tr key={brand.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <td className="px-3 py-3 font-semibold text-slate-900">
                      <div className="flex flex-col">
                        <span>{brand.name}</span>
                        {brand.slug ? (
                          <span className="mt-1 text-xs font-normal text-slate-500">{brand.slug}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{source}</td>
                    <td className="px-3 py-3 text-slate-700">{pct === null ? "—" : formatPct(pct)}</td>
                    <td className="px-3 py-3 text-slate-700">{suspect === null ? "—" : String(suspect)}</td>
                    <td className="px-3 py-3 text-slate-700">{total === null ? "—" : String(total)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => patchBrandOverride(brand.id, "USD")}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                        >
                          Marcar manual
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => patchBrandOverride(brand.id, null)}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50"
                        >
                          Limpiar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!loading && sortedBrands.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-sm text-slate-600">
                    No hay marcas con override USD en este momento.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
