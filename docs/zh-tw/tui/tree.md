---
title: Tree 指令參考
description: /tree 指令參考，用於視覺化工作階段歷史記錄與對話分支。
sidebar:
  order: 4
  label: /tree 指令
i18n:
  sourceHash: ee0e412fe993
  translator: machine
---

# `/tree` 指令參考

`/tree` 開啟互動式**工作階段樹狀圖**導覽器。它讓您跳轉到目前工作階段檔案中的任何項目，並從該點繼續。

這是檔案內的葉節點移動，而非新的工作階段匯出。

## `/tree` 的功能

- 從目前工作階段項目建構樹狀結構（`SessionManager.getTree()`）
- 開啟 `TreeSelectorComponent`，支援鍵盤導覽、篩選器及搜尋
- 選取後，呼叫 `AgentSession.navigateTree(targetId, { summarize, customInstructions })`
- 從新的葉節點路徑重建可見對話
- 選取使用者/自訂訊息時，可選擇性地預填編輯器文字

主要實作：

- `src/modes/controllers/input-controller.ts`（`/tree`、快捷鍵綁定、雙擊 Escape 行為）
- `src/modes/controllers/selector-controller.ts`（樹狀 UI 啟動 + 摘要提示流程）
- `src/modes/components/tree-selector.ts`（導覽、篩選器、搜尋、標籤、渲染）
- `src/session/agent-session.ts`（`navigateTree` 葉節點切換 + 可選摘要）
- `src/session/session-manager.ts`（`getTree`、`branch`、`branchWithSummary`、`resetLeaf`、標籤持久化）

## 如何開啟

以下任一方式皆可開啟相同的選擇器：

- `/tree`
- 已設定的快捷鍵動作 `tree`
- 在空白編輯器上雙擊 Escape，當 `doubleEscapeAction = "tree"` 時（預設值）
- `/branch`，當 `doubleEscapeAction = "tree"` 時（路由至樹狀選擇器，而非僅限使用者的分支選擇器）

## 樹狀 UI 模型

樹狀結構從工作階段項目的父指標（`id` / `parentId`）進行渲染。

- 子節點按時間戳升序排列（較舊的在前，較新的在下方）
- 活動分支（從根到目前葉節點的路徑）以圓點標記
- 標籤（如有）以 `[label]` 渲染在節點文字之前
- 如果存在多個根節點（孤立/斷裂的父鏈），它們會顯示在虛擬分支根節點下

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

選擇器以目前選取項目為中心重新定位，最多顯示：

- `max(5, floor(terminalHeight / 2))` 列

## 樹狀選擇器內的快捷鍵

- `Up` / `Down`：移動選取項目（循環）
- `Left` / `Right`：向上翻頁 / 向下翻頁
- `Enter`：選取節點
- `Esc`：如搜尋啟用則清除搜尋；否則關閉選擇器
- `Ctrl+C`：關閉選擇器
- `Type`：追加至搜尋查詢
- `Backspace`：刪除搜尋字元
- `Shift+L`：編輯/清除所選項目的標籤
- `Ctrl+O`：向前循環篩選器
- `Shift+Ctrl+O`：向後循環篩選器
- `Alt+D/T/U/L/A`：直接跳轉到特定篩選模式

## 篩選器與搜尋語意

篩選模式（`TreeList`）：

1. `default`
2. `no-tools`
3. `user-only`
4. `labeled-only`
5. `all`

### `default`

顯示大部分對話節點，但隱藏簿記項目類型：

- `label`
- `custom`
- `model_change`
- `thinking_level_change`

### `no-tools`

與 `default` 相同，另外隱藏 `toolResult` 訊息。

### `user-only`

僅顯示角色為 `user` 的 `message` 項目。

### `labeled-only`

僅顯示目前已解析為標籤的項目。

### `all`

工作階段樹狀結構中的所有內容，包括簿記/自訂項目。

### 僅含工具的助理節點行為

**僅包含工具呼叫**（無文字）的助理訊息在所有篩選檢視中預設為隱藏，除非：

- 訊息為錯誤/中止狀態（`stopReason` 不是 `stop`/`toolUse`），或
- 它是目前的葉節點（始終保持可見）

### 搜尋行為

- 查詢以空格進行分詞
- 比對不區分大小寫
- 所有詞彙必須匹配（AND 語意）
- 可搜尋文字包括標籤、角色及特定類型的內容（訊息文字、分支摘要文字、自訂類型、工具指令片段等）

## 選取結果（重要）

`navigateTree` 根據所選項目類型計算新的葉節點行為：

### 選取 `user` 訊息

- 新葉節點變為所選項目的 `parentId`
- 如果父節點為 `null`（根使用者訊息），葉節點重設為根節點（`resetLeaf()`）
- 所選訊息文字複製到編輯器以供編輯/重新提交

### 選取 `custom_message`

- 與使用者訊息相同的葉節點規則（`parentId`）
- 文字內容被擷取並複製到編輯器

### 選取非使用者節點（助理/工具/摘要/壓縮/自訂簿記/等）

- 新葉節點變為所選節點的 id
- 編輯器不會預填

### 選取目前葉節點

- 無操作；選擇器以「Already at this point」關閉

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

## 切換時摘要流程

摘要提示由 `branchSummary.enabled`（預設：`false`）控制。

啟用後，選取節點後 UI 會詢問：

- `No summary`
- `Summarize`
- `Summarize with custom prompt`

流程細節：

- 在摘要提示中按 Escape 會重新開啟樹狀選擇器
- 取消自訂提示會返回摘要選擇循環
- 摘要生成期間，UI 顯示載入指示器並將 `Esc` 綁定至 `abortBranchSummary()`
- 如果摘要生成中止，樹狀選擇器會重新開啟且不會套用任何移動

`navigateTree` 內部機制：

- 收集從舊葉節點到共同祖先的已放棄分支項目
- 發出 `session_before_tree`（擴充功能可取消或注入摘要）
- 僅在有請求且需要時使用預設摘要生成器
- 以下列方式套用移動：
  - `branchWithSummary(...)` 當摘要存在時
  - `branch(newLeafId)` 用於無摘要的非根節點移動
  - `resetLeaf()` 用於無摘要的根節點移動
- 以重建的工作階段上下文替換代理對話
- 發出 `session_tree`

注意：如果使用者請求摘要但沒有內容可摘要，導覽會在不建立摘要項目的情況下繼續進行。

## 標籤

在樹狀 UI 中編輯標籤會呼叫 `appendLabelChange(targetId, label)`。

- 非空標籤會設定/更新已解析的標籤
- 空標籤會清除它
- 標籤以僅追加的 `label` 項目儲存
- 樹狀節點顯示已解析的標籤狀態，而非原始標籤項目歷史記錄

## `/tree` 與相鄰操作的比較

| 操作 | 範圍 | 結果 |
|---|---|---|
| `/tree` | 目前工作階段檔案 | 將葉節點移動到選取的位置（同一檔案） |
| `/branch` | 通常從目前工作階段檔案 -> 新工作階段檔案 | 預設從選取的**使用者**訊息分支到新的工作階段檔案；如果 `doubleEscapeAction = "tree"`，`/branch` 會改為開啟樹狀導覽 UI |
| `/fork` | 整個目前工作階段 | 將工作階段複製到新的持久化工作階段檔案 |
| `/resume` | 工作階段列表 | 切換到另一個工作階段檔案 |

關鍵區別：`/tree` 是單一工作階段檔案內的導覽/重新定位工具。`/branch`、`/fork` 和 `/resume` 都會變更工作階段檔案的上下文。

## 操作工作流程

### 從較早的使用者提示重新執行而不遺失目前分支

1. `/tree`
2. 搜尋/選取較早的使用者訊息
3. 選擇 `No summary`（或視需要進行摘要）
4. 在編輯器中編輯預填的文字
5. 提交

效果：新分支從同一工作階段檔案中的選取點開始成長。

### 帶有上下文書籤離開目前分支

1. 啟用 `branchSummary.enabled`
2. `/tree` 並選取目標節點
3. 選擇 `Summarize`（或自訂提示）

效果：在繼續之前，於目標位置追加一個 `branch_summary` 項目。

### 檢視隱藏的簿記項目

1. `/tree`
2. 按 `Alt+A`（全部）
3. 搜尋 `model`、`thinking`、`custom` 或標籤

效果：檢視完整的內部時間線，而不僅是對話節點。

### 為後續跳轉建立書籤樞紐點

1. `/tree`
2. 移動到項目
3. `Shift+L` 並設定標籤
4. 之後使用 `Alt+L`（`labeled-only`）快速跳轉

效果：在持久性分支地標之間快速導覽。
