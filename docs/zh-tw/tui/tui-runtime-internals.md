---
title: TUI 執行時期內部機制
description: 終端 UI 執行時期內部機制，涵蓋渲染管線、輸入處理與狀態管理。
sidebar:
  order: 2
  label: 執行時期內部機制
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# TUI 執行時期內部機制

本文件描述從終端輸入到互動模式渲染輸出的非主題執行時期路徑。重點關注 `packages/tui` 中的行為及其與 `packages/coding-agent` 控制器的整合。

## 執行時期層級與職責

- **`packages/tui` 引擎**：終端生命週期、stdin 正規化、焦點路由、渲染排程、差異繪製、覆蓋層合成、硬體游標定位。
- **`packages/coding-agent` 互動模式**：建構元件樹、綁定編輯器回呼與按鍵映射、回應 agent/session 事件，並將領域狀態（串流、工具執行、重試、計畫模式）轉換為 UI 元件。

邊界規則：TUI 引擎與訊息無關。它只認識 `Component.render(width)`、`handleInput(data)`、焦點和覆蓋層。Agent 語義留在互動控制器中。

## 實作檔案

- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/components/custom-editor.ts`](../../packages/coding-agent/src/modes/components/custom-editor.ts)
- [`../../tui/src/tui.ts`](../../packages/tui/src/tui.ts)
- [`../../tui/src/terminal.ts`](../../packages/tui/src/terminal.ts)
- [`../../tui/src/editor-component.ts`](../../packages/tui/src/editor-component.ts)
- [`../../tui/src/stdin-buffer.ts`](../../packages/tui/src/stdin-buffer.ts)
- [`../../tui/src/components/loader.ts`](../../packages/tui/src/components/loader.ts)

## 啟動與元件樹組裝

`InteractiveMode` 建構 `TUI(new ProcessTerminal(), showHardwareCursor)` 並建立持久容器：

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer`（包含 `CustomEditor`）

`init()` 按上述順序串接元件樹、聚焦編輯器、透過 `InputController` 註冊輸入處理器、啟動 TUI，並請求強制渲染。

強制渲染（`requestRender(true)`）會在重繪前重設先前行快取與游標簿記。

## 終端生命週期與 stdin 正規化

`ProcessTerminal.start()`：

1. 啟用 raw 模式與 bracketed paste。
2. 附加 resize 處理器。
3. 建立 `StdinBuffer` 將部分跳脫序列片段分割為完整序列。
4. 查詢 Kitty 鍵盤協定支援（`CSI ? u`），若支援則啟用協定旗標。
5. 在 Windows 上，嘗試透過 `kernel32` 模式旗標啟用 VT 輸入。

`StdinBuffer` 行為：

- 緩衝片段化的跳脫序列（CSI/OSC/DCS/APC/SS3）。
- 僅在序列完整或逾時沖刷時發出 `data`。
- 偵測 bracketed paste 並以原始貼上文字發出 `paste` 事件。

這可防止部分跳脫序列片段被誤判為一般按鍵。

## 輸入路由與焦點模型

輸入路徑：

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

路由細節：

1. TUI 先執行已註冊的輸入監聽器（`addInputListener`），允許消費/轉換行為。
2. TUI 在元件分派前處理全域除錯快捷鍵（`shift+ctrl+d`）。
3. 若聚焦的元件屬於已隱藏/不可見的覆蓋層，TUI 會將焦點重新分配給下一個可見覆蓋層或已儲存的覆蓋層前焦點。
4. 按鍵釋放事件會被過濾，除非聚焦的元件設定了 `wantsKeyRelease = true`。
5. 分派後，TUI 排程渲染。

`setFocus()` 也會切換 `Focusable.focused`，控制元件是否發出 `CURSOR_MARKER` 以進行硬體游標定位。

## 按鍵處理分工：編輯器 vs 控制器

`CustomEditor` 先攔截高優先順序組合鍵（escape、ctrl-c/d/z、ctrl-v、ctrl-p 變體、ctrl-t、alt-up、擴充自訂鍵），其餘委派給基礎 `Editor` 行為（文字編輯、歷史記錄、自動完成、游標移動）。

`InputController.setupKeyHandlers()` 接著將編輯器回呼綁定到模式動作：

- `Escape` 取消/退出模式
- 雙擊 `Ctrl+C` 或空編輯器 `Ctrl+D` 關閉
- `Ctrl+Z` 暫停/恢復
- 斜線命令與選擇器快捷鍵
- 後續追問/取消佇列切換與展開切換

這使得按鍵解析/編輯器機制保留在 `packages/tui` 中，模式語義則在 coding-agent 控制器中。

## 渲染迴圈與差異比對策略

`TUI.requestRender()` 使用 `process.nextTick` 限流為每個 tick 一次渲染。同一輪中的多次狀態變更會合併。

`#doRender()` 管線：

1. 將根元件樹渲染為 `newLines`。
2. 合成可見的覆蓋層（若有）。
3. 從可見視區行中擷取並移除 `CURSOR_MARKER`。
4. 為非圖片行附加區段重設後綴。
5. 選擇完整重繪或差異修補：
   - 首幀
   - 寬度變更
   - 啟用 `clearOnShrink` 且無覆蓋層時的縮小
   - 先前視區上方的編輯
6. 差異更新時，僅修補變更的行範圍，並在需要時清除過期的尾部行。
7. 重新定位硬體游標以支援 IME。

渲染寫入使用同步輸出模式（`CSI ? 2026 h/l`）以減少閃爍/撕裂。

## 渲染安全約束

`TUI` 中的關鍵安全檢查：

- 非圖片的渲染行不得超過終端寬度；溢出會拋出例外並寫入當機診斷。
- 覆蓋層合成包含防禦性截斷和合成後寬度驗證。
- 寬度變更強制完整重繪，因為換行語義會改變。
- 游標位置在移動前會被限制在範圍內。

這些約束是執行時期的強制檢查，不僅是慣例。

## Resize 處理

Resize 事件從 `ProcessTerminal` 以事件驅動方式傳遞至 `TUI.requestRender()`。

影響：

- 任何寬度變更都會觸發完整重繪。
- 視區/頂部追蹤（`#previousViewportTop`、`#maxLinesRendered`）避免在內容或終端大小變更時產生無效的相對游標運算。
- 覆蓋層可見性可能依賴終端尺寸（`OverlayOptions.visible`）；resize 後覆蓋層變為不可見時會修正焦點。

## 串流與增量 UI 更新

`EventController` 訂閱 `AgentSessionEvent` 並增量更新 UI：

- `agent_start`：在 `statusContainer` 中啟動載入器。
- `message_start` assistant：建立 `streamingComponent` 並掛載。
- `message_update`：更新串流助理內容；在工具呼叫出現時建立/更新工具執行元件。
- `tool_execution_update/end`：更新工具結果元件與完成狀態。
- `message_end`：最終化助理串流、處理中止/錯誤標註、在正常停止時標記待處理的工具參數為完成。
- `agent_end`：停止載入器、清除暫態串流狀態、沖刷延遲的模型切換、若在背景則發出完成通知。

讀取工具分組是刻意有狀態的（`#lastReadGroup`），將連續的讀取工具呼叫合併為一個視覺區塊，直到出現非讀取的中斷為止。

## 狀態與載入器協調

狀態區域職責：

- `statusContainer` 持有暫態載入器（`loadingAnimation`、`autoCompactionLoader`、`retryLoader`）。
- `statusLine` 渲染持久狀態/hooks/計畫指示器，並驅動編輯器上邊框更新。

載入器行為：

- `Loader` 每 80ms 透過 interval 更新，每幀請求渲染。
- 在自動壓縮和自動重試期間，Escape 處理器會被暫時覆寫以取消這些操作。
- 在結束/取消路徑上，控制器會恢復先前的 Escape 處理器並停止/清除載入器元件。

## 模式轉換與背景化

### Bash/Python 輸入模式

輸入文字前綴切換編輯器邊框模式旗標：

- `!` -> bash 模式
- `$`（非範本字面值前綴）-> python 模式

Escape 透過清除編輯器文字並恢復邊框顏色來退出非活躍模式；當執行處於活躍狀態時，Escape 改為中止正在執行的任務。

### 計畫模式

`InteractiveMode` 追蹤計畫模式旗標、狀態列狀態、活躍工具和模型切換。進入/退出會更新 session 模式項目及狀態/UI 狀態，包括串流活躍時的延遲模型切換。

### 暫停/恢復（`Ctrl+Z`）

`InputController.handleCtrlZ()`：

1. 註冊一次性 `SIGCONT` 處理器以重新啟動 TUI 並強制渲染。
2. 暫停前停止 TUI。
3. 向行程群組發送 `SIGTSTP`。

### 背景模式（`/background` 或 `/bg`）

`handleBackgroundCommand()`：

- 閒置時拒絕。
- 將工具 UI 上下文切換為非互動（`hasUI=false`），使互動式 UI 工具快速失敗。
- 停止載入器/狀態列並取消訂閱前景事件處理器。
- 訂閱背景事件處理器（主要等待 `agent_end`）。
- 停止 TUI 並發送 `SIGTSTP`（POSIX 工作控制路徑）。

在背景中收到 `agent_end` 且無佇列工作時，控制器發送完成通知並關閉。

## 取消路徑

主要取消輸入：

- 活躍串流載入器期間按 `Escape`：將佇列訊息恢復至編輯器並中止 agent。
- bash/python 執行期間按 `Escape`：中止正在執行的命令。
- 自動壓縮/重試期間按 `Escape`：透過暫時的 Escape 處理器呼叫專用的中止方法。
- 單按 `Ctrl+C`：清除編輯器；500ms 內雙擊：關閉。

取消是狀態條件式的；相同按鍵可能意味著中止、退出模式、觸發選擇器或無操作，取決於執行時期狀態。

## 事件驅動 vs 節流行為

事件驅動更新：

- Agent session 事件（`EventController`）
- 按鍵輸入回呼（`InputController`）
- 終端 resize 回呼
- `InteractiveMode` 中的主題/分支監視器

節流/防抖路徑：

- TUI 渲染是 tick 防抖的（`requestRender` 合併）。
- 載入器動畫是固定間隔（80ms），每幀請求渲染。
- 編輯器自動完成更新（在 `Editor` 內部）使用防抖計時器，減少打字期間的重複計算。

因此，執行時期混合了事件驅動的狀態轉換與有界限的渲染節奏，在保持互動響應性的同時避免重繪風暴。
