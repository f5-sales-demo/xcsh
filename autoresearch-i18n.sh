#!/usr/bin/env bash
# autoresearch-i18n.sh
# Multilingual phrase matrix benchmark for xcsh i18n support.
#
# T1: Locale regression  — English phrases × all 13 locales (XCSH_LOCALE set)
# T2: Native phrases     — Translated phrases × all 13 locales
#
# Usage:
#   ./autoresearch-i18n.sh                        # T1 + T2 (requires translations populated)
#   ./autoresearch-i18n.sh --mode t1-regression   # T1 only (no translations needed)
#   ./autoresearch-i18n.sh --generate-translations # Bootstrap: populate translations in YAML
set -euo pipefail

API_URL="${XCSH_API_URL:-}"
API_TOKEN="${XCSH_API_TOKEN:-}"
NS="r-mordasiewicz"
PHRASES_FILE="$(dirname "$0")/autoresearch-i18n-phrases.yaml"
WORK_DIR="/tmp/ar-i18n-$$"
TF_DEVRC="${TF_CLI_CONFIG_FILE:-}"
MODE="full"

LOCALES="en ja ko zh-cn zh-tw fr de es pt-br it ar hi th"

# Lookup locale display name (bash 3.2 compatible — no associative arrays)
locale_name() {
  case "$1" in
    en)    echo "English" ;;
    ja)    echo "Japanese" ;;
    ko)    echo "Korean" ;;
    zh-cn) echo "Chinese (Simplified)" ;;
    zh-tw) echo "Chinese (Traditional)" ;;
    fr)    echo "French" ;;
    de)    echo "German" ;;
    es)    echo "Spanish" ;;
    pt-br) echo "Brazilian Portuguese" ;;
    it)    echo "Italian" ;;
    ar)    echo "Arabic" ;;
    hi)    echo "Hindi" ;;
    th)    echo "Thai" ;;
    *)     echo "$1" ;;
  esac
}

# Per-locale counters stored in files (bash 3.2 compatible)
counter_file() { echo "${WORK_DIR}/counter_${1}_${2}"; }
counter_get()  { cat "$(counter_file "$1" "$2")" 2>/dev/null || echo 0; }
counter_inc()  { local v; v=$(counter_get "$1" "$2"); echo $((v + 1)) > "$(counter_file "$1" "$2")"; }

# Parse args
_prev=""
for arg in "$@"; do
  case "${_prev}" in
    --mode)    MODE="${arg}"; _prev=""; continue ;;
    --locales) LOCALES="${arg}"; _prev=""; continue ;;
  esac
  case "${arg}" in
    --mode)               _prev="--mode" ;;
    --locales)            _prev="--locales" ;;
    t1-regression)        MODE="t1-regression" ;;
    --generate-translations) MODE="generate-translations" ;;
    --mode=*)             MODE="${arg#--mode=}" ;;
    --locales=*)          LOCALES="${arg#--locales=}" ;;
  esac
done
unset _prev

if [ -z "${API_URL}" ] || [ -z "${API_TOKEN}" ]; then
  echo "ERROR: XCSH_API_URL and XCSH_API_TOKEN required" >&2
  exit 1
fi

mkdir -p "${WORK_DIR}"

# Auto-configure dev_overrides when TF_CLI_CONFIG_FILE is not set.
# Looks for the locally built xcsh provider binary; creates a temp .terraformrc.
if [ -z "${TF_DEVRC}" ]; then
  local_provider_dir="${HOME}/.terraform.d/plugins/registry.terraform.io/f5xc-salesdemos/xcsh/0.0.0/darwin_arm64"
  if [ -d "${local_provider_dir}" ]; then
    TF_DEVRC="${WORK_DIR}/.terraformrc"
    cat > "${TF_DEVRC}" <<EOF
provider_installation {
  dev_overrides {
    "f5xc-salesdemos/xcsh" = "${local_provider_dir}"
  }
  direct {}
}
EOF
    echo "Using dev_overrides from ${local_provider_dir}"
  fi
fi

# ── xcsh_cmd with SIGKILL fallback ────────────────────────────────────────────
# Usage: xcsh_cmd "<locale>" "<phrase>" <workspace_dir>
# xcsh --print writes the .tf to cwd, so we cd into workspace_dir first.
xcsh_cmd() {
  local locale="$1" phrase="$2" ws_dir="${3:-.}"
  local _timed_out=0 _elapsed=0
  (cd "${ws_dir}" && XCSH_LOCALE="${locale}" xcsh --print --no-session -- "${phrase}" > xcsh.out 2>&1) &
  local xcsh_pid=$!
  while kill -0 "${xcsh_pid}" 2>/dev/null; do
    sleep 1
    _elapsed=$((_elapsed + 1))
    if [ "${_elapsed}" -ge 240 ]; then
      kill -9 "${xcsh_pid}" 2>/dev/null
      _timed_out=1
      break
    fi
  done
  wait "${xcsh_pid}" 2>/dev/null || true
  if [ "${_timed_out}" -eq 1 ]; then sleep 30; fi
}

# ── xcsh_cmd with retry on NO_TF_OUTPUT ──────────────────────────────────────
# Retries up to MAX_RETRIES times when xcsh produces no .tf file.
# This separates genuine model failures from transient stochasticity.
MAX_RETRIES=2
xcsh_cmd_retry() {
  local locale="$1" phrase="$2" ws_dir="${3:-.}"
  local attempt=0
  while [ "${attempt}" -le "${MAX_RETRIES}" ]; do
    xcsh_cmd "${locale}" "${phrase}" "${ws_dir}"
    if find "${ws_dir}" -maxdepth 1 -name "*.tf" | grep -q .; then
      return 0
    fi
    attempt=$((attempt + 1))
    if [ "${attempt}" -le "${MAX_RETRIES}" ]; then
      echo "  (retry ${attempt}/${MAX_RETRIES}: no .tf produced)"
    fi
  done
}

# ── Load phrases from YAML ────────────────────────────────────────────────────
load_phrases_en() {
  python3 -c "
import yaml, sys
with open('${PHRASES_FILE}') as f:
    data = yaml.safe_load(f)
for p in data.get('phrases', []):
    rtype = p.get('expected_resource_type', 'xcsh_http_loadbalancer')
    print(p['id'] + '|' + p['phrase_en'] + '|' + p.get('resource_name','') + '|' + rtype)
" 2>/dev/null
}

load_translation() {
  local phrase_id="$1" locale="$2"
  python3 -c "
import yaml, sys
with open('${PHRASES_FILE}') as f:
    data = yaml.safe_load(f)
for p in data.get('phrases', []):
    if p['id'] == '${phrase_id}':
        tr = p.get('translations', {}).get('${locale}', '')
        # Fall back to English if translation empty
        print(tr if tr else p['phrase_en'])
        sys.exit(0)
print('')
" 2>/dev/null
}

# ── TF workspace helper ───────────────────────────────────────────────────────
# xcsh_cmd writes .tf files directly into workspace (cwd during xcsh run).
# This function validates any .tf file found in that workspace.
run_tf_checks() {
  local ws="$1"
  local tf_file=""

  # xcsh --print writes resource_name.tf into the workspace directory
  tf_file=$(find "${ws}" -maxdepth 1 -name "*.tf" 2>/dev/null | head -1 || true)

  if [ -z "${tf_file}" ] || [ ! -f "${tf_file}" ]; then
    return 1  # NO_TF_OUTPUT
  fi

  # With dev_overrides set, terraform validate skips init entirely.
  # Without dev_overrides, attempt init first (may fail if no network/registry).
  if [ -n "${TF_DEVRC}" ]; then
    if TF_CLI_CONFIG_FILE="${TF_DEVRC}" \
       terraform -chdir="${ws}" validate -no-color &>/dev/null; then
      if TF_CLI_CONFIG_FILE="${TF_DEVRC}" \
         TF_VAR_api_url="${API_URL}" TF_VAR_api_token="${API_TOKEN}" \
         terraform -chdir="${ws}" plan -no-color -input=false &>/dev/null; then
        return 0  # PASS
      fi
      return 2  # PLAN_FAIL
    fi
  else
    if terraform -chdir="${ws}" init -backend=false -input=false -no-color &>/dev/null && \
       terraform -chdir="${ws}" validate -no-color &>/dev/null; then
      if TF_VAR_api_url="${API_URL}" TF_VAR_api_token="${API_TOKEN}" \
         terraform -chdir="${ws}" plan -no-color -input=false &>/dev/null; then
        return 0  # PASS
      fi
      return 2  # PLAN_FAIL
    fi
  fi
  return 3  # VALIDATE_FAIL
}

# ── Phase 0: --generate-translations ─────────────────────────────────────────
generate_translations() {
  echo "=== Phase 0: Generate Translations ==="
  echo "Using xcsh to translate all phrases into each non-English locale."
  echo ""

  local phrase_ids phrase_ens resource_names

  # Read all phrases
  local phrases
  phrases=$(load_phrases_en)

  local updated_yaml="${WORK_DIR}/phrases_updated.yaml"
  cp "${PHRASES_FILE}" "${updated_yaml}"

  while IFS='|' read -r id phrase_en resource_name rtype; do
    [ -z "${id}" ] && continue
    for locale in ja ko zh-cn zh-tw fr de es pt-br it ar hi th; do
      local lname
      lname=$(locale_name "${locale}")
      echo "[${id}/${locale}] Translating to ${lname}..."

      local trans_ws="${WORK_DIR}/trans-${id}-${locale}"
      mkdir -p "${trans_ws}"
      local translate_prompt="Translate the following infrastructure command to ${lname}. Return ONLY the translated phrase with no explanation, no quotes, no prefix. Phrase: ${phrase_en}"

      xcsh_cmd "${locale}" "${translate_prompt}" "${trans_ws}"

      # Extract translation from xcsh.out — take first non-empty line
      local tfile="${trans_ws}/xcsh.out"
      local translation=""
      translation=$(grep -v '^$' "${tfile}" 2>/dev/null | head -1 | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//' || true)

      if [ -n "${translation}" ]; then
        echo "  -> ${translation:0:80}"
        # Update YAML in-place using python3; pass all values via env vars to
        # avoid embedding LLM output (which may contain quotes) in Python source.
        UPDATED_YAML="${updated_yaml}" PHRASE_ID="${id}" LOCALE_KEY="${locale}" TRANSLATION_VAL="${translation}" \
        python3 - <<'PYEOF' 2>/dev/null || echo "  WARNING: could not write translation to YAML"
import yaml, sys, os
_yaml = os.environ['UPDATED_YAML']
with open(_yaml) as f:
    data = yaml.safe_load(f)
for p in data.get('phrases', []):
    if p['id'] == os.environ['PHRASE_ID']:
        if 'translations' not in p:
            p['translations'] = {}
        p['translations'][os.environ['LOCALE_KEY']] = os.environ['TRANSLATION_VAL']
        break
with open(_yaml, 'w') as f:
    yaml.dump(data, f, allow_unicode=True, default_flow_style=False, width=120)
PYEOF
      else
        echo "  WARNING: empty translation returned"
      fi
    done
    echo ""
  done <<< "${phrases}"

  cp "${updated_yaml}" "${PHRASES_FILE}"
  echo "Translations written to ${PHRASES_FILE}"
  echo ""
  echo "METRIC i18n_translations_generated=1"
}

# ── T1: Locale regression (English phrases × all locales) ─────────────────────
run_t1() {
  echo "=== T1: Locale Regression (English phrases × ${LOCALES}) ==="
  echo ""

  local phrases
  phrases=$(load_phrases_en)

  local grand_total=0 grand_validate=0 grand_plan=0
  local all_failures="[]"

  for locale in ${LOCALES}; do
    local lname
    lname=$(locale_name "${locale}")
    echo "--- Locale: ${locale} (${lname}) ---"

    while IFS='|' read -r id phrase_en resource_name rtype; do
      [ -z "${id}" ] && continue
      local ws="${WORK_DIR}/t1-${locale}-${id}"
      mkdir -p "${ws}"

      grand_total=$((grand_total + 1))
      counter_inc "t1_total" "${locale}"

      echo "[${id}] XCSH_LOCALE=${locale} ${phrase_en:0:70}..."

      xcsh_cmd_retry "${locale}" "${phrase_en}" "${ws}"

      local rc=0
      run_tf_checks "${ws}" || rc=$?

      case "${rc}" in
        0)
          counter_inc "t1_validate" "${locale}"
          counter_inc "t1_plan" "${locale}"
          grand_validate=$((grand_validate + 1))
          grand_plan=$((grand_plan + 1))
          echo "  PASS (validate + plan)"
          ;;
        1)
          echo "  FAIL: no HCL generated"
          all_failures=$(echo "${all_failures}" | _id="${id}" _locale="${locale}" python3 -c "
import json,sys,os
d=json.load(sys.stdin)
d.append({'id':os.environ['_id'],'locale':os.environ['_locale'],'error_type':'NO_TF_OUTPUT','fix_repo':'xcsh'})
print(json.dumps(d))")
          ;;
        2)
          counter_inc "t1_validate" "${locale}"
          grand_validate=$((grand_validate + 1))
          echo "  FAIL: plan failed"
          all_failures=$(echo "${all_failures}" | _id="${id}" _locale="${locale}" python3 -c "
import json,sys,os
d=json.load(sys.stdin)
d.append({'id':os.environ['_id'],'locale':os.environ['_locale'],'error_type':'PLAN_FAIL','fix_repo':'xcsh'})
print(json.dumps(d))")
          ;;
        3)
          echo "  FAIL: validate failed"
          all_failures=$(echo "${all_failures}" | _id="${id}" _locale="${locale}" python3 -c "
import json,sys,os
d=json.load(sys.stdin)
d.append({'id':os.environ['_id'],'locale':os.environ['_locale'],'error_type':'VALIDATE_FAIL','fix_repo':'xcsh'})
print(json.dumps(d))")
          ;;
      esac
    done <<< "${phrases}"
    echo ""
  done

  echo "=== T1 Results ==="
  local consistency_count=0
  for locale in ${LOCALES}; do
    local lv lt score
    lv=$(counter_get "t1_validate" "${locale}")
    lt=$(counter_get "t1_total" "${locale}")
    score=0.0
    [ "${lt}" -gt 0 ] && score=$(python3 -c "print(round(${lv}/${lt}*100,1))")
    echo "  ${locale}: ${lv}/${lt} = ${score}%"
    [ "${score}" = "100.0" ] && consistency_count=$((consistency_count + 1))
    echo "METRIC i18n_t1_${locale}_score=${score}"
  done

  local avg_score=0.0 consistency=0
  [ "${grand_total}" -gt 0 ] && avg_score=$(python3 -c "print(round(${grand_validate}/${grand_total}*100,1))")
  consistency=$(python3 -c "print(round(${consistency_count}/13*100,1))")

  echo ""
  echo "T1 Grand total: ${grand_validate}/${grand_total} validate, ${grand_plan}/${grand_total} plan"
  echo "METRIC i18n_t1_locale_regression_score=${avg_score}"
  echo "METRIC i18n_cross_locale_consistency=${consistency}"

  if [ "${#all_failures}" -gt 2 ]; then
    echo ""
    echo "T1 Failures:"
    echo "${all_failures}" | python3 -c "import json,sys; [print('  ',f) for f in json.load(sys.stdin)]"
  fi

  T1_SCORE="${avg_score}"
  T1_CONSISTENCY="${consistency}"
}

# ── T2: Native phrases (translated phrases × all locales) ─────────────────────
run_t2() {
  echo "=== T2: Native Language Phrases ==="
  echo ""

  local grand_total=0 grand_validate=0
  local all_failures="[]"

  local phrases
  phrases=$(load_phrases_en)

  for locale in ${LOCALES}; do
    local lname
    lname=$(locale_name "${locale}")
    echo "--- Locale: ${locale} (${lname}) ---"

    while IFS='|' read -r id phrase_en resource_name rtype; do
      [ -z "${id}" ] && continue
      local ws="${WORK_DIR}/t2-${locale}-${id}"
      mkdir -p "${ws}"

      grand_total=$((grand_total + 1))
      counter_inc "t2_total" "${locale}"

      # Load translation (falls back to English if empty)
      local phrase
      phrase=$(load_translation "${id}" "${locale}")

      echo "[${id}] XCSH_LOCALE=${locale} ${phrase:0:70}..."

      xcsh_cmd_retry "${locale}" "${phrase}" "${ws}"

      local rc=0
      run_tf_checks "${ws}" || rc=$?

      case "${rc}" in
        0)
          counter_inc "t2_validate" "${locale}"
          grand_validate=$((grand_validate + 1))
          echo "  PASS"
          ;;
        1)
          echo "  FAIL: no HCL generated"
          all_failures=$(echo "${all_failures}" | _id="${id}" _locale="${locale}" python3 -c "
import json,sys,os
d=json.load(sys.stdin)
d.append({'id':os.environ['_id'],'locale':os.environ['_locale'],'error_type':'NO_TF_OUTPUT','fix_repo':'xcsh'})
print(json.dumps(d))")
          ;;
        2)
          counter_inc "t2_validate" "${locale}"
          grand_validate=$((grand_validate + 1))
          echo "  PARTIAL: validate OK but plan failed"
          ;;
        3)
          echo "  FAIL: validate failed"
          all_failures=$(echo "${all_failures}" | _id="${id}" _locale="${locale}" python3 -c "
import json,sys,os
d=json.load(sys.stdin)
d.append({'id':os.environ['_id'],'locale':os.environ['_locale'],'error_type':'VALIDATE_FAIL','fix_repo':'xcsh'})
print(json.dumps(d))")
          ;;
      esac
    done <<< "${phrases}"
    echo ""
  done

  echo "=== T2 Results ==="
  for locale in ${LOCALES}; do
    local lv lt score
    lv=$(counter_get "t2_validate" "${locale}")
    lt=$(counter_get "t2_total" "${locale}")
    score=0.0
    [ "${lt}" -gt 0 ] && score=$(python3 -c "print(round(${lv}/${lt}*100,1))")
    echo "  ${locale}: ${lv}/${lt} = ${score}%"
    echo "METRIC i18n_t2_${locale}_score=${score}"
  done

  local avg_score=0.0
  [ "${grand_total}" -gt 0 ] && avg_score=$(python3 -c "print(round(${grand_validate}/${grand_total}*100,1))")

  echo ""
  echo "T2 Grand total: ${grand_validate}/${grand_total} validate"
  echo "METRIC i18n_t2_native_score=${avg_score}"

  if [ "${#all_failures}" -gt 2 ]; then
    echo ""
    echo "T2 Failures:"
    echo "${all_failures}" | python3 -c "import json,sys; [print('  ',f) for f in json.load(sys.stdin)]"
  fi

  T2_SCORE="${avg_score}"
}

# ── Main ──────────────────────────────────────────────────────────────────────
T1_SCORE="skipped"
T1_CONSISTENCY="skipped"
T2_SCORE="skipped"

case "${MODE}" in
  generate-translations)
    generate_translations
    ;;
  t1-regression)
    run_t1
    ;;
  t2-native)
    run_t2
    ;;
  full)
    run_t1
    echo ""
    run_t2
    ;;
  *)
    echo "ERROR: unknown mode '${MODE}'. Use: full | t1-regression | t2-native | generate-translations" >&2
    exit 1
    ;;
esac

echo ""
echo "=== i18n Benchmark Summary ==="
echo "METRIC i18n_t1_locale_regression_score=${T1_SCORE}"
echo "METRIC i18n_t2_native_score=${T2_SCORE}"
echo "METRIC i18n_cross_locale_consistency=${T1_CONSISTENCY}"
