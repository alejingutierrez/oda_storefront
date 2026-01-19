import Link from "next/link";

const navItems = [
  { key: "brand-scrape", label: "Scraper de marcas", href: "/admin/brands" },
  { key: "dashboard", label: "Dashboard", href: "/admin" },
];

type AdminShellProps = {
  title: string;
  active: string;
  children: React.ReactNode;
};

export default function AdminShell({ title, active, children }: AdminShellProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-indigo-500">ODA Admin</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1>
          </div>
          <nav className="flex flex-wrap items-center gap-2 text-sm">
            {navItems.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className={`rounded-full px-4 py-2 font-semibold transition ${
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
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
