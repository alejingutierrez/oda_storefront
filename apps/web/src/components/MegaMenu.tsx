import Link from "next/link";
import type { MegaMenuData } from "@/lib/home-data";
import { GENDER_ROUTE, type GenderKey } from "@/lib/navigation";

const GENDERS: GenderKey[] = ["Femenino", "Masculino", "Unisex", "Infantil"];

const splitColumns = <T,>(items: T[], columns: number) => {
  if (columns <= 1) return [items];
  const perColumn = Math.ceil(items.length / columns);
  return Array.from({ length: columns }, (_, index) =>
    items.slice(index * perColumn, (index + 1) * perColumn),
  );
};

export default function MegaMenu({ menu }: { menu: MegaMenuData }) {
  return (
    <nav className="w-full">
      <ul className="flex items-center gap-6 text-sm uppercase tracking-[0.18em] text-[color:var(--oda-ink)]">
        <li>
          <Link prefetch={false}
            href="/novedades"
            className={[
              "relative block py-6 text-xs font-medium transition-colors hover:text-[color:var(--oda-ink-soft)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
              "after:absolute after:left-1/2 after:bottom-4 after:h-[2px] after:w-0 after:-translate-x-1/2 after:rounded-full after:bg-[color:var(--oda-ink)] after:transition-all after:duration-200 hover:after:w-10",
            ].join(" ")}
          >
            Novedades
          </Link>
        </li>
        {GENDERS.map((gender) => {
          const route = GENDER_ROUTE[gender];
          const data = menu[gender];
          const superioresColumns = splitColumns(data.Superiores, 2);
          return (
            <li key={gender} className="group">
              <Link prefetch={false}
                href={`/g/${route}`}
                className={[
                  "relative block py-6 text-xs font-medium transition-colors hover:text-[color:var(--oda-ink-soft)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                  "after:absolute after:left-1/2 after:bottom-4 after:h-[2px] after:w-0 after:-translate-x-1/2 after:rounded-full after:bg-[color:var(--oda-ink)] after:transition-all after:duration-200 hover:after:w-10",
                ].join(" ")}
              >
                {gender}
              </Link>
              {/* Backdrop scrim: blurs page content behind the mega menu (gaussian-like). */}
              <div
                aria-hidden="true"
                className={[
                  "pointer-events-none fixed inset-0 -z-10 opacity-0 transition-opacity duration-200",
                  "bg-white/10 backdrop-blur-xl backdrop-saturate-150",
                  "group-hover:opacity-100",
                ].join(" ")}
              />
              <div className="oda-glass-noise invisible absolute left-0 right-0 top-full rounded-2xl border border-white/50 bg-white/85 p-8 opacity-0 shadow-[0_30px_80px_rgba(23,21,19,0.18)] backdrop-blur-2xl transition-all duration-200 group-hover:visible group-hover:opacity-100">
                <div className="grid grid-cols-4 gap-8">
                  <div className="col-span-2 flex flex-col gap-4">
                    <span className="text-xs uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                      Superiores
                    </span>
                    <div className="grid grid-cols-2 gap-6">
                      {superioresColumns.map((items, columnIndex) => (
                        <div
                          key={`${gender}-superiores-${columnIndex}`}
                          className="flex max-h-[52vh] flex-col gap-3 overflow-y-auto pr-2"
                        >
                          {items.map((item) => (
                            <div key={item.key} className="flex flex-col gap-2">
                              <Link prefetch={false}
                                href={item.href}
                                className={[
                                  "-mx-2 inline-flex rounded-lg px-2 py-1 text-sm font-medium text-[color:var(--oda-ink)] transition",
                                  "hover:bg-[color:var(--oda-stone)] hover:text-[color:var(--oda-ink-soft)]",
                                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                                ].join(" ")}
                              >
                                {item.label}
                              </Link>
                              {item.subcategories && item.subcategories.length > 0 ? (
                                <div className="grid gap-1 border-l border-[color:var(--oda-border)] pl-3">
                                  {item.subcategories.map((sub) => (
                                    <Link prefetch={false}
                                      key={sub.key}
                                      href={sub.href}
                                      className={[
                                        "-mx-2 inline-flex rounded-md px-2 py-1 text-xs uppercase tracking-[0.14em] text-[color:var(--oda-taupe)] transition",
                                        "hover:bg-[color:var(--oda-stone)] hover:text-[color:var(--oda-ink)]",
                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                                      ].join(" ")}
                                    >
                                      {sub.label}
                                    </Link>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-4">
                    <span className="text-xs uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                      Inferiores
                    </span>
                    <div className="flex max-h-[52vh] flex-col gap-3 overflow-y-auto pr-2">
                      {data.Inferiores.map((item) => (
                        <div key={item.key} className="flex flex-col gap-2">
                          <Link prefetch={false}
                            href={item.href}
                            className={[
                              "-mx-2 inline-flex rounded-lg px-2 py-1 text-sm font-medium text-[color:var(--oda-ink)] transition",
                              "hover:bg-[color:var(--oda-stone)] hover:text-[color:var(--oda-ink-soft)]",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                            ].join(" ")}
                          >
                            {item.label}
                          </Link>
                          {item.subcategories && item.subcategories.length > 0 ? (
                            <div className="grid gap-1 border-l border-[color:var(--oda-border)] pl-3">
                              {item.subcategories.map((sub) => (
                                <Link prefetch={false}
                                  key={sub.key}
                                  href={sub.href}
                                  className={[
                                    "-mx-2 inline-flex rounded-md px-2 py-1 text-xs uppercase tracking-[0.14em] text-[color:var(--oda-taupe)] transition",
                                    "hover:bg-[color:var(--oda-stone)] hover:text-[color:var(--oda-ink)]",
                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                                  ].join(" ")}
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
                  <div className="flex flex-col gap-4">
                    <span className="text-xs uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">
                      Accesorios
                    </span>
                    <div className="flex max-h-[52vh] flex-col gap-3 overflow-y-auto pr-2">
                      {data.Accesorios.map((item) => (
                        <div key={item.key} className="flex flex-col gap-2">
                          <Link prefetch={false}
                            href={item.href}
                            className={[
                              "-mx-2 inline-flex rounded-lg px-2 py-1 text-sm font-medium text-[color:var(--oda-ink)] transition",
                              "hover:bg-[color:var(--oda-stone)] hover:text-[color:var(--oda-ink-soft)]",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                            ].join(" ")}
                          >
                            {item.label}
                          </Link>
                          {item.subcategories && item.subcategories.length > 0 ? (
                            <div className="grid gap-1 border-l border-[color:var(--oda-border)] pl-3">
                              {item.subcategories.map((sub) => (
                                <Link prefetch={false}
                                  key={sub.key}
                                  href={sub.href}
                                  className={[
                                    "-mx-2 inline-flex rounded-md px-2 py-1 text-xs uppercase tracking-[0.14em] text-[color:var(--oda-taupe)] transition",
                                    "hover:bg-[color:var(--oda-stone)] hover:text-[color:var(--oda-ink)]",
                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                                  ].join(" ")}
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
                </div>
                <div className="mt-6 border-t border-[color:var(--oda-border)] pt-4 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                  <Link prefetch={false}
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
