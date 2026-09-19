#!/usr/bin/env bash
#
# One command, every service.
#
# Docker is not a dependency here on purpose: the demo machine did not have it,
# and a compose file that has never been run is worse than no compose file. This
# starts the four processes in dependency order, waits for each to answer its
# own health check, and prints one line per service so a failure is obvious
# before anyone reaches for the microphone.
#
# Usage:
#   ./scripts/dev.sh            # everything
#   ./scripts/dev.sh --no-voice # skip the Python voice service (no mic / no Gradium key)
#   ./scripts/dev.sh --no-web   # backend only
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p logs

WITH_VOICE=1
WITH_WEB=1
for arg in "$@"; do
  case "$arg" in
    --no-voice) WITH_VOICE=0 ;;
    --no-web)   WITH_WEB=0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; OFF=$'\033[0m'
PIDS=()

cleanup() {
  echo ""
  echo "${DIM}stopping…${OFF}"
  for pid in "${PIDS[@]:-}"; do
    [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Wait for a URL to answer, or give up and show the tail of that service's log.
wait_for() {
  local name="$1" url="$2" log="$3" tries="${4:-60}"
  for _ in $(seq 1 "$tries"); do
    if curl -sf -o /dev/null "$url"; then
      printf "  %s✓%s %-14s %s\n" "$GREEN" "$OFF" "$name" "$url"
      return 0
    fi
    sleep 0.5
  done
  printf "  %s✗%s %-14s did not come up — last lines of %s:\n" "$RED" "$OFF" "$name" "$log"
  tail -n 15 "$log" | sed 's/^/      /'
  return 1
}

echo "AURA — starting services"

# 1. Intelligence (Pranay). Nothing downstream is useful without it.
npm --prefix services/intelligence run start > logs/intelligence.log 2>&1 &
PIDS+=($!)
wait_for "intelligence" "http://localhost:8082/internal/health" logs/intelligence.log

# 2. Gateway (Shresth). The only service the frontend talks to.
npm --prefix apps/gateway run start > logs/gateway.log 2>&1 &
PIDS+=($!)
wait_for "gateway" "http://localhost:8000/health" logs/gateway.log

# 3. Voice (Aditya). Optional: text and demo modes work without it.
if [ "$WITH_VOICE" = "1" ]; then
  (cd services/voice && uv run aura-voice) > logs/voice.log 2>&1 &
  PIDS+=($!)
  wait_for "voice" "http://localhost:8100/health" logs/voice.log 40 || \
    echo "      ${DIM}continuing without voice — text and demo modes still work${OFF}"
fi

# 4. Web (Kenil). Points at the gateway via NEXT_PUBLIC_AURA_WS_URL.
if [ "$WITH_WEB" = "1" ]; then
  npm --prefix apps/web run dev > logs/web.log 2>&1 &
  PIDS+=($!)
  wait_for "web" "http://localhost:3000" logs/web.log 80
fi

echo ""
echo "  deck        http://localhost:3000"
echo "  gateway     http://localhost:8000/health"
echo "  run demo    ./scripts/demo.sh"
echo "  logs        logs/*.log"
echo ""
echo "${DIM}Ctrl-C stops everything.${OFF}"
wait
