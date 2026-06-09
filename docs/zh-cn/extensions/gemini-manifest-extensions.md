---
title: Gemini 清单扩展
description: Gemini 清单扩展格式，用于跨平台技能和代理兼容性。
sidebar:
  order: 7
  label: Gemini 清单
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

Gemini 提供者（`id: gemini`，优先级 `60`）注册了一个 `extensions` 加载器，扫描两个固定根目录：

- 用户目录：`~/.gemini/extensions`
- 项目目录：`<cwd>/.gemini/extensions`

路径解析直接通过 `getUserPath()` / `getProjectPath()` 从 `ctx.home` 和 `ctx.cwd` 获取。

重要的作用域规则：项目查找**仅限当前工作目录**。不会向上遍历父目录。

---

## 目录扫描规则

对于每个根目录（`~/.gemini/extensions` 和 `<cwd>/.gemini/extensions`），发现过程执行以下操作：

1. `readDirEntries(root)`
2. 仅保留直接子目录（`entry.isDirectory()`）
3. 对于每个子目录 `<name>`，尝试精确读取：
   - `<root>/<name>/gemini-extension.json`

不会在一级目录之外进行递归扫描。

### 隐藏目录

Gemini 清单发现**不会**过滤以点号为前缀的目录名。如果存在隐藏子目录且包含 `gemini-extension.json`，该目录会被纳入考虑。

### 缺失/不可读文件

如果 `gemini-extension.json` 缺失或不可读，该目录将被静默跳过（无警告）。

---

## 清单结构（实际实现）

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

发现阶段的行为有意保持宽松：

- 要求 JSON 解析成功。
- 除 JSON 语法之外，不对字段类型/内容进行运行时模式验证。
- 解析后的对象作为 `manifest` 存储在能力项上。

### 名称规范化

`Extension.name` 设置为：

1. 如果 `manifest.name` 不是 `null`/`undefined`，则使用 `manifest.name`
2. 否则使用扩展目录名

此处不强制执行字符串类型检查。

---

## 转化为能力项

一个成功解析的清单会创建一个 `Extension` 能力项：

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

注意事项：

- `_source.path` 由 `createSourceMeta()` 规范化为绝对路径。
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
- 清单 JSON 语法有效但语义上异常/不完整

这意味着部分有效性是被接受的：只有语法层面的 JSON 解析失败才会发出警告。

---

## 与其他来源的优先级和去重

`extensions` 能力由能力注册表跨提供者进行聚合。

该能力当前的提供者：

- `native`（`packages/coding-agent/src/discovery/builtin.ts`）优先级 `100`
- `gemini`（`packages/coding-agent/src/discovery/gemini.ts`）优先级 `60`

去重键为 `ext.name`（`extensionCapability.key = ext => ext.name`）。

### 跨提供者优先级

在扩展名称重复时，优先级更高的提供者胜出。

- 如果 `native` 和 `gemini` 都发出名为 `foo` 的扩展，则保留 native 的项。
- 优先级较低的重复项仅保留在 `result.all` 中，且 `_shadowed = true`。

### 提供者内部的顺序影响

由于去重采用"先见者胜"策略，提供者内部的项目顺序很重要。

- Gemini 加载器**先添加用户目录**，然后添加**项目目录**。
- 因此，`~/.gemini/extensions` 和 `<cwd>/.gemini/extensions` 之间的重名会保留用户条目，遮蔽项目条目。

相比之下，native 提供者以不同的顺序构建配置目录（`getConfigDirs()` 中先 `project` 后 `user`），因此 native 提供者内部的遮蔽方向相反。

---

## 用户级与项目级行为总结

特别针对 Gemini 清单：

- 每次加载都会扫描用户和项目两个根目录。
- 项目根目录固定为 `<cwd>/.gemini/extensions`（不向上遍历祖先目录）。
- Gemini 来源内部的重名按用户优先解析。
- 与更高优先级提供者（特别是 native）的重名按优先级败出。

---

## 边界：发现元数据与运行时扩展加载

`gemini-extension.json` 发现目前提供的是能力元数据（`Extension` 项）。它**不**直接加载可运行的 TS/JS 扩展模块。

运行时模块加载（`discoverAndLoadExtensions()` / `loadExtensions()`）使用 `extension-modules` 和显式路径，当前仅将自动发现的模块过滤为 `native` 提供者。

实际影响：

- Gemini 清单扩展可作为能力记录被发现。
- 它们本身不会被扩展加载器管道作为运行时扩展模块执行。

这一边界在当前实现中是有意为之的，这也解释了为什么清单发现和可执行模块加载可能会产生分歧。
