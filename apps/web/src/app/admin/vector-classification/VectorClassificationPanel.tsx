"use client";

import { useState } from "react";
import GroundTruthTab from "./tabs/GroundTruthTab";
import ModelTrainingTab from "./tabs/ModelTrainingTab";

type TabKey = "ground-truth" | "model";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "ground-truth", label: "Confirmacion" },
  { key: "model", label: "Modelo" },
];

export default function VectorClassificationPanel() {
  const [activeTab, setActiveTab] = useState<TabKey>("ground-truth");

  return (
    <section className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition ${
              activeTab === tab.key
                ? "bg-slate-900 text-white shadow-sm"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "ground-truth" && <GroundTruthTab />}
      {activeTab === "model" && <ModelTrainingTab />}
    </section>
  );
}
