"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Shirt, Palette, Scissors, Sparkles } from "lucide-react";

export default function StyleDiscoveryOnboarding() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleStart = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/style-sessions", { method: "POST" });
      if (!res.ok) {
        if (res.status === 401) {
          router.push(`/sign-in?next=${encodeURIComponent("/style-discovery")}`);
          return;
        }
        throw new Error("Failed to create session");
      }
      const data = await res.json();
      router.push(`/style-discovery/swipe?session=${data.id}`);
    } catch (error) {
      console.error("Failed to start session:", error);
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[color:var(--oda-cream)] px-6 py-12">
      <motion.div
        className="flex w-full max-w-sm flex-col items-center text-center"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        {/* Illustration */}
        <div className="mb-8 grid grid-cols-2 gap-4">
          {[Shirt, Palette, Scissors, Sparkles].map((Icon, i) => (
            <motion.div
              key={i}
              className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[color:var(--oda-stone)]"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15 * i, duration: 0.4 }}
            >
              <Icon
                size={32}
                strokeWidth={1.4}
                className="text-[color:var(--oda-ink)]"
              />
            </motion.div>
          ))}
        </div>

        {/* Title */}
        <h1
          className="mb-3 text-3xl font-bold tracking-tight text-[color:var(--oda-ink)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Tu Estilo, Tu Ritmo
        </h1>

        {/* Subtitle */}
        <p className="mb-6 text-base leading-relaxed text-[color:var(--oda-taupe)]">
          Desliza para enseñar a nuestro algoritmo qué te gusta.
        </p>

        {/* Info tags */}
        <div className="mb-10 flex gap-2">
          {["20 prendas", "2 min", "100% tuyo"].map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-[color:var(--oda-border)] bg-[color:var(--oda-stone)] px-3 py-1 text-xs text-[color:var(--oda-taupe)]"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* CTA */}
        <button
          onClick={handleStart}
          disabled={loading}
          className="w-full rounded-xl bg-[color:var(--oda-ink)] px-6 py-4 text-base font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Preparando..." : "Empezar"}
        </button>
      </motion.div>
    </div>
  );
}
