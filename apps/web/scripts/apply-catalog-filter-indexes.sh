#!/usr/bin/env zsh
set -euo pipefail

# Applies the catalog filter indexes to the configured Neon database.
# This uses `CREATE INDEX CONCURRENTLY`, so it should not be run inside a transaction.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
SQL_FILE="$ROOT_DIR/apps/web/scripts/catalog-filter-indexes.sql"
PSQL_BIN="/opt/homebrew/opt/libpq/bin/psql"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

if [[ ! -f "$SQL_FILE" ]]; then
  echo "Missing $SQL_FILE" >&2
  exit 1
fi

if [[ ! -x "$PSQL_BIN" ]]; then
  echo "Missing psql at $PSQL_BIN (install libpq)" >&2
  exit 1
fi

NEON_DATABASE_URL="$(node -e "
  const fs=require('fs');
  const txt=fs.readFileSync('$ENV_FILE','utf8');
  const line=txt.split(/\\r?\\n/).find(l=>l.startsWith('NEON_DATABASE_URL='));
  if(!line) process.exit(1);
  const raw=line.slice('NEON_DATABASE_URL='.length).trim().replace(/^\\\"|\\\"$/g,'');
  const u=new URL(raw);
  u.searchParams.delete('schema');
  process.stdout.write(u.toString());
")"

echo "Applying catalog filter indexes..."
"$PSQL_BIN" "$NEON_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SQL_FILE"
echo "Done."
