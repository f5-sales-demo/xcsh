---
title: 機密資訊混淆
description: 機密資訊混淆管線，從工作階段日誌和輸出中編輯敏感值。
sidebar:
  order: 3
  label: 機密資訊
i18n:
  sourceHash: 1d9dc101c614
  translator: machine
---

# 機密資訊混淆

防止敏感值（API 金鑰、權杖、密碼）被傳送到 LLM 提供者。啟用時，機密資訊在離開程序前會被替換為確定性佔位符，並在模型回傳的工具呼叫引數中還原。

## 啟用

預設為啟用。可透過 `/settings` UI 或直接在 `config.yml` 中切換：

```yaml
secrets:
  enabled: false
```

## 運作方式

1. 在工作階段啟動時，從兩個來源收集機密資訊：
   - **環境變數**：匹配常見機密模式（`*_KEY`、`*_SECRET`、`*_TOKEN`、`*_PASSWORD` 等）且值長度 >= 8 個字元
   - **`secrets.yml` 檔案**（見下方說明）

2. 傳送至 LLM 的外發訊息中，所有機密值都會被替換為佔位符，如 `<<$env:S0>>`、`<<$env:S1>>` 等。

3. 模型回傳的工具呼叫引數會被深度遍歷，佔位符在執行前會被還原為原始值。

兩種模式控制每個機密資訊的處理方式：

| 模式 | 行為 | 可逆 |
|---|---|---|
| `obfuscate`（預設） | 替換為索引佔位符 `<<$env:SN>>` | 是（在工具引數中還原） |
| `replace` | 替換為確定性的等長字串 | 否（單向） |

## secrets.yml

以 YAML 定義自訂機密條目。會檢查兩個位置：

| 層級 | 路徑 | 用途 |
|---|---|---|
| 全域 | `~/.xcsh/agent/secrets.yml` | 跨所有專案的機密資訊 |
| 專案 | `<cwd>/.xcsh/secrets.yml` | 專案特定的機密資訊 |

具有相同 `content` 的專案條目會覆蓋全域條目。

### 結構描述

陣列中的每個條目具有以下欄位：

| 欄位 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `type` | `"plain"` 或 `"regex"` | 是 | 匹配策略 |
| `content` | string | 是 | 機密值（plain）或正規表示式模式（regex） |
| `mode` | `"obfuscate"` 或 `"replace"` | 否 | 預設：`"obfuscate"` |
| `replacement` | string | 否 | 自訂替換文字（僅限 replace 模式） |
| `flags` | string | 否 | 正規表示式旗標（僅限 regex 類型） |

### 範例

#### 純文字機密

```yaml
# Obfuscate a specific API key (default mode)
- type: plain
  content: sk-proj-abc123def456

# Replace a database password with a fixed string
- type: plain
  content: hunter2
  mode: replace
  replacement: "********"
```

#### 正規表示式機密

```yaml
# Obfuscate any AWS-style key
- type: regex
  content: "AKIA[0-9A-Z]{16}"

# Case-insensitive match with explicit flags
- type: regex
  content: "api[_-]?key\\s*=\\s*\\w+"
  flags: "i"

# Regex literal syntax (pattern and flags in one string)
- type: regex
  content: "/bearer\\s+[a-zA-Z0-9._~+\\/=-]+/i"
```

正規表示式條目始終以全域方式掃描（`g` 旗標會自動強制套用）。支援正規表示式字面語法 `/pattern/flags` 作為分開使用 `content` + `flags` 欄位的替代方式。模式中的跳脫斜線（`\\/`）會被正確處理。

#### 搭配正規表示式的 replace 模式

```yaml
# One-way replace connection strings (not reversible)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## 與環境變數偵測的互動

環境變數始終會先被收集。檔案定義的條目會在之後附加，因此檔案條目可以涵蓋不存在於環境變數中的機密資訊（設定檔、寫死的值等）。如果相同的值同時出現在兩者中，檔案條目的模式具有優先權。

## 關鍵檔案

- `src/secrets/index.ts` -- 載入、合併、環境變數收集
- `src/secrets/obfuscator.ts` -- `SecretObfuscator` 類別、佔位符生成、訊息混淆
- `src/secrets/regex.ts` -- 正規表示式字面解析與編譯
- `src/config/settings-schema.ts` -- `secrets.enabled` 設定定義
