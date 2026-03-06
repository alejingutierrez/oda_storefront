import type { GenderKey } from "@/lib/navigation";

export type HomeConfigMap = Record<string, string>;

export const HOME_CONFIG_DEFAULTS: Record<string, string> = {
  "hero.eyebrow": "Moda colombiana para ti",
  "hero.title": "Encuentra tu próximo look colombiano",
  "hero.subtitle":
    "Explora prendas por estilo, compara precios en segundos y compra directo en la tienda oficial.",
  "hero.cta_primary_label": "Descubrir productos",
  "hero.cta_primary_href": "/buscar",
  "hero.cta_secondary_label": "Ver novedades",
  "hero.cta_secondary_href": "/unisex",
  "section.new_arrivals.heading": "Novedades para tu próximo look",
  "section.new_arrivals.subheading": "Recién llegado",
  "section.new_arrivals.cta_label": "Ver novedades",
  "section.new_arrivals.cta_href": "/novedades",
  "section.new_arrivals.limit": "8",
  "section.new_arrivals.days_window": "30",
  "section.price_drops.limit": "12",
  "section.price_drops.window_days": "3",
  "section.daily_trending.limit": "12",
  "section.daily_trending.cron_limit": "48",
  "section.story.eyebrow": "Inspiración ODA",
  "section.story.heading": "Menos búsqueda, más outfits que sí van contigo.",
  "section.story.body":
    "Combinamos marcas colombianas, estilos y precio para ayudarte a decidir rápido y comprar mejor.",
  "section.story.cta_label": "Ir al catálogo completo",
  "section.story.cta_href": "/unisex",
  "section.curated_looks.real_styles": "",
  "section.style_showcase.heading": "Tu estilo, tus reglas",
  "section.style_showcase.subheading": "Looks curados",
  "section.style_showcase.expanded_count": "3",
  "section.smart_rails.default_tab": "price_drops",
};

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
    Completos: MenuCategory[];
    Inferiores: MenuCategory[];
    Accesorios: MenuCategory[];
    Lifestyle: MenuCategory[];
  }
>;

export type HomeProductCardData = {
  id: string;
  name: string;
  slug: string | null;
  imageCoverUrl: string;
  brandName: string;
  brandSlug: string | null;
  category: string | null;
  subcategory: string | null;
  minPrice: string | null;
  currency: string | null;
  sourceUrl: string | null;
  realStyle?: string | null;
};

export type ProductCard = HomeProductCardData;

export type HomeHeroSlide = HomeProductCardData & {
  slideOrder: number;
  heroImageUrls: string[];
};

export type HomePriceDropCardData = HomeProductCardData & {
  previousPrice: string | null;
  dropPercent: number | null;
  priceChangedAt: string | null;
};

export type HomeTrendingDailyCardData = HomeProductCardData & {
  clickCount: number;
  snapshotDate: string | null;
};

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
  productCount: number;
  categoryCount: number;
  heroImageUrl: string | null;
};

export type HomeCoverageStats = {
  productCount: number;
  brandCount: number;
  categoryCount: number;
  lastUpdatedAt: string | null;
};
