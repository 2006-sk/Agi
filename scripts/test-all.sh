#!/usr/bin/env bash
# Every suite in the repo. `LIVE=1` additionally runs the gateway end-to-end
# against the real General Compute endpoint instead of the deterministic model.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "== intelligence (Pranay) =="
npm --prefix services/intelligence test

echo ""
echo "== gateway (Shresth) =="
npm --prefix apps/gateway test

if [ "${LIVE:-0}" = "1" ]; then
  echo ""
  echo "== gateway e2e against live General Compute =="
  LIVE_MODEL_E2E=1 npm --prefix apps/gateway run test:e2e
fi
