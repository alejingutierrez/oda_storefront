"use client";

import type { PdpColorGroup } from "@/lib/pdp-data";

type Props = {
  colorGroups: PdpColorGroup[];
  selectedColorKey: string | null;
  selectedSize: string | null;
  onColorChange: (colorKey: string) => void;
  onSizeChange: (size: string) => void;
};

export default function PdpVariantSelector({
  colorGroups,
  selectedColorKey,
  selectedSize,
  onColorChange,
  onSizeChange,
}: Props) {
  const activeGroup =
    colorGroups.find((g) => g.colorKey === selectedColorKey) ?? colorGroups[0];

  const hasDistinctColors =
    colorGroups.length > 1 &&
    !colorGroups.every((g) => g.colorName === colorGroups[0]?.colorName);
  const showColorSelector = hasDistinctColors;
  const showSizeSelector = activeGroup && activeGroup.sizes.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Color selector */}
      {showColorSelector && (
        <div>
          <span className="mb-2 block text-[11px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">
            Color: <span className="text-[color:var(--oda-ink)]">{activeGroup?.colorName}</span>
          </span>
          <div className="flex flex-wrap gap-2">
            {colorGroups.map((group) => {
              const isActive = group.colorKey === (selectedColorKey ?? colorGroups[0]?.colorKey);
              return (
                <button
                  key={group.colorKey}
                  type="button"
                  onClick={() => onColorChange(group.colorKey)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${
                    isActive
                      ? "border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                      : "border-[color:var(--oda-border)] text-[color:var(--oda-ink)] hover:border-[color:var(--oda-ink)]"
                  } ${!group.isAvailable && !isActive ? "opacity-50" : ""}`}
                >
                  {group.colorHex && (
                    <span
                      className="inline-block h-3 w-3 rounded-full border border-black/10"
                      style={{ backgroundColor: group.colorHex }}
                      aria-hidden
                    />
                  )}
                  {group.colorName}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Size selector */}
      {showSizeSelector && (
        <div>
          <span className="mb-2 block text-[11px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]">
            Talla
          </span>
          <div className="flex flex-wrap gap-2">
            {activeGroup.sizes.map((sizeOpt) => {
              const isActive = sizeOpt.size === selectedSize;
              const isDisabled = !sizeOpt.inStock;
              return (
                <button
                  key={sizeOpt.variantId}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => onSizeChange(sizeOpt.size)}
                  className={`min-w-[3rem] rounded-full border px-3 py-2 text-xs uppercase tracking-[0.1em] transition ${
                    isActive
                      ? "border-[color:var(--oda-ink)] bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                      : isDisabled
                        ? "cursor-not-allowed border-[color:var(--oda-border)] text-[color:var(--oda-taupe)] opacity-40 line-through"
                        : "border-[color:var(--oda-border)] text-[color:var(--oda-ink)] hover:border-[color:var(--oda-ink)]"
                  }`}
                >
                  {sizeOpt.size}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
