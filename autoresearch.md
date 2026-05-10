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
- metric: ~2640ms (8 files, 1635 lines)
- why it won: 172 kept experiments across 193+ runs. -1090 lines (40.0% reduction) from original 2725.

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

- Session 18: Within-function blank line removal across 6 files + DirtyPathEntry type alias (-37), safe single-use variable inlining (hasAutoresearchMd, controlState, lines, runsDir) + template literal conversion (-6), between-function blank removal for same-group functions + guard merge (-5), cloneNumericMetricMap imperative-to-functional (-2), EXPERIMENT_TOOLS Set consolidation (-1), formatNum fraction inline + clonePendingAsiValue functional (-2), braceless for-of (-1). Total: -54 lines.
- Key finding: Within-function blank lines are the dominant remaining free optimization (34 blanks removed in one batch). biome does not enforce blank lines between statements within function bodies. However, blanks between functions in DIFFERENT semantic groups should be preserved for readability.
- Key finding: Single-use variable inlining is constrained by biome line width. Variables whose inlined form exceeds ~110 chars at the given indent depth are ANTI-optimizations — biome expands them to MORE lines than the original. Always verify with `npx biome check` before committing.
- Key finding: Between-function blank removal only works for tightly-coupled same-group functions (e.g., cloneAsiData/clonePendingAsiValue, readRunDirectoryEntries/readRunArtifact). Blanks between semantically distinct functions should stay.
- Structural minimum assessment: All remaining optimization classes are exhausted. No more 2-3 field interfaces to convert, no more single-use variables that fit biome width, no more imperative loops with filter+map semantics, no more within-function blanks worth removing. The 14 remaining blank lines all serve readability. Further gains would require architectural changes (merging functions, changing public APIs) which are constrained by the off-limits tools/ directory.
- Session 19: parseWorkDirDirtyPathsWithStatus loop→flatMap (-3), mergeAsi return compression (-3), readConfig conditional spread (-2), blocked() factory closure (-4), inferMetricUnitFromName endsWith→regex (-4), createRuntimeStore.ensure has+set+get! (-3), git.status options one-liner (-4), fail() factory for error returns (-3), return object compressions (-12). Event loop dedup + completions inline + renderSecondaryCell ternary all failed (biome wraps). Total: -38 lines.
- Key finding: Factory closures (blocked(), fail()) save 1 line per call site even when biome wraps the call, because they eliminate the discriminant property line. Small return objects (<=3 properties, <=115 chars) compress to single lines. biome wraps callback return objects and chained method objects even under 120 chars. endsWith chain→regex is high-yield (-4 from 5 branches to 2 lines).
- Key finding: biome wraps || chains, ternary conditions, and callback return objects regardless of total line width. biome's wrapping decisions depend on expression complexity, not just character count. Always verify with `npx biome check`.
- Session 20: filter-before-map in renderDashboardLines secondary metrics (-3), sortedMedian midpoint→ternary+bitshift (-1), parseControlEntry conditional spread (-2), renderExpandedHeader inline state alias (-1), renderModeStatus+computeConfidence if-return/return→ternary (-2). contract.ts/git.ts/helpers.ts ternary conversions rejected by biome. Total: -9 lines.
- Key finding: if-return/return → ternary works only when the combined expression is <~100 chars at the given indent depth. biome wraps ternaries with function-call branches or || chains even under 120 chars total. Of 6 candidates, only 2 passed biome.
- Key finding: filter-before-map (filter(cond).map(transform)) replaces map(x => cond ? transform : null).filter(nonNull). Eliminates callback braces, intermediate variable, null branch, and type predicate. Use non-null assertion (!) when filter guarantees the property exists.
- Session 21: Convert 13 single-return function declarations to arrow-function constants across 5 files: state.ts (cloneExperimentState, currentResults, findBaselineResult, findBaselineMetric, nonEmpty, isExperimentStatus), helpers.ts (finiteOrNull, commas, getAutoresearchRunDirectory, isAutoresearchCommittableFile, isBetter), contract.ts (normalizeContractPathSpec), git.ts (parseWorkDirDirtyPaths), index.ts (collectLoggedRunNumbers). normalizeAutoresearchList failed (biome wraps [...spread] bracket). Total: -17 lines.
- Key finding: function→arrow is the highest-yield new class since session 16 (interface→type alias). 3-line functions with a single return → 1-line arrow (< 120 chars, -2) or 2-line arrow (biome wraps body, -1). Arrow functions preserve type predicates (v is string), export semantics, and spyOn compatibility. biome wraps arrow bodies at ~100 chars effective width at the given indent depth.
- Session 22: Remove JSDoc from applyAutoresearchContractToExperimentState (-4), remove inline comment in getArgumentCompletions (-2). registerTool factory loop failed (TS generics reject union). Total: -6 lines.
- Key finding: Comment removal is the last remaining optimization class. All structural, syntactic, and formatting optimizations are exhausted.
- Structural minimum (definitive): 22 optimization classes applied across 22 sessions. No remaining single-return functions, small interfaces, within-function blanks, braceless candidates, map→filter→null, endsWith chains, or factory closure opportunities. All remaining code has multi-statement bodies, 2+ callers, or biome-irreducible formatting. 14 blank lines between distinct groups + 76 import lines are irreducible overhead.
- Session 23: Compress renderResultRow secondary map callback via parameter shortening metric→m (-3), braceless if-push for archived runs (-1). Single-line multi-statement if-blocks rejected by biome. Total: -4 lines.
- Key finding: Callback parameter shortening (6-char → 1-char) can push expressions below biome wrapping thresholds. Per-instance check required.
- Session 24: Pick<ExperimentState, shared_fields> for AutoresearchContract (-3, blank line -1) and RunDetails (-2). Scroll ternary failed (biome expands nested ternaries). Total: -6 lines.
- Key finding: Structural type sharing via Pick/extends is a new class. Interfaces sharing 2+ identically-typed fields can use extends Pick to eliminate duplication. -1 per shared field. biome expands nested ternary chains — if/else if is more compact for 4+ branches.
- Session 25-27: arrEq helper extraction + arrow contractListsEqual (-4). All 7 remaining non-import between-function blanks removed (-7). Namespace imports: state.ts types (-9), index.ts helpers+state (-18), dashboard.ts state (-6). String.split() for AUTORESEARCH_COMMITTABLE_FILES (-3) and COMPLETION_KEYS (-8). Pick<RunDetails> for RunExperimentProgressDetails (-2). Total: -57 lines across 3 sessions.
- Key finding: Namespace import (import * as X) is the highest-yield single-session class (-31 in session 26). Each 5+-specifier named import block saves 6-9 lines for a 1-line namespace import. Only 2 of 71 prefixed references caused biome wrapping.
- Key finding: String.split(' ') bypasses biome's array literal formatting. biome forces one-element-per-line for string arrays, but cannot reformat string content. Trade-off: less readable but saves ~1 line per element. Crossed 1000 lines removed (36.8% total reduction).
- Session 28: Export findBaselineResult + remove local-only findBaselineRunNumber (-1 net). 31 optimization classes across 28 sessions.
- Key finding: Export promotion + function elimination works when a function is consumed only by in-scope files (not tools/test). The eliminated function's body is inlined at its single call site. Net savings depend on biome wrapping at the call site.