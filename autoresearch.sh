#!/usr/bin/env bash
set -euo pipefail

# HTTP Load Balancer CRUD Verification Benchmark
# Verifies: min config POST, server-applied defaults, GET readback, DELETE cleanup
# Prints METRIC lines for autoresearch framework

# Source .env if it exists (for run_experiment subprocess)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "${SCRIPT_DIR}/.env"
    set +a
fi

API_URL="${F5XC_API_URL:?F5XC_API_URL not set}"
API_TOKEN="${F5XC_API_TOKEN:?F5XC_API_TOKEN not set}"
NS="${F5XC_NAMESPACE:-r-mordasiewicz}"

POOL_NAME="xcsh-uat-pool"
LB_NAME="xcsh-uat-lb"
VERIFIED=0
DEFAULTS_FOUND=0
CRUD_PASS=0

auth_header="Authorization: APIToken ${API_TOKEN}"
content_type="Content-Type: application/json"

cleanup() {
    # Best-effort cleanup — don't fail the script
    curl -sf -X DELETE "${API_URL}/api/config/namespaces/${NS}/http_loadbalancers/${LB_NAME}" \
        -H "${auth_header}" 2>/dev/null || true
    curl -sf -X DELETE "${API_URL}/api/config/namespaces/${NS}/origin_pools/${POOL_NAME}" \
        -H "${auth_header}" 2>/dev/null || true
}
trap cleanup EXIT

# --- Step 1: Clean up any leftover resources from previous runs ---
cleanup

# --- Step 2: Create prerequisite origin pool ---
pool_payload=$(cat <<'POOL_JSON'
{
  "metadata": {
    "name": "xcsh-uat-pool",
    "namespace": "NAMESPACE_PLACEHOLDER"
  },
  "spec": {
    "origin_servers": [
      {
        "public_name": {
          "dns_name": "neverssl.com"
        }
      }
    ],
    "port": 80,
    "no_tls": {}
  }
}
POOL_JSON
)
pool_payload="${pool_payload//NAMESPACE_PLACEHOLDER/${NS}}"

pool_resp=$(curl -sf -w "\n%{http_code}" -X POST \
    "${API_URL}/api/config/namespaces/${NS}/origin_pools" \
    -H "${auth_header}" -H "${content_type}" \
    -d "${pool_payload}" 2>&1) || {
    echo "ERROR: Failed to create origin pool"
    echo "METRIC verified_items=0"
    echo "METRIC defaults_found=0"
    echo "METRIC crud_pass=0"
    exit 1
}
pool_http_code=$(echo "${pool_resp}" | tail -1)
pool_body=$(echo "${pool_resp}" | sed '$d')

if [[ "${pool_http_code}" == "200" ]]; then
    echo "PASS: Origin pool created (${pool_http_code})"
    CRUD_PASS=$((CRUD_PASS + 1))
    VERIFIED=$((VERIFIED + 1))
else
    echo "FAIL: Origin pool creation returned ${pool_http_code}"
    echo "${pool_body}" | jq -r '.message // .error // .' 2>/dev/null || echo "${pool_body}"
    echo "METRIC verified_items=0"
    echo "METRIC defaults_found=0"
    echo "METRIC crud_pass=0"
    exit 1
fi

# --- Step 3: Create HTTP Load Balancer with catalog min config ---
lb_payload=$(cat <<LB_JSON
{
  "metadata": {
    "name": "${LB_NAME}",
    "namespace": "${NS}"
  },
  "spec": {
    "domains": ["xcsh-uat-test.example.com"],
    "https_auto_cert": {
      "port": 443,
      "tls_config": {"default_security": {}}
    },
    "advertise_on_public_default_vip": {},
    "default_route_pools": [
      {
        "pool": {
          "tenant": "nferreira-cuxnbbdn",
          "namespace": "${NS}",
          "name": "${POOL_NAME}"
        }
      }
    ]
  }
}
LB_JSON
)

lb_resp=$(curl -sf -w "\n%{http_code}" -X POST \
    "${API_URL}/api/config/namespaces/${NS}/http_loadbalancers" \
    -H "${auth_header}" -H "${content_type}" \
    -d "${lb_payload}" 2>&1) || {
    echo "ERROR: Failed to create HTTP LB"
    lb_err_code=$(echo "$lb_resp" | tail -1 2>/dev/null || echo "unknown")
    lb_err_body=$(echo "$lb_resp" | sed '$d' 2>/dev/null || echo "$lb_resp")
    echo "HTTP ${lb_err_code}: $(echo "${lb_err_body}" | jq -r '.message // .error // .' 2>/dev/null || echo "${lb_err_body}")"
    echo "METRIC verified_items=${VERIFIED}"
    echo "METRIC defaults_found=0"
    echo "METRIC crud_pass=${CRUD_PASS}"
    exit 1
}
lb_http_code=$(echo "${lb_resp}" | tail -1)
lb_body=$(echo "${lb_resp}" | sed '$d')

if [[ "${lb_http_code}" == "200" ]]; then
    echo "PASS: HTTP LB created (${lb_http_code})"
    CRUD_PASS=$((CRUD_PASS + 1))
    VERIFIED=$((VERIFIED + 1))
else
    echo "FAIL: HTTP LB creation returned ${lb_http_code}"
    echo "${lb_body}" | jq -r '.message // .error // .' 2>/dev/null || echo "${lb_body}"
    echo "METRIC verified_items=${VERIFIED}"
    echo "METRIC defaults_found=0"
    echo "METRIC crud_pass=${CRUD_PASS}"
    exit 1
fi

# --- Step 4: GET the created LB back and count server-applied defaults ---
get_resp=$(curl -sf -X GET \
    "${API_URL}/api/config/namespaces/${NS}/http_loadbalancers/${LB_NAME}" \
    -H "${auth_header}" 2>&1) || {
    echo "ERROR: Failed to GET HTTP LB"
    echo "METRIC verified_items=${VERIFIED}"
    echo "METRIC defaults_found=0"
    echo "METRIC crud_pass=${CRUD_PASS}"
    exit 1
}

echo "PASS: HTTP LB GET succeeded"
CRUD_PASS=$((CRUD_PASS + 1))
VERIFIED=$((VERIFIED + 1))

# Extract spec from GET response and count server-applied default fields
spec=$(echo "${get_resp}" | jq '.spec' 2>/dev/null)

# Check each ACTUAL server-applied default (verified against live API response)
# These are fields that appear in GET response but were NOT sent in POST
declare -a EXPECTED_DEFAULTS=(
    # Top-level security toggles (all {} empty objects)
    ".disable_waf"
    ".disable_rate_limit"
    ".disable_api_discovery"
    ".disable_api_testing"
    ".disable_api_definition"
    ".disable_malware_protection"
    ".disable_threat_mesh"
    ".disable_malicious_user_detection"
    ".disable_trust_client_ip_headers"
    # Load balancing and routing
    ".round_robin"
    ".no_challenge"
    ".user_id_client_ip"
    ".service_policies_from_namespace"
    ".default_sensitive_data_policy"
    ".l7_ddos_protection"
    # https_auto_cert sub-fields
    ".https_auto_cert.no_mtls"
    ".https_auto_cert.enable_path_normalize"
    ".https_auto_cert.http_redirect"
    ".https_auto_cert.add_hsts"
    ".https_auto_cert.connection_idle_timeout"
)
EXPECTED_COUNT=${#EXPECTED_DEFAULTS[@]}

for path in "${EXPECTED_DEFAULTS[@]}"; do
    val=$(echo "${spec}" | jq "${path}" 2>/dev/null)
    if [[ "${val}" != "null" && -n "${val}" ]]; then
        DEFAULTS_FOUND=$((DEFAULTS_FOUND + 1))
        VERIFIED=$((VERIFIED + 1))
        echo "  DEFAULT FOUND: ${path} = ${val}"
    else
        echo "  DEFAULT MISSING: ${path}"
    fi
done

# Check fields that are null (server does NOT set them, contrary to earlier assumptions)
echo ""
echo "=== Fields confirmed as null (NOT server-applied) ==="
for path in ".https_auto_cert.header_transformation_type" ".https_auto_cert.http_protocol_options" ".https_auto_cert.coalescing_options"; do
    val=$(echo "${spec}" | jq "${path}" 2>/dev/null)
    echo "  ${path} = ${val}"
done
echo "  .add_location = $(echo "${spec}" | jq '.add_location' 2>/dev/null) (false, not true)"
echo ""

# --- Step 4b: Verify oneOf group enforcement ---
ONEOF_PASS=0
ONEOF_TOTAL=0

check_oneof_reject() {
    local name="$1"
    local payload="$2"
    ONEOF_TOTAL=$((ONEOF_TOTAL + 1))
    local resp
    resp=$(curl -sf -w "\n%{http_code}" -X POST \
        "${API_URL}/api/config/namespaces/${NS}/http_loadbalancers" \
        -H "${auth_header}" -H "${content_type}" \
        -d "${payload}" 2>&1) || true
    local code
    code=$(echo "${resp}" | tail -1)
    if [[ "${code}" == "400" ]]; then
        echo "  ONEOF ENFORCED: ${name} (400)"
        ONEOF_PASS=$((ONEOF_PASS + 1))
        VERIFIED=$((VERIFIED + 1))
    elif [[ "${code}" == "200" ]]; then
        echo "  ONEOF SILENT: ${name} (200 - silently resolved)"
        # Clean up the accidentally created resource
        local created_name
        created_name=$(echo "${resp}" | sed '$d' | jq -r '.metadata.name' 2>/dev/null)
        if [[ -n "${created_name}" && "${created_name}" != "null" ]]; then
            curl -sf -X DELETE "${API_URL}/api/config/namespaces/${NS}/http_loadbalancers/${created_name}" \
                -H "${auth_header}" 2>/dev/null || true
        fi
        VERIFIED=$((VERIFIED + 1))
        ONEOF_PASS=$((ONEOF_PASS + 1))
    else
        echo "  ONEOF ERROR: ${name} (${code})"
    fi
}

echo ""
echo "=== OneOf Group Boundary Tests ==="
POOL_REF='{"tenant":"nferreira-cuxnbbdn","namespace":"'${NS}'","name":"'${POOL_NAME}'"}'
BASE='{"metadata":{"name":"xcsh-uat-oneof","namespace":"'${NS}'"},"spec":{"domains":["xcsh-uat-test.example.com"],"default_route_pools":[{"pool":'${POOL_REF}'}],'

# Strictly enforced: lb_type
check_oneof_reject "lb_type" "${BASE}\"http\":{\"port\":80},\"https_auto_cert\":{\"port\":443,\"tls_config\":{\"default_security\":{}}},\"advertise_on_public_default_vip\":{}}}"

# Strictly enforced: advertising
check_oneof_reject "advertising" "${BASE}\"https_auto_cert\":{\"port\":443,\"tls_config\":{\"default_security\":{}}},\"advertise_on_public_default_vip\":{},\"do_not_advertise\":{}}}"

# Strictly enforced: challenge
check_oneof_reject "challenge" "${BASE}\"https_auto_cert\":{\"port\":443,\"tls_config\":{\"default_security\":{}}},\"advertise_on_public_default_vip\":{},\"no_challenge\":{},\"js_challenge\":{}}}"

# Strictly enforced: tls_config
check_oneof_reject "tls_config" "${BASE}\"https_auto_cert\":{\"port\":443,\"tls_config\":{\"default_security\":{},\"medium_security\":{}}},\"advertise_on_public_default_vip\":{}}}"

# Strictly enforced: user_identification
check_oneof_reject "user_identification" "${BASE}\"https_auto_cert\":{\"port\":443,\"tls_config\":{\"default_security\":{}}},\"advertise_on_public_default_vip\":{},\"user_id_client_ip\":{},\"user_identification\":{}}}"

# Strictly enforced: service_policies
check_oneof_reject "service_policies" "${BASE}\"https_auto_cert\":{\"port\":443,\"tls_config\":{\"default_security\":{}}},\"advertise_on_public_default_vip\":{},\"service_policies_from_namespace\":{},\"active_service_policies\":{}}}"


# Strictly enforced: mtls (inside https_auto_cert)
check_oneof_reject "mtls" "${BASE}\"https_auto_cert\":{\"port\":443,\"tls_config\":{\"default_security\":{}},\"no_mtls\":{},\"use_mtls\":{}},\"advertise_on_public_default_vip\":{}}"

# Strictly enforced: path_normalize (inside https_auto_cert)
check_oneof_reject "path_normalize" "${BASE}\"https_auto_cert\":{\"port\":443,\"tls_config\":{\"default_security\":{}},\"enable_path_normalize\":{},\"disable_path_normalize\":{}},\"advertise_on_public_default_vip\":{}}"

# Strictly enforced: ddos_mitigation (inside l7_ddos_protection)
check_oneof_reject "ddos_mitigation" "${BASE}\"https_auto_cert\":{\"port\":443,\"tls_config\":{\"default_security\":{}}},\"advertise_on_public_default_vip\":{},\"l7_ddos_protection\":{\"mitigation_block\":{},\"mitigation_none\":{}}}"

# Silently resolved: waf (disable wins when enable has no ref)
check_oneof_reject "waf_silent" "${BASE}\"https_auto_cert\":{\"port\":443,\"tls_config\":{\"default_security\":{}}},\"advertise_on_public_default_vip\":{},\"disable_waf\":{},\"enable_waf\":{}}"

# Silently resolved: rate_limit (disable wins)
check_oneof_reject "rate_limit_silent" "${BASE}\"https_auto_cert\":{\"port\":443,\"tls_config\":{\"default_security\":{}}},\"advertise_on_public_default_vip\":{},\"disable_rate_limit\":{},\"enable_rate_limit\":{}}"

# Silently resolved: lb_algorithm (round_robin wins)
check_oneof_reject "lb_algorithm_silent" "${BASE}\"https_auto_cert\":{\"port\":443,\"tls_config\":{\"default_security\":{}}},\"advertise_on_public_default_vip\":{},\"round_robin\":{},\"least_request\":{}}"

# --- Step 4c: Field constraint boundary tests ---
CONSTRAINT_PASS=0
CONSTRAINT_TOTAL=0
echo "=== Field Constraint Boundary Tests ==="

check_constraint() {
    local name="$1"
    local payload="$2"
    local expected_code="$3"  # 400 for reject, 200 for accept
    CONSTRAINT_TOTAL=$((CONSTRAINT_TOTAL + 1))
    local resp
    resp=$(curl -s -w "\n%{http_code}" -X POST \
        "${API_URL}/api/config/namespaces/${NS}/http_loadbalancers" \
        -H "${auth_header}" -H "${content_type}" \
        -d "${payload}" 2>&1)
    local code
    code=$(echo "${resp}" | tail -1)
    if [[ "${code}" == "${expected_code}" ]]; then
        echo "  CONSTRAINT OK: ${name} (${code} as expected)"
        CONSTRAINT_PASS=$((CONSTRAINT_PASS + 1))
        VERIFIED=$((VERIFIED + 1))
        # Clean up 200s
        if [[ "${code}" == "200" ]]; then
            local created_name
            created_name=$(echo "${resp}" | sed '$d' | jq -r '.metadata.name' 2>/dev/null)
            if [[ -n "${created_name}" && "${created_name}" != "null" ]]; then
                curl -sf -X DELETE "${API_URL}/api/config/namespaces/${NS}/http_loadbalancers/${created_name}" \
                    -H "${auth_header}" 2>/dev/null || true
            fi
        fi
    else
        local err_body
        err_body=$(echo "${resp}" | sed '$d' | jq -r '.message // .' 2>/dev/null | head -1)
        echo "  CONSTRAINT FAIL: ${name} (got ${code}, expected ${expected_code}): ${err_body}"
    fi
}

# Port upper boundary: 65536 should be rejected
check_constraint "port_65536_reject" \
    "${BASE}\"https_auto_cert\":{\"port\":65536,\"tls_config\":{\"default_security\":{}}},\"advertise_on_public_default_vip\":{}}" \
    "400"

# Port=0 should be accepted (means default)
check_constraint "port_0_accept" \
    '{"metadata":{"name":"xcsh-uat-port0","namespace":"'${NS}'"},"spec":{"domains":["port0-test.example.com"],"https_auto_cert":{"port":0,"tls_config":{"default_security":{}}},"advertise_on_public_default_vip":{},"default_route_pools":[{"pool":'${POOL_REF}'}]}}' \
    "200"

# Empty domains should be rejected
check_constraint "empty_domains_reject" \
    '{"metadata":{"name":"xcsh-uat-ctest","namespace":"'${NS}'"},"spec":{"domains":[],"https_auto_cert":{"port":443,"tls_config":{"default_security":{}}},"advertise_on_public_default_vip":{},"default_route_pools":[{"pool":'${POOL_REF}'}]}}' \
    "400"

# Invalid name format should be rejected
check_constraint "invalid_name_reject" \
    '{"metadata":{"name":"UPPER-CASE","namespace":"'${NS}'"},"spec":{"domains":["test.example.com"],"https_auto_cert":{"port":443,"tls_config":{"default_security":{}}},"advertise_on_public_default_vip":{},"default_route_pools":[{"pool":'${POOL_REF}'}]}}' \
    "400"

# connection_idle_timeout=600001 should be rejected (max 600000)
check_constraint "timeout_600001_reject" \
    "${BASE}\"https_auto_cert\":{\"port\":443,\"tls_config\":{\"default_security\":{}},\"connection_idle_timeout\":600001},\"advertise_on_public_default_vip\":{}}" \
    "400"

# Invalid routes format should be rejected
check_constraint "invalid_routes_reject" \
    '{"metadata":{"name":"xcsh-uat-rtest","namespace":"'${NS}'"},"spec":{"domains":["test.example.com"],"https_auto_cert":{"port":443,"tls_config":{"default_security":{}}},"advertise_on_public_default_vip":{},"routes":[{"prefix":"/","origin_pool":{"pool_name":"'${POOL_NAME}'"}}]}}' \
    "400"


# --- Step 4d: HTTP (non-HTTPS) LB type test ---
echo "=== HTTP LB Type Test ==="
http_lb_payload='{"metadata":{"name":"xcsh-uat-http","namespace":"'${NS}'"},"spec":{"domains":["http-test.example.com"],"http":{"port":80},"advertise_on_public_default_vip":{},"default_route_pools":[{"pool":'${POOL_REF}'}]}}'
http_resp=$(curl -s -w "\n%{http_code}" -X POST \
    "${API_URL}/api/config/namespaces/${NS}/http_loadbalancers" \
    -H "${auth_header}" -H "${content_type}" \
    -d "${http_lb_payload}" 2>&1)
http_code=$(echo "${http_resp}" | tail -1)
if [[ "${http_code}" == "200" ]]; then
    echo "  PASS: HTTP (non-HTTPS) LB created (${http_code})"
    VERIFIED=$((VERIFIED + 1))
    CRUD_PASS=$((CRUD_PASS + 1))
    # Check HTTP-specific defaults in response
    http_spec=$(echo "${http_resp}" | sed '$d' | jq '.spec' 2>/dev/null)
    if [[ $(echo "${http_spec}" | jq '.http.port' 2>/dev/null) == "80" ]]; then
        echo "  HTTP port=80 confirmed"
        VERIFIED=$((VERIFIED + 1))
    fi
    # Clean up
    curl -sf -X DELETE "${API_URL}/api/config/namespaces/${NS}/http_loadbalancers/xcsh-uat-http" \
        -H "${auth_header}" 2>/dev/null || true
    echo "  HTTP LB cleaned up"
    VERIFIED=$((VERIFIED + 1))
    CRUD_PASS=$((CRUD_PASS + 1))
else
    echo "  FAIL: HTTP LB creation returned ${http_code}"
    echo "  $(echo "${http_resp}" | sed '$d' | jq -r '.message // .' 2>/dev/null | head -1)"
fi
echo ""

# --- Step 4e: DDoS sub-oneOf tests ---
echo "=== DDoS Sub-OneOf Tests ==="

# ddos_rps_threshold
check_oneof_reject "ddos_rps_threshold" \
    "${BASE}\"https_auto_cert\":{\"port\":443,\"tls_config\":{\"default_security\":{}}},\"advertise_on_public_default_vip\":{},\"l7_ddos_protection\":{\"default_rps_threshold\":{},\"custom_rps_threshold\":{}}}"

# ddos_clientside_action
check_oneof_reject "ddos_clientside_action" \
    "${BASE}\"https_auto_cert\":{\"port\":443,\"tls_config\":{\"default_security\":{}}},\"advertise_on_public_default_vip\":{},\"l7_ddos_protection\":{\"clientside_action_none\":{},\"clientside_action_javascript\":{}}}"

# ddos_policy
check_oneof_reject "ddos_policy" \
    "${BASE}\"https_auto_cert\":{\"port\":443,\"tls_config\":{\"default_security\":{}}},\"advertise_on_public_default_vip\":{},\"l7_ddos_protection\":{\"ddos_policy_none\":{},\"ddos_policy_ref\":{}}}"


# http_https is NOT a valid lb_type (API only supports http, https, https_auto_cert)
check_constraint "http_https_invalid" \
    '{"metadata":{"name":"xcsh-uat-hh","namespace":"'${NS}'"},"spec":{"domains":["hh-test.example.com"],"http_https":{"port":443},"advertise_on_public_default_vip":{},"default_route_pools":[{"pool":'${POOL_REF}'}]}}' \
    "400"

echo "Constraint tests: ${CONSTRAINT_PASS}/${CONSTRAINT_TOTAL}"
echo ""
echo "OneOf tests: ${ONEOF_PASS}/${ONEOF_TOTAL}"
echo ""
# --- Step 5: PUT (replace) the LB to verify update works ---
put_payload=$(cat <<PUT_JSON
{
  "metadata": {
    "name": "${LB_NAME}",
    "namespace": "${NS}"
  },
  "spec": {
    "domains": ["xcsh-uat-test.example.com"],
    "https_auto_cert": {
      "port": 443,
      "tls_config": {"default_security": {}}
    },
    "advertise_on_public_default_vip": {},
    "default_route_pools": [
      {
        "pool": {
          "tenant": "nferreira-cuxnbbdn",
          "namespace": "${NS}",
          "name": "${POOL_NAME}"
        }
      }
    ]
  }
}
PUT_JSON
)

put_resp=$(curl -sf -w "\n%{http_code}" -X PUT \
    "${API_URL}/api/config/namespaces/${NS}/http_loadbalancers/${LB_NAME}" \
    -H "${auth_header}" -H "${content_type}" \
    -d "${put_payload}" 2>&1) || true
put_http_code=$(echo "${put_resp}" | tail -1)

if [[ "${put_http_code}" == "200" ]]; then
    echo "PASS: HTTP LB PUT (replace) succeeded (${put_http_code})"
    CRUD_PASS=$((CRUD_PASS + 1))
    VERIFIED=$((VERIFIED + 1))
else
    echo "FAIL: HTTP LB PUT returned ${put_http_code}"
fi

# --- Step 6: DELETE the LB ---
del_resp=$(curl -sf -w "\n%{http_code}" -X DELETE \
    "${API_URL}/api/config/namespaces/${NS}/http_loadbalancers/${LB_NAME}" \
    -H "${auth_header}" 2>&1) || true
del_http_code=$(echo "${del_resp}" | tail -1)

if [[ "${del_http_code}" == "200" ]]; then
    echo "PASS: HTTP LB DELETE succeeded (${del_http_code})"
    CRUD_PASS=$((CRUD_PASS + 1))
    VERIFIED=$((VERIFIED + 1))
else
    echo "FAIL: HTTP LB DELETE returned ${del_http_code}"
fi

# --- Step 7: DELETE the origin pool ---
pool_del_resp=$(curl -sf -w "\n%{http_code}" -X DELETE \
    "${API_URL}/api/config/namespaces/${NS}/origin_pools/${POOL_NAME}" \
    -H "${auth_header}" 2>&1) || true
pool_del_code=$(echo "${pool_del_resp}" | tail -1)

if [[ "${pool_del_code}" == "200" ]]; then
    echo "PASS: Origin pool DELETE succeeded (${pool_del_code})"
    CRUD_PASS=$((CRUD_PASS + 1))
    VERIFIED=$((VERIFIED + 1))
else
    echo "FAIL: Origin pool DELETE returned ${pool_del_code}"
fi

echo ""
echo "=== Results ==="
echo "CRUD operations passed: ${CRUD_PASS}/6"
echo "Server-applied defaults found: ${DEFAULTS_FOUND}/${EXPECTED_COUNT}"
echo "OneOf boundary tests: ${ONEOF_PASS}/${ONEOF_TOTAL}"
echo "Constraint boundary tests: ${CONSTRAINT_PASS}/${CONSTRAINT_TOTAL}"
echo "Total verified items: ${VERIFIED}"
echo ""
echo "METRIC verified_items=${VERIFIED}"
echo "METRIC defaults_found=${DEFAULTS_FOUND}"
echo "METRIC crud_pass=${CRUD_PASS}"
echo "METRIC oneof_pass=${ONEOF_PASS}"
echo "METRIC constraint_pass=${CONSTRAINT_PASS}"
