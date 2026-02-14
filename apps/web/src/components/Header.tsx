import Link from "next/link";
import AccountLink from "@/components/AccountLink";
import HeaderMobileMenu from "@/components/HeaderMobileMenu";
import MegaMenu from "@/components/MegaMenu";
import type { MegaMenuData } from "@/lib/home-data";

export default function Header({ menu }: { menu: MegaMenuData }) {
  return (
    <header className="sticky top-0 z-40 border-b border-[color:var(--oda-border)] bg-white/90 backdrop-blur">
      <div className="oda-container relative flex items-center gap-8">
        <Link
          href="/"
          className="flex items-center py-6 text-lg font-semibold uppercase tracking-[0.32em]"
        >
          ODA
        </Link>
        <div className="hidden lg:flex flex-1 items-center">
          <MegaMenu menu={menu} />
        </div>
        <div className="ml-auto flex items-center gap-4 lg:hidden">
          <HeaderMobileMenu menu={menu} />
        </div>
        <div className="ml-auto hidden items-center gap-4 lg:flex">
          <div className="flex items-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2">
            <input
              type="text"
              placeholder="Buscar"
              className="w-[28rem] bg-transparent text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)] placeholder:text-[color:var(--oda-taupe)] focus:outline-none"
            />
          </div>
          <Link
            href="/buscar"
            className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
          >
            Explorar
          </Link>
          <AccountLink className="text-[color:var(--oda-ink)]" />
        </div>
      </div>
    </header>
  );
}
