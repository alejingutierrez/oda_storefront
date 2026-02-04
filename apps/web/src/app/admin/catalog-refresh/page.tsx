import AdminShell from "../AdminShell";
import CatalogRefreshPanel from "./CatalogRefreshPanel";

export const dynamic = "force-dynamic";

export default function CatalogRefreshPage() {
  return (
    <AdminShell title="Refresh semanal" active="catalog-refresh">
      <CatalogRefreshPanel />
    </AdminShell>
  );
}

