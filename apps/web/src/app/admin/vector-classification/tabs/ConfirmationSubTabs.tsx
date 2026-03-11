"use client";

import { useState } from "react";
import GroundTruthTab from "./GroundTruthTab";
import GenderGalleryTab from "./GenderGalleryTab";
import StyleGalleryTab from "./StyleGalleryTab";

type SubTab = "subcategorias" | "genero" | "estilo";

const SUB_TABS: Array<{ key: SubTab; label: string }> = [
  { key: "subcategorias", label: "Subcategorias" },
  { key: "genero", label: "Genero" },
  { key: "estilo", label: "Estilo" },
];

export default function ConfirmationSubTabs() {
  const [active, setActive] = useState<SubTab>("subcategorias");

  return (
    <div className="space-y-4">
      {/* Sub-tab navigation */}
      <div className="flex gap-1.5 rounded-xl border border-slate-200 bg-white p-1">
        {SUB_TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition ${
                isActive
                  ? "bg-slate-100 text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {active === "subcategorias" && <GroundTruthTab />}
      {active === "genero" && <GenderGalleryTab />}
      {active === "estilo" && <StyleGalleryTab />}
    </div>
  );
}
