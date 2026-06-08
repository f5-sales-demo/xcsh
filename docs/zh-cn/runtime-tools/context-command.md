---
title: F5 XC 上下文
description: 将 xcsh 连接到 F5 Distributed Cloud 租户——创建、切换和管理认证上下文。
sidebar:
  order: 1
  label: F5 XC 上下文
i18n:
  sourceHash: bdaf0fb8837c
  translator: machine
---

# F5 XC 上下文

xcsh 通过**上下文**连接到 F5 Distributed Cloud——上下文是绑定了租户 URL、API 令牌和命名空间的命名凭证集。如果您使用过 `kubectl config use-context` 或 `kubectx`，工作流程完全相同：创建上下文，按名称在它们之间切换，使用 `-` 快速切回上一个。

## 入门

### 1. 创建您的第一个上下文

您需要从 F5 XC 控制台获取三项信息：租户 URL、API 令牌，以及可选的命名空间。

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

如果您更喜欢逐步引导的方式，也可以使用引导向导：

```
/context wizard
```

### 2. 激活上下文

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

激活后，xcsh 会将租户凭证注入到您的会话中。代理现在可以进行 F5 XC API 调用，状态栏会显示当前活动的上下文。

### 3. 添加更多上下文并在它们之间切换

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

按名称切换——不需要子命令动词：

```
/context staging
```

切回上一个上下文（`cd -` 风格）：

```
/context -
```

连续调用 `/context -` 两次会将您带回起始位置。

### 4. 查看已有上下文

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

`*` 标记表示当前活动的上下文。

## 日常命令

| 命令 | 功能说明 |
|---|---|
| `/context` | 列出所有上下文 |
| `/context <name>` | 切换到指定上下文 |
| `/context -` | 切换到上一个上下文 |
| `/context show` | 显示活动上下文详情（令牌已脱敏） |
| `/context status` | 显示当前认证状态 |

## 上下文生命周期

| 命令 | 功能说明 |
|---|---|
| `/context create <name> <url> <token> [namespace]` | 创建上下文 |
| `/context delete <name> --confirm` | 删除上下文（需要 `--confirm`） |
| `/context rename <old> <new>` | 重命名上下文 |
| `/context validate <name>` | 测试凭证而不切换 |
| `/context export [name] [--include-token]` | 导出为 JSON（默认脱敏令牌） |
| `/context import <path-or-json> [--overwrite]` | 从文件或内联 JSON 导入 |
| `/context wizard` | 引导式交互设置 |

## 切换命名空间

每个上下文都有一个默认命名空间。可以在不更改上下文的情况下切换命名空间：

```
/context namespace system
```

Tab 补全会提供当前活动租户的命名空间名称。

## 上下文上的环境变量

上下文可以携带额外的环境变量，这些变量在激活时会被注入到您的会话中。适用于不属于凭证集的租户级别配置。

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

别名：`add` = `set`，`remove`/`clear` = `unset`。

## Tab 补全

输入 `/context ` 后按 Tab 键。下拉菜单会显示：

1. **上下文名称**——附带租户 URL 提示，便于区分不同租户
2. **`-`**——当您之前切换过时出现，显示将切换到哪个上下文
3. **子命令**——`list`、`create`、`delete` 等

上下文名称排在最前面，因为切换是最常见的操作。

子命令级别的补全同样有效：`/context activate <Tab>` 补全上下文名称，`/context namespace <Tab>` 补全命名空间，`/context unset <Tab>` 补全已知的环境变量键。

## 命名规则

上下文名称必须为 1-64 个字符：字母、数字、连字符、下划线。

与子命令冲突的名称会被拒绝：

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

完整的保留名称集合：`list`、`show`、`status`、`create`、`delete`、`rename`、`namespace`、`env`、`set`、`unset`、`add`、`remove`、`clear`、`activate`、`validate`、`export`、`import`、`wizard`、`help`。比较时不区分大小写。

## 环境变量覆盖

如果在启动 xcsh 之前，Shell 环境中已设置了 `F5XC_API_URL` 和 `F5XC_API_TOKEN`，它们将优先于任何上下文。这在 CI/CD 流水线或不需要创建持久上下文的临时会话中非常有用。

在此模式下运行时，`/context` 会以 `(via env vars)` 标签显示来自环境变量的凭证。

## 上一个上下文行为

- **会话作用域**：上一个上下文在重启 xcsh 时会重置，不会持久化到磁盘。
- **乒乓切换**：连续执行 `/context -` 两次会将您带回起始位置。
- **变更安全**：如果删除了上一个上下文，指针会被清除。如果重命名了它，指针会跟随新名称。
- **重复激活为空操作**：当已经在 `production` 上下文时执行 `/context production` 不会重置上一个指针。

## 设计约定

`/context` 的用户体验遵循以下设计：

- **kubectx**：`kubectx <name>` 用于切换，`kubectx -` 用于切回上一个，单独的 `kubectx` 用于列出
- **kubectl**：`kubectl config use-context` 作为显式形式
- **Shell**：`cd -` / `OLDPWD` 用于上一个目录跟踪
