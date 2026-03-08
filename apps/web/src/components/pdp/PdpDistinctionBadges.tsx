import { Star, Award, Heart } from "lucide-react";

type Props = {
  realStyle: string | null;
  editorialTopPickRank: number | null;
  editorialFavoriteRank: number | null;
};

export default function PdpDistinctionBadges({
  realStyle,
  editorialTopPickRank,
  editorialFavoriteRank,
}: Props) {
  const badges: { icon: typeof Star; label: string }[] = [];

  if (realStyle) {
    badges.push({ icon: Star, label: realStyle });
  }

  if (editorialTopPickRank != null) {
    badges.push({ icon: Award, label: "Top Pick" });
  }

  if (editorialFavoriteRank != null) {
    badges.push({ icon: Heart, label: "Editor Favorite" });
  }

  if (badges.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {badges.map((badge) => {
        const Icon = badge.icon;
        return (
          <span
            key={badge.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--oda-gold)] px-3 py-1 font-[family-name:var(--font-display)] text-[10px] uppercase tracking-[0.16em] text-[color:var(--oda-ink)]"
          >
            <Icon className="h-3 w-3" />
            {badge.label}
          </span>
        );
      })}
    </div>
  );
}
