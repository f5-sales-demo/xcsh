---
title: 原生媒體與系統工具
description: 用於截圖、影像處理和系統資訊的原生媒體處理工具。
sidebar:
  order: 7
  label: 媒體與系統工具
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# 原生媒體 + 系統工具

本文件是 [`docs/natives-architecture.md`](./natives-architecture.md) 中描述的**系統/媒體/轉換原語**層的子系統深入探討：`image`、`html`、`clipboard` 和 `work` 效能分析。

## 實作檔案

- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/prof.rs`
- `crates/pi-natives/src/task.rs`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/work/index.ts`
- `packages/natives/src/work/types.ts`

> 注意：不存在 `crates/pi-natives/src/work.rs`；工作效能分析實作於 `prof.rs`，並由 `task.rs` 中的檢測機制提供資料。

## TS API ↔ Rust 匯出/模組對應

| TS 匯出 (packages/natives)                  | Rust N-API 匯出                                                         | Rust 模組                             |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + TS 備援邏輯                                        | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## 資料格式邊界與轉換

### 影像 (`image`)

- **JS 輸入邊界**：`Uint8Array` 編碼的影像位元組。
- **Rust 解碼邊界**：位元組被複製到 `Vec<u8>`，透過 `ImageReader::with_guessed_format()` 猜測格式，然後解碼為 `DynamicImage`。
- **記憶體中狀態**：`PhotonImage` 儲存 `Arc<DynamicImage>`。
- **輸出邊界**：`encode(format, quality)` 回傳 `Promise<Uint8Array>`（Rust `Vec<u8>`）。

格式 ID 為數值型：

- `0`：PNG
- `1`：JPEG
- `2`：WebP（無損編碼器）
- `3`：GIF

限制條件：

- `quality` 僅用於 JPEG。
- PNG/WebP/GIF 忽略 `quality`。
- 不支援的格式 ID 會失敗（`Invalid image format: <id>`）。

### HTML 轉換 (`html`)

- **JS 輸入邊界**：HTML `string` + 可選物件 `{ cleanContent?: boolean; skipImages?: boolean }`。
- **Rust 轉換邊界**：`String` 輸入由 `html_to_markdown_rs::convert` 轉換。
- **輸出邊界**：Markdown `string`。

轉換行為：

- `cleanContent` 預設為 `false`。
- 當 `cleanContent=true` 時，啟用 `PreprocessingPreset::Aggressive` 預處理及導覽/表單的強制移除旗標。
- `skipImages` 預設為 `false`。

### 剪貼簿 (`clipboard`)

- **文字路徑**：
  - TS 首先在 stdout 為 TTY 時發送 OSC 52（`\x1b]52;c;<base64>\x07`）。
  - 然後以盡力模式透過原生剪貼簿 API（`native.copyToClipboard`）嘗試相同文字。
  - 在 Termux 上，TS 會先嘗試 `termux-clipboard-set`。
- **影像讀取路徑**：
  - Rust 從 `arboard` 讀取原始影像。
  - Rust 將其重新編碼為 PNG 位元組（`image` crate），回傳 `{ data: Uint8Array, mimeType: "image/png" }`。
  - 在 Termux 或沒有顯示伺服器的 Linux 工作階段（缺少 `DISPLAY`/`WAYLAND_DISPLAY`）上，TS 會提前回傳 `null`。

### 工作效能分析 (`work`)

- **收集邊界**：效能分析樣本由 `task::blocking` 和 `task::future` 中的 `profile_region(tag)` 守衛產生。
- **儲存格式**：固定大小的環形緩衝區（`MAX_SAMPLES = 10_000`），儲存堆疊路徑 + 持續時間（`μs`）+ 時間戳記（`自程序啟動以來的 μs`）。
- **輸出邊界**：`getWorkProfile(lastSeconds)` 回傳物件：
  - `folded`：折疊堆疊文字（火焰圖輸入）
  - `summary`：Markdown 表格摘要
  - `svg`：可選的火焰圖 SVG
  - `totalMs`、`sampleCount`

## 生命週期與狀態轉換

### 影像生命週期

1. `PhotonImage.parse(bytes)` 排程一個阻塞式解碼任務（`image.decode`）。
2. 成功後，JS 中存在一個原生 `PhotonImage` 控制代碼。
3. `resize(...)` 建立一個新的原生控制代碼（`image.resize`），新舊控制代碼可同時存在。
4. `encode(...)` 實體化位元組（`image.encode`），不會變更影像尺寸。

失敗轉換：

- 格式偵測/解碼失敗會拒絕 parse promise。
- 編碼失敗會拒絕 encode promise。
- 無效的格式 ID 會拒絕 encode promise。

### HTML 生命週期

1. `htmlToMarkdown(html, options)` 排程一個阻塞式轉換任務。
2. 除非另行指定，否則使用預設選項（`cleanContent=false`、`skipImages=false`）執行轉換。
3. 回傳 Markdown 字串或拒絕。

失敗轉換：

- 轉換器失敗回傳被拒絕的 promise（`Conversion error: ...`）。

### 剪貼簿生命週期

`copyToClipboard(text)` 刻意採用盡力模式和多路徑：

1. 若為 TTY：嘗試 OSC 52 寫入（base64 負載）。
2. 當設定了 `TERMUX_VERSION` 時嘗試 Termux 命令。
3. 嘗試原生 `arboard` 文字複製。
4. 在 TS 層吞噬錯誤。

`readImageFromClipboard()` 在不同階段的嚴格程度有所不同：

1. TS 對不支援的執行環境（Termux/無圖形界面 Linux）硬性閘控為 `null`。
2. Rust `arboard` 讀取僅在 TS 允許時執行。
3. `ContentNotAvailable` 對應到 `null`。
4. 其他 Rust 錯誤會拒絕。

### 工作效能分析生命週期

1. 無需明確啟動：當任務輔助程式執行時，效能分析始終開啟。
2. 每個受檢測的任務範圍在守衛銷毀時記錄一個樣本。
3. 緩衝區容量達上限後，樣本會覆寫最舊的條目。
4. `getWorkProfile(lastSeconds)` 讀取時間視窗並衍生折疊/摘要/SVG 產物。

失敗轉換：

- SVG 生成失敗為軟性失敗（`svg: null`），折疊資料和摘要仍會回傳。
- 空的樣本視窗回傳空的折疊資料和 `svg: null`，而非錯誤。

## 不支援的操作與錯誤傳播

### 影像

- 不支援的解碼輸入或損壞的位元組：嚴格失敗（promise 拒絕）。
- 不支援的編碼格式 ID：嚴格失敗。
- TS 包裝器中沒有盡力模式的備援路徑。

### HTML

- 轉換錯誤為嚴格失敗（拒絕）。
- 省略選項為盡力模式的預設值設定，而非失敗。

### 剪貼簿

- 文字複製在 TS 層為盡力模式：操作失敗會被抑制。
- 影像讀取區分「無影像」（`null`）和操作失敗（拒絕）。
- Termux/無圖形界面 Linux 被視為影像讀取的不支援環境（`null`）。

### 工作效能分析

- 函式呼叫本身的擷取為嚴格模式，但產物生成為部分盡力模式（`svg` 可為 null）。
- 緩衝區截斷為預期行為（環形緩衝區），而非資料遺失的錯誤。

## 平台注意事項

- **剪貼簿文字**：OSC 52 取決於終端機支援；原生剪貼簿存取取決於桌面環境/工作階段。
- **剪貼簿影像讀取**：在 Termux 和沒有顯示伺服器的 Linux 上，於 TS 層被封鎖。
