"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSession, useUser } from "@descope/nextjs-sdk/client";
import SignInLink from "@/components/SignInLink";

type AccountLinkProps = {
  className?: string;
};

const getInitials = (value: string) => {
  const clean = value.trim();
  if (!clean) return "U";
  const parts = clean.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  const initials = `${first}${second}`.toUpperCase();
  return initials || "U";
};

export default function AccountLink({ className }: AccountLinkProps) {
  const { isAuthenticated, isSessionLoading } = useSession();
  const { user, isUserLoading } = useUser();

  const label = useMemo(() => {
    if (user?.name) return user.name;
    if (typeof user?.email === "string" && user.email.includes("@")) {
      return user.email.split("@")[0] ?? "";
    }
    return "";
  }, [user?.email, user?.name]);

  if (isSessionLoading || isUserLoading) {
    return (
      <span className={className} aria-live="polite">
        …
      </span>
    );
  }

  if (!isAuthenticated) {
    return (
      <SignInLink className={className}>
        Ingresar
      </SignInLink>
    );
  }

  const picture =
    typeof user?.picture === "string" && user.picture.length > 0 ? user.picture : null;

  return (
    <Link href="/perfil" className={className}>
      <span className="inline-flex items-center gap-2">
        {picture ? (
          // Usamos <img> para evitar allowlists de next/image en fotos de Google/Apple/Facebook.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={picture}
            alt={label ? `Avatar de ${label}` : "Avatar"}
            className="h-8 w-8 rounded-full border border-[color:var(--oda-border)] object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="grid h-8 w-8 place-items-center rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--oda-ink)]">
            {getInitials(label || "Usuario")}
          </span>
        )}
        <span className="text-xs uppercase tracking-[0.2em]">Perfil</span>
      </span>
    </Link>
  );
}

