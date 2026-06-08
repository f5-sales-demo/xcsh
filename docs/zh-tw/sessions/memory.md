---
title: 自主記憶
description: 自主記憶系統，用於在不同工作階段之間持久化使用者偏好、專案上下文和回饋。
sidebar:
  order: 7
  label: 自主記憶
i18n:
  sourceHash: 2aa9f516aa1e
  translator: machine
---

# 自主記憶

啟用後，代理會自動從過去的工作階段中提取持久性知識，並將精簡摘要注入到每個新工作階段中。隨著時間推移，它會建立一個專案範圍的記憶儲存——技術決策、反覆出現的工作流程、常見陷阱——無需手動操作即可持續累積。

預設為停用。可透過 `/settings` 或 `config.yml` 啟用：

```yaml
memories:
  enabled: true
```

## 使用方式

### 注入的內容

在工作階段開始時，如果當前專案存在記憶摘要，它會以 **Memory Guidance** 區塊的形式注入到系統提示中。代理會被指示：

- 將記憶視為啟發式上下文——對流程和先前決策有用，但對當前儲存庫狀態不具權威性。
- 當記憶改變計畫時引用記憶工件路徑，並在採取行動前搭配當前儲存庫的證據。
- 當記憶與儲存庫狀態和使用者指令衝突時，以後者為準；將衝突的記憶視為過時資料。

### 讀取記憶工件

代理可以使用 `read` 工具透過 `memory://` URL 直接讀取記憶檔案：

| URL | 內容 |
|---|---|
| `memory://root` | 啟動時注入的精簡摘要 |
| `memory://root/MEMORY.md` | 完整的長期記憶文件 |
| `memory://root/skills/<name>/SKILL.md` | 生成的技能操作手冊 |

### `/memory` 斜線命令

| 子命令 | 效果 |
|---|---|
| `view` | 顯示當前的記憶注入內容 |
| `clear` / `reset` | 刪除所有記憶資料和生成的工件 |
| `enqueue` / `rebuild` | 強制在下次啟動時執行整合 |

## 運作原理

記憶由一個背景管線建構，在啟動時或透過斜線命令手動觸發時執行。

**階段 1 — 逐工作階段提取：** 對於自上次處理以來有變更的每個過去工作階段，模型會讀取工作階段歷史並提取持久性訊號：技術決策、約束條件、已解決的故障、反覆出現的工作流程。過於近期、過於久遠或目前活躍的工作階段會被跳過。每次提取會產生一個原始記憶區塊和該工作階段的簡短摘要。

**階段 2 — 整合：** 提取完成後，第二次模型處理會讀取所有逐工作階段的提取結果，並產生三個寫入磁碟的輸出：

- `MEMORY.md` — 精心整理的長期記憶文件
- `memory_summary.md` — 在工作階段開始時注入的精簡文本
- `skills/` — 可重複使用的程序性操作手冊，每個位於各自的子目錄中

階段 2 使用租約機制來防止多個程序同時啟動時重複執行。來自先前執行的過時技能目錄會自動清理。

所有輸出在寫入磁碟前都會進行機密資訊掃描。

### 提取行為

記憶提取和整合行為完全由 `src/prompts/memories/` 中的靜態提示檔案驅動。

| 檔案 | 用途 | 變數 |
|---|---|---|
| `stage_one_system.md` | 逐工作階段提取的系統提示 | — |
| `stage_one_input.md` | 包裝工作階段內容的使用者輪次模板 | `{{thread_id}}`、`{{response_items_json}}` |
| `consolidation.md` | 跨工作階段整合的提示 | `{{raw_memories}}`、`{{rollout_summaries}}` |
| `read_path.md` | 注入到即時工作階段的記憶引導 | `{{memory_summary}}` |

### 模型選擇

記憶功能依附於模型角色系統。

| 階段 | 角色 | 用途 |
|---|---|---|
| 階段 1（提取） | `default` | 逐工作階段知識提取 |
| 階段 2（整合） | `smol` | 跨工作階段綜合 |

如果未配置 `smol`，階段 2 會回退至 `default` 角色。

## 配置

| 設定 | 預設值 | 說明 |
|---|---|---|
| `memories.enabled` | `false` | 主開關 |
| `memories.maxRolloutAgeDays` | `30` | 超過此天數的工作階段不會被處理 |
| `memories.minRolloutIdleHours` | `12` | 比此時間更近期活躍的工作階段會被跳過 |
| `memories.maxRolloutsPerStartup` | `64` | 單次啟動時處理的工作階段數量上限 |
| `memories.summaryInjectionTokenLimit` | `5000` | 注入系統提示的摘要最大 token 數 |

進階使用可在配置中調整額外的參數（並行數、租約持續時間、token 預算）。

## 關鍵檔案

- `src/memories/index.ts` — 管線編排、注入、斜線命令處理
- `src/memories/storage.ts` — 基於 SQLite 的工作佇列和執行緒註冊
- `src/prompts/memories/` — 記憶提示模板
- `src/internal-urls/memory-protocol.ts` — `memory://` URL 處理器
