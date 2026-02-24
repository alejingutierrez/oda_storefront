import Image from "next/image";
import Link from "next/link";
import type { CategoryHighlight } from "@/lib/home-types";

const DESKTOP_LAYOUT = [
  "md:col-span-3 md:row-span-2",
  "md:col-span-3 md:row-span-1",
  "md:col-span-2 md:row-span-1",
  "md:col-span-2 md:row-span-1",
  "md:col-span-2 md:row-span-1",
  "md:col-span-3 md:row-span-1",
  "md:col-span-3 md:row-span-1",
  "md:col-span-2 md:row-span-1",
];

function tileLayout(index: number) {
  return DESKTOP_LAYOUT[index] ?? "md:col-span-2 md:row-span-1";
}

export default function CategoryGallery({ categories }: { categories: CategoryHighlight[] }) {
  const hasCategories = categories.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Explorar</p>
        <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">Categorias clave</h2>
      </div>

      {hasCategories ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-6 md:auto-rows-[170px] lg:auto-rows-[180px]">
          {categories.map((category, index) => (
            <Link
              key={category.category}
              href={category.href}
              className={`group relative col-span-1 row-span-1 overflow-hidden rounded-[1.15rem] bg-[color:var(--oda-stone)] ${tileLayout(index)}`}
            >
              <div className="relative h-full min-h-[160px] w-full">
                <Image
                  src={category.imageCoverUrl}
                  alt={category.label}
                  fill
                  sizes="(max-width: 768px) 48vw, (max-width: 1200px) 33vw, 28vw"
                  className="object-cover saturate-[0.72] transition duration-700 ease-out group-hover:scale-[1.04] group-hover:saturate-100 group-focus-visible:scale-[1.04] group-focus-visible:saturate-100"
                  unoptimized
                />
              </div>
              <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.68),rgba(0,0,0,0.14),rgba(0,0,0,0))]" />
              <div className="absolute inset-x-4 bottom-4">
                <p className="text-[10px] uppercase tracking-[0.24em] text-white/72">Categoria</p>
                <p className="mt-1 text-lg leading-tight text-white sm:text-xl">{category.label}</p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-[1.2rem] border border-[color:var(--oda-border)] bg-white p-8 sm:p-10">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Actualizando</p>
          <h3 className="mt-3 font-display text-3xl leading-none text-[color:var(--oda-ink)] sm:text-4xl">
            Estamos recomponiendo categorias.
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[color:var(--oda-ink-soft)] sm:text-base">
            Mientras sincronizamos nuevas referencias del catalogo, puedes seguir explorando todo el inventario desde la
            vista general.
          </p>
          <Link
            href="/catalogo"
            className="mt-6 inline-flex rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-ink)] px-5 py-2.5 text-[11px] uppercase tracking-[0.2em] text-[color:var(--oda-cream)] transition hover:bg-[color:var(--oda-ink-soft)]"
          >
            Ir al catalogo
          </Link>
        </div>
      )}
    </div>
  );
}
