#!/usr/bin/env bash
# Cross-repo gate: exit 0 if all issues are xcsh-local, exit 1 if upstream fixes needed
set -euo pipefail

LOG="${1:-}"
if [ -z "${LOG}" ]; then
  echo "Usage: bash autoresearch-smsv2-terraform-mesh-import.checks.sh <benchmark-log>" >&2
  exit 2
fi

provider_issues=$(grep "ASI t4_failures=" "${LOG}" 2>/dev/null | tail -1 | python3 -c "
import json,sys,re
line=sys.stdin.read()
m=re.search(r't4_failures=(\[.*?\])', line, re.DOTALL)
if m:
    d=json.loads(m.group(1))
    print(sum(1 for f in d if f.get('fix_repo')=='terraform-provider-xcsh'))
else:
    print(0)
" 2>/dev/null || echo 0)

if [ "${provider_issues}" -gt 0 ]; then
  echo "GATE FAIL: ${provider_issues} terraform-provider-xcsh import drift issues — fix provider Read functions first"
  exit 1
fi

echo "GATE PASS: all issues are xcsh-local"
exit 0
