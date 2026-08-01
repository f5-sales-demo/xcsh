#!/usr/bin/env bash
# Scan tracked content for PII-shaped values and fail on every enforcement finding.
#
# CI and a local run execute this same script, so the two cannot drift. Scanner output goes to a
# temporary file that is always removed: `.gitignore` is docs-control managed, so this must not
# leave an untracked artifact behind for someone to commit by accident.
#
# Exit 0 = clean, 1 = findings, 2 = the scan or the gate could not run.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "${REPO_ROOT}"

SCOPE="head"

usage() {
  cat <<'EOF'
Usage: bash scripts/pii-gate.sh [--scope staged|head|history]

  --scope staged   verify uncommitted work before a commit (the scanner's `head` scope reads
                   `git ls-tree HEAD` and cannot see it)
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
if [ "${status}" -ne 0 ] && [ "${status}" -ne 1 ]; then
  echo "PII gate error: the scanner could not run; treating as a failure, not as clean." >&2
  exit 2
fi

gate_status=0
python3 - "${FINDINGS}" "${SCOPE}" "${status}" <<'PY' || gate_status=$?
import json
import sys
from pathlib import Path


def fail(message: str) -> None:
    print(f"PII gate error: {message}", file=sys.stderr)
    raise SystemExit(2)


def escape_data(value: str) -> str:
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def escape_property(value: str) -> str:
    return escape_data(value).replace(":", "%3A").replace(",", "%2C")


findings_path = Path(sys.argv[1])
expected_scope = sys.argv[2]
scanner_status = int(sys.argv[3])

try:
    raw = findings_path.read_text(encoding="utf-8")
    if not raw.strip():
        fail("the scanner returned no output")
    document = json.loads(raw)
except (OSError, json.JSONDecodeError) as error:
    fail(f"cannot read scanner output: {error}")

if not isinstance(document, dict):
    fail("scanner output is not a JSON object")
if document.get("scope") != expected_scope:
    fail("scanner output reported an unexpected scope")
if document.get("mode") != "enforce":
    fail("scanner output reported an unexpected mode")

findings = document.get("findings")
if not isinstance(findings, list):
    fail("scanner output has no findings array")
if scanner_status != (1 if findings else 0):
    fail("scanner exit status disagrees with its findings")

validated = []
for finding in findings:
    if not isinstance(finding, dict):
        fail("scanner output contains an invalid finding")
    path = finding.get("path")
    category = finding.get("category")
    line = finding.get("line")
    if not isinstance(path, str) or not path:
        fail("scanner output contains a finding without a path")
    if not isinstance(category, str) or not category:
        fail("scanner output contains a finding without a category")
    if isinstance(line, bool) or not isinstance(line, int) or line < 0:
        fail("scanner output contains a finding with an invalid line")
    validated.append((path, category, max(line, 1)))

if not validated:
    print(f"PII gate: clean ({expected_scope} scope).")
    raise SystemExit(0)

for path, category, line in validated:
    print(
        f"::error file={escape_property(path)},line={line}::"
        f"[{escape_data(category)}] PII-shaped value detected"
    )
print(f"::error::PII gate found {len(validated)} enforcement finding(s).")
print("Fix each finding at its source using the synthetic forms in STYLE_GUIDE.md.")
print("If a finding is a scanner false positive, raise it with docs-control; do not suppress it.")
raise SystemExit(1)
PY

exit "${gate_status}"
