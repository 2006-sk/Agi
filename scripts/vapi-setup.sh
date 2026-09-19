#!/usr/bin/env bash
#
# Point the Vapi number at AURA.
#
# Vapi is configured here as carriage only: its transcriber, its voice and its
# model are all replaced by AURA endpoints, so Gradium does the speech and the
# deterministic protocol machine writes every word that gets spoken. Vapi's own
# LLM is never in the loop.
#
# Requires: the gateway running, a tunnel up, and PUBLIC_BASE_URL set in
# apps/gateway/.env (then the gateway restarted so it picks it up).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/apps/gateway/.env"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }

# `|| true`: an absent optional key (VAPI_SECRET) must not kill the script
# under `set -e` — grep exits 1 when it matches nothing.
get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

KEY="$(get VAPI_PRIVATE_KEY)"
NUMBER_ID="$(get VAPI_PHONE_NUMBER_ID)"
ASSISTANT_ID="$(get VAPI_ASSISTANT_ID)"
BASE="$(get PUBLIC_BASE_URL)"
SECRET="$(get VAPI_SECRET)"

[ -n "$KEY" ]       || { echo "VAPI_PRIVATE_KEY not set" >&2; exit 1; }
[ -n "$NUMBER_ID" ] || { echo "VAPI_PHONE_NUMBER_ID not set" >&2; exit 1; }
[ -n "$BASE" ]      || { echo "PUBLIC_BASE_URL not set — run ./scripts/tunnel.sh first" >&2; exit 1; }

WS_BASE="${BASE/https:/wss:}"
WS_BASE="${WS_BASE/http:/ws:}"

echo "configuring Vapi against $BASE"
echo

# The assistant is a shell. Everything that thinks or speaks points back here:
#   transcriber -> our Gradium STT socket
#   model       -> our protocol machine (OpenAI-compatible)
#   voice       -> our Gradium TTS endpoint
ASSISTANT_PAYLOAD=$(cat <<JSON
{
  "name": "AURA",
  "firstMessageMode": "assistant-speaks-first",
  "firstMessage": "Emergency services. This line is answered by an A I assistant with a human dispatcher supervising. Tell me what is happening and where you are.",
  "transcriber": {
    "provider": "custom-transcriber",
    "server": { "url": "$WS_BASE/vapi/transcriber"${SECRET:+, \"secret\": \"$SECRET\"} }
  },
  "model": {
    "provider": "custom-llm",
    "url": "$BASE/vapi",
    "model": "aura-protocol",
    "messages": [
      { "role": "system", "content": "Ignored. Every reply is produced by the AURA protocol state machine." }
    ]
  },
  "voice": {
    "provider": "custom-voice",
    "server": { "url": "$BASE/vapi/voice"${SECRET:+, \"secret\": \"$SECRET\"}, "timeoutSeconds": 30 }
  },
  "server": { "url": "$BASE/vapi/webhook"${SECRET:+, \"secret\": \"$SECRET\"} },
  "serverMessages": ["status-update", "transcript", "speech-update", "end-of-call-report"],
  "silenceTimeoutSeconds": 30,
  "maxDurationSeconds": 600
}
JSON
)

if [ -n "$ASSISTANT_ID" ]; then
  echo "updating assistant $ASSISTANT_ID"
  RESULT=$(curl -s -X PATCH "https://api.vapi.ai/assistant/$ASSISTANT_ID" \
    -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d "$ASSISTANT_PAYLOAD")
else
  echo "creating a new assistant"
  RESULT=$(curl -s -X POST "https://api.vapi.ai/assistant" \
    -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d "$ASSISTANT_PAYLOAD")
  ASSISTANT_ID=$(printf '%s' "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
fi

printf '%s' "$RESULT" | python3 -c "
import json, sys
d = json.load(sys.stdin)
if 'message' in d and 'id' not in d:
    print('  ERROR:', d['message']); sys.exit(1)
print('  assistant :', d.get('id'), '|', d.get('name'))
print('  transcriber:', (d.get('transcriber') or {}).get('provider'))
print('  model      :', (d.get('model') or {}).get('provider'), (d.get('model') or {}).get('url'))
print('  voice      :', (d.get('voice') or {}).get('provider'))
"

echo
echo "attaching number to assistant"
curl -s -X PATCH "https://api.vapi.ai/phone-number/$NUMBER_ID" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"assistantId\": \"$ASSISTANT_ID\", \"server\": {\"url\": \"$BASE/vapi/webhook\"}}" \
| python3 -c "
import json, sys
d = json.load(sys.stdin)
if 'message' in d and 'id' not in d:
    print('  ERROR:', d['message']); sys.exit(1)
print('  number     :', d.get('number'))
print('  assistantId:', d.get('assistantId'))
"

echo
echo "  Ready. Call ${VAPI_NUMBER:-$(get VAPI_PHONE_NUMBER)} and watch the deck."
