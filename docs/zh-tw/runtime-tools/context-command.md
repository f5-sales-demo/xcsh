---
title: F5 XC 上下文
description: 將 xcsh 連接到 F5 Distributed Cloud 租戶 -- 建立、切換和管理驗證上下文。
sidebar:
  order: 1
  label: F5 XC 上下文
i18n:
  sourceHash: bdaf0fb8837c
  translator: machine
---

# F5 XC 上下文

xcsh 透過**上下文**連接到 F5 Distributed Cloud -- 上下文是將租戶 URL、API 權杖和命名空間綁定在一起的具名憑證集。如果您使用過 `kubectl config use-context` 或 `kubectx`，工作流程完全相同：建立上下文、透過名稱在它們之間切換，並使用 `-` 快速切換回去。

## 入門指南

### 1. 建立您的第一個上下文

您需要從 F5 XC 主控台取得三樣東西：租戶 URL、API 權杖，以及選擇性的命名空間。

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

或者如果您偏好逐步引導提示，可以使用引導精靈：

```
/context wizard
```

### 2. 啟用它

```
/context production
```

```
╭─ production ─────────────────────────────────────────────────╮
│ F5XC_TENANT     acme                                         │
│ F5XC_API_URL    https://acme.console.ves.volterra.io         │
│ F5XC_API_TOKEN  ...oken                                      │
│ Status          Connected (312ms)                            │
├─ Environment ────────────────────────────────────────────────┤
│ F5XC_NAMESPACE  default                                      │
╰──────────────────────────────────────────────────────────────╯
```

啟用後，xcsh 會將租戶憑證注入您的工作階段。代理程式現在可以進行 F5 XC API 呼叫，狀態列會顯示目前啟用的上下文。

### 3. 新增更多上下文並在它們之間切換

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

透過名稱切換 -- 不需要子命令動詞：

```
/context staging
```

切換回前一個上下文（`cd -` 風格）：

```
/context -
```

呼叫 `/context -` 兩次會讓您回到起始位置。

### 4. 查看您擁有的上下文

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

`*` 標記目前啟用的上下文。

## 日常命令

| 命令 | 功能說明 |
|---|---|
| `/context` | 列出所有上下文 |
| `/context <name>` | 切換到指定上下文 |
| `/context -` | 切換到前一個上下文 |
| `/context show` | 顯示啟用的上下文詳細資訊（權杖已遮蔽） |
| `/context status` | 顯示目前驗證狀態 |

## 上下文生命週期

| 命令 | 功能說明 |
|---|---|
| `/context create <name> <url> <token> [namespace]` | 建立上下文 |
| `/context delete <name> --confirm` | 刪除上下文（需要 `--confirm`） |
| `/context rename <old> <new>` | 重新命名上下文 |
| `/context validate <name>` | 測試憑證而不切換 |
| `/context export [name] [--include-token]` | 匯出為 JSON（預設遮蔽權杖） |
| `/context import <path-or-json> [--overwrite]` | 從檔案或內嵌 JSON 匯入 |
| `/context wizard` | 引導式互動設定 |

## 切換命名空間

每個上下文都有預設的命名空間。無需更改上下文即可切換它：

```
/context namespace system
```

Tab 自動完成會提供來自目前啟用租戶的命名空間名稱。

## 上下文的環境變數

上下文可以攜帶額外的環境變數，這些變數會在啟用時注入您的工作階段。適用於不屬於憑證集一部分的每租戶設定。

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

別名：`add` = `set`，`remove`/`clear` = `unset`。

## Tab 自動完成

輸入 `/context ` 然後按 Tab。下拉選單會顯示：

1. **上下文名稱** -- 附帶租戶 URL 提示，讓您能區分不同租戶
2. **`-`** -- 當您之前有切換過時出現，顯示您將切換到哪個上下文
3. **子命令** -- `list`、`create`、`delete` 等。

上下文名稱會優先顯示，因為切換是最常見的操作。

子命令層級的自動完成也能運作：`/context activate <Tab>` 會完成上下文名稱，`/context namespace <Tab>` 會完成命名空間，`/context unset <Tab>` 會完成已知的環境變數鍵。

## 命名規則

上下文名稱必須為 1-64 個字元：字母、數字、連字號、底線。

與子命令衝突的名稱會被拒絕：

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

完整的保留字集合：`list`、`show`、`status`、`create`、`delete`、`rename`、`namespace`、`env`、`set`、`unset`、`add`、`remove`、`clear`、`activate`、`validate`、`export`、`import`、`wizard`、`help`。比較時不區分大小寫。

## 環境變數覆寫

如果在啟動 xcsh 之前，您的 shell 環境中已設定 `F5XC_API_URL` 和 `F5XC_API_TOKEN`，它們會優先於任何上下文。這在 CI/CD 管線或不想建立持久性上下文的一次性工作階段中非常有用。

在此模式下執行時，`/context` 會顯示來自環境變數的憑證，並附帶 `(via env vars)` 標籤。

## 前一個上下文行為

- **工作階段範圍**：前一個上下文會在您重新啟動 xcsh 時重設。它不會持久化到磁碟。
- **乒乓切換**：`/context -` 兩次會讓您回到起始位置。
- **在變更操作中安全**：如果您刪除了前一個上下文，指標會被清除。如果您重新命名它，指標會跟隨新名稱。
- **重複啟用為無操作**：當已在 `production` 上時執行 `/context production` 不會重設前一個指標。

## 設計慣例

`/context` 的使用者體驗遵循：

- **kubectx**：`kubectx <name>` 用於切換，`kubectx -` 用於前一個，單獨的 `kubectx` 用於列出
- **kubectl**：`kubectl config use-context` 用於明確形式
- **Shell**：`cd -` / `OLDPWD` 用於前一個目錄追蹤
