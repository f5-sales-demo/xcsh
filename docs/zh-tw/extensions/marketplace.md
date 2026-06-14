---
title: 市集外掛系統
description: 用於探索、安裝及管理精選外掛集合的市集外掛系統。
sidebar:
  order: 4
  label: 市集
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# 市集外掛系統

市集系統讓您可以從 Git 託管的目錄中探索、安裝及管理外掛。它與 Claude Code 外掛登錄檔格式相容。

## 快速開始

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

或直接輸入不帶任何引數的 `/marketplace`，即可開啟互動式外掛瀏覽器。

## 概念

**市集**是一個 Git 儲存庫（或本機目錄），其根目錄下包含一個位於 `.xcsh-plugin/marketplace.json` 的目錄檔案。該目錄列出了可用的外掛及其來源、說明與元資料。

**外掛**是一個包含技能、命令、鉤子、MCP 伺服器或 LSP 伺服器的目錄。外掛以 `name@marketplace` 的形式識別（例如 `code-review@f5xc-salesdemos-marketplace`）。

**範疇**：外掛可以在兩種範疇下安裝：

- **user**（預設）——在所有專案中可用，儲存於 `~/.xcsh/plugins/installed_plugins.json`
- **project**——僅在目前專案中可用，儲存於 `.xcsh/installed_plugins.json`

專案範疇的安裝會覆蓋同名外掛的使用者範疇安裝。

## 命令

### 互動模式

| 命令 | 效果 |
|---|---|
| `/marketplace` | 開啟互動式外掛瀏覽器（安裝） |

### 市集管理

| 命令 | 效果 |
|---|---|
| `/marketplace add <source>` | 新增一個市集來源 |
| `/marketplace remove <name>` | 移除一個市集 |
| `/marketplace update [name]` | 重新擷取目錄；省略名稱則更新全部 |
| `/marketplace list` | 列出已設定的市集 |

### 外掛操作

| 命令 | 效果 |
|---|---|
| `/marketplace discover [marketplace]` | 瀏覽可用外掛 |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | 安裝外掛 |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | 解除安裝外掛 |
| `/marketplace installed` | 列出已安裝的市集外掛 |
| `/marketplace upgrade [--scope user\|project] [name@marketplace]` | 升級一個或全部外掛 |

### CLI 對應命令

相同的操作亦可從命令列執行：

```
xcsh plugin marketplace add <source>
xcsh plugin marketplace remove <name>
xcsh plugin marketplace update [name]
xcsh plugin marketplace list
xcsh plugin discover [marketplace]
xcsh plugin install --scope project name@marketplace
```

## 市集來源

當您執行 `/marketplace add <source>` 時，系統會對來源進行分類：

| 來源格式 | 類型 | 範例 |
|---|---|---|
| `owner/repo` | GitHub 簡寫 | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | 直接目錄 URL | `https://example.com/marketplace.json` |
| `https://...*.git` 或 `git@...` | Git 儲存庫 | `https://github.com/org/repo.git` |
| `./path`、`~/path` 或 `/path` | 本機目錄 | `./my-marketplace` |

系統會複製儲存庫（或讀取本機目錄），找到 `.xcsh-plugin/marketplace.json`，驗證後將目錄快取至本機。

## 目錄格式（marketplace.json）

市集目錄位於儲存庫根目錄的 `.xcsh-plugin/marketplace.json`：

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "my-marketplace",
  "owner": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "description": "A collection of plugins",
  "plugins": [
    {
      "name": "my-plugin",
      "description": "What this plugin does",
      "source": "./plugins/my-plugin",
      "category": "development",
      "homepage": "https://github.com/you/my-plugin"
    }
  ]
}
```

### 必填欄位

| 欄位 | 說明 |
|---|---|
| `name` | 市集名稱。小寫英數字元、連字號及點號。必須以英數字元開頭及結尾。最多 64 個字元。 |
| `owner.name` | 市集擁有者名稱 |
| `plugins` | 外掛項目陣列 |

### 外掛項目欄位

| 欄位 | 必填 | 說明 |
|---|---|---|
| `name` | 是 | 外掛名稱（規則與市集名稱相同） |
| `source` | 是 | 外掛的來源位置（詳見下方） |
| `description` | 否 | 簡短說明 |
| `version` | 否 | 版本字串 |
| `author` | 否 | `{ name, email? }` |
| `homepage` | 否 | URL |
| `category` | 否 | 類別字串（例如 `development`、`productivity`、`security`） |
| `tags` | 否 | 字串標籤陣列 |
| `strict` | 否 | 布林值 |
| `commands` | 否 | 提供的斜線命令 |
| `agents` | 否 | 提供的代理程式 |
| `hooks` | 否 | 鉤子定義 |
| `mcpServers` | 否 | MCP 伺服器定義 |
| `lspServers` | 否 | LSP 伺服器定義 |

### 外掛來源格式

`source` 欄位支援多種格式：

**相對路徑**（市集儲存庫內）：

```json
"source": "./plugins/my-plugin"
```

**Git 儲存庫 URL**：

```json
"source": {
  "source": "url",
  "url": "https://github.com/org/repo.git",
  "sha": "abc123..."
}
```

**GitHub 簡寫**：

```json
"source": {
  "source": "github",
  "repo": "org/repo",
  "ref": "main",
  "sha": "abc123..."
}
```

**Git 子目錄**（單一儲存庫）：

```json
"source": {
  "source": "git-subdir",
  "url": "https://github.com/org/monorepo.git",
  "path": "plugins/my-plugin",
  "ref": "main",
  "sha": "abc123..."
}
```

**npm 套件**：

```json
"source": {
  "source": "npm",
  "package": "@scope/my-plugin",
  "version": "1.0.0"
}
```

## 磁碟目錄結構

```
~/.xcsh/
  config/
    marketplaces.json          # 已新增市集的登錄檔
  plugins/
    installed_plugins.json     # 使用者範疇的已安裝外掛
    cache/
      marketplaces/            # 快取的市集目錄
      plugins/                 # 快取的外掛目錄

<project>/.xcsh/
  installed_plugins.json       # 專案範疇的已安裝外掛
```

## 命名規則

市集與外掛名稱必須：

- 以小寫字母或數字開頭及結尾
- 僅包含小寫字母、數字、連字號及點號
- 最多 64 個字元

外掛 ID（`name@marketplace`）總長度不得超過 128 個字元。

有效範例：`my-plugin`、`code-review`、`wordpress.com`、`ai-firstify`
無效範例：`-bad`、`bad-`、`.bad`、`Bad`、`under_score`
