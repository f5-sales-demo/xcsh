---
title: Filesystem Scan Cache Architecture
description: Filesystem scan cache contract for fast file discovery with stale-while-revalidate semantics.
sidebar:
  order: 8
  label: Filesystem scan cache
---

This document defines the contract for the shared filesystem scan cache implemented in Rust (`crates/pi-natives/src/fs_cache.rs`) and consumed by native discovery and search APIs exposed to `packages/coding-agent`.

## Purpose and design goals

The cache stores full directory-scan entry lists (`GlobMatch[]`) keyed by scan scope and traversal policy, enabling higher-level operations (such as glob filtering, fuzzy scoring, and grep candidate selection) to run against cached entries.

Primary goals:

- Eliminate redundant filesystem traversals across repeated discovery and search operations.
- Maintain consistency across `glob`, `fuzzyFind`, and `grep` when sharing the same scan policy.
- Support explicit staleness recovery for empty results and explicit invalidation following filesystem mutations.

## Ownership and public surface

- Cache implementation and policy: `crates/pi-natives/src/fs_cache.rs`
- Native consumers:
  - `crates/pi-natives/src/glob.rs`
  - `crates/pi-natives/src/fd.rs` (`fuzzyFind`)
  - `crates/pi-natives/src/grep.rs`
- JavaScript and TypeScript bindings and exports:
  - `packages/natives/src/glob/index.ts` (`invalidateFsScanCache`)
  - `packages/natives/src/glob/types.ts`
  - `packages/natives/src/grep/types.ts`
- Coding agent mutation invalidation helpers:
  - `packages/coding-agent/src/tools/fs-cache-invalidation.ts`

## Cache key partitioning

Each entry is keyed by:

- Canonicalized `root` directory path
- `include_hidden` boolean
- `use_gitignore` boolean

Key contract implications:

- Scans with and without hidden files do **not** share cache entries.
- Scans with and without `.gitignore` filtering do **not** share cache entries.
- Consumers must supply stable boolean flags for hidden and `.gitignore` behavior; changing either flag resolves to a distinct cache partition.

The cache key does **not** partition on `node_modules` inclusion. The cache always captures entries with `node_modules` included, deferring filtering to consumer-specific post-processing.

## Scan collection behavior

Cache population uses a deterministic directory walker (`ignore::WalkBuilder`) configured by `include_hidden` and `use_gitignore`:

- Symlink traversal disabled (`follow_links(false)`).
- Entries sorted deterministically by file path.
- The `.git` directory is always excluded.
- `node_modules` is collected during cache scan and filtered subsequently if requested.
- Entry file types and modification timestamps (`mtime`) are captured via `symlink_metadata`.

Search roots are resolved through `resolve_search_path`:

- Relative paths resolve against the current working directory.
- The target path must reference an existing directory.
- The root path is canonicalized when possible.

## Freshness and eviction policy

Global policy configuration (overridable via environment variables):

- `FS_SCAN_CACHE_TTL_MS` (default: `1000`)
- `FS_SCAN_EMPTY_RECHECK_MS` (default: `200`)
- `FS_SCAN_CACHE_MAX_ENTRIES` (default: `16`)

Runtime behavior:

- `get_or_scan(...)`:
  - When TTL is `0`, bypasses the cache and performs a fresh scan (`cache_age_ms = 0`).
  - On a cache hit within TTL, returns cached entries along with non-zero `cache_age_ms`.
  - On an expired hit, evicts the entry, rescans, and caches the fresh result.
- Maximum entry limits enforce oldest-first eviction based on `created_at`.

## Empty-result fast recheck

Normal cache hit behavior:

- A cache hit within the TTL window returns cached entries directly.

Empty-result fast recheck behavior:

- Represents a **caller-side** policy evaluated using `ScanResult.cache_age_ms`.
- If the filtered or queried result is empty and the cached scan age is at least `empty_recheck_ms()`, the caller triggers a single `force_rescan(...)` and retries.
- Reduces stale negative results when files were added recently while the cache remains within its TTL window.

Active consumers:

- `glob`: Rechecks when filtered matches are empty and scan age exceeds the threshold.
- `fuzzyFind` (`fd.rs`): Rechecks when the query is non-empty and scored matches return empty.
- `grep`: Rechecks when the selected candidate file list is empty.

## Consumer defaults and cache usage

Cache usage is opt-in across all exposed APIs (`cache?: boolean`, defaulting to `false`).

Default settings in native APIs:

- `glob`: `hidden=false`, `gitignore=true`, `cache=false`
- `fuzzyFind`: `hidden=false`, `gitignore=true`, `cache=false`
- `grep`: `hidden=true`, `cache=false`, with cache scan enforcing `use_gitignore=true`

Coding agent callers:

- High-volume file mention discovery enables caching:
  - File: `packages/coding-agent/src/utils/file-mentions.ts`
  - Profile: `hidden=true`, `gitignore=true`, `includeNodeModules=true`, `cache=true`
- Tool-level `grep` integration disables scan caching (`cache: false`):
  - File: `packages/coding-agent/src/tools/grep.ts`

## Invalidation contract

Native invalidation entrypoint:

- `invalidateFsScanCache(path?: string)`:
  - When provided with a `path`, invalidates cache entries whose root matches a prefix of the target path.
  - When called without arguments, clears all scan cache entries.

Path handling behavior:

- Relative paths resolve against the current working directory.
- Invalidation attempts path canonicalization.
- If the target path does not exist (such as following a file deletion), the fallback canonicalizes the parent directory and reattaches the filename when possible.
- Preserves accurate invalidation behavior across file creation, deletion, and rename operations.

## Mutation flow responsibilities

Coding agent execution paths must invoke invalidation helpers after successful filesystem mutations.

Primary helpers:

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)` (invalidates both source and destination paths)

Current tool callsites:

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts` (hashline, patch, and replace pipelines)

Rule: Any workflow that mutates filesystem contents or paths without calling these helpers introduces cache staleness.

## Adding a new cache consumer

When introducing cache usage in a new scanning or search path:

1. **Use stable scan policy inputs**: Define hidden file and `.gitignore` semantics first, and pass them consistently to `get_or_scan` and `force_rescan`.
2. **Treat cached data as pre-filtered only by traversal policy**: Apply tool-specific filtering (glob patterns, file types, and `node_modules` exclusions) after retrieving cached entries.
3. **Implement empty-result fast rechecks only for stale negative risks**: Check `scan.cache_age_ms >= empty_recheck_ms()`, retry once with `force_rescan(..., store=true, ...)`, and isolate this path from standard cache hit handling.
4. **Respect no-cache mode explicitly**: When a caller disables caching, invoke `force_rescan(..., store=false, ...)` to avoid populating the shared cache.
5. **Wire mutation invalidation into write paths**: Call coding agent invalidation helpers following successful write, edit, delete, or rename actions. For renames and moves, invalidate both paths.
6. **Rely on global TTL configuration**: Adhere to environment-configured global TTL policies rather than introducing per-call TTL parameters.

## Known boundaries

- Cache scope is process-local and held in memory (`DashMap`), without persistence across process restarts.
- The cache stores directory scan entries rather than final tool evaluation results.
- `glob`, `fuzzyFind`, and `grep` share entries only when all key dimensions (`root`, `hidden`, `gitignore`) match exactly.
- The `.git` directory is always excluded during scan collection regardless of caller options.
