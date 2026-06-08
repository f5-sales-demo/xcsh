---
title: 从 pi-mono 移植：实用合并指南
description: 将代码从 pi-mono 单体仓库迁移到 xcsh 代码库的实用指南。
sidebar:
  order: 9
  label: 从 pi-mono 移植
i18n:
  sourceHash: dbba6f6c0987
  translator: machine
---

# 从 pi-mono 移植：实用合并指南

本指南是将 pi-mono 中的变更移植到本仓库的可重复检查清单。
适用于任何合并操作：单个文件、功能分支或完整版本同步。

## 上次同步点

**提交：** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`
**日期：** 2026-03-22

每次同步后更新此部分；不要复用之前的范围。

开始新同步时，从此提交开始生成补丁：

```bash
git format-patch b21b42d032919de2f2e6920a76fa9a37c3920c0a..HEAD --stdout > changes.patch
```

## 0) 确定范围

- 确认上游参考（提交、标签或 PR）。
- 列出计划涉及的包或文件夹。
- 确定哪些功能在范围内，哪些有意跳过。

## 1) 安全地引入代码

- 优先使用简洁、聚焦的 diff，而非批量复制。
- 避免复制构建产物或生成的文件。
- 如果上游新增了文件，需显式添加并审查内容。

## 2) 匹配导入扩展名约定

大多数运行时 TypeScript 源文件在内部导入中省略 `.js`，但某些测试/基准入口文件为了 ESM
运行时兼容性会保留 `.js`。遵循本地包的现有风格；不要全面删除扩展名。

- 在 `packages/coding-agent` 运行时源文件中，内部导入不加扩展名，除非导入非 TS 资源。
- 在 `packages/tui/test` 和 `packages/natives/bench` 中，当周围文件已使用 `.js` 时保留 `.js`。
- 当工具链要求时保留真实文件扩展名（如 `.json`、`.css`、`.md` 文本嵌入）。
- 示例：`import { x } from "./foo.js";` → `import { x } from "./foo";`（仅当包约定为无扩展名时）。

## 3) 替换导入作用域

上游使用不同的包作用域。需一致地替换它们。

- 将旧作用域替换为本仓库使用的本地作用域。
- 示例（根据实际移植的包进行调整）：
  - `@mariozechner/pi-coding-agent` → `@f5xc-salesdemos/xcsh`
  - `@mariozechner/pi-agent-core` → `@f5xc-salesdemos/pi-agent-core`
  - `@mariozechner/pi-tui` → `@f5xc-salesdemos/pi-tui`
  - `@mariozechner/pi-ai` → `@f5xc-salesdemos/pi-ai`

## 4) 在 Bun 有优势时使用 Bun API

我们运行在 Bun 上。仅当 Bun 提供更好的替代方案时才替换 Node API。

**应该替换：**

- 进程创建：`child_process.spawn` → Bun Shell `$` 用于简单命令，`Bun.spawn`/`Bun.spawnSync` 用于流式或长时间运行的任务
- 文件 I/O：`fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- HTTP 客户端：`node-fetch`、`axios` → 原生 `fetch`
- 加密哈希：`node:crypto` → Web Crypto 或 `Bun.hash`
- SQLite：`better-sqlite3` → `bun:sqlite`
- 环境变量加载：`dotenv` → Bun 自动加载 `.env`

**不应替换（这些在 Bun 中正常工作）：**

- `os.homedir()` — 不要替换为 `Bun.env.HOME`、`Bun.env.HOME` 或字面量 `"~"`
- `os.tmpdir()` — 不要替换为 `Bun.env.TMPDIR || "/tmp"` 或硬编码路径
- `fs.mkdtempSync()` — 不要替换为手动路径拼接
- `path.join()`、`path.resolve()` 等 — 这些没问题

**导入风格：** 仅使用带 `node:` 前缀的命名空间导入（不要从 `node:fs` 或 `node:path` 进行命名导入）。

**额外的 Bun 约定：**

- 对于简短的非流式命令优先使用 Bun Shell `$`；仅在需要流式 I/O 或进程控制时使用 `Bun.spawn`。
- 文件操作使用 `Bun.file()`/`Bun.write()`，目录操作使用 `node:fs/promises`。
- 避免 `Bun.file().exists()` 检查；在 try/catch 中使用 `isEnoent` 处理。
- 优先使用 `Bun.sleep(ms)` 而非 `setTimeout` 包装。

**错误示例：**

```typescript
// BROKEN: env vars may be undefined, "~" is not expanded
const home = Bun.env.HOME || "~";
const tmp = Bun.env.TMPDIR || "/tmp";
```

**正确示例：**

```typescript
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

const configDir = path.join(os.homedir(), ".config", "myapp");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myapp-"));
```

## 5) 优先使用 Bun 嵌入（无需复制）

不要在构建时复制运行时资源或供应商文件。

- 如果上游将资源复制到 dist 文件夹，请替换为 Bun 友好的嵌入方式。
- 提示词是静态 `.md` 文件；使用 Bun 文本导入（`with { type: "text" }`）和 Handlebars，而不是内联提示词字符串。
- 使用 `import.meta.dir` + `Bun.file` 加载相邻的非文本资源。
- 将资源保留在仓库中，让打包器包含它们。
- 除非用户明确要求，否则移除复制脚本。
- 如果上游在运行时读取打包的回退文件，请用 Bun 文本嵌入导入替换文件系统读取。
  - 示例（Codex 指令回退）：
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` -> 移除
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - 使用 `return FALLBACK_INSTRUCTIONS;` 替代 `readFileSync(FALLBACK_PROMPT_PATH, "utf8")`

## 6) 谨慎移植 `package.json`

将 `package.json` 视为契约。有意识地合并。

- 保留现有的 `name`、`version`、`type`、`exports` 和 `bin`，除非移植需要变更。
- 将 npm/node 脚本替换为 Bun 等价物（如 `bun check`、`bun test`）。
- 确保依赖使用正确的作用域。
- 不要通过降级依赖来修复类型错误；应该升级。
- 验证工作区包链接和 `peerDependencies`。

## 7) 对齐代码风格和工具链

- 保持现有的格式约定。
- 除非必要，不要引入 `any`。
- 避免动态导入和内联类型导入；仅使用顶层导入。
- 永远不要在代码中构建提示词；提示词是使用 Handlebars 渲染的静态 `.md` 文件。
- 在 coding-agent 中，永远不要使用 `console.log`/`console.warn`/`console.error`；使用 `@f5xc-salesdemos/pi-utils` 中的 `logger`。
- 使用 `Promise.withResolvers()` 替代 `new Promise((resolve, reject) => ...)`。
- **不要在类字段或方法上使用 `private`/`protected`/`public` 关键字。** 使用 ES `#` 私有字段进行封装；可访问的成员保持无关键字。唯一的例外是构造函数参数属性（`constructor(private readonly x: T)`），TypeScript 要求必须使用关键字。移植使用 `private foo` 或 `protected bar` 的上游代码时，转换为 `#foo`（私有）或裸 `bar`（可访问）。
- 优先使用现有的辅助函数和工具，而非新的临时代码。
- 保留本仓库中已有的 Bun 优先基础设施变更：
  - 运行时是 Bun（无 Node 入口点）。
  - 包管理器是 Bun（无 npm 锁文件）。
  - 重量级 Node API（`child_process`、`readline`）已替换为 Bun 等价物。
  - 轻量级 Node API（`os.homedir`、`os.tmpdir`、`fs.mkdtempSync`、`path.*`）保留。
  - CLI shebang 使用 `bun`（非 `node`，非 `tsx`）。
  - 包直接使用源文件（无 TypeScript 构建步骤）。
  - CI 工作流使用 Bun 进行安装/检查/测试。

## 8) 移除旧的兼容层

除非有明确要求，否则移除上游的兼容性垫片。

- 删除已被替换的旧 API。
- 将所有调用点直接更新为新 API。
- 不要保留 `*_v2` 或并行版本。

## 9) 更新文档和引用

- 在适当的地方替换 pi-mono 仓库链接。
- 更新示例以使用 Bun 和正确的包作用域。
- 确保 README 说明仍然与当前仓库行为一致。

## 10) 验证移植

变更后运行标准检查：

- `bun check`

如果仓库已有与你的变更无关的失败检查，请指出。
测试使用 Bun 的运行器（非 Vitest），但仅在明确要求时才运行 `bun test`。

## 11) 保护已改进的功能（回归陷阱清单）

如果你已在本地改进了行为，将这些视为**不可妥协的**。在移植前，记录下
这些改进并添加显式检查，以确保它们不会在合并中丢失。

- **冻结预期行为**：为每项改进添加简短的"之前/之后"说明（输入、输出、
  默认值、边界情况）。这可以防止静默回退。
- **映射旧 → 新 API**：如果上游重命名了概念（hooks → extensions、custom tools → tools 等），
  确保每个旧入口点仍然正确连接。遗漏一个标志或导出就等于丢失功能。
- **验证导出**：检查 `package.json` 的 `exports`、公共类型和桶文件。上游移植经常
  忘记重新导出本地新增内容。
- **覆盖非正常路径**：如果你修复了错误处理、超时或回退逻辑，添加测试或
  至少添加一个手动检查清单来验证这些路径。
- **检查默认值和配置合并顺序**：改进通常存在于默认值中。确认新默认值
  没有回退（例如新的配置优先级、禁用的功能、工具列表）。
- **审计环境/shell 行为**：如果你修复了执行或沙箱问题，验证新路径仍然使用你
  清理过的环境，并且没有重新引入别名/函数覆盖。
- **重新运行目标样例**：保持一组最小的"已知良好"示例，并在移植后运行它们
  （CLI 标志、扩展注册、工具执行）。

## 12) 检测和处理重构的代码

在移植文件之前，检查上游是否对其进行了重大重构：

```bash
# Compare the file you're about to port against what you have locally
git diff HEAD upstream/main -- path/to/file.ts
```

如果 diff 显示文件被**重构**（不仅仅是打补丁）：

- 新的抽象、重命名的概念、合并的模块、改变的数据流

那么你必须在移植前**仔细阅读新实现**。盲目合并重构的代码会丢失功能，原因如下：

注意：交互模式最近被拆分为 controllers/utils/types。当回移相关变更时，将更新移植到我们创建的各个文件中，并确保 `interactive-mode.ts` 的连接保持同步。

1. **默认值静默改变** - 新变量 `defaultFoo = [a, b]` 可能替换了旧的 `getAllFoo()`，而后者返回 `[a, b, c, d, e]`。

2. **API 选项被丢弃** - 当系统合并时（例如 `hooks` + `customTools` → `extensions`），旧选项可能没有连接到新实现。

3. **代码路径变得过时** - 重命名的概念（例如 `hookMessage` → `custom`）需要在每个 switch 语句、类型守卫和处理器中更新——不仅仅是定义。

4. **上下文/能力缩减** - 旧 API 可能暴露了 `{ logger, typebox, pi }`，而新 API 忘记包含它们。

### 语义移植流程

当上游重构了某个模块时：

1. **阅读旧实现** - 理解它做了什么、接受什么选项、暴露了什么。

2. **阅读新实现** - 理解新的抽象以及它们如何映射到旧行为。

3. **验证功能对等** - 对于旧代码中的每个能力，确认新代码保留了它或明确移除了它。

4. **搜索遗漏** - 搜索可能在 switch 语句、处理器、UI 组件中遗漏的旧名称/概念。

5. **测试边界** - CLI 标志、SDK 选项、事件处理器、默认值——这些是回归隐藏的地方。

### 快速检查

```bash
# Find all uses of an old concept that may need updating
rg "oldConceptName" --type ts

# Compare default values between versions
git show upstream/main:path/to/file.ts | rg "default|DEFAULT"

# Check if all enum/union values have handlers
rg "case \"" path/to/file.ts
```

## 13) 快速审计检查清单

完成前将此作为最终检查：

- [ ] 导入扩展名遵循本地包约定（不要全面删除 `.js`）
- [ ] 新/移植的代码中没有仅 Node 的 API
- [ ] 所有包作用域已更新
- [ ] `package.json` 脚本使用 Bun
- [ ] 提示词是 `.md` 文本导入（无内联提示词字符串）
- [ ] coding-agent 中没有 `console.*`（使用 `logger`）
- [ ] 资源通过 Bun 嵌入模式加载（无复制脚本）
- [ ] 测试或检查可运行（或明确标注为受阻）
- [ ] 无功能回归（参见第 11-12 节）

## 14) 提交信息格式

提交回移时，遵循仓库格式 `<type>(scope): <past-tense description>` 并在标题中保留提交范围。

```
fix(coding-agent): backported pi-mono changes (<from>..<to>)

packages/<package>:
- <type>: <description>
- <type>: <description> (#<issue> by @<contributor>)

packages/<other-package>:
- <type>: <description>
```

**示例：**

```
fix(coding-agent): backported pi-mono changes (9f3eef65f..52532c7c0)

packages/ai:
- fix: handle "sensitive" stop reason from Anthropic API
- fix: normalize tool call IDs with special characters for Responses API
- fix: add overflow detection for Bedrock, MiniMax, Kimi providers
- fix: 429 status is rate limiting, not context overflow

packages/tui:
- fix: refactored autocomplete state tracking
- fix: file autocomplete should not trigger on empty text
- fix: configurable autocomplete max visible items
- fix: improved table column width calculation with word-aware wrapping

packages/coding-agent:
- fix: preserve external config.yml edits on save (#1046 by @nicobailonMD)
- fix: resolve macOS NFD and curly quote variants in file paths
```

**规则：**

- 按包分组变更
- 使用常规提交类型（`fix`、`feat`、`refactor`、`perf`、`docs`）
- 包含上游 issue/PR 编号以及外部贡献者的署名
- 标题中的提交范围有助于跟踪同步点

## 15) 有意的差异

我们的 fork 有与上游不同的架构决策。**不要移植以下上游模式：**

### UI 架构

| 上游                                        | 我们的 Fork                                               | 原因                                                                  |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `FooterDataProvider` 类                     | `StatusLineComponent`                                     | 更简单、集成的状态行                                                  |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | 在非 TUI 模式中为桩函数                                  | 在 TUI 中实现，其他地方为空操作                                       |
| `ctx.ui.setEditorComponent()`               | 在非 TUI 模式中为桩函数                                  | 在 TUI 中实现，其他地方为空操作                                       |
| `InteractiveModeOptions` 选项对象           | 位置构造函数参数（选项类型仍然导出）                      | 保持构造函数签名；当上游添加字段时更新类型                            |

### 组件命名

| 上游                         | 我们的 Fork             |
| ---------------------------- | ----------------------- |
| `extension-input.ts`         | `hook-input.ts`         |
| `extension-selector.ts`      | `hook-selector.ts`      |
| `ExtensionInputComponent`    | `HookInputComponent`    |
| `ExtensionSelectorComponent` | `HookSelectorComponent` |

### API 命名

| 上游                                     | 我们的 Fork                              | 备注                                      |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)`    | 我们全程使用 `sessionName`                |
| `sessionManager.getSessionName()`        | `sessionManager.getSessionName()`        | 相同（我们统一以匹配上游的 RPC）          |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | 相同                                      |

### 文件合并

| 上游                                               | 我们的 Fork                             | 原因                                    |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts`（工具文件）   | `@f5xc-salesdemos/pi-natives` 剪贴板模块 | 合并到 N-API 原生实现中                |

### 测试框架

| 上游                      | 我们的 Fork                   |
| ------------------------- | ----------------------------- |
| `vitest` 配合 `vi.mock()` | `bun:test` 配合 bun 的 `vi`  |
| `node:test` 断言          | `expect()` 匹配器            |

### 工具架构

| 上游                                | 我们的 Fork                                                       | 备注                                                      |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `createTool(cwd: string, options?)` | `createTools(session: ToolSession)` 通过 `BUILTIN_TOOLS` 注册表  | 工具工厂接受 `ToolSession` 且可以返回 `null`              |
| 每个工具的 `*Operations` 接口       | 每个工具的接口保留（`FindOperations`、`GrepOperations`）          | 用于 SSH/远程覆盖                                         |
| 到处使用 Node.js `fs/promises`      | 文件使用 `Bun.file()`/`Bun.write()`；目录使用 `node:fs/promises` | 当 Bun API 能简化时优先使用                               |

### 认证存储

| 上游                            | 我们的 Fork                                 | 备注                                         |
| ------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `proper-lockfile` + `auth.json` | `agent.db` (bun:sqlite)                     | 凭证专门存储在 `agent.db` 中                 |
| 每个提供商单个凭证              | 多凭证轮询选择                              | 会话亲和性和退避逻辑保留                     |

### 扩展

| 上游                          | 我们的 Fork                                |
| ----------------------------- | ------------------------------------------ |
| `jiti` 用于 TypeScript 加载   | 原生 Bun `import()`                        |
| `pkg.pi` 清单字段             | `pkg.xcsh ?? pkg.pi`（优先使用我们的命名空间） |

### 跳过以下上游功能

移植时，**完全跳过**以下文件/功能：

- `footer-data-provider.ts` — 我们使用 StatusLineComponent
- `clipboard-image.ts` — 剪贴板在 `@f5xc-salesdemos/pi-natives` N-API 模块中
- GitHub 工作流文件 — 我们有自己的 CI
- `models.generated.ts` — 自动生成的，在本地重新生成（改为 models.json）

### 我们新增的功能（保留这些）

这些存在于我们的 fork 中但不在上游。**永远不要覆盖：**

- 交互模式中的 `StatusLineComponent`
- 带会话亲和性的多凭证认证
- 基于能力的发现系统（`defineCapability`、`registerProvider`、`loadCapability`、`skillCapability` 等）
- MCP/Exa/SSH 集成
- 格式化保存的 LSP 直写
- Bash 拦截（`checkBashInterception`）
- 读取工具中的模糊路径建议
