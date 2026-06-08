---
title: TTSR 注入生命週期
description: TTSR（tool-use、tool-result、system-reminder）注入生命週期，用於上下文管理。
sidebar:
  order: 9
  label: TTSR 注入
i18n:
  sourceHash: d6179a286584
  translator: machine
---

# TTSR 注入生命週期

本文件涵蓋目前 Time Traveling Stream Rules（TTSR）的執行時期路徑，從規則探索到串流中斷、重試注入、擴充功能通知以及會話狀態處理。

## 實作檔案

- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/export/ttsr.ts`](../../packages/coding-agent/src/export/ttsr.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/prompts/system/ttsr-interrupt.md`](../../packages/coding-agent/src/prompts/system/ttsr-interrupt.md)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/types.ts`](../../packages/coding-agent/src/extensibility/extensions/types.ts)
- [`../src/extensibility/hooks/types.ts`](../../packages/coding-agent/src/extensibility/hooks/types.ts)
- [`../src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)

## 1. 探索饋送與規則註冊

在會話建立時，`createAgentSession()` 會載入所有已探索的規則並建構一個 `TtsrManager`：

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### 預先註冊去重行為

`loadCapability("rules")` 依據 `rule.name` 進行去重，採用先到先得的語意（優先順序較高的提供者優先）。被遮蔽的重複項目在 TTSR 註冊之前即會被移除。

### `TtsrManager.addRule()` 行為

在以下情況下會跳過註冊：

- `rule.ttsrTrigger` 不存在
- 此管理器中已註冊具有相同 `rule.name` 的規則
- 正規表達式編譯失敗（`new RegExp(rule.ttsrTrigger)` 拋出例外）

無效的正規表達式觸發器會以警告記錄並被忽略；會話啟動會繼續進行。

### 設定注意事項

`TtsrSettings.enabled` 會載入至管理器中，但目前在執行時期閘控中並未被檢查。如果規則存在，匹配仍會執行。

## 2. 串流監控生命週期

TTSR 偵測在 `AgentSession.#handleAgentEvent` 內部執行。

### 回合開始

在 `turn_start` 時，串流緩衝區會被重設：

- `ttsrManager.resetBuffer()`

### 串流期間（`message_update`）

當助理更新到達且存在規則時：

- 監控 `text_delta` 和 `toolcall_delta`
- 將差異附加至管理器緩衝區
- 呼叫 `check(buffer)`

`check()` 會遍歷已註冊的規則，並回傳所有通過重複策略（`#canTrigger`）的匹配規則。

## 3. 觸發決策與立即中止路徑

當一個或多個規則匹配時：

1. `markInjected(matches)` 在管理器注入狀態中記錄規則名稱。
2. 匹配的規則被排入 `#pendingTtsrInjections` 佇列。
3. `#ttsrAbortPending = true`。
4. 立即呼叫 `agent.abort()`。
5. `ttsr_triggered` 事件被非同步發出（發射後不管）。
6. 重試工作透過 `setTimeout(..., 50)` 排程。

中止不會被擴充功能回呼阻塞。

## 4. 重試排程、上下文模式與提醒注入

在 50 毫秒逾時之後：

1. `#ttsrAbortPending = false`
2. 讀取 `ttsrManager.getSettings().contextMode`
3. 如果 `contextMode === "discard"`，使用 `agent.popMessage()` 丟棄部分助理輸出
4. 使用 `ttsr-interrupt.md` 模板從待處理規則建構注入內容
5. 附加一個合成使用者訊息，其中包含每個規則一個 `<system-interrupt ...>` 區塊
6. 呼叫 `agent.continue()` 重試生成

模板酬載為：

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

待處理的注入在內容生成後會被清除。

### `contextMode` 對部分輸出的行為

- `discard`：在重試前移除部分/中止的助理訊息。
- `keep`：部分助理輸出保留在對話狀態中；提醒會附加在其後。

## 5. 重複策略與間隔邏輯

`TtsrManager` 追蹤 `#messageCount` 以及每個規則的 `lastInjectedAt`。

### `repeatMode: "once"`

規則在有注入記錄後只能觸發一次。

### `repeatMode: "after-gap"`

規則只能在以下條件下重新觸發：

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` 在 `turn_end` 時遞增，因此間隔是以完成的回合數衡量，而非串流區塊。

## 6. 事件發出與擴充功能/掛鉤介面

### 會話事件

`AgentSessionEvent` 包含：

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### 擴充功能執行器

`#emitSessionEvent()` 將事件路由至：

- 擴充功能監聽器（`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`）
- 本地會話訂閱者

### 掛鉤與自訂工具型別

- 擴充功能 API 公開 `on("ttsr_triggered", ...)`
- 掛鉤 API 公開 `on("ttsr_triggered", ...)`
- 自訂工具接收 `onSession({ reason: "ttsr_triggered", rules })`

### 互動模式渲染差異

互動模式使用 `session.isTtsrAbortPending` 來抑制在 TTSR 中斷期間將已中止的助理停止原因顯示為可見的錯誤，並在事件到達時渲染一個 `TtsrNotificationComponent`。

## 7. 持久化與恢復狀態（目前實作）

`SessionManager` 對已注入規則的持久化有完整的結構描述支援：

- 條目類型：`ttsr_injection`
- 附加 API：`appendTtsrInjection(ruleNames)`
- 查詢 API：`getInjectedTtsrRules()`
- 上下文重建包含 `SessionContext.injectedTtsrRules`

`TtsrManager` 也透過 `restoreInjected(ruleNames)` 支援還原。

### 目前連接狀態

在目前的執行時期路徑中：

- `AgentSession` 在 TTSR 觸發時不會附加 `ttsr_injection` 條目。
- `createAgentSession()` 不會將 `existingSession.injectedTtsrRules` 還原回 `ttsrManager`。

淨效果：已注入規則的抑制在即時程序的記憶體中是有效的，但目前透過此路徑並未在會話重新載入/恢復時進行持久化/還原。

## 8. 競態邊界與順序保證

### 中止與重試回呼

- 從 TTSR 處理器的角度來看，中止是同步的（立即呼叫 `agent.abort()`）
- 重試由計時器延遲（`50ms`）
- 擴充功能通知是非同步的，且在中止/重試排程之前故意不被等待

### 同一串流視窗中的多重匹配

`check()` 回傳所有目前匹配的合格規則。它們作為一個批次在下一次重試訊息中被注入。

### 中止與繼續之間

在計時器視窗期間，狀態可能會改變（使用者中斷、模式操作、額外事件）。重試呼叫是盡力而為：`agent.continue().catch(() => {})` 會吞噬後續錯誤。

## 9. 邊界案例摘要

- 無效的 `ttsr_trigger` 正規表達式：以警告跳過；其他規則繼續執行。
- 在能力層的重複規則名稱：優先順序較低的重複項目在註冊前被遮蔽。
- 在管理器層的重複名稱：第二次註冊會被忽略。
- `contextMode: "keep"`：違規的部分輸出可能在提醒重試前保留在上下文中。
- 間隔後重複取決於 `turn_end` 時的回合計數遞增；回合中的區塊不會推進間隔計數器。
