---
title: 压缩与分支摘要
description: 针对长生命周期会话的上下文窗口压缩和分支摘要生成。
sidebar:
  order: 5
  label: 压缩
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# 压缩与分支摘要

压缩和分支摘要是保持长会话可用性同时不丢失先前工作上下文的两种机制。

- **压缩**将当前分支上的旧历史记录重写为摘要。
- **分支摘要**在 `/tree` 导航期间捕获被放弃的分支上下文。

两者都以会话条目的形式持久化，并在重建 LLM 输入时转换回用户上下文消息。

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

压缩和分支摘要是一等会话条目，而非普通的 assistant/user 消息。

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

当上下文被重建时（`buildSessionContext`）：

1. 活动路径上最新的压缩条目被转换为一条 `compactionSummary` 消息。
2. 从 `firstKeptEntryId` 到压缩点之间保留的条目被重新包含。
3. 路径上后续的条目被追加。
4. `branch_summary` 条目被转换为 `branchSummary` 消息。
5. `custom_message` 条目被转换为 `custom` 消息。

这些自定义角色随后在 `convertToLlm()` 中使用静态模板转换为面向 LLM 的用户消息：

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## 压缩流水线

### 触发条件

压缩可以通过三种方式运行：

1. **手动**：`/compact [instructions]` 调用 `AgentSession.compact(...)`。
2. **自动溢出恢复**：在检测到上下文溢出的助手错误之后。
3. **自动阈值压缩**：在成功的轮次之后，当上下文超过阈值时。

### 压缩结构（可视化）

```text
Before compaction:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

After compaction (new entry appended):

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 not sent to LLM                    sent to LLM
                                                         ↑
                                              starts from firstKeptEntryId

What the LLM sees:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          messages from firstKeptEntryId
```

### 溢出重试压缩 vs 阈值压缩

两种自动路径是有意区分的：

- **溢出重试压缩**
  - 触发条件：当前模型的助手错误被检测为上下文溢出。
  - 失败的助手错误消息在重试前从活动代理状态中移除。
  - 自动压缩以 `reason: "overflow"` 和 `willRetry: true` 运行。
  - 成功后，代理自动继续（`agent.continue()`）压缩之后的操作。

- **阈值压缩**
  - 触发条件：`contextTokens > contextWindow - compaction.reserveTokens`。
  - 以 `reason: "threshold"` 和 `willRetry: false` 运行。
  - 成功后，如果 `compaction.autoContinue !== false`，注入一个合成提示：
    - `"Continue if you have next steps."`

### 压缩前裁剪

在压缩检查之前，可能会运行工具结果裁剪（`pruneToolOutputs`）。

默认裁剪策略：

- 保护最新的 `40_000` 个工具输出 token。
- 要求至少 `20_000` 个总估计节省量。
- 永不裁剪来自 `skill` 或 `read` 的工具结果。

被裁剪的工具结果会被替换为：

- `[Output truncated - N tokens]`

如果裁剪更改了条目，会话存储将被重写，代理消息状态在压缩决策之前会被刷新。

### 边界和切割点逻辑

`prepareCompaction()` 仅考虑自上次压缩条目（如果有的话）以来的条目。

1. 查找前一个压缩索引。
2. 计算 `boundaryStart = prevCompactionIndex + 1`。
3. 在可用时使用测量的使用率比来调整 `keepRecentTokens`。
4. 在边界窗口上运行 `findCutPoint()`。

有效的切割点包括：

- 角色为以下值的消息条目：`user`、`assistant`、`bashExecution`、`hookMessage`、`branchSummary`、`compactionSummary`
- `custom_message` 条目
- `branch_summary` 条目

硬性规则：永不在 `toolResult` 处切割。

如果切割点紧前方有非消息元数据条目（`model_change`、`thinking_level_change`、标签等），则通过向后移动切割索引直到遇到消息或压缩边界，将它们拉入保留区域。

### 拆分轮次处理

如果切割点不在用户轮次开始处，压缩将其视为拆分轮次。

轮次开始检测将以下情况视为用户轮次边界：

- `message.role === "user"`
- `message.role === "bashExecution"`
- `custom_message` 条目
- `branch_summary` 条目

拆分轮次压缩生成两个摘要：

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
- 带有先前摘要的迭代压缩：`compaction-update-summary.md`
- 拆分轮次第二遍：`compaction-turn-prefix.md`
- 短 UI 摘要：`compaction-short-summary.md`

远程摘要模式：

- 如果设置了 `compaction.remoteEndpoint`，压缩会 POST：
  - `{ systemPrompt, prompt }`
- 期望返回至少包含 `{ summary }` 的 JSON。

### 摘要中的文件操作上下文

压缩使用助手工具调用跟踪累积的文件活动：

- `read(path)` → 读取集合
- `write(path)` → 修改集合
- `edit(path)` → 修改集合

累积行为：

- 仅当先前条目是 pi 生成的（`fromExtension !== true`）时才包含先前压缩详情。
- 在拆分轮次中，也包含轮次前缀的文件操作。
- `readFiles` 排除同时被修改的文件。

摘要文本通过提示模板附加文件标签：

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### 持久化和重新加载

在摘要生成（或钩子提供的摘要）之后，代理会话：

1. 使用 `appendCompaction(...)` 追加 `CompactionEntry`。
2. 通过 `buildSessionContext()` 重建上下文。
3. 使用重建的上下文替换活动代理消息。
4. 发出 `session_compact` 钩子事件。

## 分支摘要流水线

分支摘要与树导航相关联，而非与 token 溢出相关。

### 触发条件

在 `navigateTree(...)` 期间：

1. 使用 `collectEntriesForBranchSummary(...)` 计算从旧叶节点到共同祖先的被放弃条目。
2. 如果调用者请求了摘要（`options.summarize`），在切换叶节点之前生成摘要。
3. 如果摘要存在，使用 `branchWithSummary(...)` 将其附加到导航目标。

在操作上，当 `branchSummary.enabled` 启用时，这通常由 `/tree` 流程驱动。

### 分支切换结构（可视化）

```text
Tree before navigation:

         ┌─ B ─ C ─ D (old leaf, being abandoned)
    A ───┤
         └─ E ─ F (target)

Common ancestor: A
Entries to summarize: B, C, D

After navigation with summary:

         ┌─ B ─ C ─ D ─ [summary of B,C,D]
    A ───┤
         └─ E ─ F (new leaf)
```

### 准备和 token 预算

`generateBranchSummary(...)` 计算预算为：

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` 然后：

1. 第一遍：从所有被摘要的条目中收集累积文件操作，包括先前 pi 生成的 `branch_summary` 详情。
2. 第二遍：从最新到最旧遍历，添加消息直到达到 token 预算。
3. 优先保留最近的上下文。
4. 在预算边缘可能仍会包含大的摘要条目以保持连续性。

在分支摘要输入期间，压缩条目作为消息（`compactionSummary`）被包含。

### 摘要生成和持久化

分支摘要：

1. 转换并序列化选定的消息。
2. 包装在 `<conversation>` 中。
3. 如果提供了自定义指令则使用自定义指令，否则使用 `branch-summary.md`。
4. 使用 `SUMMARIZATION_SYSTEM_PROMPT` 调用摘要模型。
5. 前置添加 `branch-summary-preamble.md`。
6. 附加文件操作标签。

结果存储为 `BranchSummaryEntry`，带有可选的详情（`readFiles`、`modifiedFiles`）。

## 扩展和钩子触点

### `session_before_compact`

压缩前钩子。

可以：

- 取消压缩（`{ cancel: true }`）
- 提供完整的自定义压缩有效载荷（`{ compaction: CompactionResult }`）

### `session.compacting`

用于默认压缩的提示/上下文自定义钩子。

可以返回：

- `prompt`（覆盖基础摘要提示）
- `context`（注入到 `<additional-context>` 中的额外上下文行）
- `preserveData`（存储在压缩条目上）

### `session_compact`

压缩后通知，包含已保存的 `compactionEntry` 和 `fromExtension` 标志。

### `session_before_tree`

在默认分支摘要生成之前的树导航时运行。

可以：

- 取消导航
- 提供自定义的 `{ summary: { summary, details } }`，在用户请求摘要时使用

### `session_tree`

导航后事件，暴露新/旧叶节点和可选的摘要条目。

## 运行时行为和失败语义

- 手动压缩会首先中止当前代理操作。
- `abortCompaction()` 取消手动和自动压缩控制器。
- 自动压缩为 UI/状态更新发出开始/结束会话事件。
- 自动压缩可以尝试多个候选模型并重试瞬态失败。
- 溢出错误被排除在通用重试路径之外，因为它们由压缩处理。
- 如果自动压缩失败：
  - 溢出路径发出 `Context overflow recovery failed: ...`
  - 阈值路径发出 `Auto-compaction failed: ...`
- 分支摘要可以通过中止信号（例如 Escape）取消，返回已取消/已中止的导航结果。

## 设置和默认值

来自 `settings-schema.ts`：

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

这些值在运行时由 `AgentSession` 以及压缩/分支摘要模块使用。
