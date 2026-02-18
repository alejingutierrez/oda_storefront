#!/usr/bin/env zsh
set -euo pipefail

# Benchmarks catalog filter endpoints (end-to-end latency) using curl.
#
# Why bash+curl (not node fetch)?
# - In some environments DNS/network can be flaky from Node scripts, while curl remains reliable.
#
# Usage:
#   BASE_URL=https://oda-moda.vercel.app ./apps/web/scripts/benchmark-catalog-filters.sh
#   ./apps/web/scripts/benchmark-catalog-filters.sh --limit 20
#   ./apps/web/scripts/benchmark-catalog-filters.sh --no-price-sort
#
# Output:
# - Writes JSONL rows to stdout (one request per line) and prints a summary at the end.

BASE_URL="${BASE_URL:-https://oda-moda.vercel.app}"
BASE_URL="${BASE_URL%/}"

LIMIT=0
INCLUDE_PRICE_SORT=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit)
      LIMIT="${2:-0}"
      shift 2
      ;;
    --no-price-sort)
      INCLUDE_PRICE_SORT=0
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if ! command -v curl >/dev/null 2>&1; then
  echo "Missing curl" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Missing node" >&2
  exit 1
fi

facets_json="$(curl -sS "$BASE_URL/api/catalog/facets-static")"
categories="$(
  printf '%s' "$facets_json" | node -e "
    const fs=require('fs');
    const d=JSON.parse(fs.readFileSync(0,'utf8'));
    const list=(d.facets?.categories||[]).map(x=>x?.value).filter(Boolean);
    for (const v of list) console.log(String(v));
  "
)"

genders=("" "Femenino" "Masculino" "Unisex" "Infantil")

endpoints=("products-page:new" "subcategories" "price-bounds")
if [[ "$INCLUDE_PRICE_SORT" == "1" ]]; then
  endpoints+=("products-page:price_asc" "products-page:price_desc")
fi

tmp="$(mktemp -t oda_catalog_bench.XXXXXX.jsonl)"
trap 'rm -f "$tmp"' EXIT

emit_row() {
  local endpoint="$1"
  local category="$2"
  local gender="$3"
  local url="$4"

  # Print headers + timing to stdout, parse without body.
  local out
  out="$(curl -sS -D - -o /dev/null -H 'accept: application/json' -w $'time_total=%{time_total}\nhttp_code=%{http_code}\n' "$url")"

  local cache
  cache="$(printf '%s' "$out" | grep -i '^x-vercel-cache:' | tail -n 1 | awk '{print $2}' | tr -d '\r' || true)"
  local time_total
  time_total="$(printf '%s' "$out" | grep '^time_total=' | tail -n 1 | cut -d= -f2 | tr -d '\r' || true)"
  local http_code
  http_code="$(printf '%s' "$out" | grep '^http_code=' | tail -n 1 | cut -d= -f2 | tr -d '\r' || true)"

  local ms
  ms="$(awk -v t="$time_total" 'BEGIN{ if(t+0>0) printf("%d", t*1000); else printf("0"); }')"

  # Values are safe (taxonomy keys / fixed set), so simple JSON is OK.
  printf '{"endpoint":"%s","category":"%s","gender":%s,"http":%s,"cache":"%s","ms":%s}\n' \
    "$endpoint" \
    "$category" \
    "$(if [[ -n "$gender" ]]; then printf '\"%s\"' "$gender"; else printf 'null'; fi)" \
    "${http_code:-0}" \
    "${cache:-}" \
    "$ms"
}

total_cases=0
for category in $categories; do
  for gender in "${genders[@]}"; do
    total_cases=$((total_cases+1))
    if [[ "$LIMIT" -gt 0 && "$total_cases" -gt "$LIMIT" ]]; then
      break 2
    fi

    for ep in "${endpoints[@]}"; do
      case "$ep" in
        products-page:new)
          qs="category=$category&page=1"
          [[ -n "$gender" ]] && qs="$qs&gender=$gender"
          url="$BASE_URL/api/catalog/products-page?$qs"
          ;;
        products-page:price_asc)
          qs="category=$category&page=1&sort=price_asc"
          [[ -n "$gender" ]] && qs="$qs&gender=$gender"
          url="$BASE_URL/api/catalog/products-page?$qs"
          ;;
        products-page:price_desc)
          qs="category=$category&page=1&sort=price_desc"
          [[ -n "$gender" ]] && qs="$qs&gender=$gender"
          url="$BASE_URL/api/catalog/products-page?$qs"
          ;;
        subcategories)
          qs="category=$category"
          [[ -n "$gender" ]] && qs="$qs&gender=$gender"
          url="$BASE_URL/api/catalog/subcategories?$qs"
          ;;
        price-bounds)
          qs="category=$category"
          [[ -n "$gender" ]] && qs="$qs&gender=$gender"
          url="$BASE_URL/api/catalog/price-bounds?$qs"
          ;;
      esac

      row="$(emit_row "$ep" "$category" "$gender" "$url")"
      printf '%s\n' "$row" | tee -a "$tmp"
    done
  done
done

node - <<'NODE' "$tmp"
const fs = require("node:fs");
const path = process.argv[2];
const lines = fs.readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean);
const rows = lines.map((l) => JSON.parse(l));

function pct(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function fmtMs(ms) {
  if (ms === null) return "n/a";
  return `${Math.round(ms)}ms`;
}

function fmtSecs(ms) {
  if (ms === null) return "n/a";
  return `${(ms / 1000).toFixed(2)}s`;
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
  .map((r) => ({ endpoint: r.endpoint, category: r.category, gender: r.gender, cache: r.cache, ms: fmtMs(r.ms) }));

console.log("\n# Over2s");
console.log(JSON.stringify(over2s, null, 2));
NODE
