---
title: 原生文字與搜尋管線
description: 基於 grep、glob 和 ripgrep 的原生文字搜尋管線，包含檔案內容索引功能。
sidebar:
  order: 6
  label: 文字與搜尋管線
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# 原生文字/搜尋管線

本文件將 `@f5xc-salesdemos/pi-natives` 文字/搜尋介面（`grep`、`glob`、`text`、`highlight`）從 TypeScript 包裝器對應到 Rust N-API 匯出，再回到 JS 結果物件。

術語遵循 `docs/natives-architecture.md`：

- **Wrapper**：位於 `packages/natives/src/*` 的 TS API
- **Rust 模組層**：位於 `crates/pi-natives/src/*` 的 N-API 匯出
- **共享掃描快取**：由 `fs_cache` 支援的目錄項目快取，用於探索/搜尋流程

## 實作檔案

- `packages/natives/src/grep/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/highlight/types.ts`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/glob_util.rs`
- `crates/pi-natives/src/fs_cache.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/highlight.rs`
- `crates/pi-natives/src/fd.rs`

## JS API ↔ Rust 匯出對應

| JS 包裝器 API | Rust 匯出（`#[napi]`，snake_case -> camelCase） | Rust 模組 |
| --- | --- | --- |
| `grep(options, onMatch?)` | `grep` | `grep.rs` |
| `searchContent(content, options)` | `search` | `grep.rs` |
| `hasMatch(content, pattern, options?)` | `hasMatch` | `grep.rs` |
| `fuzzyFind(options)` | `fuzzyFind` | `fd.rs` |
| `glob(options, onMatch?)` | `glob` | `glob.rs` |
| `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `fs_cache.rs` |
| `wrapTextWithAnsi(text, width)` | `wrapTextWithAnsi` | `text.rs` |
| `truncateToWidth(text, maxWidth, ellipsis, pad)` | `truncateToWidth` | `text.rs` |
| `sliceWithWidth(line, startCol, length, strict?)` | `sliceWithWidth` | `text.rs` |
| `extractSegments(line, beforeEnd, afterStart, afterLen, strictAfter)` | `extractSegments` | `text.rs` |
| `sanitizeText(text)` | `sanitizeText` | `text.rs` |
| `visibleWidth(text)` | `visibleWidth` | `text.rs` |
| `highlightCode(code, lang, colors)` | `highlightCode` | `highlight.rs` |
| `supportsLanguage(lang)` | `supportsLanguage` | `highlight.rs` |
| `getSupportedLanguages()` | `getSupportedLanguages` | `highlight.rs` |

## 各子系統管線概覽

## 1) 正規表示式搜尋（`grep`、`searchContent`、`hasMatch`）

### 輸入/選項流程

1. TS 包裝器將選項轉發至原生層：
   - `grep/index.ts` 幾乎原封不動地傳遞 `options`，並將回呼從 `(match) => void` 包裝為 napi 執行緒安全回呼形式 `(err, match)`。
   - `searchContent` 和 `hasMatch` 直接傳遞字串/`Uint8Array`。
2. `grep.rs` 中的 Rust 選項結構體反序列化 camelCase 欄位（`ignoreCase`、`maxCount`、`contextBefore`、`contextAfter`、`maxColumns`、`timeoutMs`）。
3. `grep` 從 `timeoutMs` + `AbortSignal` 建立 `CancelToken`，並在 `task::blocking("grep", ...)` 中執行。

### 執行分支

- **記憶體內分支（純工具）**
  - `search` → `search_sync` → 對提供的內容位元組執行 `run_search`。
  - 無檔案系統掃描，無 `fs_cache`。
- **單一檔案分支（依賴檔案系統）**
  - `grep_sync` 解析路徑，檢查中繼資料為檔案，透過 ripgrep 比對器串流處理每個檔案最多 `MAX_FILE_BYTES`（`4 MiB`）。
- **目錄分支（依賴檔案系統）**
  - 當 `cache: true` 時，透過 `fs_cache::get_or_scan` 進行可選的快取查詢。
  - 當 `cache: false` 時，透過 `fs_cache::force_rescan` 進行全新掃描。
  - 當快取存活時間超過 `empty_recheck_ms()` 時，可選的空結果重新檢查。
  - 項目過濾：僅檔案 + 可選的 glob 過濾器（`glob_util`）+ 可選的類型過濾器對應（`js`、`ts`、`rust` 等）。

### 搜尋/收集語義

- 正規表示式引擎：`grep_regex::RegexMatcherBuilder`，支援 `ignoreCase` 和 `multiline`。
- 上下文解析：
  - `contextBefore/contextAfter` 覆蓋舊版 `context`。
  - 非內容模式會將上下文收集歸零。
- 輸出模式：
  - `content` => 每個命中產生一個 `GrepMatch`。
  - `count` 和 `filesWithMatches` 都對應到計數樣式的項目（`lineNumber=0`、`line=""`、`matchCount` 已設定）。
- 限制：
  - 全域 `offset` 和 `maxCount` 跨檔案套用。
  - 只有在 `maxCount` 未設定且 `offset == 0` 時才使用平行路徑；否則循序路徑會保留確定性的全域偏移/限制語義。

### 結果塑形回到 JS

- Rust `SearchResult`/`GrepResult` 欄位透過 N-API 物件欄位轉換對應到 TS 類型。
- 計數器在跨越 N-API 之前被限制為 `u32`。
- 可選的布林值在某些路徑中除非為 true 否則會被省略（`limitReached`）。
- 串流回呼接收每個已塑形的 `GrepMatch`（內容或計數項目）。

### 失敗行為

- `searchContent` 對正規表示式/搜尋失敗回傳 `SearchResult.error`，而非拋出例外。
- `grep` 在硬錯誤時拒絕（無效路徑、無效 glob/正規表示式、取消逾時/中止）。
- `hasMatch` 回傳 `Result<bool>`，並在無效模式/UTF-8 解碼錯誤時拋出例外。
- 多檔案掃描中的檔案開啟/搜尋錯誤會按檔案跳過；掃描繼續進行。

### 格式錯誤的正規表示式處理

`grep.rs` 在正規表示式編譯前清理大括號：

- 當無法形成 `{N}`、`{N,}`、`{N,M}` 時，無效的重複式大括號會被跳脫（`{`/`}` -> `\{`/`\}`）。
- 這可防止常見的字面範本片段（例如 `${platform}`）因格式錯誤的重複而失敗。
- 其餘無效的正規表示式語法仍會回傳正規表示式錯誤。

## 2) 檔案探索（`glob`）與模糊路徑搜尋（`fuzzyFind`）

`glob` 和 `fuzzyFind` 共享 `fs_cache` 掃描；比對邏輯不同。

### `glob` 流程

1. TS 包裝器（`glob/index.ts`）：
   - `path.resolve(options.path)`。
   - 預設值：`pattern="*"`、`hidden=false`、`gitignore=true`、`recursive=true`。
2. Rust `glob` 建構 `GlobConfig` 並透過 `glob_util::compile_glob` 編譯模式。
3. 項目來源：
   - `cache=true` => `get_or_scan` + 可選的過期空結果 `force_rescan`。
   - `cache=false` => `force_rescan(..., store=false)`（僅全新掃描）。
4. 過濾：
   - 永遠跳過 `.git`。
   - 除非要求，否則跳過 `node_modules`（`includeNodeModules` 或模式中提及 node_modules）。
   - 套用 glob 比對。
   - 套用檔案類型過濾器；符號連結的 `file/dir` 過濾器解析目標中繼資料。
5. 在截斷至 `maxResults` 之前，可選按 mtime 降序排序（`sortByMtime`）。

### `fuzzyFind` 流程（實作於 `fd.rs`）

1. TS 包裝器從 `grep` 模組匯出，但 Rust 實作位於 `fd.rs`。
2. 來自 `fs_cache` 的共享掃描來源，具有相同的快取/無快取分割和過期空結果重新檢查策略。
3. 評分：
   - 完全匹配 / 開頭匹配 / 包含匹配 / 基於子序列的模糊評分
   - 分隔符/標點符號正規化的評分路徑
   - 目錄加分和確定性平局決勝（`score desc`，然後 `path asc`）
4. 符號連結項目會從模糊結果中排除。

### 失敗行為

- 無效 glob 模式 => 來自 `glob_util::compile_glob` 的錯誤。
- 搜尋根目錄必須是現有目錄（`resolve_search_path`），否則錯誤。
- 取消/逾時透過迴圈中的 `CancelToken::heartbeat()` 檢查以中止錯誤傳播。

### 格式錯誤的 glob 處理

`glob_util::build_glob_pattern` 具有容錯性：

- 將 `\` 正規化為 `/`。
- 當 `recursive=true` 時，自動為簡單遞迴模式加上 `**/` 前綴。
- 在編譯前自動關閉不平衡的 `{...` 交替群組。

## 3) 共享掃描/快取生命週期（`fs_cache`）

`fs_cache` 將掃描結果儲存為正規化的相對項目（`path`、`fileType`、可選的 `mtime`），以下列項目作為鍵值：

- 正規化的搜尋根目錄
- `include_hidden`
- `use_gitignore`

### 快取狀態轉換

1. **未命中 / 已停用**
   - TTL 為 `0` 或鍵值不存在/已過期 -> 全新 `collect_entries`。
2. **命中**
   - 項目存活時間 `< cache_ttl_ms()` -> 回傳快取項目 + `cache_age_ms`。
3. **過期空結果重新檢查**（`glob`/`grep`/`fd` 中的呼叫者策略）
   - 如果查詢產生零個匹配且 `cache_age_ms >= empty_recheck_ms()`，則強制執行一次重新掃描。
4. **失效**
   - `invalidateFsScanCache(path?)`：
     - 無參數：清除所有鍵值
     - 路徑參數：移除根目錄為該目標路徑前綴的鍵值

### 過期結果權衡

- 快取優先考慮重複掃描的低延遲，而非即時一致性。
- TTL 時間窗口可能回傳過期的正面/負面結果。
- 空結果重新檢查以一次額外掃描為代價，降低較舊快取掃描的過期負面結果。
- 明確的失效是檔案變更後預期的正確性鉤子。

## 4) ANSI 文字工具（`text`）

這些是純粹的記憶體內工具（無檔案系統掃描）。

### 邊界與職責

- **`text.rs` 負責終端儲存格語義**：
  - ANSI 序列解析
  - 字素感知的寬度和切片
  - 換行/截斷/清理行為
- **`grep.rs` 行截斷（`maxColumns`）是分開的**：
  - 使用 `...` 對匹配行進行簡單的字元邊界截斷
  - 不保留 ANSI 狀態，也不感知終端儲存格寬度

### 關鍵行為

- `wrapTextWithAnsi`：按可見寬度換行，在換行的行之間攜帶活動的 SGR 代碼。
- `truncateToWidth`：可見儲存格截斷，支援省略號策略（`Unicode`、`Ascii`、`Omit`）、可選的右填充，以及當未變更時回傳原始 JS 字串的快速路徑。
- `sliceWithWidth`：欄切片，支援可選的嚴格寬度強制執行。
- `extractSegments`：在覆蓋層周圍提取前/後片段，同時為 `after` 片段還原 ANSI 狀態。
- `sanitizeText`：移除 ANSI 跳脫序列 + 控制字元，丟棄孤立的代理對，透過移除 `\r` 正規化 CR/LF。
- `visibleWidth`：計算可見的終端儲存格（定位字元使用 Rust 實作中的固定 `TAB_WIDTH`）。

### 失敗行為

文字函式通常回傳確定性的轉換輸出；錯誤僅限於 JS 字串轉換邊界（N-API 參數轉換失敗）。

## 5) 語法高亮（`highlight`）

`highlight.rs` 是純轉換（無檔案系統、無快取）。

### 流程

1. 包裝器轉發 `code`、可選的 `lang` 和 ANSI 色彩調色盤。
2. Rust 透過以下方式解析語法：
   - 標記/名稱查詢
   - 副檔名查詢
   - 別名表回退（`ts/tsx/js -> JavaScript` 等）
   - 無法解析時回退為純文字語法
3. 使用 syntect `ParseState` 和範圍堆疊解析每一行。
4. 將範圍對應到 11 個語義色彩類別，並注入/重設 ANSI 色彩代碼。

### 失敗行為

- 每行解析失敗不會導致呼叫失敗：該行以未高亮方式附加，處理繼續進行。
- 未知/不支援的語言回退為純文字語法。

## 純工具 vs 依賴檔案系統的流程

| 流程 | 檔案系統存取 | 共享快取 | 備註 |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | 否 | 否 | 僅對提供的位元組/字串進行正規表示式操作 |
| `text` 模組函式 | 否 | 否 | 僅 ANSI/寬度/清理 |
| `highlight` 模組函式 | 否 | 否 | 僅語法 + ANSI 上色 |
| `glob` | 是 | 可選 | 目錄掃描 + glob 過濾 |
| `fuzzyFind` | 是 | 可選 | 目錄掃描 + 模糊評分 |
| `grep`（檔案/目錄路徑） | 是 | 可選（目錄模式） | 對檔案執行 ripgrep，可選過濾器/回呼 |

## 端對端生命週期摘要

1. 呼叫者使用具型別的選項叫用 TS 包裝器。
2. 包裝器正規化預設值（特別是 `glob`）並轉發至 `native.*` 匯出。
3. Rust 驗證/正規化選項並建構比對器/搜尋組態。
4. 對於檔案系統流程，項目會被掃描（快取命中/未命中/重新掃描），然後過濾/評分。
5. 工作迴圈定期呼叫取消心跳；逾時/中止可以終止執行。
6. Rust 將輸出塑形為 N-API 物件（`lineNumber`、`matchCount`、`limitReached` 等）。
7. TS 包裝器回傳具型別的 JS 物件（以及 `grep`/`glob` 的可選逐匹配回呼）。
