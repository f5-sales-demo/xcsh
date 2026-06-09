---
title: Blob 与产物存储架构
description: 基于内容寻址的 blob 存储和产物注册中心，用于会话媒体、截图和工具输出。
sidebar:
  order: 7
  label: Blob 与产物存储
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# Blob 与产物存储架构

本文档描述了 coding-agent 如何将大型/二进制负载存储在会话 JSONL 之外、截断的工具输出如何被持久化，以及内部 URL（`artifact://`、`agent://`）如何解析回存储的数据。

## 为什么存在两个存储系统

运行时针对不同的数据形态使用两种不同的持久化机制：

- **内容寻址 blob**（`blob:sha256:<hash>`）：全局的、面向二进制的存储，用于将大型 image base64 负载从持久化的会话条目中外部化。
- **会话范围的产物**（`<sessionFile-without-.jsonl>/` 下的文件）：按会话组织的文本文件，用于完整的工具输出和子代理输出。

它们被有意地分离：

- blob 存储通过内容哈希优化去重和稳定引用，
- 产物存储通过本地 ID 优化仅追加的会话工具使用和人工/工具检索。

## 存储边界与磁盘布局

## Blob 存储边界（全局）

`SessionManager` 构造 `BlobStore(getBlobsDir())`，因此 blob 文件存储在一个共享的全局 blob 目录中（不在会话文件夹内）。

Blob 文件命名：

- 文件路径：`<blobsDir>/<sha256-hex>`
- 无扩展名
- 条目中存储的引用字符串：`blob:sha256:<sha256-hex>`

含义：

- 跨会话的相同二进制内容解析为相同的哈希/路径，
- 写入在内容层面是幂等的，
- blob 的生命周期可以超过任何单个会话文件。

## 产物边界（会话本地）

`ArtifactManager` 从会话文件路径派生产物目录：

- 会话文件：`.../<timestamp>_<sessionId>.jsonl`
- 产物目录：`.../<timestamp>_<sessionId>/`（去除 `.jsonl`）

产物类型共享此目录：

- 截断的工具输出文件：`<numericId>.<toolType>.log`（用于 `artifact://`）
- 子代理输出文件：`<outputId>.md`（用于 `agent://`）

## ID 与命名分配方案

## Blob ID：内容哈希

`BlobStore.put()` 对原始二进制字节计算 SHA-256 并返回：

- `hash`：十六进制摘要，
- `path`：`<blobsDir>/<hash>`，
- `ref`：`blob:sha256:<hash>`。

不使用会话本地计数器。

## 产物 ID：会话本地单调递增整数

`ArtifactManager` 在首次使用时扫描现有的 `*.log` 产物文件以找到最大的现有数字 ID，并设置 `nextId = max + 1`。

分配行为：

- 文件格式：`{id}.{toolType}.log`
- ID 是顺序字符串（`"0"`、`"1"`、...）
- 恢复会话时不会覆盖现有产物，因为扫描在分配之前进行。

如果产物目录不存在，扫描返回空列表，分配从 `0` 开始。

## 代理输出 ID（`agent://`）

`AgentOutputManager` 为子代理输出分配的 ID 格式为 `<index>-<requestedId>`（可选地嵌套在父前缀下，例如 `0-Parent.1-Child`）。它在初始化时扫描现有的 `.md` 文件，以便在恢复时从下一个索引继续。

## 持久化数据流

## 1）会话条目持久化重写路径

在会话条目写入之前（`#rewriteFile` / 增量持久化），`SessionManager` 调用 `prepareEntryForPersistence()`（通过 `truncateForPersistence`）。

关键行为：

1. **大字符串截断**：超大字符串被截断并添加后缀 `"[Session persistence truncated large content]"`。
2. **瞬态字段剥离**：`partialJson` 和 `jsonlEvents` 从持久化条目中移除。
3. **图像外部化为 blob**：
   - 仅适用于 `content` 数组中的图像块，
   - 仅当 `data` 尚未是 blob 引用时，
   - 仅当 base64 长度至少达到阈值（`BLOB_EXTERNALIZE_THRESHOLD = 1024`）时，
   - 将内联 base64 替换为 `blob:sha256:<hash>`。

这使会话 JSONL 保持紧凑，同时保留可恢复性。

## 2）会话加载重新水合路径

打开会话时（`setSessionFile`），在迁移之后，`SessionManager` 运行 `resolveBlobRefsInEntries()`。

对于每个包含 `blob:sha256:<hash>` 的 message/custom-message 图像块：

- 从 blob 存储读取 blob 字节，
- 将字节转换回 base64，
- 修改内存中的条目为内联 base64 供运行时消费者使用。

如果 blob 缺失：

- `resolveImageData()` 记录警告，
- 返回原始引用字符串不变，
- 加载继续（不会硬崩溃）。

## 3）工具输出溢出/截断路径

`OutputSink` 在 bash/python/ssh 及相关执行器中支持流式输出。

行为：

1. 每个数据块被清理并追加到内存尾部缓冲区。
2. 当内存字节超过溢出阈值（`DEFAULT_MAX_BYTES`，50KB）时，sink 标记输出为已截断。
3. 如果产物路径可用，sink 打开文件写入器并写入：
   - 现有缓冲内容（一次性），
   - 所有后续数据块。
4. 内存缓冲区始终修剪为尾部窗口用于显示。
5. `dump()` 仅在文件 sink 成功创建时返回包含 `artifactId` 的摘要。

实际效果：

- UI/工具返回显示截断的尾部，
- 完整输出保存在产物文件中并通过 `artifact://<id>` 引用。

如果文件 sink 创建失败（I/O 错误、路径缺失等），sink 静默回退为仅内存截断；完整输出不会被持久化。

## URL 访问模型

## `blob:` 引用

`blob:sha256:<hash>` 是持久化会话条目负载中的持久化引用，而不是由路由器处理的内部 URL 方案。解析由 `SessionManager` 在会话加载期间完成。

## `artifact://<id>`

由 `ArtifactProtocolHandler` 处理：

- 需要活跃的会话产物目录，
- ID 必须是数字，
- 通过匹配文件名前缀 `<id>.` 进行解析，
- 从匹配的 `.log` 文件返回原始文本（`text/plain`），
- 缺失时，错误信息包含可用产物 ID 的列表。

目录缺失行为：

- 如果产物目录不存在，抛出 `No artifacts directory found`。

## `agent://<id>`

由 `AgentProtocolHandler` 通过 `<artifactsDir>/<id>.md` 处理：

- 普通形式返回 markdown 文本，
- `/path` 或 `?q=` 形式执行 JSON 提取，
- 路径提取和查询提取不能组合使用，
- 如果请求提取，文件内容必须能解析为 JSON。

目录缺失行为：

- 抛出 `No artifacts directory found`。

输出缺失行为：

- 抛出 `Not found: <id>` 并列出现有 `.md` 文件中的可用 ID。

Read 工具集成：

- `read` 对非提取类内部 URL 读取支持 offset/limit 分页，
- 当使用 `agent://` 提取时拒绝 `offset/limit`。

## 恢复、分叉和移动语义

## 恢复

- `ArtifactManager` 在首次分配时扫描现有的 `{id}.*.log` 文件并继续编号。
- `AgentOutputManager` 扫描现有的 `.md` 输出 ID 并继续编号。
- `SessionManager` 在加载时将 blob 引用重新水合为 base64。

## 分叉

`SessionManager.fork()` 创建一个具有新会话 ID 和 `parentSession` 链接的新会话文件，然后返回旧/新文件路径。产物复制由 `AgentSession.fork()` 处理：

- 尝试将旧产物目录递归复制到新产物目录，
- 容忍旧目录缺失，
- 非 ENOENT 的复制错误记录为警告，分叉仍然完成。

分叉后的 ID 含义：

- 如果复制成功，新会话中的产物计数器从已复制的最大 ID 之后继续，
- 如果复制失败/跳过，新会话产物 ID 从 `0` 开始。

分叉后的 blob 含义：

- blob 是全局且内容寻址的，因此不需要复制 blob 目录。

## 移动到新工作目录

`SessionManager.moveTo()` 将会话文件和产物目录重命名到新的默认会话目录，如果后续步骤失败则具有回滚逻辑。这在重新定位会话范围的同时保留产物身份。

## 故障处理与回退路径

| 场景 | 行为 |
| --- | --- |
| 重新水合期间 blob 文件缺失 | 发出警告并在内存中保留 `blob:sha256:` 引用字符串 |
| 通过 `BlobStore.get` 读取 blob 时遇到 ENOENT | 返回 `null` |
| 产物目录缺失（`ArtifactManager.listFiles`） | 返回空列表（分配可以重新开始） |
| 产物目录缺失（`artifact://` / `agent://`） | 抛出明确的 `No artifacts directory found` |
| 产物 ID 未找到 | 抛出错误并列出可用 ID |
| OutputSink 产物写入器初始化失败 | 继续仅保留尾部截断（无完整输出产物） |
| 无会话文件（某些任务路径） | Task 工具回退为使用临时产物目录存储子代理输出 |

## 二进制 blob 外部化 vs 文本输出产物

- **Blob 外部化**用于持久化会话条目内容中的二进制图像负载；它用稳定的内容引用替换 JSONL 中的内联 base64。
- **产物**是用于执行输出和子代理输出的纯文本文件；它们通过内部 URL 以会话本地 ID 进行寻址。

这两个系统仅间接交叉（都减少了会话 JSONL 膨胀），但具有不同的身份标识、生命周期和检索路径。

## 实现文件

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — blob 引用格式、哈希计算、put/get、外部化/解析辅助函数。
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — 会话产物目录模型和数字产物 ID 分配。
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink` 截断/溢出到文件行为和摘要元数据。
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — 持久化转换、加载时 blob 重新水合、会话分叉/移动交互。
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — 交互式分叉期间的产物目录复制。
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — 工具产物管理器引导和按工具的产物路径分配。
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://` 解析器。
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — `agent://` 解析器 + JSON 提取。
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — 内部 URL 路由器接线和产物目录解析器。
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — 会话范围的代理输出 ID 分配（用于 `agent://`）。
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — 子代理输出产物写入（`<id>.md`）和临时产物目录回退。
