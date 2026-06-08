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

# 會話樹架構（當前）

參考：[session.md](./session.md)

本文件描述會話樹導航目前的運作方式：記憶體內樹模型、葉節點移動規則、分支行為，以及擴充功能/事件整合。

## 此子系統是什麼

會話以僅追加的條目日誌形式儲存，但執行時行為是基於樹結構的：

- 每個非標頭條目都有 `id` 和 `parentId`。
- 活動位置是 `SessionManager` 中的 `leafId`。
- 追加條目時總是建立當前葉節點的子節點。
- 分支**不會**重寫歷史；它只會在下次追加之前改變葉節點指向的位置。

關鍵檔案：

- `src/session/session-manager.ts` — 樹資料模型、遍歷、葉節點移動、分支/會話擷取
- `src/session/agent-session.ts` — `/tree` 導航流程、摘要生成、鉤子/事件發射
- `src/modes/components/tree-selector.ts` — 互動式樹 UI 行為與過濾
- `src/modes/controllers/selector-controller.ts` — `/tree` 和 `/branch` 的選擇器協調
- `src/modes/controllers/input-controller.ts` — 命令路由（`/tree`、`/branch`、雙擊 Escape 行為）
- `src/session/messages.ts` — 將 `branch_summary`、`compaction` 和 `custom_message` 條目轉換為 LLM 上下文訊息

## `SessionManager` 中的樹資料模型

執行時索引：

- `#byId: Map<string, SessionEntry>` — 對任何條目的快速查找
- `#leafId: string | null` — 樹中的當前位置
- `#labelsById: Map<string, string>` — 依目標條目 id 解析的標籤

樹 API：

- `getBranch(fromId?)` 沿父連結走到根節點並返回根→節點路徑
- `getTree()` 返回 `SessionTreeNode[]`（`entry`、`children`、`label`）
  - 父連結轉換為子陣列
  - 缺少父節點的條目被視為根節點
  - 子節點按時間戳從最舊到最新排序
- `getChildren(parentId)` 返回直接子節點
- `getLabel(id)` 從 `labelsById` 解析當前標籤

`getTree()` 是執行時投影；持久化仍為僅追加的 JSONL 條目。

## 葉節點移動語義

有三個葉節點移動原語：

1. `branch(entryId)`
   - 驗證條目存在
   - 設定 `leafId = entryId`
   - 不寫入新條目

2. `resetLeaf()`
   - 設定 `leafId = null`
   - 下次追加會建立新的根條目（`parentId = null`）

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - 接受 `branchFromId: string | null`
   - 設定 `leafId = branchFromId`
   - 追加一個 `branch_summary` 條目作為該葉節點的子節點
   - 當 `branchFromId` 為 `null` 時，`fromId` 會持久化為 `"root"`

## `/tree` 導航行為（同一會話檔案內）

`AgentSession.navigateTree()` 是導航，不是檔案分叉。

流程：

1. 驗證目標並計算被放棄的路徑（`collectEntriesForBranchSummary`）
2. 發射帶有 `TreePreparation` 的 `session_before_tree` 事件
3. 可選地對被放棄的條目進行摘要（鉤子提供的摘要或內建摘要器）
4. 計算新的葉節點目標：
   - 選擇 **user** 訊息：葉節點移動到其父節點，訊息文字返回用於編輯器預填
   - 選擇 **custom_message**：與 user 訊息相同的規則（葉節點 = 父節點，文字預填編輯器）
   - 選擇任何其他條目：葉節點 = 所選條目 id
5. 套用葉節點移動：
   - 有摘要時：`branchWithSummary(newLeafId, ...)`
   - 無摘要且 `newLeafId === null` 時：`resetLeaf()`
   - 否則：`branch(newLeafId)`
6. 從新葉節點重建代理上下文並發射 `session_tree` 事件

重要：摘要條目附加在**新的導航位置**，而非被放棄的分支尾端。

## `/branch` 行為（新會話檔案）

`/branch` 和 `/tree` 是刻意不同的：

- `/tree` 在當前會話檔案內導航。
- `/branch` 建立新的會話分支檔案（或在非持久化模式下進行記憶體內替換）。

使用者面向的 `/branch` 流程（`SelectorController.showUserMessageSelector` → `AgentSession.branch`）：

- 分支來源必須是 **user 訊息**。
- 擷取所選使用者文字用於編輯器預填。
- 如果所選 user 訊息是根節點（`parentId === null`）：透過 `newSession({ parentSession: previousSessionFile })` 開始新會話。
- 否則：`createBranchedSession(selectedEntry.parentId)` 在所選提示邊界處分叉歷史。

`SessionManager.createBranchedSession(leafId)` 的具體內容：

- 透過 `getBranch(leafId)` 建立根→葉路徑；如缺失則拋出錯誤。
- 從複製路徑中排除現有的 `label` 條目。
- 為路徑中保留的條目從已解析的 `labelsById` 重建新的標籤條目。
- 持久化模式：寫入新的 JSONL 檔案並切換管理器到該檔案；返回新檔案路徑。
- 記憶體內模式：替換記憶體內條目；返回 `undefined`。

## 上下文重建與摘要/自訂整合

`buildSessionContext()`（在 `session-manager.ts` 中）解析活動的根→葉路徑並建立有效的 LLM 上下文狀態：

- 追蹤路徑上最新的 thinking/model/mode/ttsr 狀態。
- 處理路徑上最新的壓縮：
  - 先發射壓縮摘要
  - 從 `firstKeptEntryId` 到壓縮點重放保留的訊息
  - 然後重放壓縮後的訊息
- 將 `branch_summary` 和 `custom_message` 條目包含為 `AgentMessage` 物件。

`session/messages.ts` 接著將這些訊息類型對映為模型輸入：

- `branchSummary` 和 `compactionSummary` 成為 user 角色的模板化上下文訊息
- `custom`/`hookMessage` 成為 user 角色的內容訊息

因此，樹的移動是透過改變活動葉路徑來改變上下文，而非修改舊條目。

## 標籤與樹 UI 行為

標籤持久化：

- `appendLabelChange(targetId, label?)` 在當前葉節點鏈上寫入 `label` 條目。
- `labelsById` 會立即更新（設定或刪除）。
- `getTree()` 將當前標籤解析到每個返回的節點上。

樹選擇器行為（`tree-selector.ts`）：

- 將樹扁平化以供導航，保持活動路徑高亮，並優先顯示活動分支。
- 支援過濾模式：`default`、`no-tools`、`user-only`、`labeled-only`、`all`。
- 支援對已渲染語義內容的自由文字搜尋。
- `Shift+L` 開啟內嵌標籤編輯並透過 `appendLabelChange` 寫入。

命令路由：

- `/tree` 總是開啟樹選擇器。
- `/branch` 開啟 user 訊息選擇器，除非 `doubleEscapeAction=tree`，此時也使用樹選擇器 UX。

## 樹操作的擴充功能與鉤子接觸點

命令時擴充功能 API（`ExtensionCommandContext`）：

- `branch(entryId)` — 建立分支會話檔案
- `navigateTree(targetId, { summarize? })` — 在當前樹/檔案內移動

樹導航相關事件：

- `session_before_tree`
  - 接收 `TreePreparation`：
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - 可以取消導航
  - 可以提供摘要酬載以替代內建摘要器
  - 接收中止 `signal`（Escape 取消路徑）
- `session_tree`
  - 發射 `newLeafId`、`oldLeafId`
  - 建立摘要時包含 `summaryEntry`
  - `fromExtension` 指示摘要來源

相鄰但相關的生命週期鉤子：

- `session_before_branch` / `session_branch` 用於 `/branch` 流程
- `session_before_compact`、`session.compacting`、`session_compact` 用於後續影響樹上下文重建的壓縮條目

## 實際限制與邊界條件

- `branch()` 不能以 `null` 為目標；使用 `resetLeaf()` 來達到首條目之前的根狀態。
- `branchWithSummary()` 支援 `null` 目標並記錄 `fromId: "root"`。
- 在樹選擇器中選擇當前葉節點是無操作。
- 摘要生成需要活動模型；如果缺少，摘要導航會快速失敗。
- 如果摘要生成被中止，導航會被取消且葉節點不變。
- 記憶體內會話的 `createBranchedSession` 永遠不會返回分支檔案路徑。

## 仍存在的舊版相容性

會話遷移仍在載入時執行：

- v1→v2 添加 `id`/`parentId` 並將壓縮索引錨點轉換為 id 錨點
- v2→v3 將舊版 `hookMessage` 角色遷移為 `custom`

遷移後的當前執行時行為是版本 3 的樹語義。
