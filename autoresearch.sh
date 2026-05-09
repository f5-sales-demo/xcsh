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
echo "Total verified items: ${VERIFIED}"
echo ""
echo "METRIC verified_items=${VERIFIED}"
echo "METRIC defaults_found=${DEFAULTS_FOUND}"
echo "METRIC crud_pass=${CRUD_PASS}"
