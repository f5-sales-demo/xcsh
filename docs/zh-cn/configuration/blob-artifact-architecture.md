---
title: Blob 与 Artifact 存储架构
description: 基于内容寻址的 Blob 存储与 Artifact 注册表，用于会话媒体、截图和工具输出。
sidebar:
  order: 7
  label: Blob 与 artifact 存储
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# Blob 与 artifact 存储架构

本文档描述了 coding-agent 如何在会话 JSONL 之外存储大型/二进制负载，截断的工具输出如何持久化，以及内部 URL（`artifact://`、`agent://`）如何解析回存储的数据。

## 为什么存在两套存储系统

运行时针对不同的数据形态使用两种不同的持久化机制：

- **内容寻址 blob**（`blob:sha256:<hash>`）：全局的、面向二进制的存储，用于将大型图像 base64 负载从持久化的会话条目中外部化。
- **会话作用域 artifact**（`<sessionFile-without-.jsonl>/` 下的文件）：按会话组织的文本文件，用于完整的工具输出和子代理输出。

它们被有意设计为分离的：

- blob 存储通过内容哈希优化去重和稳定引用，
- artifact 存储通过本地 ID 优化仅追加的会话工具操作和人工/工具检索。

## 存储边界与磁盘布局

## Blob 存储边界（全局）

`SessionManager` 构造 `BlobStore(getBlobsDir())`，因此 blob 文件存放在共享的全局 blob 目录中（不在会话文件夹中）。

Blob 文件命名：

- 文件路径：`<blobsDir>/<sha256-hex>`
- 无扩展名
- 条目中存储的引用字符串：`blob:sha256:<sha256-hex>`

影响：

- 跨会话的相同二进制内容会解析到相同的哈希/路径，
- 在内容层面写入是幂等的，
- blob 的生命周期可以超过任何单个会话文件。

## Artifact 边界（会话本地）

`ArtifactManager` 从会话文件路径派生 artifact 目录：

- 会话文件：`.../<timestamp>_<sessionId>.jsonl`
- artifact 目录：`.../<timestamp>_<sessionId>/`（去掉 `.jsonl`）

Artifact 类型共享此目录：

- 截断的工具输出文件：`<numericId>.<toolType>.log`（对应 `artifact://`）
- 子代理输出文件：`<outputId>.md`（对应 `agent://`）

## ID 和名称分配方案

## Blob ID：内容哈希

`BlobStore.put()` 对原始二进制字节计算 SHA-256 并返回：

- `hash`：十六进制摘要，
- `path`：`<blobsDir>/<hash>`，
- `ref`：`blob:sha256:<hash>`。

不使用会话本地计数器。

## Artifact ID：会话本地单调递增整数

`ArtifactManager` 在首次使用时扫描已有的 `*.log` artifact 文件以找到最大的数字 ID，并设置 `nextId = max + 1`。

分配行为：

- 文件格式：`{id}.{toolType}.log`
- ID 是顺序字符串（`"0"`、`"1"`、...）
- 恢复时不会覆盖已有的 artifact，因为扫描在分配之前进行。

如果 artifact 目录不存在，扫描返回空列表，分配从 `0` 开始。

## 代理输出 ID（`agent://`）

`AgentOutputManager` 为子代理输出分配 ID，格式为 `<index>-<requestedId>`（可选地嵌套在父前缀下，例如 `0-Parent.1-Child`）。它在初始化时扫描已有的 `.md` 文件，以便在恢复时从下一个索引继续。

## 持久化数据流

## 1）会话条目持久化重写路径

在会话条目写入之前（`#rewriteFile` / 增量持久化），`SessionManager` 调用 `prepareEntryForPersistence()`（通过 `truncateForPersistence`）。

关键行为：

1. **大字符串截断**：超大字符串被截断并添加后缀 `"[Session persistence truncated large content]"`。
2. **临时字段剥离**：从持久化条目中移除 `partialJson` 和 `jsonlEvents`。
3. **图像外部化为 blob**：
   - 仅适用于 `content` 数组中的图像块，
   - 仅当 `data` 尚未是 blob 引用时，
   - 仅当 base64 长度至少达到阈值（`BLOB_EXTERNALIZE_THRESHOLD = 1024`）时，
   - 将内联 base64 替换为 `blob:sha256:<hash>`。

这使会话 JSONL 保持紧凑，同时保留可恢复性。

## 2）会话加载再水合路径

打开会话时（`setSessionFile`），在迁移之后，`SessionManager` 运行 `resolveBlobRefsInEntries()`。

对于每个带有 `blob:sha256:<hash>` 的 message/custom-message 图像块：

- 从 blob 存储读取 blob 字节，
- 将字节转换回 base64，
- 修改内存中的条目为内联 base64，供运行时消费者使用。

如果 blob 缺失：

- `resolveImageData()` 记录警告，
- 返回原始引用字符串不变，
- 加载继续（不会硬崩溃）。

## 3）工具输出溢出/截断路径

`OutputSink` 驱动 bash/python/ssh 及相关执行器中的流式输出。

行为：

1. 每个数据块被清理并追加到内存尾部缓冲区。
2. 当内存字节超过溢出阈值（`DEFAULT_MAX_BYTES`，50KB）时，sink 标记输出为已截断。
3. 如果 artifact 路径可用，sink 打开文件写入器并写入：
   - 已有的缓冲内容（一次性写入），
   - 所有后续数据块。
4. 内存缓冲区始终被裁剪到尾部窗口以供显示。
5. `dump()` 返回的摘要仅在文件 sink 成功创建时包含 `artifactId`。

实际效果：

- UI/工具返回显示截断的尾部，
- 完整输出保存在 artifact 文件中，并以 `artifact://<id>` 引用。

如果文件 sink 创建失败（I/O 错误、路径缺失等），sink 静默回退到仅内存截断；完整输出不会被持久化。

## URL 访问模型

## `blob:` 引用

`blob:sha256:<hash>` 是持久化在会话条目负载中的引用，不是由路由器处理的内部 URL 方案。解析由 `SessionManager` 在会话加载时完成。

## `artifact://<id>`

由 `ArtifactProtocolHandler` 处理：

- 需要活跃的会话 artifact 目录，
- ID 必须是数字，
- 通过匹配文件名前缀 `<id>.` 来解析，
- 从匹配的 `.log` 文件返回原始文本（`text/plain`），
- 缺失时，错误信息包含可用 artifact ID 列表。

目录缺失行为：

- 如果 artifact 目录不存在，抛出 `No artifacts directory found`。

## `agent://<id>`

由 `AgentProtocolHandler` 处理，操作 `<artifactsDir>/<id>.md`：

- 普通形式返回 markdown 文本，
- `/path` 或 `?q=` 形式执行 JSON 提取，
- 路径和查询提取不能组合使用，
- 如果请求了提取，文件内容必须可解析为 JSON。

目录缺失行为：

- 抛出 `No artifacts directory found`。

输出缺失行为：

- 抛出 `Not found: <id>`，并列出已有 `.md` 文件中的可用 ID。

读取工具集成：

- `read` 对非提取的内部 URL 读取支持 offset/limit 分页，
- 当使用 `agent://` 提取时拒绝 `offset/limit`。

## 恢复、分叉和移动语义

## 恢复

- `ArtifactManager` 在首次分配时扫描已有的 `{id}.*.log` 文件并继续编号。
- `AgentOutputManager` 扫描已有的 `.md` 输出 ID 并继续编号。
- `SessionManager` 在加载时将 blob 引用再水合为 base64。

## 分叉

`SessionManager.fork()` 创建带有新会话 ID 和 `parentSession` 链接的新会话文件，然后返回旧/新文件路径。Artifact 复制由 `AgentSession.fork()` 处理：

- 尝试将旧 artifact 目录递归复制到新 artifact 目录，
- 容忍旧目录缺失，
- 非 ENOENT 的复制错误记录为警告，分叉仍然完成。

分叉后的 ID 影响：

- 如果复制成功，新会话中的 artifact 计数器从已复制的最大 ID 之后继续，
- 如果复制失败/跳过，新会话 artifact ID 从 `0` 开始。

分叉后的 blob 影响：

- blob 是全局的且基于内容寻址，因此不需要复制 blob 目录。

## 移动到新的工作目录

`SessionManager.moveTo()` 将会话文件和 artifact 目录重命名到新的默认会话目录，并在后续步骤失败时提供回滚逻辑。这在重新定位会话作用域的同时保持 artifact 身份不变。

## 故障处理与回退路径

| 场景 | 行为 |
| --- | --- |
| 再水合期间 blob 文件缺失 | 记录警告并在内存中保留 `blob:sha256:` 引用字符串 |
| 通过 `BlobStore.get` 读取 blob 时 ENOENT | 返回 `null` |
| Artifact 目录缺失（`ArtifactManager.listFiles`） | 返回空列表（分配可以从头开始） |
| Artifact 目录缺失（`artifact://` / `agent://`） | 抛出明确的 `No artifacts directory found` |
| Artifact ID 未找到 | 抛出异常并列出可用 ID |
| OutputSink artifact 写入器初始化失败 | 继续仅使用尾部截断（不生成完整输出 artifact） |
| 无会话文件（某些任务路径） | Task 工具回退到临时 artifact 目录用于子代理输出 |

## 二进制 blob 外部化与文本输出 artifact

- **Blob 外部化** 用于持久化会话条目内容中的二进制图像负载；它将 JSONL 中的内联 base64 替换为稳定的内容引用。
- **Artifact** 是用于执行输出和子代理输出的纯文本文件；它们通过会话本地 ID 经由内部 URL 进行寻址。

这两个系统仅间接交叉（都减少了会话 JSONL 膨胀），但具有不同的身份标识、生命周期和检索路径。

## 实现文件

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — blob 引用格式、哈希计算、put/get、外部化/解析辅助函数。
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — 会话 artifact 目录模型和数字 artifact ID 分配。
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink` 截断/溢出到文件行为和摘要元数据。
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — 持久化转换、加载时 blob 再水合、会话分叉/移动交互。
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — 交互式分叉期间的 artifact 目录复制。
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — 工具 artifact 管理器引导和按工具的 artifact 路径分配。
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://` 解析器。
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — `agent://` 解析器 + JSON 提取。
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — 内部 URL 路由器接线和 artifact 目录解析器。
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — 会话作用域的代理输出 ID 分配，用于 `agent://`。
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — 子代理输出 artifact 写入（`<id>.md`）和临时 artifact 目录回退。
