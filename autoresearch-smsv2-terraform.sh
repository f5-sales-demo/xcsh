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

# Provider block injected into every test workspace
PROVIDER_BLOCK='terraform {
  required_providers {
    f5xc = {
      source = "f5xc-salesdemos/f5xc"
    }
  }
}

provider "f5xc" {
  api_url   = var.api_url
  api_token = var.api_token
}

variable "api_url"   { type = string }
variable "api_token" { type = string, sensitive = true }
'

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
    # xcsh may write HCL to a .tf file by name (e.g. ar-test-smsv2-1a.tf) without mentioning it
    tf_code=""
    # First: check for .tf file by the expected resource name (xcsh names it after the resource)
    expected_tf="${resource_name}.tf"
    if [ -f "${expected_tf}" ]; then
      tf_code=$(cat "${expected_tf}")
      rm -f "${expected_tf}" 2>/dev/null || true
    fi
    # Second: check if xcsh mentioned any .tf file in stdout
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
    'id': '${option_id}',
    'option_field': '${option_field}',
    'phrase': json.loads(sys.argv[2]),
    'error_type': 'NO_TF_OUTPUT',
    'fix_repo': 'xcsh',
})
print(json.dumps(failures))
" "${t1_failures_json}" "${phrase_escaped}")
      echo ""
      continue
    fi

    # Write workspace files
    # Only inject provider.tf if xcsh didn't already include a terraform{} block
    if echo "${tf_code}" | grep -q "required_providers"; then
      echo "${tf_code}" > "${ws}/main.tf"
    else
      echo "${PROVIDER_BLOCK}" > "${ws}/provider.tf"
      echo "${tf_code}" > "${ws}/main.tf"
    fi

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
    # Credentials passed via TF_VAR_ env vars — no secret written to disk
    plan_exit=0
    plan_out=""
    if [ "${validate_exit}" -eq 0 ] && [ -n "${API_URL}" ] && [ -n "${API_TOKEN}" ]; then
      if [ -n "${TF_CLI_CONFIG_FILE}" ]; then
        plan_out=$(TF_CLI_CONFIG_FILE="${TF_CLI_CONFIG_FILE}" \
          TF_VAR_api_url="${API_URL}" TF_VAR_api_token="${API_TOKEN}" \
          terraform -chdir="${ws}" plan -no-color -input=false 2>&1 || true)
      else
        plan_out=$(TF_VAR_api_url="${API_URL}" TF_VAR_api_token="${API_TOKEN}" \
          terraform -chdir="${ws}" plan -no-color -input=false 2>&1 || true)
      fi
      echo "${plan_out}" | grep -qiE "^Plan:|No changes" && plan_exit=0 || plan_exit=1
    fi

    # Record result
    if [ "${validate_exit}" -eq 0 ]; then
      t1_validate_pass=$((t1_validate_pass + 1))
      [ "${plan_exit}" -eq 0 ] && t1_plan_pass=$((t1_plan_pass + 1))
      status="PASS"
      echo "  ${status}: option=${option_field} validate=ok plan=$([ ${plan_exit} -eq 0 ] && echo ok || echo skip/fail)"
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
    'id': '${option_id}',
    'option_field': '${option_field}',
    'phrase': json.loads(sys.argv[2]),
    'error_type': '${error_type}',
    'error_signal': json.loads(sys.argv[3]),
    'fix_repo': '${fix_repo}',
})
print(json.dumps(failures))
" "${t1_failures_json}" "${phrase_escaped}" "${error_escaped}")

      echo "  ${status}: option=${option_field} fix=${fix_repo} — ${error_signal:0:80}"
    fi
    echo ""
  done

  echo "T1 complete: ${t1_validate_pass}/${t1_total} validate passed"
  echo ""

  T1_TOTAL="${t1_total}"
  T1_VALIDATE_PASS="${t1_validate_pass}"
  T1_PLAN_PASS="${t1_plan_pass}"
  T1_FAILURES="${t1_failures_json}"
  T1_XCSH_ISSUES="${t1_xcsh_issues}"
  T1_PROVIDER_ISSUES="${t1_provider_issues}"
  T1_SPEC_ISSUES="${t1_spec_issues}"
}

run_t1

# T2 and T3 terraform deployment (stub — implemented in subsequent tasks)
T2_SCORE="skipped"
T3_SCORE="skipped"

# ── Score emission ─────────────────────────────────────────────────────────────
python3 - "${T2_SCORE}" "${T3_SCORE}" << PYEOF
import sys
t1_total = ${T1_TOTAL}
t1_validate_pass = ${T1_VALIDATE_PASS}
t1_plan_pass = ${T1_PLAN_PASS}
t2_score = sys.argv[1]
t3_score = sys.argv[2]
validate_score = round(t1_validate_pass / max(1, t1_total) * 100, 1)
plan_score = round(t1_plan_pass / max(1, t1_total) * 100, 1) if t1_validate_pass > 0 else 0.0
print(f'METRIC smsv2_tf_validate_score={validate_score}')
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
