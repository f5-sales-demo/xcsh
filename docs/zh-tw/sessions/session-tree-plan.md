---
title: 會話樹架構
description: 具有分支、導航和父子對話關係的會話樹架構。
sidebar:
  order: 2
  label: 樹架構
i18n:
  sourceHash: bd8b78d6c33a
  translator: machine
---

# 會話樹架構（目前）

參考：[session.md](./session.md)

本文件描述會話樹導航目前的運作方式：記憶體內樹模型、葉節點移動規則、分支行為，以及擴充功能/事件整合。

## 此子系統是什麼

會話以僅追加的條目日誌形式儲存，但執行時行為是基於樹結構的：

- 每個非標頭條目都有 `id` 和 `parentId`。
- 目前的活動位置是 `SessionManager` 中的 `leafId`。
- 追加條目時，總是建立目前葉節點的子節點。
- 分支**不會**改寫歷史記錄；它只在下一次追加之前改變葉節點的指向位置。

關鍵檔案：

- `src/session/session-manager.ts` — 樹資料模型、遍歷、葉節點移動、分支/會話擷取
- `src/session/agent-session.ts` — `/tree` 導航流程、摘要、hook/事件發送
- `src/modes/components/tree-selector.ts` — 互動式樹 UI 行為和篩選
- `src/modes/controllers/selector-controller.ts` — `/tree` 和 `/branch` 的選擇器協調
- `src/modes/controllers/input-controller.ts` — 命令路由（`/tree`、`/branch`、雙重 Escape 行為）
- `src/session/messages.ts` — 將 `branch_summary`、`compaction` 和 `custom_message` 條目轉換為 LLM 上下文訊息

## `SessionManager` 中的樹資料模型

執行時索引：

- `#byId: Map<string, SessionEntry>` — 任意條目的快速查詢
- `#leafId: string | null` — 樹中的目前位置
- `#labelsById: Map<string, string>` — 按目標條目 id 解析的標籤

樹 API：

- `getBranch(fromId?)` 沿父節點連結走到根節點，回傳根→節點路徑
- `getTree()` 回傳 `SessionTreeNode[]`（`entry`、`children`、`label`）
  - 父節點連結轉換為子節點陣列
  - 缺少父節點的條目被視為根節點
  - 子節點按時間戳從舊到新排序
- `getChildren(parentId)` 回傳直接子節點
- `getLabel(id)` 從 `labelsById` 解析目前標籤

`getTree()` 是執行時投影；持久化仍然是僅追加的 JSONL 條目。

## 葉節點移動語意

有三個葉節點移動基本操作：

1. `branch(entryId)`
   - 驗證條目存在
   - 設定 `leafId = entryId`
   - 不寫入新條目

2. `resetLeaf()`
   - 設定 `leafId = null`
   - 下一次追加會建立新的根條目（`parentId = null`）

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - 接受 `branchFromId: string | null`
   - 設定 `leafId = branchFromId`
   - 追加一個 `branch_summary` 條目作為該葉節點的子節點
   - 當 `branchFromId` 為 `null` 時，`fromId` 會以 `"root"` 持久化

## `/tree` 導航行為（同一會話檔案）

`AgentSession.navigateTree()` 是導航，不是檔案分叉。

流程：

1. 驗證目標並計算被放棄的路徑（`collectEntriesForBranchSummary`）
2. 發送 `session_before_tree` 事件，附帶 `TreePreparation`
3. 可選擇性地摘要被放棄的條目（hook 提供的摘要或內建摘要器）
4. 計算新的葉節點目標：
   - 選擇 **user** 訊息：葉節點移動到其父節點，訊息文字回傳用於編輯器預填
   - 選擇 **custom_message**：與 user 訊息相同的規則（葉節點 = 父節點，文字預填編輯器）
   - 選擇任何其他條目：葉節點 = 選定的條目 id
5. 套用葉節點移動：
   - 有摘要時：`branchWithSummary(newLeafId, ...)`
   - 無摘要且 `newLeafId === null`：`resetLeaf()`
   - 其他情況：`branch(newLeafId)`
6. 從新葉節點重建代理上下文並發送 `session_tree` 事件

重要：摘要條目附加在**新的導航位置**，而非被放棄的分支末端。

## `/branch` 行為（新會話檔案）

`/branch` 和 `/tree` 是刻意不同的：

- `/tree` 在目前會話檔案內導航。
- `/branch` 建立新的會話分支檔案（或在非持久化模式下進行記憶體內替換）。

使用者面向的 `/branch` 流程（`SelectorController.showUserMessageSelector` → `AgentSession.branch`）：

- 分支來源必須是 **user 訊息**。
- 選定的使用者文字被擷取用於編輯器預填。
- 如果選定的 user 訊息是根節點（`parentId === null`）：透過 `newSession({ parentSession: previousSessionFile })` 開始新會話。
- 否則：`createBranchedSession(selectedEntry.parentId)` 將歷史記錄分叉到選定的提示邊界。

`SessionManager.createBranchedSession(leafId)` 具體細節：

- 透過 `getBranch(leafId)` 建構根→葉節點路徑；若缺少則拋出例外。
- 從複製的路徑中排除現有的 `label` 條目。
- 從已解析的 `labelsById` 為路徑中保留的條目重建新的標籤條目。
- 持久化模式：寫入新的 JSONL 檔案並切換管理器到該檔案；回傳新檔案路徑。
- 記憶體內模式：替換記憶體內條目；回傳 `undefined`。

## 上下文重建與摘要/自訂整合

`buildSessionContext()`（在 `session-manager.ts` 中）解析活動的根→葉節點路徑，並建構有效的 LLM 上下文狀態：

- 追蹤路徑上最新的 thinking/model/mode/ttsr 狀態。
- 處理路徑上最新的壓縮：
  - 首先發送壓縮摘要
  - 從 `firstKeptEntryId` 到壓縮點重播保留的訊息
  - 然後重播壓縮後的訊息
- 將 `branch_summary` 和 `custom_message` 條目包含為 `AgentMessage` 物件。

`session/messages.ts` 隨後為模型輸入映射這些訊息類型：

- `branchSummary` 和 `compactionSummary` 變成使用者角色的範本化上下文訊息
- `custom`/`hookMessage` 變成使用者角色的內容訊息

因此，樹的移動透過改變活動葉節點路徑來改變上下文，而非修改舊條目。

## 標籤與樹 UI 行為

標籤持久化：

- `appendLabelChange(targetId, label?)` 在目前葉節點鏈上寫入 `label` 條目。
- `labelsById` 會立即更新（設定或刪除）。
- `getTree()` 將目前標籤解析到每個回傳的節點上。

樹選擇器行為（`tree-selector.ts`）：

- 展平樹用於導航，保持活動路徑高亮，並優先顯示活動分支。
- 支援篩選模式：`default`、`no-tools`、`user-only`、`labeled-only`、`all`。
- 支援對已渲染語意內容的自由文字搜尋。
- `Shift+L` 開啟內嵌標籤編輯並透過 `appendLabelChange` 寫入。

命令路由：

- `/tree` 總是開啟樹選擇器。
- `/branch` 開啟 user 訊息選擇器，除非 `doubleEscapeAction=tree`，在這種情況下也使用樹選擇器 UX。

## 樹操作的擴充功能和 hook 接觸點

命令時擴充功能 API（`ExtensionCommandContext`）：

- `branch(entryId)` — 建立分支會話檔案
- `navigateTree(targetId, { summarize? })` — 在目前樹/檔案內移動

樹導航相關事件：

- `session_before_tree`
  - 接收 `TreePreparation`：
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - 可以取消導航
  - 可以提供摘要酬載取代內建摘要器
  - 接收中止 `signal`（Escape 取消路徑）
- `session_tree`
  - 發送 `newLeafId`、`oldLeafId`
  - 建立摘要時包含 `summaryEntry`
  - `fromExtension` 指示摘要來源

相鄰但相關的生命週期 hook：

- `session_before_branch` / `session_branch` 用於 `/branch` 流程
- `session_before_compact`、`session.compacting`、`session_compact` 用於稍後影響樹上下文重建的壓縮條目

## 實際限制和邊界條件

- `branch()` 不能指向 `null`；使用 `resetLeaf()` 來達到第一個條目之前的根狀態。
- `branchWithSummary()` 支援 `null` 目標並記錄 `fromId: "root"`。
- 在樹選擇器中選擇目前葉節點是無操作。
- 摘要需要活動模型；若不存在，摘要導航會快速失敗。
- 如果摘要被中止，導航會被取消且葉節點不變。
- 記憶體內會話從 `createBranchedSession` 永遠不會回傳分支檔案路徑。

## 仍然存在的舊版相容性

會話遷移在載入時仍然會執行：

- v1→v2 新增 `id`/`parentId` 並將壓縮索引錨點轉換為 id 錨點
- v2→v3 將舊版 `hookMessage` 角色遷移為 `custom`

目前的執行時行為是遷移後的第 3 版樹語意。
