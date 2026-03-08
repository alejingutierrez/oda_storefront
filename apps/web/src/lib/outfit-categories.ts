import { CATEGORY_GROUPS } from "@/lib/navigation";

type CategoryGroupKey = keyof typeof CATEGORY_GROUPS;

const COMPLEMENT_MAP: Record<CategoryGroupKey, CategoryGroupKey[]> = {
  Superiores: ["Inferiores", "Accesorios", "Lifestyle"],
  Completos: ["Accesorios", "Lifestyle", "Superiores"],
  Inferiores: ["Superiores", "Accesorios", "Lifestyle"],
  Accesorios: ["Superiores", "Inferiores", "Completos"],
  Lifestyle: ["Superiores", "Inferiores", "Accesorios"],
};

export function getComplementaryCategories(
  productCategory: string | null,
): string[][] {
  if (!productCategory) return [];

  // Find which group the product's category belongs to
  let sourceGroup: CategoryGroupKey | null = null;
  for (const [group, cats] of Object.entries(CATEGORY_GROUPS)) {
    if ((cats as readonly string[]).includes(productCategory)) {
      sourceGroup = group as CategoryGroupKey;
      break;
    }
  }

  if (!sourceGroup) return [];

  const complementGroups = COMPLEMENT_MAP[sourceGroup];
  return complementGroups.map(
    (g) => [...CATEGORY_GROUPS[g]] as string[],
  );
}
