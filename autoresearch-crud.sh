#!/usr/bin/env bash
set -euo pipefail

# CRUD Autoresearch Benchmark
# For each phrase: ask xcsh to perform a CRUD operation, then verify via
# direct F5XC API call. Scores based on whether the resource state
# matches expectations after xcsh responds.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PHRASES_FILE="${PHRASES_FILE:-${SCRIPT_DIR}/autoresearch-crud-phrases.yaml}"
WORK_DIR="/tmp/ar-crud-$$"
API_URL="${F5XC_API_URL:-}"
API_TOKEN="${F5XC_API_TOKEN:-}"
NAMESPACE="r-mordasiewicz"

if [ -z "${API_URL}" ] || [ -z "${API_TOKEN}" ]; then
  echo "ERROR: F5XC_API_URL and F5XC_API_TOKEN must be set" >&2
  exit 1
fi

cleanup() {
  # Delete all ar-test-* resources across known resource types
  for api_path in healthchecks app_firewalls service_policys origin_pools; do
    resources=$(curl -sf \
      -H "Authorization: APIToken ${API_TOKEN}" \
      "${API_URL}/api/config/namespaces/${NAMESPACE}/${api_path}" 2>/dev/null \
      | python3 -c "
import json,sys
d=json.load(sys.stdin)
items=d.get('items',d.get('objects',[]))
for i in items:
    name=i.get('name','') or i.get('metadata',{}).get('name','')
    if name.startswith('ar-test-'):
        print(name)
" 2>/dev/null || true)
    for name in ${resources}; do
      curl -sf -X DELETE \
        -H "Authorization: APIToken ${API_TOKEN}" \
        "${API_URL}/api/config/namespaces/${NAMESPACE}/${api_path}/${name}" \
        >/dev/null 2>&1 || true
    done
  done
  # Delete ar-test-ns namespace if it exists
  curl -sf -X DELETE \
    -H "Authorization: APIToken ${API_TOKEN}" \
    "${API_URL}/api/web/namespaces/ar-test-ns" \
    >/dev/null 2>&1 || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT
mkdir -p "${WORK_DIR}"

# Parse YAML phrases to JSON
phrases_file="${WORK_DIR}/phrases.json"
python3 -c "
import yaml, json
with open('${PHRASES_FILE}') as f:
    data = yaml.safe_load(f)
json.dump(data['phrases'], open('${phrases_file}', 'w'))
"

phrase_count=$(python3 -c "import json; print(len(json.load(open('${phrases_file}'))))")
echo "Running ${phrase_count} CRUD benchmark phrases..."
echo ""

# Accumulators
total=0
create_pass=0
read_pass=0
update_pass=0
delete_pass=0
xcsh_issues=0
provider_issues=0
spec_issues=0
failures_json="[]"

api_get() {
  local path="$1"
  # Use -s without -f: -f exits non-zero on 4xx which appends "000" to the status code
  curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: APIToken ${API_TOKEN}" \
    "${API_URL}${path}" 2>/dev/null || echo "000"
}

for idx in $(seq 0 $((phrase_count - 1))); do
  ws="${WORK_DIR}/phrase_${idx}"
  mkdir -p "${ws}"

  # Extract phrase fields without eval
  python3 -c "
import json
phrases = json.load(open('${phrases_file}'))
p = phrases[${idx}]
json.dump({
    'phrase':           p['phrase'],
    'operation':        p.get('operation',''),
    'resource':         p.get('resource',''),
    'resource_name':    p.get('resource_name',''),
    'api_path':         p.get('api_path',''),
    'namespace_scoped': p.get('namespace_scoped', True),
}, open('${ws}/phrase.json', 'w'))
"
  phrase=$(python3 -c "import json; print(json.load(open('${ws}/phrase.json'))['phrase'])")
  operation=$(python3 -c "import json; print(json.load(open('${ws}/phrase.json'))['operation'])")
  resource=$(python3 -c "import json; print(json.load(open('${ws}/phrase.json'))['resource'])")
  resource_name=$(python3 -c "import json; print(json.load(open('${ws}/phrase.json'))['resource_name'])")
  api_path=$(python3 -c "import json; print(json.load(open('${ws}/phrase.json'))['api_path'])")
  namespace_scoped=$(python3 -c "import json; print(json.load(open('${ws}/phrase.json'))['namespace_scoped'])")

  total=$((total + 1))
  echo "[$((idx + 1))/${phrase_count}] ${operation}/${resource}: ${phrase:0:70}..."

  # Build API verify path
  if [ "${namespace_scoped}" = "True" ]; then
    verify_path="/api/config/namespaces/${NAMESPACE}/${api_path}/${resource_name}"
  else
    verify_path="/api/web/namespaces/${resource_name}"
  fi

  # Invoke xcsh
  response=""
  if command -v xcsh &>/dev/null; then
    response=$(timeout 120 xcsh --print --no-session "${phrase}" 2>/dev/null || echo "")
  else
    echo "  SKIP: xcsh not in PATH"
    continue
  fi

  # Verify via direct API call
  http_code=$(api_get "${verify_path}")

  op_pass=0
  error_type="UNKNOWN"
  fix_repo="xcsh"

  case "${operation}" in
    create|update)
      if [ "${http_code}" = "200" ]; then
        op_pass=1
        case "${operation}" in
          create) create_pass=$((create_pass + 1)) ;;
          update) update_pass=$((update_pass + 1)) ;;
        esac
      else
        if echo "${response}" | grep -qiE "xcsh_api|api call|POST|PUT"; then
          error_type="API_REJECTED"
          fix_repo="api-specs-enriched"
          spec_issues=$((spec_issues + 1))
        else
          error_type="NO_API_CALL"
          fix_repo="xcsh"
          xcsh_issues=$((xcsh_issues + 1))
        fi
      fi
      ;;
    read)
      if [ "${http_code}" = "200" ]; then
        op_pass=1
        read_pass=$((read_pass + 1))
      else
        error_type="READ_FAILED"
        fix_repo="xcsh"
        xcsh_issues=$((xcsh_issues + 1))
      fi
      ;;
    delete)
      # Wait briefly for deletion to propagate
      sleep 2
      http_code_after=$(api_get "${verify_path}")
      if [ "${http_code_after}" = "404" ] || [ "${http_code_after}" = "000" ]; then
        op_pass=1
        delete_pass=$((delete_pass + 1))
      else
        error_type="DELETE_FAILED"
        fix_repo="xcsh"
        xcsh_issues=$((xcsh_issues + 1))
      fi
      ;;
  esac

  status="FAIL"
  [ "${op_pass}" -eq 1 ] && status="PASS"
  echo "  ${status}: ${operation} http=${http_code} fix=${fix_repo}"

  if [ "${op_pass}" -eq 0 ]; then
    phrase_json=$(python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))" <<< "${phrase}")
    failures_json=$(python3 -c "
import json, sys
failures = json.loads(sys.argv[1])
failures.append({
    'phrase_idx': ${idx},
    'phrase': json.loads(sys.argv[2]),
    'operation': '${operation}',
    'resource': '${resource}',
    'resource_name': '${resource_name}',
    'error_type': '${error_type}',
    'http_code': '${http_code}',
    'fix_repo': '${fix_repo}',
})
print(json.dumps(failures))
" "${failures_json}" "${phrase_json}")
  fi
done

echo ""
if [ "${total}" -gt 0 ]; then
  python3 -c "
total = ${total}
create_pass = ${create_pass}
read_pass = ${read_pass}
update_pass = ${update_pass}
delete_pass = ${delete_pass}
all_pass = create_pass + read_pass + update_pass + delete_pass
crud_score = round(all_pass / total * 100, 1)
create_rate = round(create_pass / max(1, total // 4) * 100, 1)
read_rate = round(read_pass / max(1, total // 4) * 100, 1)
update_rate = round(update_pass / max(1, total // 4) * 100, 1)
delete_rate = round(delete_pass / max(1, total // 4) * 100, 1)
print(f'METRIC crud_score={crud_score}')
print(f'METRIC create_pass_rate={create_rate}')
print(f'METRIC read_pass_rate={read_rate}')
print(f'METRIC update_pass_rate={update_rate}')
print(f'METRIC delete_pass_rate={delete_rate}')
"
fi

cross_repo_json=$(python3 -c "
import json
print(json.dumps({'xcsh': ${xcsh_issues}, 'terraform-provider-f5xc': ${provider_issues}, 'api-specs-enriched': ${spec_issues}}))
")
echo "ASI failures=${failures_json}"
echo "ASI cross_repo_issues=${cross_repo_json}"
