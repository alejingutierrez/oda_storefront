import { permanentRedirect } from "next/navigation";
import type { SearchParams } from "@/lib/catalog-filters";
import { resolveSearchParams } from "@/lib/catalog-filters";
import { GENDER_ROUTE, normalizeGender } from "@/lib/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type GenderRouteParams = {
  gender: string;
  segments?: string[];
};

export default async function LegacyGenderCatalogRedirectPage({
  params,
  searchParams,
}: {
  params: GenderRouteParams | Promise<GenderRouteParams>;
  searchParams: SearchParams;
}) {
  const resolvedParams = await params;
  const gender = normalizeGender(resolvedParams.gender);
  const segments = Array.isArray(resolvedParams.segments) ? resolvedParams.segments : [];
  const merged = await resolveSearchParams(searchParams);
  const nextQuery = new URLSearchParams(merged.toString());

  // Avoid duplicates: the canonical path already carries these filters.
  nextQuery.delete("gender");
  nextQuery.delete("category");
  nextQuery.delete("subcategory");

  const safeSegments = segments
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length > 0)
    .slice(0, 2);
  const basePath = `/${GENDER_ROUTE[gender]}${safeSegments.length ? `/${safeSegments.join("/")}` : ""}`;
  const query = nextQuery.toString();
  const url = query ? `${basePath}?${query}` : basePath;
  permanentRedirect(url);
}
