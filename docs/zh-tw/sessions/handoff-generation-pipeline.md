---
title: 交接生成管線
description: 用於建立可攜式會話摘要以供團隊協作的交接生成管線。
sidebar:
  order: 8
  label: 交接管線
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# `/handoff` 生成管線

本文件描述 coding-agent 目前如何實作 `/handoff`：觸發路徑、生成提示詞、完成捕獲、會話切換及上下文重新注入。

## 範圍

涵蓋：

- 互動式 `/handoff` 命令調度
- `AgentSession.handoff()` 生命週期與狀態轉換
- 交接輸出如何從助理輸出中捕獲
- 舊/新會話如何以不同方式持久化交接資料
- 成功、取消及失敗時的 UI 行為

不涵蓋：

- 通用樹狀導航/分支內部機制
- 非交接會話命令（`/new`、`/fork`、`/resume`）

## 實作檔案

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## 觸發路徑

1. `/handoff` 在內建斜線命令元資料（`slash-commands.ts`）中宣告，帶有可選的行內提示：`[focus instructions]`。
2. 在互動式輸入處理（`InputController`）中，匹配 `/handoff` 或 `/handoff ...` 的提交文字會在正常提示詞提交前被攔截。
3. 編輯器被清空並呼叫 `handleHandoffCommand(customInstructions?)`。
4. `CommandController.handleHandoffCommand` 使用目前的條目執行預檢防護：
   - 計算 `type === "message"` 的條目數量。
   - 若 `< 2`，則警告：`Nothing to hand off (no messages yet)` 並返回。

相同的最少內容防護也存在於 `AgentSession.handoff()` 內部，違反時會拋出錯誤。這在 UI 層和會話層都重複了安全檢查。

## 端到端生命週期

### 1) 開始交接生成

`AgentSession.handoff(customInstructions?)`：

- 讀取目前分支條目（`sessionManager.getBranch()`）
- 驗證最少訊息數量（`>= 2`）
- 建立 `#handoffAbortController`
- 構建一個固定的行內提示詞，要求生成結構化的交接文件（`Goal`、`Constraints & Preferences`、`Progress`、`Key Decisions`、`Critical Context`、`Next Steps`）
- 若提供了自訂指示，則附加 `Additional focus: ...`

提示詞透過以下方式發送：

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` 防止對此內部指令載荷進行斜線/提示詞範本展開。

### 2) 捕獲完成結果

在發送提示詞之前，`handoff()` 訂閱會話事件並等待 `agent_end`。

在 `agent_end` 時，它透過向後掃描找到最近的 `assistant` 訊息，然後將所有 `type === "text"` 的 `content` 區塊以 `\n` 串接，從代理狀態中提取交接文字。

重要的提取假設：

- 僅使用文字區塊；非文字內容會被忽略。
- 假設最新的助理訊息對應於交接生成。
- 不解析 markdown 章節或驗證格式合規性。
- 若助理輸出沒有文字區塊，交接會被視為缺失。

### 3) 取消檢查

當以下任一條件成立時，`handoff()` 返回 `undefined`：

- 沒有捕獲到交接文字，或
- `#handoffAbortController.signal.aborted` 為 true

它總是在 `finally` 中清除 `#handoffAbortController`。

### 4) 建立新會話

若文字已被捕獲且未被中止：

1. 刷新目前的會話寫入器（`sessionManager.flush()`）
2. 開始一個全新的會話（`sessionManager.newSession()`）
3. 重置記憶體中的代理狀態（`agent.reset()`）
4. 將 `agent.sessionId` 重新綁定到新的會話 ID
5. 清除佇列中的上下文陣列（`#steeringMessages`、`#followUpMessages`、`#pendingNextTurnMessages`）
6. 重置待辦提醒計數器

`newSession()` 建立一個新的標頭和空的條目列表（leaf 重置為 `null`）。在交接路徑中，不會傳入 `parentSession`。

### 5) 交接上下文注入

生成的交接文件被包裝並作為 `custom_message` 條目附加到新會話：

```text
<handoff-context>
...handoff text...
</handoff-context>

The above is a handoff document from a previous session. Use this context to continue the work seamlessly.
```

插入呼叫：

```ts
this.sessionManager.appendCustomMessageEntry("handoff", handoffContent, true);
```

語義：

- `customType`：`"handoff"`
- `display`：`true`（在 TUI 重建時可見）
- 條目類型：`custom_message`（參與 LLM 上下文）

### 6) 重建活躍的代理上下文

注入後：

1. `sessionManager.buildSessionContext()` 解析目前 leaf 的訊息列表
2. `agent.replaceMessages(sessionContext.messages)` 使注入的交接訊息成為活躍上下文
3. 方法返回 `{ document: handoffText }`

此時，新會話中的活躍 LLM 上下文包含注入的交接訊息，而非舊的對話記錄。

## 持久化模型：舊會話 vs 新會話

### 舊會話

在生成期間，正常的訊息持久化保持活躍。助理的交接回應在 `message_end` 時作為常規 `message` 條目被持久化。

結果：原始會話包含可見的已生成交接內容，作為歷史對話記錄的一部分。

### 新會話

會話重置後，交接以 `custom_message` 形式持久化，`customType` 為 `"handoff"`。

`buildSessionContext()` 透過 `createCustomMessage(...)` 將此條目轉換為執行時的自訂/使用者上下文訊息，因此它會被包含在新會話的後續提示詞中。

## 控制器/UI 行為

`CommandController.handleHandoffCommand` 行為：

- 呼叫 `await session.handoff(customInstructions)`
- 若結果為 `undefined`：`showError("Handoff cancelled")`
- 成功時：
  - `rebuildChatFromMessages()`（載入新的會話上下文，包含注入的交接內容）
  - 使狀態列和編輯器頂部邊框失效
  - 重新載入待辦事項
  - 附加成功的聊天訊息行：`New session started with handoff context`
- 發生例外時：
  - 若訊息為 `"Handoff cancelled"` 或錯誤名稱為 `AbortError`：`showError("Handoff cancelled")`
  - 否則：`showError("Handoff failed: <message>")`
- 最後請求渲染

## 取消語義（目前行為）

### 會話層級取消原語

`AgentSession` 公開：

- `abortHandoff()` → 中止 `#handoffAbortController`
- `isGeneratingHandoff` → 當控制器存在時為 true

當使用此中止路徑時，交接訂閱者以 `Error("Handoff cancelled")` 拒絕，命令控制器將其對應到取消 UI。

### 互動式 `/handoff` 路徑的限制

在目前的互動式控制器連線中，`/handoff` 不會安裝專用的 Escape 處理器來呼叫 `abortHandoff()`（不同於壓縮/分支摘要路徑會暫時覆寫 `editor.onEscape`）。

實際影響：

- 存在會話層級的取消支援，但在 `/handoff` 命令路徑中沒有交接專用的按鍵綁定鉤子。
- 使用者中斷仍可能透過更廣泛的代理中止路徑發生，但那與 `abortHandoff()` 使用的明確取消通道不同。

## 中止 vs 失敗的交接

目前的 UI 分類：

- **中止/取消**
  - `abortHandoff()` 路徑觸發 `"Handoff cancelled"`，或
  - 拋出 `AbortError`
  - UI 顯示 `Handoff cancelled`

- **失敗**
  - 來自 `handoff()` / 提示詞管線的任何其他拋出錯誤（模型/API 驗證錯誤、執行時例外等）
  - UI 顯示 `Handoff failed: ...`

額外細節：若生成完成但未提取到文字，`handoff()` 返回 `undefined`，控制器目前報告為**已取消**，而非**失敗**。

## 短會話與最少內容防護

兩道防護防止低訊號量的交接：

- UI 層（`handleHandoffCommand`）：對 `< 2` 個訊息條目發出警告並提前返回
- 會話層（`handoff()`）：以錯誤形式拋出相同條件

這避免了以空的/近乎空的交接上下文建立新會話。

## 狀態轉換摘要

高階狀態流程：

1. 互動式斜線命令被攔截
2. 預檢訊息數量防護
3. 建立 `#handoffAbortController`（`isGeneratingHandoff = true`）
4. 內部交接提示詞提交（在聊天中作為正常的助理生成可見）
5. 在 `agent_end` 時，提取最後的助理文字
6. 若缺失/已中止 → 返回 `undefined` 或取消錯誤路徑
7. 若存在：
   - 刷新舊會話
   - 建立新的空會話
   - 重置執行時佇列/計數器
   - 附加 `custom_message(handoff)`
   - 重建並替換活躍的代理訊息
8. 控制器重建聊天 UI 並宣告成功
9. 清除 `#handoffAbortController`（`isGeneratingHandoff = false`）

## 已知假設與限制

- 交接提取是啟發式的：「最後的助理文字區塊」；無結構化驗證。
- 沒有硬性檢查生成的 markdown 是否遵循請求的章節格式。
- 缺失的提取文字在控制器 UX 中被報告為取消。
- `/handoff` 互動流程目前缺少專用的 Escape→`abortHandoff()` 綁定。
- 此路徑未設定新會話的血緣元資料（`parentSession`）。
