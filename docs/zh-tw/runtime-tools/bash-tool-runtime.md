---
title: Bash 工具執行環境
description: >-
  Bash tool runtime with shell process management, sandboxing, timeout, and
  output streaming.
sidebar:
  order: 1
  label: Bash 工具
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Bash 工具執行環境

本文件描述代理工具呼叫所使用的 **`bash` 工具**執行路徑，從命令正規化到執行、截斷/產出物，以及渲染。

同時也指出在互動式 TUI、列印模式、RPC 模式，以及使用者發起的驚嘆號（`!`）shell 執行之間的行為差異。

## 範圍與執行環境介面

coding-agent 中有兩種不同的 bash 執行介面：

1. **工具呼叫介面**（`toolName: "bash"`）：當模型呼叫 bash 工具時使用。
   - 進入點：`BashTool.execute()`。
2. **使用者驚嘆號命令介面**（互動式輸入的 `!cmd` 或 RPC `bash` 命令）：工作階段層級的輔助路徑。
   - 進入點：`AgentSession.executeBash()`。

兩者最終都使用 `src/exec/bash-executor.ts` 中的 `executeBash()` 進行非 PTY 執行，但只有工具呼叫路徑會執行正規化/攔截及工具渲染器邏輯。

## 端對端工具呼叫管線

## 1) 輸入正規化與參數合併

`BashTool.execute()` 首先透過 `normalizeBashCommand()` 正規化原始命令：

- 提取結尾的 `| head -n N`、`| head -N`、`| tail -n N`、`| tail -N` 成結構化的限制條件，
- 去除結尾/開頭的空白字元，
- 保持內部空白不變。

然後將提取的限制條件與明確的工具引數合併：

- 明確的 `head`/`tail` 引數會覆蓋提取的值，
- 提取的值僅作為備用。

### 注意事項

`bash-normalize.ts` 的註解提到會移除 `2>&1`，但目前的實作並未移除它。執行時行為仍然正確（stdout/stderr 已經合併），但正規化行為比註解所描述的更為有限。

## 2) 選擇性攔截（被封鎖命令路徑）

如果 `bashInterceptor.enabled` 為 true，`BashTool` 會從設定載入規則，並對正規化後的命令執行 `checkBashInterception()`。

攔截行為：

- 命令**僅在**以下條件全部成立時被封鎖：
  - 正則表達式規則匹配，且
  - 建議的工具存在於 `ctx.toolNames` 中。
- 無效的正則表達式規則會被靜默跳過。
- 當封鎖時，`BashTool` 會拋出 `ToolError`，訊息為：
  - `Blocked: ...`
  - 包含原始命令。

預設規則模式（在程式碼中定義）針對常見的誤用：

- 檔案讀取工具（`cat`、`head`、`tail`……）
- 搜尋工具（`grep`、`rg`……）
- 檔案尋找工具（`find`、`fd`……）
- 就地編輯器（`sed -i`、`perl -i`、`awk -i inplace`）
- shell 重導向寫入（`echo ... > file`、heredoc 重導向）

### 注意事項

`InterceptionResult` 包含 `suggestedTool`，但 `BashTool` 目前僅呈現訊息文字（`details` 中沒有結構化的建議工具欄位）。

## 3) CWD 驗證與逾時值截限

`cwd` 相對於工作階段 cwd（`resolveToCwd`）解析，然後透過 `stat` 驗證：

- 路徑不存在 -> `ToolError("Working directory does not exist: ...")`
- 非目錄 -> `ToolError("Working directory is not a directory: ...")`

逾時值被截限至 `[1, 3600]` 秒，並轉換為毫秒。

## 4) 產出物配置

在執行前，工具會配置一個產出物路徑/ID（盡力而為）以儲存截斷的輸出。

- 產出物配置失敗不會導致致命錯誤（執行會在沒有產出物溢出檔案的情況下繼續），
- 產出物 ID/路徑會傳入執行路徑，以便在截斷時持久化完整輸出。

## 5) PTY 與非 PTY 執行選擇

`BashTool` 僅在以下條件全部為真時選擇 PTY 執行：

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- 工具上下文具有 UI（`ctx.hasUI === true` 且 `ctx.ui` 已設定）

否則使用非互動式 `executeBash()`。

這意味著列印模式和非 UI 的 RPC/工具上下文始終使用非 PTY。

## 非互動式執行引擎（`executeBash`）

## Shell 工作階段重用模型

`executeBash()` 在程序全域的映射中快取原生 `Shell` 實例，鍵值由以下組成：

- shell 路徑，
- 配置的命令前綴，
- 快照路徑，
- 序列化的 shell 環境變數，
- 選擇性的代理工作階段金鑰。

對於工作階段層級的執行，`AgentSession.executeBash()` 傳遞 `sessionKey: this.sessionId`，將重用範圍隔離至每個工作階段。

工具呼叫路徑**不會**傳遞 `sessionKey`，因此重用範圍基於 shell 配置/快照/環境變數。

## Shell 配置與快照行為

在每次呼叫時，執行器會載入設定中的 shell 配置（`shell`、`env`、選擇性的 `prefix`）。

如果選定的 shell 包含 `bash`，它會嘗試 `getOrCreateSnapshot()`：

- 快照從使用者 rc 擷取別名/函式/選項，
- 快照建立是盡力而為，
- 失敗時退回到無快照模式。

如果配置了 `prefix`，命令會變成：

```text
<prefix> <command>
```

## 串流與取消

`Shell.run()` 將區塊串流到回呼函式。執行器將每個區塊傳入 `OutputSink` 和選擇性的 `onChunk` 回呼函式。

取消：

- 中止信號觸發 `shellSession.abort(...)`，
- 來自原生結果的逾時會映射為 `cancelled: true` + 註解文字，
- 明確取消同樣返回 `cancelled: true` + 註解。

在執行器內部不會因逾時/取消拋出例外；它返回結構化的 `BashResult`，讓呼叫者映射錯誤語意。

## 互動式 PTY 路徑（`runInteractiveBashPty`）

當啟用 PTY 時，工具執行 `runInteractiveBashPty()`，它會開啟一個覆蓋式主控台元件並驅動原生 `PtySession`。

行為要點：

- xterm-headless 虛擬終端機在覆蓋層中渲染視窗，
- 鍵盤輸入經過正規化（包括 Kitty 序列和應用程式游標模式處理），
- 執行中按 `esc` 會終止 PTY 工作階段，
- 終端機大小調整會傳播至 PTY（`session.resize(cols, rows)`）。

為無人值守執行注入環境強化預設值：

- 停用分頁器（`PAGER=cat`、`GIT_PAGER=cat` 等），
- 停用編輯器提示（`GIT_EDITOR=true`、`EDITOR=true`……），
- 減少終端機/認證提示（`GIT_TERMINAL_PROMPT=0`、`SSH_ASKPASS=/usr/bin/false`、`CI=1`），
- 套件管理器/工具的自動化旗標以實現非互動式行為。

PTY 輸出經過正規化（`CRLF`/`CR` 轉為 `LF`、`sanitizeText`）並寫入 `OutputSink`，包括產出物溢出支援。

當 PTY 啟動/執行時發生錯誤，接收器會收到 `PTY error: ...` 行，命令以未定義的結束代碼完成。

## 輸出處理：串流、截斷、產出物溢出

PTY 和非 PTY 路徑都使用 `OutputSink`。

## OutputSink 語意

- 在記憶體中維護一個 UTF-8 安全的尾部緩衝區（`DEFAULT_MAX_BYTES`，目前為 50KB），
- 追蹤已讀取的總位元組數/行數，
- 如果產出物路徑存在且輸出溢出（或檔案已啟用），將完整串流寫入產出物檔案，
- 當記憶體閾值溢出時，將記憶體內緩衝區修剪至尾部（UTF-8 邊界安全），
- 當溢出/檔案溢出發生時標記 `truncated`。

`dump()` 返回：

- `output`（可能帶有前綴註解），
- `truncated`，
- `totalLines/totalBytes`，
- `outputLines/outputBytes`，
- 如果產出物檔案已啟用則包含 `artifactId`。

### 長輸出注意事項

執行時截斷在 `OutputSink` 中基於位元組閾值（預設 50KB）。在此程式碼路徑中不強制執行硬性的 2000 行上限。

## 即時工具更新

對於非 PTY 執行，`BashTool` 使用獨立的 `TailBuffer` 進行部分更新，並在命令執行中發出 `onUpdate` 快照。

對於 PTY 執行，即時渲染由自訂 UI 覆蓋層處理，而非透過 `onUpdate` 文字區塊。

## 結果塑形、中繼資料與錯誤映射

執行後：

1. `cancelled` 處理：
   - 如果中止信號已中止 -> 拋出 `ToolAbortError`（中止語意），
   - 否則 -> 拋出 `ToolError`（視為工具失敗）。
2. PTY `timedOut` -> 拋出 `ToolError`。
3. 對最終輸出文字套用 head/tail 篩選器（`applyHeadTail`，先 head 後 tail）。
4. 空輸出變為 `(no output)`。
5. 透過 `toolResult(...).truncationFromSummary(result, { direction: "tail" })` 附加截斷中繼資料。
6. 結束代碼映射：
   - 缺少結束代碼 -> `ToolError("... missing exit status")`
   - 非零結束 -> `ToolError("... Command exited with code N")`
   - 零結束 -> 成功結果。

成功載荷結構：

- `content`：文字輸出，
- `details.meta.truncation`（截斷時），包括：
  - `direction`、`truncatedBy`、總計/輸出行數+位元組數，
  - `shownRange`，
  - 可用時的 `artifactId`。

由於內建工具由 `wrapToolWithMetaNotice()` 包裝，截斷通知文字會自動附加到最終文字內容（例如：`Full: artifact://<id>`）。

## 渲染路徑

## 工具呼叫渲染器（`bashToolRenderer`）

`bashToolRenderer` 用於工具呼叫訊息（`toolCall` / `toolResult`）：

- 摺疊模式顯示視覺行截斷的預覽，
- 展開模式顯示所有目前可用的輸出文字，
- 警告行包含截斷原因及截斷時的 `artifact://<id>`，
- 逾時值（來自引數）顯示在頁腳中繼資料行。

### 注意事項：完整產出物展開

`BashRenderContext` 具有 `isFullOutput`，但目前渲染器上下文建構器不會為 bash 工具結果設定它。展開視圖仍使用結果內容中已有的文字（尾部/截斷輸出），除非其他呼叫者提供完整的產出物內容。

## 使用者驚嘆號命令元件（`BashExecutionComponent`）

`BashExecutionComponent` 用於互動模式中使用者的 `!` 命令（非模型工具呼叫）：

- 即時串流區塊，
- 摺疊預覽保留最後 20 個邏輯行，
- 每行行數上限為 4000 個字元，
- 當中繼資料存在時顯示截斷及產出物警告，
- 分別標記已取消/錯誤/結束狀態。

此元件由 `CommandController.handleBashCommand()` 連接，並從 `AgentSession.executeBash()` 取得資料。

## 各模式特定的行為差異

| 介面                          | 進入路徑                                              | PTY 適用性                                                            | 即時輸出 UX                                                             | 錯誤呈現                                          |
| ----------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| 互動式工具呼叫                | `BashTool.execute`                                    | 是，當 `bash.virtualTerminal=on` 且 UI 存在且 `PI_NO_PTY!=1`          | PTY 覆蓋層（互動式）或串流尾部更新                                        | 工具錯誤變為 `toolResult.isError`                 |
| 列印模式工具呼叫              | `BashTool.execute`                                    | 否（無 UI 上下文）                                                    | 無 TUI 覆蓋層；輸出出現在事件串流/最終助手文字流中                        | 相同的工具錯誤映射                                 |
| RPC 工具呼叫（代理工具）      | `BashTool.execute`                                    | 通常無 UI -> 非 PTY                                                   | 結構化工具事件/結果                                                      | 相同的工具錯誤映射                                 |
| 互動式驚嘆號命令（`!`）       | `AgentSession.executeBash` + `BashExecutionComponent` | 否（直接使用執行器）                                                   | 專用 bash 執行元件                                                      | 控制器捕捉例外並顯示 UI 錯誤                       |
| RPC `bash` 命令               | `rpc-mode` -> `session.executeBash`                   | 否                                                                    | 直接返回 `BashResult`                                                   | 消費者處理返回的欄位                               |

## 操作注意事項

- 攔截器僅在建議的工具目前存在於上下文中時才會封鎖命令。
- 如果產出物配置失敗，截斷仍會發生但不會有 `artifact://` 反向參照可用。
- Shell 工作階段快取在此模組中沒有明確的驅逐策略；生命週期為程序範圍。
- PTY 和非 PTY 的逾時介面不同：
  - PTY 公開明確的 `timedOut` 結果欄位，
  - 非 PTY 將逾時映射為 `cancelled + annotation` 摘要。

## 實作檔案

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — 工具進入點、正規化/攔截、PTY/非 PTY 選擇、結果/錯誤映射、bash 工具渲染器。
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — 命令正規化及執行後 head/tail 篩選。
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — 攔截器規則匹配及被封鎖命令訊息。
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — 非 PTY 執行器、shell 工作階段重用、取消連接、輸出接收器整合。
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — PTY 執行環境、覆蓋式 UI、輸入正規化、非互動式環境預設值。
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink` 截斷/產出物溢出及摘要中繼資料。
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — 產出物配置輔助工具及串流尾部緩衝區。
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — 截斷中繼資料形狀及通知注入包裝器。
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — 工作階段層級 `executeBash`、訊息記錄、中止生命週期。
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — 互動式 `!` 命令執行元件。
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — 互動式 `!` 命令 UI 串流/更新完成的連接。
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — RPC `bash` 和 `abort_bash` 命令介面。
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://<id>` 解析。
