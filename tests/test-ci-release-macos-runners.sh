#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
validator="$repo_root/scripts/ci-release-source-jobs.jq"
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

jq -n '{jobs: [
  {name: "check", conclusion: "success"},
  {name: "test", conclusion: "success"},
  {name: "Test installation methods", conclusion: "success"},
  {name: "Native build (linux, x64, baseline)", conclusion: "success"},
  {name: "Native build (linux, x64, modern)", conclusion: "success"},
  {name: "Native build (ubuntu-24.04, arm64)", conclusion: "success"},
  {name: "Native build (macos-15-intel, x64)", conclusion: "success"},
  {name: "Native build (macos-15-intel, x64)", conclusion: "success"},
  {name: "Native build (macos-14, arm64)", conclusion: "success"},
  {name: "Native build (windows-latest, x64)", conclusion: "success"},
  {name: "Native build (windows-latest, x64)", conclusion: "success"}
]}' >"$test_root/legacy.json"
jq -e -f "$validator" "$test_root/legacy.json" >/dev/null || fail "archived source run was rejected"

jq '(.jobs[].name) |=
  if . == "Native build (macos-14, arm64)" then "Native build (macos-latest, arm64)"
  elif . == "Native build (macos-15-intel, x64)" then "Native build (macos-26-intel, x64)"
  else . end' "$test_root/legacy.json" >"$test_root/current.json"
jq -e -f "$validator" "$test_root/current.json" >/dev/null || fail "latest macOS source run was rejected"

jq '(.jobs[] | select(.name == "Native build (macos-latest, arm64)") | .conclusion) = "failure"' \
  "$test_root/current.json" >"$test_root/failed.json"
if jq -e -f "$validator" "$test_root/failed.json" >/dev/null; then
  fail "failed latest macOS lane was accepted"
fi
jq '.jobs += [{name: "Native build (macos-15-intel, x64)", conclusion: "success"}]' \
  "$test_root/current.json" >"$test_root/extra.json"
if jq -e -f "$validator" "$test_root/extra.json" >/dev/null; then
  fail "duplicate archived/current lane was accepted"
fi

jq '(.jobs[].name) |=
  if . == "Native build (macos-latest, arm64)" then "Native build (macos-15, arm64)"
  else . end' "$test_root/current.json" >"$test_root/pinned.json"
jq -e -f "$validator" "$test_root/pinned.json" >/dev/null || fail "pinned macOS 15 ARM64 source run was rejected"
for conclusion in failure cancelled; do
  jq --arg conclusion "$conclusion" '(.jobs[] | select(.name == "Native build (macos-15, arm64)") | .conclusion) = $conclusion' \
    "$test_root/pinned.json" >"$test_root/pinned-failed.json"
  if jq -e -f "$validator" "$test_root/pinned-failed.json" >/dev/null; then
    fail "unsuccessful pinned macOS lane was accepted"
  fi
done
jq '.jobs |= map(select(.name != "Native build (macos-15, arm64)"))' \
  "$test_root/pinned.json" >"$test_root/pinned-missing.json"
if jq -e -f "$validator" "$test_root/pinned-missing.json" >/dev/null; then
  fail "missing pinned macOS lane was accepted"
fi
jq '.jobs += [{name: "Native build (macos-latest, arm64)", conclusion: "success"}]' \
  "$test_root/pinned.json" >"$test_root/pinned-duplicate.json"
if jq -e -f "$validator" "$test_root/pinned-duplicate.json" >/dev/null; then
  fail "duplicate pinned/latest ARM64 lane was accepted"
fi

echo "release macOS runner contract passed"
