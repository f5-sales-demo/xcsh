---
title: Bash 工具运行时
description: >-
  Bash tool runtime with shell process management, sandboxing, timeout, and
  output streaming.
sidebar:
  order: 1
  label: Bash 工具
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Bash 工具运行时

本文档描述了 agent 工具调用所使用的 **`bash` 工具**运行时路径，涵盖从命令规范化到执行、截断/产物（artifacts）以及渲染的完整流程。

文档还指出了在交互式 TUI、打印模式、RPC 模式以及用户发起的感叹号（`!`）shell 执行中行为存在差异的地方。

## 作用域和运行时表面

coding-agent 中有两个不同的 bash 执行表面：

1. **工具调用表面**（`toolName: "bash"`）：当模型调用 bash 工具时使用。
   - 入口点：`BashTool.execute()`。
2. **用户感叹号命令表面**（交互式输入中的 `!cmd` 或 RPC `bash` 命令）：会话级辅助路径。
   - 入口点：`AgentSession.executeBash()`。

两者最终都使用 `src/exec/bash-executor.ts` 中的 `executeBash()` 进行非 PTY 执行，但只有工具调用路径会运行规范化/拦截和工具渲染器逻辑。

## 端到端工具调用管线

## 1) 输入规范化和参数合并

`BashTool.execute()` 首先通过 `normalizeBashCommand()` 规范化原始命令：

- 提取尾部的 `| head -n N`、`| head -N`、`| tail -n N`、`| tail -N` 并转为结构化限制，
- 去除首尾空白，
- 保留内部空白不变。

然后将提取的限制与显式工具参数合并：

- 显式 `head`/`tail` 参数覆盖提取的值，
- 提取的值仅作为后备。

### 注意事项

`bash-normalize.ts` 中的注释提到会去除 `2>&1`，但当前实现并未将其移除。运行时行为仍然正确（stdout/stderr 已经合并），但规范化行为比注释所描述的范围更窄。

## 2) 可选拦截（命令阻止路径）

如果 `bashInterceptor.enabled` 为 true，`BashTool` 会从设置中加载规则，并对规范化后的命令运行 `checkBashInterception()`。

拦截行为：

- 命令**仅在**以下条件同时满足时被阻止：
  - 正则表达式规则匹配，且
  - 建议的工具存在于 `ctx.toolNames` 中。
- 无效的正则表达式规则会被静默跳过。
- 阻止时，`BashTool` 抛出 `ToolError`，消息为：
  - `Blocked: ...`
  - 包含原始命令。

默认规则模式（在代码中定义）针对常见的误用：

- 文件读取工具（`cat`、`head`、`tail` 等）
- 搜索工具（`grep`、`rg` 等）
- 文件查找工具（`find`、`fd` 等）
- 就地编辑器（`sed -i`、`perl -i`、`awk -i inplace`）
- shell 重定向写入（`echo ... > file`、heredoc 重定向）

### 注意事项

`InterceptionResult` 包含 `suggestedTool`，但 `BashTool` 当前仅暴露消息文本（`details` 中没有结构化的建议工具字段）。

## 3) CWD 验证和超时限制

`cwd` 相对于会话 cwd（`resolveToCwd`）解析，然后通过 `stat` 验证：

- 路径不存在 -> `ToolError("Working directory does not exist: ...")`
- 不是目录 -> `ToolError("Working directory is not a directory: ...")`

超时被限制在 `[1, 3600]` 秒范围内，并转换为毫秒。

## 4) 产物分配

在执行之前，工具为截断输出存储分配产物路径/ID（尽力而为）。

- 产物分配失败是非致命的（执行继续进行，不使用产物溢出文件），
- 产物 ID/路径传递到执行路径中，用于截断时的完整输出持久化。

## 5) PTY 与非 PTY 执行选择

`BashTool` 仅在以下条件全部为 true 时选择 PTY 执行：

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- 工具上下文有 UI（`ctx.hasUI === true` 且 `ctx.ui` 已设置）

否则使用非交互式 `executeBash()`。

这意味着打印模式和非 UI 的 RPC/工具上下文始终使用非 PTY。

## 非交互式执行引擎 (`executeBash`)

## Shell 会话复用模型

`executeBash()` 在进程全局映射中缓存原生 `Shell` 实例，键由以下内容组成：

- shell 路径，
- 配置的命令前缀，
- 快照路径，
- 序列化的 shell 环境变量，
- 可选的 agent 会话键。

对于会话级执行，`AgentSession.executeBash()` 传递 `sessionKey: this.sessionId`，将复用隔离到每个会话。

工具调用路径**不**传递 `sessionKey`，因此复用范围基于 shell 配置/快照/环境变量。

## Shell 配置和快照行为

每次调用时，执行器加载设置中的 shell 配置（`shell`、`env`、可选的 `prefix`）。

如果选择的 shell 包含 `bash`，它会尝试 `getOrCreateSnapshot()`：

- 快照从用户 rc 中捕获别名/函数/选项，
- 快照创建是尽力而为的，
- 失败时回退为无快照。

如果配置了 `prefix`，命令变为：

```text
<prefix> <command>
```

## 流式输出和取消

`Shell.run()` 将数据块流式传输到回调。执行器将每个数据块输送到 `OutputSink` 和可选的 `onChunk` 回调。

取消：

- abort 信号触发 `shellSession.abort(...)`，
- 原生结果中的超时映射为 `cancelled: true` + 注释文本，
- 显式取消同样返回 `cancelled: true` + 注释。

执行器内部不会因超时/取消抛出异常；它返回结构化的 `BashResult`，由调用方映射错误语义。

## 交互式 PTY 路径 (`runInteractiveBashPty`)

当 PTY 启用时，工具运行 `runInteractiveBashPty()`，该函数打开一个覆盖层控制台组件并驱动一个原生 `PtySession`。

行为要点：

- xterm-headless 虚拟终端在覆盖层中渲染视口，
- 键盘输入被规范化（包括 Kitty 序列和应用光标模式处理），
- 运行时按 `esc` 会终止 PTY 会话，
- 终端尺寸变化传播到 PTY（`session.resize(cols, rows)`）。

为无人值守运行注入环境硬化默认值：

- 禁用分页器（`PAGER=cat`、`GIT_PAGER=cat` 等），
- 禁用编辑器提示（`GIT_EDITOR=true`、`EDITOR=true` 等），
- 减少终端/认证提示（`GIT_TERMINAL_PROMPT=0`、`SSH_ASKPASS=/usr/bin/false`、`CI=1`），
- 包管理器/工具的非交互行为自动化标志。

PTY 输出被规范化（`CRLF`/`CR` 转为 `LF`、`sanitizeText`）并写入 `OutputSink`，包括产物溢出支持。

PTY 启动/运行时错误时，sink 接收 `PTY error: ...` 行，命令以未定义的退出码结束。

## 输出处理：流式、截断、产物溢出

PTY 和非 PTY 路径都使用 `OutputSink`。

## OutputSink 语义

- 保持一个内存中的 UTF-8 安全尾部缓冲区（`DEFAULT_MAX_BYTES`，当前为 50KB），
- 跟踪已见的总字节数/行数，
- 如果产物路径存在且输出溢出（或文件已激活），将完整流写入产物文件，
- 当内存阈值溢出时，将内存缓冲区修剪为尾部（UTF-8 边界安全），
- 溢出/文件溢出发生时标记 `truncated`。

`dump()` 返回：

- `output`（可能带有注释前缀），
- `truncated`，
- `totalLines/totalBytes`，
- `outputLines/outputBytes`，
- 如果产物文件已激活则返回 `artifactId`。

### 长输出注意事项

运行时截断在 `OutputSink` 中基于字节阈值（默认 50KB）。在此代码路径中不强制执行硬性的 2000 行上限。

## 实时工具更新

对于非 PTY 执行，`BashTool` 使用单独的 `TailBuffer` 进行部分更新，并在命令运行期间发出 `onUpdate` 快照。

对于 PTY 执行，实时渲染由自定义 UI 覆盖层处理，而非通过 `onUpdate` 文本块。

## 结果整形、元数据和错误映射

执行后：

1. `cancelled` 处理：
   - 如果 abort 信号已中止 -> 抛出 `ToolAbortError`（中止语义），
   - 否则 -> 抛出 `ToolError`（视为工具失败）。
2. PTY `timedOut` -> 抛出 `ToolError`。
3. 对最终输出文本应用 head/tail 过滤（`applyHeadTail`，先 head 后 tail）。
4. 空输出变为 `(no output)`。
5. 通过 `toolResult(...).truncationFromSummary(result, { direction: "tail" })` 附加截断元数据。
6. 退出码映射：
   - 缺少退出码 -> `ToolError("... missing exit status")`
   - 非零退出 -> `ToolError("... Command exited with code N")`
   - 零退出 -> 成功结果。

成功负载结构：

- `content`：文本输出，
- 截断时包含 `details.meta.truncation`，包括：
  - `direction`、`truncatedBy`、总/输出行+字节计数，
  - `shownRange`，
  - 可用时包含 `artifactId`。

由于内置工具被 `wrapToolWithMetaNotice()` 包装，截断通知文本会自动附加到最终文本内容中（例如：`Full: artifact://<id>`）。

## 渲染路径

## 工具调用渲染器 (`bashToolRenderer`)

`bashToolRenderer` 用于工具调用消息（`toolCall` / `toolResult`）：

- 折叠模式显示视觉行截断的预览，
- 展开模式显示所有当前可用的输出文本，
- 警告行包含截断原因和截断时的 `artifact://<id>`，
- 超时值（来自参数）显示在底部元数据行中。

### 注意事项：完整产物展开

`BashRenderContext` 有 `isFullOutput`，但当前渲染器上下文构建器不会为 bash 工具结果设置它。展开视图仍然使用结果内容中已有的文本（尾部/截断输出），除非其他调用方提供完整的产物内容。

## 用户感叹号命令组件 (`BashExecutionComponent`)

`BashExecutionComponent` 用于交互模式中的用户 `!` 命令（非模型工具调用）：

- 实时流式传输数据块，
- 折叠预览保留最后 20 个逻辑行，
- 每行限制 4000 字符，
- 当存在元数据时显示截断 + 产物警告，
- 分别标记已取消/错误/退出状态。

此组件由 `CommandController.handleBashCommand()` 接入，数据来自 `AgentSession.executeBash()`。

## 模式特定的行为差异

| 表面 | 入口路径 | PTY 资格 | 实时输出 UX | 错误呈现 |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| 交互式工具调用 | `BashTool.execute` | 是，当 `bash.virtualTerminal=on` 且 UI 存在且 `PI_NO_PTY!=1` | PTY 覆盖层（交互式）或流式尾部更新 | 工具错误变为 `toolResult.isError` |
| 打印模式工具调用 | `BashTool.execute` | 否（无 UI 上下文） | 无 TUI 覆盖层；输出出现在事件流/最终助手文本流中 | 相同的工具错误映射 |
| RPC 工具调用（agent 工具） | `BashTool.execute` | 通常无 UI -> 非 PTY | 结构化工具事件/结果 | 相同的工具错误映射 |
| 交互式感叹号命令（`!`） | `AgentSession.executeBash` + `BashExecutionComponent` | 否（直接使用执行器） | 专用 bash 执行组件 | 控制器捕获异常并显示 UI 错误 |
| RPC `bash` 命令 | `rpc-mode` -> `session.executeBash` | 否 | 直接返回 `BashResult` | 消费方处理返回的字段 |

## 运维注意事项

- 拦截器仅在建议的工具当前在上下文中可用时才阻止命令。
- 如果产物分配失败，截断仍然发生，但没有可用的 `artifact://` 反向引用。
- Shell 会话缓存在此模块中没有显式驱逐策略；生命周期为进程作用域。
- PTY 和非 PTY 的超时表面不同：
  - PTY 暴露显式的 `timedOut` 结果字段，
  - 非 PTY 将超时映射为 `cancelled + annotation` 摘要。

## 实现文件

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — 工具入口点、规范化/拦截、PTY/非 PTY 选择、结果/错误映射、bash 工具渲染器。
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — 命令规范化和运行后 head/tail 过滤。
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — 拦截器规则匹配和命令阻止消息。
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — 非 PTY 执行器、shell 会话复用、取消接入、输出 sink 集成。
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — PTY 运行时、覆盖层 UI、输入规范化、非交互式环境默认值。
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink` 截断/产物溢出和摘要元数据。
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — 产物分配辅助函数和流式尾部缓冲区。
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — 截断元数据结构 + 通知注入包装器。
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — 会话级 `executeBash`、消息记录、中止生命周期。
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — 交互式 `!` 命令执行组件。
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — 交互式 `!` 命令 UI 流/更新完成的接入。
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — RPC `bash` 和 `abort_bash` 命令表面。
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://<id>` 解析。
