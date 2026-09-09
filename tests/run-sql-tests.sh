#!/usr/bin/env bash
#
# Runs the domain-logic test suite against a throwaway Postgres database.
#
#   ./tests/run-sql-tests.sh
#
# Needs a Postgres 15+ server (the schema uses security_invoker views).
# Point PGHOST/PGPORT/PGUSER at it first, e.g.
#   PGHOST=/tmp PGPORT=55432 PGUSER=postgres ./tests/run-sql-tests.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
DB="${TEST_DB:-iq_test}"

# Each suite starts from a freshly migrated database so they cannot affect
# each other through leftover orders, stock or numbering.
rebuild() {
  psql -v ON_ERROR_STOP=1 -q -d postgres \
    -c "drop database if exists $DB;" -c "create database $DB;"
  for f in "$HERE/sql/00_supabase_shim.sql" \
           "$ROOT"/supabase/migrations/0001_schema.sql \
           "$ROOT"/supabase/migrations/0002_functions.sql \
           "$ROOT"/supabase/migrations/0003_rls.sql \
           "$ROOT"/supabase/migrations/0004_seed.sql \
           "$HERE/sql/01_assertions.sql"; do
    psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" 2>&1 | grep -v "^NOTICE" || true
  done
}

failed=0
for suite in "$HERE"/sql/0[2-9]_*.sql; do
  name="$(basename "$suite")"
  echo ""
  echo "══ $name"
  rebuild

  # Run once, keep the output, then judge it — running twice would test a
  # database the first run had already changed.
  out="$(psql -d "$DB" -f "$suite" 2>&1 || true)"
  echo "$out" | grep -E "PASS|FAIL|ERROR" | sed 's/^.*NOTICE:  //' || true

  if echo "$out" | grep -qE "FAIL|ERROR"; then
    failed=1
  fi
done

echo ""
if [ "$failed" -eq 0 ]; then
  echo "✓ all suites passed"
else
  echo "✗ failures above"
  exit 1
fi
