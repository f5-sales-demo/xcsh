#!/usr/bin/env bash
set -euo pipefail

# SMSv2 Option Matrix Benchmark
# T1: Payload correctness (23 option tests — xcsh → F5 XC API 200)
# T2: CE deployment (1 Azure CE → registration ONLINE)
# T3: Mesh connectivity (2 Azure CEs + site_mesh_group → both ONLINE)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PHRASES_FILE="${PHRASES_FILE:-${SCRIPT_DIR}/autoresearch-smsv2-phrases.yaml}"
WORK_DIR="/tmp/ar-smsv2-$$"
API_URL="${F5XC_API_URL:-}"
API_TOKEN="${F5XC_API_TOKEN:-}"
NAMESPACE="r-mordasiewicz"
AZURE_LOCATION="${AZURE_LOCATION:-canadaeast}"
AZURE_RG_T2="ar-test-smsv2t2-rg"
AZURE_RG_T3="ar-test-smsv2t3-rg"

if [ -z "${API_URL}" ] || [ -z "${API_TOKEN}" ]; then
  echo "ERROR: F5XC_API_URL and F5XC_API_TOKEN must be set" >&2
  exit 1
fi

# ── API helpers ───────────────────────────────────────────────────────────────

api_call() {
  local method="$1" path="$2" data="${3:-}"
  local code
  for _ in 1 2 3; do
    if [ -n "${data}" ]; then
      code=$(curl -s -o /dev/null -w "%{http_code}" -X "${method}" \
        -H "Authorization: APIToken ${API_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "${data}" "${API_URL}${path}" 2>/dev/null || echo "000")
    else
      code=$(curl -s -o /dev/null -w "%{http_code}" -X "${method}" \
        -H "Authorization: APIToken ${API_TOKEN}" \
        "${API_URL}${path}" 2>/dev/null || echo "000")
    fi
    [ "${code}" != "000" ] && break
    sleep 2
  done
  echo "${code}"
}

api_get()    { api_call GET    "$1"; }
api_post()   { api_call POST   "$1" "$2"; }
api_delete() { api_call DELETE "$1"; }

# ── Cleanup trap ───────────────────────────────────────────────────────────────

cleanup() {
  echo ""
  echo "Cleaning up test resources..."
  # T1 SMSv2 sites (system namespace)
  for code in 1a 1b 2a 2b 3a 3b 4a 4b 5a 5b 6a 6b 7a 7b 8a 8b 9a 9b 10 11a 11b 12a 12b; do
    api_delete "/api/config/namespaces/system/securemesh_site_v2s/ar-test-smsv2-${code}" >/dev/null 2>&1 || true
  done
  # Prerequisite resources (user namespace)
  for rtype in enhanced_firewall_policys forward_proxy_policys global_log_receivers; do
    resources=$(curl -sf \
      -H "Authorization: APIToken ${API_TOKEN}" \
      "${API_URL}/api/config/namespaces/${NAMESPACE}/${rtype}" 2>/dev/null \
      | python3 -c "
import json,sys
d=json.load(sys.stdin)
items=d.get('items',d.get('objects',[]))
for i in items:
    name=i.get('name','') or i.get('metadata',{}).get('name','')
    if name.startswith('ar-test-smsv2-'):
        print(name)
" 2>/dev/null || true)
    for name in ${resources}; do
      api_delete "/api/config/namespaces/${NAMESPACE}/${rtype}/${name}" >/dev/null 2>&1 || true
    done
  done
  # Prerequisite resources (system namespace)
  for rtype in dc_cluster_groups site_mesh_groups; do
    resources=$(curl -sf \
      -H "Authorization: APIToken ${API_TOKEN}" \
      "${API_URL}/api/config/namespaces/system/${rtype}" 2>/dev/null \
      | python3 -c "
import json,sys
d=json.load(sys.stdin)
items=d.get('items',d.get('objects',[]))
for i in items:
    name=i.get('name','') or i.get('metadata',{}).get('name','')
    if name.startswith('ar-test-smsv2-'):
        print(name)
" 2>/dev/null || true)
    for name in ${resources}; do
      api_delete "/api/config/namespaces/system/${rtype}/${name}" >/dev/null 2>&1 || true
    done
  done
  # T2 and T3 Azure resource groups
  if command -v az &>/dev/null; then
    az group delete --name "${AZURE_RG_T2}" --yes --no-wait 2>/dev/null || true
    az group delete --name "${AZURE_RG_T3}" --yes --no-wait 2>/dev/null || true
  fi
  # T2 and T3 F5 XC site objects
  api_delete "/api/config/namespaces/system/securemesh_site_v2s/ar-test-smsv2-t2-site" >/dev/null 2>&1 || true
  api_delete "/api/config/namespaces/system/securemesh_site_v2s/ar-test-smsv2-t3-site-a" >/dev/null 2>&1 || true
  api_delete "/api/config/namespaces/system/securemesh_site_v2s/ar-test-smsv2-t3-site-b" >/dev/null 2>&1 || true
  api_delete "/api/config/namespaces/system/site_mesh_groups/ar-test-smsv2-t3-smg" >/dev/null 2>&1 || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT
mkdir -p "${WORK_DIR}"

# ── Prerequisite helpers ───────────────────────────────────────────────────────

create_prerequisites() {
  local phrase_idx="$1"
  local phrases_file="$2"
  python3 -c "
import yaml, json, sys
with open(sys.argv[1]) as f:
    data = yaml.safe_load(f)
prereqs = data['phrases'][int(sys.argv[2])].get('prerequisites', [])
json.dump(prereqs, sys.stdout)
" "${phrases_file}" "${phrase_idx}" > "${WORK_DIR}/prereqs_${phrase_idx}.json"

  python3 - "${WORK_DIR}/prereqs_${phrase_idx}.json" <<'PYEOF'
import json, urllib.request, sys, os
prereqs = json.load(open(sys.argv[1]))
token = os.environ['F5XC_API_TOKEN']
api_url = os.environ['F5XC_API_URL']
for p in prereqs:
    url = f'{api_url}/api/config/namespaces/{p["namespace"]}/{p["api_path"]}'
    payload = json.loads(p['payload'])
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
        headers={'Authorization': f'APIToken {token}', 'Content-Type': 'application/json'}, method='POST')
    try:
        urllib.request.urlopen(req, timeout=15)
        print(f'prereq created: {p["type"]} {p["name"]}')
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        if 'already exists' in body or e.code == 409:
            print(f'prereq exists: {p["type"]} {p["name"]}')
        else:
            print(f'prereq FAIL {e.code}: {p["type"]} {p["name"]} - {body[:100]}', file=sys.stderr)
PYEOF
}

delete_prerequisites() {
  local phrase_idx="$1"
  [ -f "${WORK_DIR}/prereqs_${phrase_idx}.json" ] || return 0
  python3 - "${WORK_DIR}/prereqs_${phrase_idx}.json" <<'PYEOF'
import json, urllib.request, sys, os
prereqs = json.load(open(sys.argv[1]))
token = os.environ['F5XC_API_TOKEN']
api_url = os.environ['F5XC_API_URL']
for p in prereqs:
    url = f'{api_url}/api/config/namespaces/{p["namespace"]}/{p["api_path"]}/{p["name"]}'
    req = urllib.request.Request(url, headers={'Authorization': f'APIToken {token}'}, method='DELETE')
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass
PYEOF
}

# ── T1: Payload correctness ────────────────────────────────────────────────────

run_t1() {
  echo "=== T1: Payload Correctness (23 option tests) ==="
  echo ""

  phrases_json="${WORK_DIR}/phrases.json"
  python3 -c "
import yaml, json
with open('${PHRASES_FILE}') as f:
    data = yaml.safe_load(f)
json.dump(data['phrases'], open('${phrases_json}', 'w'))
"
  phrase_count=$(python3 -c "import json; print(len(json.load(open('${phrases_json}'))))")
  echo "Loaded ${phrase_count} option phrases"
  echo ""

  t1_total=0
  t1_pass=0
  t1_failures_json="[]"
  t1_xcsh_issues=0
  t1_spec_issues=0

  for idx in $(seq 0 $((phrase_count - 1))); do
    python3 -c "
import json
phrases = json.load(open('${phrases_json}'))
p = phrases[${idx}]
json.dump({
    'id': p['id'],
    'option_group': p['option_group'],
    'option_field': p['option_field'],
    'site_name': p['site_name'],
    'phrase': p['phrase'],
}, open('${WORK_DIR}/p${idx}.json', 'w'))
"
    option_id=$(python3 -c "import json; print(json.load(open('${WORK_DIR}/p${idx}.json'))['id'])")
    option_field=$(python3 -c "import json; print(json.load(open('${WORK_DIR}/p${idx}.json'))['option_field'])")
    site_name=$(python3 -c "import json; print(json.load(open('${WORK_DIR}/p${idx}.json'))['site_name'])")
    phrase=$(python3 -c "import json; print(json.load(open('${WORK_DIR}/p${idx}.json'))['phrase'])")

    t1_total=$((t1_total + 1))
    echo "[$((idx + 1))/${phrase_count}] ${option_id}/${option_field}: ${phrase:0:70}..."

    # Create prerequisites before calling xcsh
    create_prerequisites "${idx}" "${PHRASES_FILE}" 2>/dev/null || true

    # Call xcsh
    response=""
    if command -v xcsh &>/dev/null; then
      response=$(timeout 120 xcsh --print --no-session "${phrase}" 2>/dev/null || echo "")
    else
      echo "  SKIP: xcsh not in PATH"
      t1_total=$((t1_total - 1))
      delete_prerequisites "${idx}" 2>/dev/null || true
      echo ""
      continue
    fi

    # Verify site was created via direct API call
    http_code=$(api_get "/api/config/namespaces/system/securemesh_site_v2s/${site_name}")

    op_pass=0
    error_type="UNKNOWN"
    fix_repo="xcsh"

    if [ "${http_code}" = "200" ]; then
      op_pass=1
      t1_pass=$((t1_pass + 1))
    else
      if echo "${response}" | grep -qiE "api call|POST|xcsh_api|securemesh|400|401|403|422|500"; then
        error_type="API_REJECTED"
        fix_repo="api-specs-enriched"
        t1_spec_issues=$((t1_spec_issues + 1))
      else
        error_type="NO_API_CALL"
        fix_repo="xcsh"
        t1_xcsh_issues=$((t1_xcsh_issues + 1))
      fi
    fi

    status="FAIL"
    [ "${op_pass}" -eq 1 ] && status="PASS"
    echo "  ${status}: option=${option_field} http=${http_code} fix=${fix_repo}"

    if [ "${op_pass}" -eq 0 ]; then
      phrase_escaped=$(python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))" <<< "${phrase}")
      t1_failures_json=$(python3 -c "
import json, sys
failures = json.loads(sys.argv[1])
failures.append({
    'id': '${option_id}',
    'option_field': '${option_field}',
    'site_name': '${site_name}',
    'phrase': json.loads(sys.argv[2]),
    'error_type': '${error_type}',
    'http_code': '${http_code}',
    'fix_repo': '${fix_repo}',
})
print(json.dumps(failures))
" "${t1_failures_json}" "${phrase_escaped}")
    fi

    # Clean up site and prerequisites after each test
    api_delete "/api/config/namespaces/system/securemesh_site_v2s/${site_name}" >/dev/null 2>&1 || true
    delete_prerequisites "${idx}" 2>/dev/null || true
    echo ""
  done

  echo ""
  echo "T1 complete: ${t1_pass}/${t1_total} passed"
  echo ""

  T1_TOTAL="${t1_total}"
  T1_PASS="${t1_pass}"
  T1_FAILURES="${t1_failures_json}"
  T1_XCSH_ISSUES="${t1_xcsh_issues}"
  T1_SPEC_ISSUES="${t1_spec_issues}"
}

run_t1

# ── T2: CE Deployment ─────────────────────────────────────────────────────────

run_t2() {
  echo "=== T2: CE Deployment ==="
  echo ""

  if ! command -v az &>/dev/null; then
    echo "SKIP T2: Azure CLI not available"
    T2_SCORE="skipped"
    return 0
  fi
  if ! az account show &>/dev/null 2>&1; then
    echo "SKIP T2: Azure CLI not authenticated (run: az login)"
    T2_SCORE="skipped"
    return 0
  fi

  local site_name="ar-test-smsv2-t2-site"
  local token_name="ar-test-smsv2-t2-token"
  local vm_name="ar-test-smsv2-t2-ce"
  local vnet_name="ar-test-smsv2-t2-vnet"

  echo "Step 1: Create F5 XC registration token"
  api_post "/api/register/namespaces/system/tokens" \
    "{\"metadata\":{\"name\":\"${token_name}\",\"namespace\":\"system\"},\"spec\":{}}" >/dev/null 2>&1 || true
  token_uid=$(curl -sf \
    -H "Authorization: APIToken ${API_TOKEN}" \
    "${API_URL}/api/register/namespaces/system/tokens/${token_name}" 2>/dev/null \
    | python3 -c "
import json,sys
d=json.load(sys.stdin)
uid=d.get('system_metadata',{}).get('uid','') or d.get('uid','') or d.get('spec',{}).get('uid','')
print(uid)
" 2>/dev/null || echo "")
  if [ -z "${token_uid}" ]; then
    echo "FAIL T2: could not retrieve token UID"
    T2_SCORE=0
    return 0
  fi
  echo "  Token UID: ${token_uid}"

  echo "Step 2: Create SMSv2 site object"
  site_payload="{\"metadata\":{\"name\":\"${site_name}\",\"namespace\":\"system\"},\"spec\":{\"azure\":{\"not_managed\":{\"node_list\":[]}},\"disable_ha\":{},\"block_all_services\":{},\"no_network_policy\":{},\"no_forward_proxy\":{},\"f5_proxy\":{},\"no_proxy_bypass\":{},\"logs_streaming_disabled\":{},\"no_s2s_connectivity_sli\":{},\"no_s2s_connectivity_slo\":{},\"disable_url_categorization\":{},\"disable_management_network\":{}}}"
  site_code=$(api_post "/api/config/namespaces/system/securemesh_site_v2s" "${site_payload}")
  if [ "${site_code}" != "200" ]; then
    echo "FAIL T2: site create returned ${site_code}"
    api_delete "/api/register/namespaces/system/tokens/${token_name}" >/dev/null 2>&1 || true
    T2_SCORE=0
    return 0
  fi
  echo "  Site created: ${site_name}"

  echo "Step 3: Build cloud-init user-data"
  cloud_init="${WORK_DIR}/t2-cloud-init.yaml"
  cat > "${cloud_init}" << CLOUDINIT
#cloud-config
write_files:
  - path: /etc/vpm/config.yaml
    content: |
      Vpm:
        ClusterName: ${site_name}
        ClusterType: ce
        CertifiedHardware: generic-regular-nic-voltmesh
        Token: ${token_uid}
        Latitude: 43.7
        Longitude: -79.4
        MauricePrivateEndpoint: https://register-tls.ves.volterra.io
        MauriceEndpoint: https://register.ves.volterra.io
      Kubernetes:
        EtcdUseTLS: True
        Server: vip
  - path: /etc/vpm/certified-hardware.yaml
    content: |
      active: generic-regular-nic-voltmesh
      primaryOutsideNic: eth0
      certifiedHardware:
        generic-regular-nic-voltmesh:
          outsideNic:
            - eth0
          Vpm:
            PrivateNIC: eth0
runcmd:
  - mkdir -p /etc/systemd/network
  - systemctl restart vpm
CLOUDINIT

  echo "Step 4: Provision Azure infrastructure"
  az group create --name "${AZURE_RG_T2}" --location "${AZURE_LOCATION}" --output none

  az network vnet create \
    --resource-group "${AZURE_RG_T2}" \
    --name "${vnet_name}" \
    --address-prefix "10.200.0.0/16" \
    --output none

  az network vnet subnet create \
    --resource-group "${AZURE_RG_T2}" \
    --vnet-name "${vnet_name}" --name "outside" \
    --address-prefix "10.200.1.0/24" --output none

  az network vnet subnet create \
    --resource-group "${AZURE_RG_T2}" \
    --vnet-name "${vnet_name}" --name "inside" \
    --address-prefix "10.200.2.0/24" --output none

  az network nsg create \
    --resource-group "${AZURE_RG_T2}" \
    --name "ar-test-smsv2-t2-nsg" --output none

  az network nsg rule create \
    --resource-group "${AZURE_RG_T2}" \
    --nsg-name "ar-test-smsv2-t2-nsg" \
    --name "allow-all-inbound" --priority 100 \
    --protocol "*" --source-address-prefixes "*" \
    --destination-address-prefixes "*" \
    --destination-port-ranges "*" \
    --access Allow --direction Inbound --output none

  az network nic create \
    --resource-group "${AZURE_RG_T2}" --name "nic-outside" \
    --vnet-name "${vnet_name}" --subnet "outside" \
    --network-security-group "ar-test-smsv2-t2-nsg" \
    --ip-forwarding true --output none

  az network nic create \
    --resource-group "${AZURE_RG_T2}" --name "nic-inside" \
    --vnet-name "${vnet_name}" --subnet "inside" \
    --ip-forwarding true --output none

  IMAGE=$(az vm image list \
    --publisher volterraedge --all \
    --query "[?contains(offer,'voltmesh_node') || contains(offer,'entcloud')].urn | [-1]" \
    -o tsv 2>/dev/null || echo "")
  if [ -z "${IMAGE}" ]; then
    echo "FAIL T2: could not find F5 XC CE image from publisher volterraedge"
    T2_SCORE=0
    return 0
  fi
  echo "  Using image: ${IMAGE}"
  az vm image terms accept --urn "${IMAGE}" --output none 2>/dev/null || true

  az vm create \
    --resource-group "${AZURE_RG_T2}" \
    --name "${vm_name}" \
    --size "Standard_D4_v3" \
    --image "${IMAGE}" \
    --nics "nic-outside" "nic-inside" \
    --admin-username azureuser \
    --generate-ssh-keys \
    --custom-data "${cloud_init}" \
    --output none
  echo "  VM deployed: ${vm_name}"

  echo "Step 5: Poll for registration (up to 20 min)"
  local reg_name=""
  local deadline=$(($(date +%s) + 1200))
  while [ "$(date +%s)" -lt "${deadline}" ]; do
    # List returns null specs — iterate names and GET each to find cluster match
    reg_name=$(curl -sf \
      -H "Authorization: APIToken ${API_TOKEN}" \
      "${API_URL}/api/register/namespaces/system/registrations" 2>/dev/null \
      | python3 - "${site_name}" "${API_URL}" "${API_TOKEN}" <<'PYEOF'
import json, sys, urllib.request
site = sys.argv[1]; api = sys.argv[2]; tok = sys.argv[3]
d = json.load(sys.stdin)
for item in d.get('items', d.get('objects', [])):
    name = item.get('name','') or (item.get('metadata') or {}).get('name','')
    if not name: continue
    try:
        r = urllib.request.urlopen(urllib.request.Request(
            f'{api}/api/register/namespaces/system/registrations/{name}',
            headers={'Authorization': f'APIToken {tok}'}), timeout=5)
        body = json.load(r)
        spec = body.get('spec') or {}
        cluster = spec.get('cluster_name','') or (spec.get('passport') or {}).get('cluster_name','')
        if site in cluster:
            print(name)
            break
    except Exception:
        pass
PYEOF
    )
    if [ -n "${reg_name}" ]; then
      echo "  Registration found: ${reg_name}"
      break
    fi
    echo "  Waiting for registration... ($(( (deadline - $(date +%s)) / 60 ))m left)"
    sleep 30
  done

  if [ -z "${reg_name}" ]; then
    echo "FAIL T2: no registration appeared within 20 minutes"
    T2_SCORE=0
    return 0
  fi

  echo "Step 6: Approve registration"
  passport=$(curl -sf \
    -H "Authorization: APIToken ${API_TOKEN}" \
    "${API_URL}/api/register/namespaces/system/registrations/${reg_name}" 2>/dev/null \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps((d.get('spec') or {}).get('passport') or {}))" \
    2>/dev/null || echo "{}")
  # Approve URL uses singular /registration/ not plural /registrations/
  api_post "/api/register/namespaces/system/registration/${reg_name}/approve" \
    "{\"name\":\"${reg_name}\",\"namespace\":\"system\",\"passport\":${passport},\"state\":\"PENDING\"}" >/dev/null 2>&1 || true
  sleep 3
  api_post "/api/register/namespaces/system/registration/${reg_name}/approve" \
    "{\"name\":\"${reg_name}\",\"namespace\":\"system\",\"passport\":${passport},\"state\":\"APPROVED\"}" >/dev/null 2>&1 || true
  echo "  Approval sent"

  echo "Step 7: Poll for ONLINE state (up to 30 min)"
  local online_deadline=$(($(date +%s) + 1800))
  local reg_state=""
  while [ "$(date +%s)" -lt "${online_deadline}" ]; do
    # State is at object.status.current_state (not spec.state)
    reg_state=$(curl -sf \
      -H "Authorization: APIToken ${API_TOKEN}" \
      "${API_URL}/api/register/namespaces/system/registrations/${reg_name}" 2>/dev/null \
      | python3 -c "import json,sys; d=json.load(sys.stdin); print(((d.get('object') or {}).get('status') or d.get('status') or {}).get('current_state',''))" \
      2>/dev/null || echo "")
    echo "  State: ${reg_state} ($(( (online_deadline - $(date +%s)) / 60 ))m left)"
    [ "${reg_state}" = "ONLINE" ] && break
    sleep 60
  done

  if [ "${reg_state}" = "ONLINE" ]; then
    echo "T2 PASS: CE registration ONLINE"
    T2_SCORE=100
  else
    echo "T2 FAIL: state=${reg_state} (expected ONLINE)"
    T2_SCORE=0
  fi

  # Cleanup T2
  az group delete --name "${AZURE_RG_T2}" --yes --no-wait 2>/dev/null || true
  api_delete "/api/config/namespaces/system/securemesh_site_v2s/${site_name}" >/dev/null 2>&1 || true
  api_delete "/api/register/namespaces/system/tokens/${token_name}" >/dev/null 2>&1 || true
}

run_t2

# ── T3: Mesh Connectivity ──────────────────────────────────────────────────────

run_t3() {
  echo "=== T3: Mesh Connectivity ==="
  echo ""

  if ! command -v az &>/dev/null || ! az account show &>/dev/null 2>&1; then
    echo "SKIP T3: Azure CLI not available or not authenticated"
    T3_SCORE="skipped"
    return 0
  fi

  local smg_name="ar-test-smsv2-t3-smg"
  local site_a="ar-test-smsv2-t3-site-a"
  local site_b="ar-test-smsv2-t3-site-b"
  local token_a="ar-test-smsv2-t3-token-a"
  local token_b="ar-test-smsv2-t3-token-b"
  local vnet_name="ar-test-smsv2-t3-vnet"

  echo "Step 1: Create site_mesh_group"
  smg_code=$(api_post "/api/config/namespaces/system/site_mesh_groups" \
    "{\"metadata\":{\"name\":\"${smg_name}\",\"namespace\":\"system\"},\"spec\":{\"type\":\"SITE_MESH_GROUP_TYPE_FULL_MESH\",\"tunnel_type\":\"SITE_TO_SITE_TUNNEL_IPSEC\",\"full_mesh\":{\"data_plane_mesh\":{}},\"bfd_disabled\":{}}}")
  if [ "${smg_code}" != "200" ]; then
    echo "FAIL T3: site_mesh_group create returned ${smg_code}"
    T3_SCORE=0
    return 0
  fi
  echo "  site_mesh_group created: ${smg_name}"

  echo "Step 2: Create registration tokens"
  for tok_name in "${token_a}" "${token_b}"; do
    api_post "/api/register/namespaces/system/tokens" \
      "{\"metadata\":{\"name\":\"${tok_name}\",\"namespace\":\"system\"},\"spec\":{}}" >/dev/null 2>&1 || true
  done
  token_uid_a=$(curl -sf \
    -H "Authorization: APIToken ${API_TOKEN}" \
    "${API_URL}/api/register/namespaces/system/tokens/${token_a}" 2>/dev/null \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('system_metadata',{}).get('uid','') or d.get('uid','') or d.get('spec',{}).get('uid',''))" 2>/dev/null || echo "")
  token_uid_b=$(curl -sf \
    -H "Authorization: APIToken ${API_TOKEN}" \
    "${API_URL}/api/register/namespaces/system/tokens/${token_b}" 2>/dev/null \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('system_metadata',{}).get('uid','') or d.get('uid','') or d.get('spec',{}).get('uid',''))" 2>/dev/null || echo "")

  if [ -z "${token_uid_a}" ] || [ -z "${token_uid_b}" ]; then
    echo "FAIL T3: could not retrieve token UIDs"
    T3_SCORE=0
    return 0
  fi

  echo "Step 3: Create SMSv2 site objects"
  # Site A: no s2s on SLO (baseline CE)
  api_post "/api/config/namespaces/system/securemesh_site_v2s" \
    "{\"metadata\":{\"name\":\"${site_a}\",\"namespace\":\"system\"},\"spec\":{\"azure\":{\"not_managed\":{\"node_list\":[]}},\"disable_ha\":{},\"block_all_services\":{},\"no_network_policy\":{},\"no_forward_proxy\":{},\"f5_proxy\":{},\"no_proxy_bypass\":{},\"logs_streaming_disabled\":{},\"no_s2s_connectivity_sli\":{},\"no_s2s_connectivity_slo\":{},\"disable_url_categorization\":{},\"disable_management_network\":{}}}" >/dev/null 2>&1 || true
  # Site B: joined to site_mesh_group on SLO
  api_post "/api/config/namespaces/system/securemesh_site_v2s" \
    "{\"metadata\":{\"name\":\"${site_b}\",\"namespace\":\"system\"},\"spec\":{\"azure\":{\"not_managed\":{\"node_list\":[]}},\"disable_ha\":{},\"block_all_services\":{},\"no_network_policy\":{},\"no_forward_proxy\":{},\"f5_proxy\":{},\"no_proxy_bypass\":{},\"logs_streaming_disabled\":{},\"no_s2s_connectivity_sli\":{},\"site_mesh_group_on_slo\":{\"name\":\"${smg_name}\",\"namespace\":\"system\"},\"disable_url_categorization\":{},\"disable_management_network\":{}}}" >/dev/null 2>&1 || true
  echo "  Sites created: ${site_a}, ${site_b}"

  echo "Step 4: Build cloud-init configs"
  for suffix in a b; do
    if [ "${suffix}" = "a" ]; then
      cluster="${site_a}"
      tok="${token_uid_a}"
    else
      cluster="${site_b}"
      tok="${token_uid_b}"
    fi
    cat > "${WORK_DIR}/t3-cloud-init-${suffix}.yaml" << CLOUDINIT
#cloud-config
write_files:
  - path: /etc/vpm/config.yaml
    content: |
      Vpm:
        ClusterName: ${cluster}
        ClusterType: ce
        CertifiedHardware: generic-regular-nic-voltmesh
        Token: ${tok}
        Latitude: 43.7
        Longitude: -79.4
        MauricePrivateEndpoint: https://register-tls.ves.volterra.io
        MauriceEndpoint: https://register.ves.volterra.io
      Kubernetes:
        EtcdUseTLS: True
        Server: vip
  - path: /etc/vpm/certified-hardware.yaml
    content: |
      active: generic-regular-nic-voltmesh
      primaryOutsideNic: eth0
      certifiedHardware:
        generic-regular-nic-voltmesh:
          outsideNic:
            - eth0
          Vpm:
            PrivateNIC: eth0
runcmd:
  - mkdir -p /etc/systemd/network
  - systemctl restart vpm
CLOUDINIT
  done

  echo "Step 5: Provision Azure infrastructure (shared VNet, 4 subnets)"
  az group create --name "${AZURE_RG_T3}" --location "${AZURE_LOCATION}" --output none

  az network vnet create \
    --resource-group "${AZURE_RG_T3}" \
    --name "${vnet_name}" \
    --address-prefix "10.201.0.0/16" --output none

  for subnet_pair in "outside-a:10.201.1.0/24" "inside-a:10.201.2.0/24" "outside-b:10.201.3.0/24" "inside-b:10.201.4.0/24"; do
    subnet_name="${subnet_pair%%:*}"
    prefix="${subnet_pair##*:}"
    az network vnet subnet create \
      --resource-group "${AZURE_RG_T3}" \
      --vnet-name "${vnet_name}" \
      --name "${subnet_name}" \
      --address-prefix "${prefix}" --output none
  done

  az network nsg create \
    --resource-group "${AZURE_RG_T3}" \
    --name "ar-test-smsv2-t3-nsg" --output none
  az network nsg rule create \
    --resource-group "${AZURE_RG_T3}" \
    --nsg-name "ar-test-smsv2-t3-nsg" \
    --name "allow-all-inbound" --priority 100 \
    --protocol "*" --source-address-prefixes "*" \
    --destination-address-prefixes "*" \
    --destination-port-ranges "*" \
    --access Allow --direction Inbound --output none

  IMAGE=$(az vm image list \
    --publisher volterraedge --all \
    --query "[?contains(offer,'voltmesh_node') || contains(offer,'entcloud')].urn | [-1]" \
    -o tsv 2>/dev/null || echo "")
  if [ -z "${IMAGE}" ]; then
    echo "FAIL T3: could not find CE image"
    T3_SCORE=0
    return 0
  fi
  az vm image terms accept --urn "${IMAGE}" --output none 2>/dev/null || true

  for suffix in a b; do
    az network nic create \
      --resource-group "${AZURE_RG_T3}" \
      --name "nic-outside-${suffix}" \
      --vnet-name "${vnet_name}" --subnet "outside-${suffix}" \
      --network-security-group "ar-test-smsv2-t3-nsg" \
      --ip-forwarding true --output none
    az network nic create \
      --resource-group "${AZURE_RG_T3}" \
      --name "nic-inside-${suffix}" \
      --vnet-name "${vnet_name}" --subnet "inside-${suffix}" \
      --ip-forwarding true --output none
    az vm create \
      --resource-group "${AZURE_RG_T3}" \
      --name "ar-test-smsv2-t3-ce${suffix}" \
      --size "Standard_D4_v3" --image "${IMAGE}" \
      --nics "nic-outside-${suffix}" "nic-inside-${suffix}" \
      --admin-username azureuser --generate-ssh-keys \
      --custom-data "${WORK_DIR}/t3-cloud-init-${suffix}.yaml" \
      --output none
    echo "  VM ${suffix} deployed"
  done

  echo "Step 6: Poll for both registrations (up to 25 min)"
  local deadline=$(($(date +%s) + 1500))
  local reg_a="" reg_b=""
  while [ "$(date +%s)" -lt "${deadline}" ]; do
    # List returns null specs — GET each registration individually to find cluster match
    all_regs=$(curl -sf \
      -H "Authorization: APIToken ${API_TOKEN}" \
      "${API_URL}/api/register/namespaces/system/registrations" 2>/dev/null \
      | python3 - "${site_a}" "${site_b}" "${API_URL}" "${API_TOKEN}" <<'PYEOF'
import json, sys, urllib.request
site_a=sys.argv[1]; site_b=sys.argv[2]; api=sys.argv[3]; tok=sys.argv[4]
d=json.load(sys.stdin)
result={}
for item in d.get('items',d.get('objects',[])):
    name=item.get('name','') or (item.get('metadata') or {}).get('name','')
    if not name or name in result.values(): continue
    try:
        r=urllib.request.urlopen(urllib.request.Request(
            f'{api}/api/register/namespaces/system/registrations/{name}',
            headers={'Authorization':f'APIToken {tok}'}),timeout=5)
        body=json.load(r)
        spec=body.get('spec') or {}
        cluster=spec.get('cluster_name','') or (spec.get('passport') or {}).get('cluster_name','')
        if site_a in cluster: result['a']=name
        elif site_b in cluster: result['b']=name
        if 'a' in result and 'b' in result: break
    except Exception: pass
print(json.dumps(result))
PYEOF
    )
    reg_a=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('a',''))" "${all_regs}")
    reg_b=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('b',''))" "${all_regs}")
    echo "  Registrations: a=${reg_a:-waiting} b=${reg_b:-waiting} ($(( (deadline - $(date +%s)) / 60 ))m left)"
    [ -n "${reg_a}" ] && [ -n "${reg_b}" ] && break
    sleep 30
  done

  if [ -z "${reg_a}" ] || [ -z "${reg_b}" ]; then
    echo "FAIL T3: registrations did not appear (a=${reg_a:-missing} b=${reg_b:-missing})"
    T3_SCORE=0
    return 0
  fi

  echo "Step 7: Approve both registrations"
  for reg_name in "${reg_a}" "${reg_b}"; do
    passport=$(curl -sf \
      -H "Authorization: APIToken ${API_TOKEN}" \
      "${API_URL}/api/register/namespaces/system/registrations/${reg_name}" 2>/dev/null \
      | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps((d.get('spec') or {}).get('passport') or {}))" \
      2>/dev/null || echo "{}")
    # Approve URL uses singular /registration/ not plural /registrations/
    api_post "/api/register/namespaces/system/registration/${reg_name}/approve" \
      "{\"name\":\"${reg_name}\",\"namespace\":\"system\",\"passport\":${passport},\"state\":\"PENDING\"}" >/dev/null 2>&1 || true
    sleep 3
    api_post "/api/register/namespaces/system/registration/${reg_name}/approve" \
      "{\"name\":\"${reg_name}\",\"namespace\":\"system\",\"passport\":${passport},\"state\":\"APPROVED\"}" >/dev/null 2>&1 || true
    echo "  Approved: ${reg_name}"
  done

  echo "Step 8: Poll for both CEs ONLINE (up to 35 min)"
  local online_deadline=$(($(date +%s) + 2100))
  local state_a="" state_b=""
  while [ "$(date +%s)" -lt "${online_deadline}" ]; do
    # State is at object.status.current_state (not spec.state)
    state_a=$(curl -sf \
      -H "Authorization: APIToken ${API_TOKEN}" \
      "${API_URL}/api/register/namespaces/system/registrations/${reg_a}" 2>/dev/null \
      | python3 -c "import json,sys; d=json.load(sys.stdin); print(((d.get('object') or {}).get('status') or d.get('status') or {}).get('current_state',''))" 2>/dev/null || echo "")
    state_b=$(curl -sf \
      -H "Authorization: APIToken ${API_TOKEN}" \
      "${API_URL}/api/register/namespaces/system/registrations/${reg_b}" 2>/dev/null \
      | python3 -c "import json,sys; d=json.load(sys.stdin); print(((d.get('object') or {}).get('status') or d.get('status') or {}).get('current_state',''))" 2>/dev/null || echo "")
    echo "  States: a=${state_a} b=${state_b} ($(( (online_deadline - $(date +%s)) / 60 ))m left)"
    [ "${state_a}" = "ONLINE" ] && [ "${state_b}" = "ONLINE" ] && break
    sleep 60
  done

  if [ "${state_a}" = "ONLINE" ] && [ "${state_b}" = "ONLINE" ]; then
    echo "T3 PASS: both CEs ONLINE — mesh plumbing verified"
    T3_SCORE=100
  else
    echo "T3 FAIL: state_a=${state_a} state_b=${state_b} (both must be ONLINE)"
    T3_SCORE=0
  fi

  # Cleanup T3
  az group delete --name "${AZURE_RG_T3}" --yes --no-wait 2>/dev/null || true
  for site in "${site_a}" "${site_b}"; do
    api_delete "/api/config/namespaces/system/securemesh_site_v2s/${site}" >/dev/null 2>&1 || true
  done
  api_delete "/api/config/namespaces/system/site_mesh_groups/${smg_name}" >/dev/null 2>&1 || true
  for tok_name in "${token_a}" "${token_b}"; do
    api_delete "/api/register/namespaces/system/tokens/${tok_name}" >/dev/null 2>&1 || true
  done
}

run_t3

# ── Score emission ─────────────────────────────────────────────────────────────
python3 - "${T2_SCORE}" "${T3_SCORE}" << PYEOF
import sys
t1_total = ${T1_TOTAL}
t1_pass = ${T1_PASS}
t2_score = sys.argv[1]
t3_score = sys.argv[2]
payload_score = round(t1_pass / max(1, t1_total) * 100, 1)
print(f'METRIC smsv2_payload_score={payload_score}')
print(f'METRIC smsv2_deployment_score={t2_score}')
print(f'METRIC smsv2_mesh_score={t3_score}')
print(f'METRIC smsv2_t1_tests={t1_total}')
PYEOF

cross_repo_json=$(python3 -c "
import json
print(json.dumps({'xcsh': ${T1_XCSH_ISSUES}, 'api-specs-enriched': ${T1_SPEC_ISSUES}, 'terraform-provider-f5xc': 0}))
")
echo "ASI failures=${T1_FAILURES}"
echo "ASI cross_repo_issues=${cross_repo_json}"
