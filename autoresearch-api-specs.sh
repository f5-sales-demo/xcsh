#!/usr/bin/env bash
set -euo pipefail

# API-Specs Enriched Autoresearch Benchmark
# Measures accuracy of api-specs-enriched config files against live F5 XC API.
# Emits two scores:
#   curl_validity_score  — % resources whose minimum_configs.yaml curl examples pass CRUD
#   spec_accuracy_score  — % constraint checks that match constraint_patterns.yaml / discovered_defaults.yaml

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_SPECS_DIR="${SCRIPT_DIR}/../api-specs-enriched"
WORK_DIR="/tmp/ar-api-specs-$$"
NAMESPACE="${XCSH_NAMESPACE:-r-mordasiewicz}"
DRY_RUN="${DRY_RUN:-false}"

if [ -z "${XCSH_API_URL:-}" ] || [ -z "${XCSH_API_TOKEN:-}" ]; then
  echo "ERROR: XCSH_API_URL and XCSH_API_TOKEN must be set" >&2
  exit 1
fi

if [ ! -f "${API_SPECS_DIR}/config/minimum_configs.yaml" ]; then
  echo "ERROR: api-specs-enriched not found at ${API_SPECS_DIR}" >&2
  exit 1
fi

cleanup() { rm -rf "${WORK_DIR}"; }
trap cleanup EXIT
mkdir -p "${WORK_DIR}"

# Discover curl-test resources: all top-level keys under resources: in minimum_configs.yaml
curl_resources=$(python3 -c "
import yaml
with open('${API_SPECS_DIR}/config/minimum_configs.yaml') as f:
    data = yaml.safe_load(f)
print(' '.join(data.get('resources', {}).keys()))
")

# Discover constraint-probe resources: RESOURCE_ENDPOINTS from constraint_prober.py
probe_resources=$(python3 -c "
import sys
sys.path.insert(0, '${API_SPECS_DIR}')
from scripts.discovery.constraint_prober import RESOURCE_ENDPOINTS
print(' '.join(RESOURCE_ENDPOINTS.keys()))
" 2>/dev/null || echo "healthcheck origin_pool http_loadbalancer tcp_loadbalancer app_firewall service_policy")

echo "API-Specs Enriched Autoresearch Benchmark"
echo "Curl resources ($(echo "${curl_resources}" | wc -w | tr -d ' ')): ${curl_resources}"
echo "Probe resources ($(echo "${probe_resources}" | wc -w | tr -d ' ')): ${probe_resources}"
echo ""

# ── curl_validity_score ─────────────────────────────────────────────────────
echo "Running curl validity tests..."

# Use api-specs-enriched venv python if available (has rich and all deps)
APISPECS_PYTHON="${API_SPECS_DIR}/.venv/bin/python"
[ -x "${APISPECS_PYTHON}" ] || APISPECS_PYTHON="python3"

curl_total=0
curl_pass=0
gaps_json="[]"

# Resources that must be created in system namespace (not user namespace)
SYSTEM_NS_RESOURCES="k8s_cluster network_firewall fast_acl securemesh_site_v2"

for resource in ${curl_resources}; do
  # Skip resources flagged skip_curl_test in minimum_configs.yaml (require infra not available in CI)
  # Pass args via sys.argv — never interpolate resource name into Python source string
  skip_flag=$(python3 - "${resource}" "${API_SPECS_DIR}/config/minimum_configs.yaml" <<'PYEOF' 2>/dev/null || echo "False"
import yaml, sys
resource_name = sys.argv[1]
config_path = sys.argv[2]
with open(config_path) as f:
    mc = yaml.safe_load(f)
print(str(mc.get('resources', {}).get(resource_name, {}).get('skip_curl_test', False)))
PYEOF
)
  if [ "${skip_flag}" = "True" ]; then
    echo "  SKIP: ${resource} (skip_curl_test=true — requires infra)"
    continue
  fi

  curl_total=$((curl_total + 1))
  output_base="${WORK_DIR}/${resource}_curl"

  dry_flag=""
  [ "${DRY_RUN}" = "true" ] && dry_flag="--dry-run"

  # Use system namespace for system-scoped resources
  resource_ns="${NAMESPACE}"
  echo "${SYSTEM_NS_RESOURCES}" | grep -qw "${resource}" && resource_ns="system"

  (cd "${API_SPECS_DIR}" && \
    XCSH_API_URL="${XCSH_API_URL}" \
    XCSH_API_TOKEN="${XCSH_API_TOKEN}" \
    "${APISPECS_PYTHON}" scripts/validate_curl_examples.py \
      --resource "${resource}" \
      --namespace "${resource_ns}" \
      --output "${output_base}" \
      ${dry_flag} \
      2>/dev/null || true)

  report_file="${output_base}.json"
  resource_pass=0
  resource_skip=0
  fail_desc="no_report"

  if [ -f "${report_file}" ]; then
    result=$(python3 -c "
import json, sys
report = json.load(open(sys.argv[1]))
resource = sys.argv[2]
for r in report.get('results', []):
    if r.get('full_success'):
        print('PASS')
    else:
        ops = r.get('operations', {})
        for op_name, op in ops.items():
            if not op.get('success', True):
                code = op.get('status_code', 0)
                err = (op.get('error') or '')[:80]
                print(f'FAIL:{op_name}:{code}:{err}')
                break
        else:
            print('FAIL:unknown:0:')
    break
else:
    print('SKIP')
" "${report_file}" "${resource}" 2>/dev/null || echo "SKIP")

    if [ "${result}" = "PASS" ]; then
      resource_pass=1
      echo "  PASS: ${resource}"
    elif [ "${result}" = "SKIP" ]; then
      echo "  SKIP: ${resource} (not in report)"
      curl_total=$((curl_total - 1))
      resource_skip=1
    else
      fail_desc="${result}"
      echo "  FAIL: ${resource} (${result})"
    fi
  else
    echo "  FAIL: ${resource} (validate_curl_examples.py produced no report)"
  fi

  curl_pass=$((curl_pass + resource_pass))

  if [ "${resource_pass}" -eq 0 ] && [ "${resource_skip}" -eq 0 ]; then
    desc_json=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "${fail_desc}")
    gaps_json=$(python3 -c "
import json, sys
gaps = json.loads(sys.argv[1])
gaps.append({
    'resource': '${resource}',
    'gap_type': 'curl_example_fails',
    'fix_file': 'config/minimum_configs.yaml',
    'description': json.loads(sys.argv[2]),
    'fix_repo': 'api-specs-enriched',
    'probed': 'failed',
    'expected': 'success',
})
print(json.dumps(gaps))
" "${gaps_json}" "${desc_json}")
  fi
done
echo ""

# ── spec_accuracy_score ──────────────────────────────────────────────────────
echo "Running spec accuracy probes..."

# Use api-specs-enriched venv python for constraint_prober.py (has httpx and all deps)

spec_total=0
spec_pass=0

for resource in ${probe_resources}; do
  prober_output="${WORK_DIR}/${resource}_probe.json"

  dry_flag=""
  [ "${DRY_RUN}" = "true" ] && dry_flag="--dry-run"

  (cd "${API_SPECS_DIR}" && \
    XCSH_API_URL="${XCSH_API_URL}" \
    XCSH_API_TOKEN="${XCSH_API_TOKEN}" \
    XCSH_NAMESPACE="${NAMESPACE}" \
    "${APISPECS_PYTHON}" -W ignore -m scripts.discovery.constraint_prober \
      --resource "${resource}" \
      --output "${prober_output}" \
      --rate 3.0 \
      ${dry_flag} 2>&1 | grep -v "^INFO:httpx" || true)

  [ -f "${prober_output}" ] || \
    echo '{"fields":[],"server_default_fields":{}}' > "${prober_output}"

  result=$(python3 -c "
import json, yaml, re, sys

resource = sys.argv[1]
prober_path = sys.argv[2]
api_specs_dir = sys.argv[3]

probed = json.load(open(prober_path))
fields = probed.get('fields', [])
server_defaults = probed.get('server_default_fields', {})

with open(f'{api_specs_dir}/config/constraint_patterns.yaml') as f:
    patterns_data = yaml.safe_load(f)
string_patterns = patterns_data.get('string_patterns', [])

with open(f'{api_specs_dir}/config/discovered_defaults.yaml') as f:
    defaults_data = yaml.safe_load(f)
resource_defaults = defaults_data.get('resources', {}).get(resource, {}).get('defaults', {})
# Build flat set of all documented defaults: top-level keys + nested.<prefix>.defaults as <prefix>.<field>
config_default_keys = set(resource_defaults.keys())
nested_section = defaults_data.get('resources', {}).get(resource, {}).get('nested', {})
for prefix, nested_data in nested_section.items():
    for key in nested_data.get('defaults', {}).keys():
        config_default_keys.add(f'{prefix}.{key}')

checks_total = 0
checks_pass = 0
gaps = []

def find_pattern(field_path, pattern_list):
    leaf = field_path.split('.')[-1]
    for p in pattern_list:
        if re.search(p.get('pattern', ''), leaf, re.IGNORECASE):
            return p
    return None

def within_tolerance(a, b, tol=0.10):
    if b == 0:
        return a == 0
    return abs(float(a) - float(b)) / max(abs(float(b)), 1) <= tol

# Check string constraints from prober
for field in fields:
    if field.get('probe_strategy') != 'string_length':
        continue
    actual = field.get('actual', {})
    field_path = field.get('field_path', '')
    probed_max = actual.get('maxLength')
    if probed_max is None:
        continue

    checks_total += 1
    pat = find_pattern(field_path, string_patterns)

    if pat and 'constraints' in pat:
        encoded_max = pat['constraints'].get('maxLength')
        if encoded_max is not None:
            if within_tolerance(probed_max, encoded_max):
                checks_pass += 1
            else:
                gaps.append({
                    'resource': resource,
                    'gap_type': 'constraint_value_wrong',
                    'fix_file': 'config/constraint_patterns.yaml',
                    'description': f'{field_path}: maxLength probed={probed_max} encoded={encoded_max}',
                    'fix_repo': 'api-specs-enriched',
                    'probed': str(probed_max),
                    'expected': str(encoded_max),
                })
        else:
            checks_pass += 1
    else:
        gaps.append({
            'resource': resource,
            'gap_type': 'missing_constraint',
            'fix_file': 'config/constraint_patterns.yaml',
            'description': f'{field_path}: probed maxLength={probed_max} but no matching pattern entry',
            'fix_repo': 'api-specs-enriched',
            'probed': f'maxLength={probed_max}',
            'expected': 'pattern entry in constraint_patterns.yaml',
        })

# Check server defaults (config_default_keys already built above, includes nested)
for key in server_defaults.keys():
    checks_total += 1
    if key in config_default_keys:
        checks_pass += 1
    else:
        gaps.append({
            'resource': resource,
            'gap_type': 'server_default_wrong',
            'fix_file': 'config/discovered_defaults.yaml',
            'description': f'{resource}: server applies {key!r} by default but absent from discovered_defaults.yaml',
            'fix_repo': 'api-specs-enriched',
            'probed': key,
            'expected': 'present in discovered_defaults.yaml',
        })

print(json.dumps({'checks_total': checks_total, 'checks_pass': checks_pass, 'gaps': gaps}))
" "${resource}" "${prober_output}" "${API_SPECS_DIR}" 2>/dev/null || \
    echo '{"checks_total":0,"checks_pass":0,"gaps":[]}')

  r_total=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['checks_total'])" "${result}")
  r_pass=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['checks_pass'])" "${result}")
  r_gaps=$(python3 -c "import json,sys; print(json.dumps(json.loads(sys.argv[1])['gaps']))" "${result}")

  spec_total=$((spec_total + r_total))
  spec_pass=$((spec_pass + r_pass))

  echo "  ${resource}: ${r_pass}/${r_total} checks pass"

  gaps_json=$(python3 -c "
import json, sys
print(json.dumps(json.loads(sys.argv[1]) + json.loads(sys.argv[2])))
" "${gaps_json}" "${r_gaps}" 2>/dev/null || echo "${gaps_json}")
done
echo ""


# ── Score emission ────────────────────────────────────────────────────────────
probe_count=$(echo "${probe_resources}" | wc -w | tr -d ' ')

python3 -c "
curl_total = ${curl_total}
curl_pass = ${curl_pass}
spec_total = ${spec_total}
spec_pass = ${spec_pass}
probe_count = ${probe_count}
curl_validity_score = round(curl_pass / max(1, curl_total) * 100, 1)
spec_accuracy_score = round(spec_pass / max(1, spec_total) * 100, 1)
print(f'METRIC curl_validity_score={curl_validity_score}')
print(f'METRIC spec_accuracy_score={spec_accuracy_score}')
print(f'METRIC curl_resources_tested={curl_total}')
print(f'METRIC spec_resources_tested={probe_count}')
"

spec_issues=$(python3 -c "
import json, sys
gaps = json.loads(sys.argv[1])
print(sum(1 for g in gaps if g.get('fix_repo') == 'api-specs-enriched'))
" "${gaps_json}")

echo "ASI gaps=${gaps_json}"
echo "ASI cross_repo_issues={\"api-specs-enriched\": ${spec_issues}, \"xcsh\": 0, \"terraform-provider-xcsh\": 0}"
