---
title: 斜杠命令内部机制
description: 斜杠命令系统内部机制，包括注册、参数解析和执行调度。
sidebar:
  order: 5
  label: 斜杠命令
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# 斜杠命令内部机制

本文档描述了 `coding-agent` 中斜杠命令的发现、去重、在交互模式中的展示以及在提示词处理时的展开机制。

## 实现文件

- [`src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)
- [`src/capability/slash-command.ts`](../../packages/coding-agent/src/capability/slash-command.ts)
- [`src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`src/discovery/claude.ts`](../../packages/coding-agent/src/discovery/claude.ts)
- [`src/discovery/codex.ts`](../../packages/coding-agent/src/discovery/codex.ts)
- [`src/discovery/claude-plugins.ts`](../../packages/coding-agent/src/discovery/claude-plugins.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)

## 1) 发现模型

斜杠命令是一种能力（`id: "slash-commands"`），以命令名称作为键（`key: cmd => cmd.name`）。

能力注册表会加载所有已注册的提供者，按提供者优先级降序排列，并以**先到先得**的语义进行键去重。

### 提供者优先级

当前斜杠命令提供者及其优先级：

1. `native`（OMP）— 优先级 `100`
2. `claude` — 优先级 `80`
3. `claude-plugins` — 优先级 `70`
4. `codex` — 优先级 `70`

平级行为：优先级相同的提供者保持注册顺序。当前的导入顺序是 `claude-plugins` 在 `codex` 之前注册，因此在名称冲突时插件命令优先于 codex 命令。

### 名称冲突行为

对于 `slash-commands`，冲突严格通过能力去重来解决：

- 最高优先级的项保留在 `result.items` 中
- 较低优先级的重复项仅保留在 `result.all` 中，并被标记为 `_shadowed = true`

这适用于跨提供者的情况，也适用于同一提供者返回重复名称的情况。

### 文件扫描行为

提供者主要使用 `loadFilesFromDir(...)`，目前：

- 默认使用非递归匹配（`*.md`）
- 使用原生 glob，配置 `gitignore: true`、`hidden: false`
- 读取每个匹配的文件并将其转换为 `SlashCommand`

因此不会加载隐藏文件/目录，被忽略的路径也会被跳过。

## 2) 各提供者的源路径及本地优先级

## `native` 提供者（`builtin.ts`）

搜索根目录来自 `.xcsh` 目录：

- 项目级：`<cwd>/.xcsh/commands/*.md`
- 用户级：`~/.xcsh/agent/commands/*.md`

`getConfigDirs()` 先返回项目目录，再返回用户目录，因此在名称冲突时**项目级原生命令优先于用户级原生命令**。

## `claude` 提供者（`claude.ts`）

加载路径：

- 用户级：`~/.claude/commands/*.md`
- 项目级：`<cwd>/.claude/commands/*.md`

该提供者先推入用户级项，再推入项目级项，因此在该提供者内同名冲突时**用户级 Claude 命令优先于项目级 Claude 命令**。

## `codex` 提供者（`codex.ts`）

加载路径：

- 用户级：`~/.codex/commands/*.md`
- 项目级：`<cwd>/.codex/commands/*.md`

两侧加载后以用户优先的顺序展平，因此在冲突时**用户级 Codex 命令优先于项目级 Codex 命令**。

Codex 命令内容通过前言剥离（`parseFrontmatter`）进行解析，命令名称可由前言中的 `name` 覆盖；否则使用文件名。

## `claude-plugins` 提供者（`claude-plugins.ts`）

从 `~/.claude/plugins/installed_plugins.json` 加载插件命令根目录，然后扫描 `<pluginRoot>/commands/*.md`。

排序遵循注册表迭代顺序和该 JSON 数据中每个插件的条目顺序。没有额外的排序步骤。

## 3) 运行时 `FileSlashCommand` 的具体化

`src/extensibility/slash-commands.ts` 中的 `loadSlashCommands()` 将能力项转换为提示词处理时使用的 `FileSlashCommand` 对象。

对于每个命令：

1. 解析前言/正文（`parseFrontmatter`）
2. 描述来源：
   - 如果存在 `frontmatter.description` 则使用
   - 否则使用第一个非空正文行（修剪后，最多 60 个字符并加 `...`）
3. 保留解析后的正文作为可执行模板内容
4. 计算显示来源字符串，如 `via Claude Code Project`

前言解析的严重级别取决于来源：

- `native` 级别 -> 解析错误为 `fatal`
- `user`/`project` 级别 -> 解析错误为 `warn`，并使用回退解析

### 内置回退命令

在文件系统/提供者命令之后，如果名称尚未存在，则追加嵌入式命令模板（`EMBEDDED_COMMAND_TEMPLATES`）。

当前嵌入集来自 `src/task/commands.ts`，用作回退（`source: "bundled"`）。

## 4) 交互模式：命令列表的来源

交互模式组合多个命令源，用于自动补全和命令路由。

构造时，它从以下来源构建待处理命令列表：

- 内置命令（`BUILTIN_SLASH_COMMANDS`，包含对选定命令的参数补全和内联提示）
- 扩展注册的斜杠命令（`extensionRunner.getRegisteredCommands(...)`）
- TypeScript 自定义命令（`session.customCommands`），映射为斜杠命令标签
- 可选的技能命令（`/skill:<name>`），当 `skills.enableSkillCommands` 启用时

然后 `init()` 调用 `refreshSlashCommandState(...)` 来加载基于文件的命令，并安装一个包含以下内容的 `CombinedAutocompleteProvider`：

- 上述待处理命令
- 已发现的基于文件的命令

`refreshSlashCommandState(...)` 还会更新 `session.setSlashCommands(...)`，以便提示词展开使用相同的已发现文件命令集。

### 刷新生命周期

斜杠命令状态在以下时机刷新：

- 交互模式初始化期间
- `/move` 更改工作目录后（`handleMoveCommand` 调用 `resetCapabilities()` 然后 `refreshSlashCommandState(newCwd)`）

命令目录没有持续的文件监视器。

### 其他展示

扩展仪表板也会加载 `slash-commands` 能力并显示活动/被遮蔽的命令条目，包括标记为 `_shadowed` 的重复项。

## 5) 提示词管道位置

`AgentSession.prompt(...)` 斜杠处理顺序（当 `expandPromptTemplates !== false` 时）：

1. **扩展命令**（`#tryExecuteExtensionCommand`）  
   如果 `/name` 匹配扩展注册的命令，处理器立即执行，prompt 返回。
2. **TypeScript 自定义命令**（`#tryExecuteCustomCommand`）  
   仅限边界：如果匹配，则执行并可能返回：
   - `string` -> 用该字符串替换提示词文本
   - `void/undefined` -> 视为已处理；不发送 LLM 提示词
3. **基于文件的斜杠命令**（`expandSlashCommand`）  
   如果文本仍以 `/` 开头，尝试 markdown 命令展开。
4. **提示词模板**（`expandPromptTemplate`）  
   在斜杠/自定义处理之后应用。
5. **发送**
   - 空闲时：提示词立即发送给代理
   - 流式传输时：提示词根据 `streamingBehavior` 作为转向/后续消息排队

这就是为什么斜杠命令展开在提示词模板展开之前执行，以及为什么自定义命令可以在文件命令匹配之前移除前导斜杠。

## 6) 基于文件的斜杠命令的展开语义

`expandSlashCommand(text, fileCommands)` 的行为：

- 仅在文本以 `/` 开头时运行
- 从 `/` 后的第一个令牌解析命令名称
- 通过 `parseCommandArgs` 从剩余文本解析参数
- 在已加载的 `fileCommands` 中查找精确名称匹配
- 如果匹配，则应用：
  - 位置替换：`$1`、`$2`、...
  - 聚合替换：`$ARGUMENTS` 和 `$@`
  - 然后通过 `prompt.render` 使用 `{ args, ARGUMENTS, arguments }` 进行模板渲染
- 如果未匹配，返回原始文本不变

### `parseCommandArgs` 注意事项

解析器是简单的引号感知分割：

- 支持 `'单引号'` 和 `"双引号"` 引用以保留空格
- 去除引号分隔符
- 不实现反斜杠转义规则
- 未匹配的引号不会报错；解析器会消费到末尾

## 7) 未知 `/...` 行为

未知的斜杠输入**不会被**核心斜杠逻辑拒绝。

如果命令未被扩展/自定义/文件层处理，`expandSlashCommand` 返回原始文本，字面量 `/...` 提示词继续通过正常的提示词模板展开和 LLM 发送流程。

交互模式在 `InputController` 中单独硬处理许多内置命令（例如 `/settings`、`/model`、`/mcp`、`/move`、`/exit`）。这些在 `session.prompt(...)` 之前被消费，因此在该路径中永远不会到达文件命令展开。

## 8) 流式传输时与空闲时的差异

## 空闲路径

- `session.prompt("/x ...")` 运行命令管道，要么立即执行命令，要么直接发送展开后的文本。

## 流式传输路径（`session.isStreaming === true`）

- `prompt(...)` 仍然先运行扩展/自定义/文件/模板转换
- 然后需要 `streamingBehavior`：
  - `"steer"` -> 排队中断消息（`agent.steer`）
  - `"followUp"` -> 排队轮次后消息（`agent.followUp`）
- 如果省略 `streamingBehavior`，prompt 会抛出错误

### 重要的命令特定流式传输行为

- 扩展命令即使在流式传输期间也会立即执行（不作为文本排队）。
- `steer(...)`/`followUp(...)` 辅助方法会拒绝扩展命令（`#throwIfExtensionCommand`），以避免将命令文本排入需要同步运行的处理器队列。
- 压缩队列重放使用 `isKnownSlashCommand(...)` 来决定排队条目应通过 `session.prompt(...)`（对于已知斜杠命令）还是原始的 steer/follow-up 方法来重放。

## 9) 错误处理和故障面

- 提供者加载失败是隔离的；注册表收集警告并继续处理其他提供者。
- 无效的斜杠命令项（缺少名称/路径/内容或无效级别）会被能力验证丢弃。
- 前言解析失败：
  - 原生命令：致命解析错误向上冒泡
  - 非原生命令：警告 + 回退键值解析
- 扩展/自定义命令处理器异常会被捕获并通过扩展错误通道报告（或对于没有扩展运行器的自定义命令使用日志记录器回退），并视为已处理（不会发生意外的回退执行）。
