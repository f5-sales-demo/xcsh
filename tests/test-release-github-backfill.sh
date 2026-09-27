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
grep -Fq 'npm dist-tag add "@f5-sales-demo/xcsh@${VERSION}" backfill' "$npm_workflow" ||
  fail "npm backfill must mark the verified immutable version"
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
grep -Fq 'XCSH_RELEASE_UPLOAD_CONCURRENCY' "$script" || fail "upload concurrency control is missing"
grep -Fq '^[1-4]$' "$script" || fail "upload concurrency must be bounded from one through four"
grep -Fq 'upload_asset "$name" &' "$script" || fail "independent uploads must use background workers"
grep -Fq 'if [ "${#pids[@]}" -ge "$upload_concurrency" ]; then' "$script" || fail "upload worker pool is not bounded"
grep -Fq 'wait_for_uploads' "$script" || fail "upload workers are not joined before publication"
grep -Fq 'Release upload failed; preserving draft release $tag' "$script" || fail "worker failures must preserve the draft release"
grep -Fq 'Release upload complete: uploaded=' "$script" || fail "upload timing report is missing"
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

invalid_concurrency_assets=$(mktemp -d)
if XCSH_RELEASE_UPLOAD_CONCURRENCY=5 "$script" f5-sales-demo/xcsh v1.2.3 "$invalid_concurrency_assets" >/dev/null 2>&1; then
  fail "out-of-range upload concurrency was accepted"
fi
if XCSH_RELEASE_UPLOAD_CONCURRENCY=parallel "$script" f5-sales-demo/xcsh v1.2.3 "$invalid_concurrency_assets" >/dev/null 2>&1; then
  fail "non-numeric upload concurrency was accepted"
fi

behavior_root=$(mktemp -d)
fake_bin="$behavior_root/bin"
behavior_assets="$behavior_root/assets"
valid_jobs=
extra_jobs=
failed_jobs=
failed_split_jobs=
cleanup() {
  rm -rf "$behavior_root" "$invalid_concurrency_assets"
  for file in "$valid_jobs" "$extra_jobs" "$failed_jobs" "$failed_split_jobs"; do
    if [ -n "$file" ]; then
      rm -f "$file"
    fi
  done
}
trap cleanup EXIT
mkdir -p "$fake_bin" "$behavior_assets"
sed -n '/^expected_assets=(/,/^)/p' "$script" |
  sed -n 's/^  \([A-Za-z0-9_.-][A-Za-z0-9_.-]*\)$/\1/p' |
  while IFS= read -r name; do
    printf 'fixture payload for %s\n' "$name" >"$behavior_assets/$name"
  done

cat >"$fake_bin/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$fake_bin/sleep"

cat >"$fake_bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

state=${FAKE_GH_STATE:?}
assets_dir=${FAKE_ASSETS_DIR:?}
scenario=${FAKE_GH_SCENARIO:-success}
tag=${FAKE_GH_TAG:-v1.2.3}

file_size() {
  if stat -f %z "$1" >/dev/null 2>&1; then
    stat -f %z "$1"
  else
    stat -c %s "$1"
  fi
}

file_sha256() {
  shasum -a 256 "$1" | awk '{print $1}'
}

lock_state() {
  while ! mkdir "$state/lock" 2>/dev/null; do
    /bin/sleep 0.002
  done
}

unlock_state() {
  rmdir "$state/lock"
}

asset_json() {
  local file=$1
  local name=${file##*/}
  local digest="sha256:$(file_sha256 "$file")"
  if [ "$scenario" = "final-mismatch" ] && [ "$name" = "pi_natives.darwin-arm64.node" ]; then
    digest="sha256:$(printf '0%.0s' {1..64})"
  fi
  jq -cn \
    --arg name "$name" \
    --argjson size "$(file_size "$file")" \
    --arg digest "$digest" \
    '{name: $name, state: "uploaded", size: $size, digest: $digest}'
}

release_json() {
  local published=false
  local release_assets
  if [ -f "$state/published" ]; then
    published=true
  fi
  release_assets=$(
    for file in "$assets_dir"/*; do
      asset_json "$file"
    done | jq -s '.'
  )
  jq -cn \
    --arg tag "$tag" \
    --argjson published "$published" \
    --argjson assets "$release_assets" \
    '{id: 101, tag_name: $tag, draft: ($published | not), prerelease: false, immutable: $published, assets: $assets}'
}

initial_release_list() {
  case "$scenario" in
    resume | resume-mismatch)
      local file="$assets_dir/pi_natives.darwin-arm64.node"
      local digest="sha256:$(file_sha256 "$file")"
      if [ "$scenario" = "resume-mismatch" ]; then
        digest="sha256:$(printf 'f%.0s' {1..64})"
      fi
      jq -cn \
        --arg tag "$tag" \
        --argjson size "$(file_size "$file")" \
        --arg digest "$digest" \
        '[{id: 101, tag_name: $tag, draft: true, prerelease: false, immutable: false, assets: [{name: "pi_natives.darwin-arm64.node", state: "uploaded", size: $size, digest: $digest}]}]'
      ;;
    *)
      printf '[]\n'
      ;;
  esac
}

begin_upload() {
  local name=$1
  local attempts_file="$state/attempts-$name"
  local attempts=0
  local active
  local maximum
  lock_state
  if [ -f "$attempts_file" ]; then
    attempts=$(<"$attempts_file")
  fi
  attempts=$((attempts + 1))
  printf '%s\n' "$attempts" >"$attempts_file"
  active=$(<"$state/active")
  maximum=$(<"$state/maximum")
  active=$((active + 1))
  if [ "$active" -gt "$maximum" ]; then
    maximum=$active
  fi
  printf '%s\n' "$active" >"$state/active"
  printf '%s\n' "$maximum" >"$state/maximum"
  printf 'upload-start\t%s\t%s\n' "$name" "$attempts" >>"$state/events"
  unlock_state
  printf '%s\n' "$attempts"
}

finish_upload() {
  local name=$1
  local result=$2
  local active
  lock_state
  active=$(<"$state/active")
  printf '%s\n' "$((active - 1))" >"$state/active"
  printf 'upload-end\t%s\t%s\n' "$name" "$result" >>"$state/events"
  unlock_state
}

if [ "$1" = "api" ]; then
  if [ "${2:-}" = "--method" ]; then
    printf 'create-draft\n' >>"$state/events"
    jq -cn --arg tag "$tag" \
      '{id: 101, tag_name: $tag, draft: true, prerelease: false, immutable: false, assets: []}'
  elif [[ "${2:-}" == */immutable-releases ]]; then
    printf '{"enabled":true}\n'
  elif [[ "${2:-}" == *'/releases?'* ]]; then
    initial_release_list
  elif [[ "${2:-}" == */releases/101 ]]; then
    printf 'inventory-read\n' >>"$state/events"
    release_json
  else
    echo "unexpected gh api invocation: $*" >&2
    exit 64
  fi
elif [ "$1" = "release" ] && [ "${2:-}" = "upload" ]; then
  name=${4##*/}
  attempt=$(begin_upload "$name")
  if [ -n "${FAKE_EXPECTED_CONCURRENCY:-}" ]; then
    for _ in {1..500}; do
      if [ "$(<"$state/maximum")" -ge "$FAKE_EXPECTED_CONCURRENCY" ]; then
        break
      fi
      /bin/sleep 0.002
    done
  fi
  /bin/sleep 0.01
  if [ "$scenario" = "permanent" ] && [ "$name" = "pi_natives.darwin-arm64.node" ]; then
    finish_upload "$name" failure
    exit 1
  fi
  if [ "$scenario" = "transient" ] && [ "$name" = "pi_natives.darwin-arm64.node" ] && [ "$attempt" -eq 1 ]; then
    finish_upload "$name" failure
    exit 1
  fi
  finish_upload "$name" success
elif [ "$1" = "release" ] && [ "${2:-}" = "edit" ]; then
  printf 'publish\n' >>"$state/events"
  : >"$state/published"
else
  echo "unexpected gh invocation: $*" >&2
  exit 64
fi
EOF
chmod +x "$fake_bin/gh"

run_uploader_case() {
  local case_name=$1
  local scenario=$2
  local concurrency=$3
  local expected_concurrency=$4
  local state="$behavior_root/$case_name"
  mkdir -p "$state"
  printf '0\n' >"$state/active"
  printf '0\n' >"$state/maximum"
  : >"$state/events"

  if [ "$concurrency" = default ]; then
    env -u XCSH_RELEASE_UPLOAD_CONCURRENCY \
      PATH="$fake_bin:$PATH" \
      FAKE_GH_STATE="$state" \
      FAKE_ASSETS_DIR="$behavior_assets" \
      FAKE_GH_SCENARIO="$scenario" \
      FAKE_EXPECTED_CONCURRENCY="$expected_concurrency" \
      "$script" f5-sales-demo/xcsh v1.2.3 "$behavior_assets" >"$state/output" 2>&1
  else
    PATH="$fake_bin:$PATH" \
      FAKE_GH_STATE="$state" \
      FAKE_ASSETS_DIR="$behavior_assets" \
      FAKE_GH_SCENARIO="$scenario" \
      FAKE_EXPECTED_CONCURRENCY="$expected_concurrency" \
      XCSH_RELEASE_UPLOAD_CONCURRENCY="$concurrency" \
      "$script" f5-sales-demo/xcsh v1.2.3 "$behavior_assets" >"$state/output" 2>&1
  fi
}

run_uploader_case default-concurrency success default 4 || fail "default-concurrency upload failed"
test "$(<"$behavior_root/default-concurrency/maximum")" -eq 4 || fail "default upload concurrency was not four"
test -f "$behavior_root/default-concurrency/published" || fail "verified default upload was not published"
test "$(grep -c '^upload-end' "$behavior_root/default-concurrency/events")" -eq 19 ||
  fail "publication did not wait for every upload worker"
inventory_line=$(grep -n '^inventory-read$' "$behavior_root/default-concurrency/events" | head -1 | cut -d: -f1)
publish_line=$(grep -n '^publish$' "$behavior_root/default-concurrency/events" | cut -d: -f1)
test "$inventory_line" -lt "$publish_line" || fail "release was published before final inventory verification"

run_uploader_case explicit-concurrency success 2 2 || fail "explicit-concurrency upload failed"
test "$(<"$behavior_root/explicit-concurrency/maximum")" -eq 2 || fail "explicit upload concurrency was not honored"

run_uploader_case transient-retry transient 4 0 || fail "transient upload failure did not recover"
test "$(<"$behavior_root/transient-retry/attempts-pi_natives.darwin-arm64.node")" -eq 2 ||
  fail "transient upload was not retried exactly once"
test -f "$behavior_root/transient-retry/published" || fail "release was not published after transient recovery"

if run_uploader_case permanent-failure permanent 4 0; then
  fail "permanent worker failure unexpectedly published"
fi
test "$(<"$behavior_root/permanent-failure/attempts-pi_natives.darwin-arm64.node")" -eq 5 ||
  fail "permanent upload failure did not exhaust five attempts"
test ! -f "$behavior_root/permanent-failure/published" || fail "permanent worker failure did not preserve the draft"
grep -Fq 'Release upload failed; preserving draft release v1.2.3' "$behavior_root/permanent-failure/output" ||
  fail "permanent worker failure did not report draft preservation"

run_uploader_case verified-resume resume 4 0 || fail "verified existing-asset resume failed"
test ! -e "$behavior_root/verified-resume/attempts-pi_natives.darwin-arm64.node" ||
  fail "verified existing asset was uploaded again"
grep -Fq 'Already verified: pi_natives.darwin-arm64.node' "$behavior_root/verified-resume/output" ||
  fail "verified existing asset was not reported as resumed"

run_uploader_case mismatched-resume resume-mismatch 4 0 || fail "mismatched existing-asset replacement failed"
test "$(<"$behavior_root/mismatched-resume/attempts-pi_natives.darwin-arm64.node")" -eq 1 ||
  fail "mismatched existing asset was incorrectly resumed"

if run_uploader_case digest-mismatch final-mismatch 4 0; then
  fail "release published despite a final digest mismatch"
fi
test ! -f "$behavior_root/digest-mismatch/published" || fail "digest mismatch did not preserve the draft"
grep -Fq 'inventory-read' "$behavior_root/digest-mismatch/events" || fail "final inventory was not queried"

valid_jobs=$(mktemp)
extra_jobs=$(mktemp)
failed_jobs=$(mktemp)
failed_split_jobs=$(mktemp)

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

jq '(.jobs[] | select(.name == "Native build (linux, x64, modern)") | .conclusion) = "failure"' \
  "$valid_jobs" >"$failed_split_jobs"
if jq -e -f "$job_validator" "$failed_split_jobs" >/dev/null; then
  fail "failed split Linux native job was accepted"
fi

echo "release GitHub backfill contract passed"
