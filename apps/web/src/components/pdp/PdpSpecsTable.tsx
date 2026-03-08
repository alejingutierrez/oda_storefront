import { Palette, Layers, Scaling, Sun, Calendar, Sparkles, MapPin } from "lucide-react";
import type { PdpProduct } from "@/lib/pdp-data";
import { stripHtml } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type SpecRow = {
  icon: LucideIcon;
  label: string;
  value: string;
};

export default function PdpSpecsTable({ product }: { product: PdpProduct }) {
  const rows: SpecRow[] = [];

  // Materials
  if (product.materialTags.length > 0) {
    rows.push({
      icon: Palette,
      label: "Materiales",
      value: product.materialTags.join(", "),
    });
  } else {
    // Fallback: collect unique material values from variants
    const variantMaterials = [
      ...new Set(
        product.variants
          .map((v) => v.material)
          .filter(Boolean) as string[],
      ),
    ];
    if (variantMaterials.length > 0) {
      rows.push({
        icon: Palette,
        label: "Materiales",
        value: variantMaterials.join(", "),
      });
    }
  }

  // Origin
  if (product.origin) {
    rows.push({
      icon: MapPin,
      label: "Origen",
      value: product.origin,
    });
  }

  // Pattern
  if (product.patternTags.length > 0) {
    rows.push({
      icon: Layers,
      label: "Patrón",
      value: product.patternTags.join(", "),
    });
  }

  // Fit (from variants)
  const fits = [
    ...new Set(
      product.variants.map((v) => v.fit).filter(Boolean) as string[],
    ),
  ];
  if (fits.length > 0) {
    rows.push({
      icon: Scaling,
      label: "Ajuste",
      value: fits.join(", "),
    });
  }

  // Season
  if (product.season) {
    rows.push({
      icon: Sun,
      label: "Temporada",
      value: product.season,
    });
  }

  // Occasion
  if (product.occasionTags.length > 0) {
    rows.push({
      icon: Calendar,
      label: "Ocasión",
      value: product.occasionTags.join(", "),
    });
  }

  // Care
  const careText = stripHtml(product.care);
  if (careText) {
    rows.push({
      icon: Sparkles,
      label: "Cuidado",
      value: careText,
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col divide-y divide-[color:var(--oda-border)]/50">
      {rows.map((row) => {
        const Icon = row.icon;
        return (
          <div
            key={row.label}
            className="flex items-start gap-3 py-2.5"
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--oda-taupe)]" />
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--oda-taupe)]">
                {row.label}
              </span>
              <span className="text-sm leading-relaxed text-[color:var(--oda-ink-soft)]">
                {row.value}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
