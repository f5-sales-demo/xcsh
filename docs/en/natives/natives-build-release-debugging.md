---
title: Natives Build, Release, and Debugging Runbook
description: Build, release, and debugging runbook for the Rust native addon across platforms.
sidebar:
  order: 8
  label: Build, release & debugging
---

This runbook describes the build, release, packaging, and debugging workflows for the `@f5-sales-demo/pi-natives` compiled Node-API addon.

## Implementation files

- `packages/natives/scripts/build-native.ts`: Multi-platform compilation and binary installation script.
- `packages/natives/scripts/embed-native.ts`: Standalone binary manifest embedding script.
- `packages/natives/src/native.ts`: Dynamic binary loader and runtime validator.
- `packages/natives/package.json`: Build scripts and distribution metadata.
- `crates/pi-natives/Cargo.toml`: Rust crate configuration and dependencies.

## Build pipeline architecture

### 1. Build entry points

The package provides standard Bun scripts in `packages/natives/package.json`:

- `bun run build`: Compiles the release-mode native addon (`crates/pi-natives`).
- `bun run dev:native`: Compiles a debug-profile addon.
- `bun run embed:native`: Generates `packages/natives/src/embedded-addon.ts` from compiled binaries.

### 2. Rust compilation

`packages/natives/scripts/build-native.ts` executes Cargo in `crates/pi-natives`:

- Compiles using `crate-type = ["cdylib"]`, producing a shared library (`.so`, `.dylib`, or `.dll`).
- Applies target architecture optimization flags (`-C target-cpu=x86-64-v3` for AVX2 `modern` builds, `-C target-cpu=x86-64-v2` for `baseline` builds, or `-C target-cpu=native` for ARM64 builds).

### 3. Binary installation

Following compilation, the build script copies the shared library into `packages/natives/native/` using atomic temporary-file-and-rename semantics:

- **Linux**: `pi_natives.<PLATFORM>-<ARCH>[-<VARIANT>].node`
- **macOS**: `pi_natives.<PLATFORM>-<ARCH>[-<VARIANT>].node`
- **Windows**: `pi_natives.<PLATFORM>-<ARCH>[-<VARIANT>].node`

## Target and hardware variant model

### Architecture and variants

- **`arm64` targets** (`darwin-arm64`, `linux-arm64`): Single standard binary per platform.
- **`x64` targets** (`darwin-x64`, `linux-x64`, `win32-x64`):
  - `modern`: Compiled with AVX2 instruction sets for high performance.
  - `baseline`: Standard x86-64 v2 binary for broad compatibility.

## Environment and build configuration

| Environment variable | Purpose | Valid values |
| --- | --- | --- |
| `PI_DEV` | Enables verbose loader diagnostics and candidate path logging. | `1` or `0` |
| `PI_NATIVE_VARIANT` | Forces runtime loader selection on x64 systems. | `modern` or `baseline` |
| `PI_COMPILED` | Enables standalone compiled binary extraction paths. | `1` or `0` |
| `TARGET_VARIANT` | Sets the target CPU variant during build. | `modern` or `baseline` |
| `CROSS_TARGET` | Specifies a cross-compilation target triple for Cargo. | Cargo target string (for example, `x86_64-unknown-linux-gnu`) |
| `CARGO_TARGET_DIR` | Custom output directory for Cargo build artifacts. | File system path |

## Common operational commands

```bash
# Build release addon for the current host architecture
bun --cwd=packages/natives run build

# Build debug profile addon
bun --cwd=packages/natives run dev:native

# Build specific x64 CPU variants
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# Embed compiled binaries into standalone distribution manifest
bun --cwd=packages/natives run embed:native

# Reset the embedded manifest stub
bun --cwd=packages/natives run embed:native -- --reset
```

## Troubleshooting and diagnostics

| Issue | Root cause | Remediation |
| --- | --- | --- |
| `Native addon missing exports` | Stale `.node` binary or mismatched export symbols. | Run `bun --cwd=packages/natives run build` to recompile the native addon. |
| `Unsupported platform: <TAG>` | Host operating system or architecture is not supported. | Verify host matches supported platform tags (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`). |
| Baseline loaded on AVX2 host | `PI_NATIVE_VARIANT=baseline` is set, or the `modern` binary is missing. | Recompile the `modern` variant: `TARGET_VARIANT=modern bun --cwd=packages/natives run build`. |
| Standalone binary fails after upgrade | Stale cached binary in `~/.xcsh/natives/<VERSION>/`. | Remove the versioned cache directory (`rm -rf ~/.xcsh/natives/<VERSION>`) and rerun. |
