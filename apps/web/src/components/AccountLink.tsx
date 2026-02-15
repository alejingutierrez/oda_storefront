"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Necesario para evitar hydration mismatch (SSR vs primer render cliente).
    setMounted(true);
  }, []);

  const baseClass = [
    "inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs uppercase tracking-[0.2em] transition",
    "text-[color:var(--oda-ink)] hover:bg-[color:var(--oda-stone)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--oda-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const label = (() => {
    if (user?.name) return user.name;
    if (typeof user?.email === "string" && user.email.includes("@")) {
      return user.email.split("@")[0] ?? "";
    }
    return "";
  })();

  // SSR + primer render en cliente deben ser deterministas para evitar hydration mismatch.
  if (!mounted) {
    return (
      <span className={baseClass} aria-live="polite">
        …
      </span>
    );
  }

  if (isSessionLoading || isUserLoading) {
    return (
      <span className={baseClass} aria-live="polite">
        …
      </span>
    );
  }

  if (!isAuthenticated) {
    return (
      <SignInLink className={baseClass}>
        Ingresar
      </SignInLink>
    );
  }

  const picture =
    typeof user?.picture === "string" && user.picture.length > 0 ? user.picture : null;

  return (
    <Link href="/perfil" className={baseClass} aria-label="Perfil" title="Perfil">
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
    </Link>
  );
}
