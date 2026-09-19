#!/usr/bin/env bash
# One look at whether the stack is demo-ready, including a live probe of
# General Compute. Run this before presenting.
set -uo pipefail
echo "== gateway =="
curl -s http://localhost:8000/health | head -c 400; echo
echo ""
echo "== dependencies (probing General Compute) =="
curl -s "http://localhost:8000/health/deps?probe=1" | head -c 900; echo
