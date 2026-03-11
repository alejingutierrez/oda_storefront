"use client";

export type FilterOption = {
  key: string;
  label: string;
  count?: number;
};

export default function FilterPills({
  options,
  activeKey,
  onChange,
}: {
  options: FilterOption[];
  activeKey: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const isActive = opt.key === activeKey;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
              isActive
                ? "bg-slate-800 text-white shadow-sm"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {opt.label}
            {opt.count != null && (
              <span className={`ml-1.5 ${isActive ? "text-slate-300" : "text-slate-400"}`}>
                {opt.count.toLocaleString("es-CO")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
