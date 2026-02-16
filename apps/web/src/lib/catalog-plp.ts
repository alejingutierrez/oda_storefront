export type CatalogPlpContext = {
  title: string;
  subtitle?: string;
  // Querystring (URLSearchParams.toString()) containing ONLY the params locked by this PLP.
  // These values apply even when they are not present in the URL query.
  lockedParams: string;
  // Keys that are controlled by the PLP context and must be ignored if present in the URL query.
  lockedKeys: string[];
  // UI hints: hide filter sections that would be redundant/confusing within this PLP.
  hideFilters?: {
    gender?: boolean;
    category?: boolean;
    brand?: boolean;
  };
};

