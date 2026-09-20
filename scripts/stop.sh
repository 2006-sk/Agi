#!/usr/bin/env bash
# Free the ECHO ports. Useful after a crash left something listening.
set -uo pipefail
for port in 8082 8000 8100 5173; do
  pid="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [ -n "$pid" ]; then
    echo "killing pid $pid on :$port"
    kill -9 $pid 2>/dev/null || true
  fi
done
echo "ports clear"
