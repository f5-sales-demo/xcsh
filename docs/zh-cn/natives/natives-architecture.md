---
title: 原生模块架构
description: Rust N-API 原生插件架构，桥接 TypeScript 与平台特定操作。
sidebar:
  order: 1
  label: 架构
i18n:
  sourceHash: d38ed2437bb7
  translator: machine
---

# 原生模块架构

`@f5-sales-demo/pi-natives` 是一个三层架构：

1. **TypeScript 包装器/API 层**，暴露稳定的 JS/TS 入口点。
2. **插件加载/验证层**，为当前运行时解析和验证 `.node` 二进制文件。
3. **Rust N-API 模块层**，实现导出到 JS 的性能关键原语。

本文档是更深层模块级文档的基础。

## 实现文件

- `packages/natives/src/index.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `crates/pi-natives/src/lib.rs`

## 第一层：TypeScript 包装器/API 层

`packages/natives/src/index.ts` 是公共的桶文件（barrel）。它按能力域分组导出，并重新导出类型化的包装器，而不是直接暴露原始 N-API 绑定。

当前顶级分组：

- **搜索/文本原语**：`grep`、`glob`、`text`、`highlight`
- **执行/进程/终端原语**：`shell`、`pty`、`ps`、`keys`
- **系统/媒体/转换原语**：`image`、`html`、`clipboard`、`system-info`、`work`

`packages/natives/src/bindings.ts` 定义了基础接口契约：

- `NativeBindings` 以共享成员开始（`cancelWork(id: number)`）
- 模块特定的绑定通过每个模块的 `types.ts` 的声明合并添加
- `Cancellable` 为暴露取消功能的包装器标准化了超时和中止信号选项

**保证的契约（面向 API）：** 使用者从 `@f5-sales-demo/pi-natives` 导入并使用类型化的包装器。

**实现细节（可能变更）：** 声明合并和内部包装器布局（`src/<module>/index.ts`、`src/<module>/types.ts`）。

## 第二层：插件加载和验证

`packages/natives/src/native.ts` 负责运行时插件选择、可选的提取以及导出验证。

### 候选项解析模型

- 平台标签为 `"${process.platform}-${process.arch}"`。
- 当前支持的标签有：
  - `linux-x64`
  - `linux-arm64`
  - `darwin-x64`
  - `darwin-arm64`
  - `win32-x64`
- x64 可使用 CPU 变体：
  - `modern`（支持 AVX2）
  - `baseline`（回退方案）
- 非 x64 使用默认文件名（无变体后缀）。

文件名策略：

- 发布版：`pi_natives.<platform>-<arch>.node`
- x64 变体发布版：`pi_natives.<platform>-<arch>-modern.node` 和/或 `...-baseline.node`
- `PI_DEV` 启用加载器诊断信息，但不改变插件文件名

### 平台特定的变体检测

对于 x64，变体选择使用：

- **Linux**：`/proc/cpuinfo`
- **macOS**：`sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows**：PowerShell 检查 `System.Runtime.Intrinsics.X86.Avx2`

`PI_NATIVE_VARIANT` 可以显式强制使用 `modern` 或 `baseline`。

### 二进制分发和提取模型

`packages/natives/package.json` 在发布文件中同时包含 `src` 和 `native`。`native/` 目录存储预构建的平台产物。

对于编译后的二进制文件（`PI_COMPILED` 或 Bun 嵌入式运行时标记），加载器行为如下：

1. 检查带版本的用户缓存路径：`<getNativesDir()>/<packageVersion>/...`
2. 检查旧版编译二进制文件位置：
   - Windows：`%LOCALAPPDATA%/xcsh`（回退到 `%USERPROFILE%/AppData/Local/xcsh`）
   - 非 Windows：`~/.local/bin`
3. 回退到打包的 `native/` 和可执行文件目录候选项

如果存在嵌入式插件清单（由 `scripts/embed-native.ts` 生成的 `embedded-addon.ts`），`native.ts` 可以在加载前将匹配的嵌入式二进制文件具体化到带版本的缓存目录中。

### 验证和失败模式

在 `require(candidate)` 之后，`validateNative(...)` 验证所需的导出（例如 `grep`、`glob`、`highlightCode`、`PtySession`、`Shell`、`getSystemInfo`、`getWorkProfile`、`invalidateFsScanCache`）。

失败路径是明确的：

- **不支持的平台标签**：抛出错误并附带支持的平台列表
- **无可加载的候选项**：抛出错误并附带所有尝试过的路径和修复提示
- **缺少导出**：抛出错误并附带确切缺少的名称和重新构建命令
- **嵌入式提取错误**：记录目录/写入失败，并将其包含在最终加载诊断信息中

**保证的契约（面向 API）：** 插件加载要么成功并返回经过验证的绑定集，要么快速失败并提供可操作的错误文本。

**实现细节（可能变更）：** 确切的候选项搜索顺序和编译二进制文件回退路径排序。

## 第三层：Rust N-API 模块层

`crates/pi-natives/src/lib.rs` 是 Rust 入口模块，声明了导出的模块所有权：

- `clipboard`
- `fd`
- `fs_cache`
- `glob`
- `glob_util`
- `grep`
- `highlight`
- `html`
- `image`
- `keys`
- `prof`
- `ps`
- `pty`
- `shell`
- `system_info`
- `task`
- `text`

这些模块实现了由 `native.ts` 消费和验证的 N-API 符号。JS 层面的名称通过 `packages/natives/src` 中的 TS 包装器暴露。

**保证的契约（面向 API）：** Rust 模块导出必须与 `validateNative` 和包装器模块期望的绑定名称匹配。

**实现细节（可能变更）：** 内部 Rust 模块分解和辅助模块边界（`glob_util`、`task` 等）。

## 所有权边界

在架构层面，所有权划分如下：

- **TS 包装器/API 所有权（`packages/natives/src`）**
  - 公共 API 分组、选项类型化和稳定的 JS 开发体验
  - 暴露给调用者的取消机制（`timeoutMs`、`AbortSignal`）
- **加载器所有权（`packages/natives/src/native.ts`）**
  - 运行时二进制文件选择
  - CPU 变体选择和覆盖处理
  - 编译二进制文件提取和候选项探测
  - 所需原生导出的严格验证
- **Rust 所有权（`crates/pi-natives/src`）**
  - 算法和系统级实现
  - 平台原生行为和性能敏感逻辑
  - TS 包装器消费的 N-API 符号实现

## 运行时流程（高层级）

1. 使用者从 `@f5-sales-demo/pi-natives` 导入。
2. 包装器模块调用单例 `native` 绑定。
3. `native.ts` 为当前平台/架构/变体选择候选二进制文件。
4. 对于编译后的分发，执行可选的嵌入式二进制文件提取。
5. 加载插件并验证导出集。
6. 包装器向调用者返回类型化的结果。

## 术语表

- **原生插件**：通过 Node-API (N-API) 加载的 `.node` 二进制文件。
- **平台标签**：运行时元组 `platform-arch`（例如 `darwin-arm64`）。
- **变体**：x64 CPU 特定的构建版本（`modern` AVX2、`baseline` 回退）。
- **包装器**：在原始原生导出之上提供类型化 API 的 TS 函数/类。
- **声明合并**：模块 `types.ts` 文件用于扩展 `NativeBindings` 的 TS 技术。
- **编译二进制模式**：CLI 被打包的运行时模式，原生插件从提取/缓存路径而非仅从包本地路径解析。
- **嵌入式插件**：生成到 `embedded-addon.ts` 中的构建产物元数据和文件引用，使编译后的二进制文件能够提取匹配的 `.node` 载荷。
- **验证门**：`validateNative(...)` 检查，拒绝缺少所需导出的过时/不匹配的二进制文件。
