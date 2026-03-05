"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { proxiedImageUrl } from "@/lib/image-proxy";
import { REAL_STYLE_OPTIONS } from "@/lib/real-style/constants";

// ─── Types ────────────────────────────────────────────────────────────────────

type ConfigMap = Record<string, string>;

type ProductSnippet = {
  id: string;
  name: string;
  imageCoverUrl: string | null;
  brand: { name: string } | null;
  category: string | null;
  hasInStock: boolean;
  sourceUrl: string | null;
};

type HeroPin = {
  id: string;
  productId: string;
  position: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  note: string | null;
  createdAt: string;
  product: ProductSnippet;
};

type TrendingSnapshot = {
  snapshotDate: string | null;
  count: number;
};

// ─── Config defaults (fallback when no DB value) ──────────────────────────────

const CONFIG_DEFAULTS: ConfigMap = {
  "hero.eyebrow": "Moda colombiana para ti",
  "hero.title": "Encuentra tu próximo look colombiano",
  "hero.subtitle": "Explora prendas por estilo, compara precios en segundos y compra directo en la tienda oficial.",
  "hero.cta_primary_label": "Descubrir productos",
  "hero.cta_primary_href": "/buscar",
  "hero.cta_secondary_label": "Ver novedades",
  "hero.cta_secondary_href": "/unisex",
  "section.new_arrivals.heading": "Novedades para tu próximo look",
  "section.new_arrivals.subheading": "Recién llegado",
  "section.new_arrivals.cta_label": "Ver novedades",
  "section.new_arrivals.cta_href": "/novedades",
  "section.new_arrivals.limit": "8",
  "section.new_arrivals.days_window": "30",
  "section.price_drops.limit": "12",
  "section.price_drops.window_days": "3",
  "section.daily_trending.limit": "12",
  "section.daily_trending.cron_limit": "48",
  "section.story.eyebrow": "Inspiración ODA",
  "section.story.heading": "Menos búsqueda, más outfits que sí van contigo.",
  "section.story.body":
    "Combinamos marcas colombianas, estilos y precio para ayudarte a decidir rápido y comprar mejor.",
  "section.story.cta_label": "Ir al catálogo completo",
  "section.story.cta_href": "/unisex",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function val(config: ConfigMap, key: string): string {
  return config[key] ?? CONFIG_DEFAULTS[key] ?? "";
}

// ─── Reusable sub-components ──────────────────────────────────────────────────

function Field({
  label,
  configKey,
  config,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  configKey: string;
  config: ConfigMap;
  onChange: (key: string, value: string) => void;
  type?: "text" | "number" | "textarea";
  placeholder?: string;
}) {
  const value = val(config, configKey);
  const defaultValue = CONFIG_DEFAULTS[configKey];
  const isModified = config[configKey] !== undefined && config[configKey] !== defaultValue;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</label>
        {isModified && (
          <button
            type="button"
            onClick={() => onChange(configKey, defaultValue ?? "")}
            className="text-[10px] text-slate-400 underline underline-offset-2 hover:text-slate-700"
          >
            Restaurar
          </button>
        )}
      </div>
      {type === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(configKey, e.target.value)}
          rows={3}
          placeholder={placeholder ?? defaultValue}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(configKey, e.target.value)}
          placeholder={placeholder ?? defaultValue}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none"
        />
      )}
      {isModified && defaultValue && (
        <p className="text-[11px] text-slate-400">
          Default: <em>{defaultValue}</em>
        </p>
      )}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{title}</h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function SaveBar({
  dirty,
  saving,
  saved,
  onSave,
  onReset,
}: {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  if (!dirty && !saved) return null;
  return (
    <div className="sticky bottom-4 z-10 mt-6 flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
      <p className="text-sm text-slate-600">
        {saved ? "Cambios guardados. El home se actualizará en el próximo request." : "Tienes cambios sin guardar."}
      </p>
      <div className="flex gap-3">
        {dirty && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
          >
            Descartar
          </button>
        )}
        {dirty && (
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Textos ──────────────────────────────────────────────────────────────

function TextosTab({
  config,
  onSaveConfig,
}: {
  config: ConfigMap;
  onSaveConfig: (patch: ConfigMap) => Promise<void>;
}) {
  const [local, setLocal] = useState<ConfigMap>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const merged = { ...config, ...local };
  const dirty = Object.keys(local).length > 0;

  const handleChange = (key: string, value: string) => {
    setLocal((prev) => {
      const next = { ...prev, [key]: value };
      if (value === (config[key] ?? CONFIG_DEFAULTS[key] ?? "")) {
        delete next[key];
      }
      return next;
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveConfig(local);
      setLocal({});
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setLocal({});
    setSaved(false);
  };

  return (
    <div className="space-y-5">
      <SectionCard title="Hero — Textos principales">
        <Field label="Texto eyebrow" configKey="hero.eyebrow" config={merged} onChange={handleChange} />
        <Field label="Título (H1)" configKey="hero.title" config={merged} onChange={handleChange} type="textarea" />
        <Field
          label="Subtítulo"
          configKey="hero.subtitle"
          config={merged}
          onChange={handleChange}
          type="textarea"
        />
      </SectionCard>

      <SectionCard title="Hero — CTAs">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CTA primario — Texto" configKey="hero.cta_primary_label" config={merged} onChange={handleChange} />
          <Field label="CTA primario — URL" configKey="hero.cta_primary_href" config={merged} onChange={handleChange} />
          <Field label="CTA secundario — Texto" configKey="hero.cta_secondary_label" config={merged} onChange={handleChange} />
          <Field label="CTA secundario — URL" configKey="hero.cta_secondary_href" config={merged} onChange={handleChange} />
        </div>
      </SectionCard>

      <SectionCard title="Sección Novedades — Textos">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Heading" configKey="section.new_arrivals.heading" config={merged} onChange={handleChange} />
          <Field label="Subheading" configKey="section.new_arrivals.subheading" config={merged} onChange={handleChange} />
          <Field label="CTA — Texto" configKey="section.new_arrivals.cta_label" config={merged} onChange={handleChange} />
          <Field label="CTA — URL" configKey="section.new_arrivals.cta_href" config={merged} onChange={handleChange} />
        </div>
      </SectionCard>

      <SectionCard title="Bloque Inspiración — Textos">
        <Field label="Eyebrow" configKey="section.story.eyebrow" config={merged} onChange={handleChange} />
        <Field label="Heading" configKey="section.story.heading" config={merged} onChange={handleChange} type="textarea" />
        <Field label="Cuerpo" configKey="section.story.body" config={merged} onChange={handleChange} type="textarea" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CTA — Texto" configKey="section.story.cta_label" config={merged} onChange={handleChange} />
          <Field label="CTA — URL" configKey="section.story.cta_href" config={merged} onChange={handleChange} />
        </div>
      </SectionCard>

      <SaveBar dirty={dirty} saving={saving} saved={saved} onSave={handleSave} onReset={handleReset} />
    </div>
  );
}

// ─── Tab: Condiciones ─────────────────────────────────────────────────────────

function CondicionesTab({
  config,
  onSaveConfig,
}: {
  config: ConfigMap;
  onSaveConfig: (patch: ConfigMap) => Promise<void>;
}) {
  const [local, setLocal] = useState<ConfigMap>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const merged = { ...config, ...local };
  const dirty = Object.keys(local).length > 0;

  const handleChange = (key: string, value: string) => {
    setLocal((prev) => {
      const next = { ...prev, [key]: value };
      if (value === (config[key] ?? CONFIG_DEFAULTS[key] ?? "")) {
        delete next[key];
      }
      return next;
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveConfig(local);
      setLocal({});
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionCard title="Novedades">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Máx. productos mostrados"
            configKey="section.new_arrivals.limit"
            config={merged}
            onChange={handleChange}
            type="number"
            placeholder="8"
          />
          <Field
            label="Ventana de días (recientes)"
            configKey="section.new_arrivals.days_window"
            config={merged}
            onChange={handleChange}
            type="number"
            placeholder="30"
          />
        </div>
      </SectionCard>

      <SectionCard title="Bajadas de precio">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Máx. productos mostrados"
            configKey="section.price_drops.limit"
            config={merged}
            onChange={handleChange}
            type="number"
            placeholder="12"
          />
          <Field
            label="Ventana de días (bajada reciente)"
            configKey="section.price_drops.window_days"
            config={merged}
            onChange={handleChange}
            type="number"
            placeholder="3"
          />
        </div>
      </SectionCard>

      <SectionCard title="Trending diario">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Máx. productos en home"
            configKey="section.daily_trending.limit"
            config={merged}
            onChange={handleChange}
            type="number"
            placeholder="12"
          />
          <Field
            label="Máx. productos en snapshot (cron)"
            configKey="section.daily_trending.cron_limit"
            config={merged}
            onChange={handleChange}
            type="number"
            placeholder="48"
          />
        </div>
        <p className="text-xs text-slate-400">
          El cron reconstruye el snapshot cada día. El home muestra hasta el límite configurado.
        </p>
      </SectionCard>

      <SaveBar
        dirty={dirty}
        saving={saving}
        saved={saved}
        onSave={handleSave}
        onReset={() => { setLocal({}); setSaved(false); }}
      />
    </div>
  );
}

// ─── Tab: Hero Pins ───────────────────────────────────────────────────────────

function HeroPinsTab() {
  const [pins, setPins] = useState<HeroPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<ProductSnippet[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPins = useCallback(async () => {
    const res = await fetch("/api/admin/home/hero-pins");
    if (res.ok) {
      const data = await res.json();
      setPins(data.pins ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchPins(); }, [fetchPins]);

  const handleSearch = (q: string) => {
    setSearchQ(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.length < 2) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      const res = await fetch(`/api/admin/home/hero-pins/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.products ?? []);
      }
      setSearching(false);
    }, 350);
  };

  const handleAdd = async (productId: string) => {
    setAdding(productId);
    const res = await fetch("/api/admin/home/hero-pins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    });
    if (res.ok) {
      setSearchQ("");
      setSearchResults([]);
      await fetchPins();
    }
    setAdding(null);
  };

  const handleRemove = async (pinId: string) => {
    setRemoving(pinId);
    await fetch(`/api/admin/home/hero-pins/${pinId}`, { method: "DELETE" });
    await fetchPins();
    setRemoving(null);
  };

  const handleToggle = async (pin: HeroPin) => {
    setToggling(pin.id);
    await fetch(`/api/admin/home/hero-pins/${pin.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !pin.active }),
    });
    await fetchPins();
    setToggling(null);
  };

  const handleMove = async (pin: HeroPin, dir: -1 | 1) => {
    const newPos = pin.position + dir;
    if (newPos < 0) return;
    await fetch(`/api/admin/home/hero-pins/${pin.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position: newPos }),
    });
    await fetchPins();
  };

  const alreadyPinned = new Set(pins.map((p) => p.productId));

  if (loading) {
    return <div className="py-12 text-center text-sm text-slate-400">Cargando pins…</div>;
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Buscar producto para pinnear</h3>
        <input
          type="text"
          value={searchQ}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Nombre del producto o marca…"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none"
        />
        {searching && <p className="mt-2 text-xs text-slate-400">Buscando…</p>}
        {searchResults.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {searchResults.map((p) => {
              const pinned = alreadyPinned.has(p.id);
              const imgSrc = proxiedImageUrl(p.imageCoverUrl, { productId: p.id, kind: "cover" });
              return (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                  {imgSrc ? (
                    <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100">
                      <Image src={imgSrc} alt={p.name} fill className="object-cover" sizes="40px" />
                    </div>
                  ) : (
                    <div className="h-10 w-10 flex-shrink-0 rounded-lg bg-slate-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{p.name}</p>
                    <p className="text-xs text-slate-400">{p.brand?.name} · {p.category}</p>
                  </div>
                  {pinned ? (
                    <span className="text-[11px] text-slate-400">Ya pinneado</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAdd(p.id)}
                      disabled={adding === p.id}
                      className="rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60"
                    >
                      {adding === p.id ? "…" : "Pinnear"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Productos pinneados en hero ({pins.length})
          </h3>
          <p className="text-xs text-slate-400">
            {pins.filter((p) => p.active).length} activos · El hero combina pins activos con novedades automáticas
          </p>
        </div>

        {pins.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No hay productos pinneados. El hero usa novedades automáticas.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pins.map((pin, idx) => {
              const imgSrc = proxiedImageUrl(pin.product.imageCoverUrl, { productId: pin.productId, kind: "cover" });
              return (
                <li key={pin.id} className={`flex items-center gap-3 py-3 ${pin.active ? "" : "opacity-50"}`}>
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => handleMove(pin, -1)}
                      disabled={idx === 0}
                      className="text-[11px] text-slate-400 disabled:opacity-30"
                      aria-label="Subir"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMove(pin, 1)}
                      disabled={idx === pins.length - 1}
                      className="text-[11px] text-slate-400 disabled:opacity-30"
                      aria-label="Bajar"
                    >
                      ▼
                    </button>
                  </div>
                  {imgSrc ? (
                    <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100">
                      <Image src={imgSrc} alt={pin.product.name} fill className="object-cover" sizes="48px" />
                    </div>
                  ) : (
                    <div className="h-12 w-12 flex-shrink-0 rounded-lg bg-slate-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{pin.product.name}</p>
                    <p className="text-xs text-slate-400">
                      {pin.product.brand?.name} · {pin.product.category ?? "—"}
                      {!pin.product.hasInStock && " · Sin stock"}
                    </p>
                    {pin.note && <p className="text-xs italic text-slate-400">{pin.note}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggle(pin)}
                      disabled={toggling === pin.id}
                      className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                        pin.active
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-white text-slate-500"
                      }`}
                    >
                      {toggling === pin.id ? "…" : pin.active ? "Activo" : "Inactivo"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(pin.id)}
                      disabled={removing === pin.id}
                      className="rounded-full border border-red-100 bg-red-50 px-3 py-1 text-[11px] font-semibold text-red-600 disabled:opacity-60"
                    >
                      {removing === pin.id ? "…" : "Quitar"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Trending ────────────────────────────────────────────────────────────

function TrendingTab({ config, onSaveConfig }: { config: ConfigMap; onSaveConfig: (patch: ConfigMap) => Promise<void> }) {
  const [snapshot, setSnapshot] = useState<TrendingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<string | null>(null);
  const [cronLimit, setCronLimit] = useState<string>("");
  const [savingLimit, setSavingLimit] = useState(false);

  useEffect(() => {
    fetch("/api/admin/home/trending")
      .then((r) => r.json())
      .then((data) => {
        setSnapshot({ snapshotDate: data.snapshot?.snapshotDate ?? null, count: data.count ?? 0 });
        setCronLimit(config["section.daily_trending.cron_limit"] ?? CONFIG_DEFAULTS["section.daily_trending.cron_limit"] ?? "48");
      })
      .finally(() => setLoading(false));
  }, [config]);

  const handleRebuild = async () => {
    setRebuilding(true);
    setRebuildResult(null);
    const limit = parseInt(cronLimit, 10) || 48;
    const res = await fetch("/api/admin/home/trending", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      setRebuildResult(`Snapshot reconstruido: ${data.inserted} productos (ventana ${data.windowStart?.slice(0, 10)} → ${data.windowEnd?.slice(0, 10)})`);
      setSnapshot({ snapshotDate: data.snapshotDate, count: data.inserted });
    } else {
      setRebuildResult(`Error: ${data.error ?? "desconocido"}`);
    }
    setRebuilding(false);
  };

  const handleSaveLimit = async () => {
    setSavingLimit(true);
    await onSaveConfig({ "section.daily_trending.cron_limit": cronLimit });
    setSavingLimit(false);
  };

  if (loading) return <div className="py-12 text-center text-sm text-slate-400">Cargando…</div>;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Snapshot actual</h3>
        {snapshot?.snapshotDate ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs text-slate-400">Fecha del snapshot</p>
              <p className="mt-1 text-lg font-semibold text-slate-800">
                {new Date(snapshot.snapshotDate).toLocaleDateString("es-CO", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs text-slate-400">Productos en trending</p>
              <p className="mt-1 text-lg font-semibold text-slate-800">{snapshot.count}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No hay snapshot disponible.</p>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Reconstruir snapshot</h3>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Límite de productos</label>
            <input
              type="number"
              value={cronLimit}
              onChange={(e) => setCronLimit(e.target.value)}
              min={1}
              max={200}
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={handleSaveLimit}
            disabled={savingLimit}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            {savingLimit ? "…" : "Guardar límite"}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Reconstruye el snapshot con los clicks de las últimas 24 h. El cron lo hace automáticamente cada día.
        </p>
        <button
          type="button"
          onClick={handleRebuild}
          disabled={rebuilding}
          className="mt-4 rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {rebuilding ? "Reconstruyendo…" : "Reconstruir ahora"}
        </button>
        {rebuildResult && (
          <p className={`mt-3 text-sm ${rebuildResult.startsWith("Error") ? "text-red-600" : "text-emerald-700"}`}>
            {rebuildResult}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Looks curados ──────────────────────────────────────────────────────

function CuratedStylesTab({
  config,
  onSaveConfig,
}: {
  config: ConfigMap;
  onSaveConfig: (patch: ConfigMap) => Promise<void>;
}) {
  const configKey = "section.curated_looks.real_styles";
  const currentRaw = config[configKey];
  let currentStyles: string[] = [];
  try {
    currentStyles = currentRaw ? JSON.parse(currentRaw) : [];
    if (!Array.isArray(currentStyles)) currentStyles = [];
  } catch { currentStyles = []; }

  const [selected, setSelected] = useState<string[]>(currentStyles);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = JSON.stringify(selected) !== JSON.stringify(currentStyles);

  const handleToggle = (key: string) => {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
    setSaved(false);
  };

  const handleMove = (key: string, dir: -1 | 1) => {
    setSelected((prev) => {
      const idx = prev.indexOf(key);
      if (idx < 0) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx]!, next[newIdx]!] = [next[newIdx]!, next[idx]!];
      return next;
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    await onSaveConfig({ [configKey]: JSON.stringify(selected) });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 4000);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          Estilos reales para &quot;Looks curados para ti&quot;
        </h3>
        <p className="mb-4 text-xs text-slate-400">
          Selecciona los estilos que quieres mostrar en el home. Si no seleccionas ninguno, se mostrarán los más populares automáticamente.
          Los estilos seleccionados se muestran en el orden de abajo — usa las flechas para reordenar.
        </p>

        <div className="space-y-2">
          {REAL_STYLE_OPTIONS.map((option) => {
            const isSelected = selected.includes(option.key);
            const selectedIdx = selected.indexOf(option.key);
            return (
              <div
                key={option.key}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition ${
                  isSelected ? "border-indigo-200 bg-indigo-50" : "border-slate-100 bg-white"
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleToggle(option.key)}
                  className={`h-5 w-5 flex-shrink-0 rounded border-2 transition ${
                    isSelected
                      ? "border-indigo-500 bg-indigo-500"
                      : "border-slate-300 bg-white hover:border-slate-400"
                  }`}
                  aria-label={isSelected ? `Quitar ${option.label}` : `Agregar ${option.label}`}
                >
                  {isSelected && (
                    <svg viewBox="0 0 16 16" className="h-full w-full text-white" fill="currentColor">
                      <path d="M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z" />
                    </svg>
                  )}
                </button>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">{option.label}</p>
                  <p className="text-[11px] text-slate-400">{option.key}</p>
                </div>

                {isSelected && (
                  <div className="flex items-center gap-1">
                    <span className="mr-2 text-xs font-semibold text-indigo-600">#{selectedIdx + 1}</span>
                    <button
                      type="button"
                      onClick={() => handleMove(option.key, -1)}
                      disabled={selectedIdx <= 0}
                      className="rounded p-1 text-[11px] text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                      aria-label="Subir"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMove(option.key, 1)}
                      disabled={selectedIdx >= selected.length - 1}
                      className="rounded p-1 text-[11px] text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                      aria-label="Bajar"
                    >
                      ▼
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <SaveBar
        dirty={dirty}
        saving={saving}
        saved={saved}
        onSave={handleSave}
        onReset={() => { setSelected(currentStyles); setSaved(false); }}
      />
    </div>
  );
}

// ─── Root panel ───────────────────────────────────────────────────────────────

const TABS = [
  { key: "textos", label: "Textos" },
  { key: "pins", label: "Hero pins" },
  { key: "curated", label: "Looks curados" },
  { key: "trending", label: "Trending" },
  { key: "condiciones", label: "Condiciones" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function HomeManagementPanel({ initialConfig }: { initialConfig: ConfigMap }) {
  const [activeTab, setActiveTab] = useState<TabKey>("textos");
  const [config, setConfig] = useState<ConfigMap>(initialConfig);
  const [revalidating, setRevalidating] = useState(false);
  const [revalidated, setRevalidated] = useState(false);

  const handleSaveConfig = async (patch: ConfigMap) => {
    const res = await fetch("/api/admin/home/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = await res.json();
      setConfig(data.config ?? {});
    }
  };

  const handleRevalidate = async () => {
    setRevalidating(true);
    await fetch("/api/admin/home/revalidate", { method: "POST" });
    setRevalidating(false);
    setRevalidated(true);
    setTimeout(() => setRevalidated(false), 4000);
  };

  return (
    <div className="space-y-6">
      {/* Quick actions bar */}
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-600">
          {revalidated
            ? "Home revalidado. Verás los cambios en el próximo request."
            : "Administra textos, pins del hero, trending y condiciones de cada sección."}
        </p>
        <button
          type="button"
          onClick={handleRevalidate}
          disabled={revalidating}
          className="rounded-full border border-slate-200 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-700 disabled:opacity-60"
        >
          {revalidating ? "Revalidando…" : "Forzar revalidación del home"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex-shrink-0 rounded-xl px-5 py-2 text-sm font-semibold transition ${
              activeTab === tab.key
                ? "bg-slate-900 text-white"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "textos" && <TextosTab config={config} onSaveConfig={handleSaveConfig} />}
      {activeTab === "pins" && <HeroPinsTab />}
      {activeTab === "curated" && <CuratedStylesTab config={config} onSaveConfig={handleSaveConfig} />}
      {activeTab === "trending" && <TrendingTab config={config} onSaveConfig={handleSaveConfig} />}
      {activeTab === "condiciones" && <CondicionesTab config={config} onSaveConfig={handleSaveConfig} />}
    </div>
  );
}
