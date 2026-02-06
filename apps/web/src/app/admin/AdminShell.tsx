import Link from "next/link";

const navItems = [
  { key: "dashboard", label: "Dashboard", href: "/admin" },
  { key: "brands", label: "Marcas", href: "/admin/brands" },
  { key: "products", label: "Productos", href: "/admin/products" },
  { key: "product-curation", label: "Curación", href: "/admin/product-curation" },
  { key: "taxonomy", label: "Taxonomía", href: "/admin/taxonomy" },
  { key: "product-enrichment", label: "Enriquecimiento", href: "/admin/product-enrichment" },
  { key: "catalog-refresh", label: "Refresh semanal", href: "/admin/catalog-refresh" },
  { key: "color-combinations", label: "Combinaciones", href: "/admin/color-combinations" },
];

type AdminShellProps = {
  title: string;
  active: string;
  children: React.ReactNode;
};

export default function AdminShell({ title, active, children }: AdminShellProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="w-full border-b border-slate-200 bg-white/95 px-6 py-6 shadow-sm lg:sticky lg:top-0 lg:h-screen lg:w-72 lg:border-b-0 lg:border-r lg:px-5">
          <div className="space-y-6">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-indigo-500">ODA Admin</p>
              <p className="mt-2 text-sm text-slate-500">Consola operativa</p>
            </div>
            <nav className="grid gap-2 text-sm">
              {navItems.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className={`flex items-center justify-between rounded-xl px-4 py-2 font-semibold transition ${
                    active === item.key
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </aside>
        <div className="min-w-0 flex-1 px-6 py-8 lg:px-10">
          <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Panel</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">{title}</h1>
          </header>
          <main className="mt-6 space-y-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
