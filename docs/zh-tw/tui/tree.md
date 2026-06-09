---
title: Tree 指令參考
description: /tree 指令參考，用於視覺化工作階段歷史和對話分支。
sidebar:
  order: 4
  label: /tree 指令
i18n:
  sourceHash: ee0e412fe993
  translator: machine
---

# `/tree` 指令參考

`/tree` 會開啟互動式**工作階段樹狀圖**導覽器。它讓您可以跳轉到目前工作階段檔案中的任何項目，並從該點繼續。

這是檔案內的葉節點移動，不是新的工作階段匯出。

## `/tree` 的功能

- 從目前工作階段項目建立樹狀結構（`SessionManager.getTree()`）
- 開啟 `TreeSelectorComponent`，支援鍵盤導覽、篩選和搜尋
- 選取後，呼叫 `AgentSession.navigateTree(targetId, { summarize, customInstructions })`
- 從新的葉節點路徑重建可見聊天記錄
- 選取使用者/自訂訊息時，可選擇性地預先填入編輯器文字

主要實作：

- `src/modes/controllers/input-controller.ts`（`/tree`、快捷鍵綁定、雙重 Escape 行為）
- `src/modes/controllers/selector-controller.ts`（樹狀 UI 啟動 + 摘要提示流程）
- `src/modes/components/tree-selector.ts`（導覽、篩選、搜尋、標籤、渲染）
- `src/session/agent-session.ts`（`navigateTree` 葉節點切換 + 可選摘要）
- `src/session/session-manager.ts`（`getTree`、`branch`、`branchWithSummary`、`resetLeaf`、標籤持久化）

## 如何開啟

以下任何方式都會開啟相同的選擇器：

- `/tree`
- 已設定的快捷鍵動作 `tree`
- 在空白編輯器上按雙重 Escape，且 `doubleEscapeAction = "tree"` 時（預設值）
- `/branch`，當 `doubleEscapeAction = "tree"` 時（會路由到樹狀選擇器而非僅限使用者的分支選擇器）

## 樹狀 UI 模型

樹狀結構從工作階段項目的父指標（`id` / `parentId`）渲染。

- 子節點按時間戳升序排列（較舊的在前，較新的在下方）
- 活動分支（從根到目前葉節點的路徑）以圓點標記
- 標籤（如果存在）會在節點文字前顯示為 `[label]`
- 如果存在多個根節點（孤立/中斷的父鏈），它們會顯示在虛擬分支根節點下

```text
Example tree view (active path marked with •):

├─ user: "Start task"
│  └─ assistant: "Plan"
│     ├─ • user: "Try approach A"
│     │  └─ • assistant: "A result"
│     │     └─ • [milestone] user: "Continue A"
│     └─ user: "Try approach B"
│        └─ assistant: "B result"
```

選擇器會圍繞目前選取項目重新置中，最多顯示：

- `max(5, floor(terminalHeight / 2))` 列

## 樹狀選擇器內的快捷鍵

- `Up` / `Down`：移動選取項目（可循環）
- `Left` / `Right`：向上翻頁 / 向下翻頁
- `Enter`：選取節點
- `Esc`：如果搜尋正在使用中則清除搜尋；否則關閉選擇器
- `Ctrl+C`：關閉選擇器
- `Type`：附加到搜尋查詢
- `Backspace`：刪除搜尋字元
- `Shift+L`：編輯/清除所選項目的標籤
- `Ctrl+O`：向前循環篩選器
- `Shift+Ctrl+O`：向後循環篩選器
- `Alt+D/T/U/L/A`：直接跳轉到特定篩選模式

## 篩選和搜尋語意

篩選模式（`TreeList`）：

1. `default`
2. `no-tools`
3. `user-only`
4. `labeled-only`
5. `all`

### `default`

顯示大多數對話節點，但隱藏記帳類型的項目：

- `label`
- `custom`
- `model_change`
- `thinking_level_change`

### `no-tools`

與 `default` 相同，另外隱藏 `toolResult` 訊息。

### `user-only`

僅顯示角色為 `user` 的 `message` 項目。

### `labeled-only`

僅顯示目前已解析到標籤的項目。

### `all`

工作階段樹狀結構中的所有內容，包括記帳/自訂項目。

### 僅含工具的助理節點行為

**僅包含工具呼叫**（無文字）的助理訊息在所有篩選檢視中預設為隱藏，除非：

- 訊息為錯誤/已中止（`stopReason` 不是 `stop`/`toolUse`），或
- 它是目前的葉節點（始終保持可見）

### 搜尋行為

- 查詢以空格分詞
- 匹配不區分大小寫
- 所有詞彙必須匹配（AND 語意）
- 可搜尋文字包括標籤、角色和特定類型的內容（訊息文字、分支摘要文字、自訂類型、工具指令片段等）

## 選取結果（重要）

`navigateTree` 根據所選項目類型計算新的葉節點行為：

### 選取 `user` 訊息

- 新葉節點變為所選項目的 `parentId`
- 如果父節點為 `null`（根使用者訊息），葉節點重設到根（`resetLeaf()`）
- 所選訊息文字會複製到編輯器以便編輯/重新提交

### 選取 `custom_message`

- 葉節點規則與使用者訊息相同（`parentId`）
- 文字內容會被提取並複製到編輯器

### 選取非使用者節點（助理/工具/摘要/壓縮/自訂記帳等）

- 新葉節點變為所選節點的 id
- 編輯器不會預先填入

### 選取目前葉節點

- 無操作；選擇器關閉並顯示「Already at this point」

```text
Selection decision (simplified):

selected node
   │
   ├─ is current leaf? ── yes ──> close selector (no-op)
   │
   ├─ is user/custom_message? ── yes ──> leaf := parentId (or resetLeaf for root)
   │                                     + prefill editor text
   │
   └─ otherwise ──> leaf := selected node id
                    + no editor prefill
```

## 切換時的摘要流程

摘要提示由 `branchSummary.enabled` 控制（預設：`false`）。

啟用後，選取節點後 UI 會詢問：

- `No summary`
- `Summarize`
- `Summarize with custom prompt`

流程詳情：

- 在摘要提示中按 Escape 會重新開啟樹狀選擇器
- 取消自訂提示會返回摘要選擇迴圈
- 在摘要生成期間，UI 會顯示載入指示器並將 `Esc` 綁定到 `abortBranchSummary()`
- 如果摘要生成中止，樹狀選擇器會重新開啟且不套用任何移動

`navigateTree` 內部機制：

- 收集從舊葉節點到共同祖先之間被放棄的分支項目
- 發出 `session_before_tree`（擴充功能可以取消或注入摘要）
- 僅在有請求且需要時使用預設摘要產生器
- 透過以下方式套用移動：
  - 當摘要存在時使用 `branchWithSummary(...)`
  - 無摘要的非根移動使用 `branch(newLeafId)`
  - 無摘要的根移動使用 `resetLeaf()`
- 以重建的工作階段上下文替換代理對話
- 發出 `session_tree`

注意：如果使用者請求摘要但沒有可摘要的內容，導覽會在不建立摘要項目的情況下繼續進行。

## 標籤

在樹狀 UI 中編輯標籤會呼叫 `appendLabelChange(targetId, label)`。

- 非空標籤會設定/更新已解析的標籤
- 空標籤會清除它
- 標籤以僅附加的 `label` 項目儲存
- 樹狀節點顯示已解析的標籤狀態，而非原始標籤項目歷史

## `/tree` 與相關操作的比較

| 操作 | 範圍 | 結果 |
|---|---|---|
| `/tree` | 目前工作階段檔案 | 將葉節點移動到所選位置（同一檔案） |
| `/branch` | 通常從目前工作階段檔案 -> 新工作階段檔案 | 預設從所選**使用者**訊息分支到新的工作階段檔案；如果 `doubleEscapeAction = "tree"`，`/branch` 會改為開啟樹狀導覽 UI |
| `/fork` | 整個目前工作階段 | 將工作階段複製到新的持久化工作階段檔案 |
| `/resume` | 工作階段清單 | 切換到另一個工作階段檔案 |

關鍵區別：`/tree` 是在一個工作階段檔案內的導覽/重新定位工具。`/branch`、`/fork` 和 `/resume` 都會變更工作階段檔案的上下文。

## 操作者工作流程

### 從較早的使用者提示重新執行而不丟失目前分支

1. `/tree`
2. 搜尋/選取較早的使用者訊息
3. 選擇 `No summary`（或根據需要選擇摘要）
4. 在編輯器中編輯預先填入的文字
5. 提交

效果：新分支從同一工作階段檔案中的所選位置開始生長。

### 帶上下文麵包屑離開目前分支

1. 啟用 `branchSummary.enabled`
2. `/tree` 並選取目標節點
3. 選擇 `Summarize`（或自訂提示）

效果：在繼續之前，會在目標位置附加一個 `branch_summary` 項目。

### 檢查隱藏的記帳項目

1. `/tree`
2. 按 `Alt+A`（全部）
3. 搜尋 `model`、`thinking`、`custom` 或標籤

效果：檢查完整的內部時間軸，而非僅對話節點。

### 為稍後跳轉標記樞紐點

1. `/tree`
2. 移動到項目
3. `Shift+L` 並設定標籤
4. 稍後使用 `Alt+L`（`labeled-only`）快速跳轉

效果：在持久分支地標之間快速導覽。
