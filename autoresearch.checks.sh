#!/usr/bin/env bash
# shellcheck disable=SC2154  # provider/specs/xcsh/total/upstream are set via eval
set -euo pipefail

# Cross-repo failure classifier for terraform autoresearch.
#
# Called by the autoresearch framework after autoresearch-terraform.sh passes.
# Reads the benchmark output, parses ASI failure records, and decides:
#   exit 0 = all failures are xcsh-local → autoresearch continues optimizing
#   exit 1 = upstream fix needed → autoresearch stops with triage report
#
# The autoresearch framework passes the run directory as an argument or
# pipes the benchmark output to stdin. The ASI data is in the benchmark
# stdout, which the framework captures in the run's output file.

# Read the benchmark output — framework passes run dir as $1, output is in run.json
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

# Extract ASI cross_repo_issues line
cross_repo=$(echo "${OUTPUT}" | grep "^ASI cross_repo_issues=" | sed 's/^ASI cross_repo_issues=//' || echo "{}")
if [ -z "${cross_repo}" ] || [ "${cross_repo}" = "{}" ]; then
  echo "CHECKS: No ASI cross_repo_issues found in output — passing (no failures to triage)"
  exit 0
fi

# Parse the per-repo issue counts
upstream_issues=$(python3 -c "
import json, sys
data = json.loads(sys.argv[1])
provider = data.get('terraform-provider-f5xc', 0)
specs = data.get('api-specs-enriched', 0)
xcsh = data.get('xcsh', 0)
total = provider + specs + xcsh
print(f'provider={provider}')
print(f'specs={specs}')
print(f'xcsh={xcsh}')
print(f'total={total}')
print(f'upstream={provider + specs}')
" "${cross_repo}")

eval "${upstream_issues}"

if [ "${upstream:-0}" -eq 0 ]; then
  echo "CHECKS: All ${total} failures are xcsh-local — autoresearch can continue optimizing"
  echo "  xcsh: ${xcsh} issues"
  exit 0
fi

# Upstream issues found — print triage report and stop autoresearch
echo ""
echo "============================================"
echo " CROSS-REPO TRIAGE REPORT"
echo "============================================"
echo ""
echo "Upstream fixes required — autoresearch STOPPED"
echo ""
echo "Issues by repository:"
echo "  xcsh:                      ${xcsh} (local — can optimize)"
echo "  terraform-provider-f5xc:   ${provider} (upstream — needs fix)"
echo "  api-specs-enriched:        ${specs} (upstream — needs fix)"
echo ""

# Extract and display the failure details
failures=$(echo "${OUTPUT}" | grep "^ASI failures=" | sed 's/^ASI failures=//' || echo "[]")

if [ "${provider:-0}" -gt 0 ]; then
  echo "--- terraform-provider-f5xc fixes needed ---"
  python3 -c "
import json, sys
failures = json.loads(sys.argv[1])
for f in failures:
    if f.get('fix_repo') == 'terraform-provider-f5xc':
        error_type = f.get('error_type', 'UNKNOWN')
        resource = f.get('expect_resource', 'unknown')
        signal = f.get('error_signal', '')[:120]
        print(f'  [{error_type}] {resource}')
        if error_type == 'UNSUPPORTED_ARGUMENT':
            name = resource.replace('f5xc_', '')
            print(f'    Fix: docs/_llms-txt/resources/{name}.txt — check Required/OneOf field names')
        elif error_type == 'MISSING_ONEOF':
            name = resource.replace('f5xc_', '')
            print(f'    Fix: docs/_llms-txt/resources/{name}.txt — add missing OneOf group')
        if signal:
            print(f'    Signal: {signal}')
" "${failures}"
  echo ""
fi

if [ "${specs:-0}" -gt 0 ]; then
  echo "--- api-specs-enriched fixes needed ---"
  python3 -c "
import json, sys
failures = json.loads(sys.argv[1])
for f in failures:
    if f.get('fix_repo') == 'api-specs-enriched':
        error_type = f.get('error_type', 'UNKNOWN')
        resource = f.get('expect_resource', 'unknown')
        signal = f.get('error_signal', '')[:120]
        print(f'  [{error_type}] {resource}')
        if error_type == 'NAMESPACE_NOT_FOUND':
            print(f'    Fix: config/namespace_profile.yaml — check namespace constraint')
        elif error_type == 'INVALID_MINIMAL_CONFIG':
            print(f'    Fix: config/minimum_configs.yaml — update minimal config for resource')
        if signal:
            print(f'    Signal: {signal}')
" "${failures}"
  echo ""
fi

echo "--- Next steps ---"
echo "1. Fix the upstream issues listed above"
echo "2. Merge upstream changes and wait for CI to regenerate"
if [ "${provider:-0}" -gt 0 ]; then
  echo "3. In terraform-provider-f5xc: go run tools/generate-llms-txt.go && merge"
fi
if [ "${specs:-0}" -gt 0 ]; then
  echo "3. In api-specs-enriched: make pipeline && merge (dispatches to terraform-provider)"
fi
echo "4. In xcsh: bun --cwd=packages/coding-agent run generate-terraform-index"
echo "5. Restart autoresearch"
echo ""

exit 1
