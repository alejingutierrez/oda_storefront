import Link from "next/link";
import { normalizeGender, GENDER_ROUTE } from "@/lib/navigation";

type Props = {
  occasionTags: string[];
  gender: string | null;
};

export default function PdpOccasionPills({ occasionTags, gender }: Props) {
  if (occasionTags.length === 0) return null;

  const genderKey = normalizeGender(gender);
  const genderRoute = GENDER_ROUTE[genderKey];
  const pills = occasionTags.slice(0, 5);

  return (
    <div className="flex gap-2 overflow-x-auto oda-no-scrollbar">
      {pills.map((tag) => (
        <Link
          key={tag}
          href={`/${genderRoute}?occasion=${encodeURIComponent(tag)}`}
          prefetch={false}
          className="shrink-0 rounded-full border border-[color:var(--oda-border)] px-3 py-1 text-[10px] uppercase tracking-[0.1em] text-[color:var(--oda-ink-soft)] transition hover:bg-[color:var(--oda-stone)] hover:text-[color:var(--oda-ink)]"
        >
          {tag}
        </Link>
      ))}
    </div>
  );
}
