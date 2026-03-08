const STORAGE_KEY = "oda_pdp_nav_v1";

export type PdpNavContext = {
  productIds: string[];
  currentIndex: number;
  label: string;
};

export function savePdpNavContext(ctx: PdpNavContext): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
}

export function readPdpNavContext(
  currentProductId: string,
): PdpNavContext | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const ctx: PdpNavContext = JSON.parse(raw);
    const idx = ctx.productIds.indexOf(currentProductId);
    if (idx === -1) return null;
    return { ...ctx, currentIndex: idx };
  } catch {
    return null;
  }
}
