import { ChevronDown } from "lucide-react";

type Props = {
  title: string;
  content: string | null | undefined;
  defaultOpen?: boolean;
};

export default function PdpAccordionSection({
  title,
  content,
  defaultOpen = false,
}: Props) {
  if (!content) return null;

  return (
    <details
      open={defaultOpen || undefined}
      className="border-t border-[color:var(--oda-border)] group"
    >
      <summary className="flex cursor-pointer items-center justify-between py-4 text-sm font-medium uppercase tracking-[0.16em] text-[color:var(--oda-ink)] select-none">
        {title}
        <ChevronDown className="h-4 w-4 shrink-0 text-[color:var(--oda-taupe)] transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="pb-5 text-sm leading-relaxed text-[color:var(--oda-ink-soft)] whitespace-pre-line">
        {content}
      </div>
    </details>
  );
}
