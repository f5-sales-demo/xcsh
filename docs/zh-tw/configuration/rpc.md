---
title: RPC 協定參考
description: 用於 xcsh 元件之間行程間通訊的 JSON-RPC 協定參考。
sidebar:
  order: 5
  label: RPC 協定
i18n:
  sourceHash: b4a3ddaf08ab
  translator: machine
---

# RPC 協定參考

RPC 模式以換行分隔的 JSON 協定透過 stdio 執行編碼代理。

- **stdin**：命令（`RpcCommand`）和擴充功能 UI 回應
- **stdout**：命令回應（`RpcResponse`）、工作階段/代理事件、擴充功能 UI 請求

主要實作：

- `src/modes/rpc/rpc-mode.ts`
- `src/modes/rpc/rpc-types.ts`
- `src/session/agent-session.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`

## 啟動

```bash
xcsh --mode rpc [regular CLI options]
```

行為注意事項：

- `@file` CLI 引數在 RPC 模式中會被拒絕。
- RPC 模式預設停用自動工作階段標題產生，以避免額外的模型呼叫。
- RPC 模式會將影響工作流程的 `todo.*`、`task.*` 和 `async.*` 設定重設為內建預設值，而非繼承使用者覆寫。
- 程序以 JSONL 方式讀取 stdin（`readJsonl(Bun.stdin.stream())`）。
- 當 stdin 關閉時，程序以代碼 `0` 退出。
- 回應/事件以每行一個 JSON 物件的方式寫入。

## 傳輸和框架

每個框架是一個單一 JSON 物件後接 `\n`。

除了物件形狀本身之外，沒有其他封裝。

### 輸出框架類別（stdout）

1. `RpcResponse`（`{ type: "response", ... }`）
2. `AgentSessionEvent` 物件（`agent_start`、`message_update` 等）
3. `RpcExtensionUIRequest`（`{ type: "extension_ui_request", ... }`）
4. 擴充功能錯誤（`{ type: "extension_error", extensionPath, event, error }`）

### 輸入框架類別（stdin）

1. `RpcCommand`
2. `RpcExtensionUIResponse`（`{ type: "extension_ui_response", ... }`）

## 請求/回應關聯

所有命令接受可選的 `id?: string`。

- 如果提供，正常命令回應會回傳相同的 `id`。
- `RpcClient` 依賴此機制進行待處理請求解析。

來自執行時期的重要邊界行為：

- 未知命令的回應會以 `id: undefined` 發出（即使請求有 `id`）。
- 輸入迴圈中的解析/處理例外會以 `command: "parse"` 和 `id: undefined` 發出。
- `prompt` 和 `abort_and_prompt` 會立即回傳成功，然後如果非同步提示排程失敗，可能會以**相同** id 發出後續錯誤回應。

## 命令結構描述（標準）

`RpcCommand` 定義在 `src/modes/rpc/rpc-types.ts`：

### 提示

- `{ id?, type: "prompt", message: string, images?: ImageContent[], streamingBehavior?: "steer" | "followUp" }`
- `{ id?, type: "steer", message: string, images?: ImageContent[] }`
- `{ id?, type: "follow_up", message: string, images?: ImageContent[] }`
- `{ id?, type: "abort" }`
- `{ id?, type: "abort_and_prompt", message: string, images?: ImageContent[] }`
- `{ id?, type: "new_session", parentSession?: string }`

### 狀態

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

### 佇列模式

- `{ id?, type: "set_steering_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_follow_up_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_interrupt_mode", mode: "immediate" | "wait" }`

### 壓縮

- `{ id?, type: "compact", customInstructions?: string }`
- `{ id?, type: "set_auto_compaction", enabled: boolean }`

### 重試

- `{ id?, type: "set_auto_retry", enabled: boolean }`
- `{ id?, type: "abort_retry" }`

### Bash

- `{ id?, type: "bash", command: string }`
- `{ id?, type: "abort_bash" }`

### 工作階段

- `{ id?, type: "get_session_stats" }`
- `{ id?, type: "export_html", outputPath?: string }`
- `{ id?, type: "switch_session", sessionPath: string }`
- `{ id?, type: "branch", entryId: string }`
- `{ id?, type: "get_branch_messages" }`
- `{ id?, type: "get_last_assistant_text" }`
- `{ id?, type: "set_session_name", name: string }`

### 訊息

- `{ id?, type: "get_messages" }`

## 回應結構描述

所有命令結果使用 `RpcResponse`：

- 成功：`{ id?, type: "response", command: <command>, success: true, data?: ... }`
- 失敗：`{ id?, type: "response", command: string, success: false, error: string }`

資料酬載依命令而異，定義在 `rpc-types.ts` 中。

### `get_state` 酬載

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

### `set_todos` 酬載

替換當前工作階段的記憶體內待辦狀態，並回傳標準化的階段列表：

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

這對於想在第一次提示之前預先設定計畫的主機很有用。

### `set_host_tools` 酬載

替換當前由主機擁有的工具集，RPC 伺服器可透過 stdio 回呼這些工具：

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

回應酬載為：

```json
{
  "toolNames": ["echo_host"]
}
```

這些工具會在下一次模型呼叫之前加入到活動工作階段的工具登錄中。重新傳送 `set_host_tools` 會替換先前的主機擁有工具集。

## 事件串流結構描述

RPC 模式從 `AgentSession.subscribe(...)` 轉發 `AgentSessionEvent` 物件。

常見事件類型：

- `agent_start`、`agent_end`
- `turn_start`、`turn_end`
- `message_start`、`message_update`、`message_end`
- `tool_execution_start`、`tool_execution_update`、`tool_execution_end`
- `auto_compaction_start`、`auto_compaction_end`
- `auto_retry_start`、`auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`
- `todo_auto_clear`

擴充功能執行器錯誤會以下列格式單獨發出：

```json
{ "type": "extension_error", "extensionPath": "...", "event": "...", "error": "..." }
```

`message_update` 在 `assistantMessageEvent` 中包含串流差異（文字/思考/工具呼叫差異）。

## 提示/佇列並行與排序

這是最重要的運作行為。

### 立即確認 vs 完成

`prompt` 和 `abort_and_prompt` 會**立即確認**：

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
```

這意味著：

- 命令接受 != 執行完成
- 最終完成透過 `agent_end` 觀察

### 串流期間

`AgentSession.prompt()` 在活動串流期間需要 `streamingBehavior`：

- `"steer"` => 排入引導訊息佇列（中斷路徑）
- `"followUp"` => 排入後續訊息佇列（回合後路徑）

如果在串流期間省略，提示會失敗。

### 佇列預設值

來自編碼代理設定結構描述（`packages/coding-agent/src/config/settings-schema.ts`）：

- `steeringMode`：`"one-at-a-time"`
- `followUpMode`：`"one-at-a-time"`
- `interruptMode`：`"wait"`

### 模式語義

- `set_steering_mode` / `set_follow_up_mode`
  - `"one-at-a-time"`：每個回合從佇列中取出一條訊息
  - `"all"`：一次取出整個佇列
- `set_interrupt_mode`
  - `"immediate"`：工具執行在工具呼叫之間檢查引導；待處理的引導可以中止回合中剩餘的工具呼叫
  - `"wait"`：延遲引導直到回合完成

## 擴充功能 UI 子協定

RPC 模式中的擴充功能使用請求/回應 UI 框架。

### 輸出請求

`RpcExtensionUIRequest`（`type: "extension_ui_request"`）方法：

- `select`、`confirm`、`input`、`editor`
- `notify`、`setStatus`、`setWidget`、`setTitle`、`set_editor_text`

執行時期注意事項：

- RPC 模式中停用自動工作階段標題產生，且 `setTitle` UI 請求預設也會被抑制，因為大多數主機沒有有意義的終端標題介面。設定 `PI_RPC_EMIT_TITLE=1` 以重新啟用此 UI 事件。

範例：

```json
{ "type": "extension_ui_request", "id": "123", "method": "confirm", "title": "Confirm", "message": "Continue?", "timeout": 30000 }
```

### 輸入回應

`RpcExtensionUIResponse`（`type: "extension_ui_response"`）：

- `{ type: "extension_ui_response", id: string, value: string }`
- `{ type: "extension_ui_response", id: string, confirmed: boolean }`
- `{ type: "extension_ui_response", id: string, cancelled: true }`

如果對話框有逾時設定，RPC 模式會在逾時/中止觸發時解析為預設值。

## 主機工具子協定

RPC 主機可以透過傳送 `set_host_tools` 向代理公開自訂工具，然後透過相同傳輸通道處理執行請求。

### 輸出請求

當代理希望主機執行其中一個工具時，RPC 模式會發出：

```json
{
  "type": "host_tool_call",
  "id": "host_1",
  "toolCallId": "toolu_123",
  "toolName": "echo_host",
  "arguments": { "message": "hello" }
}
```

如果工具執行後來被中止，RPC 模式會發出：

```json
{
  "type": "host_tool_cancel",
  "id": "host_cancel_1",
  "targetId": "host_1"
}
```

### 輸入更新和完成

主機可以選擇性地串流進度：

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

在 `host_tool_result` 上設定 `isError: true` 可將回傳的內容作為工具錯誤呈現。

## 錯誤模型與可復原性

### 命令層級失敗

失敗為 `success: false` 且帶有字串 `error`。

```json
{ "id": "req_2", "type": "response", "command": "set_model", "success": false, "error": "Model not found: provider/model" }
```

### 可復原性預期

- 大多數命令失敗是可復原的；程序保持存活。
- 格式錯誤的 JSONL / 解析迴圈例外會發出 `parse` 錯誤回應並繼續讀取後續行。
- 空的 `set_session_name` 會被拒絕（`Session name cannot be empty`）。
- 具有未知 `id` 的擴充功能 UI 回應會被忽略。
- 程序終止條件為 stdin 關閉或擴充功能觸發的明確關閉。

## 精簡命令流程

### 1) 提示並串流

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

### 2) 串流期間使用明確佇列策略提示

stdin：

```json
{ "id": "req_2", "type": "prompt", "message": "Also include risks", "streamingBehavior": "followUp" }
```

### 3) 檢視並調整佇列行為

stdin：

```json
{ "id": "q1", "type": "get_state" }
{ "id": "q2", "type": "set_steering_mode", "mode": "all" }
{ "id": "q3", "type": "set_interrupt_mode", "mode": "wait" }
```

### 4) 擴充功能 UI 往返

stdout：

```json
{ "type": "extension_ui_request", "id": "ui_7", "method": "input", "title": "Branch name", "placeholder": "feature/..." }
```

stdin：

```json
{ "type": "extension_ui_response", "id": "ui_7", "value": "feature/rpc-host" }
```

## 關於 `RpcClient` 輔助工具的注意事項

`src/modes/rpc/rpc-client.ts` 是一個便利包裝器，而非協定定義。

目前輔助工具的特性：

- 產生 `bun <cliPath> --mode rpc`
- 透過產生的 `req_<n>` id 關聯回應
- 僅將已識別的 `AgentEvent` 類型分派給監聽器
- 透過 `setCustomTools()` 支援主機擁有的自訂工具，並自動處理 `host_tool_call` / `host_tool_cancel`
- **不**為每個協定命令公開輔助方法（例如，`set_interrupt_mode` 和 `set_session_name` 存在於協定類型中，但未包裝為專用方法）

如果您需要完整的介面涵蓋範圍，請使用原始協定框架。
