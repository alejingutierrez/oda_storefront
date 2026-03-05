import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  labelize,
  labelizeSubcategory,
  normalizeGender,
  GENDER_ROUTE,
} from "@/lib/navigation";

type Props = {
  gender: string | null;
  category: string | null;
  subcategory: string | null;
  productName: string;
};

export default function PdpBreadcrumbs({
  gender,
  category,
  subcategory,
  productName,
}: Props) {
  const genderKey = normalizeGender(gender);
  const genderRoute = GENDER_ROUTE[genderKey];
  const genderLabel = genderKey;

  const crumbs: { label: string; href?: string }[] = [
    { label: "Inicio", href: "/" },
    { label: genderLabel, href: `/${genderRoute}` },
  ];

  if (category) {
    crumbs.push({
      label: labelize(category),
      href: `/${genderRoute}/${category}`,
    });
  }

  if (subcategory) {
    crumbs.push({
      label: labelizeSubcategory(subcategory),
      href: category ? `/${genderRoute}/${category}/${subcategory}` : undefined,
    });
  }

  crumbs.push({ label: productName });

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center gap-1 py-4 text-[11px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]"
    >
      {crumbs.map((crumb, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />}
          {crumb.href ? (
            <Link
              href={crumb.href}
              prefetch={false}
              className="transition hover:text-[color:var(--oda-ink)]"
            >
              {crumb.label}
            </Link>
          ) : (
            <span className="text-[color:var(--oda-ink-soft)] line-clamp-1">
              {crumb.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
