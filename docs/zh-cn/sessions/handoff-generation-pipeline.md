---
title: 交接生成流水线
description: 用于创建可移植会话摘要以实现团队协作的交接生成流水线。
sidebar:
  order: 8
  label: 交接流水线
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# `/handoff` 生成流水线

本文档描述了编程代理如何实现 `/handoff`：触发路径、生成提示词、完成捕获、会话切换和上下文重新注入。

## 范围

涵盖内容：

- 交互式 `/handoff` 命令调度
- `AgentSession.handoff()` 生命周期和状态转换
- 交接输出如何从助手输出中捕获
- 旧/新会话如何以不同方式持久化交接数据
- 成功、取消和失败时的 UI 行为

不涵盖内容：

- 通用树导航/分支内部实现
- 非交接会话命令（`/new`、`/fork`、`/resume`）

## 实现文件

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## 触发路径

1. `/handoff` 在内置斜杠命令元数据（`slash-commands.ts`）中声明，带有可选的内联提示：`[focus instructions]`。
2. 在交互式输入处理（`InputController`）中，匹配 `/handoff` 或 `/handoff ...` 的提交文本会在正常提示词提交之前被拦截。
3. 编辑器被清空，并调用 `handleHandoffCommand(customInstructions?)`。
4. `CommandController.handleHandoffCommand` 使用当前条目执行预检防护：
   - 统计 `type === "message"` 的条目数量。
   - 如果 `< 2`，则发出警告：`Nothing to hand off (no messages yet)` 并返回。

同样的最低内容防护也存在于 `AgentSession.handoff()` 内部，若违反条件则抛出异常。这在 UI 层和会话层都进行了重复的安全检查。

## 端到端生命周期

### 1) 开始交接生成

`AgentSession.handoff(customInstructions?)`：

- 读取当前分支条目（`sessionManager.getBranch()`）
- 验证最低消息数量（`>= 2`）
- 创建 `#handoffAbortController`
- 构建一个固定的内联提示词，请求生成结构化的交接文档（`Goal`、`Constraints & Preferences`、`Progress`、`Key Decisions`、`Critical Context`、`Next Steps`）
- 如果提供了自定义指令，则追加 `Additional focus: ...`

提示词通过以下方式发送：

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` 防止对此内部指令负载进行斜杠/提示模板展开。

### 2) 捕获完成结果

在发送提示词之前，`handoff()` 订阅会话事件并等待 `agent_end`。

在 `agent_end` 时，它通过向后扫描最近的 `assistant` 消息从代理状态中提取交接文本，然后使用 `\n` 连接所有 `type === "text"` 的 `content` 块。

重要的提取假设：

- 仅使用文本块；非文本内容被忽略。
- 假设最新的助手消息对应于交接生成。
- 不解析 markdown 章节也不验证格式合规性。
- 如果助手输出没有文本块，交接被视为缺失。

### 3) 取消检查

当以下任一条件成立时，`handoff()` 返回 `undefined`：

- 没有捕获到交接文本，或
- `#handoffAbortController.signal.aborted` 为 true

它始终在 `finally` 中清除 `#handoffAbortController`。

### 4) 新会话创建

如果文本已捕获且未被中止：

1. 刷新当前会话写入器（`sessionManager.flush()`）
2. 启动全新会话（`sessionManager.newSession()`）
3. 重置内存中的代理状态（`agent.reset()`）
4. 将 `agent.sessionId` 重新绑定到新会话 ID
5. 清除排队的上下文数组（`#steeringMessages`、`#followUpMessages`、`#pendingNextTurnMessages`）
6. 重置待办提醒计数器

`newSession()` 创建一个新的头部和空的条目列表（叶节点重置为 `null`）。在交接路径中，不传递 `parentSession`。

### 5) 交接上下文注入

生成的交接文档被包装并作为 `custom_message` 条目追加到新会话中：

```text
<handoff-context>
...handoff text...
</handoff-context>

The above is a handoff document from a previous session. Use this context to continue the work seamlessly.
```

插入调用：

```ts
this.sessionManager.appendCustomMessageEntry("handoff", handoffContent, true);
```

语义：

- `customType`：`"handoff"`
- `display`：`true`（在 TUI 重建中可见）
- 条目类型：`custom_message`（参与 LLM 上下文）

### 6) 重建活跃代理上下文

注入后：

1. `sessionManager.buildSessionContext()` 解析当前叶节点的消息列表
2. `agent.replaceMessages(sessionContext.messages)` 使注入的交接消息成为活跃上下文
3. 方法返回 `{ document: handoffText }`

此时，新会话中活跃的 LLM 上下文包含注入的交接消息，而不是旧的对话记录。

## 持久化模型：旧会话 vs 新会话

### 旧会话

在生成过程中，正常的消息持久化保持活跃。助手的交接响应作为常规 `message` 条目在 `message_end` 时被持久化。

结果：原始会话包含可见的生成交接内容，作为历史对话记录的一部分。

### 新会话

会话重置后，交接作为 `custom_message` 持久化，`customType: "handoff"`。

`buildSessionContext()` 通过 `createCustomMessage(...)` 将此条目转换为运行时自定义/用户上下文消息，因此它会被包含在新会话的后续提示中。

## 控制器/UI 行为

`CommandController.handleHandoffCommand` 行为：

- 调用 `await session.handoff(customInstructions)`
- 如果结果为 `undefined`：`showError("Handoff cancelled")`
- 成功时：
  - `rebuildChatFromMessages()`（加载新会话上下文，包括注入的交接内容）
  - 使状态栏和编辑器顶部边框失效
  - 重新加载待办事项
  - 追加成功聊天行：`New session started with handoff context`
- 发生异常时：
  - 如果消息为 `"Handoff cancelled"` 或错误名称为 `AbortError`：`showError("Handoff cancelled")`
  - 否则：`showError("Handoff failed: <message>")`
- 结束时请求渲染

## 取消语义（当前行为）

### 会话级取消原语

`AgentSession` 暴露：

- `abortHandoff()` → 中止 `#handoffAbortController`
- `isGeneratingHandoff` → 控制器存在时为 true

当使用此中止路径时，交接订阅者会以 `Error("Handoff cancelled")` 拒绝，命令控制器将其映射为取消 UI。

### 交互式 `/handoff` 路径的限制

在当前的交互式控制器连接中，`/handoff` 不会安装调用 `abortHandoff()` 的专用 Escape 处理程序（不同于压缩/分支摘要路径临时覆盖 `editor.onEscape` 的做法）。

实际影响：

- 存在会话级取消支持，但在 `/handoff` 命令路径中没有交接特定的快捷键绑定。
- 用户中断仍可能通过更广泛的代理中止路径发生，但这与 `abortHandoff()` 使用的显式取消通道不同。

## 中止 vs 失败的交接

当前 UI 分类：

- **中止/取消**
  - `abortHandoff()` 路径触发 `"Handoff cancelled"`，或
  - 抛出 `AbortError`
  - UI 显示 `Handoff cancelled`

- **失败**
  - 来自 `handoff()` / 提示流水线的任何其他抛出错误（模型/API 验证错误、运行时异常等）
  - UI 显示 `Handoff failed: ...`

额外细微差别：如果生成完成但未提取到文本，`handoff()` 返回 `undefined`，控制器当前报告为**取消**，而非**失败**。

## 短会话和最低内容防护

两个防护措施防止低信号交接：

- UI 层（`handleHandoffCommand`）：对 `< 2` 条消息条目发出警告并提前返回
- 会话层（`handoff()`）：以错误形式抛出相同条件

这避免了使用空的/接近空的交接上下文创建新会话。

## 状态转换摘要

高层状态流程：

1. 交互式斜杠命令被拦截
2. 预检消息数量防护
3. 创建 `#handoffAbortController`（`isGeneratingHandoff = true`）
4. 提交内部交接提示词（在聊天中作为正常助手生成可见）
5. 在 `agent_end` 时，提取最后的助手文本
6. 如果缺失/中止 → 返回 `undefined` 或取消错误路径
7. 如果存在：
   - 刷新旧会话
   - 创建新的空会话
   - 重置运行时队列/计数器
   - 追加 `custom_message(handoff)`
   - 重建并替换活跃代理消息
8. 控制器重建聊天 UI 并宣布成功
9. 清除 `#handoffAbortController`（`isGeneratingHandoff = false`）

## 已知假设和限制

- 交接提取是启发式的："最后的助手文本块"；没有结构验证。
- 没有硬性检查生成的 markdown 是否遵循请求的章节格式。
- 缺失的提取文本在控制器 UX 中被报告为取消。
- `/handoff` 交互式流程目前缺少专用的 Escape→`abortHandoff()` 绑定。
- 此路径未设置新会话的谱系元数据（`parentSession`）。
