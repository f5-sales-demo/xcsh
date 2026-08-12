#!/bin/bash
set -euo pipefail

readonly DEFAULT_IMAGE="ghcr.io/f5-sales-demo/xcsh@sha256:d3e35ebe9fb889fbbf8f9216ac2e62987f72704b0e3387234b0b677fa8a56c95"
readonly PROMPT='Reply with exactly `PONG` and nothing else.'

image="$DEFAULT_IMAGE"
runs=3
warmups=1
timeout_seconds=120
report_path=""
ca_cert=""
custom_ca=false
custom_models=false
model_labels=()
model_selectors=()

usage() {
  cat <<'USAGE'
Usage: scripts/uat-podman-arm64.sh [options]

Run native ARM64 acceptance tests against the published xcsh container.

Options:
  --image REF             Immutable image reference (default: v20.15.0 OCI index digest)
  --runs N                Measured runs per model (default: 3)
  --warmups N             Warmup runs per model (default: 1)
  --timeout-seconds N     Maximum seconds for each model invocation (default: 120)
  --report FILE           Secret-free JSON report path (default: $TMPDIR)
  --ca-cert FILE         Trust an additional PEM CA in the Podman VM and test containers
  --model LABEL=SELECTOR  Add a model target; repeatable
  -h, --help              Show this help

Required environment:
  LITELLM_BASE_URL
  LITELLM_API_KEY
USAGE
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_nonnegative_integer() {
  local value=$1
  local name=$2
  [[ "$value" =~ ^[0-9]+$ ]] || die "$name must be a non-negative integer."
}

require_positive_integer() {
  local value=$1
  local name=$2
  [[ "$value" =~ ^[1-9][0-9]*$ ]] || die "$name must be a positive integer."
}

add_model() {
  local value=$1
  local label selector provider model_name
  case "$value" in
  *=*)
    label=${value%%=*}
    selector=${value#*=}
    ;;
  *)
    die "--model must use LABEL=PROVIDER/MODEL."
    ;;
  esac
  provider=${selector%%/*}
  model_name=${selector#"$provider"/}
  [ -n "$label" ] || die "--model label cannot be empty."
  [ -n "$provider" ] && [ -n "$model_name" ] && [ "$provider" != "$selector" ] ||
    die "--model selector must use PROVIDER/MODEL."
  if [ "$custom_models" = false ]; then
    model_labels=()
    model_selectors=()
    custom_models=true
  fi
  model_labels[${#model_labels[@]}]="$label"
  model_selectors[${#model_selectors[@]}]="$selector"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
  --image)
    [ "$#" -ge 2 ] || die "--image requires a value."
    image=$2
    shift 2
    ;;
  --runs)
    [ "$#" -ge 2 ] || die "--runs requires a value."
    runs=$2
    shift 2
    ;;
  --warmups)
    [ "$#" -ge 2 ] || die "--warmups requires a value."
    warmups=$2
    shift 2
    ;;
  --timeout-seconds)
    [ "$#" -ge 2 ] || die "--timeout-seconds requires a value."
    timeout_seconds=$2
    shift 2
    ;;
  --ca-cert)
    [ "$#" -ge 2 ] || die "--ca-cert requires a value."
    ca_cert=$2
    shift 2
    ;;
  --report)
    [ "$#" -ge 2 ] || die "--report requires a value."
    report_path=$2
    shift 2
    ;;
  --model)
    [ "$#" -ge 2 ] || die "--model requires a value."
    add_model "$2"
    shift 2
    ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    die "Unknown argument: $1"
    ;;
  esac
done

require_positive_integer "$runs" "--runs"
require_nonnegative_integer "$warmups" "--warmups"
require_positive_integer "$timeout_seconds" "--timeout-seconds"

if [ "$custom_models" = false ]; then
  model_labels=("GPT-5.6 Sol" "Claude Opus 5")
  model_selectors=("litellm/gpt-5.6-sol" "anthropic/claude-opus-5")
fi

[ "$(uname -s)" = "Darwin" ] || die "This UAT must run on macOS."
[ "$(uname -m)" = "arm64" ] || die "This UAT must run on an ARM64 Mac."
command -v podman >/dev/null 2>&1 || die "Podman is unavailable."
command -v jq >/dev/null 2>&1 || die "jq is unavailable."
[ -n "${LITELLM_BASE_URL:-}" ] || die "LITELLM_BASE_URL is required."
[ -n "${LITELLM_API_KEY:-}" ] || die "LITELLM_API_KEY is required."

podman info >/dev/null 2>&1 || die "Podman machine is not running. Start it with: podman machine start"
if [ -n "$ca_cert" ]; then
  [ -r "$ca_cert" ] || die "CA certificate is not readable: $ca_cert"
  podman machine ssh --username root podman-machine-default \
    'install -d -m 0755 /etc/pki/ca-trust/source/anchors && cat > /etc/pki/ca-trust/source/anchors/xcsh-uat.pem && update-ca-trust' \
    <"$ca_cert" || die "Unable to install the additional CA in the Podman VM."
  custom_ca=true
fi

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
if [ -z "$report_path" ]; then
  report_path="${TMPDIR:-/tmp}/xcsh-podman-arm64-uat-${timestamp}.json"
fi
report_dir=$(dirname "$report_path")
[ -d "$report_dir" ] || die "Report directory does not exist: $report_dir"

run_dir=$(mktemp -d "${TMPDIR:-/tmp}/xcsh-podman-arm64-uat.XXXXXX")
samples_file="$run_dir/samples.jsonl"
: >"$samples_file"
cleanup() {
  case "$run_dir" in
  "${TMPDIR:-/tmp}"/xcsh-podman-arm64-uat.*) rm -rf -- "$run_dir" ;;
  *) echo "Refusing to remove unexpected temporary path: $run_dir" >&2 ;;
  esac
}
trap cleanup EXIT

echo "Inspecting immutable OCI index..."
manifest_json=$(podman manifest inspect "$image") || die "Unable to inspect OCI index: $image"
printf '%s' "$manifest_json" | jq -e \
  '.manifests[]? | select(.platform.os == "linux" and .platform.architecture == "arm64")' \
  >/dev/null || die "OCI index does not contain linux/arm64."

echo "Pulling native linux/arm64 image..."
podman pull --platform=linux/arm64 "$image"

image_architecture=$(podman image inspect --format '{{.Architecture}}' "$image")
[ "$image_architecture" = "arm64" ] ||
  die "Resolved image architecture is $image_architecture, expected arm64."
image_id=$(podman image inspect --format '{{.Id}}' "$image")
repo_digests=$(podman image inspect --format '{{json .RepoDigests}}' "$image")
if ! printf '%s' "$repo_digests" | jq -e 'type == "array"' >/dev/null 2>&1; then
  repo_digests='[]'
fi

base_run_options=(
  run
  --rm
  --pull=never
  --platform linux/arm64
  --read-only
  --cap-drop all
  --security-opt=no-new-privileges
  --tmpfs "/tmp:rw,nosuid,nodev,size=1g,mode=1777"
  --tmpfs "/home/xcsh/.xcsh:rw,exec,nosuid,nodev,size=256m,mode=1777"
)
if [ "$custom_ca" = true ]; then
  base_run_options+=(
    --volume "$ca_cert:/etc/xcsh/uat-ca.pem:ro"
    --env NODE_EXTRA_CA_CERTS=/etc/xcsh/uat-ca.pem
  )
fi

runtime_machine=$(podman "${base_run_options[@]}" --entrypoint uname "$image" -m)
[ "$runtime_machine" = "aarch64" ] ||
  die "Container runtime reports $runtime_machine, expected aarch64."
xcsh_version=$(podman "${base_run_options[@]}" --entrypoint xcsh "$image" --version)
[ "$xcsh_version" = "xcsh/20.15.0" ] ||
  die "Container reports $xcsh_version, expected xcsh/20.15.0."

podman_version=$(podman --version)
failure_count=0

append_sample() {
  local label=$1 selector=$2 phase=$3 round=$4 success=$5 response_exact=$6
  local resolved_provider=$7 resolved_model=$8 error=$9
  local expected_provider expected_model
  expected_provider=${selector%%/*}
  expected_model=${selector#"$expected_provider"/}
  jq -nc \
    --arg label "$label" \
    --arg selector "$selector" \
    --arg phase "$phase" \
    --argjson round "$round" \
    --argjson success "$success" \
    --argjson responseExact "$response_exact" \
    --arg expectedProvider "$expected_provider" \
    --arg expectedModel "$expected_model" \
    --arg resolvedProvider "$resolved_provider" \
    --arg resolvedModel "$resolved_model" \
    --arg error "$error" \
    '{
      label: $label,
      selector: $selector,
      phase: $phase,
      round: $round,
      success: $success,
      responseExact: $responseExact,
      expectedProvider: $expectedProvider,
      expectedModel: $expectedModel,
      resolvedProvider: (if $resolvedProvider == "" then null else $resolvedProvider end),
      resolvedModel: (if $resolvedModel == "" then null else $resolvedModel end),
      error: (if $error == "" then null else $error end)
    }' >>"$samples_file"
}

run_sample() {
  local label=$1 selector=$2 phase=$3 round=$4
  local stdout_file="$run_dir/stdout.jsonl"
  local stderr_file="$run_dir/stderr.txt"
  local resolved_provider="" resolved_model="" response=""
  local expected_provider expected_model
  local success=true response_exact=false error=""

  expected_provider=${selector%%/*}
  expected_model=${selector#"$expected_provider"/}
  : >"$stdout_file"
  : >"$stderr_file"
  echo "[$phase $round] $label ($selector)"
  if ! podman "${base_run_options[@]}" \
    --timeout "$timeout_seconds" \
    --env LITELLM_BASE_URL \
    --env LITELLM_API_KEY \
    "$image" \
    --mode json \
    --no-session \
    --no-memories \
    --no-tools \
    --no-mcp \
    --no-lsp \
    --no-extensions \
    --no-skills \
    --no-rules \
    --no-title \
    --thinking high \
    --model "$selector" \
    "$PROMPT" \
    >"$stdout_file" 2>"$stderr_file"; then
    success=false
    error="model_process_failed"
  elif ! jq -e -s . "$stdout_file" >/dev/null 2>&1; then
    success=false
    error="invalid_json_events"
  else
    response=$(jq -rs \
      '[.[] | select(.type == "message_update") | .assistantMessageEvent |
        select(.type == "text_delta") | .delta] | join("")' "$stdout_file")
    resolved_provider=$(jq -rs \
      '[.[] |
        if .type == "message_end" and .message.role == "assistant" then .message.provider
        elif .type == "session" then .provider
        else empty end] | last // ""' "$stdout_file")
    resolved_model=$(jq -rs \
      '[.[] |
        if .type == "message_end" and .message.role == "assistant" then .message.model
        elif .type == "session" then .model
        else empty end] | last // ""' "$stdout_file")

    if [ "$response" = "PONG" ]; then
      response_exact=true
    else
      success=false
      error="response_not_exact"
    fi
    if [ "$resolved_provider" != "$expected_provider" ] ||
      [ "$resolved_model" != "$expected_model" ]; then
      success=false
      error="resolved_model_mismatch"
    fi
  fi

  if [ "$success" = false ]; then
    failure_count=$((failure_count + 1))
    echo "  FAIL: $error (provider stderr withheld to protect credentials)." >&2
  else
    echo "  PASS"
  fi
  append_sample "$label" "$selector" "$phase" "$round" \
    "$success" "$response_exact" "$resolved_provider" "$resolved_model" "$error"
}

if [ "$warmups" -gt 0 ]; then
  warmup_round=1
  while [ "$warmup_round" -le "$warmups" ]; do
    model_index=0
    while [ "$model_index" -lt "${#model_selectors[@]}" ]; do
      run_sample "${model_labels[$model_index]}" "${model_selectors[$model_index]}" \
        "warmup" "$warmup_round"
      model_index=$((model_index + 1))
    done
    warmup_round=$((warmup_round + 1))
  done
fi

measured_round=1
while [ "$measured_round" -le "$runs" ]; do
  model_index=0
  while [ "$model_index" -lt "${#model_selectors[@]}" ]; do
    run_sample "${model_labels[$model_index]}" "${model_selectors[$model_index]}" \
      "measured" "$measured_round"
    model_index=$((model_index + 1))
  done
  measured_round=$((measured_round + 1))
done

if [ "$failure_count" -eq 0 ]; then
  passed=true
else
  passed=false
fi

jq -s \
  --arg createdAt "$timestamp" \
  --arg podmanVersion "$podman_version" \
  --arg imageReference "$image" \
  --arg imageId "$image_id" \
  --arg imageArchitecture "$image_architecture" \
  --arg runtimeMachine "$runtime_machine" \
  --arg xcshVersion "$xcsh_version" \
  --argjson repoDigests "$repo_digests" \
  --argjson runs "$runs" \
  --argjson warmups "$warmups" \
  --argjson timeoutSeconds "$timeout_seconds" \
  --argjson passed "$passed" \
  --argjson customCa "$custom_ca" \
  '{
    schemaVersion: 1,
    createdAt: $createdAt,
    passed: $passed,
    host: {
      os: "Darwin",
      architecture: "arm64",
      podmanVersion: $podmanVersion
    },
    image: {
      reference: $imageReference,
      id: $imageId,
      architecture: $imageArchitecture,
      repoDigests: $repoDigests,
      runtimeMachine: $runtimeMachine,
      xcshVersion: $xcshVersion
    },
    config: {
      runs: $runs,
      warmups: $warmups,
      timeoutSeconds: $timeoutSeconds,
      customCa: $customCa
    },
    samples: .
  }' "$samples_file" >"$report_path"

echo "Report: $report_path"
if [ "$passed" = true ]; then
  echo "PASS: Native ARM64 Podman and LiteLLM matrix UAT completed."
else
  echo "FAIL: $failure_count matrix invocation(s) did not meet acceptance criteria." >&2
  exit 1
fi
