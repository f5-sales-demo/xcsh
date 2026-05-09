# Autoresearch Program — xcsh Self-Improvement

## Repo-Specific Knowledge

### Build System
- `bun check:ts` = biome check + tsgo type check across all workspaces
- Per-package check: `npx biome check <dir>` + `npx tsgo -p <package>/tsconfig.json --noEmit`
- `bun check:ts` downloads API specs from GitHub on every run (~15s overhead) — avoid in benchmark hot path
- Tests: `bun test <specific-file>` — never `bun test` globally

### Autoresearch Subsystem Architecture
- Entry: `packages/coding-agent/src/autoresearch/index.ts` — extension factory, registers tools + commands + shortcuts
- Contract: `contract.ts` — parses `autoresearch.md` markdown into typed contract, validates fields
- State: `state.ts` — reconstructs experiment state from `autoresearch.jsonl`, manages runtime store
- Git: `git.ts` — branch isolation (creates `autoresearch/` branches), dirty path detection
- Dashboard: `dashboard.ts` — TUI widget rendering experiment status
- Helpers: `helpers.ts` — metric parsing, file utils, ASI parsing, path normalization
- Types: `types.ts` — all TypeScript interfaces and type definitions
- Tools: `tools/{init,run,log}-experiment.ts` — the three experiment lifecycle tools (OFF LIMITS)

### Code Conventions
- No `private`/`protected`/`public` keywords — use ES `#` for private fields
- No `ReturnType<>` — use actual type names
- No inline imports — always top-level
- No `console.log/error/warn` — use logger
- Bun APIs preferred over Node equivalents
- `import * as fs from "node:fs"` (namespace imports, not named)

## Strategy

### What Works
- Removing dead code paths that no consumer reaches
- Simplifying complex type hierarchies into flatter structures
- Consolidating duplicate logic into shared helpers
- Reducing file count by merging small single-purpose modules

### What Doesn't Work
- Removing types that tools/index.ts imports — always check references first
- Changing function signatures consumed by tools/ — the tools are off-limits
- Changing the `autoresearch.md` parsing format — it's the user-facing contract
- Moving exports between files without updating all consumers

### Failure Patterns
- Editing types.ts without checking who imports each type → compile errors in tools/
- Removing helpers that seem unused but are imported by the tools/ directory
- Changing the AUTORESEARCH_COMMITTABLE_FILES list — affects git commit behavior
- Breaking the METRIC line format in helpers.ts — affects all experiments
- Inlining named types into anonymous object types — makes tsgo SLOWER
- Forgetting `npx biome format --write` after edits — biome format check will fail

## Improvement Categories (Updated Priority)
1. ✅ Un-export internal-only symbols (exhausted — 16+ symbols, remaining exports needed by tools/)
2. ✅ Dead code elimination (cloneStringArray, addDirtyPath, constants, single-use helpers)
3. ✅ Relocate internal-only types to consumer files (8 types moved from types.ts)
4. ✅ Consolidate duplicate patterns (formatDelta, parseNormalizedStringList, readRunArtifact, finiteOrNull)
5. ✅ Derive simple APIs from rich ones (parseDirtyPaths from parseDirtyPathsWithStatus) — highest yield
6. ✅ Inline single-use helper functions (<5 lines)
7. ✅ Convert arrays to Sets for O(1) lookups
8. Reduce module count (blocked: apply-contract-to-state.ts)
9. Further dashboard rendering simplification (diminishing returns)

## Measurement Notes
- `check_ms` = biome_ms + tsgo_ms (excludes file_count/line_count which are static measures)
- Biome is fast (~200-500ms) but VERY noisy (single runs vary 200ms-4800ms)
- tsgo dominates but also has 15-20% variance (2300-2700ms range)
- Benchmark now uses median of 3 samples to reduce noise
- tsgo time correlates with: number of type-level computations, conditional types, overloads, type unions
- Named interfaces are FASTER for tsgo than inline object type annotations
- Reducing line count alone doesn't help if type complexity stays the same
- Reducing file count helps tsgo slightly (fewer modules to resolve)
- Always run `npx biome format --write <file>` after edits before benchmarking
