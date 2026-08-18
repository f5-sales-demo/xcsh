---
title: Natives Text and Search Pipeline
description: Native text search pipeline with grep, glob, and ripgrep-based file content indexing.
sidebar:
  order: 6
  label: Text & search pipeline
---

# Natives text and search pipeline

This document maps the text and search subsystems (`grep`, `glob`, `text`, and `highlight`) in `@f5-sales-demo/pi-natives` from TypeScript wrappers to Rust Node-API exports and result structures.

## Implementation files

- `packages/natives/src/grep/index.ts`: TypeScript wrapper for regex search and fuzzy find.
- `packages/natives/src/glob/index.ts`: TypeScript wrapper for filesystem globbing.
- `packages/natives/src/text/index.ts`: TypeScript wrapper for ANSI-aware text layout utilities.
- `packages/natives/src/highlight/index.ts`: TypeScript wrapper for code syntax highlighting.
- `crates/pi-natives/src/grep.rs`: Multithreaded regular expression search engine (`grep-regex`).
- `crates/pi-natives/src/glob.rs`: High-performance filesystem glob matcher.
- `crates/pi-natives/src/glob_util.rs`: Glob compilation and syntax sanitization helpers.
- `crates/pi-natives/src/fs_cache.rs`: In-memory filesystem directory scan cache.
- `crates/pi-natives/src/fd.rs`: Path scoring and fuzzy search implementation.
- `crates/pi-natives/src/text.rs`: ANSI escape sequence parsing and Unicode column width calculations.
- `crates/pi-natives/src/highlight.rs`: Syntax highlighting engine powered by `syntect`.

## Subsystem architectures

### 1. Regular expression search (`grep`, `searchContent`, `hasMatch`)

- **In-memory search**: `searchContent` and `hasMatch` execute regular expressions against provided strings or `Uint8Array` buffers without filesystem access.
- **Filesystem search**: `grep` scans files or directories, streams matches through callbacks, and utilizes `fs_cache` for directory entry indexing.
- **Regex engine**: Powered by `grep-regex` with support for multiline matching and case-insensitivity. Automatically sanitizes unmatched template braces (such as `${VAR}`) to prevent syntax compilation errors.

### 2. Filesystem pattern matching (`glob`) and fuzzy find (`fuzzyFind`)

- **`glob`**: Resolves paths, compiles pattern strings into glob matchers, excludes standard ignored directories (`.git`, `node_modules`), and optionally sorts results by modification timestamp (`sortByMtime`).
- **`fuzzyFind`**: Executes fuzzy path scoring across directory entries, prioritizing directory prefixes and exact subsequence matches.

### 3. Shared filesystem scan cache (`fs_cache`)

`fs_cache` accelerates repeated directory lookups:

- Caches relative directory entries keyed by canonical root paths and filter flags (`include_hidden`, `use_gitignore`).
- Supports explicit cache invalidation via `invalidateFsScanCache(path?)`.

### 4. ANSI text layout utilities (`text`)

- **`wrapTextWithAnsi(text, width)`**: Wraps text to column limits while preserving active SGR color codes across line breaks.
- **`truncateToWidth(text, width, ellipsis)`**: Truncates strings to visible terminal cell limits.
- **`visibleWidth(text)`**: Calculates visible column width, correctly parsing full-width Unicode characters and ignoring non-printable escape codes.

### 5. Syntax highlighting (`highlight`)

- Uses `syntect` to tokenize code into scopes and map them to standard ANSI color sequences.
- Supports automatic language resolution by name, extension, or alias table (`ts`, `tsx`, `js` -> `JavaScript`).

## TypeScript API and native export mapping

| TypeScript API | Native Node-API export | Rust module | Description |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `grep.rs` | Multithreaded regular expression search across files or directories. |
| `searchContent(content, options)` | `search` | `grep.rs` | In-memory regular expression search. |
| `hasMatch(content, pattern, opts?)` | `hasMatch` | `grep.rs` | Fast boolean regex match test. |
| `fuzzyFind(options)` | `fuzzyFind` | `fd.rs` | Fuzzy path matching across filesystem trees. |
| `glob(options, onMatch?)` | `glob` | `glob.rs` | Filesystem pattern matching and discovery. |
| `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `fs_cache.rs` | Clears directory scan caches. |
| `wrapTextWithAnsi(text, width)` | `wrapTextWithAnsi` | `text.rs` | ANSI-preserving text column wrapping. |
| `truncateToWidth(text, width, ellipsis)` | `truncateToWidth` | `text.rs` | Terminal cell width truncation. |
| `visibleWidth(text)` | `visibleWidth` | `text.rs` | Calculates visible column width. |
| `highlightCode(code, lang, colors)` | `highlightCode` | `highlight.rs` | Generates ANSI-highlighted source code. |
| `supportsLanguage(lang)` | `supportsLanguage` | `highlight.rs` | Checks syntax highlighting support for a language. |
| `getSupportedLanguages()` | `getSupportedLanguages` | `highlight.rs` | Lists all supported syntax languages. |

