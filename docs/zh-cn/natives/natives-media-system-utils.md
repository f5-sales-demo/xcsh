---
title: 原生媒体与系统工具
description: 用于截图、图像处理和系统信息的原生媒体处理工具。
sidebar:
  order: 7
  label: 媒体与系统工具
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# 原生媒体 + 系统工具

本文档是 [`docs/natives-architecture.md`](./natives-architecture.md) 中描述的 **系统/媒体/转换原语** 层的子系统深入分析：`image`、`html`、`clipboard` 和 `work` 性能分析。

## 实现文件

- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/prof.rs`
- `crates/pi-natives/src/task.rs`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/work/index.ts`
- `packages/natives/src/work/types.ts`

> 注意：不存在 `crates/pi-natives/src/work.rs`；工作性能分析在 `prof.rs` 中实现，由 `task.rs` 中的插桩提供数据。

## TS API ↔ Rust 导出/模块映射

| TS 导出 (packages/natives)                  | Rust N-API 导出                                                         | Rust 模块                             |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + TS 回退逻辑                                        | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## 数据格式边界与转换

### 图像 (`image`)

- **JS 输入边界**：`Uint8Array` 编码的图像字节。
- **Rust 解码边界**：字节被复制到 `Vec<u8>`，通过 `ImageReader::with_guessed_format()` 猜测格式，然后解码为 `DynamicImage`。
- **内存中状态**：`PhotonImage` 存储 `Arc<DynamicImage>`。
- **输出边界**：`encode(format, quality)` 返回 `Promise<Uint8Array>`（Rust `Vec<u8>`）。

格式 ID 为数值型：

- `0`：PNG
- `1`：JPEG
- `2`：WebP（无损编码器）
- `3`：GIF

约束条件：

- `quality` 仅用于 JPEG。
- PNG/WebP/GIF 忽略 `quality`。
- 不支持的格式 ID 会失败（`Invalid image format: <id>`）。

### HTML 转换 (`html`)

- **JS 输入边界**：HTML `string` + 可选对象 `{ cleanContent?: boolean; skipImages?: boolean }`。
- **Rust 转换边界**：`String` 输入由 `html_to_markdown_rs::convert` 转换。
- **输出边界**：Markdown `string`。

转换行为：

- `cleanContent` 默认为 `false`。
- 当 `cleanContent=true` 时，启用预处理，使用 `PreprocessingPreset::Aggressive` 以及导航/表单的强制移除标志。
- `skipImages` 默认为 `false`。

### 剪贴板 (`clipboard`)

- **文本路径**：
  - 当 stdout 为 TTY 时，TS 首先发出 OSC 52（`\x1b]52;c;<base64>\x07`）。
  - 然后以尽力而为的方式通过原生剪贴板 API（`native.copyToClipboard`）尝试写入相同文本。
  - 在 Termux 上，TS 首先尝试 `termux-clipboard-set`。
- **图像读取路径**：
  - Rust 从 `arboard` 读取原始图像。
  - Rust 将其重新编码为 PNG 字节（`image` crate），返回 `{ data: Uint8Array, mimeType: "image/png" }`。
  - 在 Termux 或没有显示服务器的 Linux 会话（缺少 `DISPLAY`/`WAYLAND_DISPLAY`）上，TS 提前返回 `null`。

### 工作性能分析 (`work`)

- **采集边界**：性能分析样本由 `task::blocking` 和 `task::future` 中的 `profile_region(tag)` 守卫产生。
- **存储格式**：固定大小的环形缓冲区（`MAX_SAMPLES = 10_000`），存储调用栈路径 + 持续时间（`μs`）+ 时间戳（`自进程启动以来的 μs`）。
- **输出边界**：`getWorkProfile(lastSeconds)` 返回对象：
  - `folded`：折叠栈文本（火焰图输入）
  - `summary`：markdown 表格摘要
  - `svg`：可选的火焰图 SVG
  - `totalMs`、`sampleCount`

## 生命周期与状态转换

### 图像生命周期

1. `PhotonImage.parse(bytes)` 调度一个阻塞解码任务（`image.decode`）。
2. 成功后，JS 中存在一个原生 `PhotonImage` 句柄。
3. `resize(...)` 创建一个新的原生句柄（`image.resize`），旧句柄和新句柄可以共存。
4. `encode(...)` 生成字节（`image.encode`），不会改变图像尺寸。

失败转换：

- 格式检测/解码失败会拒绝 parse promise。
- 编码失败会拒绝 encode promise。
- 无效的格式 ID 会拒绝 encode promise。

### HTML 生命周期

1. `htmlToMarkdown(html, options)` 调度一个阻塞转换任务。
2. 转换使用默认选项运行（`cleanContent=false`、`skipImages=false`），除非另有指定。
3. 返回 markdown 字符串或拒绝。

失败转换：

- 转换器失败返回被拒绝的 promise（`Conversion error: ...`）。

### 剪贴板生命周期

`copyToClipboard(text)` 是有意设计为尽力而为且多路径的：

1. 如果是 TTY：尝试 OSC 52 写入（base64 载荷）。
2. 当设置了 `TERMUX_VERSION` 时尝试 Termux 命令。
3. 尝试原生 `arboard` 文本复制。
4. 在 TS 层吞掉错误。

`readImageFromClipboard()` 在不同阶段的严格程度不同：

1. TS 对不支持的运行时上下文（Termux/无头 Linux）硬性返回 `null`。
2. Rust `arboard` 读取仅在 TS 允许时运行。
3. `ContentNotAvailable` 映射为 `null`。
4. 其他 Rust 错误会拒绝。

### 工作性能分析生命周期

1. 无需显式启动：当任务辅助函数执行时，性能分析始终处于开启状态。
2. 每个被插桩的任务作用域在守卫销毁时记录一个样本。
3. 样本在缓冲区容量达到上限后覆盖最旧的条目。
4. `getWorkProfile(lastSeconds)` 读取一个时间窗口并生成折叠栈/摘要/SVG 产物。

失败转换：

- SVG 生成失败为软失败（`svg: null`），折叠栈和摘要仍然返回。
- 空的样本窗口返回空的折叠数据和 `svg: null`，而非错误。

## 不支持的操作与错误传播

### 图像

- 不支持的解码输入或损坏的字节：严格失败（promise 拒绝）。
- 不支持的编码格式 ID：严格失败。
- TS 包装层没有尽力而为的回退路径。

### HTML

- 转换错误为严格失败（拒绝）。
- 选项省略为尽力而为的默认值处理，而非失败。

### 剪贴板

- 文本复制在 TS 层为尽力而为：操作失败会被抑制。
- 图像读取区分"无图像"（`null`）和操作失败（拒绝）。
- Termux/无头 Linux 被视为图像读取的不支持上下文（`null`）。

### 工作性能分析

- 函数调用本身的检索是严格的，但产物生成是部分尽力而为的（`svg` 可为空）。
- 缓冲区截断是预期行为（环形缓冲区），而非数据丢失错误。

## 平台注意事项

- **剪贴板文本**：OSC 52 依赖终端支持；原生剪贴板访问依赖桌面环境/会话。
- **剪贴板图像读取**：在 Termux 和没有显示服务器的 Linux 上，被 TS 阻止。
