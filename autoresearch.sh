#!/usr/bin/env bash
# autoresearch.sh — deterministic benchmark for xcsh autoresearch subsystem
# Measures: biome lint + tsgo type check on packages/coding-agent/src/autoresearch/
# Uses median of 3 samples to reduce noise from system activity.
set -euo pipefail

AUTORESEARCH_DIR="packages/coding-agent/src/autoresearch"
SAMPLES=3

# --- Static metrics (no variance) ---
file_count=$(find "$AUTORESEARCH_DIR" -name '*.ts' -not -path '*/tools/*' | wc -l | tr -d ' ')
echo "METRIC file_count=$file_count"

line_count=$(find "$AUTORESEARCH_DIR" -name '*.ts' -not -path '*/tools/*' -exec cat {} + | wc -l | tr -d ' ')
echo "METRIC line_count=$line_count"

# --- Helper: monotonic ms ---
ms() { python3 -c 'import time; print(int(time.monotonic_ns() / 1_000_000))'; }

# --- Helper: median of space-separated values ---
median() {
  python3 -c "
import sys
vals = sorted(int(x) for x in sys.argv[1:])
n = len(vals)
print(vals[n // 2])
" "$@"
}

# --- Collect samples ---
biome_samples=()
tsgo_samples=()

for i in $(seq 1 $SAMPLES); do
  # Biome
  t0=$(ms)
  npx biome check "$AUTORESEARCH_DIR" --no-errors-on-unmatched >/dev/null 2>&1 || true
  t1=$(ms)
  biome_samples+=($((t1 - t0)))

  # tsgo
  t0=$(ms)
  npx tsgo -p packages/coding-agent/tsconfig.json --noEmit >/dev/null 2>&1
  t1=$(ms)
  tsgo_samples+=($((t1 - t0)))
done

# --- Compute medians ---
biome_ms=$(median "${biome_samples[@]}")
tsgo_ms=$(median "${tsgo_samples[@]}")
check_ms=$((biome_ms + tsgo_ms))

echo "METRIC biome_ms=$biome_ms"
echo "METRIC tsgo_ms=$tsgo_ms"
echo "METRIC check_ms=$check_ms"
