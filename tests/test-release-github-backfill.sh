#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
workflow="$repo_root/.github/workflows/release-github-backfill.yml"
script="$repo_root/scripts/ci-release-github-backfill.sh"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

test -f "$workflow" || fail "backfill workflow is missing"
test -x "$script" || fail "backfill script is not executable"

grep -Fq 'runs-on: xcsh-socketless' "$workflow" || fail "backfill must use the canonical release route"
grep -Fq 'environment: release' "$workflow" || fail "backfill must use the release environment"
grep -Fq 'SOURCE_RUN_ID: ${{ inputs.source_run_id }}' "$workflow" || fail "source run input is not wired"
grep -Fq '.event == "push" and .head_branch == $tag and .head_sha == $tag_sha' "$workflow" || fail "tag/run identity validation is missing"
grep -Fq '/attempts/1/jobs?per_page=100' "$workflow" || fail "original attempt validation is missing"
grep -Fq 'all(.jobs[] | select(.name | startswith("Native build (")); .conclusion == "success")' "$workflow" || fail "native prerequisite gate is missing"
grep -Fq 'release-binaries-linux-win' "$workflow" || fail "Linux/Windows artifacts are missing"
grep -Fq 'release-binaries-macos-*-signed' "$workflow" || fail "signed macOS artifacts are missing"
grep -Fq 'archives-first.sha256' "$workflow" || fail "first deterministic archive pass is missing"
grep -Fq 'archives-second.sha256' "$workflow" || fail "second deterministic archive pass is missing"
grep -Fq 'ci-release-github-backfill.sh' "$workflow" || fail "backfill script is not invoked"

expected_count=$(sed -n '/^expected_assets=(/,/^)/p' "$script" | grep -Ec '^  [A-Za-z0-9_.-]+$')
test "$expected_count" -eq 19 || fail "expected release asset set must contain 19 names"
grep -Fq '.state == "uploaded" and .size == $size and .digest == $digest' "$script" || fail "resumed assets are not hash verified"
grep -Fq 'for attempt in 1 2 3 4 5' "$script" || fail "upload retries are not bounded"
grep -Fq 'release upload "$tag" "$asset" --repo "$repository" --clobber' "$script" || fail "resumable upload command is missing"
grep -Fq 'diff -u "$work/expected-assets" "$work/actual-assets"' "$script" || fail "exact asset verification is missing"
grep -Fq 'release edit "$tag" --repo "$repository" --draft=false' "$script" || fail "final publication is missing"
grep -Fq '.immutable == true and (.assets | length) == 19' "$script" || fail "immutable final-state verification is missing"

if grep -Fq 'gh release create "$tag" "$assets_dir"/*' "$script"; then
  fail "bulk all-or-nothing release upload returned"
fi

echo "release GitHub backfill contract passed"
