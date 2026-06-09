#!/usr/bin/env bash
# autoresearch-http-lb-advertise.sh
# T1: Validate xcsh xcsh_api tool determinism for HTTP LB advertise_custom options
# Primary metric: http_lb_advertise_payload_score
set -euo pipefail

API_URL="${F5XC_API_URL:-}"
API_TOKEN="${F5XC_API_TOKEN:-}"
NS="r-mordasiewicz"
PREFIX="ar-test-lb-adv"
POOL_NAME="ar-test-lb-adv-pool"
VSITE_NAME="ar-test-vs-ce"
VSITE_RE_NAME="ar-test-vs-re"
CE_SITE_NAME="ar-test-smsv2-t2-site"
PHRASES_FILE="$(dirname "$0")/autoresearch-http-lb-advertise-phrases.yaml"

if [ -z "${API_URL}" ] || [ -z "${API_TOKEN}" ]; then
  echo "ERROR: F5XC_API_URL and F5XC_API_TOKEN required" >&2
  exit 1
fi

xcsh_cmd() {
  # Use background + SIGKILL — macOS timeout doesn't reliably kill bun when blocked on I/O
  xcsh --print --no-session -- "$1" 2>/dev/null &
  local xcsh_pid=$!
  local elapsed=0
  while kill -0 "${xcsh_pid}" 2>/dev/null; do
    sleep 1
    elapsed=$((elapsed + 1))
    [ "${elapsed}" -ge 240 ] && kill -9 "${xcsh_pid}" 2>/dev/null && break
  done
  wait "${xcsh_pid}" 2>/dev/null || true
}

api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sf -X "${method}" -H "Authorization: APIToken ${API_TOKEN}" -H "Content-Type: application/json")
  [ -n "${body}" ] && args+=(-d "${body}")
  curl "${args[@]}" "${API_URL}${path}" 2>/dev/null
}

# ── Setup: ensure prerequisites exist ────────────────────────────────────────

setup_prerequisites() {
  echo "=== Setup: Creating shared prerequisites ==="

  # Origin pool
  local pool_exists
  pool_exists=$(api GET "/api/config/namespaces/${NS}/origin_pools/${POOL_NAME}" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('metadata',{}).get('name',''))" 2>/dev/null || echo "")
  if [ -z "${pool_exists}" ]; then
    echo "  Creating origin pool ${POOL_NAME}..."
    api POST "/api/config/namespaces/${NS}/origin_pools" \
      "{\"metadata\":{\"name\":\"${POOL_NAME}\",\"namespace\":\"${NS}\"},\"spec\":{\"origin_servers\":[{\"public_name\":{\"dns_name\":\"example.com\"},\"labels\":{}}],\"port\":80,\"no_tls\":{}}}" >/dev/null
  fi

  # Virtual site targeting CE (for B/D/F/H groups)
  local vs_exists
  vs_exists=$(api GET "/api/config/namespaces/${NS}/virtual_sites/${VSITE_NAME}" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('metadata',{}).get('name',''))" 2>/dev/null || echo "")
  if [ -z "${vs_exists}" ]; then
    echo "  Creating virtual site ${VSITE_NAME} (CUSTOMER_EDGE)..."
    api POST "/api/config/namespaces/${NS}/virtual_sites" \
      "{\"metadata\":{\"name\":\"${VSITE_NAME}\",\"namespace\":\"${NS}\"},\"spec\":{\"site_type\":\"CUSTOMER_EDGE\",\"site_selector\":{\"expressions\":[\"ves.io/siteName in (${CE_SITE_NAME})\" ]}}}" >/dev/null
  fi
  # Virtual site targeting RE (for E1 vk8s_service — vk8s_service requires REGIONAL_EDGE type)
  local vs_re_exists
  vs_re_exists=$(api GET "/api/config/namespaces/${NS}/virtual_sites/${VSITE_RE_NAME}" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('metadata',{}).get('name',''))" 2>/dev/null || echo "")
  if [ -z "${vs_re_exists}" ]; then
    echo "  Creating virtual site ${VSITE_RE_NAME} (REGIONAL_EDGE)..."
    api POST "/api/config/namespaces/${NS}/virtual_sites" \
      "{\"metadata\":{\"name\":\"${VSITE_RE_NAME}\",\"namespace\":\"${NS}\"},\"spec\":{\"site_type\":\"REGIONAL_EDGE\",\"site_selector\":{\"expressions\":[\"ves.io/siteName=any\" ]}}}" >/dev/null
  fi
  echo "  Prerequisites ready."
  echo ""
}

# ── T1: Phrase matrix ─────────────────────────────────────────────────────────

run_t1() {
  echo "=== T1: HTTP LB Advertise-Where Payload Tests ==="
  echo ""

  local phrases total=0 pass=0
  phrases=$(python3 -c "
import yaml, sys
with open('${PHRASES_FILE}') as f:
    data = yaml.safe_load(f)
for p in data.get('phrases', []):
    print(p['id'] + '|' + p['phrase'] + '|' + p.get('resource_name','') + '|' + p.get('expected_advertise_field','') + '|' + p.get('expected_site_choice','') + '|' + p.get('expected_network','') + '|' + p.get('expected_resource_type',''))
" 2>/dev/null)

  local failures="[]"

  while IFS='|' read -r id phrase resource_name expected_advertise expected_choice expected_network expected_resource_type; do
    [ -z "${id}" ] && continue
    total=$((total + 1))
    echo "[${id}] ${phrase:0:80}..."

    # Call xcsh (post-timeout sleep: recover from Claude API rate limiting after a kill)
    local _xcsh_timed_out=0
    local _pre_elapsed=0
    xcsh --print --no-session -- "${phrase}" 2>/dev/null &
    local xcsh_pid=$!
    while kill -0 "${xcsh_pid}" 2>/dev/null; do
      sleep 1
      _pre_elapsed=$((_pre_elapsed + 1))
      if [ "${_pre_elapsed}" -ge 240 ]; then
        kill -9 "${xcsh_pid}" 2>/dev/null
        _xcsh_timed_out=1
        break
      fi
    done
    wait "${xcsh_pid}" 2>/dev/null || true
    # After a timeout (rate limit indicator), wait 30s before next phrase
    [ "${_xcsh_timed_out}" -eq 1 ] && sleep 30

    # Determine the resource to check: LB or virtual_site
    local check_result="FAIL"
    local error_type="NO_RESOURCE_CREATED"
    local fix_repo="xcsh"

    if [ "${expected_resource_type}" = "virtual_site" ]; then
      # Check virtual site was created correctly
      local vs_resp
      vs_resp=$(api GET "/api/config/namespaces/${NS}/virtual_sites/${resource_name}" 2>/dev/null || echo "{}")
      local vs_name vs_type
      vs_name=$(echo "${vs_resp}" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('metadata',{}).get('name',''))" 2>/dev/null || echo "")
      vs_type=$(echo "${vs_resp}" | python3 -c "import json,sys; d=json.load(sys.stdin); print((d.get('spec') or {}).get('site_type',''))" 2>/dev/null || echo "")
      if [ -n "${vs_name}" ] && [ -n "${vs_type}" ]; then
        check_result="PASS"
        error_type=""
        fix_repo=""
        echo "  PASS: virtual_site=${vs_name} site_type=${vs_type}"
        api DELETE "/api/config/namespaces/${NS}/virtual_sites/${resource_name}" >/dev/null 2>&1 || true
      else
        error_type="NO_VIRTUAL_SITE_CREATED"
        echo "  FAIL: virtual site not created by xcsh"
      fi
    else
      # Check HTTP LB was created with correct advertise field
      local lb_resp
      lb_resp=$(api GET "/api/config/namespaces/${NS}/http_loadbalancers/${resource_name}" 2>/dev/null || echo "{}")
      local lb_name
      lb_name=$(echo "${lb_resp}" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('metadata',{}).get('name',''))" 2>/dev/null || echo "")

      if [ -z "${lb_name}" ]; then
        error_type="NO_LB_CREATED"
        fix_repo="xcsh"
        echo "  FAIL: LB not created by xcsh (error_type=${error_type})"
      else
        # Verify advertise field
        local actual_advertise
        actual_advertise=$(echo "${lb_resp}" | python3 -c "
import json,sys
d=json.load(sys.stdin)
spec=d.get('spec',{})
for f in ['advertise_on_public_default_vip','advertise_on_public','advertise_custom','do_not_advertise']:
    if f in spec:
        print(f)
        break
" 2>/dev/null || echo "")

        if [ "${actual_advertise}" != "${expected_advertise}" ]; then
          error_type="WRONG_ADVERTISE_CHOICE"
          fix_repo="xcsh"
          echo "  FAIL: expected advertise=${expected_advertise} got=${actual_advertise} (error_type=${error_type} fix_repo=${fix_repo})"
        elif [ "${expected_advertise}" = "advertise_custom" ] && [ -n "${expected_choice}" ]; then
          # Check site targeting choice and network
          local actual_choice actual_network
          actual_choice=$(echo "${lb_resp}" | python3 -c "
import json,sys
d=json.load(sys.stdin)
where=(d.get('spec',{}).get('advertise_custom') or {}).get('advertise_where',[])
if where:
    for f in ['site','virtual_site','virtual_site_with_vip','virtual_network','vk8s_service','advertise_on_public']:
        if f in where[0]:
            print(f)
            break
" 2>/dev/null || echo "")
          actual_network=$(echo "${lb_resp}" | python3 -c "
import json,sys
d=json.load(sys.stdin)
where=(d.get('spec',{}).get('advertise_custom') or {}).get('advertise_where',[])
if where:
    entry=where[0]
    for f in ['site','virtual_site','virtual_site_with_vip']:
        if f in entry:
            print((entry[f] or {}).get('network',''))
            break
" 2>/dev/null || echo "")

          if [ "${actual_choice}" != "${expected_choice}" ]; then
            error_type="WRONG_SITE_CHOICE"
            fix_repo="xcsh"
            echo "  FAIL: expected choice=${expected_choice} got=${actual_choice} (error_type=${error_type} fix_repo=${fix_repo})"
          elif [ -n "${expected_network}" ] && [ "${actual_network}" != "${expected_network}" ]; then
            error_type="WRONG_NETWORK"
            fix_repo="api-specs-enriched"
            echo "  FAIL: expected network=${expected_network} got=${actual_network} (error_type=${error_type} fix_repo=${fix_repo})"
          else
            check_result="PASS"
            error_type=""
            fix_repo=""
            echo "  PASS: advertise=${actual_advertise} choice=${actual_choice} network=${actual_network}"
          fi
        else
          check_result="PASS"
          error_type=""
          fix_repo=""
          echo "  PASS: advertise=${actual_advertise}"
        fi
        # Cleanup
        api DELETE "/api/config/namespaces/${NS}/http_loadbalancers/${resource_name}" >/dev/null 2>&1 || true
      fi
    fi

    if [ "${check_result}" = "PASS" ]; then
      pass=$((pass + 1))
    else
      failures=$(echo "${failures}" | \
        _id="${id}" _phrase="${phrase}" _error_type="${error_type}" _fix_repo="${fix_repo}" \
        python3 -c "
import json,sys,os
failures=json.load(sys.stdin)
failures.append({'id':os.environ['_id'],'phrase':os.environ['_phrase'],'error_type':os.environ['_error_type'],'fix_repo':os.environ['_fix_repo']})
print(json.dumps(failures))
")
    fi
    echo ""
  done <<< "${phrases}"

  echo "T1 complete: ${pass}/${total} payload tests passed"
  echo ""

  # Score emission
  local score=0.0
  [ "${total}" -gt 0 ] && score=$(python3 -c "print(round(${pass}/${total}*100,1))")

  local xcsh_issues=0 spec_issues=0
  xcsh_issues=$(echo "${failures}" | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for f in d if f.get('fix_repo')=='xcsh'))" 2>/dev/null || echo 0)
  spec_issues=$(echo "${failures}" | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for f in d if f.get('fix_repo')=='api-specs-enriched'))" 2>/dev/null || echo 0)

  echo "METRIC http_lb_advertise_payload_score=${score}"
  echo "METRIC http_lb_advertise_t1_tests=${total}"
  echo "ASI failures=${failures}"
  echo "ASI cross_repo_issues={\"xcsh\": ${xcsh_issues}, \"api-specs-enriched\": ${spec_issues}}"
}

# ── Teardown: remove shared prerequisites ────────────────────────────────────

teardown() {
  api DELETE "/api/config/namespaces/${NS}/virtual_sites/${VSITE_NAME}" >/dev/null 2>&1 || true
  api DELETE "/api/config/namespaces/${NS}/virtual_sites/${VSITE_RE_NAME}" >/dev/null 2>&1 || true
  api DELETE "/api/config/namespaces/${NS}/origin_pools/${POOL_NAME}" >/dev/null 2>&1 || true
}

setup_prerequisites
run_t1
teardown

echo "EXIT: 0"
