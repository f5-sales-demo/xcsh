---
title: 会话树架构
description: 具有分支、导航和父子对话关系的会话树架构。
sidebar:
  order: 2
  label: 树架构
i18n:
  sourceHash: bd8b78d6c33a
  translator: machine
---

# 会话树架构（当前）

参考：[session.md](./session.md)

本文档描述当前会话树导航的工作方式：内存中的树模型、叶节点移动规则、分支行为，以及扩展/事件集成。

## 该子系统的定义

会话以仅追加的条目日志形式存储，但运行时行为是基于树的：

- 每个非头部条目都有 `id` 和 `parentId`。
- 当前活动位置是 `SessionManager` 中的 `leafId`。
- 追加条目时总是创建当前叶节点的子节点。
- 分支**不会**重写历史；它只在下次追加之前更改叶节点指向的位置。

关键文件：

- `src/session/session-manager.ts` — 树数据模型、遍历、叶节点移动、分支/会话提取
- `src/session/agent-session.ts` — `/tree` 导航流程、摘要生成、钩子/事件发射
- `src/modes/components/tree-selector.ts` — 交互式树 UI 行为和过滤
- `src/modes/controllers/selector-controller.ts` — `/tree` 和 `/branch` 的选择器编排
- `src/modes/controllers/input-controller.ts` — 命令路由（`/tree`、`/branch`、双击 Escape 行为）
- `src/session/messages.ts` — 将 `branch_summary`、`compaction` 和 `custom_message` 条目转换为 LLM 上下文消息

## `SessionManager` 中的树数据模型

运行时索引：

- `#byId: Map<string, SessionEntry>` — 快速查找任意条目
- `#leafId: string | null` — 树中的当前位置
- `#labelsById: Map<string, string>` — 按目标条目 id 解析的标签

树 API：

- `getBranch(fromId?)` 沿父链接向上遍历至根节点，返回根→节点路径
- `getTree()` 返回 `SessionTreeNode[]`（`entry`、`children`、`label`）
  - 父链接转换为子节点数组
  - 缺少父节点的条目被视为根节点
  - 子节点按时间戳从旧到新排序
- `getChildren(parentId)` 返回直接子节点
- `getLabel(id)` 从 `labelsById` 解析当前标签

`getTree()` 是运行时投影；持久化仍然是仅追加的 JSONL 条目。

## 叶节点移动语义

有三个叶节点移动原语：

1. `branch(entryId)`
   - 验证条目存在
   - 设置 `leafId = entryId`
   - 不写入新条目

2. `resetLeaf()`
   - 设置 `leafId = null`
   - 下次追加会创建新的根条目（`parentId = null`）

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - 接受 `branchFromId: string | null`
   - 设置 `leafId = branchFromId`
   - 作为该叶节点的子节点追加一个 `branch_summary` 条目
   - 当 `branchFromId` 为 `null` 时，`fromId` 持久化为 `"root"`

## `/tree` 导航行为（同一会话文件内）

`AgentSession.navigateTree()` 是导航操作，不是文件分叉。

流程：

1. 验证目标并计算被放弃的路径（`collectEntriesForBranchSummary`）
2. 发射 `session_before_tree` 事件，携带 `TreePreparation`
3. 可选地对被放弃的条目进行摘要（使用钩子提供的摘要或内置摘要器）
4. 计算新的叶节点目标：
   - 选择 **user** 消息：叶节点移动到其父节点，消息文本返回用于编辑器预填充
   - 选择 **custom_message**：与 user 消息相同的规则（叶节点 = 父节点，文本预填充编辑器）
   - 选择其他任何条目：叶节点 = 所选条目 id
5. 执行叶节点移动：
   - 有摘要时：`branchWithSummary(newLeafId, ...)`
   - 无摘要且 `newLeafId === null` 时：`resetLeaf()`
   - 其他情况：`branch(newLeafId)`
6. 从新叶节点重建代理上下文并发射 `session_tree` 事件

重要说明：摘要条目附加在**新的导航位置**，而不是被放弃的分支尾部。

## `/branch` 行为（新会话文件）

`/branch` 和 `/tree` 是有意区分的：

- `/tree` 在当前会话文件内导航。
- `/branch` 创建新的会话分支文件（或在非持久化模式下进行内存替换）。

面向用户的 `/branch` 流程（`SelectorController.showUserMessageSelector` → `AgentSession.branch`）：

- 分支源必须是 **user 消息**。
- 提取所选用户文本用于编辑器预填充。
- 如果所选用户消息是根节点（`parentId === null`）：通过 `newSession({ parentSession: previousSessionFile })` 启动新会话。
- 否则：`createBranchedSession(selectedEntry.parentId)` 将历史分叉到所选提示边界。

`SessionManager.createBranchedSession(leafId)` 的具体细节：

- 通过 `getBranch(leafId)` 构建根→叶路径；如果缺失则抛出异常。
- 从复制的路径中排除现有的 `label` 条目。
- 为保留在路径中的条目从已解析的 `labelsById` 重建新的标签条目。
- 持久化模式：写入新的 JSONL 文件并将管理器切换到该文件；返回新文件路径。
- 内存模式：替换内存中的条目；返回 `undefined`。

## 上下文重建与摘要/自定义集成

`buildSessionContext()`（位于 `session-manager.ts`）解析活动的根→叶路径并构建有效的 LLM 上下文状态：

- 跟踪路径上最新的 thinking/model/mode/ttsr 状态。
- 处理路径上最新的压缩：
  - 首先发射压缩摘要
  - 重放从 `firstKeptEntryId` 到压缩点的保留消息
  - 然后重放压缩后的消息
- 将 `branch_summary` 和 `custom_message` 条目作为 `AgentMessage` 对象包含在内。

`session/messages.ts` 随后为模型输入映射这些消息类型：

- `branchSummary` 和 `compactionSummary` 转换为 user 角色的模板化上下文消息
- `custom`/`hookMessage` 转换为 user 角色的内容消息

因此，树移动通过更改活动叶路径来改变上下文，而不是通过修改旧条目。

## 标签与树 UI 行为

标签持久化：

- `appendLabelChange(targetId, label?)` 在当前叶链上写入 `label` 条目。
- `labelsById` 立即更新（设置或删除）。
- `getTree()` 将当前标签解析到每个返回的节点上。

树选择器行为（`tree-selector.ts`）：

- 将树扁平化用于导航，保持活动路径高亮，并优先显示活动分支。
- 支持过滤模式：`default`、`no-tools`、`user-only`、`labeled-only`、`all`。
- 支持对渲染的语义内容进行自由文本搜索。
- `Shift+L` 打开内联标签编辑并通过 `appendLabelChange` 写入。

命令路由：

- `/tree` 始终打开树选择器。
- `/branch` 打开用户消息选择器，除非 `doubleEscapeAction=tree`，在这种情况下它也使用树选择器 UX。

## 树操作的扩展和钩子接入点

命令时扩展 API（`ExtensionCommandContext`）：

- `branch(entryId)` — 创建分支会话文件
- `navigateTree(targetId, { summarize? })` — 在当前树/文件内移动

围绕树导航的事件：

- `session_before_tree`
  - 接收 `TreePreparation`：
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - 可以取消导航
  - 可以提供摘要负载来替代内置摘要器
  - 接收中止 `signal`（Escape 取消路径）
- `session_tree`
  - 发射 `newLeafId`、`oldLeafId`
  - 当创建了摘要时包含 `summaryEntry`
  - `fromExtension` 指示摘要来源

相邻但相关的生命周期钩子：

- `session_before_branch` / `session_branch` 用于 `/branch` 流程
- `session_before_compact`、`session.compacting`、`session_compact` 用于后续影响树上下文重建的压缩条目

## 实际约束和边界条件

- `branch()` 不能以 `null` 为目标；使用 `resetLeaf()` 来设置首条目之前的根状态。
- `branchWithSummary()` 支持 `null` 目标并记录 `fromId: "root"`。
- 在树选择器中选择当前叶节点是空操作。
- 摘要生成需要活动模型；如果不存在，摘要导航会快速失败。
- 如果摘要生成被中止，导航将被取消且叶节点不变。
- 内存会话的 `createBranchedSession` 永远不会返回分支文件路径。

## 仍然存在的遗留兼容性

会话迁移在加载时仍会运行：

- v1→v2 添加 `id`/`parentId` 并将压缩索引锚点转换为 id 锚点
- v2→v3 将遗留的 `hookMessage` 角色迁移为 `custom`

迁移后，当前运行时行为遵循版本 3 的树语义。
