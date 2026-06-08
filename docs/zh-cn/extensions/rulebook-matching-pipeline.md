---
title: 规则手册匹配流水线
description: 用于选择和应用上下文特定指令集到代理会话的规则手册匹配流水线。
sidebar:
  order: 6
  label: 规则手册匹配
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# 规则手册匹配流水线

本文档描述了 coding-agent 如何从支持的配置格式中发现规则、将其规范化为统一的 `Rule` 结构、解决优先级冲突，并将结果拆分为：

- **规则手册规则**（通过系统提示词 + `rule://` URL 提供给模型）
- **TTSR 规则**（时间回溯流中断规则）

本文档反映了当前的实现，包括部分语义和已解析但未强制执行的元数据。

## 实现文件

- [`../src/capability/rule.ts`](../../packages/coding-agent/src/capability/rule.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/discovery/index.ts`](../../packages/coding-agent/src/discovery/index.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/cursor.ts`](../../packages/coding-agent/src/discovery/cursor.ts)
- [`../src/discovery/windsurf.ts`](../../packages/coding-agent/src/discovery/windsurf.ts)
- [`../src/discovery/cline.ts`](../../packages/coding-agent/src/discovery/cline.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/system-prompt.ts`](../../packages/coding-agent/src/system-prompt.ts)
- [`../src/internal-urls/rule-protocol.ts`](../../packages/coding-agent/src/internal-urls/rule-protocol.ts)
- [`../src/utils/frontmatter.ts`](../../packages/coding-agent/src/utils/frontmatter.ts)

## 1. 规范的规则结构

所有提供者将源文件规范化为 `Rule`：

```ts
interface Rule {
  name: string;
  path: string;
  content: string;
  globs?: string[];
  alwaysApply?: boolean;
  description?: string;
  ttsrTrigger?: string;
  _source: SourceMeta;
}
```

能力标识为 `rule.name`（`ruleCapability.key = rule => rule.name`）。

结论：优先级和去重**仅基于名称**。两个不同的文件如果具有相同的 `name`，则被视为同一逻辑规则。

## 2. 发现源和规范化

`src/discovery/index.ts` 自动注册提供者。对于 `rules`，当前的提供者有：

- `native`（优先级 `100`）
- `cursor`（优先级 `50`）
- `windsurf`（优先级 `50`）
- `cline`（优先级 `40`）

### Native 提供者（`builtin.ts`）

从以下位置加载 `.xcsh` 规则：

- 项目级：`<cwd>/.xcsh/rules/*.{md,mdc}`
- 用户级：`~/.xcsh/agent/rules/*.{md,mdc}`

规范化：

- `name` = 去除 `.md`/`.mdc` 扩展名的文件名
- 通过 `parseFrontmatter` 解析 frontmatter
- `content` = 正文（已去除 frontmatter）
- `globs`、`alwaysApply`、`description`、`ttsr_trigger` 直接映射

重要注意事项：`globs` 在此提供者中被转换为 `string[] | undefined`，未进行元素过滤。

### Cursor 提供者（`cursor.ts`）

从以下位置加载：

- 用户级：`~/.cursor/rules/*.{mdc,md}`
- 项目级：`<cwd>/.cursor/rules/*.{mdc,md}`

规范化（`transformMDCRule`）：

- `description`：仅在为字符串时保留
- `alwaysApply`：仅保留 `true`（`false` 变为 `undefined`）
- `globs`：接受数组（仅字符串元素）或单个字符串
- `ttsr_trigger`：仅字符串
- `name` 来自去除扩展名的文件名

### Windsurf 提供者（`windsurf.ts`）

从以下位置加载：

- 用户级：`~/.codeium/windsurf/memories/global_rules.md`（固定规则名 `global_rules`）
- 项目级：`<cwd>/.windsurf/rules/*.md`

规范化：

- `globs`：字符串数组或单个字符串
- `alwaysApply`、`description` 从 frontmatter 转换
- `ttsr_trigger`：仅字符串
- 项目规则的 `name` 来自文件名

### Cline 提供者（`cline.ts`）

从 `cwd` 向上搜索最近的 `.clinerules`：

- 如果是目录：加载其中的 `*.md` 文件
- 如果是文件：作为名为 `clinerules` 的单个规则加载

规范化：

- `globs`：字符串数组或单个字符串
- `alwaysApply`：仅在为布尔值时保留
- `description`：仅字符串
- `ttsr_trigger`：仅字符串

## 3. Frontmatter 解析行为和歧义

所有提供者使用 `parseFrontmatter`（`utils/frontmatter.ts`），具有以下语义：

1. 仅当内容以 `---` 开头并有结束的 `\n---` 时才解析 frontmatter。
2. 提取 frontmatter 后对正文进行修剪。
3. 如果 YAML 解析失败：
   - 记录警告，
   - 解析器回退到简单的 `key: value` 逐行解析（`^(\w+):\s*(.*)$`）。

歧义后果：

- 回退解析器不支持数组、嵌套对象、引号规则或连字符键名。
- 回退值变为字符串（例如 `alwaysApply: true` 变为字符串 `"true"`），因此要求布尔/字符串类型的提供者可能会丢弃元数据。
- `ttsr_trigger` 在回退模式下可用（下划线键名）；像 `thinking-level` 这样的键则不可用。
- 没有有效 frontmatter 的文件仍会作为具有空元数据和完整内容正文的规则加载。

## 4. 提供者优先级和去重

`loadCapability("rules")`（`capability/index.ts`）合并提供者输出，然后按 `rule.name` 去重。

### 优先级模型

- 提供者按优先级降序排列。
- 相同优先级保持注册顺序（`cursor` 在 `windsurf` 之前，来自 `discovery/index.ts`）。
- 去重采用先到先得：首次遇到的规则名被保留；后续同名项在 `all` 中标记为 `_shadowed`，并从 `items` 中排除。

当前有效的规则提供者顺序为：

1. `native`（100）
2. `cursor`（50）
3. `windsurf`（50）
4. `cline`（40）

### 提供者内部排序注意事项

在提供者内部，项目顺序来自 `loadFilesFromDir` 的 glob 结果排序加上显式的 push 顺序。这对于正常使用足够确定性，但代码中没有显式排序。

值得注意的源顺序差异：

- `native` 先追加项目目录，后追加用户配置目录。
- `cursor` 先追加用户目录结果，后追加项目结果。
- `windsurf` 先追加用户级 `global_rules`，后追加项目规则。
- `cline` 仅加载最近的 `.clinerules` 源。

## 5. 拆分为规则手册、始终应用和 TTSR 分类

在 `createAgentSession`（`sdk.ts`）中完成规则发现后：

1. 扫描所有已发现的规则。
2. 具有 `condition`（frontmatter 键；`ttsr_trigger` / `ttsrTrigger` 作为回退接受）的规则被注册到 `TtsrManager`。
3. 使用以下谓词构建单独的 `rulebookRules` 列表：

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. 构建 `alwaysApplyRules` 列表：

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### 分类行为

- **TTSR 分类**：任何具有 `condition` 的规则（不要求 description）。优先于其他分类。
- **始终应用分类**：`alwaysApply === true`，非 TTSR。完整内容注入系统提示词。可通过 `rule://` 解析。
- **规则手册分类**：必须有 description，不能是 TTSR，不能是 `alwaysApply`。在系统提示词中按名称+描述列出；内容通过 `rule://` 按需读取。
- 同时具有 `condition` 和 `alwaysApply` 的规则仅归入 TTSR（TTSR 优先）。
- 同时具有 `alwaysApply` 和 `description` 的规则仅归入始终应用分类（不归入规则手册）。

## 6. 元数据如何影响运行时表现

### `description`

- 归入规则手册的必要条件。
- 在系统提示词 `<rules>` 块中渲染。
- 缺少 description 意味着规则不可通过 `rule://` 访问，也不会在系统提示词规则中列出。

### `globs`

- 在 `Rule` 上透传。
- 在系统提示词规则块中渲染为 `<glob>...</glob>` 条目。
- 在规则 UI 状态中暴露（`extensions` 模式列表）。
- **在此流水线中不强制执行自动匹配。** 没有运行时 glob 匹配器根据当前文件/工具目标选择规则。

### `alwaysApply`

- 由提供者解析和保留。
- 用于 UI 显示（扩展状态管理器中的 `"always"` 触发标签）。
- 用作从 `rulebookRules` 中排除的条件。
- **完整规则内容自动注入系统提示词**（在规则手册规则部分之前）。
- 规则也可通过 `rule://<name>` 进行重新读取。

### `ttsr_trigger`

- 映射到 `rule.ttsrTrigger`。
- 如果存在，规则被路由到 TTSR 管理器，而非规则手册。

## 7. 系统提示词包含路径

`buildSystemPromptInternal` 接收 `rules`（规则手册）和 `alwaysApplyRules`。

始终应用规则首先渲染，将其原始内容直接注入提示词。

规则手册规则在 `# Rules` 部分中渲染，包含：

- `Read rule://<name> when working in matching domain`
- 每个规则的 `name`、`description` 和可选的 `<glob>` 列表

这是建议性/上下文性的：提示词文本要求模型读取适用的规则，但代码不强制执行 glob 适用性。

## 8. `rule://` 内部 URL 行为

`RuleProtocolHandler` 注册方式如下：

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

影响：

- `rule://<name>` 同时解析 **rulebookRules** 和 **alwaysApplyRules**。
- 仅 TTSR 的规则和没有 description 且没有 `alwaysApply` 的规则不可通过 `rule://` 访问。
- 解析为精确名称匹配。
- 未知名称返回错误，列出可用的规则名称。
- 返回的内容为原始 `rule.content`（已去除 frontmatter），内容类型为 `text/markdown`。

## 9. 已知的部分/未强制执行的语义

1. 提供者描述中提到了旧版文件（`.cursorrules`、`.windsurfrules`），但当前加载器代码路径实际上不会读取这些文件。
2. `globs` 元数据在提示词/UI 中展示，但规则选择逻辑不强制执行。
3. `rule://` 的规则选择包含规则手册和始终应用规则，但不包含仅 TTSR 的规则。
4. 发现警告（`loadCapability("rules").warnings`）会生成，但 `createAgentSession` 目前在此路径中不会展示/记录它们。
