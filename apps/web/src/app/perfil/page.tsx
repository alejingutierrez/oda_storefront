"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Descope } from "@descope/nextjs-sdk";
import { useDescope, useSession, useUser } from "@descope/nextjs-sdk/client";

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  apple: "Apple",
  facebook: "Facebook",
};

type ProfilePayload = {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    fullName: string | null;
    bio: string | null;
    avatarUrl: string | null;
    status: string;
    plan: string;
  };
  identities: Array<{ id: string; provider: string; email?: string | null }>;
};

export default function PerfilPage() {
  const router = useRouter();
  const { isAuthenticated, isSessionLoading } = useSession();
  const { user, isUserLoading } = useUser();
  const sdk = useDescope();
  const linkFlowId =
    process.env.NEXT_PUBLIC_DESCOPE_LINK_FLOW_ID ||
    process.env.NEXT_PUBLIC_DESCOPE_SIGNIN_FLOW_ID ||
    "sign-up-or-in";

  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showConnect, setShowConnect] = useState(false);

  const providerSummary = useMemo(() => {
    if (!profile) return [];
    return profile.identities.map((identity) => ({
      id: identity.id,
      provider: identity.provider,
      label: PROVIDER_LABELS[identity.provider] ?? identity.provider,
      email: identity.email ?? "",
    }));
  }, [profile]);

  const loadProfile = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/user/profile", { credentials: "include" });
      if (res.status === 401) {
        router.push("/sign-in?next=/perfil");
        return;
      }
      if (!res.ok) throw new Error("profile_fetch_failed");
      const data = (await res.json()) as ProfilePayload;
      setProfile(data);
      setDisplayName(data.user.displayName ?? "");
      setFullName(data.user.fullName ?? "");
      setBio(data.user.bio ?? "");
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const refreshIdentities = async () => {
    try {
      const res = await fetch("/api/user/identities", {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 401) {
        router.push("/sign-in?next=/perfil");
        return;
      }
      await loadProfile();
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadProfile();
    }
  }, [isAuthenticated]);

  if (isSessionLoading || isUserLoading) {
    return (
      <main className="min-h-screen bg-[color:var(--oda-cream)]">
        <div className="oda-container py-16">Cargando…</div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-[color:var(--oda-cream)]">
        <div className="oda-container py-16">
          <p className="text-sm text-[color:var(--oda-ink)]">
            Necesitas iniciar sesión para ver tu perfil.
          </p>
          <button
            className="mt-4 rounded-full border border-[color:var(--oda-ink)] px-4 py-2 text-xs uppercase tracking-[0.2em]"
            onClick={() => router.push("/sign-in")}
          >
            Ir a login
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[color:var(--oda-cream)]">
      <div className="oda-container grid gap-10 py-16 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-8 shadow-[0_20px_60px_rgba(23,21,19,0.1)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--oda-taupe)]">
                Perfil privado
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-[color:var(--oda-ink)]">
                Hola {user?.name || profile?.user.displayName || ""}
              </h1>
            </div>
            <button
              className="rounded-full border border-[color:var(--oda-ink)] px-4 py-2 text-xs uppercase tracking-[0.2em]"
              onClick={() => sdk.logout().then(() => router.push("/"))}
            >
              Cerrar sesión
            </button>
          </div>

          <div className="mt-8 grid gap-6">
            <label className="grid gap-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
              Nombre para mostrar
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="rounded-xl border border-[color:var(--oda-border)] px-4 py-3 text-sm text-[color:var(--oda-ink)]"
                placeholder="Tu nombre"
              />
            </label>
            <label className="grid gap-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
              Nombre completo
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="rounded-xl border border-[color:var(--oda-border)] px-4 py-3 text-sm text-[color:var(--oda-ink)]"
                placeholder="Nombre y apellido"
              />
            </label>
            <label className="grid gap-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
              Biografía
              <textarea
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                className="min-h-[120px] rounded-xl border border-[color:var(--oda-border)] px-4 py-3 text-sm text-[color:var(--oda-ink)]"
                placeholder="Cuéntanos sobre tu estilo"
              />
            </label>

            <div className="flex flex-wrap gap-3">
              <button
                disabled={saving}
                className="rounded-full bg-[color:var(--oda-ink)] px-6 py-3 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-cream)]"
                onClick={async () => {
                  setSaving(true);
                  try {
                    const res = await fetch("/api/user/profile", {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ displayName, fullName, bio }),
                    });
                    if (res.status === 401) {
                      router.push("/sign-in?next=/perfil");
                      return;
                    }
                    if (!res.ok) throw new Error("save_failed");
                    const data = (await res.json()) as { user: ProfilePayload["user"] };
                    setProfile((prev) => (prev ? { ...prev, user: data.user } : prev));
                  } catch (error) {
                    console.error(error);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Guardar cambios
              </button>
              <button
                className="rounded-full border border-[color:var(--oda-ink)] px-6 py-3 text-xs uppercase tracking-[0.2em]"
                onClick={async () => {
                  if (!confirm("¿Seguro que quieres borrar tu cuenta? Esta acción es irreversible.")) {
                    return;
                  }
                  await fetch("/api/user/delete", { method: "POST", credentials: "include" });
                  await sdk.logout();
                  router.push("/");
                }}
              >
                Borrar cuenta
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[color:var(--oda-border)] bg-white p-8 shadow-[0_20px_60px_rgba(23,21,19,0.1)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--oda-taupe)]">
                Conexiones
              </p>
              <h2 className="mt-2 text-xl font-semibold text-[color:var(--oda-ink)]">
                Proveedores vinculados
              </h2>
            </div>
            <button
              className="rounded-full border border-[color:var(--oda-ink)] px-4 py-2 text-[10px] uppercase tracking-[0.2em]"
              onClick={refreshIdentities}
            >
              Actualizar
            </button>
          </div>

          <div className="mt-6 grid gap-4">
            {loading ? (
              <p className="text-sm text-[color:var(--oda-ink-soft)]">Cargando conexiones…</p>
            ) : providerSummary.length === 0 ? (
              <p className="text-sm text-[color:var(--oda-ink-soft)]">
                Aún no tienes proveedores vinculados.
              </p>
            ) : (
              providerSummary.map((provider) => (
                <div
                  key={provider.id}
                  className="flex items-center justify-between rounded-xl border border-[color:var(--oda-border)] px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-[color:var(--oda-ink)]">
                      {provider.label}
                    </p>
                    <p className="text-xs text-[color:var(--oda-ink-soft)]">{provider.email}</p>
                  </div>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
                    Conectado
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="mt-8">
            <button
              className="rounded-full bg-[color:var(--oda-ink)] px-5 py-2 text-xs uppercase tracking-[0.2em] text-[color:var(--oda-cream)]"
              onClick={() => setShowConnect((prev) => !prev)}
            >
              {showConnect ? "Ocultar" : "Conectar proveedor"}
            </button>
            {showConnect ? (
              <div className="mt-6 rounded-2xl border border-[color:var(--oda-border)] bg-[color:var(--oda-cream)] p-4">
                <Descope
                  flowId={linkFlowId}
                  theme="light"
                  onSuccess={async () => {
                    await fetch("/api/user/identities", {
                      method: "POST",
                      credentials: "include",
                    });
                    await loadProfile();
                  }}
                  onError={(error) => console.error("Descope flow error", error)}
                />
                <p className="mt-3 text-xs text-[color:var(--oda-ink-soft)]">
                  Este flow debe permitir vincular proveedores cuando el usuario ya está autenticado.
                </p>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
