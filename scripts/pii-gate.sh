#!/usr/bin/env bash
# Scan tracked content for PII-shaped values and fail only if findings grew over the baseline.
#
# CI and a local run execute this same script, so the two cannot drift. Scanner output goes to a
# temporary file that is always removed: `.gitignore` is docs-control managed, so this must not
# leave an untracked artifact behind for someone to commit by accident.
#
# Exit 0 = no growth, 1 = growth, 2 = the scan or the gate could not run.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "${REPO_ROOT}"

SCOPE="head"
BASELINE=".github/pii-baseline.json"
UPDATE=""

usage() {
  cat <<'EOF'
Usage: bash scripts/pii-gate.sh [--scope staged|head|history] [--baseline PATH] [--update]

  --scope staged   verify uncommitted work before a commit (the scanner's `head` scope reads
                   `git ls-tree HEAD` and cannot see it)
  --update         rewrite the baseline from the current findings, to lower it after a fix
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
  --scope)
    [ "$#" -ge 2 ] || {
      usage >&2
      exit 2
    }
    SCOPE=$2
    shift 2
    ;;
  --baseline)
    [ "$#" -ge 2 ] || {
      usage >&2
      exit 2
    }
    BASELINE=$2
    shift 2
    ;;
  --update)
    UPDATE="--update"
    shift
    ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    echo "PII gate error: unknown argument: $1" >&2
    usage >&2
    exit 2
    ;;
  esac
done

FINDINGS=$(mktemp)
trap 'rm -f "${FINDINGS}"' EXIT

status=0
bash scripts/check-pii.sh --scope "${SCOPE}" --mode enforce --format json >"${FINDINGS}" || status=$?
if [ "${status}" -eq 2 ]; then
  echo "PII gate error: the scanner could not run; treating as a failure, not as clean." >&2
  exit 2
fi

python3 scripts/pii-baseline-gate.py --findings "${FINDINGS}" --baseline "${BASELINE}" ${UPDATE:+"${UPDATE}"}
