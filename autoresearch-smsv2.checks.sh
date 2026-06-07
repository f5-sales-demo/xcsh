#!/usr/bin/env bash
# shellcheck disable=SC2154
set -euo pipefail

# Cross-repo gate for SMSv2 autoresearch.
# Reads benchmark output from stdin or RUN_DIR/benchmark.log.
# exit 0 = no upstream issues (xcsh-only failures or no failures) → autoresearch loop continues
# exit 1 = upstream fix needed → autoresearch stops with triage report

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
failures=$(echo "${OUTPUT}" | grep "^ASI failures=" | sed 's/^ASI failures=//' || echo "[]")

if [ -z "${cross_repo}" ] || [ "${cross_repo}" = "{}" ]; then
  echo "CHECKS: No ASI cross_repo_issues found — passing"
  exit 0
fi

specs=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('api-specs-enriched',0))" "${cross_repo}")
xcsh_issues=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('xcsh',0))" "${cross_repo}")

payload_score=$(echo "${OUTPUT}" | grep "^METRIC smsv2_payload_score=" | sed 's/^METRIC smsv2_payload_score=//' | head -1 || echo "0")
deployment_score=$(echo "${OUTPUT}" | grep "^METRIC smsv2_deployment_score=" | sed 's/^METRIC smsv2_deployment_score=//' | head -1 || echo "0")
mesh_score=$(echo "${OUTPUT}" | grep "^METRIC smsv2_mesh_score=" | sed 's/^METRIC smsv2_mesh_score=//' | head -1 || echo "0")

deploy_fail=0
[ "${deployment_score}" = "0" ] && deploy_fail=1
[ "${deployment_score}" = "skipped" ] && deploy_fail=0

mesh_fail=0
[ "${mesh_score}" = "0" ] && mesh_fail=1
[ "${mesh_score}" = "skipped" ] && mesh_fail=0

if [ "${specs}" -eq 0 ] && [ "${deploy_fail}" -eq 0 ] && [ "${mesh_fail}" -eq 0 ]; then
  echo "CHECKS: All SMSv2 failures are xcsh-local — autoresearch can continue"
  echo "  xcsh: ${xcsh_issues} issues"
  exit 0
fi

echo ""
echo "============================================"
echo " SMSv2 AUTORESEARCH TRIAGE REPORT"
echo "============================================"
echo ""
echo "Scores: payload=${payload_score}% deployment=${deployment_score} mesh=${mesh_score}"
echo ""

if [ "${specs}" -gt 0 ]; then
  echo "--- api-specs-enriched fixes needed (${specs} issues) ---"
  python3 -c "
import json, sys
failures = json.loads(sys.argv[1])
for f in failures:
    if f.get('fix_repo') == 'api-specs-enriched':
        print(f'  [{f.get(\"error_type\",\"?\")}] {f.get(\"option_field\",\"?\")} (HTTP {f.get(\"http_code\",\"?\")})')
        print(f'    Fix: api-specs-enriched/config/minimum_configs.yaml — check securemesh_site_v2 option_{f.get(\"option_field\",\"?\")} payload')
" "${failures}"
  echo ""
fi

if [ "${deploy_fail}" -eq 1 ]; then
  echo "--- T2 CE Deployment FAILED ---"
  echo "  The Azure CE did not reach ONLINE state within the timeout."
  echo "  Actions: check cloud-init config, VPM logs, registration approval flow."
  echo "  Reference: xcsh/autoresearch-smsv2.sh run_t2 function"
  echo ""
fi

if [ "${mesh_fail}" -eq 1 ]; then
  echo "--- T3 Mesh Connectivity FAILED ---"
  echo "  One or both CEs did not reach ONLINE state within the timeout."
  echo "  Actions: check site_mesh_group config, both CE registrations, Azure VNet routing."
  echo "  Reference: xcsh/autoresearch-smsv2.sh run_t3 function"
  echo ""
fi

echo "--- Next steps ---"
[ "${specs}" -gt 0 ]    && echo "1. Fix api-specs-enriched gaps → make pipeline && merge"
[ "${deploy_fail}" -eq 1 ] && echo "2. Fix T2 deployment issue → rerun autoresearch-smsv2.sh"
[ "${mesh_fail}" -eq 1 ]   && echo "3. Fix T3 mesh issue → rerun autoresearch-smsv2.sh"
echo "4. Restart autoresearch after all fixes"
echo ""

exit 1
