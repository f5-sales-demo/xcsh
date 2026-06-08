---
title: 原生插件构建、发布与调试运行手册
description: 跨平台 Rust 原生插件的构建、发布与调试运行手册。
sidebar:
  order: 8
  label: 构建、发布与调试
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# 原生插件构建、发布与调试运行手册

本运行手册描述了 `@f5xc-salesdemos/pi-natives` 构建流水线如何生成 `.node` 插件、编译后的发行版如何加载这些插件，以及如何调试加载器/构建故障。

本手册遵循 `docs/natives-architecture.md` 中的架构术语：

- **构建时产物生成**（`scripts/build-native.ts`）
- **内嵌插件清单生成**（`scripts/embed-native.ts`）
- **运行时插件加载 + 验证门控**（`src/native.ts`）

## 实现文件

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## 构建流水线概述

### 1) 构建入口

`packages/natives/package.json` 脚本：

- `bun scripts/build-native.ts`（`build`）→ Release 构建
- `bun scripts/build-native.ts --dev`（`dev:native`）→ Debug/开发配置构建（输出命名相同）
- `bun scripts/embed-native.ts`（`embed:native`）→ 从构建产物生成 `src/embedded-addon.ts`

### 2) Rust 产物构建

`build-native.ts` 在 `crates/pi-natives` 中运行 Cargo：

- 基础命令：`cargo build`
- Release 模式会添加 `--release`，除非传入了 `--dev`
- 交叉编译目标会添加 `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` 声明了 `crate-type = ["cdylib"]`，因此 Cargo 会生成共享库（`.so`/`.dylib`/`.dll`），然后被复制/重命名为 `.node` 插件文件名。

### 3) 产物发现与安装

Cargo 完成后，`build-native.ts` 按顺序扫描候选输出目录：

1. `${CARGO_TARGET_DIR}`（如已设置）
2. `<repo>/target`
3. `crates/pi-natives/target`

对于每个根目录，检查配置目录：

- 交叉构建：`<root>/<crossTarget>/<profile>` 然后 `<root>/<profile>`
- 本地构建：`<root>/<profile>`

然后查找以下文件之一：

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

找到后，使用临时文件 + 重命名语义原子性地安装到 `packages/natives/native/`（Windows 回退机制会显式处理锁定 DLL 的替换失败）。

## 目标/变体模型与命名约定

## 平台标签

构建和运行时都使用平台标签：

`<platform>-<arch>`（例如：`darwin-arm64`、`linux-x64`）

## 变体模型（仅 x64）

x64 支持 CPU 变体：

- `modern`（支持 AVX2 的路径）
- `baseline`（回退方案）

非 x64 使用单一默认产物（无变体后缀）。

### 输出文件名

Release 构建：

- x64：`pi_natives.<platform>-<arch>-modern.node` 或 `...-baseline.node`
- 非 x64：`pi_natives.<platform>-<arch>.node`

Dev 构建（`--dev`）：

- 使用 debug 配置标志但保持标准的平台标签输出命名

`native.ts` 中运行时加载器的候选顺序：

- release 候选项
- 编译模式会在包本地文件之前插入提取/缓存候选项

## 环境变量与构建选项

## 运行时标志

- `PI_DEV`（加载器行为）：启用加载器诊断信息
- `PI_NATIVE_VARIANT`（加载器行为，仅 x64）：在运行时强制选择 `modern` 或 `baseline`
- `PI_COMPILED`（加载器行为）：启用编译二进制文件的候选/提取行为

## 构建时标志/选项

- `--dev`（脚本参数）：构建 debug 配置
- `CROSS_TARGET`：传递给 Cargo `--target`
- `TARGET_PLATFORM`：覆盖输出平台标签命名
- `TARGET_ARCH`：覆盖输出架构命名
- `TARGET_VARIANT`（仅 x64）：强制输出文件名和 RUSTFLAGS 策略使用 `modern` 或 `baseline`
- `CARGO_TARGET_DIR`：搜索 Cargo 输出时的额外根目录
- `RUSTFLAGS`：
  - 如果未设置且非交叉编译，脚本会设置：
    - modern：`-C target-cpu=x86-64-v3`
    - baseline：`-C target-cpu=x86-64-v2`
    - 非 x64 / 无变体：`-C target-cpu=native`
  - 如果已设置，脚本不会覆盖

## 构建状态/生命周期转换

### 构建生命周期（`build-native.ts`）

1. **初始化**：解析参数/环境变量（`--dev`、目标覆盖、交叉编译标志）
2. **变体解析**：
   - 非 x64 → 无变体
   - x64 + `TARGET_VARIANT` → 显式变体
   - x64 交叉构建且无 `TARGET_VARIANT` → 硬错误
   - x64 本地构建且无覆盖 → 检测宿主 AVX2
3. **编译**：使用解析后的配置/目标运行 Cargo
4. **定位产物**：扫描目标根目录/配置目录/库文件名
5. **安装**：复制 + 原子性重命名到 `packages/natives/native`
6. **完成**：插件产物已准备好供加载器使用

失败会在任何阶段退出，并显示明确的错误文本（无效变体、cargo 构建失败、输出库缺失、安装/重命名失败）。

### 内嵌生命周期（`embed-native.ts`）

1. **初始化**：从 `TARGET_PLATFORM`/`TARGET_ARCH` 或宿主值计算平台标签
2. **候选集**：
   - x64 期望 `modern` 和 `baseline` 两者都有
   - 非 x64 期望一个默认文件
3. **验证可用性**：检查 `packages/natives/native` 中的文件
4. **生成清单**（`src/embedded-addon.ts`）：使用 Bun `file` 导入和包版本
5. **运行时提取就绪**：可用于编译模式

`--reset` 绕过验证，写入空清单桩（`embeddedAddon = null`）。

## 开发工作流 vs 发布/编译行为

## 本地开发工作流

典型的本地循环：

1. 构建插件：
   - release：`bun --cwd=packages/natives run build`
   - debug 配置：`bun --cwd=packages/natives run dev:native`
2. 测试加载器诊断时设置 `PI_DEV=1`
3. `native.ts` 中的加载器解析包本地 `native/`（以及可执行文件目录回退）候选项
4. `validateNative` 在包装器使用绑定之前强制执行导出兼容性检查

## 发布/编译二进制工作流

在编译模式下（`PI_COMPILED` 或 Bun 内嵌标记）：

1. 加载器计算版本化缓存目录：`<getNativesDir()>/<packageVersion>`（实际路径为 `~/.xcsh/natives/<version>`）
2. 如果内嵌清单匹配当前平台+版本，加载器可能将选定的内嵌文件提取到该版本化目录
3. 运行时候选顺序包括：
   - 版本化缓存目录
   - 旧版编译二进制目录（Windows 上为 `%LOCALAPPDATA%/xcsh`，其他平台为 `~/.local/bin`）
   - 包/可执行文件目录
4. 第一个成功加载的插件仍必须通过 `validateNative`

这就是为什么打包和运行时加载器的期望必须一致：文件名、平台标签和导出符号必须与 `native.ts` 探测和验证的内容匹配。

## JS API ↔ Rust 导出映射（验证门控子集）

`native.ts` 要求加载的插件上存在以下 JS 可见导出。它们映射到 `crates/pi-natives/src` 中的 Rust N-API 导出：

| `validateNative` 要求的 JS 名称 | Rust 导出声明 | Rust 源文件 |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)`（驼峰命名导出） | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

如果任何必需的符号缺失，加载器会快速失败并提示重新构建。

## 失败行为与诊断

## 构建时失败

- 无效的变体配置：
  - 非 x64 上设置了 `TARGET_VARIANT` → 立即报错
  - x64 交叉构建且未显式设置 `TARGET_VARIANT` → 立即报错
- Cargo 构建失败：
  - 脚本会显示非零退出码和 stderr 输出
- 找不到产物：
  - 脚本会打印每个已检查的配置目录
- 安装失败：
  - 显示明确消息；Windows 包含锁定文件提示

## 运行时加载器失败（`native.ts`）

- 不支持的平台标签：
  - 抛出异常并列出支持的平台列表
- 无法加载任何候选项：
  - 抛出异常并列出完整的候选错误列表和特定模式的修复提示
- 缺少导出：
  - 抛出异常并列出确切的缺失符号名称和重新构建命令
- 内嵌提取问题：
  - 提取过程中的 mkdir/write 错误会被记录并包含在最终诊断信息中

## 故障排除矩阵

| 症状 | 可能原因 | 验证方法 | 修复方案 |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | `.node` 二进制文件过期、Rust 导出名称不匹配或加载了错误的二进制文件 | 使用 `PI_DEV=1` 运行以查看加载路径；检查该文件的导出列表 | 重新构建 `build`；确保 Rust `#[napi]` 导出名称（或需要时的显式别名）与 JS 键匹配；删除过期的缓存/版本化文件 |
| x64 机器在应该加载 modern 时加载了 baseline | 设置了 `PI_NATIVE_VARIANT=baseline`、未检测到 AVX2 或仅存在 baseline 文件 | 检查 `PI_NATIVE_VARIANT`；检查 `native/` 中是否有 `-modern` 文件 | 构建 modern 变体（`TARGET_VARIANT=modern ... build`）并确保文件已包含在发行版中 |
| 交叉构建产生了不可用/标签错误的二进制文件 | `CROSS_TARGET` 与 `TARGET_PLATFORM`/`TARGET_ARCH` 不匹配，或 x64 缺少 `TARGET_VARIANT` | 确认环境变量组合和输出文件名 | 使用一致的环境变量值和显式的 x64 `TARGET_VARIANT` 重新运行 |
| 升级后编译二进制文件失败 | 过期的提取缓存（`~/.xcsh/natives/<旧版本或不匹配的版本>`）或内嵌清单不匹配 | 检查版本化的 natives 目录和加载器错误列表 | 删除对应包版本的版本化 natives 缓存并重新运行；在打包时重新生成内嵌清单 |
| 加载器探测了多个路径但均不可用 | 平台不匹配或包 `native/` 中缺少 release 产物 | 检查 `platformTag` 与实际文件名是否匹配 | 确保构建的文件名完全匹配 `pi_natives.<platform>-<arch>(-variant).node` 约定，且包中包含 `native/` |
| `embed:native` 失败并提示 "Incomplete native addons" | 内嵌前未构建所需的变体文件 | 检查错误文本中的期望与实际列表 | 先构建所需文件（x64：modern+baseline 两者；非 x64：默认），然后重新运行 `embed:native` |

## 操作命令

```bash
# 为当前宿主构建 Release 产物
bun --cwd=packages/natives run build

# 构建 Debug 配置产物
bun --cwd=packages/natives run dev:native

# 构建显式 x64 变体
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# 从构建的原生文件生成内嵌插件清单
bun --cwd=packages/natives run embed:native

# 将内嵌清单重置为空桩
bun --cwd=packages/natives run embed:native -- --reset
```
