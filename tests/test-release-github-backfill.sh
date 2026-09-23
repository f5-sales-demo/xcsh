#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
workflow="$repo_root/.github/workflows/release-github-backfill.yml"
ci_workflow="$repo_root/.github/workflows/ci.yml"
npm_workflow="$repo_root/.github/workflows/release-npm-backfill.yml"
script="$repo_root/scripts/ci-release-github-backfill.sh"
job_validator="$repo_root/scripts/ci-release-source-jobs.jq"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

test -f "$workflow" || fail "backfill workflow is missing"
test -f "$ci_workflow" || fail "CI workflow is missing"
test -f "$npm_workflow" || fail "npm backfill workflow is missing"
test -x "$script" || fail "backfill script is not executable"
test -f "$job_validator" || fail "source-run job validator is missing"

grep -Fq 'runs-on: macos-14' "$workflow" || fail "backfill must run on macOS for strict codesign verification"
if grep -Fq 'runs-on: xcsh-socketless' "$workflow"; then
  fail "backfill must not route strict macOS verification to Linux"
fi
create_release=$(sed -n '/^  create-release:/,/^  update-homebrew:/p' "$ci_workflow")
grep -Fq 'runs-on: macos-14' <<<"$create_release" || fail "immutable release publisher must run on macOS"
grep -Fq "bash scripts/ci-release-github-backfill.sh \\" <<<"$create_release" ||
  fail "primary release workflow must use the verified draft uploader"
grep -Fq '"$GITHUB_REPOSITORY"' <<<"$create_release" || fail "primary release publisher repository is not wired"
grep -Fq '"$REF_NAME"' <<<"$create_release" || fail "primary release publisher tag is not wired"
grep -Fq '"packages/coding-agent/binaries"' <<<"$create_release" || fail "primary release asset directory is not wired"
if grep -Fq 'gh release create "$REF_NAME" packages/coding-agent/binaries/*' <<<"$create_release"; then
  fail "primary release workflow must not publish before verifying every asset"
fi
update_homebrew=$(sed -n '/^  update-homebrew:/,/^  verify-homebrew-install:/p' "$ci_workflow")
grep -Fq 'runs-on: macos-14' <<<"$update_homebrew" || fail "Homebrew publisher must run on macOS"
grep -Fq 'environment: release' "$workflow" || fail "backfill must use the release environment"
grep -Fq 'SOURCE_RUN_ID: ${{ inputs.source_run_id }}' "$workflow" || fail "source run input is not wired"
grep -Fq '.event == "push" and .head_branch == $tag and .head_sha == $tag_sha' "$workflow" || fail "tag/run identity validation is missing"
grep -Fq '/attempts/1/jobs?per_page=100' "$workflow" || fail "original attempt validation is missing"
grep -Fq 'jq -e -f scripts/ci-release-source-jobs.jq' "$workflow" || fail "GitHub backfill source-run gate is missing"
grep -Fq 'jq -e -f scripts/ci-release-source-jobs.jq' "$npm_workflow" || fail "npm backfill source-run gate is missing"
grep -Fq 'timeout-minutes: 90' "$npm_workflow" || fail "npm backfill timeout cannot cover registry propagation"
grep -Fq 'release-binaries-linux-win' "$workflow" || fail "Linux/Windows artifacts are missing"
grep -Fq 'release-binaries-macos-*-signed' "$workflow" || fail "signed macOS artifacts are missing"
grep -Fq 'archives-first.sha256' "$workflow" || fail "first deterministic archive pass is missing"
grep -Fq 'archives-second.sha256' "$workflow" || fail "second deterministic archive pass is missing"
grep -Fq 'shasum -a 256' "$workflow" || fail "backfill must use macOS-compatible SHA-256 tooling"
if grep -Fq 'packages/coding-agent/binaries/*.tar.gz' "$workflow"; then
  fail "deterministic macOS archive check must not reference non-produced tarballs"
fi
grep -Fq 'ci-release-github-backfill.sh' "$workflow" || fail "backfill script is not invoked"

expected_count=$(sed -n '/^expected_assets=(/,/^)/p' "$script" | grep -Ec '^  [A-Za-z0-9_.-]+$')
test "$expected_count" -eq 19 || fail "expected release asset set must contain 19 names"
grep -Fq 'xcsh-darwin-arm64.provenance.json' "$script" || fail "arm64 provenance sidecar is required"
grep -Fq 'xcsh-darwin-x64.provenance.json' "$script" || fail "x64 provenance sidecar is required"
if grep -Fq 'xcsh-linux-arm64.tar.gz' "$script" || grep -Fq 'xcsh-linux-x64.tar.gz' "$script"; then
  fail "backfill must not require Linux tarballs that source artifacts do not contain"
fi
grep -Fq '.state == "uploaded" and .size == $size and .digest == $digest' "$script" || fail "resumed assets are not hash verified"
grep -Fq 'for attempt in 1 2 3 4 5' "$script" || fail "upload retries are not bounded"
grep -Fq 'release upload "$tag" "$asset" --repo "$repository" --clobber' "$script" || fail "resumable upload command is missing"
grep -Fq 'diff -u "$work/expected-assets" "$work/actual-assets"' "$script" || fail "exact asset verification is missing"
grep -Fq 'release edit "$tag" --repo "$repository" --draft=false' "$script" || fail "final publication is missing"
grep -Fq '.immutable == true and (.assets | length) == 19' "$script" || fail "immutable final-state verification is missing"
grep -Fq 'file_size()' "$script" || fail "uploader needs portable file-size lookup"
grep -Fq 'stat -f %z' "$script" || fail "uploader must support macOS file-size lookup"
grep -Fq 'file_sha256()' "$script" || fail "uploader needs portable SHA-256 lookup"
grep -Fq 'shasum -a 256' "$script" || fail "uploader must support macOS SHA-256 lookup"
grep -Fq 'cache_bust=$(date +%s)' "$script" || fail "draft resume lookup must bypass stale release-list responses"
grep -Fq 'release=$(gh api --method POST "repos/${repository}/releases"' "$script" || fail "draft creation must retain the API response"
grep -Fq -- '-F draft=true' "$script" || fail "draft creation must remain draft-only before asset upload"

if grep -Fq 'gh release create "$tag" "$assets_dir"/*' "$script"; then
  fail "bulk all-or-nothing release upload returned"
fi
if grep -Fq 'gh release create "$tag"' "$script"; then
  fail "draft creation must not depend on a follow-up release-list read"
fi

valid_jobs=$(mktemp)
extra_jobs=$(mktemp)
failed_jobs=$(mktemp)
trap 'rm -f "$valid_jobs" "$extra_jobs" "$failed_jobs"' EXIT

jq -n '{jobs: [
  {name: "check", conclusion: "success"},
  {name: "test", conclusion: "success"},
  {name: "Test installation methods", conclusion: "success"},
  {name: "Native build (linux, x64, baseline and modern)", conclusion: "success"},
  {name: "Native build (ubuntu-24.04, arm64)", conclusion: "success"},
  {name: "Native build (macos-15-intel, x64)", conclusion: "success"},
  {name: "Native build (macos-15-intel, x64)", conclusion: "success"},
  {name: "Native build (macos-14, arm64)", conclusion: "success"},
  {name: "Native build (windows-latest, x64)", conclusion: "success"},
  {name: "Native build (windows-latest, x64)", conclusion: "success"}
]}' >"$valid_jobs"
jq -e -f "$job_validator" "$valid_jobs" >/dev/null || fail "valid seven-job native matrix was rejected"

jq '.jobs += [{name: "Native build (unexpected, x64)", conclusion: "success"}]' \
  "$valid_jobs" >"$extra_jobs"
if jq -e -f "$job_validator" "$extra_jobs" >/dev/null; then
  fail "unexpected native job was accepted"
fi

jq '(.jobs[] | select(.name == "Native build (ubuntu-24.04, arm64)") | .conclusion) = "failure"' \
  "$valid_jobs" >"$failed_jobs"
if jq -e -f "$job_validator" "$failed_jobs" >/dev/null; then
  fail "failed required native job was accepted"
fi

echo "release GitHub backfill contract passed"
