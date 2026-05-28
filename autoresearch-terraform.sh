#!/usr/bin/env bash
set -euo pipefail

# Terraform Autoresearch Benchmark
# Reads phrases from terraform-phrases.yaml, pipes each through xcsh,
# extracts terraform code, runs terraform validate/plan, and scores.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PHRASES_FILE="${SCRIPT_DIR}/terraform-phrases.yaml"
WORK_DIR="/tmp/tf-autoresearch-$$"
PROVIDER_BLOCK='terraform {
  required_providers {
    f5xc = {
      source = "f5xc-salesdemos/f5xc"
    }
  }
}'

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

  # Invoke xcsh in non-interactive print mode via stdin pipe
  response=""
  turns=1
  if command -v xcsh &>/dev/null; then
    response=$(printf '%s' "${phrase}" | timeout 120 xcsh --print 2>/dev/null || echo "")
  else
    echo "  SKIP: xcsh not found in PATH"
    continue
  fi

  # Extract terraform code blocks
  tf_code=$(echo "${response}" | python3 -c "
import sys, re
content = sys.stdin.read()
blocks = re.findall(r'\`\`\`(?:terraform|hcl)\n(.*?)\`\`\`', content, re.DOTALL)
print('\n'.join(blocks))
" 2>/dev/null || echo "")

  # Score: keyword match (0.0, 0.5, or 1.0)
  keyword_score=0
  if [ -n "${expect_resource}" ]; then
    if echo "${tf_code}" | grep -qi "${expect_resource}" 2>/dev/null; then
      keyword_score=100
    elif echo "${response}" | grep -qi "${expect_resource}" 2>/dev/null; then
      keyword_score=50
    fi
  fi
  keyword_total=$((keyword_total + keyword_score))

  # Score: terraform validate
  v_score=0
  p_score=0
  if [ -n "${tf_code}" ]; then
    printf '%s\n\n%s\n' "${PROVIDER_BLOCK}" "${tf_code}" > "${ws}/main.tf"

    if terraform -chdir="${ws}" init -backend=false -input=false -no-color >/dev/null 2>&1; then
      if terraform -chdir="${ws}" validate -no-color >/dev/null 2>&1; then
        v_score=1
        validate_pass=$((validate_pass + 1))
      fi

      if [ -n "${F5XC_API_TOKEN:-}" ] && [ -n "${F5XC_API_URL:-}" ]; then
        if terraform -chdir="${ws}" plan -no-color -input=false >/dev/null 2>&1; then
          p_score=1
          plan_pass=$((plan_pass + 1))
        fi
      fi
    fi
  fi

  turn_total=$((turn_total + turns))

  # Compute phrase score (integer math: multiply by 1000 for 3 decimal precision)
  # 0.4*validate + 0.3*keyword + 0.2*plan + 0.1*(1/turns)
  # keyword is 0/50/100, normalize to 0/0.5/1.0
  phrase_score_x1000=$(( (400 * v_score) + (3 * keyword_score) + (200 * p_score) + (100 / turns) ))
  composite_total=$((composite_total + phrase_score_x1000))

  # Status: per contract, phrase must produce valid terraform to pass
  kw_display=$(python3 -c "print(${keyword_score}/100)")
  ps_display=$(python3 -c "print(round(${phrase_score_x1000}/1000, 3))")
  status="FAIL"
  if [ "${v_score}" -eq 1 ]; then
    status="PASS"
  fi
  echo "  ${status}: validate=${v_score} keyword=${kw_display} plan=${p_score} turns=${turns} score=${ps_display}"
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
