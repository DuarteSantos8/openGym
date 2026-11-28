#!/usr/bin/env bash
# Applies the migrations to a throwaway PostgreSQL and runs rls.sql against it. No Supabase, no
# Docker: only `initdb`, `pg_ctl` and `psql` (PostgreSQL 15 or newer) on the PATH or in PG_BIN.
#
#   supabase/tests/run-rls-local.sh
#
# With the Supabase CLI instead: `supabase db reset` and then
#   psql "$(supabase status -o env | sed -n 's/^DB_URL=//p' | tr -d '"')" -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="${PG_BIN:-}"
if [ -z "$bin" ]; then
  if command -v initdb >/dev/null 2>&1; then bin="$(dirname "$(command -v initdb)")"
  else bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"; fi
fi
[ -x "$bin/initdb" ] || { echo "PostgreSQL's initdb was not found; set PG_BIN" >&2; exit 2; }

dir="$(mktemp -d)"
port="${PGPORT_TEST:-54329}"
cleanup() { "$bin/pg_ctl" -D "$dir/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$dir"; }
trap cleanup EXIT

"$bin/initdb" -D "$dir/data" -U postgres -A trust >/dev/null
"$bin/pg_ctl" -D "$dir/data" -o "-p $port -c listen_addresses='' -k $dir" -l "$dir/log" -w start >/dev/null
run() { psql -h "$dir" -p "$port" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

run -f "$here/local-shim.sql"
for f in "$here"/../migrations/*.sql; do run -f "$f"; done
run -o /dev/null -f "$here/rls.sql"
