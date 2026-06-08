---
title: TUI 运行时内部机制
description: 终端 UI 运行时内部机制，涵盖渲染管线、输入处理和状态管理。
sidebar:
  order: 2
  label: 运行时内部机制
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# TUI 运行时内部机制

本文档描述了在交互模式下，从终端输入到渲染输出的非主题运行时路径。重点关注 `packages/tui` 中的行为及其与 `packages/coding-agent` 控制器的集成方式。

## 运行时层次与职责划分

- **`packages/tui` 引擎**：终端生命周期、stdin 规范化、焦点路由、渲染调度、差分绘制、叠加层合成、硬件光标定位。
- **`packages/coding-agent` 交互模式**：构建组件树、绑定编辑器回调和键位映射、响应 agent/会话事件，并将领域状态（流式传输、工具执行、重试、计划模式）转换为 UI 组件。

边界规则：TUI 引擎与消息内容无关。它只关注 `Component.render(width)`、`handleInput(data)`、焦点和叠加层。Agent 语义保留在交互控制器中。

## 实现文件

- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/components/custom-editor.ts`](../../packages/coding-agent/src/modes/components/custom-editor.ts)
- [`../../tui/src/tui.ts`](../../packages/tui/src/tui.ts)
- [`../../tui/src/terminal.ts`](../../packages/tui/src/terminal.ts)
- [`../../tui/src/editor-component.ts`](../../packages/tui/src/editor-component.ts)
- [`../../tui/src/stdin-buffer.ts`](../../packages/tui/src/stdin-buffer.ts)
- [`../../tui/src/components/loader.ts`](../../packages/tui/src/components/loader.ts)

## 启动与组件树组装

`InteractiveMode` 构造 `TUI(new ProcessTerminal(), showHardwareCursor)` 并创建持久化容器：

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer`（包含 `CustomEditor`）

`init()` 按上述顺序连接组件树，聚焦编辑器，通过 `InputController` 注册输入处理器，启动 TUI，并请求强制渲染。

强制渲染（`requestRender(true)`）会在重绘之前重置前一行缓存和光标记录。

## 终端生命周期与 stdin 规范化

`ProcessTerminal.start()`：

1. 启用原始模式和括号粘贴模式。
2. 附加窗口大小变化处理器。
3. 创建 `StdinBuffer`，将不完整的转义序列片段拆分为完整序列。
4. 查询 Kitty 键盘协议支持（`CSI ? u`），如果支持则启用协议标志。
5. 在 Windows 上，尝试通过 `kernel32` 模式标志启用 VT 输入。

`StdinBuffer` 行为：

- 缓冲碎片化的转义序列（CSI/OSC/DCS/APC/SS3）。
- 仅在序列完整或超时刷新时触发 `data` 事件。
- 检测括号粘贴并以原始粘贴文本触发 `paste` 事件。

这可以防止不完整的转义序列片段被错误解释为普通按键。

## 输入路由与焦点模型

输入路径：

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

路由详情：

1. TUI 首先运行已注册的输入监听器（`addInputListener`），允许消费/转换行为。
2. TUI 在组件分发之前处理全局调试快捷键（`shift+ctrl+d`）。
3. 如果聚焦组件所属的叠加层当前已隐藏/不可见，TUI 会将焦点重新分配给下一个可见的叠加层或之前保存的叠加层前焦点。
4. 除非聚焦组件设置了 `wantsKeyRelease = true`，否则按键释放事件会被过滤。
5. 分发后，TUI 调度渲染。

`setFocus()` 还会切换 `Focusable.focused` 状态，该状态控制组件是否为硬件光标定位发出 `CURSOR_MARKER`。

## 按键处理分工：编辑器与控制器

`CustomEditor` 首先拦截高优先级组合键（escape、ctrl-c/d/z、ctrl-v、ctrl-p 变体、ctrl-t、alt-up、扩展自定义键），其余委托给基础 `Editor` 行为（文本编辑、历史记录、自动补全、光标移动）。

随后 `InputController.setupKeyHandlers()` 将编辑器回调绑定到模式操作：

- `Escape` 取消/退出模式
- 双击 `Ctrl+C` 或空编辑器 `Ctrl+D` 关闭
- `Ctrl+Z` 挂起/恢复
- 斜杠命令和选择器快捷键
- 后续/出队切换和展开切换

这使得按键解析/编辑器机制保留在 `packages/tui` 中，而模式语义保留在 coding-agent 控制器中。

## 渲染循环与差分策略

`TUI.requestRender()` 使用 `process.nextTick` 进行去抖，每个 tick 最多执行一次渲染。同一轮中的多个状态变更会被合并。

`#doRender()` 管线：

1. 将根组件树渲染为 `newLines`。
2. 合成可见的叠加层（如果有）。
3. 从可见视口行中提取并剥离 `CURSOR_MARKER`。
4. 为非图像行追加段重置后缀。
5. 选择全量重绘或差分补丁：
   - 首帧
   - 宽度变化
   - 启用 `clearOnShrink` 且无叠加层时的收缩
   - 前一视口上方的编辑
6. 差分更新时，仅修补已变更的行范围，并在需要时清除过期的尾部行。
7. 重新定位硬件光标以支持 IME。

渲染写入使用同步输出模式（`CSI ? 2026 h/l`）以减少闪烁/撕裂。

## 渲染安全约束

`TUI` 中的关键安全检查：

- 非图像渲染行不得超过终端宽度；溢出会抛出异常并写入崩溃诊断信息。
- 叠加层合成包含防御性截断和合成后宽度验证。
- 宽度变化强制全量重绘，因为换行语义会改变。
- 光标位置在移动前会被限制在有效范围内。

这些约束是运行时强制执行的，而不仅仅是约定。

## 窗口大小变化处理

窗口大小变化事件从 `ProcessTerminal` 事件驱动传递到 `TUI.requestRender()`。

影响：

- 任何宽度变化都会触发全量重绘。
- 视口/顶部跟踪（`#previousViewportTop`、`#maxLinesRendered`）避免了内容或终端尺寸变化时无效的相对光标计算。
- 叠加层可见性可能依赖终端尺寸（`OverlayOptions.visible`）；当叠加层在窗口大小变化后变为不可见时，焦点会被修正。

## 流式传输与增量 UI 更新

`EventController` 订阅 `AgentSessionEvent` 并增量更新 UI：

- `agent_start`：在 `statusContainer` 中启动加载器。
- `message_start` assistant：创建 `streamingComponent` 并挂载。
- `message_update`：更新流式助手内容；在工具调用出现时创建/更新工具执行组件。
- `tool_execution_update/end`：更新工具结果组件和完成状态。
- `message_end`：完成助手流，处理中止/错误注解，在正常停止时标记待处理的工具参数完成。
- `agent_end`：停止加载器，清除临时流状态，刷新延迟的模型切换，如果处于后台则发出完成通知。

读取工具分组是有意为有状态的（`#lastReadGroup`），将连续的读取工具调用合并为一个视觉块，直到出现非读取中断。

## 状态栏与加载器编排

状态栏职责划分：

- `statusContainer` 持有临时加载器（`loadingAnimation`、`autoCompactionLoader`、`retryLoader`）。
- `statusLine` 渲染持久状态/钩子/计划指示器，并驱动编辑器顶部边框更新。

加载器行为：

- `Loader` 通过定时器每 80ms 更新一次，每帧请求渲染。
- 在自动压缩和自动重试期间，Escape 处理器会被临时覆盖以取消这些操作。
- 在结束/取消路径上，控制器恢复之前的 Escape 处理器并停止/清除加载器组件。

## 模式切换与后台运行

### Bash/Python 输入模式

输入文本前缀切换编辑器边框模式标志：

- `!` -> bash 模式
- `$`（非模板字面量前缀）-> python 模式

Escape 通过清除编辑器文本和恢复边框颜色退出非活动模式；当执行处于活动状态时，Escape 会中止正在运行的任务。

### 计划模式

`InteractiveMode` 跟踪计划模式标志、状态栏状态、活动工具和模型切换。进入/退出会更新会话模式条目和状态/UI 状态，包括在流式传输活动时的延迟模型切换。

### 挂起/恢复（`Ctrl+Z`）

`InputController.handleCtrlZ()`：

1. 注册一次性 `SIGCONT` 处理器以重启 TUI 并强制渲染。
2. 挂起前停止 TUI。
3. 向进程组发送 `SIGTSTP`。

### 后台模式（`/background` 或 `/bg`）

`handleBackgroundCommand()`：

- 空闲时拒绝执行。
- 将工具 UI 上下文切换为非交互式（`hasUI=false`），使交互式 UI 工具快速失败。
- 停止加载器/状态栏并取消订阅前台事件处理器。
- 订阅后台事件处理器（主要等待 `agent_end`）。
- 停止 TUI 并发送 `SIGTSTP`（POSIX 作业控制路径）。

在后台收到 `agent_end` 且无排队工作时，控制器发送完成通知并关闭。

## 取消路径

主要取消输入：

- 活动流加载器期间按 `Escape`：将排队消息恢复到编辑器并中止 agent。
- bash/python 执行期间按 `Escape`：中止正在运行的命令。
- 自动压缩/重试期间按 `Escape`：通过临时 Escape 处理器调用专用中止方法。
- 单次按 `Ctrl+C`：清除编辑器；500ms 内双击：关闭。

取消是状态条件相关的；同一按键可能意味着中止、模式退出、选择器触发或空操作，取决于运行时状态。

## 事件驱动与节流行为

事件驱动更新：

- Agent 会话事件（`EventController`）
- 按键输入回调（`InputController`）
- 终端窗口大小变化回调
- `InteractiveMode` 中的主题/分支监视器

节流/去抖路径：

- TUI 渲染按 tick 去抖（`requestRender` 合并）。
- 加载器动画为固定间隔（80ms），每帧请求渲染。
- 编辑器自动补全更新（在 `Editor` 内部）使用去抖计时器，减少输入过程中的重复计算。

因此，运行时将事件驱动的状态转换与有界的渲染节奏相结合，在保持交互响应性的同时避免重绘风暴。
