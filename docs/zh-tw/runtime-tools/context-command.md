---
title: F5 XC 環境上下文
description: 將 xcsh 連線至 F5 Distributed Cloud 租戶——建立、切換及管理驗證環境上下文。
sidebar:
  order: 1
  label: F5 XC 環境上下文
i18n:
  sourceHash: bdaf0fb8837c
  translator: machine
---

# F5 XC 環境上下文

xcsh 透過**環境上下文（contexts）**連線至 F5 Distributed Cloud——環境上下文是具名的憑證集合，將租戶 URL、API 令牌和命名空間繫結在一起。如果您曾使用過 `kubectl config use-context` 或 `kubectx`，其工作流程完全相同：建立環境上下文、透過名稱在它們之間切換，並使用 `-` 快速切回上一個。

## 入門指南

### 1. 建立您的第一個環境上下文

您需要從 F5 XC 控制台取得三項資訊：租戶 URL、API 令牌，以及選擇性的命名空間。

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

如果您偏好逐步引導提示，也可以使用引導式精靈：

```
/context wizard
```

### 2. 啟用環境上下文

```
/context production
```

```
╭─ production ─────────────────────────────────────────────────╮
│ XCSH_TENANT     acme                                         │
│ XCSH_API_URL    https://acme.console.ves.volterra.io         │
│ XCSH_API_TOKEN  ...oken                                      │
│ Status          Connected (312ms)                            │
├─ Environment ────────────────────────────────────────────────┤
│ XCSH_NAMESPACE  default                                      │
╰──────────────────────────────────────────────────────────────╯
```

啟用後，xcsh 會將租戶憑證注入您的工作階段。代理程式現在可以進行 F5 XC API 呼叫，狀態列會顯示目前使用中的環境上下文。

### 3. 新增更多環境上下文並在它們之間切換

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

透過名稱切換——不需要子命令動詞：

```
/context staging
```

切回上一個環境上下文（`cd -` 風格）：

```
/context -
```

呼叫 `/context -` 兩次會讓您回到起始位置。

### 4. 檢視現有的環境上下文

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

`*` 標記目前使用中的環境上下文。

## 日常命令

| 命令 | 功能說明 |
|---|---|
| `/context` | 列出所有環境上下文 |
| `/context <name>` | 切換至指定的環境上下文 |
| `/context -` | 切換至上一個環境上下文 |
| `/context show` | 顯示目前使用中的環境上下文詳細資訊（令牌已遮蔽） |
| `/context status` | 顯示目前的驗證狀態 |

## 環境上下文生命週期

| 命令 | 功能說明 |
|---|---|
| `/context create <name> <url> <token> [namespace]` | 建立環境上下文 |
| `/context delete <name> --confirm` | 刪除環境上下文（需要 `--confirm`） |
| `/context rename <old> <new>` | 重新命名環境上下文 |
| `/context validate <name>` | 測試憑證但不切換 |
| `/context export [name] [--include-token]` | 匯出為 JSON（預設遮蔽令牌） |
| `/context import <path-or-json> [--overwrite]` | 從檔案或行內 JSON 匯入 |
| `/context wizard` | 引導式互動設定 |

## 切換命名空間

每個環境上下文都有一個預設命名空間。無需變更環境上下文即可切換命名空間：

```
/context namespace system
```

Tab 自動補全會提供來自使用中租戶的命名空間名稱。

## 環境上下文上的環境變數

環境上下文可以攜帶額外的環境變數，這些變數會在啟用時注入您的工作階段。這對於不屬於憑證集合一部分的租戶專屬設定非常有用。

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

別名：`add` = `set`，`remove`/`clear` = `unset`。

## Tab 自動補全

輸入 `/context ` 後按下 Tab 鍵。下拉選單會顯示：

1. **環境上下文名稱**——附帶租戶 URL 提示，讓您能區分不同租戶
2. **`-`**——當您之前有切換過時出現，顯示您將切換至哪個環境上下文
3. **子命令**——`list`、`create`、`delete` 等

環境上下文名稱會優先顯示，因為切換是最常見的操作。

子命令層級的補全同樣有效：`/context activate <Tab>` 會補全環境上下文名稱，`/context namespace <Tab>` 會補全命名空間，`/context unset <Tab>` 會補全已知的環境變數鍵。

## 命名規則

環境上下文名稱必須為 1-64 個字元：字母、數字、連字號、底線。

與子命令衝突的名稱會被拒絕：

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

完整的保留字集合：`list`、`show`、`status`、`create`、`delete`、`rename`、`namespace`、`env`、`set`、`unset`、`add`、`remove`、`clear`、`activate`、`validate`、`export`、`import`、`wizard`、`help`。比較時不區分大小寫。

## 環境變數覆寫

如果在啟動 xcsh 之前，您的 shell 環境中已設定了 `XCSH_API_URL` 和 `XCSH_API_TOKEN`，它們將優先於任何環境上下文。這在 CI/CD 流水線或一次性工作階段中非常有用，讓您無需建立持久性的環境上下文。

在此模式下執行時，`/context` 會以 `(via env vars)` 標籤顯示來源為環境變數的憑證。

## 上一個環境上下文的行為

- **工作階段範圍**：上一個環境上下文會在您重新啟動 xcsh 時重設，不會持久化到磁碟。
- **來回切換**：`/context -` 執行兩次會讓您回到起始位置。
- **安全應對變更操作**：如果您刪除了上一個環境上下文，指標會被清除。如果您重新命名它，指標會跟隨新名稱。
- **重複啟用為無操作**：當已在 `production` 上時執行 `/context production` 不會重設上一個環境上下文的指標。

## 設計慣例

`/context` 的使用者體驗遵循：

- **kubectx**：`kubectx <name>` 用於切換，`kubectx -` 用於切回上一個，單獨的 `kubectx` 用於列出
- **kubectl**：`kubectl config use-context` 用於明確形式
- **Shell**：`cd -` / `OLDPWD` 用於上一個目錄追蹤
