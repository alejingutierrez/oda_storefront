import type { ColorCombo } from "@/lib/home-types";

const CARD_VARIANTS = ["lg:translate-y-2", "lg:-translate-y-3", "lg:translate-y-5"];

export default function ColorSwatchPalette({ colorCombos }: { colorCombos: ColorCombo[] }) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Color</p>
        <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">Shop by color</h2>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {colorCombos.map((combo, index) => (
          <article
            key={combo.id}
            className={`rounded-[1.35rem] border border-[color:var(--oda-border)] bg-white p-6 shadow-[0_18px_44px_rgba(23,21,19,0.08)] ${CARD_VARIANTS[index % CARD_VARIANTS.length]}`}
          >
            <div className="flex items-center justify-between gap-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">{combo.comboKey}</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                {combo.detectedLayout ?? "combo"}
              </p>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4">
              {combo.colors.slice(0, 6).map((color, swatchIndex) => (
                <div key={`${combo.id}-${color.hex}-${swatchIndex}`} className="flex flex-col gap-2.5">
                  <div className="home-swatch-stack">
                    <div className="home-swatch-layer" style={{ backgroundColor: color.hex }} />
                  </div>
                  <p className="truncate text-[10px] uppercase tracking-[0.16em] text-[color:var(--oda-taupe)]">
                    {color.pantoneName ?? color.hex}
                  </p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
