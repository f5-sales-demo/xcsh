#!/bin/bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
harness="$repo_root/scripts/uat-podman-arm64.sh"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/xcsh-podman-uat-test.XXXXXX")
fake_bin="$test_root/bin"
mkdir -p "$fake_bin"

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
  previous=""
  for argument in "$@"; do
    case "$previous" in
    --entrypoint) entrypoint="$argument" ;;
    --model) model="$argument" ;;
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
  if [ -n "$model" ]; then
    [ "${FAKE_RUN_FAIL:-0}" = 0 ] || exit 125
    provider=${model%%/*}
    resolved_model=${model#"$provider"/}
    provider=${FAKE_PROVIDER:-$provider}
    resolved_model=${FAKE_MODEL:-$resolved_model}
    response=${FAKE_RESPONSE:-PONG}
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
    LITELLM_BASE_URL="https://litellm.invalid" \
    LITELLM_API_KEY="test-secret-never-log" \
    bash "$harness" "$@" --report "$output_file"
}

echo "[1/7] Happy path exercises the default matrix."
: >"$test_root/podman.log"
run_harness "$test_root/happy.json" --ca-cert "$test_root/ca.pem"
jq -e '
  .passed == true and
  .host.architecture == "arm64" and
  .image.runtimeMachine == "aarch64" and
  .image.xcshVersion == "xcsh/20.15.0" and
  ([.samples[] | select(.phase == "warmup")] | length) == 2 and
  .config.customCa == true and
  ([.samples[] | select(.phase == "measured")] | length) == 6 and
  all(.samples[];
    .success and
    .responseExact and
    .resolvedProvider == .expectedProvider and
    .resolvedModel == .expectedModel)
' "$test_root/happy.json" >/dev/null
test "$(grep -c -- '--model' "$test_root/podman.log")" = 8
grep -Fq -- '--timeout 120' "$test_root/podman.log"
if grep -Eq -- '--tmpfs [^ ]*(uid|gid)=' "$test_root/podman.log"; then
  echo "Podman-incompatible tmpfs ownership option detected." >&2
  exit 1
fi
grep -Fq -- '/home/xcsh/.xcsh:rw,exec,nosuid,nodev,size=256m,mode=1777' "$test_root/podman.log"
grep -Fq -- 'update-ca-trust' "$test_root/podman.log"
grep -Fq -- '--entrypoint bash' "$test_root/podman.log"
grep -Fq -- 'xcsh --list-models >/dev/null' "$test_root/podman.log"
if grep -Fq 'test-secret-never-log' "$test_root/podman.log" "$test_root/happy.json"; then
  echo "Credential leaked into logs or report." >&2
  exit 1
fi

echo "[2/7] Missing credentials fail before Podman execution."
if env -u LITELLM_API_KEY PATH="$fake_bin:$PATH" FAKE_PODMAN_LOG="$test_root/podman.log" \
  LITELLM_BASE_URL="https://litellm.invalid" bash "$harness" \
  --report "$test_root/missing-key.json" >/dev/null 2>&1; then
  echo "Expected missing-key failure." >&2
  exit 1
fi

echo "[3/7] Non-ARM hosts are rejected."
if FAKE_ARCH=x86_64 run_harness "$test_root/wrong-host.json" \
  --runs 1 --warmups 0 >/dev/null 2>&1; then
  echo "Expected host-architecture failure." >&2
  exit 1
fi

echo "[4/7] Unavailable Podman machines are rejected."
if FAKE_PODMAN_DOWN=1 run_harness "$test_root/podman-down.json" \
  --runs 1 --warmups 0 >/dev/null 2>&1; then
  echo "Expected Podman availability failure." >&2
  exit 1
fi

echo "[5/7] Inexact model responses fail acceptance."
if FAKE_RESPONSE=NOPE run_harness "$test_root/non-pong.json" \
  --runs 1 --warmups 0 >/dev/null 2>&1; then
  echo "Expected exact-response failure." >&2
  exit 1
fi
jq -e '.passed == false and any(.samples[]; .responseExact == false)' \
  "$test_root/non-pong.json" >/dev/null

echo "[6/7] Provider/model mismatches fail acceptance."
if FAKE_PROVIDER=wrong run_harness "$test_root/mismatch.json" \
  --runs 1 --warmups 0 >/dev/null 2>&1; then
  echo "Expected provider-mismatch failure." >&2
  exit 1
fi
jq -e '.passed == false and any(.samples[]; .error == "resolved_model_mismatch")' \
  "$test_root/mismatch.json" >/dev/null

echo "[7/7] Failed or timed-out Podman runs fail acceptance."
if FAKE_RUN_FAIL=1 run_harness "$test_root/run-failed.json" \
  --runs 1 --warmups 0 >/dev/null 2>&1; then
  echo "Expected model-process failure." >&2
  exit 1
fi
jq -e '.passed == false and any(.samples[]; .error == "model_process_failed")' \
  "$test_root/run-failed.json" >/dev/null

echo "PASS: ARM64 Podman UAT harness contract tests completed."
