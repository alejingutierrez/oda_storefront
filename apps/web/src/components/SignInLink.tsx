"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type SignInLinkProps = {
  className?: string;
  children: React.ReactNode;
};

export default function SignInLink({ className, children }: SignInLinkProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const href = useMemo(() => {
    if (!pathname) return "/sign-in";
    const search = searchParams?.toString();
    const next = search ? `${pathname}?${search}` : pathname;
    if (next.startsWith("/sign-in")) return "/sign-in";
    const params = new URLSearchParams();
    params.set("next", next);
    return `/sign-in?${params.toString()}`;
  }, [pathname, searchParams]);

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
