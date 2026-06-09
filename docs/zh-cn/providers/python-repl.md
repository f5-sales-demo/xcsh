---
title: Python 工具与 IPython 运行时
description: 基于 IPython 内核管理、执行和输出捕获的 Python REPL 工具运行时。
sidebar:
  order: 3
  label: Python 与 IPython
i18n:
  sourceHash: 70f0a034ecef
  translator: machine
---

# Python 工具与 IPython 运行时

本文档描述了 `packages/coding-agent` 中当前的 Python 执行栈。
涵盖工具行为、内核/网关生命周期、环境处理、执行语义、输出渲染以及运行故障模式。

## 范围与关键文件

- 工具接口：`src/tools/python.ts`
- 会话/按调用内核编排：`src/ipy/executor.ts`
- 内核协议 + 网关集成：`src/ipy/kernel.ts`
- 共享本地网关协调器：`src/ipy/gateway-coordinator.ts`
- 用户触发 Python 运行的交互模式渲染器：`src/modes/components/python-execution.ts`
- 运行时/环境过滤与 Python 解析：`src/ipy/runtime.ts`

## Python 工具是什么

`python` 工具通过 Jupyter Kernel Gateway 支持的内核执行一个或多个 Python 单元格（而非直接通过 `python -c` 逐单元格生成进程）。

工具参数：

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // 秒，限制在 1..600 之间，默认 30
  cwd?: string;
  reset?: boolean; // 仅在第一个单元格执行前重置内核
}
```

该工具在会话中为 `concurrency = "exclusive"`，因此调用不会重叠。

## 网关生命周期

### 模式

有两种网关路径：

1. **外部网关**（设置了 `PI_PYTHON_GATEWAY_URL`）
   - 直接使用配置的 URL。
   - 可选通过 `PI_PYTHON_GATEWAY_TOKEN` 进行认证。
   - 不会生成或管理本地网关进程。

2. **本地共享网关**（默认路径）
   - 使用在 `~/.xcsh/agent/python-gateway` 下协调的单个共享进程。
   - 元数据文件：`gateway.json`
   - 锁文件：`gateway.lock`
   - 启动命令：
     - `python -m kernel_gateway`
     - 绑定到 `127.0.0.1:<分配的端口>`
     - 启动健康检查：`GET /api/kernelspecs`

### 本地共享网关协调

`acquireSharedGateway()`：

- 使用带心跳的文件锁（`gateway.lock`）。
- 如果 PID 存活且健康检查通过，则复用 `gateway.json`。
- 在需要时清理过期的信息/PID。
- 当不存在健康的网关时启动新网关。

`releaseSharedGateway()` 当前为空操作（内核关闭不会销毁共享网关）。

`shutdownSharedGateway()` 会显式终止共享进程并清除网关元数据。

### 重要约束

`python.sharedGateway=false` 在内核启动时会被拒绝：

- 错误：`Shared Python gateway required; local gateways are disabled`
- 不存在每进程非共享的本地网关模式。

## 内核生命周期

每次执行使用通过所选网关的 `POST /api/kernels` 创建的内核。

内核启动序列：

1. 可用性检查（`checkPythonKernelAvailability`）
2. 创建内核（`/api/kernels`）
3. 打开 websocket（`/api/kernels/:id/channels`）
4. 初始化内核环境（`cwd`、环境变量、`sys.path`）
5. 执行 `PYTHON_PRELUDE`
6. 从以下位置加载扩展模块：
   - 用户级：`~/.xcsh/agent/modules/*.py`
   - 项目级：`<cwd>/.xcsh/modules/*.py`（覆盖同名用户模块）

内核关闭：

- 通过 `DELETE /api/kernels/:id` 删除远程内核
- 关闭 websocket
- 调用共享网关释放钩子（目前为空操作）

## 会话持久化语义

`python.kernelMode` 控制内核复用：

- `session`（默认）
  - 通过会话标识 + cwd 为键复用内核会话。
  - 每个会话的执行通过队列串行化。
  - 空闲会话在 5 分钟后被驱逐。
  - 最多 4 个会话；溢出时驱逐最旧的会话。
  - 心跳检查检测失效内核。
  - 允许自动重启一次；重复崩溃 => 硬性失败。

- `per-call`
  - 每个执行请求创建全新内核。
  - 请求完成后关闭内核。
  - 跨调用无状态持久化。

### 单次工具调用中的多单元格行为

在该工具调用的同一内核实例中，单元格按顺序执行。

如果中间某个单元格失败：

- 之前单元格的状态保留在内存中。
- 工具返回指明哪个单元格失败的定向错误。
- 后续单元格不会被执行。

`reset=true` 仅适用于该调用中的第一个单元格执行。

## 环境过滤与运行时解析

在启动网关/内核运行时之前会过滤环境：

- 允许列表包含核心变量，如 `PATH`、`HOME`、区域设置变量、`VIRTUAL_ENV`、`PYTHONPATH` 等。
- 允许前缀：`LC_`、`XDG_`、`PI_`
- 拒绝列表剥离常见 API 密钥（OpenAI/Anthropic/Gemini 等）

运行时选择顺序：

1. 激活的/已定位的 venv（`VIRTUAL_ENV`，然后 `<cwd>/.venv`、`<cwd>/venv`）
2. 位于 `~/.xcsh/python-env` 的托管 venv
3. PATH 上的 `python` 或 `python3`

选择 venv 后，其 bin/Scripts 路径会被前置到 `PATH`。

Python 内部的内核环境初始化还包括：

- `os.chdir(cwd)`
- 将提供的环境映射注入 `os.environ`
- 确保 cwd 在 `sys.path` 中

## 工具可用性与模式选择

`python.toolMode`（默认 `both`）+ 可选的 `PI_PY` 覆盖控制暴露方式：

- `ipy-only`
- `bash-only`
- `both`

`PI_PY` 接受的值：

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

如果 Python 预检失败，该会话的工具创建会降级为仅 bash 模式。

## 执行流程与取消/超时

### 工具级超时

`python` 工具超时以秒为单位，默认 30，限制在 `1..600` 之间。

该工具组合了：

- 调用者中止信号
- 超时中止信号

通过 `AbortSignal.any(...)` 实现。

### 内核执行取消

在中止/超时时：

- 执行被标记为已取消。
- 尝试通过 REST（`POST /interrupt`）和控制通道 `interrupt_request` 中断内核。
- 结果包含 `cancelled=true`。
- 超时路径将输出标注为 `Command timed out after <n> seconds`。

### stdin 行为

不支持交互式 stdin。

如果内核发出 `input_request`：

- 工具记录 `stdinRequested=true`
- 发出说明性文本
- 发送空 `input_reply`
- 执行在执行器层被视为失败

## 输出捕获与渲染

### 捕获的输出类型

来自内核消息：

- `stream` -> 纯文本块
- `display_data`/`execute_result` -> 富显示处理
- `error` -> 回溯文本
- 自定义 MIME `application/x-xcsh-status` -> 结构化状态事件

显示 MIME 优先级：

1. `text/markdown`
2. `text/plain`
3. `text/html`（转换为基本 markdown）

另外作为结构化输出捕获：

- `application/json` -> JSON 树数据
- `image/png` -> 图像负载
- `application/x-xcsh-status` -> 状态事件

### 存储与截断

输出通过 `OutputSink` 流式传输，可能被持久化到工件存储中。

工具结果可包含截断元数据和用于完整输出恢复的 `artifact://<id>`。

### 渲染器行为

- 工具渲染器（`python.ts`）：
  - 显示带有每个单元格状态的代码单元格块
  - 折叠预览默认显示 10 行
  - 支持展开模式以显示完整输出和更丰富的状态详情
- 交互式渲染器（`python-execution.ts`）：
  - 用于 TUI 中用户触发的 Python 执行
  - 折叠预览默认显示 20 行
  - 为显示安全将过长的单行限制为 4000 个字符
  - 显示取消/错误/截断通知

## 外部网关支持

设置：

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# 可选：
export PI_PYTHON_GATEWAY_TOKEN="..."
```

与本地共享网关的行为差异：

- 无本地网关锁/信息文件
- 无本地进程生成/终止
- 健康检查和内核 CRUD 针对外部端点运行
- 认证失败会显示明确的令牌指导信息

## 运维故障排除（当前故障模式）

- **Python 工具不可用**
  - 检查 `python.toolMode` / `PI_PY`。
  - 如果预检失败，运行时会回退到仅 bash 模式。

- **内核可用性错误**
  - 本地模式要求在解析的 Python 运行时中 `kernel_gateway` 和 `ipykernel` 均可导入。
  - 安装方式：

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` 导致启动失败**
  - 在当前实现中这是预期行为。

- **外部网关认证/可达性失败**
  - 401/403 -> 设置 `PI_PYTHON_GATEWAY_TOKEN`。
  - 超时/不可达 -> 验证 URL/网络以及网关健康状态。

- **执行挂起后超时**
  - 如果工作负载合理，可增加工具 `timeout`（最大 600 秒）。
  - 对于卡住的代码，取消操作会触发内核中断，但用户代码可能仍需重构。

- **Python 代码中的 stdin/输入提示**
  - `input()` 在此运行时路径中不支持交互式使用；请以编程方式传递数据。

- **资源耗尽（`EMFILE` / 打开文件过多）**
  - 会话管理器触发共享网关恢复（会话拆除 + 共享网关重启）。

- **工作目录错误**
  - 工具在执行前验证 `cwd` 存在且为目录。

## 相关环境变量

- `PI_PY` — 工具暴露覆盖（上述 `bash-only`/`ipy-only`/`both` 映射）
- `PI_PYTHON_GATEWAY_URL` — 使用外部网关
- `PI_PYTHON_GATEWAY_TOKEN` — 可选的外部网关认证令牌
- `PI_PYTHON_SKIP_CHECK=1` — 跳过 Python 预检/预热检查
- `PI_PYTHON_IPC_TRACE=1` — 记录内核 IPC 发送/接收跟踪
- `PI_DEBUG_STARTUP=1` — 输出启动阶段调试标记
