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
- metric: ~2880ms (segment 2, within noise of baseline after quality improvements)
- why it won: Un-exported 12+ internal symbols across helpers.ts, state.ts, dashboard.ts, git.ts, contract.ts. Merged apply-contract-to-state logic into contract.ts.

## What's Been Tried
- Experiment 1-2: checks script iterations — bun check:ts triggers API spec regeneration, fixed by running lint+typecheck directly
- Experiment 3 (kept): Un-export internal-only symbols in helpers.ts/state.ts/dashboard.ts. -6.7% (segment 1)
- Experiment 4 (discarded): Inline AutoresearchConfig type — named types are FASTER for tsgo than inline object types
- Experiment 5 (kept): Un-export 6 more symbols in git.ts/contract.ts. Within noise, code quality win.
- Key finding: tsgo dominates the benchmark (~82%). Changes within autoresearch/ have limited tsgo impact since it checks the full coding-agent.
- Key finding: biome has extreme variance (200ms-4800ms). Must use median sampling.
