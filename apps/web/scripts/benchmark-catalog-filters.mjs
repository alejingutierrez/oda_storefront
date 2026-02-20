import { performance } from "node:perf_hooks";

const PRICE_UNIT = 10_000;
const SLO_BY_PHASE_MS = {
  warm: 1_200,
  cold: 3_000,
};

function parseIntSafe(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function roundToUnit(value, unit = PRICE_UNIT) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value / unit) * unit);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pct(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function fmtSecs(ms) {
  if (ms === null) return "n/a";
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtMs(ms) {
  if (ms === null) return "n/a";
  return `${Math.round(ms)}ms`;
}

function scenarioSortWeight(name) {
  if (name === "base") return 0;
  if (name === "price_min_max") return 1;
  if (name === "price_range") return 2;
  return 99;
}

async function timedFetch(url, { retries = 2 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const t0 = performance.now();
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      // Consume body to include transfer time in the measurement.
      await res.arrayBuffer().catch(() => null);
      const ms = Math.max(0, Math.round(performance.now() - t0));
      return {
        status: res.status,
        cache: res.headers.get("x-vercel-cache") ?? "",
        ms,
        error: null,
      };
    } catch (err) {
      const ms = Math.max(0, Math.round(performance.now() - t0));
      lastErr = err;
      if (attempt >= retries) {
        return {
          status: 0,
          cache: "",
          ms,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      await sleep(150 * (attempt + 1));
    }
  }
  return {
    status: 0,
    cache: "",
    ms: 0,
    error: lastErr instanceof Error ? lastErr.message : String(lastErr),
  };
}

async function fetchJsonWithRetry(url, { retries = 4 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) {
        throw new Error(`http_${res.status}`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) {
        throw err;
      }
      await sleep(180 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error("fetch_failed");
}

function buildEndpointUrl({ baseUrl, endpoint, category, gender }) {
  if (endpoint.startsWith("products-page:")) {
    const sort = endpoint.split(":")[1] || "new";
    const u = new URL("/api/catalog/products-page", baseUrl);
    u.searchParams.set("category", String(category));
    u.searchParams.set("page", "1");
    if (gender) u.searchParams.set("gender", gender);
    if (sort && sort !== "new") u.searchParams.set("sort", sort);
    return u;
  }

  if (endpoint === "products-count") {
    const u = new URL("/api/catalog/products-count", baseUrl);
    u.searchParams.set("category", String(category));
    if (gender) u.searchParams.set("gender", gender);
    return u;
  }

  if (endpoint.startsWith("price-bounds:")) {
    const mode = endpoint.split(":")[1] || "full";
    const u = new URL("/api/catalog/price-bounds", baseUrl);
    u.searchParams.set("category", String(category));
    if (gender) u.searchParams.set("gender", gender);
    u.searchParams.set("mode", mode);
    return u;
  }

  return null;
}

async function resolvePriceCase({ baseUrl, category, gender }) {
  const u = new URL("/api/catalog/price-bounds", baseUrl);
  u.searchParams.set("category", String(category));
  if (gender) u.searchParams.set("gender", gender);
  u.searchParams.set("mode", "lite");

  let min = 100_000;
  let max = 900_000;
  try {
    const payload = await fetchJsonWithRetry(u.toString(), { retries: 2 });
    const bounds = payload?.bounds ?? null;
    const rawMin = Number(bounds?.min);
    const rawMax = Number(bounds?.max);
    if (Number.isFinite(rawMin) && Number.isFinite(rawMax) && rawMax > rawMin) {
      min = rawMin;
      max = rawMax;
    }
  } catch {
    // fallback: keep defaults
  }

  const span = Math.max(PRICE_UNIT, max - min);
  const minMaxMin = roundToUnit(min + span * 0.18);
  const minMaxMax = roundToUnit(min + span * 0.62);
  const lowBandMin = roundToUnit(min + span * 0.08);
  const lowBandMax = roundToUnit(min + span * 0.28);
  const highBandMin = roundToUnit(min + span * 0.70);

  const normalizedMinMaxMin = Math.max(min + PRICE_UNIT, Math.min(minMaxMin, max - PRICE_UNIT));
  const normalizedMinMaxMax = Math.max(normalizedMinMaxMin + PRICE_UNIT, Math.min(minMaxMax, max));
  const normalizedLowBandMin = Math.max(min, Math.min(lowBandMin, max - PRICE_UNIT));
  const normalizedLowBandMax = Math.max(
    normalizedLowBandMin + PRICE_UNIT,
    Math.min(lowBandMax, max - PRICE_UNIT),
  );
  const normalizedHighBandMin = Math.max(min + PRICE_UNIT, Math.min(highBandMin, max - PRICE_UNIT));

  return {
    min,
    max,
    minMaxMin: normalizedMinMaxMin,
    minMaxMax: normalizedMinMaxMax,
    lowBandMin: normalizedLowBandMin,
    lowBandMax: normalizedLowBandMax,
    highBandMin: normalizedHighBandMin,
  };
}

function applyScenario(u, scenarioName, priceCase) {
  u.searchParams.delete("price_min");
  u.searchParams.delete("price_max");
  u.searchParams.delete("price_range");

  if (scenarioName === "price_min_max") {
    u.searchParams.set("price_min", String(priceCase.minMaxMin));
    u.searchParams.set("price_max", String(priceCase.minMaxMax));
    return;
  }

  if (scenarioName === "price_range") {
    u.searchParams.append("price_range", `${priceCase.lowBandMin}:${priceCase.lowBandMax}`);
    u.searchParams.append("price_range", `${priceCase.highBandMin}:`);
  }
}

function summarizeGroup(rows, label) {
  const ok = rows.filter((r) => r.http >= 200 && r.http < 300);
  const times = ok.map((r) => r.ms);
  const p50 = pct(times, 50);
  const p95 = pct(times, 95);
  const max = times.length ? Math.max(...times) : null;
  console.log(
    `${label.padEnd(44)} ok=${String(ok.length).padStart(4)}/${String(rows.length).padEnd(4)} p50=${fmtSecs(
      p50,
    )} p95=${fmtSecs(p95)} max=${fmtSecs(max)}`,
  );
  return { p50, p95, max, ok: ok.length, total: rows.length };
}

async function main() {
  // `node script.mjs ...` => argv[1]=script path; `node -e 'import(...)' -- ...` => argv[1]=first arg.
  const argv = process.argv;
  const args = argv.slice(argv[1]?.endsWith(".mjs") ? 2 : 1);

  let baseUrl = process.env.BASE_URL || "https://oda-moda.vercel.app";
  baseUrl = baseUrl.replace(/\/+$/, "");

  let limit = 0;
  let includePriceSort = true;
  let throttleMs = 0;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--base-url") {
      baseUrl = String(args[i + 1] || "").trim().replace(/\/+$/, "");
      i++;
      continue;
    }
    if (arg === "--limit") {
      limit = parseIntSafe(args[i + 1], 0);
      i++;
      continue;
    }
    if (arg === "--no-price-sort") {
      includePriceSort = false;
      continue;
    }
    if (arg === "--throttle-ms") {
      throttleMs = Math.max(0, parseIntSafe(args[i + 1], 0));
      i++;
      continue;
    }
  }

  const runId = Date.now().toString(36);
  const facetsUrl = new URL("/api/catalog/facets-static", baseUrl);
  const facetsPayload = await fetchJsonWithRetry(facetsUrl, { retries: 5 });
  const categories = Array.isArray(facetsPayload?.facets?.categories)
    ? facetsPayload.facets.categories.map((x) => x?.value).filter(Boolean)
    : [];

  const genders = [null, "Femenino", "Masculino", "Unisex", "Infantil"];
  const scenarios = ["base", "price_min_max", "price_range"];
  const endpoints = ["products-page:new", "products-count", "price-bounds:lite", "price-bounds:full"];
  if (includePriceSort) {
    endpoints.push("products-page:price_asc", "products-page:price_desc");
  }

  const rows = [];
  let totalCases = 0;

  console.log(
    JSON.stringify({
      bench: "catalog-filters",
      baseUrl,
      runId,
      scenarios,
      endpoints,
      limit,
      throttleMs,
    }),
  );

  for (const category of categories) {
    for (const gender of genders) {
      totalCases += 1;
      if (limit > 0 && totalCases > limit) break;

      const priceCase = await resolvePriceCase({ baseUrl, category, gender });

      for (const scenarioName of scenarios) {
        for (const endpoint of endpoints) {
          const target = buildEndpointUrl({ baseUrl, endpoint, category, gender });
          if (!target) continue;
          applyScenario(target, scenarioName, priceCase);
          target.searchParams.set("_bench", runId);

          for (const phase of ["cold", "warm"]) {
            const result = await timedFetch(target.toString(), { retries: 2 });
            const row = {
              endpoint,
              scenario: scenarioName,
              phase,
              category,
              gender: gender ?? null,
              http: result.status,
              cache: result.cache,
              ms: result.ms,
              error: result.error ?? undefined,
            };
            rows.push(row);
            console.log(JSON.stringify(row));
            if (throttleMs > 0) await sleep(throttleMs);
          }
        }
      }
    }
    if (limit > 0 && totalCases > limit) break;
  }

  const byEndpointPhase = new Map();
  const byEndpointPhaseScenario = new Map();
  for (const row of rows) {
    const keyA = `${row.endpoint}|${row.phase}`;
    const listA = byEndpointPhase.get(keyA) || [];
    listA.push(row);
    byEndpointPhase.set(keyA, listA);

    const keyB = `${row.endpoint}|${row.phase}|${row.scenario}`;
    const listB = byEndpointPhaseScenario.get(keyB) || [];
    listB.push(row);
    byEndpointPhaseScenario.set(keyB, listB);
  }

  console.log("\n# Summary (endpoint + phase)");
  const sloResults = [];
  for (const key of Array.from(byEndpointPhase.keys()).sort()) {
    const [endpoint, phase] = key.split("|");
    const list = byEndpointPhase.get(key) || [];
    const summary = summarizeGroup(list, `${endpoint} [${phase}]`);
    const phaseSlo = SLO_BY_PHASE_MS[phase] ?? null;
    const sloOk = phaseSlo === null || summary.p95 === null ? null : summary.p95 <= phaseSlo;
    sloResults.push({
      endpoint,
      phase,
      p95Ms: summary.p95,
      sloMs: phaseSlo,
      status: sloOk === null ? "n/a" : sloOk ? "ok" : "fail",
    });
  }

  console.log("\n# Summary (endpoint + phase + scenario)");
  const sortedScenarioKeys = Array.from(byEndpointPhaseScenario.keys()).sort((a, b) => {
    const [endpointA, phaseA, scenarioA] = a.split("|");
    const [endpointB, phaseB, scenarioB] = b.split("|");
    if (endpointA !== endpointB) return endpointA.localeCompare(endpointB);
    if (phaseA !== phaseB) return phaseA.localeCompare(phaseB);
    return scenarioSortWeight(scenarioA) - scenarioSortWeight(scenarioB);
  });
  for (const key of sortedScenarioKeys) {
    const [endpoint, phase, scenarioName] = key.split("|");
    const list = byEndpointPhaseScenario.get(key) || [];
    summarizeGroup(list, `${endpoint} [${phase}] (${scenarioName})`);
  }

  console.log("\n# SLO (p95)");
  for (const row of sloResults) {
    const sloLabel = row.sloMs === null ? "n/a" : fmtMs(row.sloMs);
    const p95Label = row.p95Ms === null ? "n/a" : fmtMs(row.p95Ms);
    console.log(
      `${`${row.endpoint} [${row.phase}]`.padEnd(44)} p95=${p95Label.padEnd(10)} target=${sloLabel.padEnd(
        10,
      )} status=${row.status}`,
    );
  }

  const overSlo = rows
    .filter((row) => {
      if (!(row.http >= 200 && row.http < 300)) return false;
      const target = SLO_BY_PHASE_MS[row.phase];
      if (!target) return false;
      return row.ms > target;
    })
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 80)
    .map((row) => ({
      endpoint: row.endpoint,
      scenario: row.scenario,
      phase: row.phase,
      category: row.category,
      gender: row.gender,
      cache: row.cache,
      ms: `${row.ms}ms`,
    }));

  console.log("\n# OverSlo");
  console.log(JSON.stringify(overSlo, null, 2));
}

await main();
