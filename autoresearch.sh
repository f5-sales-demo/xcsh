#!/usr/bin/env bash
# autoresearch.sh — deterministic benchmark for xcsh autoresearch subsystem
# Measures: biome lint + tsgo type check time on packages/coding-agent/src/autoresearch/
set -euo pipefail

AUTORESEARCH_DIR="packages/coding-agent/src/autoresearch"

# --- Metric: file_count ---
file_count=$(find "$AUTORESEARCH_DIR" -name '*.ts' -not -path '*/tools/*' | wc -l | tr -d ' ')
echo "METRIC file_count=$file_count"

# --- Metric: line_count ---
line_count=$(find "$AUTORESEARCH_DIR" -name '*.ts' -not -path '*/tools/*' -exec cat {} + | wc -l | tr -d ' ')
echo "METRIC line_count=$line_count"

# --- Metric: biome_ms (lint check on autoresearch sources) ---
biome_start=$(python3 -c 'import time; print(int(time.monotonic_ns() / 1_000_000))')
npx biome check "$AUTORESEARCH_DIR" --no-errors-on-unmatched 2>&1 || true
biome_end=$(python3 -c 'import time; print(int(time.monotonic_ns() / 1_000_000))')
biome_ms=$((biome_end - biome_start))
echo "METRIC biome_ms=$biome_ms"

# --- Metric: tsgo_ms (type check on coding-agent) ---
tsgo_start=$(python3 -c 'import time; print(int(time.monotonic_ns() / 1_000_000))')
npx tsgo -p packages/coding-agent/tsconfig.json --noEmit 2>&1
tsgo_end=$(python3 -c 'import time; print(int(time.monotonic_ns() / 1_000_000))')
tsgo_ms=$((tsgo_end - tsgo_start))
echo "METRIC tsgo_ms=$tsgo_ms"

# --- Primary metric: check_ms (total) ---
check_ms=$((biome_ms + tsgo_ms))
echo "METRIC check_ms=$check_ms"
