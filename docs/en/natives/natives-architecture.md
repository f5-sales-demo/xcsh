---
title: Natives Architecture
description: Rust N-API native addon architecture bridging TypeScript and platform-specific operations.
sidebar:
  order: 1
  label: Architecture
---

# Natives architecture

The `@f5-sales-demo/pi-natives` package provides high-performance native system operations for the xcsh coding agent through a three-layer architecture:

1. **TypeScript wrapper and API layer**: Exposes typed JavaScript and TypeScript interfaces.
2. **Addon loading and validation layer**: Resolves, extracts, and validates `.node` binaries for the host platform and architecture.
3. **Rust Node-API (N-API) module layer**: Implements performance-critical primitives using compiled Rust code.

## Primary implementation files

- `packages/natives/src/index.ts`: Public API entry point exporting functional domains.
- `packages/natives/src/native.ts`: Dynamic binary loader and hardware capability detector.
- `packages/natives/src/bindings.ts`: Base type contracts and cancellation interfaces.
- `packages/natives/src/embedded-addon.ts`: Embedded binary manifest contracts.
- `packages/natives/scripts/build-native.ts`: Multi-target build and compilation scripts.
- `packages/natives/scripts/embed-native.ts`: Binary embedding script for standalone packages.
- `crates/pi-natives/src/lib.rs`: Rust Node-API module definitions and symbol exports.

## Layer 1: TypeScript wrapper and API layer

`packages/natives/src/index.ts` organizes capabilities into domain-specific modules rather than exposing raw Node-API bindings:

- **Search and text primitives**: `grep`, `glob`, `text`, and `highlight`.
- **Execution and process management**: `shell`, `pty`, `ps`, and `keys`.
- **System, media, and conversions**: `image`, `html`, `clipboard`, `system-info`, and `work`.

`packages/natives/src/bindings.ts` defines core contracts:

- `NativeBindings`: Base binding contract defining universal methods such as `cancelWork(id: number)`.
- `Cancellable`: Common interface options (`timeoutMs`, `AbortSignal`) for long-running asynchronous operations.

## Layer 2: Addon loading and validation

`packages/natives/src/native.ts` dynamically resolves and loads native addons at runtime:

### Candidate resolution

- Evaluates platform tags matching `${process.platform}-${process.arch}`.
- Supports `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, and `win32-x64`.
- Selects AVX2-optimized binaries (`modern`) or standard binaries (`baseline`) on `x64` systems.
- Probes package directories, executable paths, and versioned cache directories (`~/.xcsh/natives/<VERSION>/`).

### Interface validation (`validateNative`)

Following `require(candidate)`, `validateNative` validates that all required Node-API symbols are present on the loaded object. If symbols are missing due to a stale binary, the loader raises an actionable error prompting a recompile.

## Layer 3: Rust Node-API module layer

`crates/pi-natives/src/lib.rs` exports performance-critical Rust modules to the JavaScript runtime:

- `clipboard`: Cross-platform system clipboard access.
- `fd` / `fs_cache`: High-throughput file descriptor operations and directory scanning caches.
- `glob` / `glob_util`: Multithreaded glob pattern matching.
- `grep`: Multithreaded regular expression search powered by the `grep-regex` engine.
- `highlight`: Fast code syntax highlighting tokenization.
- `html` / `image`: HTML-to-text conversion and image format manipulation.
- `keys`: Low-level terminal keycode parser.
- `prof` / `system_info`: CPU topology, memory metrics, and OS telemetry.
- `ps`: Native process tree inspection and termination.
- `pty`: Interactive pseudoterminal session management.
- `shell`: High-throughput subprocess execution.
- `task`: Cooperative asynchronous task cancellation registry.
- `text`: ANSI-aware Unicode string width calculations.

## Architectural boundaries and responsibilities

- **TypeScript wrapper layer**: Owns public API contracts, typed parameter options, error formatting, and `AbortSignal` bridging.
- **Addon loader layer**: Owns platform tag resolution, CPU variant selection, embedded payload extraction, and binary interface validation.
- **Rust module layer**: Owns native OS system calls, multithreaded algorithm execution, memory safety, and high-throughput I/O.

## Runtime workflow

1. Consumer imports APIs from `@f5-sales-demo/pi-natives`.
2. Wrapper calls into the singleton `native` binding.
3. `native.ts` identifies host platform, architecture, and CPU instruction sets.
4. Embedded binaries are extracted to user cache directories if running in compiled binary mode.
5. Addon binary loads into the process and validates its export contract.
6. Wrapper formats results and returns typed promises to the caller.
