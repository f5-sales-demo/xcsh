---
title: Tree 命令参考
description: /tree 命令参考，用于可视化会话历史和对话分支。
sidebar:
  order: 4
  label: /tree 命令
i18n:
  sourceHash: ee0e412fe993
  translator: machine
---

# `/tree` 命令参考

`/tree` 打开交互式**会话树**导航器。它允许你跳转到当前会话文件中的任意条目，并从该点继续。

这是文件内的叶节点移动，不是新的会话导出。

## `/tree` 的功能

- 从当前会话条目构建树结构（`SessionManager.getTree()`）
- 打开 `TreeSelectorComponent`，支持键盘导航、过滤和搜索
- 选择后调用 `AgentSession.navigateTree(targetId, { summarize, customInstructions })`
- 从新的叶节点路径重建可见聊天
- 选择用户/自定义消息时可选地预填充编辑器文本

主要实现：

- `src/modes/controllers/input-controller.ts`（`/tree`、快捷键绑定、双击 Escape 行为）
- `src/modes/controllers/selector-controller.ts`（树 UI 启动 + 摘要提示流程）
- `src/modes/components/tree-selector.ts`（导航、过滤、搜索、标签、渲染）
- `src/session/agent-session.ts`（`navigateTree` 叶节点切换 + 可选摘要）
- `src/session/session-manager.ts`（`getTree`、`branch`、`branchWithSummary`、`resetLeaf`、标签持久化）

## 如何打开

以下任一方式都可打开相同的选择器：

- `/tree`
- 配置的快捷键动作 `tree`
- 当编辑器为空时双击 Escape，且 `doubleEscapeAction = "tree"`（默认值）
- 当 `doubleEscapeAction = "tree"` 时使用 `/branch`（路由到树选择器而非仅用户分支选择器）

## 树 UI 模型

树从会话条目的父指针（`id` / `parentId`）渲染而来。

- 子节点按时间戳升序排列（较旧的在前，较新的在后）
- 活动分支（从根到当前叶节点的路径）用圆点标记
- 标签（如果存在）在节点文本前渲染为 `[label]`
- 如果存在多个根节点（孤立/断裂的父链），它们显示在虚拟分支根节点下

```text
Example tree view (active path marked with •):

├─ user: "Start task"
│  └─ assistant: "Plan"
│     ├─ • user: "Try approach A"
│     │  └─ • assistant: "A result"
│     │     └─ • [milestone] user: "Continue A"
│     └─ user: "Try approach B"
│        └─ assistant: "B result"
```

选择器围绕当前选择重新居中，最多显示：

- `max(5, floor(terminalHeight / 2))` 行

## 树选择器内的快捷键

- `Up` / `Down`：移动选择（循环）
- `Left` / `Right`：向上翻页 / 向下翻页
- `Enter`：选择节点
- `Esc`：如果搜索处于活动状态则清除搜索；否则关闭选择器
- `Ctrl+C`：关闭选择器
- `Type`：追加到搜索查询
- `Backspace`：删除搜索字符
- `Shift+L`：编辑/清除所选条目的标签
- `Ctrl+O`：向前切换过滤器
- `Shift+Ctrl+O`：向后切换过滤器
- `Alt+D/T/U/L/A`：直接跳转到特定过滤模式

## 过滤器和搜索语义

过滤模式（`TreeList`）：

1. `default`
2. `no-tools`
3. `user-only`
4. `labeled-only`
5. `all`

### `default`

显示大多数对话节点，但隐藏事务性条目类型：

- `label`
- `custom`
- `model_change`
- `thinking_level_change`

### `no-tools`

与 `default` 相同，但额外隐藏 `toolResult` 消息。

### `user-only`

仅显示角色为 `user` 的 `message` 条目。

### `labeled-only`

仅显示当前解析为有标签的条目。

### `all`

会话树中的所有内容，包括事务性/自定义条目。

### 仅包含工具调用的助手节点行为

仅包含**工具调用**（无文本）的助手消息在所有过滤视图中默认隐藏，除非：

- 消息为错误/已中止（`stopReason` 不是 `stop`/`toolUse`），或
- 它是当前叶节点（始终保持可见）

### 搜索行为

- 查询按空格分词
- 匹配不区分大小写
- 所有词条必须匹配（AND 语义）
- 可搜索文本包括标签、角色和特定类型的内容（消息文本、分支摘要文本、自定义类型、工具命令片段等）

## 选择结果（重要）

`navigateTree` 根据所选条目类型计算新的叶节点行为：

### 选择 `user` 消息

- 新叶节点变为所选条目的 `parentId`
- 如果父节点为 `null`（根用户消息），叶节点重置到根（`resetLeaf()`）
- 所选消息文本被复制到编辑器以供编辑/重新提交

### 选择 `custom_message`

- 叶节点规则与用户消息相同（`parentId`）
- 文本内容被提取并复制到编辑器

### 选择非用户节点（助手/工具/摘要/压缩/自定义事务性条目等）

- 新叶节点变为所选节点 id
- 编辑器不会预填充

### 选择当前叶节点

- 无操作；选择器关闭并显示 "Already at this point"

```text
Selection decision (simplified):

selected node
   │
   ├─ is current leaf? ── yes ──> close selector (no-op)
   │
   ├─ is user/custom_message? ── yes ──> leaf := parentId (or resetLeaf for root)
   │                                     + prefill editor text
   │
   └─ otherwise ──> leaf := selected node id
                    + no editor prefill
```

## 切换时的摘要流程

摘要提示由 `branchSummary.enabled` 控制（默认值：`false`）。

启用后，选择节点后 UI 会询问：

- `No summary`
- `Summarize`
- `Summarize with custom prompt`

流程详情：

- 在摘要提示中按 Escape 会重新打开树选择器
- 取消自定义提示会返回到摘要选择循环
- 在摘要生成期间，UI 显示加载动画并将 `Esc` 绑定到 `abortBranchSummary()`
- 如果摘要生成中止，树选择器重新打开且不应用任何移动

`navigateTree` 内部机制：

- 从旧叶节点到公共祖先收集被放弃分支的条目
- 发出 `session_before_tree`（扩展可以取消或注入摘要）
- 仅在请求且需要时使用默认摘要器
- 通过以下方式应用移动：
  - 当存在摘要时使用 `branchWithSummary(...)`
  - 非根移动且无摘要时使用 `branch(newLeafId)`
  - 根移动且无摘要时使用 `resetLeaf()`
- 用重建的会话上下文替换代理对话
- 发出 `session_tree`

注意：如果用户请求摘要但没有可摘要的内容，导航将继续进行而不创建摘要条目。

## 标签

树 UI 中的标签编辑调用 `appendLabelChange(targetId, label)`。

- 非空标签设置/更新解析后的标签
- 空标签清除标签
- 标签以仅追加的 `label` 条目形式存储
- 树节点显示解析后的标签状态，而非原始标签条目历史

## `/tree` 与相关操作的对比

| 操作 | 范围 | 结果 |
|---|---|---|
| `/tree` | 当前会话文件 | 将叶节点移动到选定点（同一文件） |
| `/branch` | 通常从当前会话文件到新会话文件 | 默认从选定的**用户**消息分支到新会话文件；如果 `doubleEscapeAction = "tree"`，`/branch` 会打开树导航 UI |
| `/fork` | 整个当前会话 | 将会话复制到新的持久化会话文件 |
| `/resume` | 会话列表 | 切换到另一个会话文件 |

关键区别：`/tree` 是单个会话文件内的导航/重定位工具。`/branch`、`/fork` 和 `/resume` 都会更改会话文件上下文。

## 操作工作流

### 从较早的用户提示重新运行而不丢失当前分支

1. `/tree`
2. 搜索/选择较早的用户消息
3. 选择 `No summary`（或根据需要生成摘要）
4. 在编辑器中编辑预填充的文本
5. 提交

效果：在同一会话文件内从选定点生长出新分支。

### 带上下文标记离开当前分支

1. 启用 `branchSummary.enabled`
2. `/tree` 并选择目标节点
3. 选择 `Summarize`（或自定义提示）

效果：在目标位置继续之前追加一个 `branch_summary` 条目。

### 检查隐藏的事务性条目

1. `/tree`
2. 按 `Alt+A`（全部）
3. 搜索 `model`、`thinking`、`custom` 或标签

效果：检查完整的内部时间线，而不仅仅是对话节点。

### 为后续跳转标记关键节点

1. `/tree`
2. 移动到条目
3. `Shift+L` 并设置标签
4. 之后使用 `Alt+L`（`labeled-only`）快速跳转

效果：在持久化的分支地标之间快速导航。
