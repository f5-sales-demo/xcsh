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
- metric: ~2880ms (8 files, 2012 lines)
- why it won: 123 kept experiments across 140 runs. -713 lines (26.2% reduction) from original 2725.

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
- Session 5 (current): Export finiteOrNull dedup (-3), export DENIED_KEY_NAMES consistency, simplify readConfig catch (-1), export cloneNumericMetricMap derivation (-7), extract addExperimentTools/removeExperimentTools helpers + compress collectLoggedRunNumbers (-12), consolidate findBestResult into shared findBestKeptResult (-9), derive parseWorkDirDirtyPaths from WithStatus (-6), dead guard removal + ASI compression + hasPendingMetric (-7), extract applyPendingRunToRuntime (-3), readPendingRunSummary inline sort + nonEmpty validator (-5), abandonUnloggedAutoresearchRuns simplification (-4).
- Key finding: Cross-file code duplication is the dominant remaining pattern. Functions with identical or near-identical bodies in different files yield 5-12 lines each when consolidated.
- Session 6: Remove clear() guard (-2), hoist COMPLETION_KEYS constant, consolidate validation loops + dead catch (-5), compress findBaselineMetric/RunNumber (-4), inline isRenameOrCopy + cache trim (-6), eliminate parseDirtyPaths (-4).
- Key finding: Dead code guards (clearInterval(undefined), indexOf on guaranteed-present element, redundant null assignment in catch) are safe 1-2 line wins. Module-level constant hoisting improves function readability but biome line-wrapping often neutralizes line savings.
- Session 7: Batch inline 5 single-use variables across 4 files (cloneNumericMetrics wrapper, resumeContext/resumeGoal aliases, hasAutoresearchMd, errors, raw) (-8), inline renderSecondarySummary (-12), inline renderTableHeader (-2), inline preview/suffix in buildUnsafeDirtyPathsFailure (-2).
- Key finding: Single-use functions with <=2 lines of logic and 1 caller are reliable inline targets. Function signature overhead (4-5 lines) dominates when the body is trivial. Single-use variables assigned then used on the adjacent line are always safe to inline.
- Session 8: Inline 10 single-use vars in parsePendingRunSummary return object (-13), simplify JSONL split/filter chain + nonEmpty in parseControlEntry (-5), inline arraysEqual+normalizeContractPathList (-3), inline isUnsafeContractPathSpec (-2).
- Key finding: Return-object inlining is the highest remaining yield. parsePendingRunSummary had 10 intermediate vars each used once — inlining them all into the return object saved 13 lines in a single change. Biome line-width enforcement is the hard limit: inlines that exceed ~120 chars get re-wrapped to equal or more lines.
- Session 9: Inline getGuardedToolPaths as nested ternary (0 net lines, -1 function). isExperimentStatus inline failed — biome expands 4-way || chain to 5 lines, net regression. Comprehensive function-caller analysis: all remaining private functions have 2+ callers or 4+ body lines. createSessionRuntime cannot be un-exported (used in 16+ test callsites).
- Key finding (revised): The prior "structural minimum" was premature. Two unexplored strategies yielded further gains:
- Strategy: Replace manual algorithms with built-in APIs (Intl.NumberFormat for commas() -7 lines, loop for nested try-catch -3 lines).
- Strategy: Convert imperative loops to functional chains (collectUnsafeDirtyPaths .map().filter().map() -3 lines) and flatten if-blocks with ternary fallbacks (parseAsiValue -2 lines, slugifyGoal -1 line).
- Session 10: Replace commas() with Intl.NumberFormat + inline fmtNum (-7), compress killTree nested try-catch to loop (-3), compress slugifyGoal + convert collectUnsafeDirtyPaths to functional (-4), flatten parseAsiValue number parsing (-2). Total: -16 lines.
- Session 11: Batch micro-compressions: inline bestRunNumber (-1), merge consecutive parts.push (-1), convert getNextAutoresearchRunNumber to functional (-1), inline runNumber in renderResultRow (-1), derive normalizeContractPathSpec from normalizeAutoresearchPath (-2). Total: -6 lines.
- Session 12: Convert computeRunModifiedPaths to functional filter chain (-1), convert parseMetricLines to functional Map constructor (-2). Total: -3 lines. Continuing the imperative-to-functional pattern that keeps yielding 1-2 lines per conversion.
- Session 13: Extract tryReadFile helper in contract.ts to unify 3 readFileSync try-catch blocks (-6), inline readConfig variables (-2). Total: -8 lines.
- Session 14: Merge resume+new-session command branches into unified activation flow (-8), merge off+clear handlers into single conditional branch (-8). Total: -16 lines.
- Key finding: Branch deduplication at the control-flow level (merging if-branches with shared tails) is a distinct strategy from code-level dedup. It wasn't attempted until session 14 because it requires rethinking the control flow, not just looking for duplicate expressions.
- Session 15: Inline spinner variable (-1), convert parsedPrimary push to braceless if (-1). Total: -2 lines. Genuine micro-territory now.
- Session 16: Convert 5 small interfaces (ASIData, NumericMetricMap, MetricDef, LogDetails, PendingRunSummary) in types.ts to 1-line type aliases (-14), convert 3 internal interfaces (ReconstructedExperimentData, AutoresearchControlEntryData, RuntimeStore) in state.ts to type aliases (-9). toolsChanged guard removal failed (tested behavior). Total: -23 lines.
- Key finding: Small interfaces with 2-3 fields are strictly more compact as type aliases: 4-line interface → 1-line type = -3 per conversion. Named type aliases (not anonymous inline types) have identical tsgo performance to named interfaces. This is a new optimization class not attempted in any prior session.
- Session 17: Remove blank lines between consecutive type/const declarations: types.ts (-4 then -11), state.ts (-2), helpers.ts (-2). Total: -19 lines.
- Key finding: biome does not enforce blank separators between any top-level declarations. A pure-type file like types.ts can have all declarations contiguous. This is the highest-yield 'free' optimization — no code changes, just whitespace removal.
