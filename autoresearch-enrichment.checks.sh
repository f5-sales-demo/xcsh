#!/usr/bin/env bash
# shellcheck disable=SC2154  # provider/specs/xcsh set via python3 below
set -euo pipefail

# Cross-repo gate for enrichment autoresearch.
# exit 0 = all issues are xcsh-local → continue
# exit 1 = upstream fix needed → stop with triage

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

provider=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); v=d.get('terraform-provider-xcsh',0); assert isinstance(v,int); print(v)" "${cross_repo}")
specs=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); v=d.get('api-specs-enriched',0); assert isinstance(v,int); print(v)" "${cross_repo}")
xcsh=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); v=d.get('xcsh',0); assert isinstance(v,int); print(v)" "${cross_repo}")
upstream=$(( provider + specs ))
total=$(( provider + specs + xcsh ))

if [ "${upstream}" -eq 0 ]; then
  echo "CHECKS: All ${total} enrichment issues are xcsh-local — continue"
  exit 0
fi

echo ""
echo "============================================"
echo " ENRICHMENT CROSS-REPO TRIAGE REPORT"
echo "============================================"
echo ""
echo "Upstream fixes required — autoresearch STOPPED"
echo ""
echo "Issues by repository:"
echo "  xcsh:                    ${xcsh} (local)"
echo "  terraform-provider-xcsh: ${provider} (upstream)"
echo "  api-specs-enriched:      ${specs} (upstream)"
echo ""

mismatches=$(echo "${OUTPUT}" | grep "^ASI mismatches=" | sed 's/^ASI mismatches=//' || echo "[]")

if [ "${provider}" -gt 0 ]; then
  echo "--- terraform-provider-xcsh fixes needed ---"
  python3 -c "
import json, sys
mismatches = json.loads(sys.argv[1])
for m in mismatches:
    if m.get('fix_repo') == 'terraform-provider-xcsh':
        resource = m.get('resource','?')
        issue = m.get('issue','?')
        probed = m.get('probed','?')
        embedded = m.get('embedded','?')
        print(f'  [{issue}] {resource}')
        print(f'    Probed: {probed}')
        print(f'    Embedded: {embedded}')
        if 'oneof' in issue:
            print(f'    Fix: terraform-provider-xcsh/tools/generate-llms-txt.go — check OneOf extraction for {resource}')
        else:
            print(f'    Fix: terraform-provider-xcsh/docs/_llms-txt/resources/{resource}.txt')
" "${mismatches}"
  echo ""
fi

if [ "${specs}" -gt 0 ]; then
  echo "--- api-specs-enriched fixes needed ---"
  python3 -c "
import json, sys
mismatches = json.loads(sys.argv[1])
for m in mismatches:
    if m.get('fix_repo') == 'api-specs-enriched':
        resource = m.get('resource','?')
        issue = m.get('issue','?')
        print(f'  [{issue}] {resource}')
        print(f'    Fix: api-specs-enriched/config/constraint_patterns.yaml or validation_schema.yaml')
" "${mismatches}"
  echo ""
fi

echo "--- Next steps ---"
if [ "${specs}" -gt 0 ]; then
  echo "1. Fix api-specs-enriched/config/ files, then: make pipeline && merge"
fi
if [ "${provider}" -gt 0 ]; then
  echo "1. Fix terraform-provider-xcsh/tools/generate-llms-txt.go, then: go run tools/generate-llms-txt.go && merge"
fi
echo "2. In xcsh: bun --cwd=packages/coding-agent run generate-terraform-index"
echo "3. Restart autoresearch"
echo ""

exit 1
