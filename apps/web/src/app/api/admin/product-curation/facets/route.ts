import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/auth";
import {
  getCatalogFacetsUncached,
  getCatalogSubcategoriesUncached,
} from "@/lib/catalog-data";
import { parseCatalogFiltersFromSearchParams } from "@/lib/catalog-filters";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const admin = await validateAdminRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsedFilters = parseCatalogFiltersFromSearchParams(url.searchParams);
  // Curación humana se alinea con catálogo público: solo enriquecidos y en stock.
  const filters = { ...parsedFilters, enrichedOnly: true, inStock: true };

  const [facets, subcategories] = await Promise.all([
    getCatalogFacetsUncached(filters),
    getCatalogSubcategoriesUncached(filters),
  ]);

  return NextResponse.json({ facets, subcategories });
}
