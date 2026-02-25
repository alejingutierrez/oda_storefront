export const REAL_STYLE_OPTIONS = [
  { key: "01_minimalismo_neutro_pulido", label: "Minimalismo neutro", order: 1 },
  { key: "17_street_clean", label: "Street clean", order: 2 },
  { key: "30_tropi_boho_playa", label: "Boho playa", order: 3 },
  { key: "21_gym_funcional", label: "Gym funcional", order: 4 },
  { key: "15_invitado_evento", label: "Invitado evento", order: 5 },
  { key: "28_artesanal_contemporaneo", label: "Artesanal contemporaneo", order: 6 },
  { key: "09_coastal_preppy", label: "Coastal preppy", order: 7 },
  { key: "50_cozy_homewear", label: "Cozy homewear", order: 8 },
] as const;

export type RealStyleKey = (typeof REAL_STYLE_OPTIONS)[number]["key"];

export const REAL_STYLE_KEYS: RealStyleKey[] = REAL_STYLE_OPTIONS.map((option) => option.key);

export const REAL_STYLE_LABELS: Record<RealStyleKey, string> = Object.fromEntries(
  REAL_STYLE_OPTIONS.map((option) => [option.key, option.label]),
) as Record<RealStyleKey, string>;

export function isRealStyleKey(value: unknown): value is RealStyleKey {
  return typeof value === "string" && REAL_STYLE_KEYS.includes(value as RealStyleKey);
}
