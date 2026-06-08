---
title: 会话存储与条目模型
description: 基于追加模式的会话存储模型，包含条目类型、持久化以及格式间的迁移。
sidebar:
  order: 1
  label: 存储与条目模型
i18n:
  sourceHash: 42fe17549e00
  translator: machine
---

# 会话存储与条目模型

本文档是 coding-agent 会话如何表示、持久化、迁移以及在运行时重建的权威参考。

## 范围

涵盖内容：

- 会话 JSONL 格式与版本控制
- 条目分类与树语义（`id`/`parentId` + 叶指针）
- 加载旧文件或格式错误文件时的迁移/兼容性行为
- 上下文重建（`buildSessionContext`）
- 持久化保证、失败行为、截断/blob 外部化
- 存储抽象（`FileSessionStorage`、`MemorySessionStorage`）及相关工具

不涵盖 `/tree` UI 渲染行为，除非涉及影响会话数据的语义。

## 实现文件

- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`src/session/messages.ts`](../../packages/coding-agent/src/session/messages.ts)
- [`src/session/session-storage.ts`](../../packages/coding-agent/src/session/session-storage.ts)
- [`src/session/history-storage.ts`](../../packages/coding-agent/src/session/history-storage.ts)
- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts)

## 磁盘布局

默认会话文件位置：

```text
~/.xcsh/agent/sessions/--<cwd-encoded>--/<timestamp>_<sessionId>.jsonl
```

`<cwd-encoded>` 由工作目录派生而来，去除前导斜杠并将 `/`、`\\` 和 `:` 替换为 `-`。

Blob 存储位置：

```text
~/.xcsh/agent/blobs/<sha256>
```

终端面包屑文件写入位置：

```text
~/.xcsh/agent/terminal-sessions/<terminal-id>
```

面包屑内容为两行：原始 cwd 和会话文件路径。`continueRecent()` 在扫描最近修改时间之前优先使用此终端范围的指针。

## 文件格式

会话文件为 JSONL 格式：每行一个 JSON 对象。

- 第 1 行始终为会话头（`type: "session"`）。
- 其余行为 `SessionEntry` 值。
- 条目在运行时仅追加；分支导航通过移动指针（`leafId`）而非修改现有条目实现。

### 头部（`SessionHeader`）

```json
{
  "type": "session",
  "version": 3,
  "id": "1f9d2a6b9c0d1234",
  "timestamp": "2026-02-16T10:20:30.000Z",
  "cwd": "/work/pi",
  "title": "optional session title",
  "parentSession": "optional lineage marker"
}
```

说明：

- `version` 在 v1 文件中为可选字段；缺失表示 v1。
- `parentSession` 是不透明的血统字符串。当前代码根据流程（`fork`、`forkFrom`、`createBranchedSession` 或显式 `newSession({ parentSession })`）写入会话 id 或会话路径。视为元数据，而非类型化的外键。

### 条目基类（`SessionEntryBase`）

所有非头部条目包含：

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

`parentId` 对于根条目可以为 `null`（首次追加，或 `resetLeaf()` 之后）。

## 条目分类

`SessionEntry` 是以下类型的联合：

- `message`
- `thinking_level_change`
- `model_change`
- `compaction`
- `branch_summary`
- `custom`
- `custom_message`
- `label`
- `ttsr_injection`
- `session_init`
- `mode_change`

### `message`

直接存储一个 `AgentMessage`。

```json
{
  "type": "message",
  "id": "a1b2c3d4",
  "parentId": null,
  "timestamp": "2026-02-16T10:21:00.000Z",
  "message": {
    "role": "assistant",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "content": [{ "type": "text", "text": "Done." }],
    "usage": { "input": 100, "output": 20, "cacheRead": 0, "cacheWrite": 0, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } },
    "timestamp": 1760000000000
  }
}
```

### `model_change`

```json
{
  "type": "model_change",
  "id": "b1c2d3e4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:21:30.000Z",
  "model": "openai/gpt-4o",
  "role": "default"
}
```

`role` 为可选字段；缺失时在上下文重建中视为 `default`。

### `thinking_level_change`

```json
{
  "type": "thinking_level_change",
  "id": "c1d2e3f4",
  "parentId": "b1c2d3e4",
  "timestamp": "2026-02-16T10:22:00.000Z",
  "thinkingLevel": "high"
}
```

### `compaction`

```json
{
  "type": "compaction",
  "id": "d1e2f3a4",
  "parentId": "c1d2e3f4",
  "timestamp": "2026-02-16T10:23:00.000Z",
  "summary": "Conversation summary",
  "shortSummary": "Short recap",
  "firstKeptEntryId": "a1b2c3d4",
  "tokensBefore": 42000,
  "details": { "readFiles": ["src/a.ts"] },
  "preserveData": { "hookState": true },
  "fromExtension": false
}
```

### `branch_summary`

```json
{
  "type": "branch_summary",
  "id": "e1f2a3b4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:24:00.000Z",
  "fromId": "a1b2c3d4",
  "summary": "Summary of abandoned path",
  "details": { "note": "optional" },
  "fromExtension": true
}
```

如果从根节点分支（`branchFromId === null`），`fromId` 为字面字符串 `"root"`。

### `custom`

扩展状态持久化；被 `buildSessionContext` 忽略。

```json
{
  "type": "custom",
  "id": "f1a2b3c4",
  "parentId": "e1f2a3b4",
  "timestamp": "2026-02-16T10:25:00.000Z",
  "customType": "my-extension",
  "data": { "state": 1 }
}
```

### `custom_message`

由扩展提供的消息，参与 LLM 上下文构建。

```json
{
  "type": "custom_message",
  "id": "a2b3c4d5",
  "parentId": "f1a2b3c4",
  "timestamp": "2026-02-16T10:26:00.000Z",
  "customType": "my-extension",
  "content": "Injected context",
  "display": true,
  "details": { "debug": false }
}
```

### `label`

```json
{
  "type": "label",
  "id": "b2c3d4e5",
  "parentId": "a2b3c4d5",
  "timestamp": "2026-02-16T10:27:00.000Z",
  "targetId": "a1b2c3d4",
  "label": "checkpoint"
}
```

`label: undefined` 会清除 `targetId` 的标签。

### `ttsr_injection`

```json
{
  "type": "ttsr_injection",
  "id": "c2d3e4f5",
  "parentId": "b2c3d4e5",
  "timestamp": "2026-02-16T10:28:00.000Z",
  "injectedRules": ["ruleA", "ruleB"]
}
```

### `session_init`

```json
{
  "type": "session_init",
  "id": "d2e3f4a5",
  "parentId": "c2d3e4f5",
  "timestamp": "2026-02-16T10:29:00.000Z",
  "systemPrompt": "...",
  "task": "...",
  "tools": ["read", "edit"],
  "outputSchema": { "type": "object" }
}
```

### `mode_change`

```json
{
  "type": "mode_change",
  "id": "e2f3a4b5",
  "parentId": "d2e3f4a5",
  "timestamp": "2026-02-16T10:30:00.000Z",
  "mode": "plan",
  "data": { "planFile": "/tmp/plan.md" }
}
```

## 版本控制与迁移

当前会话版本：`3`。

### v1 -> v2

当头部 `version` 缺失或 `< 2` 时应用：

- 为每个非头部条目添加 `id` 和 `parentId`。
- 使用文件顺序重建线性父链。
- 当存在时将压缩字段 `firstKeptEntryIndex` 迁移为 `firstKeptEntryId`。
- 设置头部 `version = 2`。

### v2 -> v3

当头部 `version < 3` 时应用：

- 对于 `message` 条目：将旧版 `message.role === "hookMessage"` 重写为 `"custom"`。
- 设置头部 `version = 3`。

### 迁移触发与持久化

- 迁移在会话加载时运行（`setSessionFile`）。
- 如果执行了任何迁移，整个文件会立即重写到磁盘。
- 迁移首先修改内存中的条目，然后持久化重写后的 JSONL。

## 加载与兼容性行为

`loadEntriesFromFile(path)` 行为：

- 文件不存在（`ENOENT`）-> 返回 `[]`。
- 不可解析的行由宽容的 JSONL 解析器（`parseJsonlLenient`）处理。
- 如果第一个解析的条目不是有效的会话头（`type !== "session"` 或缺少字符串 `id`）-> 返回 `[]`。

`SessionManager.setSessionFile()` 行为：

- 加载器返回 `[]` 视为空/不存在的会话，并在该路径创建新的初始化会话文件替代。
- 有效文件被加载，如需要则迁移，解析 blob 引用，然后建立索引。

## 树与叶语义

底层模型为追加式树 + 可变叶指针：

- 每个追加方法创建恰好一个新条目，其 `parentId` 为当前 `leafId`。
- 新条目成为新的 `leafId`。
- `branch(entryId)` 仅移动 `leafId`；现有条目保持不变。
- `resetLeaf()` 将 `leafId` 设为 `null`；下一次追加创建新的根条目（`parentId: null`）。
- `branchWithSummary()` 将叶设置为分支目标并追加一个 `branch_summary` 条目。

`getEntries()` 按插入顺序返回所有非头部条目。正常操作中不删除现有条目；重写在更新表示的同时保留逻辑历史（迁移、移动、定向重写辅助函数）。

## 上下文重建（`buildSessionContext`）

`buildSessionContext(entries, leafId, byId?)` 解析发送给模型的内容。

算法：

1. 确定叶节点：
   - `leafId === null` -> 返回空上下文。
   - 显式 `leafId` -> 如果找到则使用该条目。
   - 否则回退到最后一个条目。
2. 从叶节点沿 `parentId` 链回溯到根节点，然后反转为根->叶路径。
3. 沿路径推导运行时状态：
   - `thinkingLevel` 取自最新的 `thinking_level_change`（默认 `"off"`）
   - 模型映射取自 `model_change` 条目（`role ?? "default"`）
   - 如果没有显式的模型变更，`models.default` 回退到助手消息的 provider/model
   - 去重的 `injectedTtsrRules` 来自所有 `ttsr_injection` 条目
   - mode/modeData 取自最新的 `mode_change`（默认模式 `"none"`）
4. 构建消息列表：
   - `message` 条目直接透传
   - `custom_message` 条目通过 `createCustomMessage` 转为 `custom` AgentMessages
   - `branch_summary` 条目通过 `createBranchSummaryMessage` 转为 `branchSummary` AgentMessages
   - 如果路径上存在 `compaction`：
     - 首先发出压缩摘要（`createCompactionSummaryMessage`）
     - 发出从 `firstKeptEntryId` 到压缩边界的路径条目
     - 发出压缩边界之后的条目

`custom` 和 `session_init` 条目不直接注入模型上下文。

## 持久化保证与失败模型

### 持久化与内存模式

- `SessionManager.create/open/continueRecent/forkFrom` -> 持久化模式（`persist = true`）。
- `SessionManager.inMemory` -> 非持久化模式（`persist = false`），使用 `MemorySessionStorage`。

### 写入管道

写入通过内部 promise 链（`#persistChain`）和 `NdjsonFileWriter` 串行化。

- `append*` 立即更新内存状态。
- 持久化延迟到至少存在一条助手消息时执行。
  - 首条助手消息之前：条目保留在内存中；不执行文件追加。
  - 当首条助手消息存在时：将完整的内存会话刷写到文件。
  - 之后：新条目增量追加。

代码中的设计理由：避免持久化从未产生助手响应的会话。

### 持久性操作

- `flush()` 刷写写入器并调用 `fsync()`。
- 原子完整重写（`#rewriteFile`）写入临时文件，刷写+fsync，关闭，然后重命名覆盖目标文件。
- 用于迁移、`setSessionName`、`rewriteEntries`、移动操作以及工具调用参数重写。

### 错误行为

- 持久化错误被锁存（`#persistError`）并在后续操作中重新抛出。
- 首个错误会附带会话文件上下文记录一次日志。
- 写入器关闭采用尽力而为策略，但会传播第一个有意义的错误。

## 数据大小控制与 Blob 外部化

在持久化条目之前：

- 大字符串被截断至 `MAX_PERSIST_CHARS`（500,000 字符）并附带提示：
  - `"[Session persistence truncated large content]"`
- 临时字段 `partialJson` 和 `jsonlEvents` 被移除。
- 如果对象同时具有 `content` 和 `lineCount`，截断后会重新计算行数。
- `content` 数组中 base64 长度 >= 1024 的图片块被外部化为 blob 引用：
  - 存储为 `blob:sha256:<hash>`
  - 原始字节写入 blob 存储（`BlobStore.put`）

加载时，blob 引用会被还原为 base64 用于 message/custom_message 图片块。

## 存储抽象

`SessionStorage` 接口提供 `SessionManager` 使用的所有文件系统操作：

- 同步：`ensureDirSync`、`existsSync`、`writeTextSync`、`statSync`、`listFilesSync`
- 异步：`exists`、`readText`、`readTextPrefix`、`writeText`、`rename`、`unlink`、`openWriter`

实现：

- `FileSessionStorage`：真实文件系统（Bun + node fs）
- `MemorySessionStorage`：基于 map 的内存实现，用于测试/非持久化会话

`SessionStorageWriter` 暴露 `writeLine`、`flush`、`fsync`、`close`、`getError`。

## 会话发现工具

定义在 `session-manager.ts` 中：

- `getRecentSessions(sessionDir, limit)` -> 用于 UI/会话选择器的轻量级元数据
- `findMostRecentSession(sessionDir)` -> 按修改时间排序的最新会话
- `list(cwd, sessionDir?)` -> 单个项目范围内的会话
- `listAll()` -> `~/.xcsh/agent/sessions` 下所有项目范围的会话

元数据提取尽可能仅读取前缀（`readTextPrefix(..., 4096)`）。

## 相关但独立的：提示词历史存储

`HistoryStorage`（`history-storage.ts`）是一个独立的 SQLite 子系统，用于提示词回调/搜索，而非会话回放。

- 数据库：`~/.xcsh/agent/history.db`
- 表：`history(id, prompt, created_at, cwd)`
- FTS5 索引：`history_fts`，通过触发器维护同步
- 使用内存中的上次提示词缓存对连续相同的提示词进行去重
- 异步插入（`setImmediate`），使提示词捕获不阻塞轮次执行

使用会话文件进行对话图/状态回放；使用 `HistoryStorage` 进行提示词历史 UX。
