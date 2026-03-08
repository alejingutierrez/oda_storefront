/** Shared types for the StyleSwipe discovery engine. */

export type SwipeAction = "like" | "dislike" | "maybe";

/** Minimal product data needed for the swipe deck. */
export type SwipeItem = {
  id: string;
  name: string;
  brandName: string;
  imageCoverUrl: string;
  realStyle: string | null;
  styleTags: string[];
  materialTags: string[];
  patternTags: string[];
  occasionTags: string[];
  minPriceCop: string | null;
  maxPriceCop: string | null;
  currency: string | null;
};

/** Weighted attribute entry in the user's profile. */
export type AttributeEntry = {
  tag: string;
  category: "style" | "material" | "pattern" | "occasion";
  weightedCount: number;
  productCount: number;
};

/** The full attribute profile is a map from tag → entry. */
export type AttributeProfile = Map<string, AttributeEntry>;

/** A dimension of the user's style profile. */
export type StyleDimension = {
  label: string;
  score: number;
};

/** Computed style profile result. */
export type StyleProfileResult = {
  coherenceScore: number;
  keywords: string[];
  dimensions: StyleDimension[];
  /** Serialisable attribute profile for scoring. */
  attributeProfile: Record<string, AttributeEntry>;
};

/** User preferences from the refinement step. */
export type SessionPreferences = {
  occasion: string | null;
  fit: string | null;
  palette: string | null;
};

/** A scored product for the recommendations feed. */
export type ScoredProduct = {
  id: string;
  name: string;
  brandName: string;
  imageCoverUrl: string;
  minPriceCop: string | null;
  maxPriceCop: string | null;
  currency: string | null;
  matchScore: number;
  slug: string | null;
  brandSlug: string | null;
};

/** Cluster mapping for dynamic dimensions. */
export const DIMENSION_CLUSTERS: Record<string, string[]> = {
  Minimalismo: [
    "minimal_elegante",
    "minimal_japones",
    "clean_modern",
    "lineas_puras",
    "minimalismo",
    "simplicidad",
    "esencial",
  ],
  "Paleta Neutra": [
    "paleta_neutros_tierras",
    "paleta_monocromatico",
    "paleta_blancos_cremas",
    "neutro",
    "beige",
    "crema",
    "tonos_tierra",
  ],
  "Texturas Naturales": [
    "lino",
    "algodon_organico",
    "seda",
    "lana",
    "algodon",
    "cashmere",
    "punto",
    "tweed",
    "denim",
    "cuero",
  ],
  "Cortes Oversize": [
    "oversize",
    "relajado",
    "fluido",
    "amplio",
    "volumetrico",
    "holgado",
  ],
  "Cortes Ajustados": [
    "ajustado",
    "slim",
    "entallado",
    "ceñido",
    "bodycon",
    "fitted",
  ],
  "Estilo Urbano": [
    "street_clean",
    "streetwear_urbano",
    "urbano_casual",
    "casual_urbano",
    "athleisure",
    "deportivo_urbano",
  ],
  "Elegancia Clásica": [
    "clasico_atemporal",
    "preppy_moderno",
    "tailoring",
    "sastreria",
    "formal",
    "elegante",
    "sofisticado",
  ],
  Bohemio: [
    "boho_chic",
    "boho_moderno",
    "hippie_chic",
    "folk",
    "artesanal",
    "etnico",
    "tropi_boho",
  ],
  "Colores Vibrantes": [
    "paleta_colores_vivos",
    "paleta_pasteles",
    "colorblock",
    "saturado",
    "brillo",
    "estampado",
  ],
  "Estilo Cozy": [
    "cozy",
    "homewear",
    "loungewear",
    "comfy",
    "acogedor",
    "suave",
    "calidez",
  ],
  "Estilo Costero": [
    "coastal",
    "nautico",
    "marinero",
    "playero",
    "resort",
    "vacation",
  ],
  "Vanguardia": [
    "avant_garde",
    "experimental",
    "deconstruido",
    "asimetrico",
    "conceptual",
    "futurista",
  ],
};

/** Minimum likes needed for a meaningful profile. */
export const MIN_LIKES_THRESHOLD = 8;

/** Default number of items in a swipe deck. */
export const DEFAULT_DECK_SIZE = 20;

/** Weight constants for the scoring algorithm. */
export const CATEGORY_WEIGHTS = {
  style: 0.5,
  occasion: 0.2,
  material: 0.15,
  pattern: 0.15,
} as const;

/** Weight multipliers by interaction source. */
export const SOURCE_WEIGHTS = {
  currentLike: 1.0,
  currentMaybe: 0.5,
  favorite: 0.7,
  previousLike: 0.6,
  previousMaybe: 0.3,
} as const;
