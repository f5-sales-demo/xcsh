---
title: Gemini Manifest Extensions
description: Gemini 清单扩展格式，用于跨平台技能和代理兼容性。
sidebar:
  order: 7
  label: Gemini manifest
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Gemini 清单扩展 (`gemini-extension.json`)

本文档介绍编码代理如何发现和解析 Gemini 风格的清单扩展 (`gemini-extension.json`) 并将其转化为 `extensions` 能力。

本文档**不**涵盖 TypeScript/JavaScript 扩展模块加载（`extensions/*.ts`、`index.ts`、`package.json xcsh.extensions`），相关内容请参阅 `extension-loading.md`。

## 实现文件

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## 发现的内容

Gemini 提供者（`id: gemini`，优先级 `60`）注册了一个 `extensions` 加载器，扫描两个固定的根目录：

- 用户级：`~/.gemini/extensions`
- 项目级：`<cwd>/.gemini/extensions`

路径解析直接通过 `getUserPath()` / `getProjectPath()` 从 `ctx.home` 和 `ctx.cwd` 获取。

重要的作用域规则：项目查找**仅限于 cwd**。它不会遍历父目录。

---

## 目录扫描规则

对于每个根目录（`~/.gemini/extensions` 和 `<cwd>/.gemini/extensions`），发现过程执行以下操作：

1. `readDirEntries(root)`
2. 仅保留直接子目录（`entry.isDirectory()`）
3. 对于每个子目录 `<name>`，尝试准确读取：
   - `<root>/<name>/gemini-extension.json`

不会进行超过一级目录的递归扫描。

### 隐藏目录

Gemini 清单发现**不会**过滤以点号开头的目录名。如果存在隐藏的子目录并且包含 `gemini-extension.json`，它会被纳入考虑。

### 缺失/不可读文件

如果 `gemini-extension.json` 缺失或不可读，该目录将被静默跳过（不产生警告）。

---

## 清单结构（按实现）

能力类型定义了以下清单结构：

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

发现阶段的行为是有意宽松的：

- 需要 JSON 解析成功。
- 除 JSON 语法之外，不对字段类型/内容进行运行时模式验证。
- 解析后的对象作为 `manifest` 存储在能力项上。

### 名称规范化

`Extension.name` 设置为：

1. 如果 `manifest.name` 不为 `null`/`undefined`，则使用 `manifest.name`
2. 否则使用扩展目录名

此处不应用字符串类型强制检查。

---

## 物化为能力项

一个有效的已解析清单会创建一个 `Extension` 能力项：

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // attached by capability registry
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

注意事项：

- `_source.path` 通过 `createSourceMeta()` 规范化为绝对路径。
- 注册表级别的 `extensions` 能力验证仅检查 `name` 和 `path` 是否存在。
- 清单内部内容（`mcpServers`、`tools`、`context`）在发现阶段不进行验证。

---

## 错误处理和警告语义

### 产生警告

- 清单文件中的 JSON 无效：
  - 警告格式：`Invalid JSON in <manifestPath>`

### 不产生警告（静默跳过）

- `extensions` 目录缺失
- 子目录没有 `gemini-extension.json`
- 清单文件不可读
- 清单 JSON 语法有效但语义异常/不完整

这意味着部分有效性是被接受的：只有 JSON 语法失败才会发出警告。

---

## 与其他来源的优先级和去重

`extensions` 能力通过能力注册表在各提供者之间聚合。

当前提供此能力的提供者：

- `native`（`packages/coding-agent/src/discovery/builtin.ts`）优先级 `100`
- `gemini`（`packages/coding-agent/src/discovery/gemini.ts`）优先级 `60`

去重键为 `ext.name`（`extensionCapability.key = ext => ext.name`）。

### 跨提供者优先级

优先级更高的提供者在扩展名重复时胜出。

- 如果 `native` 和 `gemini` 都发出扩展名 `foo`，则保留 native 项。
- 较低优先级的重复项仅保留在 `result.all` 中，并标记 `_shadowed = true`。

### 提供者内部顺序影响

因为去重采用"先到先得"策略，提供者本地的项目顺序很重要。

- Gemini 加载器**先追加用户级**，然后是**项目级**。
- 因此，`~/.gemini/extensions` 和 `<cwd>/.gemini/extensions` 之间的重复名称会保留用户级条目并遮蔽项目级条目。

相比之下，native 提供者以不同的顺序构建配置目录（在 `getConfigDirs()` 中先 `project` 后 `user`），因此 native 提供者内部的遮蔽方向是相反的。

---

## 用户级与项目级行为总结

对于 Gemini 清单具体而言：

- 每次加载都会扫描用户级和项目级两个根目录。
- 项目根目录固定为 `<cwd>/.gemini/extensions`（不遍历祖先目录）。
- Gemini 来源内的重复名称解析为用户级优先。
- 与更高优先级提供者（特别是 native）的重复名称按优先级落败。

---

## 边界：发现元数据与运行时扩展加载

`gemini-extension.json` 发现目前提供的是能力元数据（`Extension` 项）。它**不会**直接加载可运行的 TS/JS 扩展模块。

运行时模块加载（`discoverAndLoadExtensions()` / `loadExtensions()`）使用 `extension-modules` 和显式路径，并且目前将自动发现的模块过滤为仅限提供者 `native`。

实际影响：

- Gemini 清单扩展可作为能力记录被发现。
- 它们本身不会被扩展加载器管道作为运行时扩展模块执行。

这一边界在当前实现中是有意为之的，这也解释了为什么清单发现和可执行模块加载可以存在差异。
