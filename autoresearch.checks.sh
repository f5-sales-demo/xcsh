#!/usr/bin/env bash
# autoresearch.checks.sh — correctness gate for user profile hint UAT
# Fails (exit 1) if any invariant is violated.
# Runs AFTER autoresearch.sh passes.

set -euo pipefail

TEMPLATE="packages/coding-agent/src/prompts/system/system-prompt.md"
FAIL=0

check() {
    if ! grep -q "$1" "$TEMPLATE"; then
        echo "FAIL: template missing required content: $1"
        FAIL=1
    fi
}

echo "--- Content invariants ---"
check "Primary Human"
check "xcsh://user"
check "MUST"
check "SHOULD NOT"
check "userProfile.name"
check "userProfile.role"
check "userProfile.org"

# Verify the Internal URLs section has the protocol entries
check "Primary human user profile"
check "xcsh://user?seed=true"

# Verify computer profile protocol entries
check "xcsh://computer"
check "computerProfile"
check "Machine hardware and environment profile"
check "Managed"

# Verify enriched hints
check "computerProfile.admin"
check "endpointAgentCount"
check "forecastBreakdown"
check "partnerName"
check "partnerRole"
check "not admin"

echo "--- Type check ---"
bun check:ts 2>&1 | tail -3

if [ "$FAIL" -ne 0 ]; then
    echo "CHECKS FAILED — required content missing from template"
    exit 1
fi

echo "ALL CHECKS PASSED"
