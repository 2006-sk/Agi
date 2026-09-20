#!/usr/bin/env bash
#
# Expose the gateway so Twilio can reach it.
#
# Twilio calls a public https URL on every turn of the conversation, so the
# gateway has to be reachable from the internet. Prefers cloudflared (no signup)
# and falls back to ngrok.
#
#   ./scripts/tunnel.sh          # cloudflared if present, else ngrok
#   ./scripts/tunnel.sh ngrok
set -uo pipefail

PORT="${ECHO_PORT:-8000}"
PREFER="${1:-}"

start_cloudflared() {
  echo "starting cloudflared on :$PORT …"
  cloudflared tunnel --url "http://localhost:$PORT" 2>&1 | tee /tmp/echo-tunnel.log &
  for _ in $(seq 1 40); do
    url="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/echo-tunnel.log 2>/dev/null | head -1)"
    [ -n "$url" ] && { echo "$url" > /tmp/echo-public-url; break; }
    sleep 0.5
  done
}

start_ngrok() {
  echo "starting ngrok on :$PORT …"
  ngrok http "$PORT" --log stdout > /tmp/echo-tunnel.log 2>&1 &
  for _ in $(seq 1 40); do
    # ngrok's free domain has changed more than once (.ngrok.io, .ngrok-free.app,
    # .ngrok-free.dev); match the family rather than any one of them.
    url="$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null \
      | grep -Eo 'https://[a-z0-9.-]+\.ngrok[a-z0-9.-]*\.(app|io|dev)' | head -1)"
    [ -n "$url" ] && { echo "$url" > /tmp/echo-public-url; break; }
    sleep 0.5
  done
}

if [ "$PREFER" = "ngrok" ] || ! command -v cloudflared >/dev/null 2>&1; then
  start_ngrok
else
  start_cloudflared
fi

url="$(cat /tmp/echo-public-url 2>/dev/null || true)"
if [ -z "$url" ]; then
  echo "could not get a public URL — see /tmp/echo-tunnel.log" >&2
  exit 1
fi

cat <<TXT

  public URL   $url

  Next:
    1. Put this in apps/gateway/.env:   PUBLIC_BASE_URL=$url
    2. Restart the gateway so it can verify Twilio signatures.
    3. In the Twilio console, set the number's Voice webhook to:
         $url/twilio/voice     (HTTP POST)
       and its status callback to:
         $url/twilio/status
    4. Call the number. Check: curl -s $url/twilio/config

  Ctrl-C stops the tunnel.

TXT
wait
