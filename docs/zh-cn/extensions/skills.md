---
title: 技能
description: 技能系统，用于在编码代理中注册、发现和调用专用能力。
sidebar:
  order: 3
  label: 技能
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# 技能

技能是基于文件的能力包，在启动时被发现，并以以下方式暴露给模型：

- 系统提示中的轻量级元数据（名称 + 描述）
- 通过 `read skill://...` 按需获取内容
- 可选的交互式 `/skill:<name>` 命令

本文档涵盖 `src/extensibility/skills.ts`、`src/discovery/builtin.ts`、`src/internal-urls/skill-protocol.ts` 和 `src/discovery/agents-md.ts` 中的当前运行时行为。

## 本代码库中技能的定义

一个被发现的技能表示为：

- `name`
- `description`
- `filePath`（`SKILL.md` 路径）
- `baseDir`（技能目录）
- 来源元数据（`provider`、`level`、路径）

运行时只需要 `name` 和 `path` 即可视为有效。实际上，匹配质量取决于 `description` 是否有意义。

## 必需的目录布局和 SKILL.md 要求

### 目录布局

对于基于提供者的发现（native/Claude/Codex/Agents/plugin 提供者），技能以 **`skills/` 下一级** 的方式被发现：

- `<skills-root>/<skill-name>/SKILL.md`

像 `<skills-root>/group/<skill>/SKILL.md` 这样的嵌套模式不会被提供者加载器发现。

对于 `skills.customDirectories`，扫描使用相同的非递归布局（`*/SKILL.md`）。

```text
Provider-discovered layout (non-recursive under skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ discovered
  ├─ pdf/
  │   └─ SKILL.md      ✅ discovered
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ not discovered by provider loaders

Custom-directory scanning is also non-recursive, so nested paths are ignored unless you point `customDirectories` at that nested parent.
```

### `SKILL.md` 前置元数据

技能类型支持的前置元数据字段：

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- 其他键作为未知元数据保留

当前运行时行为：

- `name` 默认为技能目录名称
- `description` 在以下情况下是必需的：
  - 原生 `.xcsh` 提供者技能发现（`requireDescription: true`）
  - 通过 `src/discovery/helpers.ts` 中的 `scanSkillsFromDir` 进行 `skills.customDirectories` 扫描（非递归）
- 非原生提供者可以加载没有描述的技能

## 发现流程

`src/extensibility/skills.ts` 中的 `discoverSkills()` 执行两个阶段：

1. **能力提供者** 通过 `loadCapability("skills")`
2. **自定义目录** 通过 `scanSkillsFromDir(..., { requireDescription: true })`（一级目录枚举）

如果 `skills.enabled` 为 `false`，发现不会返回任何技能。

### 内置技能提供者和优先级

提供者排序以优先级为先（高优先级胜出），相同优先级按注册顺序。

当前已注册的技能提供者：

1. `native`（优先级 100）— 通过 `src/discovery/builtin.ts` 提供的 `.xcsh` 用户/项目技能
2. `claude`（优先级 80）
3. 优先级 70 组（按注册顺序）：
   - `claude-plugins`
   - `agents`
   - `codex`

去重键为技能名称。具有相同名称的第一个条目胜出。

### 来源开关和过滤

`discoverSkills()` 应用以下控制：

- 来源开关：`enableCodexUser`、`enableClaudeUser`、`enableClaudeProject`、`enablePiUser`、`enablePiProject`
- 基于技能名称的 glob 过滤器：
  - `ignoredSkills`（排除）
  - `includeSkills`（包含白名单；为空表示包含全部）

过滤顺序为：

1. 来源已启用
2. 未被忽略
3. 已包含（如果存在包含列表）

对于 codex/claude/native 以外的提供者（例如 `agents`、`claude-plugins`），启用状态当前回退为：如果**任何**内置来源开关启用则启用。

### 冲突和重复处理

- 能力去重已经按名称保留第一个技能（最高优先级提供者）
- `extensibility/skills.ts` 还会：
  - 通过 `realpath` 对相同文件进行去重（符号链接安全）
  - 当后续技能名称冲突时发出冲突警告
  - 保留便捷的 `discoverSkillsFromDir({ dir, source })` API 作为 `scanSkillsFromDir` 的简单适配器
- 自定义目录技能在提供者技能之后合并，遵循相同的冲突行为

## 运行时使用行为

### 系统提示暴露

系统提示构建（`src/system-prompt.ts`）按如下方式使用已发现的技能：

- 如果 `read` 工具可用：
  - 在提示中包含已发现的技能列表
- 否则：
  - 省略已发现的列表

任务工具子代理通过正常的会话创建接收会话的已发现/已提供技能列表；没有每任务的技能固定覆盖。

### 交互式 `/skill:<name>` 命令

如果 `skills.enableSkillCommands` 为 true，交互模式会为每个已发现的技能注册一个斜杠命令。

`/skill:<name> [args]` 行为：

- 直接从 `filePath` 读取技能文件
- 去除前置元数据
- 将技能主体作为后续自定义消息注入
- 附加元数据（`Skill: <path>`，可选 `User: <args>`）

## `skill://` URL 行为

`src/internal-urls/skill-protocol.ts` 支持：

- `skill://<name>` → 解析为该技能的 `SKILL.md`
- `skill://<name>/<relative-path>` → 解析为该技能目录内的路径

```text
skill:// URL resolution

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Guards:
- reject absolute paths
- reject `..` traversal
- reject any resolved path escaping <pdf-base>
```

解析详情：

- 技能名称必须精确匹配
- 相对路径经过 URL 解码
- 绝对路径被拒绝
- 路径遍历（`..`）被拒绝
- 解析后的路径必须保持在 `baseDir` 内
- 缺失的文件返回明确的 `File not found` 错误

内容类型：

- `.md` => `text/markdown`
- 其他所有文件 => `text/plain`

不会对缺失的资源执行回退搜索。

## 技能与 AGENTS.md、命令、工具、钩子的对比

### 技能与 AGENTS.md

- **技能**：命名的、可选的能力包，根据任务上下文选择或显式请求
- **AGENTS.md/上下文文件**：持久化的指令文件，作为上下文文件能力加载，并按级别/深度规则合并

`src/discovery/agents-md.ts` 专门从 `cwd` 向上遍历祖先目录来发现独立的 `AGENTS.md` 文件（最多深度 20），排除隐藏目录段。

### 技能与斜杠命令

- **技能**：模型可读的知识/工作流内容
- **斜杠命令**：用户调用的命令入口点
- `/skill:<name>` 是一个便捷包装器，注入技能文本；它不改变技能发现语义

### 技能与自定义工具

- **技能**：通过提示上下文和 `read` 加载的文档/工作流内容
- **自定义工具**：模型可调用的可执行工具 API，具有模式定义和运行时副作用

### 技能与钩子

- **技能**：被动内容
- **钩子**：事件驱动的运行时拦截器，可以在执行期间阻止/修改行为

## 与发现逻辑相关的实用编写指南

- 将每个技能放在自己的目录中：`<skills-root>/<skill-name>/SKILL.md`
- 始终包含明确的 `name` 和 `description` 前置元数据
- 将引用的资源放在同一技能目录下，并通过 `skill://<name>/...` 访问
- 对于嵌套分类（`team/domain/skill`），将 `skills.customDirectories` 指向嵌套的父目录；扫描本身仍然是非递归的
- 避免跨来源的重复技能名称；第一个匹配项按提供者优先级胜出
