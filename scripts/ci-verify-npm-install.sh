#!/usr/bin/env bash
set -euo pipefail

: "${EXPECTED_VERSION:?EXPECTED_VERSION is required}"

# Strip the leading v from the release tag.
expected="${EXPECTED_VERSION#v}"
max_attempts=8
delay=10

echo "Expected version: $expected"

for attempt in $(seq 1 "$max_attempts"); do
  echo ""
  echo "=== Attempt $attempt/$max_attempts (backoff: ${delay}s) ==="

  npm uninstall -g @f5-sales-demo/xcsh 2>/dev/null || true
  npm cache clean --force 2>/dev/null || true

  if npm install -g "@f5-sales-demo/xcsh@${expected}" 2>&1; then
    installed=$(xcsh --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
    echo "Installed version: $installed"

    if [ "$installed" = "$expected" ]; then
      echo "Version match confirmed."
      echo "Checking xcsh --help..."
      xcsh --help >/dev/null
      binary=$(command -v xcsh)
      XCSH_TEST_SANDBOX_CHECK_BINARY="$binary" \
        bun test packages/coding-agent/test/sandbox-check.test.ts
      echo "npm install verification passed"
      exit 0
    fi

    echo "Version mismatch: got $installed, expected $expected"
  else
    echo "npm install failed (exit $?)"
  fi

  if [ "$attempt" -eq "$max_attempts" ]; then
    echo "ERROR: verification failed after $max_attempts attempts"
    echo "Last installed version: ${installed:-none}"
    echo "Expected version: $expected"
    exit 1
  fi

  echo "Waiting ${delay}s for npm registry propagation..."
  sleep "$delay"
  delay=$((delay * 2))
done
