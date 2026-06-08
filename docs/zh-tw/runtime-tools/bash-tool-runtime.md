---
title: Bash 工具執行環境
description: 具備 Shell 程序管理、沙箱機制、逾時處理及輸出串流功能的 Bash 工具執行環境。
sidebar:
  order: 1
  label: Bash 工具
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Bash 工具執行環境

本文件描述 agent 工具呼叫所使用的 **`bash` 工具**執行路徑，從命令正規化到執行、截斷/產出物，以及渲染。

同時也指出在互動式 TUI、列印模式、RPC 模式，以及使用者發起的 bang（`!`）shell 執行之間的行為差異。

## 範圍與執行介面

coding-agent 中有兩個不同的 bash 執行介面：

1. **工具呼叫介面**（`toolName: "bash"`）：當模型呼叫 bash 工具時使用。
   - 進入點：`BashTool.execute()`。
2. **使用者 bang 命令介面**（互動式輸入的 `!cmd` 或 RPC `bash` 命令）：工作階段層級的輔助路徑。
   - 進入點：`AgentSession.executeBash()`。

兩者最終都使用 `src/exec/bash-executor.ts` 中的 `executeBash()` 進行非 PTY 執行，但只有工具呼叫路徑會執行正規化/攔截及工具渲染器邏輯。

## 端對端工具呼叫流程

## 1) 輸入正規化與參數合併

`BashTool.execute()` 首先透過 `normalizeBashCommand()` 正規化原始命令：

- 提取結尾的 `| head -n N`、`| head -N`、`| tail -n N`、`| tail -N` 為結構化限制，
- 修剪結尾/開頭的空白字元，
- 保持內部空白字元不變。

然後將提取的限制與明確的工具引數合併：

- 明確的 `head`/`tail` 引數會覆蓋提取的值，
- 提取的值僅作為後備。

### 注意事項

`bash-normalize.ts` 的註解提到會移除 `2>&1`，但目前的實作並未移除它。執行時行為仍然正確（stdout/stderr 已經合併），但正規化行為比註解所描述的更為有限。

## 2) 選擇性攔截（封鎖命令路徑）

如果 `bashInterceptor.enabled` 為 true，`BashTool` 會從設定載入規則，並對正規化後的命令執行 `checkBashInterception()`。

攔截行為：

- 命令**僅在**以下條件時被封鎖：
  - 正規表示式規則匹配，且
  - 建議的工具存在於 `ctx.toolNames` 中。
- 無效的正規表示式規則會被靜默跳過。
- 封鎖時，`BashTool` 會拋出 `ToolError`，訊息為：
  - `Blocked: ...`
  - 包含原始命令。

預設規則模式（定義在程式碼中）針對常見的誤用：

- 檔案讀取器（`cat`、`head`、`tail`、...）
- 搜尋工具（`grep`、`rg`、...）
- 檔案查找器（`find`、`fd`、...）
- 就地編輯器（`sed -i`、`perl -i`、`awk -i inplace`）
- Shell 重導向寫入（`echo ... > file`、heredoc 重導向）

### 注意事項

`InterceptionResult` 包含 `suggestedTool`，但 `BashTool` 目前僅呈現訊息文字（`details` 中沒有結構化的建議工具欄位）。

## 3) CWD 驗證與逾時限制

`cwd` 相對於工作階段 cwd（`resolveToCwd`）解析，然後透過 `stat` 驗證：

- 路徑不存在 -> `ToolError("Working directory does not exist: ...")`
- 非目錄 -> `ToolError("Working directory is not a directory: ...")`

逾時被限制在 `[1, 3600]` 秒之間，並轉換為毫秒。

## 4) 產出物配置

在執行之前，工具會配置產出物路徑/ID（盡力嘗試）用於截斷輸出的儲存。

- 產出物配置失敗不會導致致命錯誤（執行會繼續，但沒有產出物溢出檔案），
- 產出物 ID/路徑會傳入執行路徑，以便在截斷時持久化完整輸出。

## 5) PTY 與非 PTY 執行選擇

`BashTool` 僅在以下條件全部成立時選擇 PTY 執行：

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- 工具上下文具有 UI（`ctx.hasUI === true` 且 `ctx.ui` 已設定）

否則使用非互動式 `executeBash()`。

這意味著列印模式和非 UI 的 RPC/工具上下文始終使用非 PTY。

## 非互動式執行引擎（`executeBash`）

## Shell 工作階段重用模型

`executeBash()` 在程序全域 map 中快取原生 `Shell` 實例，鍵值由以下組成：

- shell 路徑，
- 設定的命令前綴，
- 快照路徑，
- 序列化的 shell 環境變數，
- 選用的 agent 工作階段金鑰。

對於工作階段層級的執行，`AgentSession.executeBash()` 傳遞 `sessionKey: this.sessionId`，使重用隔離到每個工作階段。

工具呼叫路徑**不**傳遞 `sessionKey`，因此重用範圍基於 shell 設定/快照/環境。

## Shell 設定與快照行為

每次呼叫時，執行器載入設定中的 shell 設定（`shell`、`env`、選用的 `prefix`）。

如果選定的 shell 包含 `bash`，它會嘗試 `getOrCreateSnapshot()`：

- 快照擷取使用者 rc 中的別名/函式/選項，
- 快照建立為盡力嘗試，
- 失敗時會回退到不使用快照。

如果設定了 `prefix`，命令會變為：

```text
<prefix> <command>
```

## 串流與取消

`Shell.run()` 將區塊串流到回呼函式。執行器將每個區塊導入 `OutputSink` 和選用的 `onChunk` 回呼函式。

取消：

- 中止信號觸發 `shellSession.abort(...)`，
- 原生結果中的逾時被映射為 `cancelled: true` + 附註文字，
- 明確的取消同樣回傳 `cancelled: true` + 附註。

逾時/取消時，執行器內部不會拋出例外；它回傳結構化的 `BashResult`，讓呼叫者映射錯誤語義。

## 互動式 PTY 路徑（`runInteractiveBashPty`）

當 PTY 啟用時，工具執行 `runInteractiveBashPty()`，開啟覆蓋式主控台元件並驅動原生 `PtySession`。

行為重點：

- xterm-headless 虛擬終端機在覆蓋層中渲染視窗，
- 鍵盤輸入經過正規化（包括 Kitty 序列和應用程式游標模式處理），
- 執行時按 `esc` 會終止 PTY 工作階段，
- 終端機大小調整會傳播到 PTY（`session.resize(cols, rows)`）。

為無人值守執行注入了環境強化預設值：

- 停用分頁器（`PAGER=cat`、`GIT_PAGER=cat` 等），
- 停用編輯器提示（`GIT_EDITOR=true`、`EDITOR=true`、...），
- 減少終端機/認證提示（`GIT_TERMINAL_PROMPT=0`、`SSH_ASKPASS=/usr/bin/false`、`CI=1`），
- 套件管理器/工具的非互動行為自動化旗標。

PTY 輸出經過正規化（`CRLF`/`CR` 轉為 `LF`、`sanitizeText`）並寫入 `OutputSink`，包括產出物溢出支援。

PTY 啟動/執行錯誤時，sink 接收 `PTY error: ...` 行，命令以未定義的結束碼完成。

## 輸出處理：串流、截斷、產出物溢出

PTY 和非 PTY 路徑都使用 `OutputSink`。

## OutputSink 語義

- 在記憶體中保持 UTF-8 安全的尾端緩衝區（`DEFAULT_MAX_BYTES`，目前為 50KB），
- 追蹤已看到的總位元組/行數，
- 如果產出物路徑存在且輸出溢出（或檔案已啟用），將完整串流寫入產出物檔案，
- 當記憶體閾值溢出時，將記憶體中的緩衝區修剪至尾端（UTF-8 邊界安全），
- 溢出/檔案溢出發生時標記 `truncated`。

`dump()` 回傳：

- `output`（可能帶有附註前綴），
- `truncated`，
- `totalLines/totalBytes`，
- `outputLines/outputBytes`，
- 如果產出物檔案已啟用則包含 `artifactId`。

### 長輸出注意事項

`OutputSink` 中的執行時截斷是基於位元組閾值的（預設 50KB）。此程式碼路徑不強制執行嚴格的 2000 行上限。

## 即時工具更新

對於非 PTY 執行，`BashTool` 使用獨立的 `TailBuffer` 進行部分更新，並在命令執行時發出 `onUpdate` 快照。

對於 PTY 執行，即時渲染由自訂 UI 覆蓋層處理，而非透過 `onUpdate` 文字區塊。

## 結果塑形、中繼資料與錯誤映射

執行後：

1. `cancelled` 處理：
   - 如果中止信號已中止 -> 拋出 `ToolAbortError`（中止語義），
   - 否則 -> 拋出 `ToolError`（視為工具失敗）。
2. PTY `timedOut` -> 拋出 `ToolError`。
3. 對最終輸出文字套用 head/tail 篩選器（`applyHeadTail`，先 head 後 tail）。
4. 空輸出變為 `(no output)`。
5. 透過 `toolResult(...).truncationFromSummary(result, { direction: "tail" })` 附加截斷中繼資料。
6. 結束碼映射：
   - 缺少結束碼 -> `ToolError("... missing exit status")`
   - 非零結束碼 -> `ToolError("... Command exited with code N")`
   - 零結束碼 -> 成功結果。

成功酬載結構：

- `content`：文字輸出，
- `details.meta.truncation`（截斷時），包括：
  - `direction`、`truncatedBy`、總計/輸出的行數+位元組數，
  - `shownRange`，
  - 可用時包含 `artifactId`。

由於內建工具以 `wrapToolWithMetaNotice()` 包裝，截斷通知文字會自動附加到最終文字內容中（例如：`Full: artifact://<id>`）。

## 渲染路徑

## 工具呼叫渲染器（`bashToolRenderer`）

`bashToolRenderer` 用於工具呼叫訊息（`toolCall` / `toolResult`）：

- 摺疊模式顯示視覺行截斷的預覽，
- 展開模式顯示目前所有可用的輸出文字，
- 警告行在截斷時包含截斷原因和 `artifact://<id>`，
- 逾時值（來自引數）顯示在頁尾中繼資料行中。

### 注意事項：完整產出物展開

`BashRenderContext` 有 `isFullOutput`，但目前的渲染器上下文建構器並未為 bash 工具結果設定它。展開檢視仍然使用結果內容中已有的文字（尾端/截斷的輸出），除非其他呼叫者提供完整的產出物內容。

## 使用者 bang 命令元件（`BashExecutionComponent`）

`BashExecutionComponent` 用於互動模式中使用者的 `!` 命令（非模型工具呼叫）：

- 即時串流區塊，
- 摺疊預覽保留最後 20 個邏輯行，
- 每行最多 4000 字元的行限制，
- 存在中繼資料時顯示截斷 + 產出物警告，
- 分別標記取消/錯誤/結束狀態。

此元件由 `CommandController.handleBashCommand()` 連接，並由 `AgentSession.executeBash()` 提供資料。

## 各模式的行為差異

| 介面                        | 進入路徑                                            | PTY 資格                                                         | 即時輸出 UX                                                           | 錯誤呈現                                  |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| 互動式工具呼叫          | `BashTool.execute`                                    | 是，當 `bash.virtualTerminal=on` 且 UI 存在且 `PI_NO_PTY!=1` 時 | PTY 覆蓋層（互動式）或串流尾端更新                       | 工具錯誤變為 `toolResult.isError`          |
| 列印模式工具呼叫           | `BashTool.execute`                                    | 否（無 UI 上下文）                                                   | 無 TUI 覆蓋層；輸出出現在事件串流/最終助理文字流中 | 相同的工具錯誤映射                          |
| RPC 工具呼叫（agent 工具）  | `BashTool.execute`                                    | 通常無 UI -> 非 PTY                                             | 結構化工具事件/結果                                           | 相同的工具錯誤映射                          |
| 互動式 bang 命令（`!`） | `AgentSession.executeBash` + `BashExecutionComponent` | 否（直接使用執行器）                                          | 專用 bash 執行元件                                       | 控制器捕獲例外並顯示 UI 錯誤 |
| RPC `bash` 命令             | `rpc-mode` -> `session.executeBash`                   | 否                                                                   | 直接回傳 `BashResult`                                            | 消費者處理回傳的欄位                 |

## 操作注意事項

- 攔截器僅在建議的工具目前在上下文中可用時才封鎖命令。
- 如果產出物配置失敗，截斷仍會發生但沒有可用的 `artifact://` 反向參照。
- Shell 工作階段快取在此模組中沒有明確的淘汰機制；生命週期為程序範圍。
- PTY 和非 PTY 的逾時介面不同：
  - PTY 公開明確的 `timedOut` 結果欄位，
  - 非 PTY 將逾時映射為 `cancelled + annotation` 摘要。

## 實作檔案

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — 工具進入點、正規化/攔截、PTY/非 PTY 選擇、結果/錯誤映射、bash 工具渲染器。
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — 命令正規化與執行後的 head/tail 篩選。
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — 攔截器規則比對與封鎖命令訊息。
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — 非 PTY 執行器、shell 工作階段重用、取消連接、輸出 sink 整合。
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — PTY 執行環境、覆蓋層 UI、輸入正規化、非互動式環境預設值。
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink` 截斷/產出物溢出與摘要中繼資料。
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — 產出物配置輔助函式與串流尾端緩衝區。
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — 截斷中繼資料結構 + 通知注入包裝器。
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — 工作階段層級 `executeBash`、訊息記錄、中止生命週期。
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — 互動式 `!` 命令執行元件。
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — 互動式 `!` 命令 UI 串流/更新完成的連接。
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — RPC `bash` 和 `abort_bash` 命令介面。
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://<id>` 解析。
