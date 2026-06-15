---
title: 压缩与分支摘要
description: 长会话的上下文窗口压缩与分支摘要生成。
sidebar:
  order: 5
  label: 压缩
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# 压缩与分支摘要

压缩与分支摘要是两种机制，用于在长会话中保持可用性，同时不丢失之前的工作上下文。

- **压缩**：将旧历史记录改写为当前分支上的摘要。
- **分支摘要**：在 `/tree` 导航期间捕获被放弃的分支上下文。

两者均作为会话条目持久化，并在重建 LLM 输入时转换回用户上下文消息。

## 关键实现文件

- `src/session/compaction/compaction.ts`
- `src/session/compaction/branch-summarization.ts`
- `src/session/compaction/pruning.ts`
- `src/session/compaction/utils.ts`
- `src/session/session-manager.ts`
- `src/session/agent-session.ts`
- `src/session/messages.ts`
- `src/extensibility/hooks/types.ts`
- `src/config/settings-schema.ts`

## 会话条目模型

压缩和分支摘要是一等会话条目，而非普通的助手/用户消息。

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`，可选 `shortSummary`
  - `firstKeptEntryId`（压缩边界）
  - `tokensBefore`
  - 可选 `details`、`preserveData`、`fromExtension`
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`、`summary`
  - 可选 `details`、`fromExtension`

当上下文被重建（`buildSessionContext`）时：

1. 活动路径上最新的压缩条目被转换为一条 `compactionSummary` 消息。
2. 从 `firstKeptEntryId` 到压缩点的保留条目被重新包含。
3. 路径上之后的条目被追加。
4. `branch_summary` 条目被转换为 `branchSummary` 消息。
5. `custom_message` 条目被转换为 `custom` 消息。

这些自定义角色随后在 `convertToLlm()` 中使用静态模板转换为面向 LLM 的用户消息：

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## 压缩流程

### 触发方式

压缩可通过三种方式运行：

1. **手动**：`/compact [instructions]` 调用 `AgentSession.compact(...)`。
2. **自动溢出恢复**：助手错误匹配到上下文溢出后触发。
3. **自动阈值压缩**：成功完成一轮对话后，当上下文超过阈值时触发。

### 压缩结构（可视化）

```text
压缩前：

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

压缩后（追加新条目）：

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 不发送给 LLM                          发送给 LLM
                                                         ↑
                                              从 firstKeptEntryId 开始

LLM 所见内容：

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    提示词   来自 cmp         从 firstKeptEntryId 开始的消息
```

### 溢出重试 vs 阈值压缩

两种自动路径在设计上有所不同：

- **溢出重试压缩**
  - 触发条件：当前模型的助手错误被检测为上下文溢出。
  - 失败的助手错误消息在重试前从活动代理状态中移除。
  - 自动压缩以 `reason: "overflow"` 和 `willRetry: true` 运行。
  - 成功后，代理在压缩后自动继续（`agent.continue()`）。

- **阈值压缩**
  - 触发条件：`contextTokens > contextWindow - compaction.reserveTokens`。
  - 以 `reason: "threshold"` 和 `willRetry: false` 运行。
  - 成功后，若 `compaction.autoContinue !== false`，则注入一条合成提示：
    - `"Continue if you have next steps."`

### 压缩前剪枝

在压缩检查之前，可能会运行工具结果剪枝（`pruneToolOutputs`）。

默认剪枝策略：

- 保护最新的 `40_000` 个工具输出 token。
- 要求至少节省 `20_000` 个 token 的估算总量。
- 永不剪枝来自 `skill` 或 `read` 的工具结果。

被剪枝的工具结果替换为：

- `[Output truncated - N tokens]`

若剪枝更改了条目，则在压缩决策之前重写会话存储并刷新代理消息状态。

### 边界与截断点逻辑

`prepareCompaction()` 仅考虑自上次压缩条目（若存在）以来的条目。

1. 查找上一个压缩索引。
2. 计算 `boundaryStart = prevCompactionIndex + 1`。
3. 在可用时，使用实测使用率比例调整 `keepRecentTokens`。
4. 在边界窗口上运行 `findCutPoint()`。

有效截断点包括：

- 角色为以下之一的消息条目：`user`、`assistant`、`bashExecution`、`hookMessage`、`branchSummary`、`compactionSummary`
- `custom_message` 条目
- `branch_summary` 条目

硬性规则：永不在 `toolResult` 处截断。

若截断点前紧接着有非消息元数据条目（`model_change`、`thinking_level_change`、标签等），则将截断索引向后移动，直至命中消息或压缩边界，以将这些条目纳入保留区域。

### 分割轮次处理

若截断点不在用户轮次起始处，压缩将其视为分割轮次。

轮次起始检测将以下情况视为用户轮次边界：

- `message.role === "user"`
- `message.role === "bashExecution"`
- `custom_message` 条目
- `branch_summary` 条目

分割轮次压缩生成两个摘要：

1. 历史摘要（`messagesToSummarize`）
2. 轮次前缀摘要（`turnPrefixMessages`）

最终存储的摘要合并为：

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### 摘要生成

`compact(...)` 从序列化的对话文本构建摘要：

1. 通过 `convertToLlm()` 转换消息。
2. 使用 `serializeConversation()` 序列化。
3. 包装在 `<conversation>...</conversation>` 中。
4. 可选地包含 `<previous-summary>...</previous-summary>`。
5. 可选地将钩子上下文作为 `<additional-context>` 列表注入。
6. 使用 `SUMMARIZATION_SYSTEM_PROMPT` 执行摘要提示。

提示选择：

- 首次压缩：`compaction-summary.md`
- 带先前摘要的迭代压缩：`compaction-update-summary.md`
- 分割轮次第二阶段：`compaction-turn-prefix.md`
- 短 UI 摘要：`compaction-short-summary.md`

远程摘要模式：

- 若设置了 `compaction.remoteEndpoint`，压缩将 POST 以下内容：
  - `{ systemPrompt, prompt }`
- 期望返回至少包含 `{ summary }` 的 JSON。

### 摘要中的文件操作上下文

压缩使用助手工具调用跟踪累积文件活动：

- `read(path)` → 读取集合
- `write(path)` → 修改集合
- `edit(path)` → 修改集合

累积行为：

- 仅当先前条目是 pi 生成的（`fromExtension !== true`）时，才包含先前压缩的详细信息。
- 在分割轮次中，也包含轮次前缀的文件操作。
- `readFiles` 不包含同时被修改的文件。

摘要文本通过提示模板追加文件标签：

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### 持久化与重载

生成摘要（或由钩子提供摘要）后，代理会话：

1. 使用 `appendCompaction(...)` 追加 `CompactionEntry`。
2. 通过 `buildSessionContext()` 重建上下文。
3. 将活动代理消息替换为重建后的上下文。
4. 发出 `session_compact` 钩子事件。

## 分支摘要流程

分支摘要与树导航相关，而非与 token 溢出相关。

### 触发方式

在 `navigateTree(...)` 期间：

1. 使用 `collectEntriesForBranchSummary(...)` 从旧叶节点到公共祖先计算被放弃的条目。
2. 若调用方请求摘要（`options.summarize`），在切换叶节点前生成摘要。
3. 若摘要存在，使用 `branchWithSummary(...)` 将其附加到导航目标。

通常在启用 `branchSummary.enabled` 时，由 `/tree` 流程驱动。

### 分支切换结构（可视化）

```text
导航前的树结构：

         ┌─ B ─ C ─ D （旧叶节点，即将被放弃）
    A ───┤
         └─ E ─ F （目标）

公共祖先：A
待摘要的条目：B、C、D

带摘要的导航后：

         ┌─ B ─ C ─ D ─ [B、C、D 的摘要]
    A ───┤
         └─ E ─ F （新叶节点）
```

### 准备与 token 预算

`generateBranchSummary(...)` 将预算计算为：

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` 随后：

1. 第一遍：从所有待摘要条目（包括先前 pi 生成的 `branch_summary` 详细信息）收集累积文件操作。
2. 第二遍：从最新到最旧遍历，添加消息直至达到 token 预算。
3. 优先保留最近的上下文。
4. 为保持连续性，仍可能在预算边缘附近包含较大的摘要条目。

在分支摘要输入期间，压缩条目作为消息（`compactionSummary`）被包含。

### 摘要生成与持久化

分支摘要：

1. 转换并序列化选定消息。
2. 包装在 `<conversation>` 中。
3. 若提供了自定义指令则使用，否则使用 `branch-summary.md`。
4. 使用 `SUMMARIZATION_SYSTEM_PROMPT` 调用摘要模型。
5. 在前面追加 `branch-summary-preamble.md`。
6. 追加文件操作标签。

结果以 `BranchSummaryEntry` 的形式存储，含可选详细信息（`readFiles`、`modifiedFiles`）。

## 扩展与钩子接入点

### `session_before_compact`

压缩前钩子。

可以：

- 取消压缩（`{ cancel: true }`）
- 提供完整的自定义压缩负载（`{ compaction: CompactionResult }`）

### `session.compacting`

默认压缩的提示/上下文自定义钩子。

可以返回：

- `prompt`（覆盖基础摘要提示）
- `context`（注入 `<additional-context>` 的额外上下文行）
- `preserveData`（存储在压缩条目上）

### `session_compact`

压缩后通知，携带已保存的 `compactionEntry` 和 `fromExtension` 标志。

### `session_before_tree`

在默认分支摘要生成之前的树导航时运行。

可以：

- 取消导航
- 在用户请求摘要时提供自定义 `{ summary: { summary, details } }`

### `session_tree`

导航后事件，暴露新旧叶节点以及可选的摘要条目。

## 运行时行为与失败语义

- 手动压缩首先中止当前代理操作。
- `abortCompaction()` 同时取消手动和自动压缩控制器。
- 自动压缩为 UI/状态更新发出开始/结束会话事件。
- 自动压缩可尝试多个模型候选项并重试瞬时失败。
- 溢出错误被排除在通用重试路径之外，因为它们由压缩处理。
- 若自动压缩失败：
  - 溢出路径发出 `Context overflow recovery failed: ...`
  - 阈值路径发出 `Auto-compaction failed: ...`
- 分支摘要可通过中止信号取消（例如按 Escape），返回已取消/已中止的导航结果。

## 设置与默认值

来自 `settings-schema.ts`：

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

这些值在运行时由 `AgentSession` 以及压缩/分支摘要模块消费。
