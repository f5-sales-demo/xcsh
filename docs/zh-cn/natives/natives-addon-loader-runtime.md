---
title: 原生插件加载器运行时
description: 具有平台检测、回退策略和模块解析功能的 N-API 插件加载器运行时。
sidebar:
  order: 3
  label: 插件加载器
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# 原生插件加载器运行时

本文档深入介绍 `@f5xc-salesdemos/pi-natives` 中的插件加载/验证层：`native.ts` 如何决定加载哪个 `.node` 文件、嵌入式载荷提取何时运行，以及启动失败如何报告。

## 实现文件

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## 范围与职责

加载器/运行时的职责被有意限定在较窄的范围内：

- 构建平台/CPU 感知的候选插件文件名和目录列表。
- 可选地将嵌入式插件具体化到按版本划分的用户缓存目录中。
- 按确定性顺序尝试候选项。
- 在暴露绑定之前通过 `validateNative` 拒绝过期或不兼容的插件。

本文不涉及：模块特定的 grep/文本/高亮行为。

## 运行时输入和派生状态

在模块初始化时（`export const native = loadNative();`），`native.ts` 计算静态上下文：

- **平台标签**：``${process.platform}-${process.arch}``（例如 `darwin-arm64`）。
- **包版本**：来自 `packages/natives/package.json`（`version` 字段）。
- **核心目录**：
  - `nativeDir`：包本地的 `packages/natives/native`。
  - `execDir`：包含 `process.execPath` 的目录。
  - `versionedDir`：`<getNativesDir()>/<packageVersion>`。
  - `userDataDir` 回退：
    - Windows：`%LOCALAPPDATA%/xcsh`（或 `%USERPROFILE%/AppData/Local/xcsh`）。
    - 非 Windows：`~/.local/bin`。
- **编译二进制模式**（`isCompiledBinary`）：在以下任一条件成立时为 true：
  - 设置了 `PI_COMPILED` 环境变量，或
  - `import.meta.url` 包含 Bun 嵌入标记（`$bunfs`、`~BUN`、`%7EBUN`）。
- **变体覆盖**：`PI_NATIVE_VARIANT`（仅限 `modern`/`baseline`；无效值将被忽略）。
- **选定变体**：显式覆盖优先，否则在 x64 上进行运行时 AVX2 检测（有 AVX2 则为 `modern`，否则为 `baseline`）。

## 平台支持和标签解析

`SUPPORTED_PLATFORMS` 固定为：

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

行为细节：

- 不支持的平台不会被预先拒绝。
- 加载器仍然会首先尝试所有计算出的候选项。
- 如果没有任何候选项加载成功，则抛出明确的不支持平台错误并列出支持的标签。

这在为接近匹配的情况保留有用诊断信息的同时，对真正不支持的目标仍然会硬性失败。

## 变体选择（`modern` / `baseline` / 默认）

### x64 行为

1. 如果 `PI_NATIVE_VARIANT` 是 `modern` 或 `baseline`，则该值优先。
2. 否则检测 AVX2 支持：
   - Linux：扫描 `/proc/cpuinfo` 查找 `avx2`。
   - macOS：查询 `sysctl`（`machdep.cpu.leaf7_features`，回退至 `machdep.cpu.features`）。
   - Windows：运行 PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported`。
3. 结果：
   - AVX2 可用 -> `modern`
   - AVX2 不可用/无法检测 -> `baseline`

### 非 x64 行为

- 不使用变体；加载器保持默认文件名（`pi_natives.<platform>-<arch>.node`）。

### 文件名构造

给定 `tag = <platform>-<arch>`：

- 非 x64 或无变体：`pi_natives.<tag>.node`
- x64 + `modern`：按顺序尝试
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node`（有意的回退）
- x64 + `baseline`：仅 `pi_natives.<tag>-baseline.node`

最终错误消息中使用的 `addonLabel` 为 `<tag>` 或 `<tag> (<variant>)`。

## 候选路径构造和回退顺序

`native.ts` 在任何 `require(...)` 调用之前构建候选池。

### 发布候选项

从变体解析的文件名列表构建，按以下顺序搜索：

- **非编译运行时**：
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **编译运行时**（`PI_COMPILED` 或 Bun 嵌入标记）：
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` 在保留首次出现顺序的同时移除重复项。

### 最终运行时序列

在加载时：

1. 可选的嵌入式提取候选项（如果产生）被插入到最前面。
2. 剩余的去重候选项按顺序尝试。
3. 第一个既能 `require(...)` 成功又能通过 `validateNative(...)` 的候选项胜出。

## 嵌入式插件提取生命周期

`embedded-addon.ts` 定义了生成的清单结构：

- `platformTag`
- `version`
- `files[]`，其中每个条目包含 `variant`、`filename`、`filePath`

当前签入的默认值为 `embeddedAddon: null`；编译产物可能会用真实的元数据替换它。

### 提取状态机

提取（`maybeExtractEmbeddedAddon`）仅在所有门控条件通过时运行：

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. 找到了与变体匹配的嵌入文件

变体文件选择与运行时变体意图一致：

- 非 x64：优先选择 `default`，然后选择第一个可用文件。
- x64 + `modern`：优先选择 `modern`，回退到 `baseline`。
- x64 + `baseline`：要求 `baseline`。

具体化行为：

1. 确保 `<versionedDir>` 存在（`mkdirSync(..., { recursive: true })`）。
2. 如果 `<versionedDir>/<selected filename>` 已存在，则复用它（不重写）。
3. 否则读取嵌入式源 `filePath` 并写入目标文件。
4. 返回目标路径作为最高优先级的加载尝试。

失败时，提取不会立即崩溃；它会追加一个错误条目（目录创建或写入失败），加载器继续正常的候选项探测。

## 生命周期和状态转换

```text
Init
  -> Compute platform/version/variant/candidate lists
  -> (Compiled + embedded manifest matches?)
       yes -> Try extract embedded to versionedDir (record errors, continue)
       no  -> Skip extraction
  -> For each runtime candidate in order:
       require(candidate)
       -> success: validateNative
            -> pass: return bindings (READY)
            -> fail: record error, continue
       -> failure: record error, continue
  -> none loaded:
       if unsupported platform tag -> throw Unsupported platform
       else -> throw Failed to load (full tried-path diagnostics + hints)
```

## `validateNative` 契约检查

`validateNative(bindings, source)` 在启动时对 `NativeBindings` 强制执行仅函数的契约。

机制：

- 对于每个必需的导出名称，检查 `typeof bindings[name] === "function"`。
- 缺失的名称会被聚合。
- 如果有任何缺失，加载器会抛出：
  - 源插件路径，
  - 缺失的导出列表，
  - 重新构建命令提示。

这是针对过期二进制文件、部分构建和符号/名称漂移的硬性兼容性门控。

### JS API ↔ 原生导出映射（验证门控）

| `validateNative` 中检查的 JS 绑定名称 | 预期的原生导出名称 |
| --- | --- |
| `grep` | `grep` |
| `glob` | `glob` |
| `highlightCode` | `highlightCode` |
| `executeShell` | `executeShell` |
| `PtySession` | `PtySession` |
| `Shell` | `Shell` |
| `visibleWidth` | `visibleWidth` |
| `getSystemInfo` | `getSystemInfo` |
| `getWorkProfile` | `getWorkProfile` |
| `invalidateFsScanCache` | `invalidateFsScanCache` |

注意：`bindings.ts` 仅声明了基础的 `cancelWork(id)` 成员；模块 `types.ts` 文件通过声明合并添加了 `validateNative` 所强制执行的额外符号。

## 失败行为和诊断

## 不支持的平台

如果所有候选项都失败且 `platformTag` 不在 `SUPPORTED_PLATFORMS` 中，加载器会抛出：

- `Unsupported platform: <tag>`
- 完整的支持平台列表
- 明确的问题报告指导

## 过期二进制文件 / 不匹配症状

典型的过期不匹配信号：

- `Native addon missing exports (<candidate>). Missing: ...`

常见原因：

- 来自先前包版本/API 形状的旧 `.node` 二进制文件。
- 选择了错误的变体产物（针对 x64）。
- 新的 Rust 导出不存在于已加载的产物中。

加载器行为：

- 记录每个候选项的缺失导出失败。
- 继续探测剩余候选项。
- 如果没有候选项通过验证，最终错误包括每个尝试过的路径及其各自的失败消息。

## 编译二进制启动失败

在编译模式下，最终诊断信息包括：

- 预期的版本化缓存目标路径（`<versionedDir>/<filename>`），
- 删除过期的 `<versionedDir>` 并重新运行的补救措施，
- 针对每个预期文件名的直接发布下载 `curl` 命令。

## 非编译启动失败

在正常包/运行时模式下，最终诊断信息包括：

- 重新安装提示（`bun install @f5xc-salesdemos/pi-natives`），
- 本地重新构建命令（`bun --cwd=packages/natives run build`），
- 可选的 x64 变体构建提示（`TARGET_VARIANT=baseline|modern ...`）。

## 运行时行为

- 加载器始终使用发布候选链。
- 设置 `PI_DEV` 仅启用每个候选项的控制台诊断（`Loaded native addon...` 和加载错误）。
