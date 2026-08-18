---
title: Natives Addon Loader Runtime
description: N-API addon loader runtime with platform detection, fallback strategies, and module resolution.
sidebar:
  order: 3
  label: Addon loader
---

This document describes the native Node-API (`.node`) addon loading and validation architecture in `@f5-sales-demo/pi-natives`, including platform resolution, embedded binary extraction, hardware variant detection (AVX2), and validation contracts.

## Primary implementation files

- `packages/natives/src/native.ts`: Main addon discovery, hardware capability probing, and candidate loader.
- `packages/natives/src/embedded-addon.ts`: Embedded binary manifest contracts and extraction state machines.
- `packages/natives/src/bindings.ts`: Native binding type signatures and validation hooks.
- `packages/natives/package.json`: Version metadata and distribution tags.

## Core responsibilities

- Build a prioritized, platform-specific candidate list of native binary filenames and directory paths.
- Materialize embedded native binary payloads into versioned per-user cache directories.
- Evaluate candidates in deterministic order.
- Validate loaded native binary interfaces (`validateNative`) prior to exposing runtime bindings.

## Platform resolution and hardware variants

### Platform tags

The runtime resolves the active target using standard Node.js platform and architecture strings: `<PLATFORM>-<ARCH>` (for example, `linux-x64` or `darwin-arm64`).

Supported platform tags:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

### Hardware variant selection (x64)

For `x64` architectures, the loader determines whether to load modern binaries optimized with AVX2 instructions:

1. **Explicit override**: Inspects `PI_NATIVE_VARIANT` (`modern` or `baseline`).
2. **Dynamic AVX2 detection**:
   - **Linux**: Scans `/proc/cpuinfo` for the `avx2` CPU flag.
   - **macOS**: Queries `sysctl` for `machdep.cpu.leaf7_features` or `machdep.cpu.features`.
   - **Windows**: Executes PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported`.
3. **Resolution**:
   - AVX2 detected: Selects `modern` with fallback to `baseline`.
   - AVX2 absent: Selects `baseline`.

On non-x64 architectures (`arm64`), the loader targets the standard binary name (`pi_natives.<PLATFORM>-<ARCH>.node`) without variant suffixes.

## Binary candidate resolution sequence

Candidate paths are evaluated in deterministic priority order based on execution mode:

### Standard execution mode

1. `<PACKAGE_DIR>/native/<FILENAME>`
2. `<EXEC_DIR>/<FILENAME>`

### Compiled single-binary execution mode

1. `<VERSIONED_USER_DIR>/<FILENAME>` (`~/.xcsh/natives/<VERSION>/...`)
2. `<USER_DATA_DIR>/<FILENAME>`
3. `<PACKAGE_DIR>/native/<FILENAME>`
4. `<EXEC_DIR>/<FILENAME>`

## Embedded binary extraction

When running inside a compiled binary package (`isCompiledBinary === true`), `maybeExtractEmbeddedAddon` manages binary extraction:

1. Validates that the embedded manifest matches the current platform tag and package version.
2. Creates the target versioned directory (`mkdirSync(..., { recursive: true })`).
3. Checks if the target file already exists; if present, reuses the existing binary.
4. Writes the embedded binary payload to disk and returns the extracted path as the highest-priority candidate.

## Interface validation contract (`validateNative`)

Before exposing bindings to the runtime, `validateNative` verifies that all expected functions exist on the loaded addon object:

| JavaScript binding | Required native symbol | Purpose |
| --- | --- | --- |
| `grep` | `grep` | Multithreaded regular expression search. |
| `glob` | `glob` | Fast filesystem pattern matching. |
| `highlightCode` | `highlightCode` | Syntax highlighting tokenization. |
| `executeShell` | `executeShell` | Subprocess command execution. |
| `PtySession` | `PtySession` | Interactive pseudoterminal session. |
| `Shell` | `Shell` | Persistent background shell process. |
| `visibleWidth` | `visibleWidth` | Terminal column width calculation. |
| `getSystemInfo` | `getSystemInfo` | Host hardware and OS telemetry. |
| `getWorkProfile` | `getWorkProfile` | CPU topology and memory metrics. |
| `invalidateFsScanCache` | `invalidateFsScanCache` | Directory cache invalidation. |

If any required symbol is missing, the loader records a validation failure and advances to the next candidate path.

## Troubleshooting and diagnostics

### Unsupported platform errors

When all candidate paths fail and the host platform is not present in `SUPPORTED_PLATFORMS`, the loader raises an explicit `Unsupported platform: <TAG>` error listing all supported target platforms.

### Stale binary mismatches

If a binary loads but fails interface validation, the error output lists the specific missing exports and suggests recompiling:

```bash
bun --cwd=packages/natives run build
```

### Verbose loader diagnostics

Set `PI_DEV=1` to enable verbose loader logging, printing each candidate path evaluated and detailed load error messages.
