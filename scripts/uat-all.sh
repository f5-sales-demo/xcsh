#!/bin/bash
set -euo pipefail

live=false
if [ "${1:-}" = "--live" ]; then
  live=true
  shift
fi
if [ "$#" -ne 0 ]; then
  echo "Usage: $0 [--live]" >&2
  exit 2
fi

echo "=== xcsh container verification ==="
for command_name in xcsh gcloud az aws gh sf bun zig jq; do
  command -v "$command_name" >/dev/null || {
    echo "ERROR: Required command is unavailable: ${command_name}" >&2
    exit 1
  }
done
xcsh --version >/dev/null
xcsh --help >/dev/null
gcloud --version >/dev/null
az version >/dev/null
aws --version >/dev/null
gh --version >/dev/null
sf --version >/dev/null
bun --version >/dev/null
zig version >/dev/null
jq --version >/dev/null
echo "PASS: xcsh and bundled CLI commands execute successfully."

if [ "$live" = false ]; then
  echo "SKIP: Live Azure and Vertex AI checks require the explicit --live option."
  echo "PASS: Deterministic container smoke verification completed."
  exit 0
fi

echo "Running authorized live cloud verification..."
./scripts/uat-azure-auth.sh
./scripts/uat-gemini-auth.sh
./scripts/uat-gemini-prompts.sh
echo "PASS: Authorized live cloud verification completed without identity output."
