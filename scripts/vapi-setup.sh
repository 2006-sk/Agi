#!/usr/bin/env bash
#
# Point the Vapi number at ECHO, in one of two modes.
#
#   ./scripts/vapi-setup.sh vapi    Vapi runs the call: its own STT, model and
#                                   TTS. It reaches ECHO through agent tools,
#                                   which move the incident and light the deck.
#                                   The human approval gate still lives in ECHO.
#
#   ./scripts/vapi-setup.sh echo    Vapi is carriage only: Gradium does STT and
#                                   TTS, and the deterministic protocol machine
#                                   writes every word that gets spoken.
#
# Requires the gateway running, a tunnel up, and PUBLIC_BASE_URL set in
# apps/gateway/.env (then the gateway restarted so it picks it up).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/apps/gateway/.env"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }

# `|| true`: an absent optional key (VAPI_SECRET) must not kill the script
# under `set -e` — grep exits 1 when it matches nothing.
get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

MODE="${1:-$(get VOICE_BRAIN)}"
MODE="${MODE:-echo}"
KEY="$(get VAPI_PRIVATE_KEY)"
NUMBER_ID="$(get VAPI_PHONE_NUMBER_ID)"
ASSISTANT_ID="$(get VAPI_ASSISTANT_ID)"
BASE="$(get PUBLIC_BASE_URL)"
SECRET="$(get VAPI_SECRET)"
VOICE_ID="$(get VAPI_TTS_VOICE_ID)"; VOICE_ID="${VOICE_ID:-luna}"

[ -n "$KEY" ]       || { echo "VAPI_PRIVATE_KEY not set" >&2; exit 1; }
[ -n "$NUMBER_ID" ] || { echo "VAPI_PHONE_NUMBER_ID not set" >&2; exit 1; }
[ -n "$BASE" ]      || { echo "PUBLIC_BASE_URL not set — run ./scripts/tunnel.sh first" >&2; exit 1; }
case "$MODE" in vapi|echo) ;; *) echo "mode must be 'vapi' or 'echo'" >&2; exit 2 ;; esac

WS_BASE="${BASE/https:/wss:}"; WS_BASE="${WS_BASE/http:/ws:}"

echo "mode: $MODE"
echo "base: $BASE"
echo

# The assistant body differs only in who owns the brain and the speech.
if [ "$MODE" = "vapi" ]; then
  PAYLOAD="$(python3 "$ROOT/scripts/vapi_payload.py" vapi "$BASE" "$WS_BASE" "$SECRET" "$VOICE_ID")"
else
  PAYLOAD="$(python3 "$ROOT/scripts/vapi_payload.py" echo "$BASE" "$WS_BASE" "$SECRET" "$VOICE_ID")"
fi

if [ -n "$ASSISTANT_ID" ]; then
  echo "updating assistant $ASSISTANT_ID"
  RESULT=$(curl -s -X PATCH "https://api.vapi.ai/assistant/$ASSISTANT_ID" \
    -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d "$PAYLOAD")
else
  echo "creating assistant"
  RESULT=$(curl -s -X POST "https://api.vapi.ai/assistant" \
    -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d "$PAYLOAD")
  ASSISTANT_ID=$(printf '%s' "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
fi

printf '%s' "$RESULT" | python3 -c "
import json, sys
d = json.load(sys.stdin)
if 'id' not in d:
    print('  ERROR:', d.get('message', d)); sys.exit(1)
m = d.get('model') or {}
print('  assistant  :', d.get('id'), '|', d.get('name'))
print('  transcriber:', (d.get('transcriber') or {}).get('provider'))
print('  model      :', m.get('provider'), m.get('model') or '')
print('  voice      :', (d.get('voice') or {}).get('provider'))
print('  tools      :', len(m.get('tools') or []), [ (t.get('function') or {}).get('name') for t in (m.get('tools') or []) ])
"

echo
echo "attaching number"
curl -s -X PATCH "https://api.vapi.ai/phone-number/$NUMBER_ID" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"assistantId\": \"$ASSISTANT_ID\", \"server\": {\"url\": \"$BASE/vapi/webhook\"}}" \
| python3 -c "
import json, sys
d = json.load(sys.stdin)
if 'id' not in d:
    print('  ERROR:', d.get('message', d)); sys.exit(1)
print('  number     :', d.get('number'))
print('  assistantId:', d.get('assistantId'))
"

echo
echo "  Ready. Call $(get VAPI_PHONE_NUMBER) and watch the deck."
