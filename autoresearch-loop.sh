#!/usr/bin/env bash
# autoresearch-loop.sh — Intelligence quality iteration loop
#
# Runs the full measurement + gate + test cycle for the autoresearch loop.
# Use after making code changes to hints, templates, or intelligence gathering.
#
# What it does:
#   1. Records baseline metrics (or loads from previous run)
#   2. Runs live measurement with real cache data
#   3. Runs template measurement with fake data (regression check)
#   4. Runs correctness gate (invariants + type check)
#   5. Runs test suite
#   6. Compares against baseline, reports deltas
#
# Run from repo root: bash autoresearch-loop.sh

set -euo pipefail

PKG="packages/coding-agent"
BASELINE_FILE="/tmp/autoresearch-baseline.json"
RESULT_FILE="/tmp/autoresearch-result.json"

echo "========================================"
echo "  AUTORESEARCH ITERATION LOOP"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"
echo ""

# --- Step 1: Template measurement (fake data — regression check) ---
echo "--- STEP 1: Template measurement ---"
TEMPLATE_OUTPUT=$(bun "$PKG/autoresearch-measure.ts" 2>&1)
RENDERED_HINT_CHARS=$(echo "$TEMPLATE_OUTPUT" | grep -oE "rendered_hint_chars=[0-9]+" | grep -oE "[0-9]+")
COMPUTER_HINT_CHARS=$(echo "$TEMPLATE_OUTPUT" | grep -oE "rendered_computer_hint_chars=[0-9]+" | grep -oE "[0-9]+" || echo "0")
SF_HINT_CHARS=$(echo "$TEMPLATE_OUTPUT" | grep -oE "rendered_salesforce_hint_chars=[0-9]+" | grep -oE "[0-9]+" || echo "0")
TOTAL_INTELLIGENCE=$(echo "$TEMPLATE_OUTPUT" | grep -oE "total_intelligence_overhead=[0-9]+" | grep -oE "[0-9]+" || echo "0")
TOTAL_PROMPT=$(echo "$TEMPLATE_OUTPUT" | grep -oE "total_prompt_with_all=[0-9]+" | grep -oE "[0-9]+" || echo "0")

# Token estimates
USER_TOKENS=$(echo "$TEMPLATE_OUTPUT" | grep -oE "user_hint_tokens=[0-9]+" | grep -oE "[0-9]+" || echo "0")
COMPUTER_TOKENS=$(echo "$TEMPLATE_OUTPUT" | grep -oE "computer_hint_tokens=[0-9]+" | grep -oE "[0-9]+" || echo "0")
SF_TOKENS=$(echo "$TEMPLATE_OUTPUT" | grep -oE "sf_hint_tokens=[0-9]+" | grep -oE "[0-9]+" || echo "0")
TOTAL_TOKENS=$(echo "$TEMPLATE_OUTPUT" | grep -oE "total_prompt_tokens=[0-9]+" | grep -oE "[0-9]+" || echo "0")

echo "  hint_chars: user=$RENDERED_HINT_CHARS computer=$COMPUTER_HINT_CHARS sf=$SF_HINT_CHARS total=$TOTAL_INTELLIGENCE"
echo "  hint_tokens: user=$USER_TOKENS computer=$COMPUTER_TOKENS sf=$SF_TOKENS"
echo "  prompt: ${TOTAL_PROMPT} chars / ~${TOTAL_TOKENS} tokens"
echo ""

# --- Step 2: Live measurement (real cache data) ---
echo "--- STEP 2: Live measurement (real cache) ---"
if [ -f "$PKG/autoresearch-measure-live.ts" ]; then
    bun "$PKG/autoresearch-measure-live.ts" 2>&1 || echo "  [WARN] Live measurement failed (missing cache?)"
else
    echo "  [SKIP] autoresearch-measure-live.ts not found"
fi
echo ""

# --- Step 3: Correctness gate ---
echo "--- STEP 3: Correctness gate ---"
if bash autoresearch.checks.sh 2>&1; then
    GATE_PASS="true"
else
    GATE_PASS="false"
    echo "  [FAIL] Correctness gate failed!"
fi
echo ""

# --- Step 4: Test suite ---
echo "--- STEP 4: Test suite ---"
START_MS=$(python3 -c "import time; print(int(time.time() * 1000))")
bun test \
    "$PKG/test/profile-hint-and-checks.test.ts" \
    "$PKG/test/internal-urls/user-profile-merge.test.ts" \
    "$PKG/test/internal-urls/user-profile.test.ts" \
    "$PKG/test/internal-urls/seed-profile.test.ts" \
    "$PKG/test/internal-urls/profile-collectors.test.ts" \
    "$PKG/test/internal-urls/xcsh-protocol.test.ts" \
    "$PKG/test/internal-urls/computer-profile.test.ts" \
    "$PKG/test/internal-urls/salesforce-context.test.ts" \
    "$PKG/test/welcome-checks.test.ts" \
    "$PKG/test/welcome-component.test.ts" \
    2>&1 | tee /tmp/autoresearch-loop-tests.txt
END_MS=$(python3 -c "import time; print(int(time.time() * 1000))")
TEST_TIME_MS=$(( END_MS - START_MS ))
PASS_COUNT=$(grep -oE "[0-9]+ pass" /tmp/autoresearch-loop-tests.txt | grep -oE "^[0-9]+" | head -1 || echo 0)
FAIL_COUNT=$(grep -oE "[0-9]+ fail" /tmp/autoresearch-loop-tests.txt | grep -oE "^[0-9]+" | head -1 || echo 0)
echo ""

# --- Step 5: Save results ---
python3 - <<PY
import json, os
result = {
    'rendered_hint_chars': int('$RENDERED_HINT_CHARS'),
    'computer_hint_chars': int('$COMPUTER_HINT_CHARS'),
    'sf_hint_chars': int('$SF_HINT_CHARS'),
    'total_intelligence': int('$TOTAL_INTELLIGENCE'),
    'total_prompt_chars': int('$TOTAL_PROMPT'),
    'user_tokens': int('$USER_TOKENS'),
    'computer_tokens': int('$COMPUTER_TOKENS'),
    'sf_tokens': int('$SF_TOKENS'),
    'total_tokens': int('$TOTAL_TOKENS'),
    'test_pass': int('$PASS_COUNT'),
    'test_fail': int('$FAIL_COUNT'),
    'test_time_ms': int('$TEST_TIME_MS'),
    'gate_pass': '$GATE_PASS' == 'true',
}
with open('$RESULT_FILE', 'w') as f:
    json.dump(result, f, indent=2)

# Load or create baseline
if os.path.exists('$BASELINE_FILE'):
    with open('$BASELINE_FILE') as f:
        baseline = json.load(f)
else:
    baseline = result.copy()
    with open('$BASELINE_FILE', 'w') as f:
        json.dump(baseline, f, indent=2)
    print('  [INFO] No baseline found — this run IS the baseline')
    print(f'  Saved to {"$BASELINE_FILE"}')

# Report deltas
print('')
print('=== DELTA FROM BASELINE ===')
for key in ['rendered_hint_chars', 'computer_hint_chars', 'sf_hint_chars', 'total_intelligence', 'total_prompt_chars', 'total_tokens', 'test_pass']:
    bv = baseline.get(key, 0)
    rv = result.get(key, 0)
    delta = rv - bv
    arrow = '+' if delta > 0 else '' if delta == 0 else ''
    indicator = 'SAME' if delta == 0 else f'{arrow}{delta}'
    print(f'  {key}: {bv} -> {rv} ({indicator})')

print('')
print('=== VERDICT ===')
if not result['gate_pass']:
    print('  FAIL: Correctness gate failed')
elif result['test_fail'] > 0:
    print(f'  FAIL: {result["test_fail"]} test(s) failed')
elif result['total_intelligence'] > baseline.get('total_intelligence', 999999) + 100:
    print(f'  WARN: Intelligence overhead grew by {result["total_intelligence"] - baseline["total_intelligence"]} chars')
else:
    print('  PASS: All checks green')

print(f'  Tests: {result["test_pass"]} pass / {result["test_fail"]} fail in {result["test_time_ms"]}ms')
print(f'  Prompt: {result["total_prompt_chars"]} chars / ~{result["total_tokens"]} tokens')
print(f'  Intelligence overhead: {result["total_intelligence"]} chars')
PY

echo ""
echo "To reset baseline: rm $BASELINE_FILE"
echo "To run again after edits: bash autoresearch-loop.sh"
