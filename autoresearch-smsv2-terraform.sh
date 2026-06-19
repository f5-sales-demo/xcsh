#!/usr/bin/env bash
set -euo pipefail

# SMSv2 Terraform Option Matrix Benchmark
# T1: Validate (23 option tests — xcsh generates HCL → terraform validate)
# T2: CE deployment (terraform apply Azure CE → registration ONLINE)
# T3: Mesh connectivity (terraform apply 2 CEs + site_mesh_group → both ONLINE)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PHRASES_FILE="${PHRASES_FILE:-${SCRIPT_DIR}/autoresearch-smsv2-terraform-phrases.yaml}"
WORK_DIR="/tmp/ar-smsv2-tf-$$"
API_URL="${F5XC_API_URL:-}"
API_TOKEN="${F5XC_API_TOKEN:-}"
AZURE_LOCATION="${AZURE_LOCATION:-canadaeast}"
TF_CLI_CONFIG_FILE="${TF_CLI_CONFIG_FILE:-}"

if [ -z "${API_URL}" ] || [ -z "${API_TOKEN}" ]; then
  echo "ERROR: F5XC_API_URL and F5XC_API_TOKEN must be set" >&2
  exit 1
fi

cleanup() {
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT
mkdir -p "${WORK_DIR}"

# ── Error classification ───────────────────────────────────────────────────────

classify_tf_error() {
  local error_text="$1"
  local hcl_output="$2"
  if [ -z "${hcl_output}" ]; then
    echo "xcsh"
    return
  fi
  if echo "${error_text}" | grep -qiE "unsupported argument|An argument named|unexpected block|blocks? of type"; then
    echo "terraform-provider-f5xc"
  elif echo "${error_text}" | grep -qiE "one of .+ must be set|required argument|Missing required argument"; then
    echo "terraform-provider-f5xc"
  elif echo "${error_text}" | grep -qiE "404|not found|namespace.*not.*exist|invalid value for"; then
    echo "api-specs-enriched"
  else
    echo "xcsh"
  fi
}

classify_tf_error_type() {
  local error_text="$1"
  local hcl_output="$2"
  if [ -z "${hcl_output}" ]; then
    echo "NO_TF_OUTPUT"
    return
  fi
  if echo "${error_text}" | grep -qiE "unsupported argument|An argument named|unexpected block"; then
    echo "UNSUPPORTED_ARGUMENT"
  elif echo "${error_text}" | grep -qiE "one of .+ must be set|required argument|Missing required"; then
    echo "MISSING_ONEOF"
  elif echo "${error_text}" | grep -qiE "404|not found|namespace.*not.*exist"; then
    echo "NAMESPACE_NOT_FOUND"
  elif echo "${error_text}" | grep -qiE "invalid value for|invalid configuration"; then
    echo "INVALID_CONFIG"
  else
    echo "OTHER"
  fi
}

# ── T1: Terraform validate/plan ─────────────────────────────────────────────────

run_t1() {
  echo "=== T1: Terraform Validate (23 option tests) ==="
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
  t1_validate_pass=0
  t1_fmt_pass=0
  t1_plan_pass=0
  t1_failures_json="[]"
  t1_xcsh_issues=0
  t1_provider_issues=0
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
    'resource_name': p['resource_name'],
    'phrase': p['phrase'],
}, open('${WORK_DIR}/p${idx}.json', 'w'))
"
    option_id=$(python3 -c "import json; print(json.load(open('${WORK_DIR}/p${idx}.json'))['id'])")
    option_field=$(python3 -c "import json; print(json.load(open('${WORK_DIR}/p${idx}.json'))['option_field'])")
    resource_name=$(python3 -c "import json; print(json.load(open('${WORK_DIR}/p${idx}.json'))['resource_name'])")
    phrase=$(python3 -c "import json; print(json.load(open('${WORK_DIR}/p${idx}.json'))['phrase'])")

    t1_total=$((t1_total + 1))
    echo "[$((idx + 1))/${phrase_count}] ${option_id}/${option_field}: ${phrase:0:70}..."

    ws="${WORK_DIR}/ws_${idx}"
    mkdir -p "${ws}"

    # Call xcsh to generate HCL
    hcl_output=""
    if command -v xcsh &>/dev/null; then
      hcl_output=$(timeout 120 xcsh --print --no-session "${phrase}" 2>/dev/null || echo "")
    else
      echo "  SKIP: xcsh not in PATH"
      t1_total=$((t1_total - 1))
      echo ""
      continue
    fi

    # Extract terraform HCL block from xcsh response
    # xcsh writes HCL to a .tf file — snapshot dir before/after to find new files
    tf_code=""
    # Snapshot: record existing .tf files before xcsh call (already happened above)
    # Check for newly-written .tf files by comparing current dir to pre-call state
    # xcsh may use the resource name (ar-test-smsv2-1a.tf) OR the resource type (securemesh_site_v2.tf)
    for candidate in "${resource_name}.tf" "securemesh_site_v2.tf" "f5xc_securemesh_site_v2.tf"; do
      if [ -f "${candidate}" ] && [ "${candidate}" != "ar-test-lb.tf" ]; then
        tf_code=$(cat "${candidate}")
        rm -f "${candidate}" 2>/dev/null || true
        break
      fi
    done
    # Fallback: find any .tf file newer than 3 min in the current dir
    if [ -z "${tf_code}" ]; then
      new_tf=$(find . -maxdepth 1 -name "*.tf" -newer /tmp/smsv2-tf-devrc -not -name "ar-test-lb.tf" 2>/dev/null | head -1 || true)
      if [ -n "${new_tf}" ]; then
        tf_code=$(cat "${new_tf}")
        rm -f "${new_tf}" 2>/dev/null || true
      fi
    fi
    # Check if xcsh mentioned any .tf file in stdout
    if [ -z "${tf_code}" ]; then
      tf_file=$(echo "${hcl_output}" | grep -oE '[a-z0-9_-]+\.tf' | head -1 || true)
      if [ -n "${tf_file}" ] && [ -f "${tf_file}" ]; then
        tf_code=$(cat "${tf_file}")
        rm -f "${tf_file}" 2>/dev/null || true
      fi
    fi
    # Third: try to extract HCL code block from stdout
    if [ -z "${tf_code}" ]; then
      tf_code=$(python3 -c "
import re, sys
response = sys.stdin.read()
# Try to extract HCL code block
matches = re.findall(r'\`\`\`(?:terraform|hcl)\n(.*?)\`\`\`', response, re.DOTALL)
if matches:
    print(matches[-1])
else:
    # Try to find resource block directly
    matches = re.findall(r'(resource\s+\"f5xc_\w+\".*?\n\})', response, re.DOTALL)
    if matches:
        print(matches[-1])
" <<< "${hcl_output}" 2>/dev/null || echo "")
    fi

    if [ -z "${tf_code}" ]; then
      echo "  FAIL: no HCL generated by xcsh"
      t1_xcsh_issues=$((t1_xcsh_issues + 1))
      phrase_escaped=$(python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))" <<< "${phrase}")
      t1_failures_json=$(python3 -c "
import json, sys
failures = json.loads(sys.argv[1])
failures.append({
    'id': sys.argv[3],
    'option_field': sys.argv[4],
    'phrase': json.loads(sys.argv[2]),
    'error_type': 'NO_TF_OUTPUT',
    'fix_repo': 'xcsh',
})
print(json.dumps(failures))
" "${t1_failures_json}" "${phrase_escaped}" "${option_id}" "${option_field}")
      echo ""
      continue
    fi

    # Write workspace files exactly as xcsh produced them.
    # xcsh MUST emit both the terraform{} and provider "f5xc" blocks itself — we
    # score whether it did and NEVER fabricate them, so a missing provider block
    # surfaces as a real failure instead of being silently patched.
    echo "${tf_code}" > "${ws}/main.tf"

    if ! echo "${tf_code}" | grep -q "required_providers" || ! echo "${tf_code}" | grep -q 'provider "f5xc"'; then
      echo "  FAIL: xcsh output missing terraform{}/provider \"f5xc\" block (incomplete config)"
      t1_xcsh_issues=$((t1_xcsh_issues + 1))
      phrase_escaped=$(python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))" <<< "${phrase}")
      t1_failures_json=$(python3 -c "
import json, sys
failures = json.loads(sys.argv[1])
failures.append({
    'id': sys.argv[3],
    'option_field': sys.argv[4],
    'phrase': json.loads(sys.argv[2]),
    'error_type': 'MISSING_PROVIDER_BLOCK',
    'fix_repo': 'xcsh',
})
print(json.dumps(failures))
" "${t1_failures_json}" "${phrase_escaped}" "${option_id}" "${option_field}")
      echo ""
      continue
    fi

    # terraform fmt -check: is xcsh's HCL canonically formatted? (no provider/init needed)
    fmt_exit=0
    terraform -chdir="${ws}" fmt -check -diff -no-color > "${ws}/fmt.out" 2>&1 || fmt_exit=1
    [ "${fmt_exit}" -eq 0 ] && t1_fmt_pass=$((t1_fmt_pass + 1))

    # terraform init
    init_out=""
    if [ -n "${TF_CLI_CONFIG_FILE}" ]; then
      init_out=$(TF_CLI_CONFIG_FILE="${TF_CLI_CONFIG_FILE}" terraform -chdir="${ws}" init -backend=false -input=false -no-color 2>&1 || true)
    else
      init_out=$(terraform -chdir="${ws}" init -backend=false -input=false -no-color 2>&1 || true)
    fi

    # terraform validate
    validate_out=""
    validate_exit=1
    if [ -n "${TF_CLI_CONFIG_FILE}" ]; then
      validate_out=$(TF_CLI_CONFIG_FILE="${TF_CLI_CONFIG_FILE}" terraform -chdir="${ws}" validate -no-color 2>&1 || true)
      echo "${validate_out}" | grep -q "Success" && validate_exit=0
    else
      validate_out=$(terraform -chdir="${ws}" validate -no-color 2>&1 || true)
      echo "${validate_out}" | grep -q "Success" && validate_exit=0
    fi

    # terraform plan (only if API credentials available)
    # The empty `provider "f5xc" {}` block reads auth from F5XC_* env vars — no secret written to disk
    plan_exit=0
    plan_out=""
    if [ "${validate_exit}" -eq 0 ] && [ -n "${API_URL}" ] && [ -n "${API_TOKEN}" ]; then
      if [ -n "${TF_CLI_CONFIG_FILE}" ]; then
        plan_out=$(TF_CLI_CONFIG_FILE="${TF_CLI_CONFIG_FILE}" \
          F5XC_API_URL="${API_URL}" F5XC_API_TOKEN="${API_TOKEN}" \
          terraform -chdir="${ws}" plan -no-color -input=false 2>&1 || true)
      else
        plan_out=$(F5XC_API_URL="${API_URL}" F5XC_API_TOKEN="${API_TOKEN}" \
          terraform -chdir="${ws}" plan -no-color -input=false 2>&1 || true)
      fi
      echo "${plan_out}" | grep -qiE "^Plan:|No changes" && plan_exit=0 || plan_exit=1
    fi

    # Record result
    if [ "${validate_exit}" -eq 0 ]; then
      t1_validate_pass=$((t1_validate_pass + 1))
      [ "${plan_exit}" -eq 0 ] && t1_plan_pass=$((t1_plan_pass + 1))
      status="PASS"
      echo "  ${status}: option=${option_field} validate=ok fmt=$([ ${fmt_exit:-1} -eq 0 ] && echo ok || echo unformatted) plan=$([ ${plan_exit} -eq 0 ] && echo ok || echo skip/fail)"
    else
      status="FAIL"
      error_signal=$(echo "${validate_out}" | grep -iE "Error:|error:" | head -1 | cut -c1-200)
      fix_repo=$(classify_tf_error "${validate_out}" "${tf_code}")
      error_type=$(classify_tf_error_type "${validate_out}" "${tf_code}")

      case "${fix_repo}" in
        terraform-provider-f5xc) t1_provider_issues=$((t1_provider_issues + 1)) ;;
        api-specs-enriched) t1_spec_issues=$((t1_spec_issues + 1)) ;;
        *) t1_xcsh_issues=$((t1_xcsh_issues + 1)) ;;
      esac

      phrase_escaped=$(python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))" <<< "${phrase}")
      error_escaped=$(python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))" <<< "${error_signal}")
      t1_failures_json=$(python3 -c "
import json, sys
failures = json.loads(sys.argv[1])
failures.append({
    'id': sys.argv[4],
    'option_field': sys.argv[5],
    'phrase': json.loads(sys.argv[2]),
    'error_type': sys.argv[6],
    'error_signal': json.loads(sys.argv[3]),
    'fix_repo': sys.argv[7],
})
print(json.dumps(failures))
" "${t1_failures_json}" "${phrase_escaped}" "${error_escaped}" "${option_id}" "${option_field}" "${error_type}" "${fix_repo}")

      echo "  ${status}: option=${option_field} fix=${fix_repo} — ${error_signal:0:80}"
    fi
    echo ""
  done

  echo "T1 complete: ${t1_validate_pass}/${t1_total} validate passed, ${t1_fmt_pass}/${t1_total} fmt-clean"
  echo ""

  T1_TOTAL="${t1_total}"
  T1_VALIDATE_PASS="${t1_validate_pass}"
  T1_FMT_PASS="${t1_fmt_pass}"
  T1_PLAN_PASS="${t1_plan_pass}"
  T1_FAILURES="${t1_failures_json}"
  T1_XCSH_ISSUES="${t1_xcsh_issues}"
  T1_PROVIDER_ISSUES="${t1_provider_issues}"
  T1_SPEC_ISSUES="${t1_spec_issues}"
}

run_t1

# ── T2: Terraform apply — Azure CE deployment ─────────────────────────────────

run_t2() {
  echo "=== T2: Terraform Apply — Azure CE Deployment ==="
  echo ""

  if ! command -v az &>/dev/null || ! az account show &>/dev/null 2>&1; then
    echo "SKIP T2: Azure CLI not available or not authenticated"
    T2_SCORE="skipped"
    return 0
  fi

  local t2_ws="${WORK_DIR}/t2"
  mkdir -p "${t2_ws}/scripts"

  # Write registration token creator (external data source)
  cat > "${t2_ws}/scripts/create_token.py" << 'PYEOF'
import json, sys, urllib.request, os
q = json.load(sys.stdin)
api_url = q['api_url']; token = q['api_token']; name = q['token_name']
req = urllib.request.Request(
    f'{api_url}/api/register/namespaces/system/tokens',
    data=json.dumps({"metadata":{"name":name,"namespace":"system"},"spec":{}}).encode(),
    headers={'Authorization':f'APIToken {token}','Content-Type':'application/json'}, method='POST')
try:
    urllib.request.urlopen(req, timeout=15)
except: pass
r = urllib.request.urlopen(urllib.request.Request(
    f'{api_url}/api/register/namespaces/system/tokens/{name}',
    headers={'Authorization':f'APIToken {token}'}), timeout=10)
d = json.loads(r.read())
uid = d.get('system_metadata',{}).get('uid','') or d.get('uid','')
print(json.dumps({'uid': uid}))
PYEOF

  # Write registration approval script (reads credentials from env, not args)
  cat > "${t2_ws}/scripts/approve_registration.sh" << 'SHEOF'
#!/usr/bin/env bash
# Polls for registration matching SITE_NAME (any approachable state) and approves it
# Credentials from environment variables (not process args)
# F5XC may auto-advance state to PENDING before we scan — handle all pre-ONLINE states
API_URL="${API_URL}"; API_TOKEN="${API_TOKEN}"; SITE_NAME="${SITE_NAME}"
deadline=$(($(date +%s) + 1200))
while [ "$(date +%s)" -lt "${deadline}" ]; do
  result=$(curl -sf -H "Authorization: APIToken ${API_TOKEN}" \
    "${API_URL}/api/register/namespaces/system/registrations" 2>/dev/null | \
    python3 -c "
import json,sys,urllib.request,concurrent.futures
d=json.load(sys.stdin)
items=d.get('items',d.get('objects',[]))
names=[item.get('name','') or (item.get('metadata') or {}).get('name','') for item in items]
names=[n for n in names if n]
SKIP={'ONLINE','RETIRED','DELETED','FAILED'}
def check(name):
    try:
        r=urllib.request.urlopen(urllib.request.Request(
            f'${API_URL}/api/register/namespaces/system/registrations/{name}',
            headers={'Authorization':f'APIToken ${API_TOKEN}'}),timeout=4)
        body=json.load(r)
        spec=body.get('spec') or {}
        cluster=spec.get('cluster_name','') or (spec.get('passport') or {}).get('cluster_name','')
        state=((body.get('object') or {}).get('status') or {}).get('current_state','')
        if '${SITE_NAME}' in cluster and state not in SKIP:
            return name + ':' + state
    except: pass
    return None
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
    for r in ex.map(check, names):
        if r:
            print(r)
            break
" 2>/dev/null || echo "")
  reg="${result%%:*}"
  reg_state="${result##*:}"
  if [ -n "${reg}" ]; then
    passport=$(curl -sf -H "Authorization: APIToken ${API_TOKEN}" \
      "${API_URL}/api/register/namespaces/system/registrations/${reg}" 2>/dev/null | \
      python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps((d.get('spec') or {}).get('passport') or {}))" 2>/dev/null || echo "{}")
    # Send PENDING only if state is NEW (F5XC may have auto-advanced to PENDING already)
    if [ "${reg_state}" = "NEW" ]; then
      curl -sf -X POST -H "Authorization: APIToken ${API_TOKEN}" -H "Content-Type: application/json" \
        -d "{\"name\":\"${reg}\",\"namespace\":\"system\",\"passport\":${passport},\"state\":\"PENDING\"}" \
        "${API_URL}/api/register/namespaces/system/registration/${reg}/approve" >/dev/null 2>&1 || true
      sleep 3
    fi
    # Send APPROVED (handles NEW→PENDING→APPROVED or PENDING→APPROVED)
    curl -sf -X POST -H "Authorization: APIToken ${API_TOKEN}" -H "Content-Type: application/json" \
      -d "{\"name\":\"${reg}\",\"namespace\":\"system\",\"passport\":${passport},\"state\":\"APPROVED\"}" \
      "${API_URL}/api/register/namespaces/system/registration/${reg}/approve" >/dev/null 2>&1 || true
    echo "Approved: ${reg} (was ${reg_state})"
    # Poll for ONLINE (30 min window)
    online_deadline=$(($(date +%s) + 1800))
    while [ "$(date +%s)" -lt "${online_deadline}" ]; do
      state=$(curl -sf -H "Authorization: APIToken ${API_TOKEN}" \
        "${API_URL}/api/register/namespaces/system/registrations/${reg}" 2>/dev/null | \
        python3 -c "import json,sys; d=json.load(sys.stdin); print(((d.get('object') or {}).get('status') or {}).get('current_state',''))" 2>/dev/null || echo "")
      echo "State: ${state}"
      [ "${state}" = "ONLINE" ] && echo "ONLINE" && exit 0
      sleep 60
    done
    echo "TIMEOUT" && exit 1
  fi
  sleep 30
done
echo "NO_REGISTRATION" && exit 1
SHEOF
  chmod +x "${t2_ws}/scripts/approve_registration.sh"

  # Write the T2 Terraform config (single-quoted heredoc prevents bash expanding ${var.*})
  cat > "${t2_ws}/main.tf" << 'TFEOF'
terraform {
  required_providers {
    f5xc   = { source = "f5xc-salesdemos/f5xc" }
    azurerm = { source = "hashicorp/azurerm", version = "~> 3.0" }
    null    = { source = "hashicorp/null" }
  }
}

provider "f5xc" {
  api_url   = var.api_url
  api_token = var.api_token
}
provider "azurerm" {
  features {}
  skip_provider_registration = true
}
provider "null" {}

variable "api_url"       { type = string }
variable "api_token" {
  type      = string
  sensitive = true
}
variable "location" {
  type    = string
  default = "canadaeast"
}
variable "site_name" {
  type    = string
  default = "ar-test-smsv2-t2-site"
}
variable "token_name" {
  type    = string
  default = "ar-test-smsv2-t2-token"
}
variable "rg_name" {
  type    = string
  default = "ar-test-smsv2t2-rg"
}

# Registration token (via external data source — no terraform provider support)
data "external" "token" {
  program = ["python3", "${path.module}/scripts/create_token.py"]
  query = {
    api_url    = var.api_url
    api_token  = var.api_token
    token_name = var.token_name
  }
}

# SMSv2 site object
resource "f5xc_securemesh_site_v2" "t2" {
  name      = var.site_name
  namespace = "system"
  azure {
    not_managed {}
  }
  disable_ha {}
  block_all_services {}
  no_network_policy {}
  no_forward_proxy {}
  f5_proxy {}
  no_proxy_bypass {}
  logs_streaming_disabled {}
  no_s2s_connectivity_sli {}
  no_s2s_connectivity_slo {}
  disable_url_categorization {}
  disable_management_network {}
}

# Azure infrastructure
resource "azurerm_resource_group" "t2" {
  name     = var.rg_name
  location = var.location
}

resource "azurerm_virtual_network" "t2" {
  name                = "ar-smsv2-t2-vnet"
  resource_group_name = azurerm_resource_group.t2.name
  location            = azurerm_resource_group.t2.location
  address_space       = ["10.200.0.0/16"]
}

resource "azurerm_subnet" "outside" {
  name                 = "outside"
  resource_group_name  = azurerm_resource_group.t2.name
  virtual_network_name = azurerm_virtual_network.t2.name
  address_prefixes     = ["10.200.1.0/24"]
}

resource "azurerm_subnet" "inside" {
  name                 = "inside"
  resource_group_name  = azurerm_resource_group.t2.name
  virtual_network_name = azurerm_virtual_network.t2.name
  address_prefixes     = ["10.200.2.0/24"]
}

resource "azurerm_network_security_group" "t2" {
  name                = "ar-smsv2-t2-nsg"
  resource_group_name = azurerm_resource_group.t2.name
  location            = azurerm_resource_group.t2.location
  # F5 XC CE requires outbound-initiated VER tunnel (UDP 4500, TCP 443)
  # No inbound rules needed — CE initiates all connections outbound
  security_rule {
    name                       = "deny-all-inbound"
    priority                   = 4096
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

resource "azurerm_network_interface" "outside" {
  name                  = "nic-outside"
  resource_group_name   = azurerm_resource_group.t2.name
  location              = azurerm_resource_group.t2.location
  ip_forwarding_enabled = true
  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.outside.id
    private_ip_address_allocation = "Dynamic"
  }
}

resource "azurerm_network_interface" "inside" {
  name                  = "nic-inside"
  resource_group_name   = azurerm_resource_group.t2.name
  location              = azurerm_resource_group.t2.location
  ip_forwarding_enabled = true
  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.inside.id
    private_ip_address_allocation = "Dynamic"
  }
}

resource "azurerm_network_interface_security_group_association" "outside" {
  network_interface_id      = azurerm_network_interface.outside.id
  network_security_group_id = azurerm_network_security_group.t2.id
}

locals {
  cloud_init = <<-CLOUDINIT
#cloud-config
write_files:
  - path: /etc/vpm/config.yaml
    content: |
      Vpm:
        ClusterName: ${var.site_name}
        ClusterType: ce
        CertifiedHardware: generic-regular-nic-voltmesh
        Token: ${data.external.token.result.uid}
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
}

resource "azurerm_linux_virtual_machine" "t2_ce" {
  name                = "ar-test-smsv2-t2-ce"
  resource_group_name = azurerm_resource_group.t2.name
  location            = azurerm_resource_group.t2.location
  size                = "Standard_D4s_v3"
  admin_username      = "azureuser"
  custom_data         = base64encode(local.cloud_init)
  network_interface_ids = [
    azurerm_network_interface.outside.id,
    azurerm_network_interface.inside.id,
  ]
  admin_ssh_key {
    username   = "azureuser"
    public_key = file("~/.ssh/id_rsa.pub")
  }
  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
  }
  source_image_reference {
    publisher = "volterraedgeservices"
    offer     = "voltmesh_node"
    sku       = "teamsplan_entcloud_voltmesh_node"
    version   = "0.9.2"
  }
  plan {
    name      = "teamsplan_entcloud_voltmesh_node"
    publisher = "volterraedgeservices"
    product   = "voltmesh_node"
  }
  depends_on = [f5xc_securemesh_site_v2.t2]
}

# Registration approval via local-exec (credentials via env, not process args)
resource "null_resource" "approve" {
  depends_on = [azurerm_linux_virtual_machine.t2_ce]
  provisioner "local-exec" {
    command = "${path.module}/scripts/approve_registration.sh"
    environment = {
      API_URL   = var.api_url
      API_TOKEN = var.api_token
      SITE_NAME = var.site_name
    }
  }
}
TFEOF

  # Pre-clean any leftover Azure resources from failed previous runs
  local t2_rg="ar-test-smsv2t2-rg"
  if az group show --name "${t2_rg}" &>/dev/null 2>&1; then
    echo "  Pre-clean: deleting leftover resource group ${t2_rg}"
    az group delete --name "${t2_rg}" --yes --no-wait 2>/dev/null || true
    # Wait for deletion before proceeding
    local deadline=$(($(date +%s) + 180))
    while az group show --name "${t2_rg}" &>/dev/null 2>&1; do
      [ "$(date +%s)" -gt "${deadline}" ] && break
      echo "  Waiting for ${t2_rg} deletion..."
      sleep 15
    done
  fi

  # Pre-clean any leftover F5XC site — must wait for full deletion before apply
  local t2_site="ar-test-smsv2-t2-site"
  if curl -sf -H "Authorization: APIToken ${API_TOKEN}" \
      "${API_URL}/api/config/namespaces/system/securemesh_site_v2s/${t2_site}" &>/dev/null 2>&1; then
    echo "  Pre-clean: deleting leftover F5XC site ${t2_site}"
    curl -sf -X DELETE -H "Authorization: APIToken ${API_TOKEN}" \
      "${API_URL}/api/config/namespaces/system/securemesh_site_v2s/${t2_site}" &>/dev/null || true
    # Wait for site deletion to propagate (max 2 min)
    local site_deadline=$(($(date +%s) + 120))
    while curl -sf -H "Authorization: APIToken ${API_TOKEN}" \
        "${API_URL}/api/config/namespaces/system/securemesh_site_v2s/${t2_site}" &>/dev/null 2>&1; do
      [ "$(date +%s)" -gt "${site_deadline}" ] && break
      echo "  Waiting for F5XC site deletion..."
      sleep 10
    done
  fi
  # Also clean up any leftover registration token
  curl -sf -X DELETE -H "Authorization: APIToken ${API_TOKEN}" \
    "${API_URL}/api/register/namespaces/system/tokens/ar-test-smsv2-t2-token" &>/dev/null || true

  echo "Running T2 terraform apply..."
  echo "  T2 workspace: ${t2_ws}"
  echo "  main.tf exists: $([ -f "${t2_ws}/main.tf" ] && echo YES || echo NO) ($([ -f "${t2_ws}/main.tf" ] && wc -c < "${t2_ws}/main.tf" || echo 0) bytes)"
  cd "${t2_ws}"
  if ! terraform init -backend=false -input=false -no-color 2>&1 | tee "${WORK_DIR}/t2-init.log" | grep -v "^$"; then
    echo "FAIL T2: terraform init failed"
    cat "${WORK_DIR}/t2-init.log" 2>/dev/null | grep -i "error\|Error" | head -5
    T2_SCORE=0
    cd - >/dev/null
    return 0
  fi

  # Note: null_resource local-exec output is suppressed by terraform when environment
  # contains sensitive values. Apply exit 0 = null_resource succeeded = CE reached ONLINE.
  if TF_VAR_api_url="${API_URL}" TF_VAR_api_token="${API_TOKEN}" \
     terraform apply -auto-approve -no-color -input=false 2>&1 | tee "${WORK_DIR}/t2-apply.log" | tail -10; then
    echo "T2 PASS: CE registration ONLINE via terraform apply"
    T2_SCORE=100
  else
    echo "T2 FAIL: terraform apply failed"
    grep -i "Error:" "${WORK_DIR}/t2-apply.log" 2>/dev/null | grep -v "Warning\|override" | head -5
    T2_SCORE=0
  fi

  # Terraform destroy (cleanup), with error surfacing
  TF_VAR_api_url="${API_URL}" TF_VAR_api_token="${API_TOKEN}" \
    terraform destroy -auto-approve -no-color -input=false 2>&1 | tail -5 || true
  # Belt-and-suspenders: explicit F5XC + Azure cleanup (terraform destroy may miss these)
  curl -sf -X DELETE -H "Authorization: APIToken ${API_TOKEN}" \
    "${API_URL}/api/config/namespaces/system/securemesh_site_v2s/${t2_site}" &>/dev/null || true
  curl -sf -X DELETE -H "Authorization: APIToken ${API_TOKEN}" \
    "${API_URL}/api/register/namespaces/system/tokens/ar-test-smsv2-t2-token" &>/dev/null || true
  az group delete --name "${t2_rg}" --yes --no-wait 2>/dev/null || true
  cd - >/dev/null
}

run_t2

T3_SCORE="skipped"

# ── Score emission ─────────────────────────────────────────────────────────────
python3 - "${T2_SCORE}" "${T3_SCORE}" << PYEOF
import sys
t1_total = ${T1_TOTAL}
t1_validate_pass = ${T1_VALIDATE_PASS}
t1_fmt_pass = ${T1_FMT_PASS}
t1_plan_pass = ${T1_PLAN_PASS}
t2_score = sys.argv[1]
t3_score = sys.argv[2]
validate_score = round(t1_validate_pass / max(1, t1_total) * 100, 1)
fmt_score = round(t1_fmt_pass / max(1, t1_total) * 100, 1)
plan_score = round(t1_plan_pass / max(1, t1_total) * 100, 1) if t1_validate_pass > 0 else 0.0
print(f'METRIC smsv2_tf_validate_score={validate_score}')
print(f'METRIC smsv2_tf_fmt_score={fmt_score}')
print(f'METRIC smsv2_tf_plan_score={plan_score}')
print(f'METRIC smsv2_tf_deployment_score={t2_score}')
print(f'METRIC smsv2_tf_mesh_score={t3_score}')
print(f'METRIC smsv2_tf_t1_tests={t1_total}')
PYEOF

cross_repo_json=$(python3 -c "
import json
print(json.dumps({
    'xcsh': ${T1_XCSH_ISSUES},
    'terraform-provider-f5xc': ${T1_PROVIDER_ISSUES},
    'api-specs-enriched': ${T1_SPEC_ISSUES},
}))
")
echo "ASI failures=${T1_FAILURES}"
echo "ASI cross_repo_issues=${cross_repo_json}"
