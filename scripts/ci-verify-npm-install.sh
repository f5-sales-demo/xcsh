#!/usr/bin/env bash
set -euo pipefail

: "${EXPECTED_VERSION:?EXPECTED_VERSION is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

# Strip the leading v from the release tag.
expected="${EXPECTED_VERSION#v}"
max_attempts=6
delay=10
max_delay=60

install_prefix=$(mktemp -d "$RUNNER_TEMP/xcsh-npm-verify.XXXXXX")
install_log="$install_prefix/npm-install.log"
binary="$install_prefix/bin/xcsh"
trap 'rm -rf -- "$install_prefix"' EXIT

is_retryable_registry_failure() {
  grep -Eiq \
    'E404|ETARGET|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ERR_SOCKET_TIMEOUT|(^|[^0-9])429([^0-9]|$)|(^|[^0-9])50[234]([^0-9]|$)|notarget|No matching version|not in this registry|registry[^[:alnum:]]+unavailable' \
    "$install_log"
}

echo "Expected version: $expected"
echo "Isolated npm prefix: $install_prefix"

for attempt in $(seq 1 "$max_attempts"); do
  echo ""
  echo "=== Attempt $attempt/$max_attempts (backoff: ${delay}s) ==="

  if npm install --global --prefix "$install_prefix" "@f5-sales-demo/xcsh@${expected}" 2>&1 | tee "$install_log"; then
    if [ ! -x "$binary" ]; then
      echo "ERROR: npm succeeded without creating the expected executable: $binary" >&2
      exit 1
    fi

    installed=$("$binary" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
    echo "Installed version: $installed"

    if [ "$installed" = "$expected" ]; then
      echo "Version match confirmed."
      echo "Checking xcsh --help..."
      "$binary" --help >/dev/null
      XCSH_TEST_SANDBOX_CHECK_BINARY="$binary" \
        bun test packages/coding-agent/test/sandbox-check.test.ts
      echo "npm install verification passed"
      exit 0
    fi

    echo "ERROR: installed package reported $installed, expected $expected" >&2
    exit 1
  else
    install_status=$?
    echo "npm install failed (exit $install_status)"
    if ! is_retryable_registry_failure; then
      echo "ERROR: npm install failed for a non-retryable local or package error" >&2
      exit "$install_status"
    fi
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
  if [ "$delay" -gt "$max_delay" ]; then
    delay=$max_delay
  fi
done
