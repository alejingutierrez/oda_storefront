"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

type Category = {
  title: string;
  key: "occasion" | "fit" | "palette";
  options: { label: string; value: string }[];
};

const CATEGORIES: Category[] = [
  {
    title: "Ocasión",
    key: "occasion",
    options: [
      { label: "Casual", value: "casual" },
      { label: "Trabajo", value: "trabajo" },
      { label: "Salidas", value: "salidas" },
      { label: "Deporte", value: "deporte" },
    ],
  },
  {
    title: "Ajuste",
    key: "fit",
    options: [
      { label: "Oversize", value: "oversize" },
      { label: "Relajado", value: "relajado" },
      { label: "Regular", value: "regular" },
      { label: "Ajustado", value: "ajustado" },
    ],
  },
  {
    title: "Paleta",
    key: "palette",
    options: [
      { label: "Neutros", value: "neutros" },
      { label: "Tierra", value: "tierra" },
      { label: "Colores Vivos", value: "vivos" },
      { label: "Monocromático", value: "monocromatico" },
    ],
  },
];

type Props = {
  sessionId: string;
};

export default function PreferenceSelector({ sessionId }: Props) {
  const router = useRouter();
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const allSelected = CATEGORIES.every((cat) => selections[cat.key]);

  const handleSelect = (key: string, value: string) => {
    setSelections((prev) => ({ ...prev, [key]: value }));
  };

  const handleContinue = async () => {
    if (!allSelected || saving) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/style-sessions/${sessionId}/preferences`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(selections),
        },
      );
      if (res.ok) {
        router.push(`/style-discovery/profile?session=${sessionId}`);
      }
    } catch (error) {
      console.error("Failed to save preferences:", error);
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[color:var(--oda-cream)] px-6 py-12">
      <motion.div
        className="mx-auto w-full max-w-sm"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1
          className="mb-2 text-2xl font-bold text-[color:var(--oda-ink)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Refina Tu Gusto
        </h1>
        <p className="mb-8 text-sm text-[color:var(--oda-taupe)]">
          Profundiza: ¿qué parte te gusta más?
        </p>

        <div className="space-y-8">
          {CATEGORIES.map((category, catIndex) => (
            <motion.div
              key={category.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: catIndex * 0.1, duration: 0.4 }}
            >
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[color:var(--oda-ink)]">
                {category.title}
              </h2>
              <div className="flex flex-wrap gap-2">
                {category.options.map((option) => {
                  const isSelected = selections[category.key] === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => handleSelect(category.key, option.value)}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                        isSelected
                          ? "bg-[color:var(--oda-ink)] text-white"
                          : "bg-[color:var(--oda-stone)] text-[color:var(--oda-ink)] hover:bg-[color:var(--oda-border)]"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </div>

        <button
          onClick={handleContinue}
          disabled={!allSelected || saving}
          className="mt-10 w-full rounded-xl bg-[color:var(--oda-ink)] px-6 py-4 text-base font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {saving ? "Guardando..." : "Continuar"}
        </button>
      </motion.div>
    </div>
  );
}
