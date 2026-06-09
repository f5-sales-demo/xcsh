---
title: 会话操作：导出、转储、分享、分叉、恢复
description: 用于导出、分享、分叉和恢复对话的会话操作。
sidebar:
  order: 3
  label: 操作
i18n:
  sourceHash: e3c210b29c3e
  translator: machine
---

# 会话操作：export、dump、share、fork、resume/continue

本文档描述了当前实现中会话导出/分享/分叉/恢复操作的操作者可见行为。

## 实现文件

- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/export/html/index.ts`](../../packages/coding-agent/src/export/html/index.ts)
- [`../src/export/custom-share.ts`](../../packages/coding-agent/src/export/custom-share.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)

## 操作矩阵

| 操作 | 入口路径 | 会话变更 | 会话文件创建/切换 | 输出产物 |
|---|---|---|---|---|
| `/dump` | 交互式斜杠命令 | 否 | 否 | 剪贴板文本 |
| `/export [path]` | 交互式斜杠命令 | 否 | 否 | HTML 文件 |
| `--export <session.jsonl> [outputPath]` | CLI 启动快速路径 | 无运行时会话变更 | 无活跃会话；读取目标文件 | HTML 文件 |
| `/share` | 交互式斜杠命令 | 否 | 否 | 临时 HTML + 分享 URL/gist |
| `/fork` | 交互式斜杠命令 | 是（活跃会话身份变更） | 创建新会话文件并将当前会话切换至该文件（仅持久化模式） | 存在时将产物目录复制到新会话命名空间 |
| `/resume` | 交互式斜杠命令 | 是（活跃的内存状态被替换） | 切换到选定的已有会话文件 | 无 |
| `--resume` | CLI 启动（选择器） | 会话创建后变更 | 打开选定的已有会话文件 | 无 |
| `--resume <id\|path>` | CLI 启动 | 会话创建后变更 | 打开已有会话；跨项目情况可分叉到当前项目 | 无 |
| `--continue` | CLI 启动 | 会话创建后变更 | 打开终端面包屑或最近的会话；如果不存在则创建新会话 | 无 |

## 导出和转储

### `/export [outputPath]`（交互式）

流程：

1. `InputController` 将 `/export...` 路由到 `CommandController.handleExportCommand`。
2. 命令按空白字符分割，仅使用 `/export` 后的第一个参数作为 `outputPath`。
3. `AgentSession.exportToHtml()` 调用 `exportSessionToHtml(sessionManager, state, { outputPath, themeName })`。
4. 成功后，UI 显示路径并在浏览器中打开文件。

行为细节：

- `--copy`、`clipboard` 和 `copy` 参数会被明确拒绝，并显示警告建议使用 `/dump`。
- 导出嵌入会话头部/条目/叶节点以及来自代理状态的当前 `systemPrompt` 和工具描述。
- 导出期间不会追加任何会话条目。

注意事项：

- 参数解析基于空白字符（`text.split(/\s+/)`），因此带空格的引号路径不会被此命令路径保留为单个路径。

### `--export <inputSessionFile> [outputPath]`（CLI）

`main.ts` 中的流程：

1. 在交互式/会话启动之前提前处理。
2. 调用 `exportFromFile(inputPath, outputPath?)`。
3. `SessionManager.open(inputPath)` 加载条目，然后生成并写入 HTML。
4. 进程打印 `Exported to: ...` 后退出。

行为细节：

- 缺少输入文件时显示 `File not found: <path>`。
- 此路径不会创建 `AgentSession`，也不会变更任何正在运行的会话。

### `/dump`（交互式剪贴板导出）

流程：

1. `CommandController.handleDumpCommand()` 调用 `session.formatSessionAsText()`。
2. 如果返回空字符串，报告 `No messages to dump yet.`
3. 否则通过原生 `copyToClipboard` 复制到剪贴板。

转储内容包括：

- 系统提示词
- 活跃模型/思考级别
- 工具定义 + 参数
- 用户/助手消息
- 思考块和工具调用
- 工具结果和执行块（`excludeFromContext` 的 bash/python 条目除外）
- 自定义/钩子/文件提及/分支摘要/压缩摘要条目

转储不会对会话持久化做任何更改。

## 分享

`/share` 仅限交互式使用，始终从将当前会话导出到临时 HTML 文件开始。

### 阶段 1：临时导出

- 临时文件路径：`${os.tmpdir()}/${Snowflake.next()}.html`
- 使用 `session.exportToHtml(tmpFile)`
- 如果导出失败（特别是内存会话），分享以错误结束。

### 阶段 2：自定义分享处理器（如果存在）

`loadCustomShare()` 检查 `~/.xcsh/agent` 中第一个存在的候选文件：

- `share.ts`
- `share.js`
- `share.mjs`

要求：

- 模块必须默认导出一个函数 `(htmlPath) => Promise<CustomShareResult | string | undefined>`。

如果存在且有效：

- UI 进入 `Sharing...` 加载状态。
- 处理器结果解释：
  - 字符串 => 视为 URL，显示并打开
  - 对象 => 显示 `url` 和/或 `message`；打开 `url`
  - `undefined`/假值 => 通用的 `Session shared`
- 完成后删除临时文件。

关键回退行为：

- 如果自定义处理器存在但加载失败，命令报错并返回。
- 如果自定义处理器执行并抛出异常，命令报错并返回。
- 在两种失败情况下，**不会**回退到 GitHub gist。
- 仅在不存在自定义分享脚本时才进行 Gist 回退。

### 阶段 3：默认 gist 回退

仅在未找到自定义分享处理器时：

1. 验证 `gh auth status`。
2. 显示 `Creating gist...` 加载状态。
3. 运行 `gh gist create --public=false <tmpFile>`。
4. 解析 gist URL，提取 gist id，构建预览 URL `https://gistpreview.github.io/?<id>`。
5. 显示预览和 gist 两个 URL；打开预览。

分享中的取消/中止语义：

- 加载器有 `onAbort` 钩子，用于恢复编辑器 UI 并报告 `Share cancelled`。
- 在此代码路径中，底层 `gh gist create` 命令未传递中止信号；取消是 UI 级别的，在命令返回后检查。

## 分叉

`/fork` 从当前会话创建新会话并切换活跃会话身份。

### 前置条件和即时守卫

- 如果代理正在流式传输，`/fork` 会被拒绝并显示警告。
- 操作前清除 UI 状态/加载指示器。

### 会话级别流程

`AgentSession.fork()`：

1. 发出 `session_before_switch` 事件，`reason: "fork"`（可取消）。
2. 刷新待写入数据。
3. 调用 `SessionManager.fork()`。
4. 将产物目录从旧会话命名空间复制到新命名空间（尽力而为；非 ENOENT 的复制失败会被记录日志，不视为致命错误）。
5. 更新 `agent.sessionId`。
6. 发出 `session_switch` 事件，`reason: "fork"`。

`SessionManager.fork()` 行为：

- 需要持久化模式和已有的会话文件。
- 创建新的会话 id 和新的 JSONL 文件路径。
- 重写头部信息：
  - 新的 `id`
  - 新的时间戳
  - `cwd` 不变
  - `parentSession` 设置为上一个会话 id
- 新文件中保留所有非头部条目不变。

### 非持久化行为

- 内存会话管理器从 `fork()` 返回 `undefined`。
- `AgentSession.fork()` 返回 `false`。
- UI 报告 `Fork failed (session not persisted or cancelled)`。

## 恢复和继续

## 交互式 `/resume`

流程：

1. 打开通过 `SessionManager.list(currentCwd, currentSessionDir)` 填充的会话选择器。
2. 选择后，`SelectorController.handleResumeSession(sessionPath)` 调用 `session.switchSession(sessionPath)`。
3. UI 清除/重建聊天和待办事项，然后报告 `Resumed session`。

注意：

- 此选择器仅列出当前会话目录范围内的会话。
- 不使用全局跨项目搜索。

## CLI `--resume`

### `--resume`（无值）

- `main.ts` 列出当前 cwd/sessionDir 的会话并打开选择器。
- 在会话创建前使用 `SessionManager.open(selectedPath)` 打开选定的路径。

### `--resume <value>`

`createSessionManager()` 解析顺序：

1. 如果值看起来像路径（`/`、`\` 或 `.jsonl`），直接打开。
2. 否则视为 id 前缀：
   - 搜索当前范围（`SessionManager.list(cwd, sessionDir)`）
   - 如果未找到且没有显式 `sessionDir`，搜索全局（`SessionManager.listAll()`）

跨项目 id 匹配行为：

- 如果匹配的会话 cwd 与当前 cwd 不同，CLI 会询问：
  - `Session found in different project ... Fork into current directory? [y/N]`
- 选择是：`SessionManager.forkFrom(match.path, cwd, sessionDir)` 创建新的本地分叉文件。
- 选择否/非 TTY 默认值：命令报错。

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)`：

1. 为当前 cwd 解析会话目录。
2. 首先读取终端范围的面包屑。
3. 回退到最近修改的会话文件。
4. 打开找到的会话；如果不存在，则创建新会话。

这是仅在启动时的行为；没有交互式 `/continue` 斜杠命令。

## 会话切换如何实际变更运行时状态

`AgentSession.switchSession(sessionPath)` 执行恢复类操作使用的运行时转换：

1. 发出 `session_before_switch` 事件，`reason: "resume"` 和 `targetSessionFile`（可取消）。
2. 断开代理事件订阅并中止进行中的工作。
3. 清除排队的引导/跟进/下一轮消息。
4. 刷新当前会话管理器的写入。
5. `sessionManager.setSessionFile(sessionPath)` 并更新 `agent.sessionId`。
6. 从加载的条目构建会话上下文。
7. 发出 `session_switch` 事件，`reason: "resume"`。
8. 从上下文替换代理消息。
9. 恢复模型（如果在当前注册表中可用）。
10. 恢复或初始化思考级别。
11. 重新连接代理事件订阅。

`switchSession()` 本身不会创建新的会话文件。

## 事件发射和取消点

### 切换/分叉生命周期钩子

对于 `newSession`、`fork` 和 `switchSession`：

- 前置事件：`session_before_switch`
  - 原因：`new`、`fork`、`resume`
  - 可通过返回 `{ cancel: true }` 取消
- 后置事件：`session_switch`
  - 相同的原因集合
  - 包含 `previousSessionFile`

`ExtensionRunner.emit()` 在第一个取消的前置事件结果时提前返回。

### 自定义工具 `onSession` 行为

SDK 桥接将扩展会话事件传递给自定义工具的 `onSession` 回调：

- `session_switch` -> `onSession({ reason: "switch", previousSessionFile })`
- `session_branch` -> `reason: "branch"`
- `session_start` -> `reason: "start"`
- `session_tree` -> `reason: "tree"`
- `session_shutdown` -> `reason: "shutdown"`

这些回调是观察性的；它们不会取消切换/分叉。

### 与本文档相关的其他取消面

- `/fork` 在流式传输期间被阻止（用户必须先等待/中止当前响应）。
- `/resume` 选择器可通过用户关闭选择器来取消。
- 跨项目 `--resume <id>` 可通过拒绝分叉提示来取消。
- `/share` 在 gist 流程中有 UI 中止路径（`Share cancelled`）；在此代码路径中不会为 `gh gist create` 连接进程终止语义。

## 非持久化（内存）会话行为

当使用 `SessionManager.inMemory()`（`--no-session`）创建会话管理器时：

- 会话文件路径不存在。
- `/export` 和 `/share` 失败，显示 `Cannot export in-memory session to HTML`（传播到命令错误 UI）。
- `/fork` 失败，因为 `SessionManager.fork()` 需要持久化。
- `/dump` 仍然有效，因为它序列化内存中的代理状态。
- 如果设置了 `--no-session`，CLI 的 resume/continue 语义将被绕过，因为管理器创建会立即返回内存模式。

## 已知实现注意事项（基于当前代码）

- `SelectorController.handleResumeSession()` 不检查 `session.switchSession(...)` 的布尔返回值；被钩子取消的切换仍可能继续执行 UI "Resumed session" 的重绘/状态路径。
- `/share` 自定义分享失败不会降级到默认 gist 回退；它们会以错误终止命令。
- `/export` 的参数标记化比较简单，不会保留带空格的引号路径。
