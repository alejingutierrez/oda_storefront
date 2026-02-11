import type { PromptGroup } from "@/lib/product-enrichment/category-groups";

const GROUP_MAX_IMAGES: Record<PromptGroup, number> = {
  prendas_superiores: 6,
  prendas_exteriores: 6,
  prendas_inferiores: 6,
  prendas_completas: 6,
  ropa_tecnica: 6,
  ropa_especial: 5,
  calzado: 4,
  accesorios_textiles: 4,
  bolsos: 4,
  joyeria: 4,
  gafas: 4,
  hogar_lifestyle: 4,
};

const GROUP_PER_VARIANT_IMAGES: Record<PromptGroup, number> = {
  prendas_superiores: 2,
  prendas_exteriores: 2,
  prendas_inferiores: 2,
  prendas_completas: 2,
  ropa_tecnica: 2,
  ropa_especial: 2,
  calzado: 2,
  accesorios_textiles: 2,
  bolsos: 2,
  joyeria: 3,
  gafas: 2,
  hogar_lifestyle: 2,
};

export const resolveImageLimitsForGroup = (
  group: PromptGroup | null,
  maxImagesDefault: number,
) => {
  if (!group) {
    return {
      maxImages: maxImagesDefault,
      perVariantImages: 2,
    };
  }
  return {
    maxImages: Math.max(1, Math.min(maxImagesDefault, GROUP_MAX_IMAGES[group] ?? maxImagesDefault)),
    perVariantImages: Math.max(1, GROUP_PER_VARIANT_IMAGES[group] ?? 2),
  };
};
