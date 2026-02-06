"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { slugify } from "@/lib/product-enrichment/utils";
import type { StyleProfileRow, TaxonomyDataV1, TaxonomyTerm } from "@/lib/taxonomy/types";

type ApiTaxonomyResponse = {
  ok: boolean;
  stage: "draft" | "published";
  source: "db" | "base";
  version: number;
  updatedAt: string | null;
  data: TaxonomyDataV1;
};

type ApiStyleProfilesResponse = {
  ok: boolean;
  styleProfiles: Array<StyleProfileRow & { updatedAt: string }>;
};

type TabKey =
  | "categories"
  | "subcategories"
  | "materials"
  | "patterns"
  | "occasions"
  | "styleTags"
  | "styleProfiles";

type Option = { value: string; label: string };

const TAB_OPTIONS: Array<{ key: TabKey; label: string; note: string }> = [
  { key: "categories", label: "Categorías", note: "Edita labels y descripciones. Llaves (slug) se mantienen." },
  { key: "subcategories", label: "Subcategorías", note: "Gestiona subcategorías por categoría." },
  { key: "materials", label: "Materiales", note: "Tags de material para enrichment y filtros." },
  { key: "patterns", label: "Patrones", note: "Tags de patrón para enrichment y filtros." },
  { key: "occasions", label: "Ocasiones", note: "Tags de ocasión para enrichment y filtros." },
  { key: "styleTags", label: "Style tags", note: "Debe haber al menos 10 tags activos para enrichment." },
  { key: "styleProfiles", label: "Perfiles", note: "Perfiles (DB) que asignan estilo principal/secundario." },
];

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function normalizeUnique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function makeKey() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // ignore
  }
  return `k_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function CheckboxMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.label.toLowerCase().includes(q) || option.value.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="style-tags-search">
          Buscar tags
        </label>
        <input
          id="style-tags-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Escribe para filtrar…"
          className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
        />
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          onClick={() => onChange([])}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-600"
        >
          Limpiar
        </button>
        <button
          type="button"
          onClick={() => onChange(normalizeUnique([...selected, ...filtered.map((item) => item.value)]))}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-600"
        >
          Seleccionar visibles
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {filtered.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selectedSet.has(option.value)}
                onChange={() => {
                  const next = new Set(selectedSet);
                  if (next.has(option.value)) next.delete(option.value);
                  else next.add(option.value);
                  onChange(normalizeUnique(Array.from(next)));
                }}
                className="h-4 w-4 accent-slate-900"
              />
              <span className="min-w-0">{option.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function StyleProfileModal({
  open,
  mode,
  styleTagsOptions,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: "create" | "edit";
  styleTagsOptions: Option[];
  initial: { key: string; label: string; tags: string[] } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstLoadRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    if (firstLoadRef.current) return;
    firstLoadRef.current = true;
    setKey(initial?.key ?? "");
    setLabel(initial?.label ?? "");
    setTags(initial?.tags ?? []);
    setError(null);
  }, [initial?.key, initial?.label, initial?.tags, open, initial]);

  useEffect(() => {
    if (!open) firstLoadRef.current = false;
  }, [open]);

  const styleTagSet = useMemo(() => new Set(styleTagsOptions.map((opt) => opt.value)), [styleTagsOptions]);
  const unknownTags = useMemo(() => tags.filter((tag) => !styleTagSet.has(tag)), [styleTagSet, tags]);

  const canSave = useMemo(() => {
    if (saving) return false;
    if (mode === "create" && !key.trim()) return false;
    if (!label.trim()) return false;
    if (unknownTags.length > 0) return false;
    return true;
  }, [key, label, mode, saving, unknownTags.length]);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === "create") {
        const res = await fetch("/api/admin/style-profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: key.trim(), label: label.trim(), tags }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error ?? "No se pudo crear el perfil.");
      } else {
        const res = await fetch(`/api/admin/style-profiles/${encodeURIComponent(key)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: label.trim(), tags }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error ?? "No se pudo actualizar el perfil.");
      }
      onSaved();
      onClose();
    } catch (err) {
      console.warn(err);
      setError(err instanceof Error ? err.message : "Error guardando perfil.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6" onClick={onClose}>
      <div
        className="w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Taxonomía</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">
              {mode === "create" ? "Crear perfil de estilo" : "Editar perfil de estilo"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
          >
            Cerrar
          </button>
        </div>

        <div className="max-h-[72vh] overflow-y-auto px-6 py-6">
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="space-y-4">
                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="profile-key">
                    Key (slug)
                  </label>
                  <input
                    id="profile-key"
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                    disabled={mode === "edit"}
                    placeholder="ej: minimalista_pulido"
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-50"
                  />
                  <p className="mt-2 text-xs text-slate-500">La key es inmutable. Evita espacios, usa guiones bajos.</p>
                </div>

                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="profile-label">
                    Label
                  </label>
                  <input
                    id="profile-label"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="Ej: Minimalista pulido"
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                </div>

                {unknownTags.length ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    Hay tags que no existen en la taxonomía publicada:{" "}
                    <span className="font-semibold">{unknownTags.join(", ")}</span>. Publícalos primero o retíralos.
                  </div>
                ) : null}

                {error ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Tags del perfil</p>
              <p className="mt-2 text-sm text-slate-600">
                Estos tags se cruzan con <code className="text-slate-700">products.styleTags</code> para asignar estilo
                principal/secundario.
              </p>
              <div className="mt-4">
                <CheckboxMultiSelect options={styleTagsOptions} selected={tags} onChange={setTags} />
              </div>
            </section>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-4">
          <p className="text-xs text-slate-500">
            Tras editar perfiles, usa <span className="font-semibold">Recalcular estilos</span> para refrescar productos
            existentes.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className={classNames(
                "rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white",
                !canSave && "opacity-50",
              )}
            >
              {saving ? "Guardando…" : mode === "create" ? "Crear" : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TermRow({
  term,
  onPatch,
  keyDisabled,
  showDescription,
}: {
  term: TaxonomyTerm;
  onPatch: (patch: Partial<TaxonomyTerm>) => void;
  keyDisabled: boolean;
  showDescription: boolean;
}) {
  return (
    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:grid-cols-[0.9fr_1.3fr_0.8fr]">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Key</p>
        <code className="mt-2 block truncate rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          {term.key}
        </code>
      </div>

      <div className="min-w-0 space-y-3">
        <div>
          <label className="text-[10px] uppercase tracking-[0.2em] text-slate-400" htmlFor={`label_${term.key}`}>
            Label
          </label>
          <input
            id={`label_${term.key}`}
            value={term.label}
            onChange={(event) => onPatch({ label: event.target.value })}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
          />
        </div>

        {showDescription ? (
          <div>
            <label className="text-[10px] uppercase tracking-[0.2em] text-slate-400" htmlFor={`desc_${term.key}`}>
              Descripción (prompt)
            </label>
            <textarea
              id={`desc_${term.key}`}
              value={term.description ?? ""}
              onChange={(event) => onPatch({ description: event.target.value })}
              rows={3}
              className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={term.isActive !== false}
            onChange={(event) => onPatch({ isActive: event.target.checked })}
            className="h-4 w-4 accent-slate-900"
          />
          Activo
        </label>
        <p className="text-xs text-slate-500">
          {keyDisabled ? "Key inmutable." : "Key editable al crear (no recomendado cambiar luego)."}
        </p>
      </div>
    </div>
  );
}

function AddTermCard({
  title,
  labelPlaceholder,
  onAdd,
}: {
  title: string;
  labelPlaceholder: string;
  onAdd: (term: TaxonomyTerm) => void;
}) {
  const [label, setLabel] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [key, setKey] = useState("");

  useEffect(() => {
    if (keyTouched) return;
    setKey(slugify(label));
  }, [keyTouched, label]);

  const canAdd = useMemo(() => {
    return Boolean(label.trim()) && Boolean(key.trim());
  }, [key, label]);

  const handleAdd = () => {
    if (!canAdd) return;
    const term: TaxonomyTerm = {
      key: key.trim(),
      label: label.trim(),
      description: null,
      synonyms: [],
      isActive: true,
      sortOrder: undefined,
    };
    onAdd(term);
    setLabel("");
    setKeyTouched(false);
    setKey("");
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{title}</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <label className="text-[10px] uppercase tracking-[0.2em] text-slate-400" htmlFor={`add_label_${title}`}>
            Label
          </label>
          <input
            id={`add_label_${title}`}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={labelPlaceholder}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.2em] text-slate-400" htmlFor={`add_key_${title}`}>
            Key (slug)
          </label>
          <input
            id={`add_key_${title}`}
            value={key}
            onChange={(event) => {
              setKeyTouched(true);
              setKey(event.target.value);
            }}
            placeholder="se_genera_automatico"
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
          />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">La key es el valor persistido en productos y en el prompt.</p>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!canAdd}
          className={classNames(
            "rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white",
            !canAdd && "opacity-50",
          )}
        >
          Agregar
        </button>
      </div>
    </div>
  );
}

export default function TaxonomyEditorPanel() {
  const [tab, setTab] = useState<TabKey>("categories");
  const [publishedMeta, setPublishedMeta] = useState<Pick<ApiTaxonomyResponse, "version" | "updatedAt" | "source" | "data"> | null>(null);
  const [draftMeta, setDraftMeta] = useState<Pick<ApiTaxonomyResponse, "version" | "updatedAt" | "source" | "data"> | null>(null);
  const [styleProfiles, setStyleProfiles] = useState<ApiStyleProfilesResponse["styleProfiles"]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [subcategoryCategoryKey, setSubcategoryCategoryKey] = useState<string>("");

  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileModalMode, setProfileModalMode] = useState<"create" | "edit">("create");
  const [profileModalInitial, setProfileModalInitial] = useState<{ key: string; label: string; tags: string[] } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const [publishedRes, draftRes, profilesRes] = await Promise.all([
        fetch("/api/admin/taxonomy?stage=published", { cache: "no-store" }),
        fetch("/api/admin/taxonomy?stage=draft", { cache: "no-store" }),
        fetch("/api/admin/style-profiles", { cache: "no-store" }),
      ]);

      const publishedPayload: ApiTaxonomyResponse = await publishedRes.json().catch(() => ({ ok: false } as any));
      const draftPayload: ApiTaxonomyResponse = await draftRes.json().catch(() => ({ ok: false } as any));
      const profilesPayload: ApiStyleProfilesResponse = await profilesRes.json().catch(() => ({ ok: false } as any));

      if (!publishedRes.ok || !publishedPayload.ok) {
        throw new Error((publishedPayload as any)?.error ?? "No se pudo cargar taxonomía publicada.");
      }
      if (!draftRes.ok || !draftPayload.ok) {
        throw new Error((draftPayload as any)?.error ?? "No se pudo cargar borrador de taxonomía.");
      }
      if (!profilesRes.ok || !profilesPayload.ok) {
        throw new Error((profilesPayload as any)?.error ?? "No se pudieron cargar perfiles de estilo.");
      }

      setPublishedMeta({
        version: publishedPayload.version,
        updatedAt: publishedPayload.updatedAt,
        source: publishedPayload.source,
        data: publishedPayload.data,
      });
      setDraftMeta({
        version: draftPayload.version,
        updatedAt: draftPayload.updatedAt,
        source: draftPayload.source,
        data: draftPayload.data,
      });
      setStyleProfiles(profilesPayload.styleProfiles ?? []);

      const firstCategory = draftPayload.data.categories[0]?.key ?? "";
      setSubcategoryCategoryKey((prev) => prev || firstCategory);
    } catch (err) {
      console.warn(err);
      setError(err instanceof Error ? err.message : "Error cargando taxonomía.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const draft = draftMeta?.data ?? null;
  const published = publishedMeta?.data ?? null;

  const publishedStyleTagOptions = useMemo<Option[]>(() => {
    const tags = published?.styleTags ?? [];
    return tags
      .filter((tag) => tag.isActive !== false)
      .map((tag) => ({ value: tag.key, label: tag.label || tag.key }));
  }, [published?.styleTags]);

  const updateDraft = (next: TaxonomyDataV1) => {
    setDraftMeta((prev) => (prev ? { ...prev, data: next } : prev));
  };

  const patchCategory = (key: string, patch: Partial<TaxonomyTerm>) => {
    if (!draft) return;
    updateDraft({
      ...draft,
      categories: draft.categories.map((category) => (category.key === key ? { ...category, ...patch } : category)),
    });
  };

  const addCategory = (term: TaxonomyTerm) => {
    if (!draft) return;
    updateDraft({
      ...draft,
      categories: [
        ...draft.categories,
        { key: term.key, label: term.label, description: term.description ?? null, isActive: term.isActive, subcategories: [] as any },
      ] as any,
    });
  };

  const selectedCategory = useMemo(() => {
    if (!draft) return null;
    return draft.categories.find((cat) => cat.key === subcategoryCategoryKey) ?? draft.categories[0] ?? null;
  }, [draft, subcategoryCategoryKey]);

  useEffect(() => {
    if (!draft) return;
    if (selectedCategory) return;
    setSubcategoryCategoryKey(draft.categories[0]?.key ?? "");
  }, [draft, selectedCategory]);

  const patchSubcategory = (subcategoryKey: string, patch: Partial<TaxonomyTerm>) => {
    if (!draft || !selectedCategory) return;
    updateDraft({
      ...draft,
      categories: draft.categories.map((cat) => {
        if (cat.key !== selectedCategory.key) return cat;
        return {
          ...cat,
          subcategories: (cat.subcategories ?? []).map((sub) => (sub.key === subcategoryKey ? { ...sub, ...patch } : sub)),
        };
      }),
    });
  };

  const addSubcategory = (term: TaxonomyTerm) => {
    if (!draft || !selectedCategory) return;
    updateDraft({
      ...draft,
      categories: draft.categories.map((cat) => {
        if (cat.key !== selectedCategory.key) return cat;
        return { ...cat, subcategories: [...(cat.subcategories ?? []), term] };
      }),
    });
  };

  const patchTagList = (listKey: "materials" | "patterns" | "occasions" | "styleTags", key: string, patch: Partial<TaxonomyTerm>) => {
    if (!draft) return;
    updateDraft({
      ...draft,
      [listKey]: (draft as any)[listKey].map((term: TaxonomyTerm) => (term.key === key ? { ...term, ...patch } : term)),
    } as TaxonomyDataV1);
  };

  const addTag = (listKey: "materials" | "patterns" | "occasions" | "styleTags", term: TaxonomyTerm) => {
    if (!draft) return;
    updateDraft({
      ...draft,
      [listKey]: [...(draft as any)[listKey], term],
    } as TaxonomyDataV1);
  };

  const handleSaveDraft = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    setConfirmPublish(false);
    try {
      const res = await fetch("/api/admin/taxonomy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "draft", data: draft }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? "No se pudo guardar el borrador.");
      setMessage(`Borrador guardado. Versión draft: ${payload?.version ?? "—"}.`);
      await loadAll();
    } catch (err) {
      console.warn(err);
      setError(err instanceof Error ? err.message : "Error guardando borrador.");
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (publishing) return;
    if (!confirmPublish) {
      setConfirmPublish(true);
      return;
    }
    setPublishing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/taxonomy/publish", { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = payload?.details ? ` (${JSON.stringify(payload.details)})` : "";
        throw new Error(`${payload?.error ?? "No se pudo publicar."}${details}`);
      }
      setMessage(`Publicado. Nueva versión: ${payload?.version ?? "—"}.`);
      setConfirmPublish(false);
      await loadAll();
    } catch (err) {
      console.warn(err);
      setError(err instanceof Error ? err.message : "Error publicando taxonomía.");
    } finally {
      setPublishing(false);
    }
  };

  const handleRecomputeStyles = async () => {
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/style-profiles/recompute", { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? "No se pudo recalcular.");
      const updated = payload?.updatedCount;
      setMessage(`Recalculo ejecutado. Actualizados: ${typeof updated === "number" ? updated : "—"}.`);
    } catch (err) {
      console.warn(err);
      setError(err instanceof Error ? err.message : "Error recalculando estilos.");
    }
  };

  const openCreateProfile = () => {
    setProfileModalMode("create");
    setProfileModalInitial({ key: "", label: "", tags: [] });
    setProfileModalOpen(true);
  };

  const openEditProfile = (profile: StyleProfileRow) => {
    setProfileModalMode("edit");
    setProfileModalInitial({ key: profile.key, label: profile.label, tags: profile.tags ?? [] });
    setProfileModalOpen(true);
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-600">
        Cargando taxonomía…
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Editor</p>
        <p className="mt-2 text-sm text-slate-600">
          Publicado: <span className="font-semibold text-slate-900">v{publishedMeta?.version ?? "—"}</span>{" "}
          <span className="text-slate-400">({publishedMeta?.source ?? "—"})</span>
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Draft: <span className="font-semibold text-slate-900">v{draftMeta?.version ?? "—"}</span>
        </p>

        <div className="mt-5 grid gap-2 text-sm">
          {TAB_OPTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={classNames(
                "rounded-xl border px-4 py-2 text-left font-semibold transition",
                tab === item.key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-2">
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={saving || publishing || !draft}
            className={classNames(
              "w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white",
              (saving || publishing || !draft) && "opacity-50",
            )}
          >
            {saving ? "Guardando…" : "Guardar draft"}
          </button>
          <button
            type="button"
            onClick={handlePublish}
            disabled={saving || publishing}
            className={classNames(
              "w-full rounded-xl px-4 py-2 text-sm font-semibold text-white",
              confirmPublish ? "bg-rose-600" : "bg-slate-700",
              (saving || publishing) && "opacity-50",
            )}
          >
            {publishing ? "Publicando…" : confirmPublish ? "Confirmar publicar" : "Publicar"}
          </button>
          <button
            type="button"
            onClick={loadAll}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Recargar
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
          <p className="font-semibold text-slate-800">Reglas de seguridad</p>
          <ul className="mt-2 list-disc pl-5">
            <li>No eliminar ni renombrar keys.</li>
            <li>Desactivar es preferible a borrar.</li>
            <li>Los cambios se aplican al publicar.</li>
          </ul>
        </div>
      </aside>

      <section className="space-y-5">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Taxonomía</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">
                {TAB_OPTIONS.find((item) => item.key === tab)?.label ?? "Editor"}
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                {TAB_OPTIONS.find((item) => item.key === tab)?.note ?? ""}
              </p>
            </div>
          </div>
          {error ? (
            <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
          ) : null}
          {message ? (
            <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {message}
            </p>
          ) : null}
        </header>

        {!draft ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-600">
            No hay borrador cargado.
          </div>
        ) : tab === "categories" ? (
          <div className="space-y-5">
            <AddTermCard
              title="Agregar categoría"
              labelPlaceholder="Ej: Accesorios de pelo"
              onAdd={(term) => {
                // Category needs subcategories; se agrega vacía y luego se completan en la pestaña de subcategorías.
                const safeKey = term.key.trim();
                if (!safeKey) return;
                updateDraft({
                  ...draft,
                  categories: [
                    ...draft.categories,
                    {
                      key: safeKey,
                      label: term.label,
                      description: term.description ?? null,
                      synonyms: [],
                      isActive: term.isActive,
                      sortOrder: draft.categories.length,
                      subcategories: [
                        {
                          key: `${safeKey}_general`,
                          label: "General",
                          description: null,
                          synonyms: [],
                          isActive: true,
                          sortOrder: 0,
                        },
                      ],
                    },
                  ],
                });
                setSubcategoryCategoryKey(safeKey);
              }}
            />

            <div className="space-y-3">
              {draft.categories.map((category) => (
                <div key={category.key} className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Key</p>
                      <code className="mt-2 block truncate rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                        {category.key}
                      </code>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                        {category.subcategories?.length ?? 0} subcategorías
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setTab("subcategories");
                          setSubcategoryCategoryKey(category.key);
                        }}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                      >
                        Editar subcategorías
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor={`cat_label_${category.key}`}>
                        Label
                      </label>
                      <input
                        id={`cat_label_${category.key}`}
                        value={category.label}
                        onChange={(event) => patchCategory(category.key, { label: event.target.value })}
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor={`cat_desc_${category.key}`}>
                        Descripción (prompt)
                      </label>
                      <textarea
                        id={`cat_desc_${category.key}`}
                        value={category.description ?? ""}
                        onChange={(event) => patchCategory(category.key, { description: event.target.value })}
                        rows={3}
                        className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={category.isActive !== false}
                        onChange={(event) => patchCategory(category.key, { isActive: event.target.checked })}
                        className="h-4 w-4 accent-slate-900"
                      />
                      Activo
                    </label>
                    <p className="text-xs text-slate-500">No se permite borrar ni renombrar keys.</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : tab === "subcategories" ? (
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <label className="text-xs uppercase tracking-[0.2em] text-slate-500" htmlFor="subcategory-category">
                Categoría
              </label>
              <select
                id="subcategory-category"
                value={selectedCategory?.key ?? ""}
                onChange={(event) => setSubcategoryCategoryKey(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              >
                {draft.categories.map((cat) => (
                  <option key={cat.key} value={cat.key}>
                    {cat.label} ({cat.key})
                  </option>
                ))}
              </select>
            </div>

            {selectedCategory ? (
              <>
                <AddTermCard
                  title="Agregar subcategoría"
                  labelPlaceholder="Ej: Accesorio para el pelo"
                  onAdd={(term) => addSubcategory({ ...term, sortOrder: selectedCategory.subcategories?.length ?? 0 })}
                />

                <div className="space-y-3">
                  {(selectedCategory.subcategories ?? []).map((sub) => (
                    <TermRow
                      key={sub.key}
                      term={sub}
                      keyDisabled
                      showDescription
                      onPatch={(patch) => patchSubcategory(sub.key, patch)}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-600">
                Selecciona una categoría para editar subcategorías.
              </div>
            )}
          </div>
        ) : tab === "materials" ? (
          <div className="space-y-5">
            <AddTermCard title="Agregar material" labelPlaceholder="Ej: Lino lavado" onAdd={(term) => addTag("materials", term)} />
            <div className="space-y-3">
              {draft.materials.map((term) => (
                <TermRow
                  key={term.key}
                  term={term}
                  keyDisabled
                  showDescription={false}
                  onPatch={(patch) => patchTagList("materials", term.key, patch)}
                />
              ))}
            </div>
          </div>
        ) : tab === "patterns" ? (
          <div className="space-y-5">
            <AddTermCard title="Agregar patrón" labelPlaceholder="Ej: Jacquard" onAdd={(term) => addTag("patterns", term)} />
            <div className="space-y-3">
              {draft.patterns.map((term) => (
                <TermRow
                  key={term.key}
                  term={term}
                  keyDisabled
                  showDescription={false}
                  onPatch={(patch) => patchTagList("patterns", term.key, patch)}
                />
              ))}
            </div>
          </div>
        ) : tab === "occasions" ? (
          <div className="space-y-5">
            <AddTermCard title="Agregar ocasión" labelPlaceholder="Ej: Festival" onAdd={(term) => addTag("occasions", term)} />
            <div className="space-y-3">
              {draft.occasions.map((term) => (
                <TermRow
                  key={term.key}
                  term={term}
                  keyDisabled
                  showDescription={false}
                  onPatch={(patch) => patchTagList("occasions", term.key, patch)}
                />
              ))}
            </div>
          </div>
        ) : tab === "styleTags" ? (
          <div className="space-y-5">
            <AddTermCard title="Agregar style tag" labelPlaceholder="Ej: Estética caribe sofisticado" onAdd={(term) => addTag("styleTags", term)} />
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
              Tags activos:{" "}
              <span className="font-semibold text-slate-900">
                {draft.styleTags.filter((t) => t.isActive !== false).length}
              </span>
              <span className="text-slate-400"> (mínimo 10 para publicar)</span>
            </div>
            <div className="space-y-3">
              {draft.styleTags.map((term) => (
                <TermRow
                  key={term.key}
                  term={term}
                  keyDisabled
                  showDescription={false}
                  onPatch={(patch) => patchTagList("styleTags", term.key, patch)}
                />
              ))}
            </div>
          </div>
        ) : tab === "styleProfiles" ? (
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Perfiles de estilo</p>
                  <p className="mt-2 text-sm text-slate-600">
                    Guardados en DB. La asignación se calcula con <code className="text-slate-700">pick_style_assignments</code>.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={openCreateProfile}
                    className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
                  >
                    Crear perfil
                  </button>
                  <button
                    type="button"
                    onClick={handleRecomputeStyles}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                  >
                    Recalcular estilos
                  </button>
                </div>
              </div>
            </div>

            {styleProfiles.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-600">
                No hay perfiles de estilo.
              </div>
            ) : (
              <div className="space-y-3">
                {styleProfiles.map((profile) => (
                  <div key={profile.key} className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Key</p>
                        <code className="mt-2 block truncate rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          {profile.key}
                        </code>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{profile.label}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {profile.tags?.length ?? 0} tag(s) · actualizado {new Date(profile.updatedAt).toLocaleDateString("es-CO")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openEditProfile(profile)}
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                      >
                        Editar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <StyleProfileModal
              open={profileModalOpen}
              mode={profileModalMode}
              styleTagsOptions={publishedStyleTagOptions}
              initial={profileModalInitial}
              onClose={() => setProfileModalOpen(false)}
              onSaved={loadAll}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
