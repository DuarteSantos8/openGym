#!/usr/bin/env bash
# The fork's static gate: upstream's three test suites plus the locale check, under the exact
# conditions upstream CI uses. Node 22 (Node 25's built-in localStorage stub fails 565 tests) and
# TZ=UTC (7 date tests are written against UTC and fail in Sydney time). See docs/fork/FORK.md.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

NODE22=/opt/homebrew/opt/node@22/bin
if [ -x "$NODE22/node" ]; then export PATH="$NODE22:$PATH"; fi
case "$(node --version)" in
  v22.*) ;;
  *) echo "check.sh: need Node 22, have $(node --version). brew install node@22" >&2; exit 1 ;;
esac
export TZ=UTC

echo "== frontend"; (cd frontend && npm test -- --reporter=dot 2>&1 | tail -4)
echo "== locales";  (cd frontend && node scripts/check-locales.mjs | tail -1)
echo "== mcp";      (cd mcp && npm test 2>&1 | grep -E "Test Files|Tests ")
echo "== api";      (cd api && npm test 2>&1 | grep -E "(pass|fail) [0-9]+$")
echo "check: PASS"
