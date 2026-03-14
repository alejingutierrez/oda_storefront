"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/vector-classification/confirmation", label: "Confirmacion" },
  { href: "/admin/vector-classification/model", label: "Modelo" },
  { href: "/admin/vector-classification/suggestions", label: "Sugerencias" },
  { href: "/admin/vector-classification/vector-map", label: "Mapa Vectorial" },
] as const;

export default function TabNav() {
  const pathname = usePathname();

  return (
    <div className="flex gap-2">
      {TABS.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition ${
              isActive
                ? "bg-slate-900 text-white shadow-sm"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
