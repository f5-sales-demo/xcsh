#!/usr/bin/env bash
# autoresearch-http-lb-advertise.checks.sh
# Cross-repo gate: exit 0 if all issues are xcsh-local, exit 1 if upstream fixes needed
set -euo pipefail

LOG="${1:-}"
if [ -z "${LOG}" ]; then
  echo "Usage: bash autoresearch-http-lb-advertise.checks.sh <benchmark-log>" >&2
  exit 2
fi

spec_issues=$(grep "ASI cross_repo_issues=" "${LOG}" 2>/dev/null | tail -1 | python3 -c "
import json,sys,re
line=sys.stdin.read()
m=re.search(r'cross_repo_issues=(\{.*\})',line)
if m:
    d=json.loads(m.group(1))
    print(d.get('api-specs-enriched',0))
else:
    print(0)
" 2>/dev/null || echo 0)

if [ "${spec_issues}" -gt 0 ]; then
  echo "GATE FAIL: ${spec_issues} api-specs-enriched issues — fix upstream before merging xcsh PR"
  exit 1
fi

echo "GATE PASS: all issues are xcsh-local"
exit 0
