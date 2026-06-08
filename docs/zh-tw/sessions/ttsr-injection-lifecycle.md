---
title: TTSR 注入生命週期
description: TTSR（tool-use、tool-result、system-reminder）用於上下文管理的注入生命週期。
sidebar:
  order: 9
  label: TTSR 注入
i18n:
  sourceHash: d6179a286584
  translator: machine
---

# TTSR 注入生命週期

本文件涵蓋目前 Time Traveling Stream Rules（TTSR）從規則發現到串流中斷、重試注入、擴充功能通知及會話狀態處理的完整執行路徑。

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

## 1. 發現來源與規則註冊

在會話建立時，`createAgentSession()` 會載入所有已發現的規則並建構一個 `TtsrManager`：

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### 預註冊去重行為

`loadCapability("rules")` 以 `rule.name` 進行去重，採用先到先贏的語意（較高提供者優先順序優先）。被遮蔽的重複項在 TTSR 註冊之前即被移除。

### `TtsrManager.addRule()` 行為

在以下情況下會跳過註冊：

- `rule.ttsrTrigger` 不存在
- 相同 `rule.name` 的規則已在此管理器中註冊
- 正規表達式編譯失敗（`new RegExp(rule.ttsrTrigger)` 拋出例外）

無效的正規表達式觸發器會記錄為警告並被忽略；會話啟動將繼續進行。

### 設定注意事項

`TtsrSettings.enabled` 會被載入管理器，但目前在執行期間閘控中並未被檢查。只要規則存在，匹配仍會執行。

## 2. 串流監控生命週期

TTSR 偵測在 `AgentSession.#handleAgentEvent` 內部執行。

### 回合開始

在 `turn_start` 時，串流緩衝區會被重置：

- `ttsrManager.resetBuffer()`

### 串流期間（`message_update`）

當助理更新到達且規則存在時：

- 監控 `text_delta` 和 `toolcall_delta`
- 將差異資料附加到管理器緩衝區
- 呼叫 `check(buffer)`

`check()` 會迭代已註冊的規則，並回傳所有通過重複策略（`#canTrigger`）的匹配規則。

## 3. 觸發決策與立即中止路徑

當一個或多個規則匹配時：

1. `markInjected(matches)` 在管理器注入狀態中記錄規則名稱。
2. 匹配的規則被排入 `#pendingTtsrInjections` 佇列。
3. `#ttsrAbortPending = true`。
4. 立即呼叫 `agent.abort()`。
5. 非同步發出 `ttsr_triggered` 事件（發送後即忘）。
6. 透過 `setTimeout(..., 50)` 排程重試工作。

中止不會被擴充功能回呼阻塞。

## 4. 重試排程、上下文模式與提醒注入

在 50ms 逾時之後：

1. `#ttsrAbortPending = false`
2. 讀取 `ttsrManager.getSettings().contextMode`
3. 若 `contextMode === "discard"`，透過 `agent.popMessage()` 丟棄部分助理輸出
4. 使用 `ttsr-interrupt.md` 範本從待處理規則建構注入內容
5. 附加一則合成使用者訊息，其中每個規則包含一個 `<system-interrupt ...>` 區塊
6. 呼叫 `agent.continue()` 重試生成

範本內容為：

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

待處理注入在內容生成後會被清除。

### `contextMode` 對部分輸出的行為

- `discard`：部分/已中止的助理訊息在重試前會被移除。
- `keep`：部分助理輸出保留在對話狀態中；提醒會附加在其後。

## 5. 重複策略與間隔邏輯

`TtsrManager` 追蹤 `#messageCount` 和每條規則的 `lastInjectedAt`。

### `repeatMode: "once"`

規則在已有注入記錄後只能觸發一次。

### `repeatMode: "after-gap"`

規則只有在以下條件成立時才能重新觸發：

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` 在 `turn_end` 時遞增，因此間隔是以已完成的回合來衡量，而非串流區塊。

## 6. 事件發送與擴充功能/掛鉤介面

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

互動模式使用 `session.isTtsrAbortPending` 來抑制在 TTSR 中斷期間將已中止的助理停止原因顯示為可見錯誤，並在事件到達時渲染 `TtsrNotificationComponent`。

## 7. 持久化與恢復狀態（目前實作）

`SessionManager` 對已注入規則的持久化具有完整的結構描述支援：

- 條目類型：`ttsr_injection`
- 附加 API：`appendTtsrInjection(ruleNames)`
- 查詢 API：`getInjectedTtsrRules()`
- 上下文重建包含 `SessionContext.injectedTtsrRules`

`TtsrManager` 也支援透過 `restoreInjected(ruleNames)` 進行還原。

### 目前的串接狀態

在目前的執行路徑中：

- `AgentSession` 在 TTSR 觸發時不會附加 `ttsr_injection` 條目。
- `createAgentSession()` 不會將 `existingSession.injectedTtsrRules` 還原回 `ttsrManager`。

淨效果：已注入規則的抑制在活躍程序的記憶體中強制執行，但目前透過此路徑不會在會話重新載入/恢復之間進行持久化/還原。

## 8. 競爭邊界與排序保證

### 中止與重試回呼

- 從 TTSR 處理器的角度來看，中止是同步的（`agent.abort()` 被立即呼叫）
- 重試透過計時器延遲（`50ms`）
- 擴充功能通知是非同步的，且在中止/重試排程之前刻意不等待

### 同一串流視窗中的多個匹配

`check()` 回傳所有目前匹配的合格規則。它們在下一則重試訊息中以批次方式注入。

### 中止與繼續之間

在計時器視窗期間，狀態可能改變（使用者中斷、模式操作、額外事件）。重試呼叫為盡力而為：`agent.continue().catch(() => {})` 會吞掉後續錯誤。

## 9. 邊界情況摘要

- 無效的 `ttsr_trigger` 正規表達式：以警告跳過；其他規則繼續運作。
- 能力層的重複規則名稱：較低優先順序的重複項在註冊前被遮蔽。
- 管理器層的重複名稱：第二次註冊被忽略。
- `contextMode: "keep"`：部分違規輸出在提醒重試前可能保留在上下文中。
- after-gap 重複依賴於 `turn_end` 時的回合計數遞增；回合中的區塊不會推進間隔計數器。
