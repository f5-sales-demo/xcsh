---
title: MCP 設定
description: 編碼代理執行環境的 MCP 伺服器設定、驗證與管理。
sidebar:
  order: 1
  label: 設定
i18n:
  sourceHash: e4f56e8becc6
  translator: machine
---

# OMP 中的 MCP 設定

本指南說明如何為 OMP 編碼代理新增、編輯和驗證 MCP 伺服器。

程式碼中的權威來源：

- 執行環境設定類型：`packages/coding-agent/src/mcp/types.ts`
- 設定寫入器：`packages/coding-agent/src/mcp/config-writer.ts`
- 載入器 + 驗證：`packages/coding-agent/src/mcp/config.ts`
- 獨立 `mcp.json` 探索：`packages/coding-agent/src/discovery/mcp-json.ts`
- Schema：`packages/coding-agent/src/config/mcp-schema.json`

## 建議的設定檔位置

OMP 可從多種工具（`.claude/`、`.cursor/`、`.vscode/`、`opencode.json` 等）探索 MCP 伺服器，但對於 OMP 原生設定，您通常應使用以下其中一個檔案：

- 專案層級：`.xcsh/mcp.json`
- 使用者層級：`~/.xcsh/mcp.json`

OMP 也接受專案根目錄中的備用獨立檔案：

- `mcp.json`
- `.mcp.json`

當您希望由 OMP 管理設定時，請使用 `.xcsh/mcp.json`。僅在您需要其他 MCP 客戶端也能讀取的可攜式備用檔案時，才使用根目錄的 `mcp.json` / `.mcp.json`。

## 新增 schema 參考

在檔案頂部新增此行以獲得編輯器自動完成和驗證功能：

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {}
}
```

當 `/mcp add`、`/mcp enable`、`/mcp disable`、`/mcp reauth` 或其他設定寫入流程建立或更新 OMP 管理的 MCP 檔案時，OMP 現在會自動寫入此內容。

## 檔案結構

OMP 支援以下頂層結構：

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-server"]
    }
  },
  "disabledServers": ["server-name"]
}
```

頂層鍵：

- `$schema` — 供工具使用的可選 JSON Schema URL
- `mcpServers` — 伺服器名稱與伺服器設定的對應表
- `disabledServers` — 使用者層級的拒絕清單，用於按名稱關閉已探索的伺服器

伺服器名稱必須符合 `^[a-zA-Z0-9_.-]{1,100}$`。

## 支援的伺服器欄位

所有傳輸方式共用的欄位：

- `enabled?: boolean` — 當值為 `false` 時跳過此伺服器
- `timeout?: number` — 連線逾時時間（毫秒）
- `auth?: { ... }` — OMP 用於 OAuth/API 金鑰流程的認證中繼資料
- `oauth?: { ... }` — 認證/重新認證期間使用的明確 OAuth 客戶端設定

### `stdio` 傳輸方式

當省略 `type` 時，`stdio` 為預設值。

必填：

- `command: string`

選填：

- `type?: "stdio"`
- `args?: string[]`
- `env?: Record<string, string>`
- `cwd?: string`

範例：

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/alice/projects",
        "/Users/alice/Documents"
      ]
    }
  }
}
```

此設定遵循官方的 Filesystem MCP 伺服器套件（`@modelcontextprotocol/server-filesystem`）。

### `http` 傳輸方式

必填：

- `type: "http"`
- `url: string`

選填：

- `headers?: Record<string, string>`

範例：

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

此設定對應 GitHub 的託管 GitHub MCP 伺服器端點。

### `sse` 傳輸方式

必填：

- `type: "sse"`
- `url: string`

選填：

- `headers?: Record<string, string>`

範例：

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "legacy-remote": {
      "type": "sse",
      "url": "https://example.com/mcp/sse"
    }
  }
}
```

`sse` 仍為相容性目的而受支援，但 MCP 規格現在建議新伺服器使用 Streamable HTTP（`type: "http"`）。

## 認證欄位

OMP 支援兩個認證相關物件。

### `auth`

```json
{
  "type": "oauth" | "apikey",
  "credentialId": "optional-stored-credential-id",
  "tokenUrl": "optional-token-endpoint",
  "clientId": "optional-client-id",
  "clientSecret": "optional-client-secret"
}
```

當 OMP 需要記住如何為伺服器重新載入憑證時使用此設定。

### `oauth`

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "redirectUri": "...",
  "callbackPort": 3334,
  "callbackPath": "/oauth/callback"
}
```

當 MCP 伺服器需要明確的 OAuth 客戶端設定時使用此設定。

Slack 是目前最清楚的範例。Slack 的 MCP 伺服器託管於 `https://mcp.slack.com/mcp`，使用 Streamable HTTP，並需要以您 Slack 應用程式的客戶端憑證進行機密 OAuth 認證。

範例：

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

來自 Slack 文件的相關端點：

- MCP 端點：`https://mcp.slack.com/mcp`
- 授權端點：`https://slack.com/oauth/v2_user/authorize`
- 權杖端點：`https://slack.com/api/oauth.v2.user.access`

## 常用複製貼上範例

### 透過 stdio 的檔案系統伺服器

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/absolute/path/one",
        "/absolute/path/two"
      ]
    }
  }
}
```

### 透過 HTTP 的 GitHub 託管伺服器

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

### 透過 Docker 的 GitHub 本機伺服器

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
      }
    }
  }
}
```

此設定對應 GitHub 官方的本機 Docker 映像 `ghcr.io/github/github-mcp-server`。

### 透過 OAuth 的 Slack 託管伺服器

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

## 密鑰與變數解析

這是通常讓人困惑的部分。

### 在 `.xcsh/mcp.json` 和 `~/.xcsh/mcp.json` 中

在 OMP 啟動伺服器或發出 HTTP 請求之前，它會按以下方式解析 `env` 和 `headers` 的值：

1. 如果值以 `!` 開頭，OMP 會將其作為 shell 命令執行並使用修剪後的標準輸出。
2. 否則 OMP 會先檢查該值是否與環境變數名稱相符。
3. 如果該環境變數未設定，OMP 會直接使用字串字面值。

範例：

```json
{
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
  },
  "headers": {
    "X-MCP-Insiders": "true"
  }
}
```

這表示以下用法對於本機密鑰來說是有效且方便的：

- `"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"` → 從目前的 shell 環境複製
- `"Authorization": "Bearer hardcoded-token"` → 使用字面值
- `"Authorization": "!printf 'Bearer %s' \"$GITHUB_TOKEN\""` → 從命令建構標頭

### 在根目錄 `mcp.json` 和 `.mcp.json` 中

獨立的備用載入器在探索期間也會展開字串中的 `${VAR}` 和 `${VAR:-default}`。

範例：

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    }
  }
}
```

如果您想要最不出意外的 OMP 行為，建議使用 `.xcsh/mcp.json` 並使用明確的 env/header 值。

## `disabledServers`

`disabledServers` 主要用於使用者設定檔（`~/.xcsh/mcp.json`），當伺服器從其他來源被探索到且您希望 OMP 忽略它而不修改該工具的設定時使用。

範例：

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "disabledServers": ["github", "slack"]
}
```

## `/mcp add` 與直接編輯 JSON

當您需要引導式設定時，請使用 `/mcp add`。

在以下情況下使用直接編輯 JSON：

- 您需要精靈尚未提供的傳輸方式或認證選項
- 您想從其他 MCP 客戶端貼上伺服器定義
- 您想在編輯器中獲得基於 schema 的驗證

編輯後，請使用：

- `/mcp reload` 在目前工作階段中重新探索並重新連線伺服器
- `/mcp list` 查看伺服器來自哪個設定檔
- `/mcp test <name>` 測試單一伺服器

## OMP 強制執行的驗證規則

來自 `packages/coding-agent/src/mcp/config.ts` 中的 `validateServerConfig()`：

- `stdio` 需要 `command`
- `http` 和 `sse` 需要 `url`
- 伺服器不能同時設定 `command` 和 `url`
- 未知的 `type` 值會被拒絕

實際影響：

- 省略 `type` 表示 `stdio`
- 如果您貼上遠端伺服器設定但忘記加上 `"type": "http"`，OMP 會將其視為 `stdio` 並提示 `command` 缺失
- `sse` 仍然有效以保持相容性，但新的託管伺服器通常應設定為 `http`

## 探索與優先順序

OMP 不會合併跨檔案的重複伺服器定義。探索提供者有優先順序，較高優先順序的定義會勝出。

實務上：

- 當您需要 OMP 專屬的覆寫時，建議使用 `.xcsh/mcp.json` 或 `~/.xcsh/mcp.json`
- 盡可能在各工具間保持伺服器名稱唯一
- 當第三方設定持續重新引入您不需要的伺服器時，在使用者設定中使用 `disabledServers`

## 疑難排解

### `Server "name": stdio server requires "command" field`

您可能在遠端伺服器上省略了 `type: "http"`。

### `Server "name": both "command" and "url" are set`

請選擇一種傳輸方式。OMP 將 `command` 視為 stdio，將 `url` 視為 http/sse。

### `/mcp add` 成功但伺服器仍無法連線

JSON 是有效的，但伺服器可能仍然無法連線。使用 `/mcp test <name>` 並檢查：

- 二進位檔或 Docker 映像是否存在
- 必要的環境變數是否已設定
- 遠端 URL 是否可連線
- OAuth 或 API 權杖是否有效

### 伺服器存在於其他工具的設定中但不在 OMP 中

執行 `/mcp list`。OMP 會探索許多第三方 MCP 檔案，但專案層級的載入也可以透過 `mcp.enableProjectConfig` 設定來停用。

## 參考資料

- MCP 傳輸規格：<https://modelcontextprotocol.io/specification/2025-03-26/basic/transports>
- Filesystem 伺服器套件：<https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem>
- GitHub MCP 伺服器：<https://github.com/github/github-mcp-server>
- Slack MCP 伺服器文件：<https://docs.slack.dev/ai/slack-mcp-server/>
