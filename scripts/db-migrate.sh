#!/bin/sh
# Applies the Genesis schema to PostgreSQL, in version order:
#   V1-V8  legacy Flyway baseline  (legacy/genesis-java/.../db/migration)
#   V9+    TypeScript-owned        (apps/api/db/migrations)
# Applied versions are recorded in public.genesis_schema_migrations, so re-running is safe.
# A database that already holds the V1-V8 schema (applied by hand with psql before this
# runner existed) is adopted: V1-V8 are recorded without being executed again.
#
# Connection comes from the standard libpq variables (PGHOST, PGUSER, PGPASSWORD, PGDATABASE).
# Runs in the `migrate` service of docker-compose.yml; also works on a host with psql installed.
set -eu

LEGACY_DIR="${LEGACY_DIR:-/migrations/legacy}"
API_DIR="${API_DIR:-/migrations/api}"
BASELINE_MAX=8

q() { psql -v ON_ERROR_STOP=1 -qtAX "$@"; }

q -c "CREATE TABLE IF NOT EXISTS public.genesis_schema_migrations (
        version    integer PRIMARY KEY,
        name       text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now())"

# "<version> <path>" per file, numerically ordered.
files=$(ls "$LEGACY_DIR"/V*.sql "$API_DIR"/V*.sql 2>/dev/null |
  awk -F/ '{ n = $NF; sub(/^V/, "", n); sub(/__.*/, "", n); print n " " $0 }' | sort -n)

recorded=$(q -c "SELECT count(*) FROM public.genesis_schema_migrations")
has_schema=$(q -c "SELECT to_regclass('public.workspaces') IS NOT NULL")
if [ "$recorded" = "0" ] && [ "$has_schema" = "t" ]; then
  echo "[migrate] existing schema found: recording V1-V$BASELINE_MAX as applied"
  echo "$files" | while read -r version path; do
    [ "$version" -le "$BASELINE_MAX" ] || continue
    name=$(basename "$path" .sql)
    q -c "INSERT INTO public.genesis_schema_migrations (version, name) VALUES ($version, '$name') ON CONFLICT DO NOTHING"
  done
fi

applied=0
echo "$files" > /tmp/migration-list
while read -r version path; do
  [ -n "$version" ] || continue
  if [ "$(q -c "SELECT count(*) FROM public.genesis_schema_migrations WHERE version = $version")" != "0" ]; then
    continue
  fi
  name=$(basename "$path" .sql)
  echo "[migrate] applying $name"
  psql -v ON_ERROR_STOP=1 -q --single-transaction -f "$path" \
    -c "INSERT INTO public.genesis_schema_migrations (version, name) VALUES ($version, '$name')"
  applied=$((applied + 1))
done < /tmp/migration-list

echo "[migrate] done ($applied applied)"
