#!/usr/bin/env bash
# Retry only transient Apple ticket delivery; notarization is already accepted.
set -euo pipefail
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo 'usage: ci-staple-macos-pkg.sh EXISTING_PACKAGE' >&2
  exit 2
fi
attempts=${XCSH_STAPLER_MAX_ATTEMPTS:-6}
delay=${XCSH_STAPLER_INITIAL_DELAY_SECONDS:-10}
if ! [[ "$attempts" =~ ^[1-8]$ ]] || ! [[ "$delay" =~ ^[0-9]+$ ]] || [ "$delay" -gt 60 ]; then
  echo 'Invalid bounded stapler retry settings' >&2
  exit 2
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
retry_ticket() {
  local operation=$1 attempt exit_code wait_seconds
  wait_seconds=$delay
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    exit_code=0
    xcrun stapler "$operation" "$2" >"$work/output" 2>&1 || exit_code=$?
    cat "$work/output"
    if [ "$exit_code" -eq 0 ]; then
      return 0
    fi
    if [ "$exit_code" -ne 68 ] || ! grep -Eqi 'network|connection|cloudkit|records?.*(not found|lookup)' "$work/output"; then
      echo "stapler $operation: permanent failure (exit $exit_code)" >&2
      return "$exit_code"
    fi
    if [ "$attempt" -eq "$attempts" ]; then
      echo "stapler $operation: transient ticket delivery retries exhausted (exit $exit_code)" >&2
      return "$exit_code"
    fi
    echo "stapler $operation: transient ticket failure; attempt $attempt/$attempts, retry in ${wait_seconds}s" >&2
    sleep "$wait_seconds"
    wait_seconds=$((wait_seconds * 2))
    [ "$wait_seconds" -le 60 ] || wait_seconds=60
  done
}
retry_ticket staple "$1"
retry_ticket validate "$1"
