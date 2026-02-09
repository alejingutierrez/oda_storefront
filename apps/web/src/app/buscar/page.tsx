import type { SearchParams } from "@/lib/catalog-filters";
import CatalogoView from "@/app/catalogo/CatalogoView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BuscarPage({ searchParams }: { searchParams: SearchParams }) {
  // Alias a `/catalogo` para mantener links legacy (`/buscar`) sin 404 ni errores de prefetch.
  return CatalogoView({ searchParams });
}
