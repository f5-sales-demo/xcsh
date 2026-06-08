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

`/tree` 開啟互動式**工作階段樹狀圖**導覽器。它讓您可以跳轉到目前工作階段檔案中的任何條目，並從該點繼續。

這是檔案內的葉節點移動，而非新的工作階段匯出。

## `/tree` 的功能

- 從目前工作階段條目建立樹狀結構（`SessionManager.getTree()`）
- 開啟 `TreeSelectorComponent`，支援鍵盤導覽、篩選器和搜尋
- 選取後呼叫 `AgentSession.navigateTree(targetId, { summarize, customInstructions })`
- 從新的葉節點路徑重建可見的聊天內容
- 選取使用者/自訂訊息時可選擇性地預填編輯器文字

主要實作：

- `src/modes/controllers/input-controller.ts`（`/tree`、快捷鍵綁定、雙擊 Escape 行為）
- `src/modes/controllers/selector-controller.ts`（樹狀 UI 啟動 + 摘要提示流程）
- `src/modes/components/tree-selector.ts`（導覽、篩選器、搜尋、標籤、渲染）
- `src/session/agent-session.ts`（`navigateTree` 葉節點切換 + 選擇性摘要）
- `src/session/session-manager.ts`（`getTree`、`branch`、`branchWithSummary`、`resetLeaf`、標籤持久化）

## 如何開啟

以下任何方式都可開啟相同的選擇器：

- `/tree`
- 設定的快捷鍵動作 `tree`
- 在空白編輯器上雙擊 Escape，當 `doubleEscapeAction = "tree"` 時（預設值）
- `/branch`，當 `doubleEscapeAction = "tree"` 時（會導向樹狀選擇器，而非僅限使用者的分支選擇器）

## 樹狀 UI 模型

樹狀圖從工作階段條目的父指標（`id` / `parentId`）渲染而成。

- 子節點按時間戳升序排列（較舊的在前，較新的在下方）
- 活動分支（從根到目前葉節點的路徑）以圓點標記
- 標籤（如果存在）會在節點文字前顯示為 `[label]`
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

選擇器會以目前選取項目為中心重新定位，最多顯示：

- `max(5, floor(terminalHeight / 2))` 行

## 樹狀選擇器內的快捷鍵

- `Up` / `Down`：移動選取項目（循環）
- `Left` / `Right`：向上翻頁 / 向下翻頁
- `Enter`：選取節點
- `Esc`：如果搜尋啟用則清除搜尋；否則關閉選擇器
- `Ctrl+C`：關閉選擇器
- `Type`：追加到搜尋查詢
- `Backspace`：刪除搜尋字元
- `Shift+L`：編輯/清除所選條目的標籤
- `Ctrl+O`：向前循環篩選器
- `Shift+Ctrl+O`：向後循環篩選器
- `Alt+D/T/U/L/A`：直接跳到特定篩選模式

## 篩選器和搜尋語意

篩選模式（`TreeList`）：

1. `default`
2. `no-tools`
3. `user-only`
4. `labeled-only`
5. `all`

### `default`

顯示大部分對話節點，但隱藏記帳型條目類型：

- `label`
- `custom`
- `model_change`
- `thinking_level_change`

### `no-tools`

與 `default` 相同，另外隱藏 `toolResult` 訊息。

### `user-only`

僅顯示角色為 `user` 的 `message` 條目。

### `labeled-only`

僅顯示目前解析有標籤的條目。

### `all`

工作階段樹中的所有內容，包括記帳/自訂條目。

### 僅含工具的助手節點行為

僅包含**工具呼叫**（無文字）的助手訊息在所有篩選視圖中預設為隱藏，除非：

- 訊息為錯誤/已中止（`stopReason` 不是 `stop`/`toolUse`），或
- 它是目前的葉節點（始終保持可見）

### 搜尋行為

- 查詢以空格分詞
- 匹配不區分大小寫
- 所有詞元必須匹配（AND 語意）
- 可搜尋文字包含標籤、角色和特定類型的內容（訊息文字、分支摘要文字、自訂類型、工具指令片段等）

## 選取結果（重要）

`navigateTree` 根據所選條目類型計算新的葉節點行為：

### 選取 `user` 訊息

- 新葉節點變為所選條目的 `parentId`
- 如果父節點為 `null`（根使用者訊息），葉節點重設為根（`resetLeaf()`）
- 所選訊息文字會複製到編輯器以供編輯/重新提交

### 選取 `custom_message`

- 葉節點規則與使用者訊息相同（`parentId`）
- 文字內容被擷取並複製到編輯器

### 選取非使用者節點（助手/工具/摘要/壓縮/自訂記帳等）

- 新葉節點變為所選節點的 id
- 編輯器不會預填

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

## 切換時摘要流程

摘要提示由 `branchSummary.enabled` 控制（預設值：`false`）。

啟用後，選取節點後 UI 會詢問：

- `No summary`
- `Summarize`
- `Summarize with custom prompt`

流程細節：

- 在摘要提示中按 Escape 會重新開啟樹狀選擇器
- 取消自訂提示會返回摘要選擇循環
- 摘要生成期間，UI 顯示載入器並將 `Esc` 綁定到 `abortBranchSummary()`
- 如果摘要生成中止，樹狀選擇器會重新開啟且不會套用任何移動

`navigateTree` 內部機制：

- 收集從舊葉節點到共同祖先的已放棄分支條目
- 發出 `session_before_tree`（擴充功能可取消或注入摘要）
- 僅在請求且需要時使用預設摘要器
- 以下列方式套用移動：
  - 當摘要存在時使用 `branchWithSummary(...)`
  - 無摘要的非根移動使用 `branch(newLeafId)`
  - 無摘要的根移動使用 `resetLeaf()`
- 以重建的工作階段上下文替換代理對話
- 發出 `session_tree`

注意：如果使用者請求摘要但沒有內容可摘要，導覽會繼續進行而不建立摘要條目。

## 標籤

樹狀 UI 中的標籤編輯會呼叫 `appendLabelChange(targetId, label)`。

- 非空標籤設定/更新已解析的標籤
- 空標籤清除它
- 標籤以僅追加的 `label` 條目儲存
- 樹狀節點顯示已解析的標籤狀態，而非原始標籤條目歷史

## `/tree` 與相關操作的比較

| 操作 | 範圍 | 結果 |
|---|---|---|
| `/tree` | 目前工作階段檔案 | 將葉節點移動到選取的點（同一檔案） |
| `/branch` | 通常從目前工作階段檔案 -> 新工作階段檔案 | 預設從選取的**使用者**訊息分支到新的工作階段檔案；如果 `doubleEscapeAction = "tree"`，`/branch` 會改為開啟樹狀導覽 UI |
| `/fork` | 整個目前工作階段 | 將工作階段複製到新的持久化工作階段檔案 |
| `/resume` | 工作階段列表 | 切換到另一個工作階段檔案 |

關鍵區別：`/tree` 是在單一工作階段檔案內的導覽/重新定位工具。`/branch`、`/fork` 和 `/resume` 都會變更工作階段檔案的上下文。

## 操作流程

### 從較早的使用者提示重新執行而不遺失目前分支

1. `/tree`
2. 搜尋/選取較早的使用者訊息
3. 選擇 `No summary`（或根據需要進行摘要）
4. 在編輯器中編輯預填的文字
5. 提交

效果：在同一工作階段檔案中，從選取的點生長出新分支。

### 帶上下文標記離開目前分支

1. 啟用 `branchSummary.enabled`
2. `/tree` 並選取目標節點
3. 選擇 `Summarize`（或自訂提示）

效果：在繼續之前，於目標位置附加一個 `branch_summary` 條目。

### 檢查隱藏的記帳條目

1. `/tree`
2. 按 `Alt+A`（全部）
3. 搜尋 `model`、`thinking`、`custom` 或標籤

效果：檢視完整的內部時間線，而不僅是對話節點。

### 為稍後的跳轉建立樞紐點書籤

1. `/tree`
2. 移動到條目
3. `Shift+L` 並設定標籤
4. 稍後使用 `Alt+L`（`labeled-only`）快速跳轉

效果：在持久的分支地標之間快速導覽。
