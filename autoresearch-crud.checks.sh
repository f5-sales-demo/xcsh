#!/usr/bin/env bash
# shellcheck disable=SC2154  # provider/specs/xcsh/upstream/total set via python3 below
set -euo pipefail

# Cross-repo gate for CRUD autoresearch.
# exit 0 = all failures are xcsh-local → continue optimizing
# exit 1 = upstream fix needed → stop autoresearch with triage report

if [ -n "${1:-}" ] && [ -d "$1" ]; then
  RUN_DIR="$1"
  if [ -f "${RUN_DIR}/benchmark.log" ]; then
    OUTPUT=$(cat "${RUN_DIR}/benchmark.log")
  elif [ -f "${RUN_DIR}/run.json" ]; then
    OUTPUT=$(python3 -c "import json; d=json.load(open('${RUN_DIR}/run.json')); print(d.get('output',''))" 2>/dev/null || echo "")
  else
    OUTPUT=""
  fi
else
  OUTPUT=$(cat)
fi

cross_repo=$(echo "${OUTPUT}" | grep "^ASI cross_repo_issues=" | sed 's/^ASI cross_repo_issues=//' || echo "{}")
if [ -z "${cross_repo}" ] || [ "${cross_repo}" = "{}" ]; then
  echo "CHECKS: No ASI cross_repo_issues found — passing"
  exit 0
fi

provider=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); v=d.get('terraform-provider-f5xc',0); assert isinstance(v,int); print(v)" "${cross_repo}")
specs=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); v=d.get('api-specs-enriched',0); assert isinstance(v,int); print(v)" "${cross_repo}")
xcsh=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); v=d.get('xcsh',0); assert isinstance(v,int); print(v)" "${cross_repo}")
upstream=$(( provider + specs ))
total=$(( provider + specs + xcsh ))

if [ "${upstream}" -eq 0 ]; then
  echo "CHECKS: All ${total} CRUD failures are xcsh-local — autoresearch can continue"
  echo "  xcsh: ${xcsh} issues"
  exit 0
fi

echo ""
echo "============================================"
echo " CRUD CROSS-REPO TRIAGE REPORT"
echo "============================================"
echo ""
echo "Upstream fixes required — autoresearch STOPPED"
echo ""
echo "Issues by repository:"
echo "  xcsh:                    ${xcsh} (local — can optimize)"
echo "  terraform-provider-f5xc: ${provider} (upstream — needs fix)"
echo "  api-specs-enriched:      ${specs} (upstream — needs fix)"
echo ""

failures=$(echo "${OUTPUT}" | grep "^ASI failures=" | sed 's/^ASI failures=//' || echo "[]")

if [ "${specs}" -gt 0 ]; then
  echo "--- api-specs-enriched fixes needed ---"
  python3 -c "
import json, sys
failures = json.loads(sys.argv[1])
for f in failures:
    if f.get('fix_repo') == 'api-specs-enriched':
        resource = f.get('resource', 'unknown')
        error_type = f.get('error_type', 'UNKNOWN')
        http_code = f.get('http_code', '?')
        print(f'  [{error_type}] {resource} (HTTP {http_code})')
        print(f'    Fix: api-specs-enriched/config/minimum_configs.yaml — check {resource} payload')
" "${failures}"
  echo ""
fi

if [ "${provider}" -gt 0 ]; then
  echo "--- terraform-provider-f5xc fixes needed ---"
  python3 -c "
import json, sys
failures = json.loads(sys.argv[1])
for f in failures:
    if f.get('fix_repo') == 'terraform-provider-f5xc':
        resource = f.get('resource', 'unknown')
        print(f'  {resource}: check docs/_llms-txt/resources/{resource}.txt')
" "${failures}"
  echo ""
fi

echo "--- Next steps ---"
echo "1. Fix the upstream issues listed above"
if [ "${specs}" -gt 0 ]; then
  echo "2. In api-specs-enriched: make pipeline && merge"
fi
if [ "${provider}" -gt 0 ]; then
  echo "2. In terraform-provider-f5xc: go run tools/generate-llms-txt.go && merge"
fi
echo "3. In xcsh: bun --cwd=packages/coding-agent run generate-terraform-index"
echo "4. Restart autoresearch"
echo ""

exit 1
