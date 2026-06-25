#!/usr/bin/env bash
# shellcheck disable=SC2154
set -euo pipefail

# Cross-repo gate for SMSv2 Terraform autoresearch.
# exit 0 = xcsh-only failures OR no failures → autoresearch loop continues
# exit 1 = upstream fix needed → stops autoresearch with triage report

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

provider=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('terraform-provider-xcsh',0))" "${cross_repo}")
specs=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('api-specs-enriched',0))" "${cross_repo}")
xcsh_issues=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('xcsh',0))" "${cross_repo}")
upstream=$((provider + specs))

validate_score=$(echo "${OUTPUT}" | grep "^METRIC smsv2_tf_validate_score=" | sed 's/^METRIC smsv2_tf_validate_score=//' | head -1 || echo "0")
deployment_score=$(echo "${OUTPUT}" | grep "^METRIC smsv2_tf_deployment_score=" | sed 's/^METRIC smsv2_tf_deployment_score=//' | head -1 || echo "skipped")
mesh_score=$(echo "${OUTPUT}" | grep "^METRIC smsv2_tf_mesh_score=" | sed 's/^METRIC smsv2_tf_mesh_score=//' | head -1 || echo "skipped")

deploy_fail=0
[ "${deployment_score}" = "0" ] && deploy_fail=1
[ "${deployment_score}" = "skipped" ] && deploy_fail=0

mesh_fail=0
[ "${mesh_score}" = "0" ] && mesh_fail=1
[ "${mesh_score}" = "skipped" ] && mesh_fail=0

if [ "${upstream}" -eq 0 ] && [ "${deploy_fail}" -eq 0 ] && [ "${mesh_fail}" -eq 0 ]; then
  echo "CHECKS: All SMSv2 Terraform failures are xcsh-local — autoresearch can continue"
  echo "  xcsh: ${xcsh_issues} issues"
  exit 0
fi

echo ""
echo "============================================"
echo " SMSv2 TERRAFORM AUTORESEARCH TRIAGE REPORT"
echo "============================================"
echo ""
echo "Scores: validate=${validate_score}% deployment=${deployment_score} mesh=${mesh_score}"
echo ""

if [ "${provider}" -gt 0 ]; then
  echo "--- terraform-provider-xcsh fixes needed (${provider} issues) ---"
  python3 -c "
import json, sys
failures = json.loads(sys.argv[1])
for f in failures:
    if f.get('fix_repo') == 'terraform-provider-xcsh':
        print(f'  [{f.get(\"error_type\",\"?\")}] {f.get(\"option_field\",\"?\")}')
        print(f'    Signal: {f.get(\"error_signal\",\"?\")[:120]}')
        print(f'    Fix: terraform-provider-xcsh/internal/provider/securemesh_site_v2_resource.go')
" "${failures}"
  echo ""
fi

if [ "${specs}" -gt 0 ]; then
  echo "--- api-specs-enriched fixes needed (${specs} issues) ---"
  python3 -c "
import json, sys
failures = json.loads(sys.argv[1])
for f in failures:
    if f.get('fix_repo') == 'api-specs-enriched':
        print(f'  [{f.get(\"error_type\",\"?\")}] {f.get(\"option_field\",\"?\")}')
        print(f'    Fix: api-specs-enriched/config/minimum_configs.yaml')
" "${failures}"
  echo ""
fi

if [ "${deploy_fail}" -eq 1 ]; then
  echo "--- T2 Terraform CE Deployment FAILED ---"
  echo "  terraform apply did not result in CE reaching ONLINE state."
  echo "  Check: cloud-init template, azurerm VM config, registration approval flow."
  echo ""
fi

if [ "${mesh_fail}" -eq 1 ]; then
  echo "--- T3 Terraform Mesh Connectivity FAILED ---"
  echo "  One or both CEs did not reach ONLINE state."
  echo "  Check: site_mesh_group config, both CE registrations, Azure VNet routing."
  echo ""
fi

echo "--- Next steps ---"
[ "${provider}" -gt 0 ] && echo "1. Fix terraform-provider-xcsh schema → rebuild provider → rerun benchmark"
[ "${specs}" -gt 0 ]    && echo "2. Fix api-specs-enriched → make pipeline && merge"
[ "${deploy_fail}" -eq 1 ] && echo "3. Fix T2 terraform deployment → rerun benchmark"
[ "${mesh_fail}" -eq 1 ]   && echo "4. Fix T3 terraform mesh → rerun benchmark"
echo "5. Restart autoresearch after all fixes"
echo ""

exit 1
