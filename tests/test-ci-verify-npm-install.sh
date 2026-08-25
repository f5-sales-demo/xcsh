#!/usr/bin/env bash
# Hermetic contract tests for the post-publication npm installation verifier.
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
script="$repo_root/scripts/ci-verify-npm-install.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fail() {
  echo "[FAIL] $*" >&2
  exit 1
}

new_case() {
  local name=$1
  case_dir="$work/$name"
  fake_bin="$case_dir/bin"
  runner_temp="$case_dir/runner-temp"
  mkdir -p "$fake_bin" "$runner_temp"

  cat >"$fake_bin/npm" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$NPM_CALLS"

if [ "${1:-}" != "install" ]; then
  echo "legacy npm command invoked: $*" >&2
  exit 90
fi

prefix=""
for ((index = 1; index <= $#; index++)); do
  if [ "${!index}" = "--prefix" ]; then
    next=$((index + 1))
    prefix=${!next:-}
  fi
done

if [ -z "$prefix" ]; then
  echo "npm ERR! code ENOENT" >&2
  echo "npm ERR! mkdir '/usr/local/lib/node_modules/@f5-sales-demo'" >&2
  exit 254
fi

attempts=0
if [ -f "$NPM_ATTEMPTS" ]; then
  attempts=$(cat "$NPM_ATTEMPTS")
fi
attempts=$((attempts + 1))
printf '%s\n' "$attempts" >"$NPM_ATTEMPTS"

case "$NPM_MODE" in
  fatal)
    echo "npm ERR! code ENOENT" >&2
    echo "npm ERR! syscall mkdir" >&2
    exit 254
    ;;
  retry-once)
    if [ "$attempts" -eq 1 ]; then
      echo "npm ERR! code E404" >&2
      echo "npm ERR! 404 Not Found" >&2
      exit 1
    fi
    ;;
  success) ;;
  *) exit 92 ;;
esac

mkdir -p "$prefix/bin"
cat >"$prefix/bin/xcsh" <<'XCSH'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  --version) echo "xcsh 20.22.1" ;;
  --help) exit 0 ;;
  *) exit 93 ;;
esac
XCSH
chmod +x "$prefix/bin/xcsh"
SH
  chmod +x "$fake_bin/npm"

  cat >"$fake_bin/bun" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[ "$*" = "test packages/coding-agent/test/sandbox-check.test.ts" ] || exit 94
[ -x "${XCSH_TEST_SANDBOX_CHECK_BINARY:?}" ] || exit 95
case "$XCSH_TEST_SANDBOX_CHECK_BINARY" in
  "$RUNNER_TEMP"/xcsh-npm-verify.*/bin/xcsh) ;;
  *) exit 96 ;;
esac
printf '%s\n' "$XCSH_TEST_SANDBOX_CHECK_BINARY" >"$BUN_BINARY"
SH
  chmod +x "$fake_bin/bun"

  cat >"$fake_bin/sleep" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" >>"$SLEEP_CALLS"
SH
  chmod +x "$fake_bin/sleep"

  export PATH="$fake_bin:/usr/bin:/bin"
  export RUNNER_TEMP="$runner_temp"
  export NPM_CALLS="$case_dir/npm-calls"
  export NPM_ATTEMPTS="$case_dir/npm-attempts"
  export SLEEP_CALLS="$case_dir/sleep-calls"
  export BUN_BINARY="$case_dir/bun-binary"
}

new_case success
export NPM_MODE=success
EXPECTED_VERSION=v20.22.1 bash "$script" >"$case_dir/output" 2>&1 || fail "isolated install did not pass"
grep -Eq '^install --global --prefix .*/xcsh-npm-verify\.[^ ]+ @f5-sales-demo/xcsh@20\.22\.1$' "$NPM_CALLS" ||
  fail "npm was not invoked with the isolated prefix and pinned package"
[ "$(wc -l <"$NPM_CALLS")" -eq 1 ] || fail "verifier invoked legacy npm cleanup commands"
[ -s "$BUN_BINARY" ] || fail "sandbox check did not receive the exact installed binary"
[ ! -e "$SLEEP_CALLS" ] || fail "successful verification unexpectedly slept"
echo "[OK] uses one isolated prefix and its exact xcsh binary"

new_case fatal
export NPM_MODE=fatal
if EXPECTED_VERSION=v20.22.1 bash "$script" >"$case_dir/output" 2>&1; then
  fail "fatal local filesystem error passed"
fi
[ "$(cat "$NPM_ATTEMPTS")" -eq 1 ] || fail "fatal local filesystem error was retried"
[ ! -e "$SLEEP_CALLS" ] || fail "fatal local filesystem error slept before failing"
echo "[OK] fails immediately for a local ENOENT install error"

new_case retry
export NPM_MODE=retry-once
EXPECTED_VERSION=v20.22.1 bash "$script" >"$case_dir/output" 2>&1 || fail "registry retry did not recover"
[ "$(cat "$NPM_ATTEMPTS")" -eq 2 ] || fail "registry-not-found response was not retried once"
[ "$(cat "$SLEEP_CALLS")" = "10" ] || fail "registry retry did not use the initial bounded delay"
echo "[OK] retries a registry-not-found response and then verifies"
