---
title: Porting to pi-natives (Node-API) — Field notes
description: Field notes for migrating Node.js child_process and shell code to the Rust N-API native layer.
sidebar:
  order: 9
  label: Porting to pi-natives
---

# Porting to pi-natives (Node-API) — Field notes

This guide describes how to migrate performance-critical execution paths to Rust in `crates/pi-natives` and expose them through TypeScript bindings in `@f5-sales-demo/pi-natives`.

## When to port to native modules

Port execution paths to Rust when:

- Execution paths execute within high-frequency rendering loops or large batch data pipelines.
- JavaScript memory allocations dominate execution time (excessive string allocations, regex backtracking, large array transformations).
- The operation is CPU-bound or performs blocking I/O that can run on libuv worker threads (`task::blocking`).
- The operation orchestrates asynchronous I/O that benefits from the Tokio runtime (`task::future`).

Avoid porting operations that require access to JavaScript runtime state or dynamic module imports. Native exports must remain pure, data-in/data-out functions.

## Native export architecture

### Rust implementation layer (`crates/pi-natives/`)

1. Implement core functionality in `crates/pi-natives/src/<MODULE>.rs`.
2. Register the module in `crates/pi-natives/src/lib.rs`.
3. Annotate functions with `#[napi]`. Rust `snake_case` function names convert to JavaScript `camelCase` identifiers automatically.
4. Use `task::blocking` for CPU-bound computation and `task::future` for asynchronous operations. Pass `CancelToken` instances when supporting timeouts or `AbortSignal`.

### TypeScript binding layer (`packages/natives/`)

1. Define interface augmentations in `packages/natives/src/<MODULE>/types.ts` extending `NativeBindings` via declaration merging.
2. Import `<MODULE>/types.ts` in `packages/natives/src/native.ts` to activate type definitions.
3. Add validation entries in `validateNative` within `packages/natives/src/native.ts` to enforce required exports at startup.
4. Implement ergonomic wrappers in `packages/natives/src/<MODULE>/index.ts` and re-export them from `packages/natives/src/index.ts`.

## Step-by-step porting workflow

1. **Implement Rust logic**: Create functions with owned types (`String`, `Vec<String>`, `Uint8Array`) and wrap long loops with `ct.heartbeat()?`.
2. **Expose TypeScript bindings**: Add types in `<MODULE>/types.ts` and export wrapper functions.
3. **Register native validation**: Add `checkFn("exportName")` to `validateNative` in `packages/natives/src/native.ts`.
4. **Create performance benchmarks**: Benchmark JavaScript and Rust implementations side-by-side using `Bun.nanoseconds()`.
5. **Compile native binaries**: Run `bun --cwd=packages/natives run build`.
6. **Validate performance**: Verify that the native path outperforms JavaScript before switching production call sites.

## Troubleshooting common issues

### Stale native binaries

The runtime loader prioritizes platform-tagged binaries (`pi_natives.<PLATFORM>-<ARCH>.node`). If exports fail to update:

```bash
rm packages/natives/native/pi_natives.*.node
bun --cwd=packages/natives run build
```

If testing against pre-compiled binaries, remove the extraction cache:

```bash
rm -rf ~/.xcsh/natives/
```

### Missing export validation errors

If `validateNative` raises an error indicating missing exports:

- Verify that the Rust export name matches the expected JavaScript camelCase name.
- Verify that the binary was rebuilt after adding the `#[napi]` attribute.
- Never disable or weaken `validateNative` checks.
