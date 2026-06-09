---
title: Hooks
description: 編碼代理生命週期中用於事件前/後自動化的 Hook 系統。
sidebar:
  order: 4
  label: Hooks
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# Hooks

本文件描述 `src/extensibility/hooks/*` 中**目前的 hook 子系統程式碼**。

## 執行時期的目前狀態

hook 套件（`src/extensibility/hooks/`）仍然作為 API 介面匯出且可使用，但預設的 CLI 執行時期現在會初始化 **extension runner** 路徑。在目前的啟動流程中：

- `--hook` 被視為 `--extension` 的別名（CLI 路徑會合併到 `additionalExtensionPaths`）
- 工具由 `ExtensionToolWrapper` 包裝，而非 `HookToolWrapper`
- 上下文轉換和生命週期事件發送透過 `ExtensionRunner` 進行

因此本文件記錄的是 hook 子系統的實作本身（類型/載入器/執行器/包裝器），包括舊有行為和限制。

## 關鍵檔案

- `src/extensibility/hooks/types.ts` — hook 上下文、事件類型和結果契約
- `src/extensibility/hooks/loader.ts` — 模組載入和 hook 探索橋接
- `src/extensibility/hooks/runner.ts` — 事件分派、命令查詢、錯誤訊號
- `src/extensibility/hooks/tool-wrapper.ts` — 工具前/後攔截包裝器
- `src/extensibility/hooks/index.ts` — 匯出/重新匯出

## 什麼是 hook 模組

Hook 模組必須預設匯出一個工廠函式：

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

工廠函式可以：

- 使用 `pi.on(...)` 註冊事件處理器
- 使用 `pi.sendMessage(...)` 發送持久性自訂訊息
- 使用 `pi.appendEntry(...)` 持久化非 LLM 狀態
- 透過 `pi.registerCommand(...)` 註冊斜線命令
- 透過 `pi.registerMessageRenderer(...)` 註冊自訂訊息渲染器
- 透過 `pi.exec(...)` 執行 shell 命令

## 探索與載入

`discoverAndLoadHooks(configuredPaths, cwd)` 執行以下操作：

1. 從能力登錄檔載入探索到的 hooks（`loadCapability("hooks")`）
2. 附加明確設定的路徑（依絕對路徑去重）
3. 呼叫 `loadHooks(allPaths, cwd)`

`loadHooks` 接著匯入每個路徑，並期望有一個 `default` 函式。

### 路徑解析

`loader.ts` 解析 hook 路徑的方式：

- 絕對路徑：直接使用
- `~` 路徑：展開
- 相對路徑：相對於 `cwd` 解析

### 重要的舊有不一致

`hookCapability` 的探索提供者仍然以 shell 風格的前/後 hook 檔案為模型（例如 `.claude/hooks/pre/*`、`.xcsh/.../hooks/pre/*`）。

此處的 hook 載入器使用動態模組匯入，並要求預設匯出 JS/TS hook 工廠函式。如果探索到的 hook 路徑無法作為模組匯入，載入將失敗並回報在 `LoadHooksResult.errors` 中。

## 事件介面

Hook 事件在 `types.ts` 中具有強型別定義。

### 會話事件

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

### 代理/上下文事件

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
Hook tool interception flow

tool_call handlers
   │
   ├─ any { block: true }? ── yes ──> throw (tool blocked)
   │
   └─ no
      │
      ▼
   execute underlying tool
      │
      ├─ success ──> tool_result handlers can override { content, details }
      │
      └─ error   ──> emit tool_result(isError=true) then rethrow original error
```

## 執行模型與變異語義

### 1) 執行前：`tool_call`

`HookToolWrapper.execute()` 在工具執行前發出 `tool_call`。

- 若任何處理器回傳 `{ block: true }`，執行將停止
- 若處理器拋出例外，包裝器將以失敗關閉方式阻止執行
- 回傳的 `reason` 會成為拋出的錯誤文字

### 2) 工具執行

若未被阻止，底層工具正常執行。

### 3) 執行後：`tool_result`

成功後，包裝器發出 `tool_result`，包含：

- `toolName`、`toolCallId`、`input`
- `content`
- `details`
- `isError: false`

若處理器回傳覆寫值：

- `content` 可替換結果內容
- `details` 可替換結果詳情

工具失敗時，包裝器發出 `tool_result`，帶有 `isError: true` 和錯誤文字內容，然後重新拋出原始錯誤。

### Hook 可以變異的內容

- 透過 `context` 變異單次呼叫的 LLM 上下文（`messages` 替換鏈）
- 成功工具呼叫時的工具輸出內容/詳情（`tool_result` 路徑）
- 透過 `before_agent_start` 注入的代理前訊息
- 透過 `session_before_*` 和 `session.compacting` 的取消/自訂壓縮/樹狀行為

### 此實作中 Hook 無法變異的內容

- 原地修改工具輸入參數（`tool_call` 僅能阻止/允許）
- 拋出工具錯誤後的執行延續（錯誤路徑會重新拋出）
- 包裝器行為中的最終成功/錯誤狀態（回傳的 `isError` 有型別定義但 `HookToolWrapper` 不會套用）

## 排序與衝突行為

### 探索層級的排序

能力提供者依優先順序排列（較高者優先）。去重依據能力鍵值，先到者優先。

對於 `hooks`，能力鍵值為 `${type}:${tool}:${name}`。來自較低優先順序提供者的重複項目會被標記並從有效探索列表中排除。

### 載入順序

`discoverAndLoadHooks` 建立一個扁平的 `allPaths` 列表，依解析後的絕對路徑去重，然後 `loadHooks` 依該順序迭代。
每個探索目錄內的檔案順序取決於 `readdir` 的輸出；hook 載入器不會執行額外排序。

### 執行時期的處理器順序

在 `HookRunner` 內部，順序由註冊序列決定：

1. hooks 陣列順序
2. 每個 hook/事件的處理器註冊順序

各事件類型的衝突行為：

- `tool_call`：最後回傳的結果優先，除非處理器阻止；第一個阻止會短路
- `tool_result`：最後回傳的覆寫值優先（無短路）
- `context`：鏈式處理；每個處理器接收前一個處理器的訊息輸出
- `before_agent_start`：保留第一個回傳的訊息；後續訊息被忽略
- `session_before_*`：追蹤最後回傳的結果；`cancel: true` 立即短路
- `session.compacting`：最後回傳的結果優先

命令/渲染器衝突：

- `getCommand(name)` 回傳跨 hooks 的第一個匹配（先載入者優先）
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

`ctx.hasUI` 指示互動式 UI 是否可用。

在沒有 UI 的情況下執行時，預設的空操作上下文行為為：

- `select/input/editor` 回傳 `undefined`
- `confirm` 回傳 `false`
- `notify`、`setStatus`、`setEditorText` 為空操作
- `getEditorText` 回傳 `""`

### 狀態列行為

透過 `ctx.ui.setStatus(key, text)` 設定的 Hook 狀態文字：

- 依鍵值儲存
- 依鍵值名稱排序
- 經過清理（`\r`、`\n`、`\t` → 空格；重複空格合併）
- 連接並截斷寬度以供顯示

## 錯誤傳播與備援

### 載入時期

- 無效模組或缺少預設匯出 → 擷取在 `LoadHooksResult.errors` 中
- 其他 hooks 繼續載入

### 事件時期

`HookRunner.emit(...)` 對大多數事件捕獲處理器錯誤，並向監聽器發出 `HookError`（`hookPath`、`event`、`error`），然後繼續。

`emitToolCall(...)` 更為嚴格：處理器錯誤不會被吞噬；它們會傳播到呼叫者。在 `HookToolWrapper` 中，這會阻止工具呼叫（故障安全）。

## 實際 API 範例

### 阻止不安全的 bash 命令

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

### 在執行後編輯工具輸出

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
- 執行器和包裝器（`HookRunner`、`HookToolWrapper`）
- 所有 hook 類型
- `execCommand` 重新匯出

而套件根目錄（`src/index.ts`）重新匯出 hook **類型**作為舊有相容性介面。
