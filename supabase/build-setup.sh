#!/usr/bin/env bash
#
# Regenerates supabase/setup.sql — the four migrations plus the verification
# query, as one file to paste into the Supabase SQL editor.
#
# Run this after changing anything under supabase/migrations/.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/setup.sql"

{
  cat <<'HEADER'
-- ============================================================================
-- IQ Sports Supply — complete database setup
--
-- GENERATED FILE — do not edit. Regenerate with supabase/build-setup.sh after
-- changing anything under supabase/migrations/.
--
-- Paste the whole file into the Supabase SQL editor and run it once.
--
-- Safe to re-run: every object is guarded, so if a run stops partway you can
-- fix the cause and run the same file again without resetting the database.
--
-- The last statement prints a table of checks. Every row should say PASS.
-- The one exception is "signup trigger on auth.users": that trigger cannot be
-- installed on some hosted projects, and the app does not need it — it creates
-- the profile row itself on first sign-in. Any other FAIL is real.
-- ============================================================================

HEADER

  for f in "$HERE"/migrations/0001_schema.sql \
           "$HERE"/migrations/0002_functions.sql \
           "$HERE"/migrations/0003_rls.sql \
           "$HERE"/migrations/0004_seed.sql; do
    printf '\n\n-- ###########################################################################\n'
    printf -- '-- %s\n' "$(basename "$f")"
    printf -- '-- ###########################################################################\n\n'
    cat "$f"
  done

  printf '\n\n-- ###########################################################################\n'
  printf -- '-- verification — every row should say PASS\n'
  printf -- '-- ###########################################################################\n\n'
  cat "$HERE/verify.sql"
} > "$OUT"

echo "wrote $OUT ($(wc -l < "$OUT") lines, $(wc -c < "$OUT") bytes)"
