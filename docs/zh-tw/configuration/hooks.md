---
title: Hooks
description: 在編程代理生命週期中，用於前/後事件自動化的 Hook 系統。
sidebar:
  order: 4
  label: Hooks
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# Hooks

本文件描述 `src/extensibility/hooks/*` 中**當前的 hook 子系統程式碼**。

## 執行時期的現況

Hook 套件（`src/extensibility/hooks/`）仍作為 API 介面被匯出並可使用，但預設的 CLI 執行時期現在初始化**擴充功能執行器**路徑。在當前的啟動流程中：

- `--hook` 被視為 `--extension` 的別名（CLI 路徑被合併至 `additionalExtensionPaths`）
- 工具由 `ExtensionToolWrapper` 包裝，而非 `HookToolWrapper`
- 上下文轉換與生命週期事件發送透過 `ExtensionRunner` 處理

因此，本文件記錄 hook 子系統的實作本身（型別／載入器／執行器／包裝器），包含舊有行為與限制。

## 主要檔案

- `src/extensibility/hooks/types.ts` — hook 上下文、事件型別與結果合約
- `src/extensibility/hooks/loader.ts` — 模組載入與 hook 探索橋接
- `src/extensibility/hooks/runner.ts` — 事件分派、命令查詢與錯誤訊號
- `src/extensibility/hooks/tool-wrapper.ts` — 前/後工具攔截包裝器
- `src/extensibility/hooks/index.ts` — 匯出／重新匯出

## Hook 模組的定義

一個 hook 模組必須預設匯出一個工廠函式：

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function hook(pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf")) {
   return { block: true, reason: "blocked by policy" };
  }
 });
}
```

該工廠函式可以：

- 透過 `pi.on(...)` 註冊事件處理器
- 透過 `pi.sendMessage(...)` 發送持久性自訂訊息
- 透過 `pi.appendEntry(...)` 持久化非 LLM 狀態
- 透過 `pi.registerCommand(...)` 註冊斜線命令
- 透過 `pi.registerMessageRenderer(...)` 註冊自訂訊息渲染器
- 透過 `pi.exec(...)` 執行 shell 命令

## 探索與載入

`discoverAndLoadHooks(configuredPaths, cwd)` 的執行步驟：

1. 從功能登錄檔載入已探索的 hooks（`loadCapability("hooks")`）
2. 附加明確設定的路徑（依絕對路徑去重）
3. 呼叫 `loadHooks(allPaths, cwd)`

`loadHooks` 接著匯入每個路徑，並期望其有一個 `default` 函式。

### 路徑解析

`loader.ts` 解析 hook 路徑的方式如下：

- 絕對路徑：直接使用
- `~` 路徑：展開主目錄
- 相對路徑：相對於 `cwd` 解析

### 重要的舊有不匹配問題

`hookCapability` 的探索提供者仍以前/後 shell 樣式的 hook 檔案為模型（例如 `.claude/hooks/pre/*`、`.xcsh/.../hooks/pre/*`）。

此處的 hook 載入器使用動態模組匯入，並要求有一個預設的 JS/TS hook 工廠函式。若探索到的 hook 路徑無法作為模組匯入，載入將失敗，並在 `LoadHooksResult.errors` 中回報。

## 事件介面

Hook 事件在 `types.ts` 中具有強型別定義。

### Session 事件

- `session_start`
- `session_before_switch` → 可回傳 `{ cancel?: boolean }`
- `session_switch`
- `session_before_branch` → 可回傳 `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_branch`
- `session_before_compact` → 可回傳 `{ cancel?: boolean; compaction?: CompactionResult }`
- `session.compacting` → 可回傳 `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }`
- `session_compact`
- `session_before_tree` → 可回傳 `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`
- `session_tree`
- `session_shutdown`

### 代理／上下文事件

- `context` → 可回傳 `{ messages?: Message[] }`
- `before_agent_start` → 可回傳 `{ message?: { customType; content; display; details } }`
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `auto_compaction_start`
- `auto_compaction_end`
- `auto_retry_start`
- `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### 工具事件（前/後模型）

- `tool_call`（執行前）→ 可回傳 `{ block?: boolean; reason?: string }`
- `tool_result`（執行後）→ 可回傳 `{ content?; details?; isError? }`

這是 hook 子系統的核心前/後攔截模型。

```text
Hook 工具攔截流程

tool_call 處理器
   │
   ├─ 任何 { block: true }？── 是 ──> 拋出錯誤（工具被封鎖）
   │
   └─ 否
      │
      ▼
   執行底層工具
      │
      ├─ 成功 ──> tool_result 處理器可覆寫 { content, details }
      │
      └─ 錯誤   ──> 發送 tool_result(isError=true) 後重新拋出原始錯誤
```

## 執行模型與變更語意

### 1) 執行前：`tool_call`

`HookToolWrapper.execute()` 在工具執行前發送 `tool_call`。

- 若任何處理器回傳 `{ block: true }`，執行停止
- 若處理器拋出錯誤，包裝器以封閉失敗模式運作並封鎖執行
- 回傳的 `reason` 將成為拋出的錯誤文字

### 2) 工具執行

若未被封鎖，底層工具正常執行。

### 3) 執行後：`tool_result`

成功後，包裝器發送 `tool_result`，包含：

- `toolName`、`toolCallId`、`input`
- `content`
- `details`
- `isError: false`

若處理器回傳覆寫值：

- `content` 可取代結果內容
- `details` 可取代結果詳細資訊

工具失敗時，包裝器發送 `isError: true` 及錯誤文字內容的 `tool_result`，然後重新拋出原始錯誤。

### Hooks 可以變更的內容

- 單次呼叫的 LLM 上下文，透過 `context`（`messages` 替換鏈）
- 成功工具呼叫的工具輸出內容／詳細資訊（`tool_result` 路徑）
- 代理啟動前注入的訊息，透過 `before_agent_start`
- 取消／自訂壓縮／樹狀行為，透過 `session_before_*` 和 `session.compacting`

### 此實作中 Hooks 無法變更的內容

- 原地修改工具輸入參數（`tool_call` 上只能封鎖／允許）
- 工具錯誤拋出後繼續執行（錯誤路徑會重新拋出）
- 包裝器行為中的最終成功／錯誤狀態（回傳的 `isError` 有型別定義，但 `HookToolWrapper` 不套用）

## 排序與衝突行為

### 探索層級的排序

功能提供者依優先權排序（較高者優先）。去重依功能鍵，以第一個為準。

對於 `hooks`，功能鍵為 `${type}:${tool}:${name}`。來自較低優先權提供者的重複項目會被標記，並從有效探索清單中排除。

### 載入順序

`discoverAndLoadHooks` 建立一個扁平的 `allPaths` 清單，依解析後的絕對路徑去重，然後 `loadHooks` 依序迭代。每個探索目錄內的檔案順序取決於 `readdir` 的輸出；hook 載入器不會額外排序。

### 執行時期處理器順序

在 `HookRunner` 內部，順序由註冊序列決定：

1. hooks 陣列順序
2. 每個 hook／事件的處理器註冊順序

依事件型別的衝突行為：

- `tool_call`：最後回傳的結果優先，除非有處理器封鎖；第一個封鎖會立即短路
- `tool_result`：最後回傳的覆寫值優先（無短路）
- `context`：鏈式處理；每個處理器接收前一個處理器的訊息輸出
- `before_agent_start`：保留第一個回傳的訊息；後續訊息被忽略
- `session_before_*`：追蹤最新回傳的結果；`cancel: true` 立即短路
- `session.compacting`：最新回傳的結果優先

命令／渲染器衝突：

- `getCommand(name)` 跨 hooks 回傳第一個匹配（先載入者優先）
- `getMessageRenderer(customType)` 回傳第一個匹配
- `getRegisteredCommands()` 回傳所有命令（不去重）

## UI 互動（`HookContext.ui`）

`HookUIContext` 包含：

- `select`、`confirm`、`input`、`editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`、`getEditorText`
- `theme` getter

`ctx.hasUI` 表示是否有可用的互動式 UI。

在沒有 UI 的情況下執行時，預設的無操作上下文行為為：

- `select/input/editor` 回傳 `undefined`
- `confirm` 回傳 `false`
- `notify`、`setStatus`、`setEditorText` 為無操作
- `getEditorText` 回傳 `""`

### 狀態列行為

透過 `ctx.ui.setStatus(key, text)` 設定的 hook 狀態文字：

- 依鍵儲存
- 依鍵名排序
- 經過清理（`\r`、`\n`、`\t` → 空格；重複空格合併）
- 合併後截斷寬度以供顯示

## 錯誤傳播與回退

### 載入時期

- 無效模組或缺少預設匯出 → 捕獲於 `LoadHooksResult.errors`
- 繼續載入其他 hooks

### 事件時期

`HookRunner.emit(...)` 對大多數事件捕獲處理器錯誤，並向監聽器發送 `HookError`（`hookPath`、`event`、`error`），然後繼續執行。

`emitToolCall(...)` 更為嚴格：其中的處理器錯誤不會被吞掉；它們會傳播至呼叫端。在 `HookToolWrapper` 中，這會封鎖工具呼叫（失效安全）。

## 實際 API 範例

### 封鎖不安全的 bash 命令

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "bash") return;
  const cmd = String(event.input.command ?? "");
  if (!cmd.includes("rm -rf")) return;

  if (!ctx.hasUI) return { block: true, reason: "rm -rf blocked (no UI)" };
  const ok = await ctx.ui.confirm("Dangerous command", `Allow: ${cmd}`);
  if (!ok) return { block: true, reason: "user denied command" };
 });
}
```

### 執行後對工具輸出進行遮蔽

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_result", async event => {
  if (event.toolName !== "read" || event.isError) return;

  const redacted = event.content.map(chunk => {
   if (chunk.type !== "text") return chunk;
   return { ...chunk, text: chunk.text.replaceAll(/API_KEY=\S+/g, "API_KEY=[REDACTED]") };
  });

  return { content: redacted };
 });
}
```

### 每次 LLM 呼叫時修改模型上下文

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### 使用命令安全的上下文方法註冊斜線命令

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.registerCommand("handoff", {
  description: "Create a new session with setup message",
  handler: async (_args, ctx) => {
   await ctx.waitForIdle();
   await ctx.newSession({
    parentSession: ctx.sessionManager.getSessionFile(),
    setup: async sm => {
     sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Continue from prior session summary." }],
      timestamp: Date.now(),
     });
    },
   });
  },
 });
}
```

## 匯出介面

`src/extensibility/hooks/index.ts` 匯出：

- 載入 API（`discoverAndLoadHooks`、`loadHooks`）
- 執行器與包裝器（`HookRunner`、`HookToolWrapper`）
- 所有 hook 型別
- `execCommand` 重新匯出

套件根目錄（`src/index.ts`）將 hook **型別**重新匯出，作為舊有相容性介面。
