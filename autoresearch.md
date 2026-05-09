# Autoresearch

## Goal
Improve xcsh autoresearch subsystem code quality — reduce complexity, remove dead code, simplify types, and make the self-improvement machinery clean and deterministic. Every improvement must preserve correctness verified by the full `bun check:ts` suite.

## Benchmark
- command: bash autoresearch.sh
- primary metric: check_ms
- metric unit: ms
- direction: lower
- secondary metrics: biome_ms, tsgo_ms, file_count, line_count

## Files in Scope
- packages/coding-agent/src/autoresearch/

## Off Limits
- packages/coding-agent/src/autoresearch/tools/
- packages/coding-agent/test/

## Constraints
- `bun check:ts` must pass with exit code 0 (enforced by autoresearch.checks.sh)
- No functional regressions — all existing autoresearch tests must pass
- No changes to tool parameter schemas (these are the agent-facing API contract)
- Preserve all public exports consumed by other modules

## Baseline
- metric: ~2850ms median (biome ~500ms + tsgo ~2350ms)
- notes: 8 files, 2720 lines. Updated harness to median of 3 samples to reduce noise.

## Current best
- metric: 2850ms (run #5)
- why it won: Un-exported internal-only symbols, merged apply-contract-to-state into contract.ts

## What's Been Tried
- Experiment 1-2: checks script iterations — bun check:ts triggers API spec regeneration, fixed by running lint+typecheck directly
- Experiment 3 (kept): Un-export internal-only symbols (METRIC/ASI prefixes, commas, fmtNum, sortedMedian, findBaselineResult, renderDashboardLines). -6.7%
- Experiment 4 (discarded): Inline AutoresearchConfig type — named types are FASTER for tsgo than inline object types
- Measurement noise: single biome runs vary 500ms-4800ms; tsgo varies 2300-2700ms. Switched to median of 3.
