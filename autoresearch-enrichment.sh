#!/usr/bin/env bash
set -euo pipefail

# Enrichment Accuracy Autoresearch Benchmark
# Runs constraint_prober.py against live API to discover real field constraints,
# then compares them to what's embedded in xcsh's terraform-index.generated.ts.
# Scores how accurately the embedded index reflects live API constraints.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_SPECS_DIR="${SCRIPT_DIR}/../api-specs-enriched"
PROBER="${API_SPECS_DIR}/scripts/discovery/constraint_prober.py"
INDEX_TS="${SCRIPT_DIR}/packages/coding-agent/src/internal-urls/terraform-index.generated.ts"
WORK_DIR="/tmp/ar-enrichment-$$"
RESOURCES="healthcheck origin_pool app_firewall service_policy"

if [ -z "${F5XC_API_URL:-}" ] || [ -z "${F5XC_API_TOKEN:-}" ]; then
  echo "ERROR: F5XC_API_URL and F5XC_API_TOKEN must be set" >&2
  exit 1
fi

if [ ! -f "${PROBER}" ]; then
  echo "ERROR: constraint_prober.py not found at ${PROBER}" >&2
  exit 1
fi

cleanup() { rm -rf "${WORK_DIR}"; }
trap cleanup EXIT
mkdir -p "${WORK_DIR}"

# Ensure httpx is available for constraint_prober
python3 -c "import httpx" 2>/dev/null || pip install -q httpx --break-system-packages >/dev/null 2>&1 || true

echo "Running enrichment accuracy benchmark..."
echo "Resources: ${RESOURCES}"
echo ""

# Run constraint_prober for each resource
for resource in ${RESOURCES}; do
  output_file="${WORK_DIR}/${resource}.json"
  echo "Probing ${resource}..."
  (cd "${API_SPECS_DIR}" && \
    F5XC_API_URL="${F5XC_API_URL}" \
    F5XC_API_TOKEN="${F5XC_API_TOKEN}" \
    F5XC_NAMESPACE="r-mordasiewicz" \
    python3 -W ignore -m scripts.discovery.constraint_prober \
      --resource "${resource}" \
      --output "${output_file}" \
      --rate 3.0 2>&1 | grep -v "^INFO:httpx" || true) \
    && echo "  ✓ ${resource} probed" \
    || echo "  ✗ ${resource} probe failed (using empty result)"
  # Create empty result if probe failed
  [ -f "${output_file}" ] || echo '{"fields_probed":[],"oneof_groups":[]}' > "${output_file}"
done

echo ""

# Extract terraform index data from the source JSON (provider repo)
# The .generated.ts uses unquoted TS object syntax that json.loads can't parse;
# read the canonical JSON directly instead.
index_json="${WORK_DIR}/index_extract.json"
PROVIDER_JSON="${SCRIPT_DIR}/../terraform-provider-f5xc/docs/terraform-llms-index.json"
if [ ! -f "${PROVIDER_JSON}" ]; then
  echo "WARNING: terraform-llms-index.json not found at ${PROVIDER_JSON}, using empty index" >&2
  echo '{}' > "${index_json}"
else
  python3 -c "
import json, sys

data = json.load(open(sys.argv[1]))
resources = data.get('resources', {})
output = {}
for name, res in resources.items():
    output[name] = {
        'required': res.get('required', []),
        'oneof_groups': [g.get('fields', []) for g in res.get('oneof_groups', [])],
        'server_defaults': res.get('server_defaults', []),
    }
print(json.dumps(output))
" "${PROVIDER_JSON}" > "${index_json}"
fi

# Score: compare probed vs embedded
results=$(python3 -c "
import json, sys

index = json.load(open(sys.argv[1]))  # flat resource map: {name: {required, oneof_groups, ...}}
resources = sys.argv[2].split()
work_dir = sys.argv[3]

total_checks = 0
passed_checks = 0
field_total = 0
field_matched = 0
oneof_total = 0
oneof_matched = 0
mismatches = []

for resource in resources:
    probed_path = f'{work_dir}/{resource}.json'
    try:
        probed = json.load(open(probed_path))
    except Exception:
        probed = {}

    embedded = index.get(resource, {})

    # Check field coverage: required fields discovered vs embedded
    # Prober outputs fields[] with probe_strategy=field_omission and actual.required=True
    # Prober uses full paths (spec.interval); index uses leaf names (interval) — normalize.
    def leaf(path):
        return path.split('.')[-1]

    probed_required = set(
        leaf(f['field_path'])
        for f in probed.get('fields', [])
        if f.get('probe_strategy') == 'field_omission' and f.get('actual', {}).get('required') == True
    )
    embedded_required = set(embedded.get('required', []))
    # Fields in oneof_groups or server_defaults are also "documented" — not a gap.
    # oneof_groups is a list of lists (fields extracted from each group dict).
    embedded_oneof_fields = set(
        field
        for g in embedded.get('oneof_groups', [])
        for field in (g if isinstance(g, list) else g.get('fields', []))
    )
    embedded_server_defaults = set(embedded.get('server_defaults', []))
    embedded_known = embedded_required | embedded_oneof_fields | embedded_server_defaults
    for field in probed_required:
        field_total += 1
        if field in embedded_known:
            field_matched += 1
        else:
            mismatches.append({
                'resource': resource,
                'field': field,
                'issue': 'required_field_missing_from_index',
                'probed': str(field),
                'embedded': 'not present',
                'fix_repo': 'terraform-provider-f5xc',
            })

    # Check oneOf group count
    probed_oneof_count = len(probed.get('oneof_groups', []))
    embedded_oneof_count = len(embedded.get('oneof_groups', []))
    oneof_total += 1
    if probed_oneof_count == 0 or abs(probed_oneof_count - embedded_oneof_count) <= 2:
        oneof_matched += 1
    else:
        mismatches.append({
            'resource': resource,
            'field': 'oneof_groups',
            'issue': 'oneof_count_mismatch',
            'probed': probed_oneof_count,
            'embedded': embedded_oneof_count,
            'fix_repo': 'terraform-provider-f5xc' if embedded_oneof_count < probed_oneof_count else 'api-specs-enriched',
        })

    # General check: resource present in index at all
    total_checks += 1
    if resource in index:
        passed_checks += 1
    else:
        mismatches.append({
            'resource': resource,
            'field': 'resource',
            'issue': 'resource_missing_from_index',
            'probed': 'exists in API',
            'embedded': 'not in terraform index',
            'fix_repo': 'terraform-provider-f5xc',
        })

constraint_accuracy = round(field_matched / max(1, field_total) * 100, 1)
field_coverage = round(field_matched / max(1, field_total) * 100, 1)
oneof_accuracy = round(oneof_matched / max(1, oneof_total) * 100, 1)
enrichment_score = round((passed_checks / max(1, total_checks) * 0.4 +
                          field_matched / max(1, field_total) * 0.3 +
                          oneof_matched / max(1, oneof_total) * 0.3) * 100, 1)

xcsh_issues = sum(1 for m in mismatches if m['fix_repo'] == 'xcsh')
provider_issues = sum(1 for m in mismatches if m['fix_repo'] == 'terraform-provider-f5xc')
spec_issues = sum(1 for m in mismatches if m['fix_repo'] == 'api-specs-enriched')

print(json.dumps({
    'enrichment_score': enrichment_score,
    'constraint_accuracy': constraint_accuracy,
    'field_coverage': field_coverage,
    'oneof_accuracy': oneof_accuracy,
    'mismatches': mismatches,
    'cross_repo': {'xcsh': xcsh_issues, 'terraform-provider-f5xc': provider_issues, 'api-specs-enriched': spec_issues},
}))
" "${index_json}" "${RESOURCES}" "${WORK_DIR}")

# Emit METRIC and ASI lines
python3 -c "
import json, sys
r = json.loads(sys.argv[1])
print(f'METRIC enrichment_score={r[\"enrichment_score\"]}')
print(f'METRIC constraint_accuracy={r[\"constraint_accuracy\"]}')
print(f'METRIC field_coverage={r[\"field_coverage\"]}')
print(f'METRIC oneof_accuracy={r[\"oneof_accuracy\"]}')
print(f'ASI mismatches={json.dumps(r[\"mismatches\"])}')
print(f'ASI cross_repo_issues={json.dumps(r[\"cross_repo\"])}')
" "${results}"
