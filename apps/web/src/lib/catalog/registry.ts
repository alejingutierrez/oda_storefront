import type { CatalogAdapter } from "@/lib/catalog/types";
import { shopifyAdapter } from "@/lib/catalog/adapters/shopify";
import { wooCommerceAdapter } from "@/lib/catalog/adapters/woocommerce";
import { magentoAdapter } from "@/lib/catalog/adapters/magento";
import { vtexAdapter } from "@/lib/catalog/adapters/vtex";
import { genericAdapter } from "@/lib/catalog/adapters/generic";

const adapters: CatalogAdapter[] = [
  shopifyAdapter,
  wooCommerceAdapter,
  magentoAdapter,
  vtexAdapter,
  genericAdapter,
];

export const getCatalogAdapter = (platform: string | null | undefined) => {
  if (!platform) return genericAdapter;
  const normalized = platform.toLowerCase();
  return adapters.find((adapter) => adapter.platform === normalized) ?? genericAdapter;
};
