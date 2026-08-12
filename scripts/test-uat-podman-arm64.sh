#!/bin/bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
harness="$repo_root/scripts/uat-podman-arm64.sh"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/xcsh-podman-uat-test.XXXXXX")
fake_bin="$test_root/bin"
mkdir -p "$fake_bin" "$test_root/state"

cleanup() {
  case "$test_root" in
  "${TMPDIR:-/tmp}"/xcsh-podman-uat-test.*) rm -rf -- "$test_root" ;;
  *) echo "Refusing to remove unexpected test path: $test_root" >&2 ;;
  esac
}
trap cleanup EXIT

cat >"$fake_bin/uname" <<'FAKE_UNAME'
#!/bin/bash
case "${1:-}" in
-s) printf '%s\n' "${FAKE_OS:-Darwin}" ;;
-m) printf '%s\n' "${FAKE_ARCH:-arm64}" ;;
*) printf '%s\n' "${FAKE_OS:-Darwin}" ;;
esac
FAKE_UNAME

cat >"$fake_bin/podman" <<'FAKE_PODMAN'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >>"${FAKE_PODMAN_LOG:?}"

if [ "${1:-}" = "--version" ]; then
  echo "podman version 6.0.2"
  exit 0
fi

case "${1:-} ${2:-}" in
"info ")
  [ "${FAKE_PODMAN_DOWN:-0}" = 0 ]
  ;;
"machine ssh")
  exit 0
  ;;
"manifest inspect")
  cat <<'JSON'
{"schemaVersion":2,"manifests":[{"digest":"sha256:arm64child","platform":{"architecture":"arm64","os":"linux"}},{"digest":"sha256:amd64child","platform":{"architecture":"amd64","os":"linux"}}]}
JSON
  ;;
"pull --platform=linux/arm64")
  echo "sha256:arm64child"
  ;;
"image inspect")
  format=""
  previous=""
  for argument in "$@"; do
    if [ "$previous" = "--format" ]; then format="$argument"; fi
    previous="$argument"
  done
  case "$format" in
  *Architecture*) echo "${FAKE_IMAGE_ARCH:-arm64}" ;;
  *RepoDigests*) echo '["ghcr.io/f5-sales-demo/xcsh@sha256:d3e35ebe9fb889fbbf8f9216ac2e62987f72704b0e3387234b0b677fa8a56c95"]' ;;
  *Id*) echo "sha256:arm64child" ;;
  *) exit 2 ;;
  esac
  ;;
"run "*)
  entrypoint=""
  model=""
  command=""
  previous=""
  for argument in "$@"; do
    case "$previous" in
    --entrypoint) entrypoint="$argument" ;;
    --model) model="$argument" ;;
    -c) command="$argument" ;;
    esac
    previous="$argument"
  done

  if [ "$entrypoint" = "uname" ]; then
    echo "${FAKE_RUNTIME_ARCH:-aarch64}"
    exit 0
  fi
  if [ "$entrypoint" = "xcsh" ] && printf '%s\n' "$*" | grep -Fq -- "--version"; then
    echo "${FAKE_XCSH_VERSION:-xcsh/20.15.0}"
    exit 0
  fi
  if [[ "$command" == *"--list-models"* ]]; then
    selector=${!#}
    printf 'discovery %s\n' "$selector" >>"${FAKE_PODMAN_LOG:?}"
    [ -z "${FAKE_DISCOVERY_ONLY:-}" ] || [ "$selector" = "$FAKE_DISCOVERY_ONLY" ] || exit 1
    if [ "${FAKE_MATRIX:-0}" = 1 ] && [ "$selector" = "alpha/one" ] &&
      [ ! -e "${FAKE_PODMAN_STATE:?}/alpha-discovery-failed" ]; then
      touch "${FAKE_PODMAN_STATE}/alpha-discovery-failed"
      exit 1
    fi
    exit 0
  fi
  if [ -n "$model" ]; then
    provider=${model%%/*}
    response=PONG
    resolved_model=${model#"$provider"/}
    if [ "${FAKE_MATRIX:-0}" = 1 ]; then
      case "$model" in
      beta/two) exit 1 ;;
      gamma/three) provider=wrong ;;
      delta/four) resolved_model=wrong ;;
      epsilon/five) printf 'not-json\n'; exit 0 ;;
      zeta/six)
        count_file="${FAKE_PODMAN_STATE:?}/zeta-invocations"
        count=$(cat "$count_file" 2>/dev/null || printf '0')
        count=$((count + 1))
        printf '%s' "$count" >"$count_file"
        if [ "$count" -gt 1 ]; then exit 124; fi
        response=NOPE
        ;;
      esac
    fi
    [ "${FAKE_RUN_FAIL:-0}" = 0 ] || exit 125
    provider=${FAKE_PROVIDER:-$provider}
    resolved_model=${FAKE_MODEL:-$resolved_model}
    response=${FAKE_RESPONSE:-$response}
    printf '{"type":"session","provider":"%s","model":"%s"}\n' "$provider" "$resolved_model"
    printf '{"type":"message_start","message":{"role":"user"}}\n'
    printf '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"%s"}}\n' "$response"
    printf '{"type":"message_end","message":{"role":"assistant","provider":"%s","model":"%s","stopReason":"stop"}}\n' \
      "$provider" "$resolved_model"
    exit 0
  fi
  exit 2
  ;;
*)
  exit 2
  ;;
esac
FAKE_PODMAN
chmod +x "$fake_bin/uname" "$fake_bin/podman"
printf '%s\n' '-----BEGIN CERTIFICATE-----' 'test-ca' '-----END CERTIFICATE-----' >"$test_root/ca.pem"

run_harness() {
  local output_file=$1
  shift
  PATH="$fake_bin:$PATH" \
    FAKE_PODMAN_LOG="$test_root/podman.log" \
    FAKE_PODMAN_STATE="$test_root/state" \
    LITELLM_BASE_URL="https://litellm.invalid" \
    LITELLM_API_KEY="test-secret-never-log" \
    bash "$harness" "$@" --report "$output_file"
}
echo "[1/10] Six caller-supplied fixture selectors pass independently."
: >"$test_root/podman.log"
run_harness "$test_root/happy.json" --runs 1 --warmups 1 \
  --model "GPT Sol=fixture-gpt/sol-tier" \
  --model "GPT Terra=fixture-gpt/terra-tier" \
  --model "GPT Luna=fixture-gpt/luna-tier" \
  --model "Anthropic Haiku=fixture-anthropic/haiku-tier" \
  --model "Anthropic Sonnet=fixture-anthropic/sonnet-tier" \
  --model "Anthropic Opus=fixture-anthropic/opus-tier"
jq -e '
  (. | keys | sort) == ["passed", "samples", "schemaVersion"] and
  .schemaVersion == 2 and .passed and (.samples | length) == 12 and
  all(.samples[];
    (. | keys | sort) == ["category", "expected", "label", "passed", "phase", "resolved", "selector"] and
    .passed and .category == "none" and .expected == .resolved)
' "$test_root/happy.json" >/dev/null
test "$(grep -c -- --list-models "$test_root/podman.log")" = 12
for selector in fixture-gpt/sol-tier fixture-gpt/terra-tier fixture-gpt/luna-tier fixture-anthropic/haiku-tier fixture-anthropic/sonnet-tier fixture-anthropic/opus-tier; do
  test "$(grep -Fc "discovery $selector" "$test_root/podman.log")" = 2
done
if grep -Fq 'test-secret-never-log' "$test_root/podman.log" "$test_root/happy.json"; then
  echo "Credential leaked into logs or report." >&2
  exit 1
fi

echo "[2/10] A model input is required."
if run_harness "$test_root/no-model.json" --runs 1 --warmups 0 >/dev/null 2>&1; then
  echo "Expected missing-model failure." >&2
  exit 1
fi
echo "[3/10] Each selector requires its own discovery."
if FAKE_DISCOVERY_ONLY=fixture-gpt/sol-tier run_harness "$test_root/discovery.json" --runs 1 --warmups 0 \
  --model "Sol=fixture-gpt/sol-tier" --model "Terra=fixture-gpt/terra-tier" >/dev/null 2>&1; then
  echo "Expected discovery-isolation failure." >&2
  exit 1
fi
jq -e '.passed == false and any(.samples[]; .selector == "fixture-gpt/terra-tier" and .category == "selector_unavailable")' \
  "$test_root/discovery.json" >/dev/null

echo "[4/10] Every failure category is deterministic."
if FAKE_MATRIX=1 run_harness "$test_root/access.json" --runs 1 --warmups 0 \
  --model "Beta=beta/two" >/dev/null 2>&1; then exit 1; fi
jq -e 'any(.samples[]; .category == "access_or_deployment_unavailable")' "$test_root/access.json" >/dev/null
if FAKE_MATRIX=1 run_harness "$test_root/provider.json" --runs 1 --warmups 0 \
  --model "Gamma=gamma/three" >/dev/null 2>&1; then exit 1; fi
jq -e 'any(.samples[]; .category == "provider_mismatch")' "$test_root/provider.json" >/dev/null
if FAKE_MATRIX=1 run_harness "$test_root/model.json" --runs 1 --warmups 0 \
  --model "Delta=delta/four" >/dev/null 2>&1; then exit 1; fi
jq -e 'any(.samples[]; .category == "model_mismatch")' "$test_root/model.json" >/dev/null
if FAKE_MATRIX=1 run_harness "$test_root/invalid.json" --runs 1 --warmups 0 \
  --model "Epsilon=epsilon/five" >/dev/null 2>&1; then exit 1; fi
jq -e 'any(.samples[]; .category == "invalid_event_stream")' "$test_root/invalid.json" >/dev/null
if FAKE_MATRIX=1 run_harness "$test_root/response.json" --runs 1 --warmups 0 \
  --model "Zeta=zeta/six" >/dev/null 2>&1; then exit 1; fi
jq -e 'any(.samples[]; .category == "response_mismatch")' "$test_root/response.json" >/dev/null
if FAKE_MATRIX=1 run_harness "$test_root/timeout.json" --runs 2 --warmups 0 \
  --model "Zeta=zeta/six" >/dev/null 2>&1; then exit 1; fi
jq -e 'any(.samples[]; .category == "timeout_or_process_failure")' "$test_root/timeout.json" >/dev/null

echo "[5/10] Missing credentials fail before Podman execution."
if env -u LITELLM_API_KEY PATH="$fake_bin:$PATH" FAKE_PODMAN_LOG="$test_root/podman.log" \
  LITELLM_BASE_URL="https://litellm.invalid" bash "$harness" --model "Probe=fixture-gpt/sol-tier" \
  --report "$test_root/missing-key.json" >/dev/null 2>&1; then
  echo "Expected missing-key failure." >&2
  exit 1
fi

echo "PASS: ARM64 Podman UAT harness contract tests completed."
