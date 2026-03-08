"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { StyleDimension } from "@/lib/style-engine/types";

type ProfileData = {
  coherenceScore: number;
  keywords: string[];
  dimensions: StyleDimension[];
};

const LOADING_MESSAGES = [
  "Buscando siluetas similares...",
  "Analizando texturas...",
  "Curando tu feed...",
];

type Props = {
  sessionId: string;
};

function coherenceDescription(score: number): string {
  if (score >= 80) return "Tu gusto es muy definido y consistente";
  if (score >= 50) return "Tienes un estilo versátil con tendencias claras";
  return "Eres ecléctico — te gusta explorar muchos estilos";
}

export default function StyleProfileView({ sessionId }: Props) {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Animate loading messages
    const interval = setInterval(() => {
      setLoadingStep((prev) =>
        prev < LOADING_MESSAGES.length - 1 ? prev + 1 : prev,
      );
    }, 1000);

    // Fetch profile
    async function fetchProfile() {
      try {
        const res = await fetch(
          `/api/style-sessions/${sessionId}/profile`,
        );
        if (!res.ok) {
          setError(true);
          return;
        }
        const data = await res.json();
        // Ensure minimum loading time of 2.5s for the animation
        setTimeout(() => setProfile(data), 500);
      } catch {
        setError(true);
      }
    }

    fetchProfile();

    return () => clearInterval(interval);
  }, [sessionId]);

  if (error) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[color:var(--oda-cream)] px-6">
        <p className="mb-4 text-center text-[color:var(--oda-taupe)]">
          Error al calcular tu perfil.
        </p>
        <button
          onClick={() => router.push("/style-discovery")}
          className="rounded-xl bg-[color:var(--oda-ink)] px-6 py-3 text-sm font-semibold text-white"
        >
          Volver al inicio
        </button>
      </div>
    );
  }

  // Loading state
  if (!profile) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[color:var(--oda-cream)] px-6">
        <div className="flex flex-col items-center gap-6">
          {/* Pulsing circle */}
          <motion.div
            className="h-16 w-16 rounded-full bg-[color:var(--oda-gold)]"
            animate={{ scale: [1, 1.2, 1], opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
          <AnimatePresence mode="wait">
            <motion.p
              key={loadingStep}
              className="text-center text-sm text-[color:var(--oda-taupe)]"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
            >
              {LOADING_MESSAGES[loadingStep]}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[color:var(--oda-cream)] px-6 py-12">
      <motion.div
        className="mx-auto w-full max-w-sm"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <h1
          className="mb-2 text-2xl font-bold text-[color:var(--oda-ink)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Tu Perfil de Estilo
        </h1>
        <p className="mb-8 text-sm text-[color:var(--oda-taupe)]">
          Esto es lo que hemos aprendido
        </p>

        {/* Coherence Score */}
        <motion.div
          className="mb-8 text-center"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <p
            className="text-5xl font-bold text-[color:var(--oda-ink)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {profile.coherenceScore}
          </p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--oda-taupe)]">
            Coherencia de Estilo
          </p>
          <p className="mt-2 text-sm text-[color:var(--oda-taupe)]">
            {coherenceDescription(profile.coherenceScore)}
          </p>
        </motion.div>

        {/* Keywords */}
        <div className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[color:var(--oda-taupe)]">
            Tu ADN de Estilo
          </h2>
          <div className="flex flex-wrap gap-2">
            {profile.keywords.map((keyword, i) => (
              <motion.span
                key={keyword}
                className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-stone)] px-3 py-1.5 text-sm text-[color:var(--oda-ink)]"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + i * 0.1 }}
              >
                {keyword}
              </motion.span>
            ))}
          </div>
        </div>

        {/* Dimensions */}
        <div className="mb-10">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[color:var(--oda-taupe)]">
            Tus Dimensiones
          </h2>
          <div className="space-y-4">
            {profile.dimensions.map((dim, i) => (
              <motion.div
                key={dim.label}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.15, duration: 0.4 }}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium text-[color:var(--oda-ink)]">
                    {dim.label}
                  </span>
                  <span className="text-xs text-[color:var(--oda-taupe)]">
                    {dim.score}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[color:var(--oda-stone)]">
                  <motion.div
                    className="h-full rounded-full bg-[color:var(--oda-ink)]"
                    initial={{ width: 0 }}
                    animate={{ width: `${dim.score}%` }}
                    transition={{
                      delay: 0.5 + i * 0.15,
                      duration: 0.8,
                      ease: "easeOut",
                    }}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={() =>
            router.push(`/style-discovery/feed?session=${sessionId}`)
          }
          className="w-full rounded-xl bg-[color:var(--oda-ink)] px-6 py-4 text-base font-semibold text-white transition hover:opacity-90"
        >
          Ver Mis Recomendaciones
        </button>
      </motion.div>
    </div>
  );
}
