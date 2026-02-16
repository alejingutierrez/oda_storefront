import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { SearchParams } from "@/lib/catalog-filters";
import { resolveSearchParams } from "@/lib/catalog-filters";
import type { CatalogPlpContext } from "@/lib/catalog-plp";
import { prisma } from "@/lib/prisma";
import { labelize } from "@/lib/navigation";
import CatalogoView from "@/app/catalogo/CatalogoView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type StyleRouteParams = { style: string };

function isIndexableCatalog(params: URLSearchParams) {
  const disallowKeys = [
    "sort",
    "q",
    "brandId",
    "color",
    "material",
    "pattern",
    "price_min",
    "price_max",
    "price_range",
    "size",
    "fit",
    "occasion",
    "season",
    // locked: style (se evalúa aparte)
  ];
  return disallowKeys.every((key) => !params.has(key));
}

async function resolveStyleLabel(styleKey: string): Promise<string | null> {
  const key = String(styleKey || "").trim();
  if (!key) return null;
  const row = await prisma.styleProfile.findUnique({
    where: { key },
    select: { label: true },
  });
  const label = row?.label?.trim();
  return label && label.length > 0 ? label : null;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: StyleRouteParams | Promise<StyleRouteParams>;
  searchParams: SearchParams;
}): Promise<Metadata> {
  const resolvedParams = await params;
  const styleKey = String(resolvedParams.style || "").trim();
  if (!styleKey) notFound();

  const merged = await resolveSearchParams(searchParams);
  const next = new URLSearchParams(merged.toString());
  next.delete("style");
  next.append("style", styleKey);

  // Canonical: el path representa el estilo.
  const canonicalParams = new URLSearchParams(next.toString());
  canonicalParams.delete("page");
  if (canonicalParams.get("sort") === "new") canonicalParams.delete("sort");
  canonicalParams.delete("style");
  const query = canonicalParams.toString();
  const basePath = `/estilo/${encodeURIComponent(styleKey)}`;
  const canonical = query ? `${basePath}?${query}` : basePath;

  const label = (await resolveStyleLabel(styleKey)) ?? labelize(styleKey);
  const title = `${label} | ODA`;
  const description =
    "Descubre moda colombiana curada por estilo, con inventario disponible y enlaces a tiendas oficiales.";

  const indexable = isIndexableCatalog(canonicalParams);

  return {
    title,
    description,
    alternates: { canonical },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title, description, url: canonical, type: "website" },
  };
}

export default async function EstiloPage({
  params,
  searchParams,
}: {
  params: StyleRouteParams | Promise<StyleRouteParams>;
  searchParams: SearchParams;
}) {
  const resolvedParams = await params;
  const styleKey = String(resolvedParams.style || "").trim();
  if (!styleKey) notFound();

  const merged = await resolveSearchParams(searchParams);
  const label = (await resolveStyleLabel(styleKey)) ?? labelize(styleKey);

  const plp: CatalogPlpContext = {
    title: label,
    subtitle: "Explora este estilo en marcas colombianas.",
    lockedParams: new URLSearchParams({ style: styleKey }).toString(),
    lockedKeys: ["style"],
  };

  return CatalogoView({ searchParams: merged, plp });
}
