#!/usr/bin/env bash
# shellcheck disable=SC2154
set -euo pipefail

# Cross-repo gate for api-specs autoresearch.
# Reads ASI gaps from stdin or ${RUN_DIR}/benchmark.log.
# For each new gap: creates a GitHub issue in api-specs-enriched (deduplicates).
# For curl_example_fails gaps: opens a draft PR stub.
# exit 0 = no gaps → autoresearch loop continues
# exit 1 = gaps exist → autoresearch stops

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_SPECS_DIR="${SCRIPT_DIR}/../api-specs-enriched"

# ── Read input ────────────────────────────────────────────────────────────────
if [ -n "${1:-}" ] && [ -d "$1" ]; then
  RUN_DIR="$1"
  if [ -f "${RUN_DIR}/benchmark.log" ]; then
    OUTPUT=$(cat "${RUN_DIR}/benchmark.log")
  elif [ -f "${RUN_DIR}/run.json" ]; then
    OUTPUT=$(python3 -c "import json; d=json.load(open('${RUN_DIR}/run.json')); print(d.get('output',''))" 2>/dev/null || echo "")
  else
    OUTPUT=""
  fi
else
  OUTPUT=$(cat)
fi

# ── Parse gaps ────────────────────────────────────────────────────────────────
gaps=$(echo "${OUTPUT}" | grep "^ASI gaps=" | sed 's/^ASI gaps=//' || echo "[]")
if [ -z "${gaps}" ] || [ "${gaps}" = "[]" ]; then
  echo "CHECKS: No gaps found — api-specs-enriched is accurate"
  exit 0
fi

gap_count=$(python3 -c "import json,sys; print(len(json.loads(sys.argv[1])))" "${gaps}")
echo ""
echo "============================================"
echo " API-SPECS AUTORESEARCH TRIAGE REPORT"
echo "============================================"
echo ""
echo "Gaps found: ${gap_count}"
echo ""

# ── GitHub org detection ──────────────────────────────────────────────────────
GITHUB_ORG=""
if command -v gh &>/dev/null; then
  GITHUB_ORG=$(cd "${API_SPECS_DIR}" && gh repo view --json owner --jq '.owner.login' 2>/dev/null || echo "")
fi

if [ -z "${GITHUB_ORG}" ]; then
  echo "WARNING: gh not authenticated or api-specs-enriched has no remote — skipping issue creation"
  echo ""
  echo "Gaps (no issues created):"
  python3 -c "
import json, sys
for g in json.loads(sys.argv[1]):
    print(f'  [{g[\"gap_type\"]}] {g[\"resource\"]}: {g[\"description\"]}')
    print(f'    Fix: {g[\"fix_file\"]}')
" "${gaps}"
  echo ""
  exit 1
fi

REPO="${GITHUB_ORG}/api-specs-enriched"

# ── Issue dedup + creation ────────────────────────────────────────────────────
created=0
skipped=0

while IFS='|' read -r idx gap_type resource fix_file description; do
  search_title="[autoresearch] ${gap_type}: ${resource}"

  existing=$(gh issue list \
    --repo "${REPO}" \
    --search "${search_title}" \
    --state open \
    --json number,title \
    --jq 'length' 2>/dev/null || echo "0")

  if [ "${existing}" -gt 0 ]; then
    echo "  SKIP (exists): [${gap_type}] ${resource}"
    skipped=$((skipped + 1))
    continue
  fi

  # Determine label
  label="autoresearch,bug"
  [ "${gap_type}" = "missing_constraint" ] && label="autoresearch,enhancement"

  # Build issue body
  probed=$(python3 -c "
import json, sys
gaps = json.loads(sys.argv[1])
idx = int(sys.argv[2])
print(gaps[idx].get('probed', ''))
" "${gaps}" "${idx}")

  expected=$(python3 -c "
import json, sys
gaps = json.loads(sys.argv[1])
idx = int(sys.argv[2])
print(gaps[idx].get('expected', ''))
" "${gaps}" "${idx}")

  body="**Gap type:** \`${gap_type}\`
**Resource:** \`${resource}\`
**Fix file:** \`${fix_file}\`

**Description:**
${description}

**Probed value:** ${probed}
**Expected value:** ${expected}

---
*Created automatically by autoresearch-api-specs benchmark*
*Run: \`XCSH_API_URL=... bash xcsh/autoresearch-api-specs.sh\`*"

  url=$(gh issue create \
    --repo "${REPO}" \
    --title "${search_title} — ${description:0:60}" \
    --body "${body}" \
    --label "${label}" \
    2>/dev/null || echo "")

  if [ -n "${url}" ]; then
    echo "  CREATED: [${gap_type}] ${resource}"
    echo "    ${url}"
    created=$((created + 1))

    # Draft PR stub for curl_example_fails only
    if [ "${gap_type}" = "curl_example_fails" ]; then
      ts=$(date +%s)
      branch="fix/autoresearch-curl-${resource}-${ts}"
      (cd "${API_SPECS_DIR}" && \
        git checkout -b "${branch}" 2>/dev/null && \
        echo "# autoresearch gap: ${description}" >> "config/minimum_configs.yaml" && \
        git add config/minimum_configs.yaml && \
        git commit -m "fix(minimum_configs): autoresearch gap in ${resource} curl example

Refs: ${url}" && \
        git push origin "${branch}" && \
        gh pr create \
          --repo "${REPO}" \
          --title "fix(minimum_configs): autoresearch gap in ${resource} curl example" \
          --body "Stub PR for: ${url}

Autoresearch detected a failing curl example for \`${resource}\`.
Please replace the stub comment with the corrected minimum config." \
          --draft \
          --base main \
          2>/dev/null || true)
    fi
  else
    echo "  WARN: failed to create issue for [${gap_type}] ${resource}"
  fi
done < <(python3 -c "
import json, sys
for i, g in enumerate(json.loads(sys.argv[1])):
    print(f'{i}|{g[\"gap_type\"]}|{g[\"resource\"]}|{g[\"fix_file\"]}|{g[\"description\"]}')
" "${gaps}")

echo ""
echo "--- Summary ---"
echo "  Issues created: ${created}"
echo "  Issues skipped (already exist): ${skipped}"
echo ""
echo "--- Next steps ---"
echo "1. Fix api-specs-enriched config files per issues above"
echo "2. Run: cd api-specs-enriched && make pipeline && merge"
echo "3. Restart autoresearch"
echo ""

exit 1
