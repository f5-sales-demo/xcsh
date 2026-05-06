#!/usr/bin/env bash
# autoresearch.sh — user profile system prompt hint UAT benchmark
# Primary metric:   hint_chars  (lower is better, baseline 581)
# Secondary metric: test_time_ms (lower is better, baseline ~16500)
# Secondary metric: test_pass_count (higher is better, target 122)
#
# Run from repo root: bash autoresearch.sh

set -euo pipefail

PKG="packages/coding-agent"
TEMPLATE="$PKG/src/prompts/system/system-prompt.md"

# --- Metric 1: hint_chars ---
# Extract the {{#if userProfile}}...{{/if}} block from the template (raw, no rendering needed).
# We optimize wording not variable expansion, so raw char count is the right proxy.
HINT_BLOCK=$(python3 - <<'PY'
import sys, re
text = open("packages/coding-agent/src/prompts/system/system-prompt.md").read()
m = re.search(r'\{\{#if userProfile\}\}([\s\S]*?)\{\{/if\}\}', text)
if not m:
    print("ERROR: {{#if userProfile}} block not found", file=sys.stderr)
    sys.exit(1)
print(m.group(0), end="")
PY
)
HINT_CHARS=${#HINT_BLOCK}

echo "METRIC hint_chars=$HINT_CHARS"

# --- Metric 2+3: test_time_ms, test_pass_count ---
START_MS=$(python3 -c "import time; print(int(time.time() * 1000))")

bun test \
    "$PKG/test/system-prompt-profile.test.ts" \
    "$PKG/test/welcome-checks-profile.test.ts" \
    "$PKG/test/internal-urls/user-profile-merge.test.ts" \
    "$PKG/test/internal-urls/user-profile.test.ts" \
    "$PKG/test/internal-urls/seed-profile.test.ts" \
    "$PKG/test/internal-urls/profile-collectors.test.ts" \
    "$PKG/test/internal-urls/xcsh-protocol.test.ts" \
    "$PKG/test/welcome-checks.test.ts" \
    "$PKG/test/welcome-component.test.ts" \
    2>&1 | tee /tmp/autoresearch-uat.txt

END_MS=$(python3 -c "import time; print(int(time.time() * 1000))")
TEST_TIME_MS=$(( END_MS - START_MS ))

PASS_COUNT=$(grep -oE "[0-9]+ pass" /tmp/autoresearch-uat.txt | grep -oE "^[0-9]+" | head -1 || echo 0)

echo "METRIC test_time_ms=$TEST_TIME_MS"
echo "METRIC test_pass_count=$PASS_COUNT"
