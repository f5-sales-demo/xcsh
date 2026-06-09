---
title: 原生文本和搜索管道
description: 基于 grep、glob 和 ripgrep 的原生文本搜索管道，用于文件内容索引。
sidebar:
  order: 6
  label: 文本与搜索管道
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# 原生文本/搜索管道

本文档描述了 `@f5xc-salesdemos/pi-natives` 文本/搜索接口（`grep`、`glob`、`text`、`highlight`）从 TypeScript 包装器到 Rust N-API 导出再到 JS 结果对象的映射关系。

术语遵循 `docs/natives-architecture.md`：

- **包装器（Wrapper）**：位于 `packages/natives/src/*` 中的 TS API
- **Rust 模块层**：位于 `crates/pi-natives/src/*` 中的 N-API 导出
- **共享扫描缓存**：基于 `fs_cache` 的目录条目缓存，供发现/搜索流程使用

## 实现文件

- `packages/natives/src/grep/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/highlight/types.ts`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/glob_util.rs`
- `crates/pi-natives/src/fs_cache.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/highlight.rs`
- `crates/pi-natives/src/fd.rs`

## JS API ↔ Rust 导出映射

| JS 包装器 API | Rust 导出（`#[napi]`，snake_case -> camelCase） | Rust 模块 |
| --- | --- | --- |
| `grep(options, onMatch?)` | `grep` | `grep.rs` |
| `searchContent(content, options)` | `search` | `grep.rs` |
| `hasMatch(content, pattern, options?)` | `hasMatch` | `grep.rs` |
| `fuzzyFind(options)` | `fuzzyFind` | `fd.rs` |
| `glob(options, onMatch?)` | `glob` | `glob.rs` |
| `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `fs_cache.rs` |
| `wrapTextWithAnsi(text, width)` | `wrapTextWithAnsi` | `text.rs` |
| `truncateToWidth(text, maxWidth, ellipsis, pad)` | `truncateToWidth` | `text.rs` |
| `sliceWithWidth(line, startCol, length, strict?)` | `sliceWithWidth` | `text.rs` |
| `extractSegments(line, beforeEnd, afterStart, afterLen, strictAfter)` | `extractSegments` | `text.rs` |
| `sanitizeText(text)` | `sanitizeText` | `text.rs` |
| `visibleWidth(text)` | `visibleWidth` | `text.rs` |
| `highlightCode(code, lang, colors)` | `highlightCode` | `highlight.rs` |
| `supportsLanguage(lang)` | `supportsLanguage` | `highlight.rs` |
| `getSupportedLanguages()` | `getSupportedLanguages` | `highlight.rs` |

## 按子系统的管道概览

## 1) 正则搜索（`grep`、`searchContent`、`hasMatch`）

### 输入/选项流程

1. TS 包装器将选项转发到原生层：
   - `grep/index.ts` 基本原样传递 `options`，并将回调从 `(match) => void` 包装为 napi 线程安全回调形式 `(err, match)`。
   - `searchContent` 和 `hasMatch` 直接传递字符串/`Uint8Array`。
2. `grep.rs` 中的 Rust 选项结构体反序列化 camelCase 字段（`ignoreCase`、`maxCount`、`contextBefore`、`contextAfter`、`maxColumns`、`timeoutMs`）。
3. `grep` 从 `timeoutMs` + `AbortSignal` 创建 `CancelToken`，并在 `task::blocking("grep", ...)` 内运行。

### 执行分支

- **内存分支（纯工具）**
  - `search` → `search_sync` → 对提供的内容字节执行 `run_search`。
  - 无文件系统扫描，不使用 `fs_cache`。
- **单文件分支（依赖文件系统）**
  - `grep_sync` 解析路径，检查元数据是否为文件，通过 ripgrep 匹配器流式处理每个文件最多 `MAX_FILE_BYTES`（`4 MiB`）。
- **目录分支（依赖文件系统）**
  - 当 `cache: true` 时，通过 `fs_cache::get_or_scan` 进行可选缓存查找。
  - 当 `cache: false` 时，通过 `fs_cache::force_rescan` 执行全新扫描。
  - 当缓存年龄超过 `empty_recheck_ms()` 时，对空结果进行可选的重新检查。
  - 条目过滤：仅文件 + 可选 glob 过滤（`glob_util`）+ 可选类型过滤映射（`js`、`ts`、`rust` 等）。

### 搜索/收集语义

- 正则引擎：`grep_regex::RegexMatcherBuilder`，支持 `ignoreCase` 和 `multiline`。
- 上下文解析：
  - `contextBefore/contextAfter` 覆盖旧版 `context`。
  - 非内容模式将上下文收集归零。
- 输出模式：
  - `content` => 每个命中生成一个 `GrepMatch`。
  - `count` 和 `filesWithMatches` 都映射为计数样式条目（`lineNumber=0`、`line=""`、设置 `matchCount`）。
- 限制：
  - 全局 `offset` 和 `maxCount` 跨文件应用。
  - 仅当 `maxCount` 未设置且 `offset == 0` 时使用并行路径；否则使用顺序路径以保持确定性的全局偏移/限制语义。

### 结果转换回 JS

- Rust `SearchResult`/`GrepResult` 字段通过 N-API 对象字段转换映射到 TS 类型。
- 计数器在跨越 N-API 边界前被截断为 `u32`。
- 可选布尔值在某些路径中仅在为 true 时才包含（`limitReached`）。
- 流式回调接收每个已转换的 `GrepMatch`（内容或计数条目）。

### 失败行为

- `searchContent` 对正则/搜索失败返回 `SearchResult.error`，而非抛出异常。
- `grep` 在硬错误（无效路径、无效 glob/正则、取消超时/中止）时 reject。
- `hasMatch` 返回 `Result<bool>`，在无效模式/UTF-8 解码错误时抛出异常。
- 多文件扫描中的文件打开/搜索错误按文件跳过；扫描继续。

### 格式错误的正则处理

`grep.rs` 在正则编译前清理花括号：

- 当无效的重复样式花括号无法构成 `{N}`、`{N,}`、`{N,M}` 时，将其转义（`{`/`}` -> `\{`/`\}`）。
- 这可以防止常见的字面模板片段（例如 `${platform}`）因格式错误的重复而失败。
- 其余无效的正则语法仍然返回正则错误。

## 2) 文件发现（`glob`）和模糊路径搜索（`fuzzyFind`）

`glob` 和 `fuzzyFind` 共享 `fs_cache` 扫描；匹配逻辑不同。

### `glob` 流程

1. TS 包装器（`glob/index.ts`）：
   - `path.resolve(options.path)`。
   - 默认值：`pattern="*"`、`hidden=false`、`gitignore=true`、`recursive=true`。
2. Rust `glob` 构建 `GlobConfig` 并通过 `glob_util::compile_glob` 编译模式。
3. 条目来源：
   - `cache=true` => `get_or_scan` + 可选的过期空结果 `force_rescan`。
   - `cache=false` => `force_rescan(..., store=false)`（仅全新扫描）。
4. 过滤：
   - 始终跳过 `.git`。
   - 除非请求（`includeNodeModules` 或模式中包含 node_modules），否则跳过 `node_modules`。
   - 应用 glob 匹配。
   - 应用文件类型过滤；符号链接的 `file/dir` 过滤器解析目标元数据。
5. 在截断到 `maxResults` 之前，可选按 mtime 降序排序（`sortByMtime`）。

### `fuzzyFind` 流程（在 `fd.rs` 中实现）

1. TS 包装器从 `grep` 模块导出，但 Rust 实现位于 `fd.rs`。
2. 与 `fs_cache` 共享扫描源，具有相同的缓存/无缓存分支和过期空结果重新检查策略。
3. 评分：
   - 精确匹配 / 前缀匹配 / 包含匹配 / 基于子序列的模糊评分
   - 分隔符/标点符号归一化的评分路径
   - 目录加分和确定性平局处理（`score desc`，然后 `path asc`）
4. 符号链接条目从模糊搜索结果中排除。

### 失败行为

- 无效的 glob 模式 => `glob_util::compile_glob` 返回错误。
- 搜索根路径必须是已存在的目录（`resolve_search_path`），否则报错。
- 取消/超时通过循环中的 `CancelToken::heartbeat()` 检查传播为中止错误。

### 格式错误的 glob 处理

`glob_util::build_glob_pattern` 具有容错性：

- 将 `\` 归一化为 `/`。
- 当 `recursive=true` 时，自动为简单递归模式添加 `**/` 前缀。
- 编译前自动关闭未平衡的 `{...` 交替组。

## 3) 共享扫描/缓存生命周期（`fs_cache`）

`fs_cache` 将扫描结果存储为归一化的相对条目（`path`、`fileType`、可选的 `mtime`），键值由以下内容组成：

- 规范化的搜索根路径
- `include_hidden`
- `use_gitignore`

### 缓存状态转换

1. **未命中 / 已禁用**
   - TTL 为 `0` 或键不存在/已过期 -> 全新 `collect_entries`。
2. **命中**
   - 条目年龄 `< cache_ttl_ms()` -> 返回缓存条目 + `cache_age_ms`。
3. **过期空结果重新检查**（`glob`/`grep`/`fd` 中的调用方策略）
   - 如果查询产生零匹配且 `cache_age_ms >= empty_recheck_ms()`，强制执行一次重新扫描。
4. **失效**
   - `invalidateFsScanCache(path?)`：
     - 无参数：清除所有键
     - 有路径参数：移除根路径为该目标路径前缀的键

### 过期结果权衡

- 缓存优先考虑重复扫描的低延迟，而非即时一致性。
- TTL 窗口期内可能返回过期的正结果/负结果。
- 空结果重新检查减少了较旧缓存扫描的过期负结果，代价是额外执行一次扫描。
- 显式失效是文件变更后预期的正确性钩子。

## 4) ANSI 文本工具（`text`）

这些是纯内存工具（无文件系统扫描）。

### 边界和职责

- **`text.rs` 负责终端单元格语义**：
  - ANSI 序列解析
  - 字素感知的宽度和切片
  - 换行/截断/清理行为
- **`grep.rs` 行截断（`maxColumns`）是独立的**：
  - 对匹配行使用 `...` 进行简单的字符边界截断
  - 不保留 ANSI 状态，不感知终端单元格宽度

### 关键行为

- `wrapTextWithAnsi`：按可见宽度换行，跨换行行携带活动的 SGR 代码。
- `truncateToWidth`：可见单元格截断，支持省略号策略（`Unicode`、`Ascii`、`Omit`）、可选右填充，以及在未更改时返回原始 JS 字符串的快速路径。
- `sliceWithWidth`：列切片，支持可选的严格宽度强制。
- `extractSegments`：在叠加层周围提取前/后片段，同时恢复 `after` 片段的 ANSI 状态。
- `sanitizeText`：剥离 ANSI 转义 + 控制字符，丢弃孤立代理对，通过删除 `\r` 来归一化 CR/LF。
- `visibleWidth`：计算可见终端单元格（制表符使用 Rust 实现中的固定 `TAB_WIDTH`）。

### 失败行为

文本函数通常返回确定性的转换输出；错误仅限于 JS 字符串转换边界（N-API 参数转换失败）。

## 5) 语法高亮（`highlight`）

`highlight.rs` 是纯转换（无文件系统，无缓存）。

### 流程

1. 包装器转发 `code`、可选的 `lang` 和 ANSI 调色板。
2. Rust 通过以下方式解析语法：
   - 标记/名称查找
   - 扩展名查找
   - 别名表回退（`ts/tsx/js -> JavaScript` 等）
   - 未解析时回退到纯文本语法
3. 使用 syntect `ParseState` 和作用域栈解析每一行。
4. 将作用域映射到 11 个语义颜色类别，并注入/重置 ANSI 颜色代码。

### 失败行为

- 单行解析失败不会导致调用失败：该行以未高亮方式追加，处理继续。
- 未知/不支持的语言回退到纯文本语法。

## 纯工具 vs 依赖文件系统的流程

| 流程 | 文件系统访问 | 共享缓存 | 备注 |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | 否 | 否 | 仅对提供的字节/字符串执行正则 |
| `text` 模块函数 | 否 | 否 | 仅 ANSI/宽度/清理 |
| `highlight` 模块函数 | 否 | 否 | 仅语法 + ANSI 着色 |
| `glob` | 是 | 可选 | 目录扫描 + glob 过滤 |
| `fuzzyFind` | 是 | 可选 | 目录扫描 + 模糊评分 |
| `grep`（文件/目录路径） | 是 | 可选（目录模式） | 对文件执行 ripgrep，可选过滤器/回调 |

## 端到端生命周期摘要

1. 调用方使用类型化选项调用 TS 包装器。
2. 包装器归一化默认值（特别是 `glob`）并转发到 `native.*` 导出。
3. Rust 验证/归一化选项并构建匹配器/搜索配置。
4. 对于文件系统流程，扫描条目（缓存命中/未命中/重新扫描）然后过滤/评分。
5. 工作循环定期调用取消心跳；超时/中止可以终止执行。
6. Rust 将输出转换为 N-API 对象（`lineNumber`、`matchCount`、`limitReached` 等）。
7. TS 包装器返回类型化的 JS 对象（以及 `grep`/`glob` 的可选逐匹配回调）。
