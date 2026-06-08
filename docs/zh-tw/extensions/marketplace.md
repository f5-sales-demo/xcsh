---
title: Marketplace 外掛系統
description: Marketplace 外掛系統，用於探索、安裝和管理精選的外掛集合。
sidebar:
  order: 4
  label: Marketplace
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# Marketplace 外掛系統

Marketplace 系統讓您可以從 Git 託管的目錄中探索、安裝和管理外掛。它與 Claude Code 外掛註冊表格式相容。

## 快速開始

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

或者直接輸入 `/marketplace` 不帶任何參數，即可開啟互動式外掛瀏覽器。

## 概念

**marketplace** 是一個 Git 儲存庫（或本機目錄），其中包含位於 `.xcsh-plugin/marketplace.json` 的目錄檔案。該目錄列出了可用的外掛及其來源、描述和中繼資料。

**外掛** 是一個包含技能、命令、鉤子、MCP 伺服器或 LSP 伺服器的目錄。外掛以 `name@marketplace` 的格式識別（例如 `code-review@f5xc-salesdemos-marketplace`）。

**作用域**：外掛可以在兩個作用域中安裝：

- **user**（預設）——在所有專案中可用，儲存在 `~/.xcsh/plugins/installed_plugins.json`
- **project** ——僅在當前專案中可用，儲存在 `.xcsh/installed_plugins.json`

專案作用域的安裝會遮蔽相同外掛的使用者作用域安裝。

## 命令

### 互動模式

| 命令 | 效果 |
|---|---|
| `/marketplace` | 開啟互動式外掛瀏覽器（安裝） |

### Marketplace 管理

| 命令 | 效果 |
|---|---|
| `/marketplace add <source>` | 新增 marketplace 來源 |
| `/marketplace remove <name>` | 移除 marketplace |
| `/marketplace update [name]` | 重新擷取目錄；省略名稱則更新全部 |
| `/marketplace list` | 列出已設定的 marketplace |

### 外掛操作

| 命令 | 效果 |
|---|---|
| `/marketplace discover [marketplace]` | 瀏覽可用的外掛 |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | 安裝外掛 |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | 解除安裝外掛 |
| `/marketplace installed` | 列出已安裝的 marketplace 外掛 |
| `/marketplace upgrade [--scope user\|project] [name@marketplace]` | 升級一個或全部外掛 |

### CLI 對應命令

相同的操作也可以從命令列執行：

```
xcsh plugin marketplace add <source>
xcsh plugin marketplace remove <name>
xcsh plugin marketplace update [name]
xcsh plugin marketplace list
xcsh plugin discover [marketplace]
xcsh plugin install --scope project name@marketplace
```

## Marketplace 來源

當您執行 `/marketplace add <source>` 時，系統會對來源進行分類：

| 來源格式 | 類型 | 範例 |
|---|---|---|
| `owner/repo` | GitHub 簡寫 | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | 直接目錄 URL | `https://example.com/marketplace.json` |
| `https://...*.git` 或 `git@...` | Git 儲存庫 | `https://github.com/org/repo.git` |
| `./path` 或 `~/path` 或 `/path` | 本機目錄 | `./my-marketplace` |

系統會複製儲存庫（或讀取本機目錄），找到 `.xcsh-plugin/marketplace.json`，驗證後將目錄快取至本機。

## 目錄格式（marketplace.json）

Marketplace 目錄位於儲存庫根目錄的 `.xcsh-plugin/marketplace.json`：

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

| 欄位 | 描述 |
|---|---|
| `name` | Marketplace 名稱。小寫字母數字、連字號和點號。必須以字母數字開頭和結尾。最多 64 個字元。 |
| `owner.name` | Marketplace 擁有者名稱 |
| `plugins` | 外掛項目陣列 |

### 外掛項目欄位

| 欄位 | 必填 | 描述 |
|---|---|---|
| `name` | 是 | 外掛名稱（與 marketplace 名稱相同的規則） |
| `source` | 是 | 外掛的位置（見下方） |
| `description` | 否 | 簡短描述 |
| `version` | 否 | 版本字串 |
| `author` | 否 | `{ name, email? }` |
| `homepage` | 否 | URL |
| `category` | 否 | 分類字串（例如 `development`、`productivity`、`security`） |
| `tags` | 否 | 字串標籤陣列 |
| `strict` | 否 | 布林值 |
| `commands` | 否 | 提供的斜線命令 |
| `agents` | 否 | 提供的代理 |
| `hooks` | 否 | 鉤子定義 |
| `mcpServers` | 否 | MCP 伺服器定義 |
| `lspServers` | 否 | LSP 伺服器定義 |

### 外掛來源格式

`source` 欄位支援多種格式：

**相對路徑**（在 marketplace 儲存庫內）：

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

**Git 子目錄**（monorepo）：

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

## 磁碟上的佈局

```
~/.xcsh/
  config/
    marketplaces.json          # 已新增的 marketplace 註冊表
  plugins/
    installed_plugins.json     # 使用者作用域的已安裝外掛
    cache/
      marketplaces/            # 快取的 marketplace 目錄
      plugins/                 # 快取的外掛目錄

<project>/.xcsh/
  installed_plugins.json       # 專案作用域的已安裝外掛
```

## 命名規則

Marketplace 和外掛名稱必須：

- 以小寫字母或數字開頭和結尾
- 僅包含小寫字母、數字、連字號和點號
- 最多 64 個字元

外掛 ID（`name@marketplace`）總長度最多 128 個字元。

有效範例：`my-plugin`、`code-review`、`wordpress.com`、`ai-firstify`
無效範例：`-bad`、`bad-`、`.bad`、`Bad`、`under_score`
