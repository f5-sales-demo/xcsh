---
title: 秘密混淆
description: 秘密混淆管線，可從工作階段日誌和輸出中遮蔽敏感值。
sidebar:
  order: 3
  label: 秘密
i18n:
  sourceHash: 1d9dc101c614
  translator: machine
---

# 秘密混淆

防止敏感值（API 金鑰、權杖、密碼）被傳送至 LLM 提供者。啟用後，秘密在離開程序之前會被替換為確定性的佔位符，並在模型回傳的工具呼叫引數中還原。

## 啟用

預設為啟用。可透過 `/settings` UI 切換，或直接在 `config.yml` 中設定：

```yaml
secrets:
  enabled: false
```

## 運作方式

1. 在工作階段啟動時，從兩個來源收集秘密：
   - **環境變數**：符合常見秘密模式（`*_KEY`、`*_SECRET`、`*_TOKEN`、`*_PASSWORD` 等）且值長度 >= 8 個字元
   - **`secrets.yml` 檔案**（見下方）

2. 傳送至 LLM 的外送訊息中，所有秘密值會被替換為如 `<<$env:S0>>`、`<<$env:S1>>` 等佔位符。

3. 模型回傳的工具呼叫引數會被深層遍歷，佔位符會在執行前還原為原始值。

兩種模式控制每個秘密的處理方式：

| 模式 | 行為 | 可還原 |
|---|---|---|
| `obfuscate`（預設） | 替換為索引佔位符 `<<$env:SN>>` | 是（在工具引數中還原） |
| `replace` | 替換為確定性的等長字串 | 否（單向） |

## secrets.yml

以 YAML 定義自訂秘密項目。會檢查兩個位置：

| 層級 | 路徑 | 用途 |
|---|---|---|
| 全域 | `~/.xcsh/agent/secrets.yml` | 跨所有專案的秘密 |
| 專案 | `<cwd>/.xcsh/secrets.yml` | 專案特定的秘密 |

具有相符 `content` 的專案項目會覆蓋全域項目。

### 結構定義

陣列中的每個項目具有以下欄位：

| 欄位 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `type` | `"plain"` 或 `"regex"` | 是 | 比對策略 |
| `content` | string | 是 | 秘密值（plain）或正規表達式模式（regex） |
| `mode` | `"obfuscate"` 或 `"replace"` | 否 | 預設：`"obfuscate"` |
| `replacement` | string | 否 | 自訂替換值（僅限 replace 模式） |
| `flags` | string | 否 | 正規表達式旗標（僅限 regex 類型） |

### 範例

#### 純文字秘密

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

#### 正規表達式秘密

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

正規表達式項目始終會全域掃描（`g` 旗標會自動強制套用）。正規表達式字面語法 `/pattern/flags` 可作為分開使用 `content` + `flags` 欄位的替代方案。模式中的跳脫斜線（`\\/`）會被正確處理。

#### 使用正規表達式的 replace 模式

```yaml
# One-way replace connection strings (not reversible)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## 與環境變數偵測的互動

環境變數始終會最先收集。檔案定義的項目會在之後附加，因此檔案項目可以涵蓋不在環境變數中的秘密（設定檔、寫死的值等）。如果相同的值同時出現在兩者中，檔案項目的模式會優先生效。

## 關鍵檔案

- `src/secrets/index.ts` -- 載入、合併、環境變數收集
- `src/secrets/obfuscator.ts` -- `SecretObfuscator` 類別、佔位符產生、訊息混淆
- `src/secrets/regex.ts` -- 正規表達式字面解析與編譯
- `src/config/settings-schema.ts` -- `secrets.enabled` 設定定義
