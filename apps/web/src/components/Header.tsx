import Link from "next/link";
import MegaMenu from "@/components/MegaMenu";
import type { MegaMenuData } from "@/lib/home-data";
import { GENDER_ROUTE, type GenderKey } from "@/lib/navigation";

const GENDERS: GenderKey[] = ["Femenino", "Masculino", "Unisex", "Infantil"];

function MobileMenu({ menu }: { menu: MegaMenuData }) {
  return (
    <details className="group lg:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
        Menu
        <span className="text-[10px] text-[color:var(--oda-taupe)] transition group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="absolute left-0 right-0 top-full mt-4 rounded-2xl border border-[color:var(--oda-border)] bg-white/95 p-6 shadow-[0_30px_80px_rgba(23,21,19,0.18)] backdrop-blur">
        <div className="flex flex-col gap-6">
          <div className="flex items-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] px-4 py-2">
            <input
              type="text"
              placeholder="Buscar"
              className="w-full bg-transparent text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)] placeholder:text-[color:var(--oda-taupe)] focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            <span>Explorar</span>
            <Link href="/buscar" className="text-[color:var(--oda-ink)]">
              Ver todo
            </Link>
          </div>
          <div className="flex flex-col gap-4">
            {GENDERS.map((gender) => {
              const data = menu[gender];
              return (
                <details
                  key={gender}
                  className="group/section border-t border-[color:var(--oda-border)] pt-4"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]">
                    {gender}
                    <span className="text-[10px] text-[color:var(--oda-taupe)] transition group-open/section:rotate-180">
                      ▾
                    </span>
                  </summary>
                  <div className="mt-4 flex flex-col gap-4">
                    {([
                      ["Superiores", data.Superiores],
                      ["Inferiores", data.Inferiores],
                      ["Accesorios", data.Accesorios],
                    ] as const).map(([title, items]) => (
                      <div key={title} className="flex flex-col gap-2">
                        <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                          {title}
                        </span>
                        <div className="flex flex-col gap-2">
                          {items.map((item) => (
                            <div key={item.key} className="flex flex-col gap-1">
                              <Link
                                href={item.href}
                                className="text-xs font-medium text-[color:var(--oda-ink)]"
                              >
                                {item.label}
                              </Link>
                              {item.subcategories && item.subcategories.length > 0 ? (
                                <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em] text-[color:var(--oda-taupe)]">
                                  {item.subcategories.map((sub) => (
                                    <Link key={sub.key} href={sub.href}>
                                      {sub.label}
                                    </Link>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    <Link
                      href={`/g/${GENDER_ROUTE[gender]}`}
                      className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]"
                    >
                      Ver todo {gender}
                    </Link>
                  </div>
                </details>
              );
            })}
          </div>
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            <span>Cuenta</span>
            <Link href="/sign-in" className="text-[color:var(--oda-ink)]">
              Ingresar
            </Link>
          </div>
        </div>
      </div>
    </details>
  );
}

export default function Header({ menu }: { menu: MegaMenuData }) {
  return (
    <header className="sticky top-0 z-40 border-b border-[color:var(--oda-border)] bg-white/90 backdrop-blur">
      <div className="oda-container relative flex items-center gap-8">
        <Link
          href="/"
          className="flex items-center gap-2 py-6 text-lg font-semibold uppercase tracking-[0.32em]"
        >
          ODA
          <span className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            Storefront
          </span>
        </Link>
        <div className="hidden lg:flex flex-1 items-center">
          <MegaMenu menu={menu} />
        </div>
        <div className="ml-auto flex items-center gap-4 lg:hidden">
          <MobileMenu menu={menu} />
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
          <Link
            href="/sign-in"
            className="text-xs uppercase tracking-[0.2em] text-[color:var(--oda-ink)]"
          >
            Ingresar
          </Link>
        </div>
      </div>
    </header>
  );
}
