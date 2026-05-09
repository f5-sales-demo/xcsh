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

## Improvement Categories (Priority Order)
1. Dead code elimination in helpers.ts and state.ts
2. Type simplification in types.ts (merge near-identical interfaces)
3. Reduce module count by merging small files
4. Simplify contract parsing if sections can be consolidated
5. Dashboard rendering optimization (lower priority — rarely in hot path)

## Measurement Notes
- `check_ms` = biome_ms + tsgo_ms (excludes file_count/line_count which are static measures)
- Biome is fast (~200-500ms) — tsgo dominates
- tsgo time correlates with: number of type-level computations, conditional types, overloads, type unions
- Reducing line count alone doesn't help if type complexity stays the same
- Reducing file count helps tsgo slightly (fewer modules to resolve)
