---
title: 檔案系統掃描快取架構
description: 檔案系統掃描快取契約，用於快速檔案探索，具備 stale-while-revalidate 語意。
sidebar:
  order: 8
  label: 檔案系統掃描快取
i18n:
  sourceHash: 2a2bde1726ac
  translator: machine
---

# 檔案系統掃描快取架構契約

本文件定義了以 Rust 實作的共享檔案系統掃描快取（`crates/pi-natives/src/fs_cache.rs`）的現行契約，並由暴露給 `packages/coding-agent` 的原生探索/搜尋 API 所使用。

## 此快取的用途

快取儲存完整的目錄掃描項目列表（`GlobMatch[]`），以掃描範圍和遍歷策略作為鍵值，然後讓更高層級的操作（glob 過濾、模糊評分、grep 檔案選取）針對這些快取項目執行。

主要目標：

- 避免重複的探索/搜尋呼叫對檔案系統進行重複走訪
- 當 `glob`、`fuzzyFind` 和 `grep` 共享相同掃描策略時，保持一致性
- 允許對空結果進行明確的過期恢復，以及在檔案變動後進行明確的失效處理

## 所有權與公開介面

- 快取實作與策略：`crates/pi-natives/src/fs_cache.rs`
- 原生消費者：
  - `crates/pi-natives/src/glob.rs`
  - `crates/pi-natives/src/fd.rs`（`fuzzyFind`）
  - `crates/pi-natives/src/grep.rs`
- JS 綁定/匯出：
  - `packages/natives/src/glob/index.ts`（`invalidateFsScanCache`）
  - `packages/natives/src/glob/types.ts`
  - `packages/natives/src/grep/types.ts`
- Coding-agent 變動失效輔助工具：
  - `packages/coding-agent/src/tools/fs-cache-invalidation.ts`

## 快取鍵值分區（硬性契約）

每個項目以下列條件作為鍵值：

- 正規化的 `root` 目錄路徑
- `include_hidden` 布林值
- `use_gitignore` 布林值

影響：

- 隱藏檔案與非隱藏檔案的掃描**不會**共享項目。
- 遵循 gitignore 與停用 ignore 的掃描**不會**共享項目。
- 消費者必須傳遞穩定的隱藏檔案/gitignore 行為語意；變更任一旗標會建立不同的快取分區。

`node_modules` 的包含與否**不在**快取鍵值中。快取儲存包含 `node_modules` 的項目；每個消費者的過濾在擷取後套用。

## 掃描收集行為

快取填充使用確定性走訪器（`ignore::WalkBuilder`），由 `include_hidden` 和 `use_gitignore` 配置：

- `follow_links(false)`
- 按檔案路徑排序
- `.git` 始終被跳過
- `node_modules` 在快取掃描時始終被收集（之後可選擇性過濾）
- 項目的檔案類型 + `mtime` 透過 `symlink_metadata` 擷取

搜尋根目錄由 `resolve_search_path` 解析：

- 相對路徑根據當前 cwd 解析
- 目標必須是現有目錄
- 根目錄在可能時進行正規化

## 新鮮度與驅逐策略

全域策略（可透過環境變數覆寫）：

- `FS_SCAN_CACHE_TTL_MS`（預設 `1000`）
- `FS_SCAN_EMPTY_RECHECK_MS`（預設 `200`）
- `FS_SCAN_CACHE_MAX_ENTRIES`（預設 `16`）

行為：

- `get_or_scan(...)`
  - 若 TTL 為 `0`：完全繞過快取，始終進行全新掃描（`cache_age_ms = 0`）
  - 在 TTL 內命中快取：回傳快取項目 + 非零的 `cache_age_ms`
  - 命中但已過期：驅逐鍵值，重新掃描，儲存新項目
- 最大項目數強制執行為依 `created_at` 最舊優先驅逐

## 空結果快速重新檢查（與正常命中分開）

正常快取命中：

- TTL 內的快取命中回傳快取項目，不做其他處理。

空結果快速重新檢查：

- 這是**呼叫端**策略，使用 `ScanResult.cache_age_ms`
- 若過濾/查詢結果為空，且快取掃描年齡至少為 `empty_recheck_ms()`，呼叫端執行一次 `force_rescan(...)` 並重試
- 旨在減少當檔案最近新增但快取仍在 TTL 內時的過期否定結果

目前的消費者：

- `glob`：當過濾匹配為空且掃描年齡超過閾值時重新檢查
- `fuzzyFind`（`fd.rs`）：僅在查詢非空且評分匹配為空時重新檢查
- `grep`：當選取的候選檔案列表為空時重新檢查

## 消費者預設值與快取使用

快取在所有暴露的 API 上為選擇性啟用（`cache?: boolean`，預設 `false`）。

原生 API 中的當前預設值：

- `glob`：`hidden=false`、`gitignore=true`、`cache=false`
- `fuzzyFind`：`hidden=false`、`gitignore=true`、`cache=false`
- `grep`：`hidden=true`、`cache=false`，且快取掃描始終使用 `use_gitignore=true`

目前的 Coding-agent 呼叫者：

- 高流量提及候選探索啟用快取：
  - `packages/coding-agent/src/utils/file-mentions.ts`
  - 設定檔：`hidden=true`、`gitignore=true`、`includeNodeModules=true`、`cache=true`
- 工具層級的 `grep` 整合目前停用掃描快取（`cache: false`）：
  - `packages/coding-agent/src/tools/grep.ts`

## 失效契約

原生失效進入點：

- `invalidateFsScanCache(path?: string)`
  - 有 `path`：移除根目錄為目標路徑前綴的快取項目
  - 無 path：清除所有掃描快取項目

路徑處理細節：

- 相對失效路徑根據 cwd 解析
- 失效嘗試正規化
- 若目標不存在（例如刪除），退回方案為正規化父目錄並在可能時重新附加檔名
- 這保留了建立/刪除/重新命名中一側可能不存在時的失效行為

## Coding-agent 變動流程責任

Coding-agent 程式碼必須在成功的檔案系統變動後進行失效處理。

中央輔助工具：

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)`（當路徑不同時對兩側進行失效處理）

目前的變動工具呼叫點：

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts`（hashline/patch/replace 流程）

規則：若某個流程變動了檔案系統內容或位置且繞過這些輔助工具，預期會出現快取過期錯誤。

## 安全新增快取消費者

在新的掃描器/搜尋路徑中引入快取使用時：

1. **使用穩定的掃描策略輸入**
   - 先決定隱藏檔案/gitignore 語意
   - 一致地傳遞給 `get_or_scan`/`force_rescan`，使快取分區具有意圖性

2. **將快取資料視為僅依遍歷策略預先過濾**
   - 在擷取後套用工具特定的過濾（glob 模式、類型過濾器、node_modules 規則）
   - 永遠不要假設快取項目已經反映您的更高層級過濾器

3. **僅在有過期否定風險時實作空結果快速重新檢查**
   - 使用 `scan.cache_age_ms >= empty_recheck_ms()`
   - 以 `force_rescan(..., store=true, ...)` 重試一次
   - 將此路徑與正常的快取命中邏輯分開

4. **明確遵循無快取模式**
   - 當呼叫端停用快取時，呼叫 `force_rescan(..., store=false, ...)`
   - 在無快取請求路徑中不要填充共享快取

5. **為任何新的寫入路徑接線變動失效**
   - 在成功的寫入/編輯/刪除/重新命名後，呼叫 coding-agent 失效輔助工具
   - 對於重新命名/移動，對舊路徑和新路徑都進行失效處理

6. **不要新增每次呼叫的 TTL 調節旋鈕**
   - 目前的契約僅為全域策略（環境變數配置），無每次請求的 TTL 覆寫

## 已知邊界

- 快取範圍為程序本地記憶體內（`DashMap`），不會跨程序重啟持久化。
- 快取儲存掃描項目，而非最終工具結果。
- `glob`/`fuzzyFind`/`grep` 僅在鍵值維度（`root`、`hidden`、`gitignore`）匹配時共享掃描項目。
- `.git` 在掃描收集時始終被排除，不論呼叫者選項為何。
