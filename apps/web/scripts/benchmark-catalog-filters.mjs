import { performance } from "node:perf_hooks";

function parseIntSafe(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
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

async function main() {
  // `node script.mjs ...` => argv[1]=script path; `node -e 'import(...)' -- ...` => argv[1]=first arg.
  const argv = process.argv;
  const args = argv.slice(argv[1]?.endsWith(".mjs") ? 2 : 1);

  let baseUrl = process.env.BASE_URL || "https://oda-storefront-6ee5.vercel.app";
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

  const facetsUrl = new URL("/api/catalog/facets-static", baseUrl);
  const facetsPayload = await fetchJsonWithRetry(facetsUrl, { retries: 5 });
  const categories = Array.isArray(facetsPayload?.facets?.categories)
    ? facetsPayload.facets.categories.map((x) => x?.value).filter(Boolean)
    : [];

  const genders = [null, "Femenino", "Masculino", "Unisex", "Infantil"];

  const endpoints = ["products-page:new", "subcategories", "price-bounds:lite", "price-bounds:full", "products-count"];
  if (includePriceSort) {
    endpoints.push("products-page:price_asc", "products-page:price_desc");
  }

  const rows = [];
  let totalCases = 0;

  for (const category of categories) {
    for (const gender of genders) {
      totalCases += 1;
      if (limit > 0 && totalCases > limit) break;

      for (const endpoint of endpoints) {
        let url;
        if (endpoint.startsWith("products-page:")) {
          const sort = endpoint.split(":")[1] || "new";
          const u = new URL("/api/catalog/products-page", baseUrl);
          u.searchParams.set("category", String(category));
          u.searchParams.set("page", "1");
          if (gender) u.searchParams.set("gender", gender);
          if (sort && sort !== "new") u.searchParams.set("sort", sort);
          url = u.toString();
        } else if (endpoint === "subcategories") {
          const u = new URL("/api/catalog/subcategories", baseUrl);
          u.searchParams.set("category", String(category));
          if (gender) u.searchParams.set("gender", gender);
          url = u.toString();
        } else if (endpoint.startsWith("price-bounds:")) {
          const mode = endpoint.split(":")[1] || "full";
          const u = new URL("/api/catalog/price-bounds", baseUrl);
          u.searchParams.set("category", String(category));
          if (gender) u.searchParams.set("gender", gender);
          u.searchParams.set("mode", mode);
          url = u.toString();
        } else if (endpoint === "products-count") {
          const u = new URL("/api/catalog/products-count", baseUrl);
          u.searchParams.set("category", String(category));
          if (gender) u.searchParams.set("gender", gender);
          url = u.toString();
        } else {
          continue;
        }

        const result = await timedFetch(url, { retries: 2 });

        const row = {
          endpoint,
          category,
          gender: gender ?? null,
          http: result.status,
          cache: result.cache,
          ms: result.ms,
          error: result.error ?? undefined,
        };
        rows.push(row);
        console.log(JSON.stringify(row));

        if (throttleMs > 0) {
          await sleep(throttleMs);
        }
      }
    }
    if (limit > 0 && totalCases > limit) break;
  }

  const byEndpoint = new Map();
  for (const r of rows) {
    const arr = byEndpoint.get(r.endpoint) || [];
    arr.push(r);
    byEndpoint.set(r.endpoint, arr);
  }

  console.log("\n# Summary");
  for (const [endpoint, list] of byEndpoint.entries()) {
    const ok = list.filter((r) => r.http >= 200 && r.http < 300);
    const times = ok.map((r) => r.ms);
    const p50 = pct(times, 50);
    const p95 = pct(times, 95);
    const max = times.length ? Math.max(...times) : null;
    console.log(
      `${endpoint.padEnd(24)} ok=${String(ok.length).padStart(3)}/${String(list.length).padEnd(3)} p50=${fmtSecs(
        p50,
      )} p95=${fmtSecs(p95)} max=${fmtSecs(max)}`,
    );
  }

  const over2s = rows
    .filter((r) => r.http >= 200 && r.http < 300 && r.ms > 2000)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 50)
    .map((r) => ({ endpoint: r.endpoint, category: r.category, gender: r.gender, cache: r.cache, ms: `${r.ms}ms` }));

  console.log("\n# Over2s");
  console.log(JSON.stringify(over2s, null, 2));
}

await main();
