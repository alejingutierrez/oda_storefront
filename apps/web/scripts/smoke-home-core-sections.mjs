#!/usr/bin/env node

const targetUrl = process.argv[2] || process.env.HOME_SMOKE_URL || "https://oda-moda.vercel.app";

const criticalEmptyMarkers = [
  "Estamos recomponiendo categorias.",
  "Aun no hay picks activos.",
  "Sin bajadas recientes detectadas.",
  "Sin snapshot diario disponible.",
  "Estamos actualizando este carrusel.",
];

function parseCoverageProductCount(html) {
  const compact = html.replace(/\s+/g, " ");
  const match = compact.match(/Productos activos(?:<[^>]+>|\s|:){0,40}([0-9][0-9\.,]*)/i);
  if (!match?.[1]) return null;
  const normalized = match[1].replace(/\./g, "").replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

async function main() {
  const response = await fetch(targetUrl, {
    cache: "no-store",
    headers: {
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent": "oda-home-smoke/1.0",
    },
  });

  if (!response.ok) {
    console.error("[home-smoke] request_failed", { targetUrl, status: response.status });
    process.exit(1);
  }

  const html = await response.text();
  const hits = criticalEmptyMarkers.filter((marker) => html.includes(marker));
  const productCount = parseCoverageProductCount(html);

  if (hits.length > 0 && (productCount === null || productCount > 0)) {
    console.error("[home-smoke] critical_empty_detected", {
      targetUrl,
      productCount,
      hits,
    });
    process.exit(1);
  }

  console.log("[home-smoke] ok", {
    targetUrl,
    productCount,
    detectedFallbacks: hits.length,
  });
}

main().catch((error) => {
  console.error("[home-smoke] unexpected_error", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
