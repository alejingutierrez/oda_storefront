import Image from "next/image";
import Link from "next/link";
import type { CategoryHighlight } from "@/lib/home-types";

export default function CategoryGallery({ categories }: { categories: CategoryHighlight[] }) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--oda-taupe)]">Explorar</p>
        <h2 className="font-display text-4xl leading-none text-[color:var(--oda-ink)] sm:text-5xl">Categorias clave</h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {categories.map((category) => (
          <Link
            key={category.category}
            href={category.href}
            className="group relative overflow-hidden rounded-[1.15rem] bg-[color:var(--oda-stone)]"
          >
            <div className="relative aspect-[3/4] w-full">
              <Image
                src={category.imageCoverUrl}
                alt={category.label}
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 34vw, 24vw"
                className="object-cover saturate-0 transition duration-700 ease-out group-hover:scale-[1.04] group-hover:saturate-100 group-focus-visible:scale-[1.04] group-focus-visible:saturate-100"
                unoptimized
              />
            </div>
            <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.6),rgba(0,0,0,0.06),rgba(0,0,0,0))]" />
            <div className="absolute bottom-4 left-4 right-4 text-[11px] uppercase tracking-[0.24em] text-white">
              {category.label}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
