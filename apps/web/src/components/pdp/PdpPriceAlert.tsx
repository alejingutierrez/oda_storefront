"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@descope/nextjs-sdk/client";

type Props = {
  productId: string;
  currentPrice: string | null;
  currency: string;
};

type AlertData = {
  id: string;
  targetPrice: string;
  active: boolean;
};

export default function PdpPriceAlert({ productId, currentPrice, currency }: Props) {
  const { isAuthenticated } = useSession();
  const [alert, setAlert] = useState<AlertData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    fetch(`/api/user/price-alerts?productId=${encodeURIComponent(productId)}`)
      .then((r) => r.json())
      .then((data: { alert?: AlertData | null }) => {
        if (!cancelled && data.alert) setAlert(data.alert);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, productId]);

  useEffect(() => {
    if (showInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showInput]);

  const handleCreate = useCallback(async () => {
    const target = Number(inputValue.replace(/[^0-9]/g, ""));
    if (!target || target <= 0) return;

    setLoading(true);
    try {
      const res = await fetch("/api/user/price-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, targetPrice: target, currency }),
      });
      if (res.ok) {
        const data = (await res.json()) as { alert: AlertData };
        setAlert(data.alert);
        setShowInput(false);
        setInputValue("");
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [currency, inputValue, productId]);

  const handleRemove = useCallback(async () => {
    setLoading(true);
    try {
      await fetch(`/api/user/price-alerts?productId=${encodeURIComponent(productId)}`, {
        method: "DELETE",
      });
      setAlert(null);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [productId]);

  if (!isAuthenticated) return null;

  // Active alert exists
  if (alert?.active) {
    const formatted = Number(alert.targetPrice).toLocaleString("es-CO");
    return (
      <div className="mt-3 flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--oda-gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        <span className="text-[10px] tracking-[0.08em] text-[color:var(--oda-taupe)]">
          Alerta activa: ${formatted}
        </span>
        <button
          type="button"
          onClick={handleRemove}
          disabled={loading}
          className="text-[10px] tracking-[0.08em] text-[color:var(--oda-taupe)] underline hover:text-[color:var(--oda-ink)] disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    );
  }

  // Input mode
  if (showInput) {
    const suggestedPrice = currentPrice ? Math.floor(Number(currentPrice) * 0.9) : null;
    return (
      <div className="mt-3">
        <p className="mb-1.5 text-[10px] tracking-[0.08em] text-[color:var(--oda-taupe)]">
          Avísame cuando baje a:
        </p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-[color:var(--oda-taupe)]">$</span>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setShowInput(false);
              }}
              placeholder={suggestedPrice ? suggestedPrice.toLocaleString("es-CO") : "Precio"}
              className="w-28 rounded-full border border-[color:var(--oda-border)] bg-white py-1.5 pl-5 pr-2 text-[11px] text-[color:var(--oda-ink)] outline-none focus:border-[color:var(--oda-ink)]"
            />
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={loading || !inputValue}
            className="rounded-full bg-[color:var(--oda-ink)] px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-[color:var(--oda-cream)] disabled:opacity-50"
          >
            {loading ? "…" : "Activar"}
          </button>
          <button
            type="button"
            onClick={() => setShowInput(false)}
            className="text-[10px] text-[color:var(--oda-taupe)] hover:text-[color:var(--oda-ink)]"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  // Default: show bell button
  return (
    <button
      type="button"
      onClick={() => setShowInput(true)}
      className="mt-3 flex items-center gap-1.5 text-[10px] tracking-[0.08em] text-[color:var(--oda-taupe)] transition hover:text-[color:var(--oda-ink)]"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      Alertarme si baja de precio
    </button>
  );
}
