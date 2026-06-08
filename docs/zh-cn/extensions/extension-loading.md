---
title: 扩展加载（TypeScript/JavaScript 模块）
description: 扩展的 TypeScript 和 JavaScript 模块加载流水线，包含解析、验证和缓存。
sidebar:
  order: 2
  label: 扩展加载
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# 扩展加载（TypeScript/JavaScript 模块）

本文档介绍编程智能体如何在启动时发现和加载**扩展模块**（`.ts`/`.js`）。

本文档**不**涉及 `gemini-extension.json` 清单扩展（另有单独文档说明）。

## 本子系统的功能

扩展加载会构建模块入口文件列表，使用 Bun 导入每个模块，执行其工厂函数，并返回：

- 已加载的扩展定义
- 按路径分类的加载错误（不会中止整个加载过程）
- 一个共享的扩展运行时对象，供后续 `ExtensionRunner` 使用

## 主要实现文件

- `src/extensibility/extensions/loader.ts` — 路径发现 + 导入/执行
- `src/extensibility/extensions/index.ts` — 公共导出
- `src/extensibility/extensions/runner.ts` — 加载后的运行时/事件执行
- `src/discovery/builtin.ts` — 扩展模块的原生自动发现提供者
- `src/config/settings.ts` — 加载合并后的 `extensions` / `disabledExtensions` 设置

---

## 扩展加载的输入

### 1) 自动发现的原生扩展模块

`discoverAndLoadExtensions()` 首先向发现提供者请求具有 `extension-module` 能力的项目，然后仅保留提供者为 `native` 的项目。

有效的原生位置：

- 项目级：`<cwd>/.xcsh/extensions`
- 用户级：`~/.xcsh/agent/extensions`

路径根目录来自原生提供者（`SOURCE_PATHS.native`）。

注意事项：

- 原生自动发现目前基于 `.xcsh`。
- 旧版 `.pi` 在 `package.json` 清单键（`pi.extensions`）中仍然被接受，但此处不作为原生根目录。

### 2) 显式配置的路径

自动发现之后，配置的路径会被追加并解析。

主会话启动路径（`sdk.ts`）中的配置路径来源：

1. CLI 提供的路径（`--extension/-e`，`--hook` 也被视为扩展路径）
2. 设置中的 `extensions` 数组（合并全局 + 项目设置）

全局设置文件：

- `~/.xcsh/agent/config.yml`（或通过 `PI_CODING_AGENT_DIR` 指定自定义智能体目录）

项目设置文件：

- `<cwd>/.xcsh/settings.json`

示例：

```yaml
# ~/.xcsh/agent/config.yml
extensions:
  - ~/my-exts/safety.ts
  - ./local/ext-pack
```

```json
{
  "extensions": ["./.xcsh/extensions/my-extra"]
}
```

---

## 启用/禁用控制

### 禁用发现

- CLI：`--no-extensions`
- SDK 选项：`disableExtensionDiscovery`

行为差异：

- SDK：当 `disableExtensionDiscovery=true` 时，仍会通过 `loadExtensions()` 加载 `additionalExtensionPaths`。
- CLI 路径构建（`main.ts`）在设置 `--no-extensions` 时会清除 CLI 扩展路径，因此在该模式下显式的 `-e/--hook` 不会被转发。

### 禁用特定扩展模块

`disabledExtensions` 设置按扩展 ID 格式进行过滤：

- `extension-module:<derivedName>`

`derivedName` 基于入口路径（`getExtensionNameFromPath`），例如：

- `/x/foo.ts` -> `foo`
- `/x/bar/index.ts` -> `bar`

示例：

```yaml
disabledExtensions:
  - extension-module:foo
```

---

## 路径和入口解析

### 路径规范化

对于配置的路径：

1. 规范化 Unicode 空格
2. 展开 `~`
3. 如果是相对路径，基于当前 `cwd` 解析

### 如果配置的路径是文件

直接作为模块入口候选项使用。

### 如果配置的路径是目录

解析顺序：

1. 该目录中的 `package.json` 包含 `xcsh.extensions`（或旧版 `pi.extensions`）-> 使用声明的入口
2. `index.ts`
3. `index.js`
4. 否则扫描一级目录查找扩展入口：
   - 直接的 `*.ts` / `*.js`
   - 子目录的 `index.ts` / `index.js`
   - 子目录的 `package.json` 包含 `xcsh.extensions` / `pi.extensions`

规则和约束：

- 不会递归发现超过一个子目录层级
- 声明的 `extensions` 清单入口相对于该包目录进行解析
- 声明的入口仅在文件存在/访问允许时才会包含
- 在 `*/index.{ts,js}` 对中，TypeScript 优先于 JavaScript
- 符号链接被视为合格的文件/目录

### 忽略行为因来源而异

- 原生自动发现（发现辅助工具中的 `discoverExtensionModulePaths`）使用原生 glob，设置 `gitignore: true` 和 `hidden: false`。
- `loader.ts` 中的显式配置目录扫描使用 `readdir` 规则，**不会**应用 gitignore 过滤。

---

## 加载顺序和优先级

`discoverAndLoadExtensions()` 构建一个有序列表，然后调用 `loadExtensions()`。

顺序：

1. 原生自动发现的模块
2. 显式配置的路径（按提供的顺序）

在 `sdk.ts` 中，配置顺序为：

1. CLI 附加路径
2. 设置中的 `extensions`

去重：

- 基于绝对路径
- 先出现的路径优先
- 后出现的重复项被忽略

含义：如果同一模块路径既被自动发现又被显式配置，它只会在第一个位置（自动发现阶段）加载一次。

---

## 模块导入和工厂契约

每个候选路径通过动态导入加载：

- `await import(resolvedPath)`
- 工厂函数为 `module.default ?? module`
- 工厂必须是一个函数（`ExtensionFactory`）

如果导出不是函数，该路径会以结构化错误失败，加载继续进行。

---

## 故障处理和隔离

### 加载期间

每个扩展路径的故障被捕获为 `{ path, error }`，不会阻止其他路径的加载。

常见情况：

- 导入失败 / 文件缺失
- 无效的工厂导出（非函数）
- 执行工厂时抛出异常

### 运行时隔离模型

- 扩展**不是沙箱化的**（同一进程/运行时）。
- 它们共享一个 `EventBus` 和一个 `ExtensionRuntime` 实例。
- 在加载期间，运行时操作方法会故意抛出 `ExtensionRuntimeNotInitializedError`；操作绑定稍后在 `ExtensionRunner.initialize()` 中完成。

### 加载之后

当事件通过 `ExtensionRunner` 运行时，处理程序异常会被捕获并作为扩展错误发出，而不是导致运行循环崩溃。

---

## 最小用户/项目布局示例

### 用户级

```text
~/.xcsh/agent/
  config.yml
  extensions/
    guardrails.ts
    audit/
      index.ts
```

### 项目级

```text
<repo>/
  .xcsh/
    settings.json
    extensions/
      checks/
        package.json
      lint-gates.ts
```

`checks/package.json`：

```json
{
  "xcsh": {
    "extensions": ["./src/check-a.ts", "./src/check-b.js"]
  }
}
```

旧版清单键仍然被接受：

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
