#!/usr/bin/env bash
# autoresearch.checks.sh — correctness gate for xcsh autoresearch experiments
# Must pass before any experiment can be kept.
#
# Does NOT run `bun check:ts` directly because that triggers api-spec-index
# and build-info regeneration, modifying generated files outside scope.
# Instead runs the essential checks (lint + type check) without generation.
set -euo pipefail

echo "=== Biome lint check ==="
npx biome check . --no-errors-on-unmatched

echo "=== TypeScript type check (coding-agent) ==="
npx tsgo -p packages/coding-agent/tsconfig.json --noEmit

echo "=== Prompt format check ==="
bun packages/coding-agent/scripts/format-prompts.ts --check

echo "=== Autoresearch tests ==="
bun test packages/coding-agent/test/autoresearch-state.test.ts packages/coding-agent/test/autoresearch-tools.test.ts

echo "=== All checks passed ==="
