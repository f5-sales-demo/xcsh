#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <experiment> <cold|warm> <pair-id> <0|2-file-workers> <output-dir> <all|native|rust|typescript>" >&2
  exit 2
}

[[ $# -eq 6 ]] || usage
experiment=$1
cache_state=$2
pair_id=$3
file_workers=$4
output_dir=$5
phase_set=$6

case "$experiment" in
image-control | image-candidate | d16-serial | d16-parallel-2 | d16-hardware | f32-hardware | d16-burst | f32-burst | dag-control | dag-candidate) ;;
*) usage ;;
esac
case "$cache_state" in cold | warm) ;; *) usage ;; esac
case "$file_workers" in 0 | 2) ;; *) usage ;; esac
case "$phase_set" in all | native | rust | typescript) ;; *) usage ;; esac
[[ "$pair_id" =~ ^[1-5](-slot-[1-4])?$ ]] || usage
[[ "$experiment" == d16-parallel-2 && "$file_workers" == 2 ]] || [[ "$experiment" != d16-parallel-2 && "$file_workers" == 0 ]] || usage
[[ "$experiment" == dag-candidate || "$phase_set" == all ]] || usage

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
export XCSH_SOURCE_ROOT=$repo_root
source_commit=$(git rev-parse HEAD)
test "$source_commit" = 0bca45d64934440703556091dc746de41dd5460b
SOURCE_DATE_EPOCH=$(git show -s --format=%ct "$source_commit")
[[ "$SOURCE_DATE_EPOCH" =~ ^[0-9]+$ ]]
export SOURCE_DATE_EPOCH
mkdir -p "$output_dir/manifests" "$output_dir/profiles"
output_dir=$(cd "$output_dir" && pwd)

tree_manifest() {
  local destination=$1
  shift
  : >"$destination"
  for item in "$@"; do
    if [[ -d "$item" ]]; then
      find "$item" -type f -print0
    elif [[ -f "$item" ]]; then
      printf '%s\0' "$item"
    fi
  done | LC_ALL=C sort -z | xargs -0r sha256sum >>"$destination"
}

set_profile_digest() {
  local profile=$1 manifest=$2
  local temporary="${profile}.tmp"
  jq --arg digest "sha256:$(sha256sum "$manifest" | cut -d ' ' -f1)" '.output_digest = $digest' \
    "$profile" >"$temporary"
  mv "$temporary" "$profile"
}

profile_phase() {
  local phase=$1 manifest=$2
  shift 2
  local profile="$output_dir/profiles/${phase}.json"
  GITHUB_SHA="$source_commit" runner-profile \
    --name "$phase" \
    --output "$profile" \
    --cache-state "$cache_state" \
    --variant "$experiment" \
    --pair-id "$pair_id" \
    -- "$@"
  set_profile_digest "$profile" "$manifest"
}

if [[ "$cache_state" == cold ]]; then
  rm -rf node_modules target "$RUNNER_TEMP/bun-install-cache"
  if [[ "$phase_set" == all || "$phase_set" == native ]]; then
    find packages/natives/native -maxdepth 1 -type f -name '*.node' -delete
  fi
  mkdir -p "$RUNNER_TEMP/bun-install-cache"
else
  rm -rf node_modules
  mkdir -p "$RUNNER_TEMP/bun-install-cache"
  BUN_INSTALL_CACHE_DIR="$RUNNER_TEMP/bun-install-cache" bash scripts/ci-bun-install.sh >/dev/null
  rm -rf node_modules
fi
export BUN_INSTALL_CACHE_DIR="$RUNNER_TEMP/bun-install-cache"

profile_install() {
  local phase=${1:-install}
  : >"$output_dir/manifests/${phase}.sha256"
  profile_phase "$phase" "$output_dir/manifests/${phase}.sha256" bash -c '
    bash scripts/ci-bun-install.sh
    find bun.lock package.json node_modules -type f -print0 |
      LC_ALL=C sort -z | xargs -0r sha256sum >"$1"
  ' _ "$output_dir/manifests/${phase}.sha256"
}

profile_native() {
  : >"$output_dir/manifests/native.sha256"
  profile_phase native "$output_dir/manifests/native.sha256" bash -c '
    TARGET_PLATFORM=linux TARGET_ARCH=x64 TARGET_VARIANTS="baseline modern" bun run ci:build:native
    find packages/natives/native -maxdepth 1 -type f -name "pi_natives.linux-x64-*.node" -print0 |
      LC_ALL=C sort -z | xargs -0r sha256sum >"$1"
  ' _ "$output_dir/manifests/native.sha256"
}

profile_typescript() {
  git ls-files -z -- '*test*.ts' '*test*.tsx' | LC_ALL=C sort -z | xargs -0r sha256sum \
    >"$output_dir/manifests/test-typescript.sha256"
  XCSH_TEST_FILE_WORKERS=$file_workers \
    profile_phase test-typescript "$output_dir/manifests/test-typescript.sha256" \
    bun "${XCSH_TEST_RUNNER:?XCSH_TEST_RUNNER is required}" "--file-workers=$file_workers"
}

profile_rust() {
  git ls-files -z -- 'Cargo.toml' 'Cargo.lock' '*.rs' | LC_ALL=C sort -z | xargs -0r sha256sum \
    >"$output_dir/manifests/test-rust.sha256"
  profile_phase test-rust "$output_dir/manifests/test-rust.sha256" bun run test:rs
}

case "$phase_set" in
all)
  profile_install
  profile_native
  profile_typescript
  profile_rust
  ;;
native)
  profile_install
  profile_native
  ;;
rust)
  profile_install install-rust
  profile_rust
  ;;
typescript)
  test -n "${XCSH_VERIFIED_NATIVE_MANIFEST:-}"
  profile_install install-typescript
  profile_typescript
  ;;
esac

read -r filesystem_bytes used_bytes available_bytes used_percent < <(
  df -P -B1 "$repo_root" | awk 'NR == 2 {gsub(/%/, "", $5); print $2, $3, $4, $5}'
)
run_created_at=$(curl --fail --silent --show-error \
  --header "Authorization: Bearer ${GH_TOKEN:?GH_TOKEN is required}" \
  --header "X-GitHub-Api-Version: 2022-11-28" \
  "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" | jq -er .created_at)
job_started_at=$(curl --fail --silent --show-error \
  --header "Authorization: Bearer $GH_TOKEN" \
  --header "X-GitHub-Api-Version: 2022-11-28" \
  "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/attempts/$GITHUB_RUN_ATTEMPT/jobs?per_page=100" |
  jq -er --arg runner "$RUNNER_NAME" '.jobs[] | select(.runner_name == $runner and .status == "in_progress") | .started_at' |
  head -1)
assignment_seconds=$(($(date -u -d "$job_started_at" +%s) - $(date -u -d "$run_created_at" +%s)))
profiled_node_seconds=$(jq -s 'map(.duration_seconds) | add' "$output_dir"/profiles/*.json)
jq -n \
  --arg experiment "$experiment" \
  --arg pair_id "$pair_id" \
  --arg source_sha "$source_commit" \
  --arg image_digest "${RUNNER_IMAGE_DIGEST:-}" \
  --arg runner_name "${RUNNER_NAME:-}" \
  --argjson assignment_seconds "$assignment_seconds" \
  --argjson file_workers "$file_workers" \
  --argjson filesystem_bytes "$filesystem_bytes" \
  --argjson used_bytes "$used_bytes" \
  --argjson available_bytes "$available_bytes" \
  --argjson profiled_node_seconds "$profiled_node_seconds" \
  --argjson used_ratio "$(awk -v percent="$used_percent" 'BEGIN {print percent / 100}')" \
  '{schema_version:1, experiment:$experiment, pair_id:$pair_id, source_sha:$source_sha,
    image_digest:$image_digest, runner_name:$runner_name, file_workers:$file_workers,
    assignment_seconds:$assignment_seconds, profiled_node_seconds:$profiled_node_seconds,
    restart_count:0, evicted:false,
    filesystem:{bytes:$filesystem_bytes, used_bytes:$used_bytes, available_bytes:$available_bytes, used_ratio:$used_ratio}}' \
  >"$output_dir/run-context.json"
jq -s '.' "$output_dir"/profiles/*.json >"$output_dir/workload-profiles.json"
