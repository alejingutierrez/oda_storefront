import Link from "next/link";
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
      className="hidden lg:flex flex-wrap items-center gap-1 pt-8 pb-5 text-[11px] uppercase tracking-[0.18em] text-[color:var(--oda-taupe)]"
    >
      {crumbs.map((crumb, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="mx-0.5 text-[color:var(--oda-taupe)]" aria-hidden>/</span>}
          {crumb.href ? (
            <Link
              href={crumb.href}
              prefetch={false}
              className="transition hover:text-[color:var(--oda-ink)]"
            >
              {crumb.label}
            </Link>
          ) : (
            <span className="max-w-[220px] truncate text-[color:var(--oda-ink-soft)]">
              {crumb.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
