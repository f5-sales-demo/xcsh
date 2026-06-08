---
title: 交接產生流程
description: >-
  Handoff generation pipeline for creating portable session summaries for team
  collaboration.
sidebar:
  order: 8
  label: 交接流程
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# `/handoff` 產生流程

本文件說明 coding-agent 目前如何實作 `/handoff`：觸發路徑、產生提示詞、完成擷取、工作階段切換，以及上下文重新注入。

## 範圍

涵蓋：

- 互動式 `/handoff` 命令分發
- `AgentSession.handoff()` 生命週期與狀態轉換
- 交接輸出如何從助理輸出中擷取
- 舊/新工作階段如何以不同方式持久化交接資料
- 成功、取消和失敗的 UI 行為

不涵蓋：

- 通用樹狀導覽/分支內部機制
- 非交接工作階段命令（`/new`、`/fork`、`/resume`）

## 實作檔案

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## 觸發路徑

1. `/handoff` 在內建斜線命令元資料（`slash-commands.ts`）中宣告，並帶有可選的行內提示：`[focus instructions]`。
2. 在互動式輸入處理（`InputController`）中，匹配 `/handoff` 或 `/handoff ...` 的提交文字會在正常提示詞提交之前被攔截。
3. 編輯器被清除並呼叫 `handleHandoffCommand(customInstructions?)`。
4. `CommandController.handleHandoffCommand` 使用當前項目執行預檢防護：
   - 計算 `type === "message"` 項目的數量。
   - 如果 `< 2`，則警告：`Nothing to hand off (no messages yet)` 並返回。

相同的最低內容防護也存在於 `AgentSession.handoff()` 內部，若違反則拋出錯誤。這在 UI 層和工作階段層都進行了重複的安全檢查。

## 端對端生命週期

### 1) 開始交接產生

`AgentSession.handoff(customInstructions?)`：

- 讀取當前分支項目（`sessionManager.getBranch()`）
- 驗證最低訊息數量（`>= 2`）
- 建立 `#handoffAbortController`
- 建構一個固定的行內提示詞，要求產生結構化的交接文件（`Goal`、`Constraints & Preferences`、`Progress`、`Key Decisions`、`Critical Context`、`Next Steps`）
- 如果提供了自訂指示，則附加 `Additional focus: ...`

提示詞透過以下方式送出：

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` 防止此內部指令酬載進行斜線/提示詞範本展開。

### 2) 擷取完成結果

在送出提示詞之前，`handoff()` 訂閱工作階段事件並等待 `agent_end`。

在 `agent_end` 時，它透過向後掃描最近的 `assistant` 訊息，從代理狀態中提取交接文字，然後將所有 `type === "text"` 的 `content` 區塊以 `\n` 串接。

重要的提取假設：

- 僅使用文字區塊；非文字內容被忽略。
- 假設最新的助理訊息對應交接產生結果。
- 不解析 markdown 區段或驗證格式合規性。
- 如果助理輸出沒有文字區塊，則交接被視為缺失。

### 3) 取消檢查

當以下任一條件成立時，`handoff()` 回傳 `undefined`：

- 沒有擷取到交接文字，或
- `#handoffAbortController.signal.aborted` 為 true

它總是在 `finally` 中清除 `#handoffAbortController`。

### 4) 建立新工作階段

如果文字已擷取且未被中止：

1. 刷新當前工作階段寫入器（`sessionManager.flush()`）
2. 啟動全新工作階段（`sessionManager.newSession()`）
3. 重置記憶體中的代理狀態（`agent.reset()`）
4. 重新綁定 `agent.sessionId` 到新工作階段 id
5. 清除佇列中的上下文陣列（`#steeringMessages`、`#followUpMessages`、`#pendingNextTurnMessages`）
6. 重置待辦提醒計數器

`newSession()` 建立一個新的標頭和空的項目清單（葉節點重置為 `null`）。在交接路徑中，不傳遞 `parentSession`。

### 5) 交接上下文注入

產生的交接文件被包裝並作為 `custom_message` 項目附加到新工作階段：

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

語意：

- `customType`：`"handoff"`
- `display`：`true`（在 TUI 重建中可見）
- 項目類型：`custom_message`（參與 LLM 上下文）

### 6) 重建活躍代理上下文

注入後：

1. `sessionManager.buildSessionContext()` 解析當前葉節點的訊息清單
2. `agent.replaceMessages(sessionContext.messages)` 使注入的交接訊息成為活躍上下文
3. 方法回傳 `{ document: handoffText }`

此時，新工作階段中的活躍 LLM 上下文包含注入的交接訊息，而非舊的對話記錄。

## 持久化模型：舊工作階段 vs 新工作階段

### 舊工作階段

在產生期間，正常的訊息持久化保持活躍。助理交接回應在 `message_end` 時作為一般 `message` 項目被持久化。

結果：原始工作階段包含作為歷史對話記錄一部分的可見已產生交接內容。

### 新工作階段

工作階段重置後，交接以 `custom_message`（`customType: "handoff"`）形式持久化。

`buildSessionContext()` 透過 `createCustomMessage(...)` 將此項目轉換為執行時期自訂/使用者上下文訊息，因此它會被包含在新工作階段的未來提示詞中。

## 控制器/UI 行為

`CommandController.handleHandoffCommand` 行為：

- 呼叫 `await session.handoff(customInstructions)`
- 如果結果為 `undefined`：`showError("Handoff cancelled")`
- 成功時：
  - `rebuildChatFromMessages()`（載入新工作階段上下文，包括注入的交接內容）
  - 使狀態列和編輯器頂部邊框失效
  - 重新載入待辦事項
  - 附加成功聊天訊息行：`New session started with handoff context`
- 發生例外時：
  - 如果訊息為 `"Handoff cancelled"` 或錯誤名稱為 `AbortError`：`showError("Handoff cancelled")`
  - 否則：`showError("Handoff failed: <message>")`
- 結束時請求重新渲染

## 取消語意（目前行為）

### 工作階段層級取消原語

`AgentSession` 公開：

- `abortHandoff()` → 中止 `#handoffAbortController`
- `isGeneratingHandoff` → 控制器存在時為 true

當使用此中止路徑時，交接訂閱者以 `Error("Handoff cancelled")` 拒絕，命令控制器將其映射為取消 UI。

### 互動式 `/handoff` 路徑限制

在目前的互動式控制器接線中，`/handoff` 未安裝呼叫 `abortHandoff()` 的專用 Escape 處理程式（不同於壓縮/分支摘要路徑會暫時覆蓋 `editor.onEscape`）。

實際影響：

- 存在工作階段層級的取消支援，但在 `/handoff` 命令路徑中沒有交接專用的按鍵綁定掛鉤。
- 使用者中斷仍可能透過更廣泛的代理中止路徑發生，但那與 `abortHandoff()` 使用的明確取消通道不同。

## 中止 vs 失敗的交接

目前的 UI 分類：

- **中止/取消**
  - `abortHandoff()` 路徑觸發 `"Handoff cancelled"`，或
  - 拋出 `AbortError`
  - UI 顯示 `Handoff cancelled`

- **失敗**
  - 從 `handoff()` / 提示詞管線拋出的任何其他錯誤（模型/API 驗證錯誤、執行時期例外等）
  - UI 顯示 `Handoff failed: ...`

額外細微差異：如果產生完成但未提取到文字，`handoff()` 回傳 `undefined`，控制器目前報告為**取消**，而非**失敗**。

## 短工作階段和最低內容防護

兩個防護機制防止低訊號交接：

- UI 層（`handleHandoffCommand`）：對 `< 2` 個訊息項目發出警告並提前返回
- 工作階段層（`handoff()`）：以錯誤形式拋出相同條件

這避免了建立具有空/幾乎為空交接上下文的新工作階段。

## 狀態轉換摘要

高層級狀態流程：

1. 互動式斜線命令被攔截
2. 預檢訊息數量防護
3. `#handoffAbortController` 建立（`isGeneratingHandoff = true`）
4. 內部交接提示詞提交（在聊天中作為正常助理產生可見）
5. 在 `agent_end` 時，提取最後的助理文字
6. 如果缺失/中止 → 回傳 `undefined` 或取消錯誤路徑
7. 如果存在：
   - 刷新舊工作階段
   - 建立新的空工作階段
   - 重置執行時期佇列/計數器
   - 附加 `custom_message(handoff)`
   - 重建並替換活躍代理訊息
8. 控制器重建聊天 UI 並宣告成功
9. `#handoffAbortController` 清除（`isGeneratingHandoff = false`）

## 已知假設和限制

- 交接提取是啟發式的：「最後的助理文字區塊」；沒有結構化驗證。
- 沒有硬性檢查產生的 markdown 是否遵循請求的區段格式。
- 缺失的提取文字在控制器 UX 中被報告為取消。
- `/handoff` 互動式流程目前缺少專用的 Escape→`abortHandoff()` 綁定。
- 新工作階段的血統元資料（`parentSession`）未在此路徑中設定。
