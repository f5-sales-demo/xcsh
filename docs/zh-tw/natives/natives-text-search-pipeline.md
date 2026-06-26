---
title: 原生文字與搜尋管線
description: 基於 grep、glob 和 ripgrep 的原生文字搜尋管線，包含檔案內容索引功能。
sidebar:
  order: 6
  label: 文字與搜尋管線
i18n:
  sourceHash: 0e93462fdd12
  translator: machine
---

# 原生文字/搜尋管線

本文件對應 `@f5-sales-demo/pi-natives` 文字/搜尋介面（`grep`、`glob`、`text`、`highlight`），從 TypeScript 封裝到 Rust N-API 匯出，再回到 JS 結果物件的完整映射。

術語遵循 `docs/natives-architecture.md`：

- **封裝層（Wrapper）**：位於 `packages/natives/src/*` 中的 TS API
- **Rust 模組層**：位於 `crates/pi-natives/src/*` 中的 N-API 匯出
- **共享掃描快取**：由 `fs_cache` 支援的目錄條目快取，供探索/搜尋流程使用

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

## JS API ↔ Rust 匯出映射

| JS 封裝 API | Rust 匯出（`#[napi]`，snake_case -> camelCase） | Rust 模組 |
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

## 1) 正規表達式搜尋（`grep`、`searchContent`、`hasMatch`）

### 輸入/選項流程

1. TS 封裝層將選項轉發至原生層：
   - `grep/index.ts` 大部分選項保持不變傳入 `options`，並將回呼從 `(match) => void` 封裝為 napi 執行緒安全回呼格式 `(err, match)`。
   - `searchContent` 和 `hasMatch` 直接傳入字串/`Uint8Array`。
2. `grep.rs` 中的 Rust 選項結構體反序列化 camelCase 欄位（`ignoreCase`、`maxCount`、`contextBefore`、`contextAfter`、`maxColumns`、`timeoutMs`）。
3. `grep` 從 `timeoutMs` + `AbortSignal` 建立 `CancelToken`，並在 `task::blocking("grep", ...)` 內執行。

### 執行分支

- **記憶體內分支（純工具函式）**
  - `search` → `search_sync` → 對提供的內容位元組執行 `run_search`。
  - 無檔案系統掃描，不使用 `fs_cache`。
- **單一檔案分支（依賴檔案系統）**
  - `grep_sync` 解析路徑，檢查中繼資料確認為檔案，透過 ripgrep 匹配器串流處理每個檔案最多 `MAX_FILE_BYTES`（`4 MiB`）。
- **目錄分支（依賴檔案系統）**
  - 當 `cache: true` 時，透過 `fs_cache::get_or_scan` 進行可選的快取查詢。
  - 當 `cache: false` 時，透過 `fs_cache::force_rescan` 進行全新掃描。
  - 當快取時間超過 `empty_recheck_ms()` 時，可選的空結果重新檢查。
  - 條目過濾：僅限檔案 + 可選 glob 過濾器（`glob_util`）+ 可選類型過濾器映射（`js`、`ts`、`rust` 等）。

### 搜尋/收集語意

- 正規表達式引擎：`grep_regex::RegexMatcherBuilder`，支援 `ignoreCase` 和 `multiline`。
- 上下文解析：
  - `contextBefore/contextAfter` 覆蓋舊版 `context`。
  - 非內容模式會將上下文收集歸零。
- 輸出模式：
  - `content` => 每個匹配產生一個 `GrepMatch`。
  - `count` 和 `filesWithMatches` 都映射為計數式條目（`lineNumber=0`、`line=""`，設定 `matchCount`）。
- 限制：
  - 全域 `offset` 和 `maxCount` 跨檔案套用。
  - 僅當 `maxCount` 未設定且 `offset == 0` 時使用平行路徑；否則使用循序路徑以維持確定性的全域偏移/限制語意。

### 結果塑形回傳至 JS

- Rust `SearchResult`/`GrepResult` 欄位透過 N-API 物件欄位轉換映射至 TS 型別。
- 計數器在跨越 N-API 前會限縮至 `u32`。
- 可選布林值在某些路徑中僅在為 true 時才包含（`limitReached`）。
- 串流回呼接收每個已塑形的 `GrepMatch`（內容或計數條目）。

### 失敗行為

- `searchContent` 在正規表達式/搜尋失敗時回傳 `SearchResult.error`，而非拋出例外。
- `grep` 在硬性錯誤時拒絕（無效路徑、無效 glob/正規表達式、取消逾時/中止）。
- `hasMatch` 回傳 `Result<bool>`，在無效模式/UTF-8 解碼錯誤時拋出例外。
- 多檔案掃描中的檔案開啟/搜尋錯誤會按檔案跳過；掃描繼續進行。

### 格式錯誤的正規表達式處理

`grep.rs` 在正規表達式編譯前會清理大括號：

- 無效的重複式大括號會被跳脫（`{`/`}` -> `\{`/`\}`），當它們無法構成 `{N}`、`{N,}`、`{N,M}` 時。
- 這可防止常見的文字範本片段（例如 `${platform}`）因格式錯誤的重複而失敗。
- 其餘無效的正規表達式語法仍會回傳正規表達式錯誤。

## 2) 檔案探索（`glob`）與模糊路徑搜尋（`fuzzyFind`）

`glob` 和 `fuzzyFind` 共享 `fs_cache` 掃描；匹配邏輯不同。

### `glob` 流程

1. TS 封裝層（`glob/index.ts`）：
   - `path.resolve(options.path)`。
   - 預設值：`pattern="*"`、`hidden=false`、`gitignore=true`、`recursive=true`。
2. Rust `glob` 建構 `GlobConfig` 並透過 `glob_util::compile_glob` 編譯模式。
3. 條目來源：
   - `cache=true` => `get_or_scan` + 可選的過期空結果 `force_rescan`。
   - `cache=false` => `force_rescan(..., store=false)`（僅全新掃描）。
4. 過濾：
   - 始終跳過 `.git`。
   - 除非要求（`includeNodeModules` 或模式中提及 node_modules），否則跳過 `node_modules`。
   - 套用 glob 匹配。
   - 套用檔案類型過濾器；符號連結 `file/dir` 過濾器會解析目標中繼資料。
5. 在截斷至 `maxResults` 前，可選按 mtime 降序排序（`sortByMtime`）。

### `fuzzyFind` 流程（實作於 `fd.rs`）

1. TS 封裝層從 `grep` 模組匯出，但 Rust 實作位於 `fd.rs`。
2. 來自 `fs_cache` 的共享掃描來源，具有相同的快取/無快取分流和過期空結果重新檢查策略。
3. 評分：
   - 精確匹配 / 前綴匹配 / 包含 / 基於子序列的模糊評分
   - 分隔符號/標點符號正規化的評分路徑
   - 目錄加分和確定性的平分決策（`score desc`，然後 `path asc`）
4. 符號連結條目從模糊結果中排除。

### 失敗行為

- 無效的 glob 模式 => 從 `glob_util::compile_glob` 回傳錯誤。
- 搜尋根目錄必須是現有目錄（`resolve_search_path`），否則回傳錯誤。
- 取消/逾時透過迴圈中的 `CancelToken::heartbeat()` 檢查以中止錯誤傳播。

### 格式錯誤的 glob 處理

`glob_util::build_glob_pattern` 具有容錯性：

- 將 `\` 正規化為 `/`。
- 當 `recursive=true` 時，自動為簡單的遞迴模式加上 `**/` 前綴。
- 編譯前自動關閉未平衡的 `{...` 交替群組。

## 3) 共享掃描/快取生命週期（`fs_cache`）

`fs_cache` 將掃描結果儲存為正規化的相對條目（`path`、`fileType`、可選 `mtime`），鍵值由以下組成：

- 標準化搜尋根目錄
- `include_hidden`
- `use_gitignore`

### 快取狀態轉換

1. **未命中 / 停用**
   - TTL 為 `0` 或鍵值不存在/已過期 -> 全新 `collect_entries`。
2. **命中**
   - 條目年齡 `< cache_ttl_ms()` -> 回傳快取條目 + `cache_age_ms`。
3. **過期空結果重新檢查**（呼叫者在 `glob`/`grep`/`fd` 中的策略）
   - 若查詢產生零匹配且 `cache_age_ms >= empty_recheck_ms()`，則強制一次重新掃描。
4. **失效**
   - `invalidateFsScanCache(path?)`：
     - 無參數：清除所有鍵值
     - 路徑參數：移除根目錄為該目標路徑前綴的鍵值

### 過期結果的取捨

- 快取優先考慮重複掃描的低延遲，而非即時一致性。
- TTL 視窗可能回傳過期的正面/負面結果。
- 空結果重新檢查以一次額外掃描的代價，減少較舊快取掃描的過期負面結果。
- 明確的失效機制是檔案變更後預期的正確性鉤子。

## 4) ANSI 文字工具（`text`）

這些是純粹的記憶體內工具函式（無檔案系統掃描）。

### 邊界與職責

- **`text.rs` 擁有終端機儲存格語意**：
  - ANSI 序列解析
  - 字形感知的寬度和切片
  - 換行/截斷/清理行為
- **`grep.rs` 行截斷（`maxColumns`）是獨立的**：
  - 對匹配行進行簡單的字元邊界截斷，附加 `...`
  - 不保留 ANSI 狀態，也不感知終端機儲存格寬度

### 關鍵行為

- `wrapTextWithAnsi`：依可見寬度換行，將作用中的 SGR 代碼跨換行傳遞。
- `truncateToWidth`：可見儲存格截斷，具有省略號策略（`Unicode`、`Ascii`、`Omit`），可選右側填充，以及當未變更時回傳原始 JS 字串的快速路徑。
- `sliceWithWidth`：欄位切片，具有可選的嚴格寬度強制。
- `extractSegments`：擷取覆蓋區域周圍的前/後區段，同時為 `after` 區段還原 ANSI 狀態。
- `sanitizeText`：移除 ANSI 跳脫字元 + 控制字元，丟棄孤立代理對，透過移除 `\r` 正規化 CR/LF。
- `visibleWidth`：計算可見終端機儲存格數（製表符使用 Rust 實作中的固定 `TAB_WIDTH`）。

### 失敗行為

文字函式通常回傳確定性的轉換輸出；錯誤僅限於 JS 字串轉換邊界（N-API 參數轉換失敗）。

## 5) 語法高亮（`highlight`）

`highlight.rs` 是純轉換（無檔案系統、無快取）。

### 流程

1. 封裝層轉發 `code`、可選 `lang` 和 ANSI 色彩調色盤。
2. Rust 透過以下方式解析語法：
   - token/名稱查詢
   - 副檔名查詢
   - 別名表回退（`ts/tsx/js -> JavaScript` 等）
   - 無法解析時回退至純文字語法
3. 使用 syntect `ParseState` 和範疇堆疊解析每一行。
4. 將範疇映射至 11 個語意色彩類別，並注入/重設 ANSI 色彩代碼。

### 失敗行為

- 逐行解析失敗不會導致呼叫失敗：該行會以未高亮的方式附加，處理繼續進行。
- 未知/不支援的語言回退至純文字語法。

## 純工具函式 vs 依賴檔案系統的流程

| 流程 | 檔案系統存取 | 共享快取 | 備註 |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | 否 | 否 | 僅對提供的位元組/字串進行正規表達式匹配 |
| `text` 模組函式 | 否 | 否 | 僅 ANSI/寬度/清理 |
| `highlight` 模組函式 | 否 | 否 | 僅語法 + ANSI 著色 |
| `glob` | 是 | 可選 | 目錄掃描 + glob 過濾 |
| `fuzzyFind` | 是 | 可選 | 目錄掃描 + 模糊評分 |
| `grep`（檔案/目錄路徑） | 是 | 可選（目錄模式） | ripgrep 處理檔案，可選過濾器/回呼 |

## 端到端生命週期摘要

1. 呼叫者以型別化選項呼叫 TS 封裝層。
2. 封裝層正規化預設值（特別是 `glob`）並轉發至 `native.*` 匯出。
3. Rust 驗證/正規化選項並建構匹配器/搜尋設定。
4. 對於檔案系統流程，條目會被掃描（快取命中/未命中/重新掃描），然後進行過濾/評分。
5. 工作執行緒迴圈定期呼叫取消心跳；逾時/中止可終止執行。
6. Rust 將輸出塑形為 N-API 物件（`lineNumber`、`matchCount`、`limitReached` 等）。
7. TS 封裝層回傳型別化的 JS 物件（以及 `grep`/`glob` 的可選逐匹配回呼）。
