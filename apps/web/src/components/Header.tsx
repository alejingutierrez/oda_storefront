import Link from "next/link";
import AccountLink from "@/components/AccountLink";
import HeaderHeightSync from "@/components/HeaderHeightSync";
import HeaderMobileMenu from "@/components/HeaderMobileMenu";
import MegaMenu from "@/components/MegaMenu";
import type { MegaMenuData } from "@/lib/home-data";

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
          <div className="flex items-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2">
            <input
              type="text"
              placeholder="Buscar"
              className="w-[clamp(12rem,18vw,20rem)] bg-transparent text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)] placeholder:text-[color:var(--oda-taupe)] focus:outline-none"
            />
          </div>
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
