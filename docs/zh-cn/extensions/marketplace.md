---
title: Marketplace 插件系统
description: Marketplace 插件系统，用于发现、安装和管理精选的插件集合。
sidebar:
  order: 4
  label: Marketplace
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# Marketplace 插件系统

Marketplace 系统让您可以从 Git 托管的目录中发现、安装和管理插件。它与 Claude Code 插件注册表格式兼容。

## 快速开始

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

或者直接输入 `/marketplace`（不带任何参数）来打开交互式插件浏览器。

## 概念

**marketplace** 是一个 Git 仓库（或本地目录），其中包含位于 `.xcsh-plugin/marketplace.json` 的目录文件。该目录列出了可用的插件及其来源、描述和元数据。

**插件**是一个包含技能、命令、钩子、MCP 服务器或 LSP 服务器的目录。插件通过 `name@marketplace` 标识（例如 `code-review@f5xc-salesdemos-marketplace`）。

**作用域**：插件可以在两个作用域中安装：

- **user**（默认）—— 在所有项目中可用，存储在 `~/.xcsh/plugins/installed_plugins.json`
- **project** —— 仅在当前项目中可用，存储在 `.xcsh/installed_plugins.json`

项目作用域的安装会覆盖同一插件的用户作用域安装。

## 命令

### 交互模式

| 命令 | 效果 |
|---|---|
| `/marketplace` | 打开交互式插件浏览器（安装） |

### Marketplace 管理

| 命令 | 效果 |
|---|---|
| `/marketplace add <source>` | 添加一个 marketplace 源 |
| `/marketplace remove <name>` | 移除一个 marketplace |
| `/marketplace update [name]` | 重新获取目录；省略名称则更新所有 |
| `/marketplace list` | 列出已配置的 marketplace |

### 插件操作

| 命令 | 效果 |
|---|---|
| `/marketplace discover [marketplace]` | 浏览可用插件 |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | 安装插件 |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | 卸载插件 |
| `/marketplace installed` | 列出已安装的 marketplace 插件 |
| `/marketplace upgrade [--scope user\|project] [name@marketplace]` | 升级一个或所有插件 |

### CLI 等效命令

相同的操作也可以通过命令行执行：

```
xcsh plugin marketplace add <source>
xcsh plugin marketplace remove <name>
xcsh plugin marketplace update [name]
xcsh plugin marketplace list
xcsh plugin discover [marketplace]
xcsh plugin install --scope project name@marketplace
```

## Marketplace 源

当您运行 `/marketplace add <source>` 时，系统会对源进行分类：

| 源格式 | 类型 | 示例 |
|---|---|---|
| `owner/repo` | GitHub 简写 | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | 直接目录 URL | `https://example.com/marketplace.json` |
| `https://...*.git` 或 `git@...` | Git 仓库 | `https://github.com/org/repo.git` |
| `./path` 或 `~/path` 或 `/path` | 本地目录 | `./my-marketplace` |

系统会克隆仓库（或读取本地目录），定位 `.xcsh-plugin/marketplace.json`，对其进行验证，并在本地缓存目录。

## 目录格式 (marketplace.json)

Marketplace 目录位于仓库根目录的 `.xcsh-plugin/marketplace.json`：

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

### 必填字段

| 字段 | 描述 |
|---|---|
| `name` | Marketplace 名称。小写字母数字、连字符和点号。必须以字母数字开头和结尾。最多 64 个字符。 |
| `owner.name` | Marketplace 所有者名称 |
| `plugins` | 插件条目数组 |

### 插件条目字段

| 字段 | 必填 | 描述 |
|---|---|---|
| `name` | 是 | 插件名称（与 marketplace 名称规则相同） |
| `source` | 是 | 插件的来源位置（见下文） |
| `description` | 否 | 简短描述 |
| `version` | 否 | 版本字符串 |
| `author` | 否 | `{ name, email? }` |
| `homepage` | 否 | URL |
| `category` | 否 | 类别字符串（例如 `development`、`productivity`、`security`） |
| `tags` | 否 | 字符串标签数组 |
| `strict` | 否 | 布尔值 |
| `commands` | 否 | 提供的斜杠命令 |
| `agents` | 否 | 提供的代理 |
| `hooks` | 否 | 钩子定义 |
| `mcpServers` | 否 | MCP 服务器定义 |
| `lspServers` | 否 | LSP 服务器定义 |

### 插件源格式

`source` 字段支持多种格式：

**相对路径**（在 marketplace 仓库内）：

```json
"source": "./plugins/my-plugin"
```

**Git 仓库 URL**：

```json
"source": {
  "source": "url",
  "url": "https://github.com/org/repo.git",
  "sha": "abc123..."
}
```

**GitHub 简写**：

```json
"source": {
  "source": "github",
  "repo": "org/repo",
  "ref": "main",
  "sha": "abc123..."
}
```

**Git 子目录**（monorepo）：

```json
"source": {
  "source": "git-subdir",
  "url": "https://github.com/org/monorepo.git",
  "path": "plugins/my-plugin",
  "ref": "main",
  "sha": "abc123..."
}
```

**npm 包**：

```json
"source": {
  "source": "npm",
  "package": "@scope/my-plugin",
  "version": "1.0.0"
}
```

## 磁盘布局

```
~/.xcsh/
  config/
    marketplaces.json          # 已添加的 marketplace 注册表
  plugins/
    installed_plugins.json     # 用户作用域已安装的插件
    cache/
      marketplaces/            # 缓存的 marketplace 目录
      plugins/                 # 缓存的插件目录

<project>/.xcsh/
  installed_plugins.json       # 项目作用域已安装的插件
```

## 命名规则

Marketplace 和插件名称必须：

- 以小写字母或数字开头和结尾
- 仅包含小写字母、数字、连字符和点号
- 最多 64 个字符

插件 ID（`name@marketplace`）总长度不得超过 128 个字符。

有效示例：`my-plugin`、`code-review`、`wordpress.com`、`ai-firstify`
无效示例：`-bad`、`bad-`、`.bad`、`Bad`、`under_score`
