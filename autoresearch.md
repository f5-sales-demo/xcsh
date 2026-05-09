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
- metric: 2881ms median (segment 2 baseline)
- notes: 8 files, 2720 lines. Median of 3 samples.

## Current best
- metric: ~2750ms (8 files, 2491 lines)
- why it won: 42 kept experiments across 42 runs, 34 git commits. -234 lines (8.6% reduction) from original 2725. ~12% check_ms improvement from original 3054ms baseline.

## What's Been Tried
- Experiments 1-12: Un-export symbols, type relocation, pattern consolidation, Set conversion (see previous session notes)
- Experiment 13 (kept): Consolidate git.ts parsers — derive parseDirtyPaths from parseDirtyPathsWithStatus, delete 3 duplicate functions. -47 lines.
- Experiment 14 (kept): Extract finiteOrNull helper in helpers.ts, replace 6 verbose typeof+isFinite patterns. -10 lines.
- Experiment 15 (kept): Add finiteOrNull to state.ts, simplify 4 JSONL result parsing patterns.
- Experiment 16 (kept): Simplify readMaxExperiments, use finiteOrNull in cloneNumericMetrics. -3 lines.
- Experiment 17 (kept): Consolidate duplicate write/ast_edit branches, inline single-use looksLikeInternalUrl. -8 lines.
- Experiment 18 (kept): Inline single-use hasLocalAutoresearchState. -3 lines.
- Experiment 19 (kept): Inline branchExists, remove unused api param from allocateBranchName. -6 lines.
- Experiment 20 (kept): Delegate cloneAsiData to clonePendingAsiValue, eliminate duplicated loop. -8 lines.
- Experiment 21 (kept): Use finiteOrNull in cloneNumericMetricMap for consistency. -2 lines.
- Session 4: refreshPendingRun helper (-2), structuredClone for cloneExperimentState (-11), merge duplicate off-mode handlers (-10), EXPERIMENT_TOOL_SET constant (-3), inline createEmptyAutoresearchContract (-11), structuredClone for cloneAsi (-3), inline normalizeKey+parseDirection (-8).
- Key finding: tsgo dominates (~82%). Named types > inline types for tsgo.
- Key finding: biome has extreme variance (200ms-4800ms). Must use median sampling.
- Key finding: Deriving simple API from rich API is the highest-yield pattern (-47 lines from git.ts alone).
- Key finding: Single-use helpers <5 lines are better inlined. Delegation > duplication for larger patterns.
