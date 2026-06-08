---
title: 移植到 pi-natives (N-API) — 实战笔记
description: 将 Node.js child_process 和 shell 代码迁移到 Rust N-API 原生层的实战笔记。
sidebar:
  order: 9
  label: 移植到 pi-natives
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# 移植到 pi-natives (N-API) — 实战笔记

这是一份将热路径迁移到 `crates/pi-natives` 并通过 JS 绑定进行接线的实用指南。其目的是避免重复踩坑。

## 何时进行移植

当以下任一条件成立时，应考虑移植：

- 热路径运行在渲染循环、高频 UI 更新或大批量处理中。
- JS 内存分配占主导（字符串频繁创建销毁、正则回溯、大数组）。
- 你已有 JS 基准测试，可以对两个版本进行并行基准对比。
- 工作是 CPU 密集型或阻塞 I/O，可以在 libuv 线程池上运行。
- 工作是异步 I/O，可以在 Tokio 运行时上运行（例如 shell 执行）。

避免移植依赖于 JS 专有状态或动态导入的功能。N-API 导出应该是纯粹的、数据输入/数据输出的。长时间运行的工作应通过 `task::blocking`（CPU 密集型/阻塞 I/O）或 `task::future`（异步 I/O）配合取消机制来处理。

## 原生导出的结构

**Rust 侧：**

- 实现代码位于 `crates/pi-natives/src/<module>.rs`。如果新增模块，需在 `crates/pi-natives/src/lib.rs` 中注册。
- 使用 `#[napi]` 导出；snake_case 导出会自动转换为 camelCase。仅在需要真正的别名/非默认名称时使用显式 `js_name`。对结构体使用 `#[napi(object)]`。
- 对 CPU 密集型或阻塞工作使用 `task::blocking(tag, cancel_token, work)`（参见 `crates/pi-natives/src/task.rs`）。对需要 Tokio 的异步工作使用 `task::future(env, tag, work)`（例如 shell 会话）。当你暴露 `timeoutMs` 或 `AbortSignal` 时传递 `CancelToken`。

**JS 侧：**

- `packages/natives/src/bindings.ts` 包含基础的 `NativeBindings` 接口。
- `packages/natives/src/<module>/types.ts` 定义 TS 类型，并通过声明合并扩展 `NativeBindings`。
- `packages/natives/src/native.ts` 导入每个 `<module>/types.ts` 文件以激活声明。
- `packages/natives/src/<module>/index.ts` 包装来自 `packages/natives/src/native.ts` 的 `native` 绑定。
- `packages/natives/src/native.ts` 加载插件，`validateNative` 强制校验必需的导出。
- `packages/natives/src/index.ts` 为 `packages/*` 中的调用方重新导出包装器。

## 移植清单

1. **添加 Rust 实现**

- 将核心逻辑放在普通的 Rust 函数中。
- 如果是新模块，将其添加到 `crates/pi-natives/src/lib.rs`。
- 使用 `#[napi]` 导出，保持默认的 snake_case -> camelCase 映射一致性。
- 保持签名使用拥有所有权的简单类型：`String`、`Vec<String>`、`Uint8Array`，或对大型字符串/字节输入使用 `Either<JsString, Uint8Array>`。
- 对 CPU 密集型或阻塞工作使用 `task::blocking`；对异步工作使用 `task::future`。传递 `CancelToken` 并在长循环中调用 `heartbeat()`。

2. **接线 JS 绑定**

- 在 `packages/natives/src/<module>/types.ts` 中添加类型和 `NativeBindings` 扩展。
- 在 `packages/natives/src/native.ts` 中导入 `./<module>/types` 以触发声明合并。
- 在 `packages/natives/src/<module>/index.ts` 中添加调用 `native` 的包装器。
- 从 `packages/natives/src/index.ts` 重新导出。

3. **更新原生校验**

- 在 `validateNative`（`packages/natives/src/native.ts`）中添加 `checkFn("newExport")`。

4. **添加基准测试**

- 将基准测试放在所属包旁边（`packages/tui/bench`、`packages/natives/bench` 或 `packages/coding-agent/bench`）。
- 在同一次运行中包含 JS 基准版本和原生版本。
- 使用 `Bun.nanoseconds()` 和固定的迭代次数。
- 保持基准测试输入小而真实（使用热路径中实际观察到的数据）。

5. **构建原生二进制文件**

- `bun --cwd=packages/natives run build`
- 使用 `bun --cwd=packages/natives run build`，如果测试时需要加载器诊断信息，设置 `PI_DEV=1`。

6. **运行基准测试**

- `bun run packages/<pkg>/bench/<bench>.ts`（或 `bun --cwd=packages/natives run bench`）

7. **决定是否使用**

- 如果原生版本更慢，**保留 JS 版本**，原生导出暂不使用。
- 如果原生版本更快，将调用点切换到原生包装器。

## 常见痛点及避免方法

### 1) 过期的 `pi_natives.node` 导致新导出不可用

加载器优先使用 `packages/natives/native` 中带平台标签的二进制文件（`pi_natives.<platform>-<arch>.node`）。`PI_DEV=1` 现在仅启用加载器诊断信息；它不再切换到单独的开发插件文件名。还有一个备用的 `pi_natives.node`。编译后的二进制文件会提取到 `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node`。如果这些文件中有任何一个过期，导出将不会更新。

**解决方法：** 在重新构建前删除过期文件。

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

如果你运行的是编译后的二进制文件，删除缓存的插件目录：

```bash
rm -rf ~/.xcsh/natives/<version>
```

然后验证导出是否存在于二进制文件中：

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) `validateNative` 报 "Missing exports" 错误

这是**好事** — 它防止了静默的不匹配。当你看到这样的信息：

```
Native addon missing exports ... Missing: visibleWidth
```

这意味着你的二进制文件过期了，Rust 导出名称（或使用显式别名时的别名）与 JS 名称不匹配，或者导出根本没有编译进去。修复构建和命名不匹配问题，不要削弱校验。

### 3) Rust 签名不匹配

保持简单并使用拥有所有权的类型。`String`、`Vec<String>` 和 `Uint8Array` 可以正常工作。在公开导出中避免使用引用类型如 `&str`。如果需要结构化数据，使用 `#[napi(object)]` 结构体包装。

### 4) 基准测试常见错误

- 不要比较不同的输入或内存分配。
- JS 和原生版本使用完全相同的输入数组。
- 在同一个基准测试文件中运行两者以避免偏差。

## 基准测试模板

```ts
const ITERATIONS = 2000;

function bench(name: string, fn: () => void): number {
 const start = Bun.nanoseconds();
 for (let i = 0; i < ITERATIONS; i++) fn();
 const elapsed = (Bun.nanoseconds() - start) / 1e6;
 console.log(`${name}: ${elapsed.toFixed(2)}ms total (${(elapsed / ITERATIONS).toFixed(6)}ms/op)`);
 return elapsed;
}

bench("feature/js", () => {
 jsImpl(sample);
});

bench("feature/native", () => {
 nativeImpl(sample);
});
```

## 验证清单

- `validateNative` 通过（无缺失导出）。
- `NativeBindings` 在 `packages/natives/src/<module>/types.ts` 中已扩展，包装器在 `packages/natives/src/index.ts` 中已重新导出。
- `Object.keys(require(...))` 包含你的新导出。
- 基准测试数据已记录在 PR/笔记中。
- **仅当**原生版本更快或相当时才更新调用点。

## 经验法则

- 如果原生版本更慢，**不要切换**。保留导出以备将来使用，但 TUI 应继续使用更快的路径。
- 如果原生版本更快，切换调用点并保留基准测试以捕获性能回退。
