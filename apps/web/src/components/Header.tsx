import Link from "next/link";
import dynamic from "next/dynamic";
import HeaderHeightSync from "@/components/HeaderHeightSync";
import MegaMenu from "@/components/MegaMenu";
import type { MegaMenuData } from "@/lib/home-types";

const HeaderMobileMenu = dynamic(() => import("@/components/HeaderMobileMenu"), {
  loading: () => (
    <button
      type="button"
      className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
      aria-label="Menu"
    >
      Menu
      <span className="inline-flex h-8 w-8 items-center justify-center text-[color:var(--oda-taupe)]" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    </button>
  ),
});

const AccountLink = dynamic(() => import("@/components/AccountLink"), {
  loading: () => (
    <Link
      prefetch={false}
      href="/sign-in"
      className="rounded-full px-3 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
    >
      Ingresar
    </Link>
  ),
});

export default function Header({ menu }: { menu: MegaMenuData }) {
  return (
    <header
      data-oda-header="true"
      className="sticky top-0 z-40 border-b border-[color:var(--oda-border)] bg-white/90 backdrop-blur"
    >
      <HeaderHeightSync />
      <div className="oda-container relative flex items-center gap-4 lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:gap-8">
        <Link
          prefetch={false}
          href="/"
          className="flex items-center py-6 text-lg font-semibold uppercase tracking-[0.32em]"
        >
          ODA
        </Link>
        <div className="hidden min-w-0 lg:flex lg:items-center">
          <MegaMenu menu={menu} />
        </div>
        <div className="ml-auto flex items-center gap-4 lg:hidden">
          <HeaderMobileMenu menu={menu} />
        </div>
        <div className="hidden shrink-0 items-center gap-4 lg:flex lg:justify-self-end">
          <form
            action="/buscar"
            method="GET"
            className="flex items-center gap-2 rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2"
          >
            <label htmlFor="oda-header-search" className="sr-only">
              Buscar en catalogo
            </label>
            <input
              id="oda-header-search"
              name="q"
              autoComplete="off"
              type="text"
              placeholder="Buscar"
              className="w-[clamp(12rem,18vw,20rem)] bg-transparent text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)] placeholder:text-[color:var(--oda-taupe)] focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-full border border-[color:var(--oda-border)] bg-white px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)]"
            >
              Ir
            </button>
          </form>
          <Link
            prefetch={false}
            href="/buscar"
            className="rounded-full px-3 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)] transition hover:bg-[color:var(--oda-stone)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            Explorar
          </Link>
          <AccountLink />
        </div>
      </div>
    </header>
  );
}
