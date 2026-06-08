---
title: F5 XC 情境
description: 將 xcsh 連接到 F5 Distributed Cloud 租戶——建立、切換和管理認證情境。
sidebar:
  order: 1
  label: F5 XC 情境
i18n:
  sourceHash: bdaf0fb8837c
  translator: machine
---

# F5 XC 情境

xcsh 透過**情境（contexts）**連接到 F5 Distributed Cloud——情境是具名的認證集合，將租戶 URL、API 權杖和命名空間綁定在一起。如果您曾使用過 `kubectl config use-context` 或 `kubectx`，工作流程完全相同：建立情境，透過名稱在它們之間切換，並使用 `-` 快速切回。

## 快速入門

### 1. 建立您的第一個情境

您需要從 F5 XC 主控台取得三項資訊：租戶 URL、API 權杖，以及可選的命名空間。

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

如果您偏好逐步引導的提示，也可以使用引導式精靈：

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

啟用後，xcsh 會將租戶認證注入您的工作階段。代理程式現在可以進行 F5 XC API 呼叫，狀態列會顯示目前作用中的情境。

### 3. 新增更多情境並在它們之間切換

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

透過名稱切換——不需要子命令動詞：

```
/context staging
```

切回上一個情境（`cd -` 風格）：

```
/context -
```

呼叫 `/context -` 兩次會讓您回到起始位置。

### 4. 查看您擁有的情境

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

`*` 標記目前作用中的情境。

## 日常命令

| 命令 | 功能說明 |
|---|---|
| `/context` | 列出所有情境 |
| `/context <name>` | 切換到指定情境 |
| `/context -` | 切換到上一個情境 |
| `/context show` | 顯示作用中情境的詳細資訊（權杖已遮蔽） |
| `/context status` | 顯示目前認證狀態 |

## 情境生命週期

| 命令 | 功能說明 |
|---|---|
| `/context create <name> <url> <token> [namespace]` | 建立情境 |
| `/context delete <name> --confirm` | 刪除情境（需要 `--confirm`） |
| `/context rename <old> <new>` | 重新命名情境 |
| `/context validate <name>` | 測試認證而不切換 |
| `/context export [name] [--include-token]` | 匯出為 JSON（預設遮蔽權杖） |
| `/context import <path-or-json> [--overwrite]` | 從檔案或內嵌 JSON 匯入 |
| `/context wizard` | 引導式互動設定 |

## 切換命名空間

每個情境都有預設的命名空間。無需更改情境即可切換它：

```
/context namespace system
```

Tab 自動完成會提供來自作用中租戶的命名空間名稱。

## 情境上的環境變數

情境可以攜帶額外的環境變數，這些變數會在啟用時注入您的工作階段。適用於不屬於認證集合的各租戶設定。

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

別名：`add` = `set`，`remove`/`clear` = `unset`。

## Tab 自動完成

輸入 `/context ` 後按 Tab。下拉選單會顯示：

1. **情境名稱**——附帶租戶 URL 提示，方便您區分不同租戶
2. **`-`**——當您之前有切換過時出現，顯示您將會切換到哪個情境
3. **子命令**——`list`、`create`、`delete` 等

情境名稱排在最前面，因為切換是最常見的操作。

子命令層級的自動完成也可運作：`/context activate <Tab>` 會完成情境名稱，`/context namespace <Tab>` 會完成命名空間，`/context unset <Tab>` 會完成已知的環境變數鍵名。

## 命名規則

情境名稱必須為 1-64 個字元：字母、數字、連字號、底線。

與子命令衝突的名稱會被拒絕：

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

完整的保留字集合：`list`、`show`、`status`、`create`、`delete`、`rename`、`namespace`、`env`、`set`、`unset`、`add`、`remove`、`clear`、`activate`、`validate`、`export`、`import`、`wizard`、`help`。比較時不區分大小寫。

## 環境變數覆寫

如果在啟動 xcsh 之前，您的 shell 環境中已設定 `F5XC_API_URL` 和 `F5XC_API_TOKEN`，它們會優先於任何情境。這對於 CI/CD 管線或不需要建立持久情境的一次性工作階段非常有用。

在此模式下運作時，`/context` 會以 `(via env vars)` 標籤顯示來自環境的認證。

## 上一個情境的行為

- **工作階段範圍**：上一個情境會在您重新啟動 xcsh 時重置。它不會持久化到磁碟。
- **來回切換**：`/context -` 兩次會讓您回到起始位置。
- **跨異動安全**：如果您刪除了上一個情境，指標會被清除。如果您重新命名它，指標會跟隨新名稱。
- **重複啟用為空操作**：當已在 `production` 上時執行 `/context production` 不會重置上一個情境的指標。

## 設計慣例

`/context` 的使用者體驗遵循：

- **kubectx**：`kubectx <name>` 用於切換，`kubectx -` 用於上一個，單獨的 `kubectx` 用於列出
- **kubectl**：`kubectl config use-context` 作為明確形式
- **Shell**：`cd -` / `OLDPWD` 用於上一個目錄追蹤
