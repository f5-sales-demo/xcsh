---
title: 原生绑定契约（TypeScript 侧）
description: 通过 N-API 调用 Rust 原生函数的 TypeScript 侧绑定契约。
sidebar:
  order: 2
  label: 绑定契约
i18n:
  sourceHash: f5b74267cdd5
  translator: machine
---

# 原生绑定契约（TypeScript 侧）

本文档定义了位于 `@f5xc-salesdemos/pi-natives` 调用方与已加载 N-API 插件之间的 TypeScript 侧契约。

本文档聚焦于三个部分：

1. 契约形状（`NativeBindings` + 模块声明扩展），
2. 包装器行为（`src/<module>/index.ts`），
3. 公开导出表面（`src/index.ts`）。

## 实现文件

- `packages/natives/src/bindings.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/grep/index.ts`
- `packages/natives/src/highlight/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/system-info/types.ts`
- `packages/natives/src/system-info/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/work/types.ts`
- `packages/natives/src/work/index.ts`

## 契约模型

`packages/natives/src/bindings.ts` 定义了基础契约：

- `NativeBindings`（基础接口，目前包含 `cancelWork(id: number): void`）
- `Cancellable`（`timeoutMs?: number`，`signal?: AbortSignal`）
- `TsFunc<T>` N-API 线程安全回调使用的回调签名

每个模块通过声明合并添加自己的字段：

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

这种方式维护了一个聚合的绑定接口，而无需一个单体式的中央类型文件。

## 声明合并生命周期与状态转换

### 1) 编译时类型组装

- `bindings.ts` 提供基础的 `NativeBindings` 符号。
- 每个 `src/<module>/types.ts` 扩展 `NativeBindings`。
- `src/native.ts` 为了副作用导入所有 `./<module>/types` 文件，使得合并后的契约在使用 `NativeBindings` 的地方处于作用域内。

状态转换：**基础契约** → **合并后契约**。

### 2) 运行时插件加载与验证关卡

- `src/native.ts` 加载候选的 `.node` 二进制文件。
- 加载的对象被视为 `NativeBindings` 并立即通过 `validateNative(...)` 进行验证。
- `validateNative` 通过 `typeof bindings[name] === "function"` 验证所需的导出键。

状态转换：**不可信的插件对象** → **已验证的原生绑定对象**（或硬性失败）。

### 3) 包装器调用

- `src/<module>/index.ts` 中的模块包装器调用 `native.<export>`。
- 包装器适配默认值和回调签名（将 `(err, value)` 转换为 JS API 中仅接收值的回调模式）。
- `src/index.ts` 重新导出模块包装器/类型作为公开包 API。

状态转换：**已验证的原始绑定** → **人性化的公开 API**。

## 包装器职责

包装器被有意设计为轻量的；它们不重新实现原生逻辑。

主要职责：

- **参数规范化/默认值设置**
  - `glob()` 将 `options.path` 解析为绝对路径，并为 `hidden`、`gitignore`、`recursive` 设置默认值。
  - `hasMatch()` 在原生调用前填充默认标志（`ignoreCase`、`multiline`）。
- **回调适配**
  - `grep()`、`glob()`、`executeShell()` 将 `TsFunc<T>`（`error, value`）转换为仅接收成功值的用户回调。
- **围绕原生调用的环境或策略行为**
  - 剪贴板包装器添加了 OSC52/Termux/无头模式处理，并将复制操作视为尽力而为。
- **公开命名与重新导出管理**
  - `searchContent()` 映射到原生导出 `search`。

## 公开导出表面组织

`packages/natives/src/index.ts` 是规范的公开桶文件。它按功能域分组导出：

- 搜索/文本：`grep`、`glob`、`text`、`highlight`
- 执行/进程/终端：`shell`、`pty`、`ps`、`keys`
- 系统/媒体/转换：`image`、`html`、`clipboard`、`system-info`、`work`

维护者规则：如果包装器未从 `src/index.ts` 重新导出，则它不属于预期的公开包表面。

## JS API ↔ 原生导出映射（代表性示例）

Rust 侧使用 N-API 导出名称（通常由 `#[napi]` 的 snake_case -> camelCase 转换而来，偶尔使用显式别名），这些名称必须与这些绑定键匹配。

| 类别 | 公开 JS API（包装器） | 原生绑定键 | 返回类型 | 异步？ |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | 是 |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | 否 |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | 否 |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | 是 |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | 是 |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | 否 |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | 是 |
| Shell | `Shell` | `Shell` | 类构造函数 | N/A |
| PTY | `PtySession` | `PtySession` | 类构造函数 | N/A |
| Text | `truncateToWidth(...)` | `truncateToWidth` | `string` | 否 |
| Text | `sliceWithWidth(...)` | `sliceWithWidth` | `SliceWithWidthResult` | 否 |
| Text | `visibleWidth(text)` | `visibleWidth` | `number` | 否 |
| Highlight | `highlightCode(code, lang, colors)` | `highlightCode` | `string` | 否 |
| HTML | `htmlToMarkdown(html, options?)` | `htmlToMarkdown` | `Promise<string>` | 是 |
| System | `getSystemInfo()` | `getSystemInfo` | `SystemInfo` | 否 |
| Work | `getWorkProfile(lastSeconds)` | `getWorkProfile` | `WorkProfile` | 否 |
| Process | `killTree(pid, signal)` | `killTree` | `number` | 否 |
| Process | `listDescendants(pid)` | `listDescendants` | `number[]` | 否 |
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>`（尽力而为的包装器行为） | 是 |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | 是 |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | 否 |

## 同步与异步契约差异

契约混合了同步和异步 API；包装器保留原生调用风格而非强制统一模型：

- **基于 Promise 的异步导出**用于 I/O 或长时间运行的工作（`grep`、`glob`、`htmlToMarkdown`、`executeShell`、剪贴板、图像操作）。
- **同步导出**用于确定性的内存内转换/解析器（`search`、`hasMatch`、高亮、文本宽度/切片、按键解析、进程查询）。
- **构造函数导出**用于有状态的运行时对象（`Shell`、`PtySession`、`PhotonImage`）。

对维护者的影响：更改现有导出的同步 ↔ 异步是跨包装器和调用方的破坏性 API 和契约变更。

## 对象与枚举类型模式

### 对象模式（`#[napi(object)]` 风格的 JS 对象）

TS 将对象形状的原生值建模为接口，例如：

- `GrepResult`、`SearchResult`、`GlobResult`
- `SystemInfo`、`WorkProfile`
- `ClipboardImage`、`ParsedKittyResult`

这些是编译时的结构契约；运行时的形状正确性由原生实现负责。

### 枚举模式

数值型原生枚举在 TS 中表示为 `const enum` 值：

- `FileType`（`1=file`、`2=dir`、`3=symlink`）
- `ImageFormat`（`0=PNG`、`1=JPEG`、`2=WEBP`、`3=GIF`）
- `SamplingFilter`、`Ellipsis`、`KeyEventType`

调用方看到命名的枚举成员；绑定边界传递数字。

## 如何捕获不匹配

不匹配检测发生在两个层面：

1. **编译时 TypeScript 契约检查**
   - 包装器针对合并后的 `NativeBindings` 调用 `native.<name>`。
   - 缺失/重命名的绑定键会导致包装器中的 TS 类型检查失败。

2. **`validateNative` 中的运行时验证**
   - 加载后，`native.ts` 检查所需的导出，如果缺失则抛出异常。
   - 错误信息包含缺失的键和重新构建说明。

这能捕获常见的过期二进制文件漂移问题：包装器/类型存在但加载的 `.node` 缺少该导出。

## 失败行为与注意事项

### 加载/验证失败（硬性失败）

- 插件加载失败或不支持的平台在 `native.ts` 的模块初始化期间抛出异常。
- 缺少必需的导出会在包装器可用之前抛出异常。

效果：包快速失败而非将失败延迟到首次调用。

### 包装器层面的行为差异

- 某些包装器有意软化失败（`copyToClipboard` 采用尽力而为策略并吞掉原生失败）。
- 流式回调忽略回调错误负载，仅转发成功的值事件。

### 类型层面的注意事项（运行时比 TS 更严格）

- TS 可选字段不保证语义有效性；原生层仍然可以拒绝格式错误的值。
- `const enum` 类型不能在运行时阻止来自无类型调用方的超出范围的数值。
- `validateNative` 仅检查所需导出的存在性/是否为函数，不检查深层的参数/返回值形状兼容性。
- `bindings.ts` 在基础接口中包含 `cancelWork(id)`，但当前运行时验证列表并未强制检查该键。

## 绑定变更的维护者检查清单

添加/更改导出时，需更新以下所有内容：

1. `src/<module>/types.ts`（声明扩展 + 契约类型）
2. `src/<module>/index.ts`（包装器行为）
3. `src/native.ts` 对模块类型的导入（如果是新模块）
4. `validateNative` 所需导出检查
5. `src/index.ts` 公开重新导出

跳过任何步骤都会导致编译时漂移或运行时加载失败。
