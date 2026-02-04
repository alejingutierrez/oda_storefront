import Link from "next/link";
import MegaMenu from "@/components/MegaMenu";
import type { MegaMenuData } from "@/lib/home-data";

export default function Header({ menu }: { menu: MegaMenuData }) {
  return (
    <header className="sticky top-0 z-40 border-b border-[color:var(--oda-border)] bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-10 px-6">
        <Link
          href="/"
          className="flex items-center gap-2 py-6 text-lg font-semibold uppercase tracking-[0.32em]"
        >
          ODA
          <span className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            Storefront
          </span>
        </Link>
        <div className="hidden lg:block">
          <MegaMenu menu={menu} />
        </div>
        <div className="ml-auto flex items-center gap-4 lg:hidden">
          <Link
            href="/g/unisex"
            className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
          >
            Menu
          </Link>
        </div>
        <div className="ml-auto hidden items-center gap-4 lg:flex">
          <div className="flex items-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2">
            <input
              type="text"
              placeholder="Buscar"
              className="w-40 bg-transparent text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)] placeholder:text-[color:var(--oda-taupe)] focus:outline-none"
            />
          </div>
          <Link
            href="/buscar"
            className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
          >
            Explorar
          </Link>
        </div>
      </div>
    </header>
  );
}
