#!/usr/bin/env bash
set -euo pipefail

# Terraform Autoresearch Benchmark
# Reads phrases from terraform-phrases.yaml, pipes each through xcsh,
# extracts terraform code, runs terraform validate/plan, and scores.
# Emits METRIC lines for the autoresearch framework and ASI lines for
# cross-repo failure triage.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PHRASES_FILE="${PHRASES_FILE:-${SCRIPT_DIR}/terraform-phrases.yaml}"
WORK_DIR="/tmp/tf-autoresearch-$$"

# Error pattern → fix repo mapping (matches design spec failure triage table)
# Returns: "terraform-provider-f5xc" | "api-specs-enriched" | "xcsh"
classify_error() {
  local error_text="$1"
  local tf_code="$2"

  if [ -z "${tf_code}" ]; then
    echo "xcsh"
    return
  fi

  if echo "${error_text}" | grep -qiE "unsupported argument|An argument named"; then
    echo "terraform-provider-f5xc"
  elif echo "${error_text}" | grep -qiE "one of .+ must be set|Required argument"; then
    echo "terraform-provider-f5xc"
  elif echo "${error_text}" | grep -qiE "404|not found|namespace.*not.*exist"; then
    echo "api-specs-enriched"
  elif echo "${error_text}" | grep -qiE "Invalid value for|invalid configuration"; then
    echo "api-specs-enriched"
  else
    echo "xcsh"
  fi
}

classify_error_type() {
  local error_text="$1"
  local tf_code="$2"

  if [ -z "${tf_code}" ]; then
    echo "NO_TERRAFORM_OUTPUT"
    return
  fi

  if echo "${error_text}" | grep -qiE "unsupported argument|An argument named"; then
    echo "UNSUPPORTED_ARGUMENT"
  elif echo "${error_text}" | grep -qiE "one of .+ must be set|Required argument"; then
    echo "MISSING_ONEOF"
  elif echo "${error_text}" | grep -qiE "404|not found|namespace.*not.*exist"; then
    echo "NAMESPACE_NOT_FOUND"
  elif echo "${error_text}" | grep -qiE "Invalid value for|invalid configuration"; then
    echo "INVALID_MINIMAL_CONFIG"
  else
    echo "OTHER"
  fi
}

cleanup() {
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT
mkdir -p "${WORK_DIR}"

# Parse YAML to JSON array (requires python3 + pyyaml)
phrases_file="${WORK_DIR}/phrases.json"
python3 -c "
import yaml, json
with open('${PHRASES_FILE}') as f:
    data = yaml.safe_load(f)
json.dump(data['phrases'], open('${phrases_file}', 'w'))
"

phrase_count=$(python3 -c "import json; print(len(json.load(open('${phrases_file}'))))")
echo "Running ${phrase_count} terraform benchmark phrases..."
echo ""

# Accumulators
total=0
validate_pass=0
plan_pass=0
keyword_total=0
turn_total=0
composite_total=0
# Failure records (JSON array built up incrementally)
failures_json="[]"
# Per-repo issue counts
xcsh_issues=0
provider_issues=0
spec_issues=0

for idx in $(seq 0 $((phrase_count - 1))); do
  ws="${WORK_DIR}/phrase_${idx}"
  mkdir -p "${ws}"

  # Write phrase fields to a JSON file — avoids eval / shell injection
  python3 -c "
import json
phrases = json.load(open('${phrases_file}'))
p = phrases[${idx}]
json.dump({
    'phrase':          p['phrase'],
    'operation':       p.get('operation', ''),
    'expect_resource': p.get('expect_resource', ''),
    'expect_command':  p.get('expect_command', ''),
    'expect_fields':   p.get('expect_fields', []),
}, open('${ws}/phrase.json', 'w'))
"

  # Read each field with a separate, data-only python call
  phrase=$(python3 -c "import json; print(json.load(open('${ws}/phrase.json'))['phrase'])")
  operation=$(python3 -c "import json; print(json.load(open('${ws}/phrase.json'))['operation'])")
  expect_resource=$(python3 -c "import json; print(json.load(open('${ws}/phrase.json'))['expect_resource'])")
  expect_command=$(python3 -c "import json; print(json.load(open('${ws}/phrase.json'))['expect_command'])")
  expect_fields=$(python3 -c "import json; print(' '.join(json.load(open('${ws}/phrase.json'))['expect_fields']))")

  total=$((total + 1))
  echo "[$((idx + 1))/${phrase_count}] ${operation}: ${phrase:0:70}..."

  # Invoke xcsh in non-interactive print mode from the workspace directory
  # xcsh may write .tf files directly OR return code blocks in markdown
  response=""
  turns=1
  if command -v xcsh &>/dev/null; then
    response=$(cd "${ws}" && timeout 120 xcsh --print --no-session "${phrase}" 2>/dev/null || echo "")
  else
    echo "  SKIP: xcsh not found in PATH"
    continue
  fi

  # Extract terraform code: prefer .tf files xcsh wrote, fall back to markdown code blocks
  tf_code=""
  if find "${ws}" -maxdepth 1 -name "*.tf" -print -quit | grep -q .; then
    tf_code=$(cat "${ws}"/*.tf 2>/dev/null)
  else
    tf_code=$(echo "${response}" | python3 -c "
import sys, re
content = sys.stdin.read()
blocks = re.findall(r'\`\`\`(?:terraform|hcl)\n(.*?)\`\`\`', content, re.DOTALL)
print('\n'.join(blocks))
" 2>/dev/null || echo "")
  fi

  # Score: keyword match (0, 50, or 100)
  keyword_score=0
  if [ -n "${expect_resource}" ]; then
    if echo "${tf_code}" | grep -qi "${expect_resource}" 2>/dev/null; then
      keyword_score=100
    elif echo "${response}" | grep -qi "${expect_resource}" 2>/dev/null; then
      keyword_score=50
    fi
  fi
  keyword_total=$((keyword_total + keyword_score))

  # Score: terraform validate (capture output for failure classification)
  v_score=0
  p_score=0
  v_error=""
  p_error=""

  if [ -n "${tf_code}" ]; then
    # Write xcsh's HCL as-is when it didn't already create .tf files.
    # Never fabricate the terraform{}/provider blocks — score whether xcsh emitted them itself,
    # so a missing provider block surfaces as a real failure instead of being silently patched.
    if ! find "${ws}" -maxdepth 1 -name "*.tf" -print -quit | grep -q .; then
      printf '%s\n' "${tf_code}" > "${ws}/main.tf"
    fi

    tf_all=$(cat "${ws}"/*.tf 2>/dev/null || true)
    if ! printf '%s' "${tf_all}" | grep -q "required_providers" || ! printf '%s' "${tf_all}" | grep -q 'provider "f5xc"'; then
      v_error='xcsh output missing terraform{} or provider "f5xc" block (incomplete config)'
    elif terraform -chdir="${ws}" init -backend=false -input=false -no-color >"${ws}/init.out" 2>&1; then
      # Capture validate output for error classification
      v_output=$(terraform -chdir="${ws}" validate -no-color 2>&1) && v_score=1 || v_score=0
      echo "${v_output}" > "${ws}/validate.out"
      if [ "${v_score}" -eq 1 ]; then
        validate_pass=$((validate_pass + 1))
      else
        v_error="${v_output}"
      fi

      # terraform plan (only if API token available)
      if [ -n "${F5XC_API_TOKEN:-}" ] && [ -n "${F5XC_API_URL:-}" ]; then
        p_output=$(terraform -chdir="${ws}" plan -no-color -input=false 2>&1) && p_score=1 || p_score=0
        echo "${p_output}" > "${ws}/plan.out"
        if [ "${p_score}" -eq 1 ]; then
          plan_pass=$((plan_pass + 1))
        else
          p_error="${p_output}"
        fi
      fi
    else
      v_error=$(cat "${ws}/init.out")
    fi
  fi

  turn_total=$((turn_total + turns))

  # Compute phrase score (integer math: multiply by 1000 for 3 decimal precision)
  # 0.4*validate + 0.3*keyword + 0.2*plan + 0.1*(1/turns)
  phrase_score_x1000=$(( (400 * v_score) + (3 * keyword_score) + (200 * p_score) + (100 / turns) ))
  composite_total=$((composite_total + phrase_score_x1000))

  # Classify failure and build ASI failure record
  status="FAIL"
  if [ "${v_score}" -eq 1 ]; then
    status="PASS"
  else
    combined_error="${v_error}${p_error}"
    fix_repo=$(classify_error "${combined_error}" "${tf_code}")
    error_type=$(classify_error_type "${combined_error}" "${tf_code}")

    # Increment per-repo issue counter
    case "${fix_repo}" in
      "terraform-provider-f5xc") provider_issues=$((provider_issues + 1)) ;;
      "api-specs-enriched") spec_issues=$((spec_issues + 1)) ;;
      *) xcsh_issues=$((xcsh_issues + 1)) ;;
    esac

    # Append to failures JSON array
    # Truncate error to 200 chars for JSON safety
    error_short=$(python3 -c "import json,sys; s=sys.stdin.read().strip()[:200]; print(json.dumps(s))" <<< "${combined_error}")
    phrase_json=$(python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))" <<< "${phrase}")
    failures_json=$(python3 -c "
import json, sys
failures = json.loads(sys.argv[1])
failures.append({
    'phrase_idx': ${idx},
    'phrase': json.loads(sys.argv[4]),
    'operation': '${operation}',
    'expect_resource': '${expect_resource}',
    'error_type': '${error_type}',
    'error_signal': json.loads(sys.argv[2]),
    'fix_repo': '${fix_repo}',
})
print(json.dumps(failures))
" "${failures_json}" "${error_short}" "" "${phrase_json}")
  fi

  kw_display=$(python3 -c "print(${keyword_score}/100)")
  ps_display=$(python3 -c "print(round(${phrase_score_x1000}/1000, 3))")
  if [ "${v_score}" -eq 0 ]; then
    fix_repo_display=$(classify_error "${v_error}${p_error}" "${tf_code}")
    echo "  ${status}: validate=${v_score} keyword=${kw_display} plan=${p_score} turns=${turns} score=${ps_display} fix=${fix_repo_display}"
  else
    echo "  ${status}: validate=${v_score} keyword=${kw_display} plan=${p_score} turns=${turns} score=${ps_display}"
  fi
done

echo ""
if [ "${total}" -gt 0 ]; then
  python3 -c "
total = ${total}
validate_pass = ${validate_pass}
plan_pass = ${plan_pass}
keyword_total = ${keyword_total}
turn_total = ${turn_total}
composite_total = ${composite_total}

composite = round(composite_total / total / 10, 1)
v_rate = round(validate_pass / total * 100, 1)
k_rate = round(keyword_total / total, 1)
avg_t = round(turn_total / total, 1)
p_rate = round(plan_pass / total * 100, 1)

print(f'METRIC composite_score={composite}')
print(f'METRIC validate_pass_rate={v_rate}')
print(f'METRIC keyword_match_rate={k_rate}')
print(f'METRIC avg_turns={avg_t}')
print(f'METRIC plan_pass_rate={p_rate}')
"
else
  echo "METRIC composite_score=0"
  echo "METRIC validate_pass_rate=0"
  echo "METRIC keyword_match_rate=0"
  echo "METRIC avg_turns=0"
  echo "METRIC plan_pass_rate=0"
fi

# Emit ASI: structured failure records for cross-repo triage
cross_repo_json=$(python3 -c "
import json
print(json.dumps({
    'xcsh': ${xcsh_issues},
    'terraform-provider-f5xc': ${provider_issues},
    'api-specs-enriched': ${spec_issues},
}))
")
echo "ASI failures=${failures_json}"
echo "ASI cross_repo_issues=${cross_repo_json}"
