#!/usr/bin/env bash
#
# Run the golden cardiac path against the running stack, then stop at the
# human-approval gate exactly as the live demo does.
#
#   ./scripts/demo.sh                  # cardiac, real pacing
#   ./scripts/demo.sh vague            # the scenario where the gate stays shut
#   ./scripts/demo.sh cardiac approve  # also approve, to see the unit move
set -uo pipefail

SESSION="${ECHO_SESSION:-echo-demo-0197}"
SCENARIO="${1:-cardiac}"
APPROVE="${2:-}"
GW="http://localhost:8000"

echo "→ ${SCENARIO} on ${SESSION}"
curl -s -X POST "$GW/api/calls/$SESSION/demo" \
  -H 'content-type: application/json' \
  -d "{\"scenario\":\"$SCENARIO\",\"await_completion\":true}" | head -c 1200
echo ""

if [ "$APPROVE" = "approve" ]; then
  echo "→ approving dispatch"
  curl -s -X POST "$GW/api/calls/$SESSION/approval" \
    -H 'content-type: application/json' \
    -d '{"approved":true,"reviewer":"operator"}' | head -c 600
  echo ""
fi
