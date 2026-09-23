#!/usr/bin/env bash
# Compiles the pure-logic modules the unit tests import, then runs them.
# The two output layouts are what the existing test files expect.
set -uo pipefail
cd "$(dirname "$0")/.."

TSC="npx tsc --module esnext --target es2022 --moduleResolution bundler --skipLibCheck"
rm -rf .test-build

# tree.ts imports a type from a Next page; the emit is still correct.
$TSC src/lib/catalogue/*.ts --outDir .test-build/catalogue >/dev/null 2>&1
$TSC src/lib/app-url.ts     --outDir .test-build/lib       >/dev/null 2>&1
$TSC src/lib/format.ts      --outDir .test-build/lib       >/dev/null 2>&1
# Who we are, legally — the invoice footer reads it.
$TSC src/lib/company.ts     --outDir .test-build/lib       >/dev/null 2>&1
$TSC src/lib/login/*.ts     --outDir .test-build/login     >/dev/null 2>&1
$TSC src/lib/import/*.ts    --outDir .test-build/import    >/dev/null 2>&1
$TSC src/lib/reporting/*.ts --outDir .test-build/reporting >/dev/null 2>&1
$TSC src/lib/orders/*.ts    --outDir .test-build/orders    >/dev/null 2>&1
$TSC src/lib/returns/*.ts   --outDir .test-build/returns   >/dev/null 2>&1
$TSC src/lib/email/templates.ts --outDir .test-build/email >/dev/null 2>&1
$TSC src/lib/supabase/chunk.ts --outDir .test-build/supabase >/dev/null 2>&1
# chunk.ts is server-only; the marker import means nothing to Node and would
# just fail to resolve, so it is dropped from the compiled copy the tests read.
sed -i "/^import 'server-only';$/d" .test-build/supabase/chunk.js 2>/dev/null || true
# The chart's axis maths. JSX, so it needs the React preset to emit at all.
$TSC src/app/staff/dashboard/Charts.tsx --jsx react-jsx \
     --outDir .test-build/dashboard >/dev/null 2>&1
# What the PDF's built-in fonts cannot print. Also JSX.
$TSC src/lib/pdf/documents.tsx --jsx react-jsx \
     --outDir .test-build/pdf >/dev/null 2>&1

# tsc emits the specifier as written ("./types"), which Node's ESM loader will
# not resolve. Nothing here imports a directory, so appending .js to relative
# specifiers is safe and keeps the source free of build-shaped imports.
find .test-build -name '*.js' -print0 |
  xargs -0 sed -i -E "s#(from '\\.[^']*)'#\\1.js'#g"

# Next resolves "@/lib/x" through tsconfig paths; Node does not. Everything
# compiled here lands one directory below .test-build, named after the folder
# it came from, so the alias is the same relative hop every time: "@/lib/x"
# is ../lib/x, and "@/lib/orders/x" is ../orders/x. Done after the rule above
# so the specifier it writes is not then given a second .js.
find .test-build -name '*.js' -print0 |
  xargs -0 sed -i -E "s#from '@/lib/([a-z-]+)/([a-z-]+)'#from '../\\1/\\2.js'#g"
find .test-build -name '*.js' -print0 |
  xargs -0 sed -i -E "s#from '@/lib/([a-z-]+)'#from '../lib/\\1.js'#g"

fail=0
for f in tests/unit/*.test.mjs; do
  out=$(node "$f" 2>&1) || { echo "$out"; fail=1; continue; }
  p=$(grep -c '^PASS' <<<"$out"); n=$(grep -c '^FAIL' <<<"$out")
  printf '%-40s %3d passed  %3d failed\n' "$(basename "$f")" "$p" "$n"
  if [ "$n" -gt 0 ]; then grep '^FAIL' <<<"$out"; fail=1; fi
done
exit $fail
