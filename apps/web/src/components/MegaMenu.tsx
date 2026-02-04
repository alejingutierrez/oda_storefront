import Link from "next/link";
import type { MegaMenuData } from "@/lib/home-data";
import { GENDER_ROUTE, type GenderKey } from "@/lib/navigation";

const GENDERS: GenderKey[] = ["Femenino", "Masculino", "Unisex", "Infantil"];

export default function MegaMenu({ menu }: { menu: MegaMenuData }) {
  return (
    <nav className="relative">
      <ul className="flex items-center gap-6 text-sm uppercase tracking-[0.18em] text-[color:var(--oda-ink)]">
        {GENDERS.map((gender) => {
          const route = GENDER_ROUTE[gender];
          const data = menu[gender];
          return (
            <li key={gender} className="group relative">
              <Link
                href={`/g/${route}`}
                className="block py-6 text-xs font-medium transition-colors hover:text-[color:var(--oda-ink-soft)]"
              >
                {gender}
              </Link>
              <div className="pointer-events-none absolute left-0 top-full w-[860px] -translate-x-4 rounded-3xl border border-[color:var(--oda-border)] bg-white/95 p-8 opacity-0 shadow-[0_30px_80px_rgba(23,21,19,0.18)] backdrop-blur transition-all duration-200 group-hover:pointer-events-auto group-hover:opacity-100">
                <div className="grid grid-cols-3 gap-8">
                  {([
                    ["Superiores", data.Superiores],
                    ["Inferiores", data.Inferiores],
                    ["Accesorios", data.Accesorios],
                  ] as const).map(([title, items]) => (
                    <div key={title} className="flex flex-col gap-4">
                      <span className="text-xs uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                        {title}
                      </span>
                      <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto pr-2">
                        {items.map((item) => (
                          <div key={item.key} className="flex flex-col gap-2">
                            <Link
                              href={item.href}
                              className="text-sm font-medium text-[color:var(--oda-ink)] transition-colors hover:text-[color:var(--oda-ink-soft)]"
                            >
                              {item.label}
                            </Link>
                            {item.subcategories && item.subcategories.length > 0 ? (
                              <div className="grid gap-1 border-l border-[color:var(--oda-border)] pl-3">
                                {item.subcategories.map((sub) => (
                                  <Link
                                    key={sub.key}
                                    href={sub.href}
                                    className="text-xs uppercase tracking-[0.14em] text-[color:var(--oda-taupe)] hover:text-[color:var(--oda-ink)]"
                                  >
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
                </div>
                <div className="mt-6 border-t border-[color:var(--oda-border)] pt-4 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                  <Link
                    href={`/g/${route}`}
                    className="inline-flex items-center gap-2 hover:text-[color:var(--oda-ink)]"
                  >
                    Ver todo {gender}
                    <span aria-hidden>→</span>
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
