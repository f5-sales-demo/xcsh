---
title: 会话切换与最近会话列表
description: 会话切换机制以及带有搜索和过滤功能的最近会话列表。
sidebar:
  order: 4
  label: 切换与最近会话
i18n:
  sourceHash: aae56130b508
  translator: machine
---

# 会话切换与最近会话列表

本文档描述了 coding-agent 如何发现最近的会话、解析 `--resume` 目标、展示会话选择器以及切换活动运行时会话。

本文侧重于当前的实现行为，包括回退路径和注意事项。

## 实现文件

- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/cli/session-picker.ts`](../../packages/coding-agent/src/cli/session-picker.ts)
- [`../src/modes/components/session-selector.ts`](../../packages/coding-agent/src/modes/components/session-selector.ts)
- [`../src/modes/controllers/selector-controller.ts`](../../packages/coding-agent/src/modes/controllers/selector-controller.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)

## 最近会话发现

### 目录作用域

`SessionManager` 默认在按 cwd 划分作用域的目录下存储会话：

- `~/.xcsh/agent/sessions/--<cwd-encoded>--/*.jsonl`

`SessionManager.list(cwd, sessionDir?)` 仅读取该目录，除非显式提供了 `sessionDir`。

### 两种具有不同载荷的列表路径

存在两种不同的列表管道：

1. `getRecentSessions(sessionDir, limit)`（欢迎/摘要视图）
   - 仅从每个文件读取 4KB 前缀（`readTextPrefix(..., 4096)`）。
   - 解析头部 + 最早的用户文本预览。
   - 返回轻量级的 `RecentSessionInfo`，包含惰性 `name` 和 `timeAgo` getter。
   - 按文件 `mtime` 降序排序。

2. `SessionManager.list(...)` / `SessionManager.listAll()`（恢复选择器和 ID 匹配）
   - 读取完整的会话文件。
   - 构建 `SessionInfo` 对象（`id`、`cwd`、`title`、`messageCount`、`firstMessage`、`allMessagesText`、时间戳）。
   - 丢弃零条 `message` 记录的会话。
   - 按 `modified` 降序排序。

### 元数据回退行为

对于最近摘要（`RecentSessionInfo`）：

- 显示名称优先级：`header.title` -> 首条用户提示 -> `header.id` -> 文件名
- 名称被截断为 40 个字符以便紧凑显示
- 从标题派生的名称中会剥离/清理控制字符和换行符

对于 `SessionInfo` 列表条目：

- `title` 为 `header.title` 或最新压缩的 `shortSummary`
- `firstMessage` 为首条用户消息文本或 `"(no messages)"`

## `--continue` 解析与终端面包屑优先级

`SessionManager.continueRecent(cwd, sessionDir?)` 按以下顺序解析目标：

1. 读取终端作用域的面包屑（`~/.xcsh/agent/terminal-sessions/<terminal-id>`）
2. 验证面包屑：
   - 当前终端可被识别
   - 面包屑的 cwd 与当前 cwd 匹配（解析路径比较）
   - 引用的文件仍然存在
3. 如果面包屑无效/缺失，回退到会话目录中按 mtime 排序的最新文件（`findMostRecentSession`）
4. 如果未找到，创建新会话

终端 ID 推导优先使用 TTY 路径，回退到基于环境变量的标识符（`KITTY_WINDOW_ID`、`TMUX_PANE`、`TERM_SESSION_ID`、`WT_SESSION`）。

面包屑写入采用尽力而为策略，不会导致致命错误。

## 启动时恢复目标解析（`main.ts`）

### `--resume <value>`

`createSessionManager(...)` 以两种模式处理字符串值的 `--resume`：

1. 类路径值（包含 `/`、`\\`，或以 `.jsonl` 结尾）
   - 直接调用 `SessionManager.open(sessionArg, parsed.sessionDir)`

2. ID 前缀值
   - 在 `SessionManager.list(cwd, sessionDir)` 中通过 `id.startsWith(sessionArg)` 查找匹配
   - 如果本地无匹配且未强制指定 `sessionDir`，尝试 `SessionManager.listAll()`
   - 使用第一个匹配项（无歧义提示）

跨项目匹配行为：

- 如果匹配的会话 cwd 与当前 cwd 不同，CLI 会提示是否分叉到当前项目
- 是 -> `SessionManager.forkFrom(...)`
- 否 -> 抛出错误（`Session "..." is in another project (...)`）

无匹配 -> 抛出错误（`Session "..." not found.`）。

### `--resume`（无值）

在初始会话管理器构建之后处理：

1. 使用 `SessionManager.list(cwd, parsed.sessionDir)` 列出本地会话
2. 如果为空：打印 `No sessions found` 并提前退出
3. 打开 TUI 选择器（`selectSession`）
4. 如果取消：打印 `No session selected` 并提前退出
5. 如果选中：`SessionManager.open(selectedPath)`

### `--continue`

直接使用 `SessionManager.continueRecent(...)`（上述面包屑优先行为）。

## 基于选择器的选择内部机制

## CLI 选择器（`src/cli/session-picker.ts`）

`selectSession(sessions)` 创建一个独立的 TUI，使用 `SessionSelectorComponent` 并仅解析一次：

- 选择 -> 解析为选中的路径
- 取消（Esc）-> 解析为 `null`
- 强制退出（Ctrl+C 路径）-> 停止 TUI 并 `process.exit(0)`

## 交互式会话内选择器（`SelectorController.showSessionSelector`）

流程：

1. 通过 `SessionManager.list(currentCwd, currentSessionDir)` 从当前会话目录获取会话
2. 使用 `showSelector(...)` 在编辑器区域挂载 `SessionSelectorComponent`
3. 回调：
   - 选择 -> 关闭选择器并调用 `handleResumeSession(sessionPath)`
   - 取消 -> 恢复编辑器并重新渲染
   - 退出 -> `ctx.shutdown()`

## 会话选择器组件行为

`SessionList` 支持：

- 方向键/翻页导航
- Enter 选择
- Esc 取消
- Ctrl+C 退出
- 跨会话 id/title/cwd/首条消息/所有消息/路径的模糊搜索

空列表渲染行为：

- 渲染一条消息而非崩溃
- 空列表时按 Enter 不执行任何操作（无回调）
- Esc/Ctrl+C 仍然有效

注意事项：UI 文本显示 `Press Tab to view all`，但此组件当前没有 Tab 处理程序，且当前接线仅列出当前作用域的会话。

## 运行时切换执行（`AgentSession.switchSession`）

`switchSession(sessionPath)` 是核心的进程内切换路径。

生命周期/状态转换：

1. 捕获 `previousSessionFile`
2. 发出 `session_before_switch` 钩子事件（`reason: "resume"`，可取消）
3. 如果被取消 -> 返回 `false` 且不进行切换
4. 断开当前代理事件流
5. 中止活动的生成/工具流程
6. 清除排队的引导/后续/下一轮消息缓冲区
7. 刷新会话写入器（`sessionManager.flush()`）以持久化待写入内容
8. `sessionManager.setSessionFile(sessionPath)`
   - 更新会话文件指针
   - 写入终端面包屑
   - 加载条目 / 迁移 / blob 解析 / 重建索引
   - 如果文件数据缺失/无效：在该路径初始化新会话并重写头部
9. 更新 `agent.sessionId`
10. 通过 `buildSessionContext()` 重建上下文
11. 发出 `session_switch` 钩子事件（`reason: "resume"`，`previousSessionFile`）
12. 用重建的上下文替换代理消息
13. 如果 `sessionContext.models.default` 可用且存在于模型注册表中，则恢复默认模型
14. 恢复思考级别：
    - 如果分支已有 `thinking_level_change`，应用保存的会话级别
    - 否则从设置中推导默认思考级别，钳制到模型能力范围，设置它，并追加新的 `thinking_level_change` 条目
15. 重新连接代理监听器并返回 `true`

## 交互式切换后的 UI 状态重建

`SelectorController.handleResumeSession` 围绕 `switchSession` 执行 UI 重置：

- 停止加载动画
- 清除状态容器
- 清除待处理消息 UI 和待处理工具映射
- 重置流式组件/消息引用
- 调用 `session.switchSession(...)`
- 清除聊天容器并从会话上下文重新渲染（`renderInitialMessages`）
- 从新会话工件重新加载待办事项
- 显示 `Resumed session`

因此，可见的对话/待办事项状态是从新会话文件重建的。

## 启动恢复与会话内切换

### 启动恢复（`--continue`、`--resume`、直接打开）

- 会话文件在 `createAgentSession(...)` 之前选择。
- `sdk.ts` 构建 `existingSession = sessionManager.buildSessionContext()`。
- 代理消息在会话创建期间恢复一次。
- 模型/思考在创建期间选择（包括恢复/回退逻辑）。
- 然后交互模式运行 `#restoreModeFromSession()` 以重新进入持久化的模式状态（当前为 plan/plan_paused）。

### 会话内切换（`/resume` 风格的选择器路径）

- 在已运行的 `AgentSession` 上使用 `AgentSession.switchSession(...)`。
- 消息/模型/思考立即就地重建。
- 发出 `session_before_switch`/`session_switch` 钩子事件。
- 刷新 UI 聊天/待办事项。
- 选择器流程中没有专门的切换后模式恢复调用；模式重新进入行为与启动时的 `#restoreModeFromSession()` 不对称。

## 失败和边界情况行为

### 取消路径

- CLI 选择器取消 -> 返回 `null`，调用者打印 `No session selected`，进程提前退出。
- 交互式选择器取消 -> 编辑器恢复，无会话更改。
- 钩子取消（`session_before_switch`）-> `switchSession()` 返回 `false`。

### 空列表路径

- CLI `--resume`（无值）：空列表打印 `No sessions found` 并退出。
- 交互式选择器：空列表渲染消息并保持可取消状态。

### 目标会话文件缺失/无效

当打开/切换到特定路径时（`setSessionFile`）：

- ENOENT -> 视为空 -> 在该精确路径初始化新会话并持久化。
- 格式错误/无效头部（或实际上不可读的解析条目）-> 视为空 -> 初始化新会话并持久化。

这是恢复行为，不是硬失败。

### 硬失败

切换/打开在真正的 I/O 失败（权限错误、重写失败等）时仍可能抛出异常，这些异常会传播给调用者。

### ID 前缀匹配注意事项

- ID 匹配使用 `startsWith` 并取排序列表中的第一个匹配项。
- 如果多个会话共享前缀，不会有歧义 UI。
- `SessionManager.list(...)` 排除零消息的会话，因此这些会话无法通过 ID 匹配/列表选择器恢复。
