---
title: Notebook 工具运行时内部机制
description: Jupyter notebook 工具运行时，包含单元格执行、内核生命周期和输出渲染。
sidebar:
  order: 2
  label: Notebook 工具
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# Notebook 工具运行时内部机制

本文档描述了当前 `notebook` 工具的实现及其与内核支持的 Python 运行时之间的关系。

关键区别：**`notebook` 是一个 JSON notebook 编辑器，而非 notebook 执行器**。它直接编辑 `.ipynb` 单元格源代码；它不会启动或与 Python 内核通信。

## 实现文件

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) 运行时边界：编辑与执行

## `notebook` 工具（`src/tools/notebook.ts`）

- 支持对 `.ipynb` 文件执行 `action: edit | insert | delete` 操作。
- 相对于会话工作目录解析路径（`resolveToCwd`）。
- 加载 notebook JSON，验证 `cells` 数组，验证 `cell_index` 边界。
- 在内存中应用源代码编辑，并使用 `JSON.stringify(notebook, null, 1)` 将完整的 notebook JSON 写回。
- 返回文本摘要 + 结构化的 `details`（`action`、`cellIndex`、`cellType`、`totalCells`、`cellSource`）。

此工具中不存在内核生命周期：

- 无网关获取
- 无内核会话 ID
- 无 `execute_request`
- 无来自内核通道的流式数据块
- 无富显示捕获（`image/png`、JSON 显示、状态 MIME）

## 类 Notebook 的执行路径（`src/tools/python.ts` + `src/ipy/*`）

当代理需要运行单元格样式的 Python 代码（顺序单元格、持久状态、富显示）时，会通过 **`python` 工具**而非 `notebook` 来完成。

内核模式、重启/取消行为、数据块流式传输和输出工件截断都在该路径中实现。

## 2) Notebook 单元格处理语义（`notebook` 工具）

## 源代码规范化

`content` 被拆分为保留换行符的 `source: string[]`：

- 每个非最后一行保留尾部 `\n`
- 最后一行不强制添加尾部换行符

这遵循 notebook JSON 约定，避免在后续编辑中意外发生行连接。

## 操作行为

- `edit`
  - 替换 `cells[cell_index].source`
  - 保留现有 `cell_type`
- `insert`
  - 在 `[0..cellCount]` 位置插入
  - `cell_type` 默认为 `code`
  - 代码单元格初始化 `execution_count: null` 和 `outputs: []`
  - markdown 单元格仅初始化 `metadata` + `source`
- `delete`
  - 移除 `cells[cell_index]`
  - 在详情中返回被移除的 `source` 以供渲染器预览

## 错误面

以下情况会抛出硬性失败：

- 缺少 notebook 文件
- 无效 JSON
- 缺少 `cells` 或 `cells` 非数组
- 索引超出范围（insert 和非 insert 操作有不同的有效范围）
- `edit`/`insert` 操作缺少 `content`

这些在上游成为 `Error:` 工具响应；渲染器使用 notebook 路径 + 格式化的错误文本。

## 3) 内核会话语义（实际存在的位置）

内核语义在 `executePython` / `PythonKernel` 中实现，适用于 `python` 工具。

## 模式

`PythonKernelMode`：

- `session`（默认）
  - 内核缓存在 `kernelSessions` 映射中
  - 最多 4 个会话；溢出时驱逐最旧的
  - 每 30 秒清理空闲/死亡会话，5 分钟后超时
  - 每个会话的队列序列化执行（`session.queue`）
- `per-call`
  - 为请求创建内核
  - 执行
  - 始终在 `finally` 中关闭内核

## 重置行为

`python` 工具仅在多单元格调用的第一个单元格中传递 `reset`；后续单元格始终以 `reset: false` 运行。

## 内核死亡/重启/重试

在会话模式（`withKernelSession`）中：

- 通过心跳检测死亡内核（每 5 秒 `kernel.isAlive()` 检查）或执行失败检测。
- 运行前的死亡状态触发 `restartKernelSession`。
- 执行时崩溃路径重试一次：重启内核，重新运行处理器。
- 同一会话中 `restartCount > 1` 会抛出 `Python kernel restarted too many times in this session`。

启动重试行为：

- 共享网关内核创建在 HTTP 5xx 的 `SharedGatewayCreateError` 时重试一次。

资源耗尽恢复：

- 检测 `EMFILE`/`ENFILE`/"Too many open files" 类型的失败
- 清除已跟踪的会话
- 调用 `shutdownSharedGateway()`
- 重试一次内核会话创建

## 4) 环境/会话变量注入

内核启动从执行器接收可选的环境变量映射：

- `PI_SESSION_FILE`（会话状态文件路径）
- `ARTIFACTS`（工件目录）

`PythonKernel.#initializeKernelEnvironment(...)` 随后在内核内运行初始化脚本以：

- `os.chdir(cwd)`
- 将环境变量条目注入 `os.environ`
- 如果缺少则将 cwd 添加到 `sys.path` 前面

含义：

- 读取会话或工件上下文的 prelude 辅助函数依赖于 Python 进程状态中的这些环境变量。

## 5) 流式传输/数据块和显示处理（内核支持路径）

内核客户端针对每次执行处理 Jupyter 协议消息：

- `stream` -> 文本块发送到 `onChunk`
- `execute_result` / `display_data` ->
  - 按 MIME 优先级选择显示文本：`text/markdown` > `text/plain` > 转换后的 `text/html`
  - 结构化输出单独捕获：
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }`（不产生文本输出）
- `error` -> 回溯文本推送到数据块流 + 结构化错误元数据
- `input_request` -> 发出 stdin 警告文本，发送空的 `input_reply`，标记 stdin 已请求
- 完成等待 `execute_reply` 和内核 `status=idle` 两者

取消/超时：

- 中止信号触发 `interrupt()`（REST `/interrupt` + 控制通道 `interrupt_request`）
- 结果标记 `cancelled=true`
- 超时路径在输出中添加注释 `Command timed out after <n> seconds`

## 6) 截断和工件行为

`src/session/streaming-output.ts` 中的 `OutputSink` 被内核执行路径（`executeWithKernel`）使用：

- 清理每个数据块（`sanitizeText`）
- 跟踪总行数/输出行数和字节数
- 可选的工件溢出文件（`artifactPath`、`artifactId`）
- 当内存缓冲区超过阈值时（`DEFAULT_MAX_BYTES`，除非被覆盖）：
  - 标记为已截断
  - 在内存中保留尾部字节（UTF-8 安全边界）
  - 可将完整流溢出到工件接收器

`dump()` 返回：

- 可见输出文本（可能经过尾部截断）
- 截断标志 + 计数
- 工件 ID（用于 `artifact://<id>` 引用）

`python` 工具将此元数据转换为结果截断通知和 TUI 警告。

`notebook` 工具**不使用** `OutputSink`；它没有流/工件截断管道，因为它不执行代码。

## 7) 渲染器假设和格式化

## Notebook 渲染器（`notebookToolRenderer`）

- 调用视图：包含操作 + notebook 路径 + 单元格/类型元数据的状态行
- 结果视图：
  - 从 `details` 派生的成功摘要
  - `cellSource` 通过 `renderCodeCell` 渲染
  - markdown 单元格设置语言提示为 `markdown`；其他单元格没有显式语言覆盖
  - 折叠代码预览限制为 `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - 通过共享渲染选项支持展开模式
  - 使用按宽度 + 展开状态为键的渲染缓存

错误渲染假设：

- 如果第一个文本内容以 `Error:` 开头，渲染器将其格式化为 notebook 错误块。

## Python 渲染器（用于实际执行输出）

内核支持的执行渲染期望：

- 每个单元格的状态转换（`pending/running/complete/error`）
- 可选的结构化状态事件部分
- 可选的 JSON 输出树
- 截断警告 + 可选的 `artifact://<id>` 指针

此渲染器行为与 `notebook` JSON 编辑结果无关，只是两者都复用共享的 TUI 基础组件。

## 8) 与纯 Python 工具行为的差异

如果"纯 Python 工具"指的是 `python` 执行路径：

- `python` 在内核中执行代码，按模式持久化状态，流式传输数据块，捕获富显示，处理中断/超时，并支持输出截断/工件。
- `notebook` 仅执行确定性的 notebook JSON 变更；无执行、无内核状态、无数据块流、无显示输出、无工件管道。

如果工作流需要两者兼备：

1. 使用 `notebook` 编辑 notebook 源代码
2. 通过 `python`（手动传递代码）执行代码单元格，而非通过 `notebook`

当前实现不提供单一工具来同时变更 `.ipynb` 并通过内核上下文执行 notebook 单元格。
