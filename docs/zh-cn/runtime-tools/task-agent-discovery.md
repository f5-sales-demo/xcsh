---
title: 任务代理发现与选择
description: 任务代理发现与选择逻辑，用于将工作路由到专门的子代理类型。
sidebar:
  order: 6
  label: 任务代理发现
i18n:
  sourceHash: 8cf42457c672
  translator: machine
---

# 任务代理发现与选择

本文档描述了任务子系统如何发现代理定义、合并多个来源，以及在执行时解析请求的代理。

文档涵盖了当前已实现的运行时行为，包括优先级、无效定义处理，以及可能使代理实际不可用的派生/深度约束。

## 实现文件

- [`src/task/discovery.ts`](../../packages/coding-agent/src/task/discovery.ts)
- [`src/task/agents.ts`](../../packages/coding-agent/src/task/agents.ts)
- [`src/task/types.ts`](../../packages/coding-agent/src/task/types.ts)
- [`src/task/index.ts`](../../packages/coding-agent/src/task/index.ts)
- [`src/task/commands.ts`](../../packages/coding-agent/src/task/commands.ts)
- [`src/prompts/agents/task.md`](../../packages/coding-agent/src/prompts/agents/task.md)
- [`src/prompts/tools/task.md`](../../packages/coding-agent/src/prompts/tools/task.md)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/config.ts`](../../packages/coding-agent/src/config.ts)
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts)

---

## 代理定义结构

任务代理被规范化为 `AgentDefinition`（`src/task/types.ts`）：

- `name`、`description`、`systemPrompt`（有效加载的代理必须包含这些字段）
- 可选字段：`tools`、`spawns`、`model`、`thinkingLevel`、`output`
- `source`：`"bundled" | "user" | "project"`
- 可选 `filePath`

解析来自 frontmatter，通过 `parseAgentFields()`（`src/discovery/helpers.ts`）实现：

- 缺少 `name` 或 `description` => 无效（`null`），调用方视为解析失败
- `tools` 接受 CSV 或数组；如果提供了该字段，`submit_result` 会自动添加
- `spawns` 接受 `*`、CSV 或数组
- 向后兼容行为：如果 `spawns` 缺失但 `tools` 包含 `task`，则 `spawns` 变为 `*`
- `output` 作为不透明的 schema 数据直接传递

## 内置代理

内置代理在构建时嵌入（`src/task/agents.ts`），使用文本导入。

`EMBEDDED_AGENT_DEFS` 定义了：

- `explore`、`plan`、`designer`、`reviewer` 来自提示词文件
- `task` 和 `quick_task` 来自共享的 `task.md` 正文加上注入的 frontmatter

加载路径：

1. `loadBundledAgents()` 使用 `parseAgent(..., "bundled", "fatal")` 解析嵌入的 markdown
2. 结果被缓存在内存中（`bundledAgentsCache`）
3. `clearBundledAgentsCache()` 仅用于测试的缓存重置

由于内置解析使用 `level: "fatal"`，格式错误的内置 frontmatter 会抛出异常，可能导致整个发现过程失败。

## 文件系统和插件发现

`discoverAgents(cwd, home)`（`src/task/discovery.ts`）在附加内置定义之前，从多个位置合并代理。

### 发现输入

1. 来自 `getConfigDirs("agents", { project: false })` 的用户配置代理目录
2. 来自 `findAllNearestProjectConfigDirs("agents", cwd)` 的最近项目代理目录
3. Claude 插件根目录（`listClaudePluginRoots(home)`）及其 `agents/` 子目录
4. 内置代理（`loadBundledAgents()`）

### 实际来源顺序

来源族顺序来自 `getConfigDirs("", { project: false })`，其由 `src/config.ts` 中的 `priorityList` 派生：

1. `.xcsh`
2. `.claude`
3. `.codex`
4. `.gemini`

对于每个来源族，发现顺序为：

1. 该来源的最近项目目录（如果找到）
2. 该来源的用户目录

在所有来源族目录之后，附加插件的 `agents/` 目录（项目范围的插件优先，然后是用户范围的）。

内置代理最后附加。

### 重要注意事项：过时注释与当前代码

`discovery.ts` 头部注释仍然提到 `.pi`，并且没有提到 `.codex`/`.gemini`。实际运行时顺序由 `src/config.ts` 驱动，当前使用 `.xcsh`、`.claude`、`.codex`、`.gemini`。

## 合并和冲突规则

发现使用按精确 `agent.name` 的先到先得去重：

- 一个 `Set<string>` 跟踪已见名称。
- 加载的代理按目录顺序展平，仅当名称未被见过时保留。
- 内置代理针对相同集合进行过滤，仅在名称仍未被见过时添加。

影响：

- 对于同一来源族，项目级覆盖用户级。
- 优先级更高的来源族覆盖更低的（`.xcsh` 优先于 `.claude`，等等）。
- 非内置代理覆盖同名的内置代理。
- 名称匹配区分大小写（`Task` 和 `task` 是不同的）。
- 在同一目录内，markdown 文件在去重前按字典序文件名顺序读取。

## 无效/缺失代理文件的行为

按目录处理（`loadAgentsFromDir`）：

- 不可读/缺失的目录：视为空（`readdir(...).catch(() => [])`）
- 文件读取或解析失败：记录警告，跳过文件
- 解析路径使用 `parseAgent(..., level: "warn")`

Frontmatter 失败行为来自 `parseFrontmatter`：

- `warn` 级别的解析错误会记录警告
- 解析器回退到简单的 `key: value` 逐行解析器
- 如果必需字段仍然缺失，`parseAgentFields` 失败，然后抛出 `AgentParsingError` 并被调用方捕获（跳过文件）

最终效果：一个有问题的自定义代理文件不会中断其他文件的发现。

## 代理查找和选择

查找是精确名称的线性搜索：

- `getAgent(agents, name)` => `agents.find(a => a.name === name)`

在任务执行中（`TaskTool.execute`）：

1. 代理在调用时重新发现（`discoverAgents(this.session.cwd)`）
2. 请求的 `params.agent` 通过 `getAgent` 解析
3. 未找到代理时返回即时工具响应：
   - `Unknown agent "...". Available: ...`
   - 不运行子进程

### 描述与执行时发现

`TaskTool.create()` 在初始化时从发现结果构建工具描述（`buildDescription`）。

`execute()` 会再次重新发现代理。因此如果代理文件在会话中途发生变化，运行时的代理集合可能与之前工具描述中列出的不同。

## 结构化输出护栏与 schema 优先级

`TaskTool.execute` 中运行时输出 schema 优先级：

1. 代理 frontmatter 中的 `output`
2. 任务调用的 `params.schema`
3. 父会话的 `outputSchema`

（`effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema`）

`src/prompts/tools/task.md` 中的提示时护栏文本警告了结构化输出代理（`explore`、`reviewer`）的不匹配行为：散文中的输出格式指令可能与内置 schema 冲突，产生 `null` 输出。

这是指导性建议，而非 `discoverAgents` 中的硬性运行时验证逻辑。

## 命令发现交互

`src/task/commands.ts` 是工作流命令（非代理定义）的并行基础设施，但它遵循相同的整体模式：

- 首先从能力提供者发现
- 按名称先到先得去重
- 如果仍未见过则附加内置命令
- 通过 `getCommand` 进行精确名称查找

在 `src/task/index.ts` 中，命令辅助函数与代理发现辅助函数一起重新导出。代理发现本身在运行时不依赖命令发现。

## 超越发现的可用性约束

代理可能是可发现的，但由于执行护栏仍然无法运行。

### 父级派生策略

`TaskTool.execute` 检查 `session.getSessionSpawns()`：

- `"*"` => 允许任何
- `""` => 拒绝所有
- CSV 列表 => 仅允许列出的名称

如果被拒绝：立即返回 `Cannot spawn '...'. Allowed: ...` 响应。

### 阻止自递归的环境变量守卫

`PI_BLOCKED_AGENT` 在工具构造时读取。如果请求匹配，执行将被拒绝并返回递归防止消息。

### 递归深度控制（子会话内的任务工具可用性）

在 `runSubprocess`（`src/task/executor.ts`）中：

- 深度从 `taskDepth` 计算
- `task.maxRecursionDepth` 控制截止深度
- 当达到最大深度时：
  - `task` 工具从子工具列表中移除
  - 子级的 `spawns` 环境变量设置为空

因此更深层级无法派生更多任务，即使代理定义包含 `spawns`。

## 计划模式注意事项（当前实现）

`TaskTool.execute` 为计划模式计算了一个 `effectiveAgent`（前置计划模式提示词、强制只读工具子集、清除 spawns），但 `runSubprocess` 调用时使用的是 `agent` 而非 `effectiveAgent`。

当前效果：

- 模型覆盖 / 思考级别 / 输出 schema 来自 `effectiveAgent`
- 来自 `effectiveAgent` 的系统提示词和工具/派生限制在此调用路径中未被传递

这是阅读计划模式行为预期时值得了解的实现注意事项。
