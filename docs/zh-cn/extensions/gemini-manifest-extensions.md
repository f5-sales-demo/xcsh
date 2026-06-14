---
title: Gemini 清单扩展
description: 用于跨平台技能与代理兼容性的 Gemini 清单扩展格式。
sidebar:
  order: 7
  label: Gemini 清单
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Gemini 清单扩展（`gemini-extension.json`）

本文档介绍编码代理如何发现并解析 Gemini 风格的清单扩展（`gemini-extension.json`），并将其纳入 `extensions` 能力。

本文**不**涵盖 TypeScript/JavaScript 扩展模块加载（`extensions/*.ts`、`index.ts`、`package.json xcsh.extensions`），相关内容请参阅 `extension-loading.md`。

## 实现文件

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## 发现范围

Gemini 提供者（`id: gemini`，优先级 `60`）注册一个 `extensions` 加载器，扫描两个固定根目录：

- 用户级：`~/.gemini/extensions`
- 项目级：`<cwd>/.gemini/extensions`

路径解析通过 `getUserPath()` / `getProjectPath()` 直接从 `ctx.home` 和 `ctx.cwd` 获取。

重要作用域规则：项目级查找**仅限当前工作目录**，不会向上遍历父目录。

---

## 目录扫描规则

对于每个根目录（`~/.gemini/extensions` 和 `<cwd>/.gemini/extensions`），发现过程如下：

1. `readDirEntries(root)`
2. 仅保留直接子目录（`entry.isDirectory()`）
3. 对每个子目录 `<name>`，尝试精确读取：
   - `<root>/<name>/gemini-extension.json`

扫描深度不超过一级目录，不进行递归扫描。

### 隐藏目录

Gemini 清单发现**不**过滤以点号开头的目录名。如果某个隐藏子目录存在且包含 `gemini-extension.json`，则该目录会被纳入处理。

### 文件缺失或不可读

如果 `gemini-extension.json` 缺失或不可读，该目录将被静默跳过（不产生警告）。

---

## 清单结构（实现层面）

能力类型定义了如下清单结构：

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

发现阶段的行为有意保持宽松：

- 要求 JSON 解析成功。
- 除 JSON 语法外，不对字段类型或内容进行运行时 schema 校验。
- 解析后的对象以 `manifest` 形式存储在能力条目上。

### 名称规范化

`Extension.name` 的取值规则如下：

1. 若 `manifest.name` 不为 `null`/`undefined`，则使用该值
2. 否则使用扩展目录名

此处不强制要求字符串类型。

---

## 物化为能力条目

解析成功的清单将创建一个 `Extension` 能力条目：

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // 由能力注册表附加
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

说明：

- `_source.path` 由 `createSourceMeta()` 规范化为绝对路径。
- 注册表级别对 `extensions` 的能力校验仅检查 `name` 和 `path` 是否存在。
- 清单内部字段（`mcpServers`、`tools`、`context`）在发现阶段不进行校验。

---

## 错误处理与警告语义

### 产生警告

- 清单文件中存在无效 JSON：
  - 警告格式：`Invalid JSON in <manifestPath>`

### 不产生警告（静默跳过）

- `extensions` 目录不存在
- 子目录中不含 `gemini-extension.json`
- 清单文件不可读
- 清单 JSON 语法合法但语义异常或不完整

这意味着部分有效性是被接受的：仅 JSON 语法失败会触发警告。

---

## 与其他来源的优先级及去重规则

`extensions` 能力由能力注册表跨提供者聚合。

当前支持该能力的提供者：

- `native`（`packages/coding-agent/src/discovery/builtin.ts`），优先级 `100`
- `gemini`（`packages/coding-agent/src/discovery/gemini.ts`），优先级 `60`

去重键为 `ext.name`（`extensionCapability.key = ext => ext.name`）。

### 跨提供者优先级

重复扩展名以高优先级提供者为准。

- 若 `native` 和 `gemini` 均提供名为 `foo` 的扩展，则保留 native 条目。
- 低优先级的重复项仅保留在 `result.all` 中，并标记 `_shadowed = true`。

### 提供者内部顺序影响

由于去重策略为"先出现者优先"，提供者内部的条目顺序会影响结果。

- Gemini 加载器按**用户优先**、**项目其次**的顺序追加条目。
- 因此，`~/.gemini/extensions` 与 `<cwd>/.gemini/extensions` 之间的同名扩展，将保留用户级条目，项目级条目被遮蔽。

相比之下，native 提供者通过 `getConfigDirs()` 以不同顺序构建配置目录（先 `project` 后 `user`），因此 native 提供者内部的遮蔽方向相反。

---

## 用户级与项目级行为总结

对于 Gemini 清单，具体行为如下：

- 每次加载时，用户级与项目级根目录均会被扫描。
- 项目级根目录固定为 `<cwd>/.gemini/extensions`（不向上遍历祖先目录）。
- Gemini 来源内部的同名冲突以用户级优先解决。
- 与高优先级提供者（尤其是 native）发生同名冲突时，Gemini 条目因优先级较低而被遮蔽。

---

## 边界：发现元数据与运行时扩展加载

`gemini-extension.json` 的发现目前仅用于填充能力元数据（`Extension` 条目），**不**直接加载可运行的 TS/JS 扩展模块。

运行时模块加载（`discoverAndLoadExtensions()` / `loadExtensions()`）使用 `extension-modules` 和显式路径，且目前仅对提供者为 `native` 的自动发现模块进行过滤处理。

实际含义：

- Gemini 清单扩展可作为能力记录被发现。
- 它们本身不会被扩展加载器管道作为运行时扩展模块执行。

这一边界在当前实现中是有意为之的设计，也解释了为何清单发现与可执行模块加载可能存在差异。
