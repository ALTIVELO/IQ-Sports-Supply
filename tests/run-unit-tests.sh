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

fail=0
for f in tests/unit/*.test.mjs; do
  out=$(node "$f" 2>&1) || { echo "$out"; fail=1; continue; }
  p=$(grep -c '^PASS' <<<"$out"); n=$(grep -c '^FAIL' <<<"$out")
  printf '%-40s %3d passed  %3d failed\n' "$(basename "$f")" "$p" "$n"
  if [ "$n" -gt 0 ]; then grep '^FAIL' <<<"$out"; fail=1; fi
done
exit $fail
