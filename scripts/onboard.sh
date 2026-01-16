#!/bin/bash
set -euo pipefail
echo "=== get-chitty Onboarding ==="
curl -s -X POST "${GETCHITTY_ENDPOINT:-https://get.chitty.cc/api/onboard}" \
  -H "Content-Type: application/json" \
  -d '{"service_name":"get-chitty","organization":"CHITTYOS","type":"gateway","tier":2,"domains":["get.chitty.cc"]}' | jq .
