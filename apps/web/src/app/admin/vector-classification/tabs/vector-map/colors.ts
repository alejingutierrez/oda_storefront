export const MENU_GROUP_COLORS: Record<string, string> = {
  Superiores: "#6366f1",
  Completos: "#8b5cf6",
  Inferiores: "#06b6d4",
  Accesorios: "#f59e0b",
  Lifestyle: "#10b981",
};

export function getMenuGroupColor(menuGroup: string): string {
  return MENU_GROUP_COLORS[menuGroup] ?? "#94a3b8";
}

export const MENU_GROUP_LIST = Object.keys(MENU_GROUP_COLORS);

/** Color for distance heatmap: 0=green(close), 1=red(far). */
export function distanceColor(distance: number, maxDist: number): string {
  const t = Math.min(distance / (maxDist || 1), 1);
  const r = Math.round(34 + t * (239 - 34));
  const g = Math.round(197 + t * (68 - 197));
  const b = Math.round(94 + t * (68 - 94));
  return `rgb(${r}, ${g}, ${b})`;
}
