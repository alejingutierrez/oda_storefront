"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { stripHtml } from "@/lib/utils";

type Props = {
  title: string;
  content: ReactNode;
  defaultOpen?: boolean;
};

export default function PdpAccordionSection({
  title,
  content,
  defaultOpen = false,
}: Props) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // If content is a string, strip HTML and treat empty as null
  const isString = typeof content === "string";
  const displayContent = isString ? stripHtml(content) : content;

  if (!displayContent) return null;

  return (
    <div className="border-t border-[color:var(--oda-border)]">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        aria-expanded={isOpen}
        className="flex w-full cursor-pointer items-center justify-between py-4 text-sm font-medium uppercase tracking-[0.16em] text-[color:var(--oda-ink)] select-none"
      >
        {title}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[color:var(--oda-taupe)] transition-transform duration-300 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className={`pb-5 ${isString ? "text-sm leading-relaxed text-[color:var(--oda-ink-soft)] whitespace-pre-line" : ""}`}>
            {displayContent}
          </div>
        </div>
      </div>
    </div>
  );
}
