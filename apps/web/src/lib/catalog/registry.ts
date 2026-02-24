import type { CatalogAdapter } from "@/lib/catalog/types";
import { shopifyAdapter } from "@/lib/catalog/adapters/shopify";
import { wooCommerceAdapter } from "@/lib/catalog/adapters/woocommerce";
import { magentoAdapter } from "@/lib/catalog/adapters/magento";
import { vtexAdapter } from "@/lib/catalog/adapters/vtex";
import { tiendanubeAdapter } from "@/lib/catalog/adapters/tiendanube";
import { genericAdapter } from "@/lib/catalog/adapters/generic";

const adapters: CatalogAdapter[] = [
  shopifyAdapter,
  wooCommerceAdapter,
  magentoAdapter,
  vtexAdapter,
  tiendanubeAdapter,
  genericAdapter,
];

const PLATFORM_ALIASES: Record<string, string> = {
  tienda_nube: "tiendanube",
  nuvemshop: "tiendanube",
};

export const getCatalogAdapter = (platform: string | null | undefined) => {
  if (!platform) return genericAdapter;
  const normalizedRaw = platform.toLowerCase();
  const normalized = PLATFORM_ALIASES[normalizedRaw] ?? normalizedRaw;
  return adapters.find((adapter) => adapter.platform === normalized) ?? genericAdapter;
};
