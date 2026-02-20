import type { GenderKey } from "@/lib/navigation";

export type MenuSubcategory = {
  key: string;
  label: string;
  count: number;
  href: string;
};

export type MenuCategory = {
  key: string;
  label: string;
  count: number;
  href: string;
  subcategories?: MenuSubcategory[];
};

export type MegaMenuData = Record<
  GenderKey,
  {
    Superiores: MenuCategory[];
    Inferiores: MenuCategory[];
    Accesorios: MenuCategory[];
  }
>;

export type HomeProductCardData = {
  id: string;
  name: string;
  imageCoverUrl: string;
  brandName: string;
  category: string | null;
  subcategory: string | null;
  minPrice: string | null;
  currency: string | null;
  sourceUrl: string | null;
};

export type ProductCard = HomeProductCardData;

export type CategoryHighlight = {
  category: string;
  label: string;
  imageCoverUrl: string;
  href: string;
};

export type StyleGroup = {
  styleKey: string;
  label: string;
  products: HomeProductCardData[];
};

export type ColorCombo = {
  id: string;
  comboKey: string;
  detectedLayout: string | null;
  colors: Array<{
    hex: string;
    role: string | null;
    pantoneName: string | null;
  }>;
};

export type BrandLogo = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string;
};
