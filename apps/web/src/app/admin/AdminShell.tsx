"use client";

import { useState } from "react";
import Link from "next/link";

const navItems = [
  { key: "dashboard", label: "Dashboard", href: "/admin" },
  { key: "home", label: "Home", href: "/admin/home" },
  { key: "brands", label: "Marcas", href: "/admin/brands" },
  { key: "products", label: "Productos", href: "/admin/products" },
  { key: "product-curation", label: "Curación", href: "/admin/product-curation" },
  { key: "real-style", label: "Real Style", href: "/admin/real-style" },
  { key: "real-style-filter", label: "Filtro Real Style", href: "/admin/real-style-filter" },
  { key: "taxonomy", label: "Taxonomía", href: "/admin/taxonomy" },
  { key: "taxonomy-remap-review", label: "Remap review", href: "/admin/taxonomy-remap-review" },
  { key: "vector-classification", label: "Clasif. Vectorial", href: "/admin/vector-classification" },
  { key: "product-enrichment", label: "Enriquecimiento", href: "/admin/product-enrichment" },
  { key: "plp-seo", label: "SEO PLP", href: "/admin/plp-seo" },
  { key: "pricing", label: "Precios (TRM)", href: "/admin/pricing" },
  { key: "catalog-refresh", label: "Refresh semanal", href: "/admin/catalog-refresh" },
  { key: "color-combinations", label: "Combinaciones", href: "/admin/color-combinations" },
];

type AdminShellProps = {
  title: string;
  active: string;
  children: React.ReactNode;
};

export default function AdminShell({ title, active, children }: AdminShellProps) {
  const [navOpen, setNavOpen] = useState(false);

  const activeLabel = navItems.find((item) => item.key === active)?.label ?? title;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen flex-col lg:flex-row">
        {/* ── Mobile / Tablet: thin top bar ── */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-2 shadow-sm lg:hidden">
          <div className="flex items-center gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-500">ODA</p>
            <span className="text-xs text-slate-400">/</span>
            <p className="text-sm font-semibold text-slate-700">{activeLabel}</p>
          </div>
          <button
            type="button"
            onClick={() => setNavOpen((prev) => !prev)}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600"
            aria-label={navOpen ? "Cerrar menú" : "Abrir menú"}
          >
            {navOpen ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 6h14M3 10h14M3 14h14" />
              </svg>
            )}
          </button>
        </div>

        {/* ── Mobile / Tablet: collapsible nav overlay ── */}
        {navOpen ? (
          <div className="border-b border-slate-200 bg-white px-4 pb-4 pt-2 shadow-md lg:hidden">
            <nav className="grid gap-1.5 text-sm">
              {navItems.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setNavOpen(false)}
                  className={`flex items-center rounded-xl px-4 py-2.5 font-semibold transition ${
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
        ) : null}

        {/* ── Desktop: sticky sidebar ── */}
        <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-white/95 px-5 py-6 shadow-sm lg:sticky lg:top-0 lg:block lg:h-screen">
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

        <div className="min-w-0 flex-1 px-4 py-4 md:px-6 md:py-6 lg:px-10 lg:py-8">
          <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Panel</p>
            <h1 className="mt-2 text-xl font-semibold text-slate-900 md:text-2xl">{title}</h1>
          </header>
          <main className="mt-4 space-y-4 md:mt-6 md:space-y-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
