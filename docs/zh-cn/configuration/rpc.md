---
title: RPC 协议参考
description: 用于 xcsh 组件间进程通信的 JSON-RPC 协议参考。
sidebar:
  order: 5
  label: RPC 协议
i18n:
  sourceHash: b4a3ddaf08ab
  translator: machine
---

# RPC 协议参考

RPC 模式将编程代理作为基于 stdio 的换行符分隔 JSON 协议运行。

- **stdin**：命令（`RpcCommand`）和扩展 UI 响应
- **stdout**：命令响应（`RpcResponse`）、会话/代理事件、扩展 UI 请求

主要实现：

- `src/modes/rpc/rpc-mode.ts`
- `src/modes/rpc/rpc-types.ts`
- `src/session/agent-session.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`

## 启动

```bash
xcsh --mode rpc [regular CLI options]
```

行为说明：

- `@file` CLI 参数在 RPC 模式下会被拒绝。
- RPC 模式默认禁用自动会话标题生成，以避免额外的模型调用。
- RPC 模式会将影响工作流的 `todo.*`、`task.*` 和 `async.*` 设置重置为内置默认值，而不是继承用户的覆盖配置。
- 进程以 JSONL 格式读取 stdin（`readJsonl(Bun.stdin.stream())`）。
- 当 stdin 关闭时，进程以退出码 `0` 退出。
- 响应/事件以每行一个 JSON 对象的形式写入。

## 传输与帧格式

每一帧是一个 JSON 对象后跟 `\n`。

除对象本身的结构外，没有额外的封装。

### 出站帧类别（stdout）

1. `RpcResponse`（`{ type: "response", ... }`）
2. `AgentSessionEvent` 对象（`agent_start`、`message_update` 等）
3. `RpcExtensionUIRequest`（`{ type: "extension_ui_request", ... }`）
4. 扩展错误（`{ type: "extension_error", extensionPath, event, error }`）

### 入站帧类别（stdin）

1. `RpcCommand`
2. `RpcExtensionUIResponse`（`{ type: "extension_ui_response", ... }`）

## 请求/响应关联

所有命令接受可选的 `id?: string`。

- 如果提供了 id，正常的命令响应会回显相同的 `id`。
- `RpcClient` 依赖此机制进行待处理请求的解析。

运行时的重要边界行为：

- 未知命令的响应会以 `id: undefined` 发出（即使请求中包含了 `id`）。
- 输入循环中的解析/处理异常会发出 `command: "parse"`，`id: undefined`。
- `prompt` 和 `abort_and_prompt` 会返回即时成功响应，如果异步提示调度失败，之后可能会发出带有**相同** id 的错误响应。

## 命令模式（规范定义）

`RpcCommand` 在 `src/modes/rpc/rpc-types.ts` 中定义：

### 提示

- `{ id?, type: "prompt", message: string, images?: ImageContent[], streamingBehavior?: "steer" | "followUp" }`
- `{ id?, type: "steer", message: string, images?: ImageContent[] }`
- `{ id?, type: "follow_up", message: string, images?: ImageContent[] }`
- `{ id?, type: "abort" }`
- `{ id?, type: "abort_and_prompt", message: string, images?: ImageContent[] }`
- `{ id?, type: "new_session", parentSession?: string }`

### 状态

- `{ id?, type: "get_state" }`
- `{ id?, type: "set_todos", phases: TodoPhase[] }`
- `{ id?, type: "set_host_tools", tools: RpcHostToolDefinition[] }`

### 模型

- `{ id?, type: "set_model", provider: string, modelId: string }`
- `{ id?, type: "cycle_model" }`
- `{ id?, type: "get_available_models" }`

### 思考

- `{ id?, type: "set_thinking_level", level: ThinkingLevel }`
- `{ id?, type: "cycle_thinking_level" }`

### 队列模式

- `{ id?, type: "set_steering_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_follow_up_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_interrupt_mode", mode: "immediate" | "wait" }`

### 压缩

- `{ id?, type: "compact", customInstructions?: string }`
- `{ id?, type: "set_auto_compaction", enabled: boolean }`

### 重试

- `{ id?, type: "set_auto_retry", enabled: boolean }`
- `{ id?, type: "abort_retry" }`

### Bash

- `{ id?, type: "bash", command: string }`
- `{ id?, type: "abort_bash" }`

### 会话

- `{ id?, type: "get_session_stats" }`
- `{ id?, type: "export_html", outputPath?: string }`
- `{ id?, type: "switch_session", sessionPath: string }`
- `{ id?, type: "branch", entryId: string }`
- `{ id?, type: "get_branch_messages" }`
- `{ id?, type: "get_last_assistant_text" }`
- `{ id?, type: "set_session_name", name: string }`

### 消息

- `{ id?, type: "get_messages" }`

## 响应模式

所有命令结果使用 `RpcResponse`：

- 成功：`{ id?, type: "response", command: <command>, success: true, data?: ... }`
- 失败：`{ id?, type: "response", command: string, success: false, error: string }`

数据载荷因命令而异，在 `rpc-types.ts` 中定义。

### `get_state` 载荷

```json
{
  "model": { "provider": "...", "id": "..." },
  "thinkingLevel": "off|minimal|low|medium|high|xhigh",
  "isStreaming": false,
  "isCompacting": false,
  "steeringMode": "all|one-at-a-time",
  "followUpMode": "all|one-at-a-time",
  "interruptMode": "immediate|wait",
  "sessionFile": "...",
  "sessionId": "...",
  "sessionName": "...",
  "autoCompactionEnabled": true,
  "messageCount": 0,
  "queuedMessageCount": 0,
  "todoPhases": [
    {
      "id": "phase-1",
      "name": "Todos",
      "tasks": [
        {
          "id": "task-1",
          "content": "Map the tool surface",
          "status": "in_progress"
        }
      ]
    }
  ]
}
```

### `set_todos` 载荷

替换当前会话的内存中待办事项状态，并返回规范化的阶段列表：

```json
{
  "id": "req_2",
  "type": "set_todos",
  "phases": [
    {
      "id": "phase-1",
      "name": "Evaluation",
      "tasks": [
        {
          "id": "task-1",
          "content": "Map the read tool surface",
          "status": "in_progress"
        },
        {
          "id": "task-2",
          "content": "Exercise edit operations",
          "status": "pending"
        }
      ]
    }
  ]
}
```

这对于希望在第一个提示之前预设计划的宿主程序非常有用。

### `set_host_tools` 载荷

替换当前 RPC 服务器可能通过 stdio 回调的宿主拥有的工具集：

```json
{
  "id": "req_3",
  "type": "set_host_tools",
  "tools": [
    {
      "name": "echo_host",
      "label": "Echo Host",
      "description": "Echo a value from the embedding host",
      "parameters": {
        "type": "object",
        "properties": {
          "message": { "type": "string" }
        },
        "required": ["message"],
        "additionalProperties": false
      }
    }
  ]
}
```

响应载荷为：

```json
{
  "toolNames": ["echo_host"]
}
```

这些工具会在下次模型调用之前添加到活跃会话的工具注册表中。重新发送 `set_host_tools` 会替换之前的宿主拥有的工具集。

## 事件流模式

RPC 模式转发来自 `AgentSession.subscribe(...)` 的 `AgentSessionEvent` 对象。

常见事件类型：

- `agent_start`、`agent_end`
- `turn_start`、`turn_end`
- `message_start`、`message_update`、`message_end`
- `tool_execution_start`、`tool_execution_update`、`tool_execution_end`
- `auto_compaction_start`、`auto_compaction_end`
- `auto_retry_start`、`auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`
- `todo_auto_clear`

扩展运行器错误作为单独的事件发出：

```json
{ "type": "extension_error", "extensionPath": "...", "event": "...", "error": "..." }
```

`message_update` 在 `assistantMessageEvent` 中包含流式增量数据（文本/思考/工具调用增量）。

## 提示/队列并发与排序

这是最重要的操作行为。

### 即时确认 vs 完成

`prompt` 和 `abort_and_prompt` 会**立即确认**：

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
```

这意味着：

- 命令接受 != 运行完成
- 最终完成通过 `agent_end` 观察

### 流式传输期间

`AgentSession.prompt()` 在活跃流式传输期间需要 `streamingBehavior`：

- `"steer"` => 排队的引导消息（中断路径）
- `"followUp"` => 排队的后续消息（回合后路径）

如果在流式传输期间省略，提示将失败。

### 队列默认值

来自编程代理设置模式（`packages/coding-agent/src/config/settings-schema.ts`）：

- `steeringMode`：`"one-at-a-time"`
- `followUpMode`：`"one-at-a-time"`
- `interruptMode`：`"wait"`

### 模式语义

- `set_steering_mode` / `set_follow_up_mode`
  - `"one-at-a-time"`：每个回合出队一条排队消息
  - `"all"`：一次性出队整个队列
- `set_interrupt_mode`
  - `"immediate"`：工具执行在工具调用之间检查引导；待处理的引导可以中止回合中剩余的工具调用
  - `"wait"`：将引导推迟到回合完成

## 扩展 UI 子协议

RPC 模式中的扩展使用请求/响应 UI 帧。

### 出站请求

`RpcExtensionUIRequest`（`type: "extension_ui_request"`）方法：

- `select`、`confirm`、`input`、`editor`
- `notify`、`setStatus`、`setWidget`、`setTitle`、`set_editor_text`

运行时说明：

- RPC 模式下自动会话标题生成被禁用，`setTitle` UI 请求默认也会被抑制，因为大多数宿主没有有意义的终端标题界面。设置 `PI_RPC_EMIT_TITLE=1` 可重新启用该 UI 事件。

示例：

```json
{ "type": "extension_ui_request", "id": "123", "method": "confirm", "title": "Confirm", "message": "Continue?", "timeout": 30000 }
```

### 入站响应

`RpcExtensionUIResponse`（`type: "extension_ui_response"`）：

- `{ type: "extension_ui_response", id: string, value: string }`
- `{ type: "extension_ui_response", id: string, confirmed: boolean }`
- `{ type: "extension_ui_response", id: string, cancelled: true }`

如果对话框有超时设置，RPC 模式会在超时/中止触发时解析为默认值。

## 宿主工具子协议

RPC 宿主可以通过发送 `set_host_tools` 向代理暴露自定义工具，然后通过相同的传输通道处理执行请求。

### 出站请求

当代理希望宿主执行其中一个工具时，RPC 模式会发出：

```json
{
  "type": "host_tool_call",
  "id": "host_1",
  "toolCallId": "toolu_123",
  "toolName": "echo_host",
  "arguments": { "message": "hello" }
}
```

如果工具执行后来被中止，RPC 模式会发出：

```json
{
  "type": "host_tool_cancel",
  "id": "host_cancel_1",
  "targetId": "host_1"
}
```

### 入站更新和完成

宿主可以选择性地流式传输进度：

```json
{
  "type": "host_tool_update",
  "id": "host_1",
  "partialResult": {
    "content": [{ "type": "text", "text": "working" }]
  }
}
```

完成使用：

```json
{
  "type": "host_tool_result",
  "id": "host_1",
  "result": {
    "content": [{ "type": "text", "text": "done" }]
  }
}
```

在 `host_tool_result` 上设置 `isError: true` 可将返回的内容作为工具错误呈现。

## 错误模型与可恢复性

### 命令级失败

失败为 `success: false`，附带字符串 `error`。

```json
{ "id": "req_2", "type": "response", "command": "set_model", "success": false, "error": "Model not found: provider/model" }
```

### 可恢复性预期

- 大多数命令失败是可恢复的；进程保持存活。
- 格式错误的 JSONL / 解析循环异常会发出 `parse` 错误响应并继续读取后续行。
- 空的 `set_session_name` 会被拒绝（`Session name cannot be empty`）。
- 具有未知 `id` 的扩展 UI 响应会被忽略。
- 进程终止条件为 stdin 关闭或扩展触发的显式关闭。

## 简明命令流程

### 1) 提示和流式传输

stdin：

```json
{ "id": "req_1", "type": "prompt", "message": "Summarize this repo" }
```

stdout 序列（典型）：

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
{ "type": "agent_start" }
{ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "delta": "..." }, "message": { "role": "assistant", "content": [] } }
{ "type": "agent_end", "messages": [] }
```

### 2) 在流式传输期间使用显式队列策略提示

stdin：

```json
{ "id": "req_2", "type": "prompt", "message": "Also include risks", "streamingBehavior": "followUp" }
```

### 3) 检查和调整队列行为

stdin：

```json
{ "id": "q1", "type": "get_state" }
{ "id": "q2", "type": "set_steering_mode", "mode": "all" }
{ "id": "q3", "type": "set_interrupt_mode", "mode": "wait" }
```

### 4) 扩展 UI 往返

stdout：

```json
{ "type": "extension_ui_request", "id": "ui_7", "method": "input", "title": "Branch name", "placeholder": "feature/..." }
```

stdin：

```json
{ "type": "extension_ui_response", "id": "ui_7", "value": "feature/rpc-host" }
```

## 关于 `RpcClient` 辅助工具的说明

`src/modes/rpc/rpc-client.ts` 是一个便捷封装，而非协议定义。

当前辅助工具特性：

- 生成 `bun <cliPath> --mode rpc` 进程
- 通过生成的 `req_<n>` id 关联响应
- 仅将已识别的 `AgentEvent` 类型分发给监听器
- 通过 `setCustomTools()` 支持宿主拥有的自定义工具，并自动处理 `host_tool_call` / `host_tool_cancel`
- **未**为每个协议命令暴露辅助方法（例如，`set_interrupt_mode` 和 `set_session_name` 存在于协议类型中，但未作为专用方法封装）

如果需要完整的协议覆盖，请使用原始协议帧。
