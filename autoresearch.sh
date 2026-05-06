#!/usr/bin/env bash
# autoresearch.sh — user profile system prompt hint UAT benchmark
#
# Primary metric:   rendered_hint_chars (lower is better)
#                   Actual LLM overhead = render(with_profile) - render(without_profile)
# Secondary metric: source_hint_chars   (template source chars, for reference)
# Secondary metric: test_time_ms        (lower is better)
# Secondary metric: test_pass_count     (must be 115)
#
# Runs locally via bun (no CI, no binary compilation needed).
# Template changes take effect immediately — bun executes TypeScript directly.
#
# Run from repo root: bash autoresearch.sh

set -euo pipefail

PKG="packages/coding-agent"
TEMPLATE="$PKG/src/prompts/system/system-prompt.md"

# --- Metric 1: rendered_hint_chars (primary) ---
# Render the actual system prompt through the real codepath with realistic profile data.
# Difference between with-profile and without-profile = exact LLM token overhead.
RENDERED_OUTPUT=$(bun "$PKG/autoresearch-measure.ts" 2>&1)
RENDERED_HINT_CHARS=$(echo "$RENDERED_OUTPUT" | grep -oE "rendered_hint_chars=[0-9]+" | grep -oE "[0-9]+")

echo "$RENDERED_OUTPUT"
echo ""

# --- Metric 2: source_hint_chars (reference) ---
# Raw template char count — includes Handlebars syntax that disappears at render time.
SOURCE_BLOCK=$(python3 - <<'PY'
import sys, re
text = open("packages/coding-agent/src/prompts/system/system-prompt.md").read()
m = re.search(r'\{\{#if userProfile\}\}([\s\S]*?)\{\{/if\}\}', text)
if not m:
    print("ERROR: {{#if userProfile}} block not found", file=sys.stderr)
    sys.exit(1)
print(m.group(0), end="")
PY
)
SOURCE_HINT_CHARS=${#SOURCE_BLOCK}

echo "METRIC source_hint_chars=$SOURCE_HINT_CHARS"

# --- Metric 3+4: test_time_ms, test_pass_count ---
START_MS=$(python3 -c "import time; print(int(time.time() * 1000))")

bun test \
    "$PKG/test/profile-hint-and-checks.test.ts" \
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

echo ""
echo "=== SUMMARY ==="
echo "  rendered_hint_chars: $RENDERED_HINT_CHARS  (primary — what the LLM sees)"
echo "  source_hint_chars:   $SOURCE_HINT_CHARS  (template source, includes Handlebars syntax)"
echo "  test_pass_count:     $PASS_COUNT"
echo "  test_time_ms:        $TEST_TIME_MS"
