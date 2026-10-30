#!/usr/bin/env bash
# Qualify one complete prerequisite attempt; never merge or deduplicate matrix jobs.
set -euo pipefail

repository=${1:?repository required}
source_run_id=${2:?source run required}
last_attempt=${3:?last attempt required}
[[ "$source_run_id" =~ ^[0-9]+$ && "$last_attempt" =~ ^[1-9][0-9]*$ ]] || {
  echo 'Invalid source run or attempt' >&2
  exit 1
}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

# Later attempts can repair uploads. Signing-only retries can use an earlier
# complete qualification from this same immutable run, never a mixture of jobs.
for ((attempt = last_attempt; attempt >= 1; attempt--)); do
  pages=$(gh api "repos/${repository}/actions/runs/${source_run_id}/attempts/${attempt}/jobs?per_page=100" --paginate --slurp)
  jobs=$(jq -e '{jobs: [.[].jobs[]]}' <<<"$pages")
  if jq -e -f "$script_dir/ci-release-source-jobs.jq" <<<"$jobs" >/dev/null; then
    echo "Qualified source run ${source_run_id} attempt ${attempt}"
    exit 0
  fi
done

echo 'Source run lacks a complete successful prerequisite attempt' >&2
exit 1
