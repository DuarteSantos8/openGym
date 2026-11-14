#!/usr/bin/env bash
# Run from the repository root. Suites run sequentially, with two workers.
# Historical reproduction script: the initial wrapper ended 143 after frontend.
# See README.md/checks.tsv for separately resumed results. Do not rerun the full
# frontend suite on this branch: parent owns the combined-candidate gate.
set -u
export PATH="$HOME/tools/node-v22.23.5-linux-x64/bin:$PATH"
export RAYON_NUM_THREADS=2
repo=$(pwd)
evidence="$repo/docs/superpowers/evidence/EP-03"
node --version > "$evidence/node-version.txt"
test "$(node --version)" = 'v22.23.5' || exit 1
git rev-parse HEAD > "$evidence/verified-head.txt"
printf 'command\texit\n' > "$evidence/checks.tsv"
failed=0
run() {
  local label=$1 directory=$2
  shift 2
  (cd "$repo/$directory" && "$@") > "$evidence/$label.log" 2>&1
  local code=$?
  printf '%s\t%s\n' "[$directory] $*" "$code" >> "$evidence/checks.tsv"
  printf '%s: exit %s\n' "$label" "$code"
  tail -8 "$evidence/$label.log"
  if [ "$code" -ne 0 ]; then failed=1; fi
}
run frontend-full frontend npm test -- --maxWorkers=2
run build frontend npm run build
run locales frontend node scripts/check-locales.mjs
run source-strings frontend node scripts/check-source-strings.mjs --strict
# The API package script is node --test test/*.test.js; cap its file concurrency.
run api-full api bash -c 'node --test --test-concurrency=2 test/*.test.js'
run mcp-full mcp npm test -- --maxWorkers=2
run catalogue . node scripts/catalogue/build.mjs --check
run coach-assets . node scripts/build-coach-assets.mjs --check
run api-docs . node scripts/build-api-docs.mjs --check
exit "$failed"
