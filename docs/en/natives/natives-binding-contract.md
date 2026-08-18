---
title: Natives Binding Contract (TypeScript Side)
description: TypeScript-side binding contract for calling into Rust native functions via N-API.
sidebar:
  order: 2
  label: Binding contract
---

# Natives binding contract

This document defines the TypeScript-side contract that connects caller modules to the compiled Node-API native addon in `@f5-sales-demo/pi-natives`.

## Architecture overview

1. **Contract interface**: `NativeBindings` base interface in `packages/natives/src/bindings.ts` augmented via declaration merging in each module's `types.ts`.
2. **Wrapper layer**: Domain wrappers in `packages/natives/src/<MODULE>/index.ts` adapt raw native calls to idiomatic TypeScript ergonomics.
3. **Public export barrel**: `packages/natives/src/index.ts` re-exports typed functional modules.

## Primary implementation files

- `packages/natives/src/bindings.ts`: Base binding contract and cancellation interfaces.
- `packages/natives/src/native.ts`: Dynamic binary loader and runtime export validator.
- `packages/natives/src/index.ts`: Public API export barrel.
- `packages/natives/src/<MODULE>/types.ts`: Per-domain declaration merging interface files.
- `packages/natives/src/<MODULE>/index.ts`: Domain-specific TypeScript wrapper implementations.

## Contract model and module augmentation

`packages/natives/src/bindings.ts` defines core contracts:

```ts
export interface NativeBindings {
  cancelWork(id: number): void;
}

export interface Cancellable {
  timeoutMs?: number;
  signal?: AbortSignal;
}
```

Each functional domain augments `NativeBindings` using TypeScript declaration merging:

```ts
// packages/natives/src/grep/types.ts
declare module "../bindings" {
  interface NativeBindings {
    grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
    search(content: string, options: SearchOptions): SearchResult;
  }
}
```

This model provides strong compile-time type safety across modular subdirectories without requiring a single monolithic type definition.

## Wrapper responsibilities

TypeScript wrappers provide convenience transformations without duplicating native algorithmic logic:

- **Path resolution and parameter defaults**: Normalizes file paths to absolute paths and sets default filter flags.
- **Callback transformation**: Adapts raw `(err, value)` Node-API callbacks into single-argument success event streams.
- **Error containment**: Handles platform-specific fallback behavior (such as headless clipboard operations).
- **Public API naming**: Maps internal native export names to idiomatic public TypeScript function names.

## JavaScript API and native export mapping

| Capability | Public TypeScript wrapper | Native binding export | Return type | Execution mode |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | Asynchronous |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | Synchronous |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | Synchronous |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | Asynchronous |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | Asynchronous |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | Synchronous |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | Asynchronous |
| Shell | `Shell` | `Shell` | Instance constructor | Class |
| PTY | `PtySession` | `PtySession` | Instance constructor | Class |
| Text | `truncateToWidth(text, width, ellipsis?)` | `truncateToWidth` | `string` | Synchronous |
| Text | `sliceWithWidth(text, start, width)` | `sliceWithWidth` | `SliceWithWidthResult` | Synchronous |
| Text | `visibleWidth(text)` | `visibleWidth` | `number` | Synchronous |
| Highlight | `highlightCode(code, lang, colors)` | `highlightCode` | `string` | Synchronous |
| HTML | `htmlToMarkdown(html, options?)` | `htmlToMarkdown` | `Promise<string>` | Asynchronous |
| System | `getSystemInfo()` | `getSystemInfo` | `SystemInfo` | Synchronous |
| Profiling | `getWorkProfile(lastSeconds)` | `getWorkProfile` | `WorkProfile` | Synchronous |
| Process | `killTree(pid, signal)` | `killTree` | `number` | Synchronous |
| Process | `listDescendants(pid)` | `listDescendants` | `number[]` | Synchronous |
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>` | Asynchronous |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | Asynchronous |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | Synchronous |

## Synchronous and asynchronous contract guidelines

The native binding layer maintains strict separation between execution models:

- **Asynchronous operations**: Used for file system I/O, multithreaded searches, subprocess execution, and media processing.
- **Synchronous operations**: Used for CPU-bound in-memory parsing, tokenization, text slicing, and telemetry reads.
- **Class constructors**: Used for stateful OS primitives (such as `PtySession` and `Shell`).

## Mismatch detection and validation

Drift between TypeScript contracts and compiled Rust binaries is caught at two stages:

1. **Compile time**: TypeScript type checking verifies that wrappers only access properties defined on the augmented `NativeBindings` interface.
2. **Runtime initialization**: `validateNative` inspects the loaded `.node` binary exports on startup, throwing an explicit error if any expected native function is missing.

## Maintainer checklist for binding updates

When adding or modifying native bindings:

1. Update `packages/natives/src/<MODULE>/types.ts` with the new method signature.
2. Implement the TypeScript wrapper in `packages/natives/src/<MODULE>/index.ts`.
3. Ensure `packages/natives/src/native.ts` imports the module type definitions.
4. Add the required export symbol to the `validateNative` check in `packages/natives/src/native.ts`.
5. Export the wrapper from `packages/natives/src/index.ts`.

