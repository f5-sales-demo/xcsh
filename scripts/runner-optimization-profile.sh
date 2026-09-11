#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <full|pr> <baseline|bun-1.4.2|d16-four|f32> <software|hardware|burst> <cold|warm> <pair-id> <output-dir>" >&2
  exit 2
}

[[ $# -eq 6 ]] || usage
mode=$1
variant=$2
comparison=$3
cache_state=$4
pair_id=$5
output_dir=$6

case "$mode" in full | pr) ;; *) usage ;; esac
case "$variant" in baseline | bun-1.4.2 | d16-four | f32) ;; *) usage ;; esac
case "$comparison" in software | hardware | burst) ;; *) usage ;; esac
case "$cache_state" in cold | warm) ;; *) usage ;; esac
[[ "$pair_id" =~ ^[a-z0-9-]+$ ]] || usage

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
source_commit=$(git rev-parse HEAD)
mkdir -p "$output_dir/manifests" "$output_dir/metrics" "$output_dir/profiles"
output_dir=$(cd "$output_dir" && pwd)

SOURCE_DATE_EPOCH=$(git show -s --format=%ct "$source_commit")
[[ "$SOURCE_DATE_EPOCH" =~ ^[0-9]+$ ]] || {
  echo "unable to resolve SOURCE_DATE_EPOCH from GITHUB_SHA" >&2
  exit 1
}
export SOURCE_DATE_EPOCH

tree_manifest() {
  local destination=$1
  shift
  : >"$destination"
  for path in "$@"; do
    if [[ -d "$path" ]]; then
      find "$path" -type f -print0
    elif [[ -f "$path" ]]; then
      printf '%s\0' "$path"
    fi
  done | sort -z | xargs -0r sha256sum >>"$destination"
}

set_profile_digest() {
  local profile=$1 digest=$2 temporary
  temporary="${profile}.tmp"
  jq --arg digest "sha256:$digest" '.output_digest = $digest' "$profile" >"$temporary"
  mv "$temporary" "$profile"
}

profile_phase() {
  local phase=$1 digest_kind=$2
  shift 2
  local profile="$output_dir/profiles/${phase}.json"
  GITHUB_SHA="$source_commit" runner-profile \
    --name "${phase}-${comparison}" \
    --output "$profile" \
    --cache-state "$cache_state" \
    --variant "$variant" \
    --pair-id "${comparison}-${cache_state}-${pair_id}" \
    -- "$@"

  local manifest="$output_dir/manifests/${phase}.sha256"
  case "$digest_kind" in
  install)
    tree_manifest "$output_dir/manifests/install-files.sha256" bun.lock package.json node_modules
    printf 'frozen-install-completed\nbun.lock\nnode_modules\n' >"$manifest"
    ;;
  native)
    tree_manifest "$output_dir/manifests/native-files.sha256" packages/natives/native
    find packages/natives/native -maxdepth 1 -type f -name '*.node' -printf '%f\n' |
      LC_ALL=C sort >"$manifest"
    ;;
  test) printf 'ci:test:full completed\n' >"$manifest" ;;
  startup)
    bun packages/coding-agent/src/cli.ts --version >"$manifest"
    ;;
  ttft)
    jq -S 'keys' "$output_dir/metrics/${phase}.json" >"$manifest"
    ;;
  release)
    tree_manifest "$output_dir/manifests/release-binaries.sha256" packages/coding-agent/binaries
    find packages/coding-agent/binaries -maxdepth 1 -type f -printf '%f\n' | LC_ALL=C sort \
      >"$output_dir/manifests/release-files.txt"
    packages/coding-agent/binaries/xcsh-linux-x64 --version \
      >"$output_dir/manifests/release-version.txt"
    if [[ "$comparison" == software ]]; then
      (
        cd "$output_dir/manifests"
        sha256sum release-files.txt release-version.txt
      ) >"$manifest"
    else
      cp "$output_dir/manifests/release-binaries.sha256" "$manifest"
    fi
    ;;
  *) usage ;;
  esac
  set_profile_digest "$profile" "$(sha256sum "$manifest" | cut -d ' ' -f1)"
}

if [[ "$cache_state" == cold ]]; then
  rm -rf node_modules target "$RUNNER_TEMP/bun-install-cache"
  mkdir -p "$RUNNER_TEMP/bun-install-cache"
else
  rm -rf node_modules
  mkdir -p "$RUNNER_TEMP/bun-install-cache"
  BUN_INSTALL_CACHE_DIR="$RUNNER_TEMP/bun-install-cache" \
    bash scripts/ci-bun-install.sh >/dev/null
  rm -rf node_modules
fi

export BUN_INSTALL_CACHE_DIR="$RUNNER_TEMP/bun-install-cache"
profile_phase install install bash scripts/ci-bun-install.sh
profile_phase native native env \
  TARGET_PLATFORM=linux TARGET_ARCH=x64 TARGET_VARIANTS="baseline modern" \
  bun run ci:build:native
profile_phase test test bun run ci:test:full

if [[ "$mode" == full ]]; then
  export XCSH_BUILD_BRANCH=main
  export XCSH_VERTEX_OAUTH_CLIENT_ID=benchmark-nonproduction-client
  export XCSH_VERTEX_OAUTH_CLIENT_SECRET=benchmark-nonproduction-secret
  profile_phase release release bun scripts/ci-release-build-binaries.ts --platform linux,win32
  profile_phase startup startup bun packages/coding-agent/src/cli.ts --version
  profile_phase ttft-cold ttft bun packages/coding-agent/bench/ttft.ts \
    --runs 1 --only cold --out "$output_dir/metrics/ttft-cold.json"
  profile_phase ttft-warm ttft bun packages/coding-agent/bench/ttft.ts \
    --runs 1 --only warm --out "$output_dir/metrics/ttft-warm.json"
  git diff --exit-code
fi

read -r filesystem_bytes used_bytes available_bytes used_percent < <(
  df -P -B1 "$repo_root" | awk 'NR == 2 {gsub(/%/, "", $5); print $2, $3, $4, $5}'
)
jq -n \
  --argjson filesystem_bytes "$filesystem_bytes" \
  --argjson used_bytes "$used_bytes" \
  --argjson available_bytes "$available_bytes" \
  --argjson used_percent "$used_percent" \
  '{filesystem_bytes: $filesystem_bytes, used_bytes: $used_bytes, available_bytes: $available_bytes, used_ratio: ($used_percent / 100)}' \
  >"$output_dir/node-filesystem.json"
jq -s '.' "$output_dir"/profiles/*.json >"$output_dir/workload-profiles.json"
