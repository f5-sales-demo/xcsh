---
title: TTSR 注入生命周期
description: TTSR（tool-use、tool-result、system-reminder）上下文管理的注入生命周期。
sidebar:
  order: 9
  label: TTSR 注入
i18n:
  sourceHash: d6179a286584
  translator: machine
---

# TTSR 注入生命周期

本文档涵盖了当前时间旅行流规则（TTSR）从规则发现到流中断、重试注入、扩展通知以及会话状态处理的完整运行时路径。

## 实现文件

- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/export/ttsr.ts`](../../packages/coding-agent/src/export/ttsr.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/prompts/system/ttsr-interrupt.md`](../../packages/coding-agent/src/prompts/system/ttsr-interrupt.md)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/types.ts`](../../packages/coding-agent/src/extensibility/extensions/types.ts)
- [`../src/extensibility/hooks/types.ts`](../../packages/coding-agent/src/extensibility/hooks/types.ts)
- [`../src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)

## 1. 发现源与规则注册

在会话创建时，`createAgentSession()` 加载所有已发现的规则并构造一个 `TtsrManager`：

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### 注册前去重行为

`loadCapability("rules")` 按 `rule.name` 进行去重，采用先到先得语义（优先级较高的提供者优先）。被遮蔽的重复项在 TTSR 注册前即被移除。

### `TtsrManager.addRule()` 行为

在以下情况下会跳过注册：

- `rule.ttsrTrigger` 不存在
- 该管理器中已注册了相同 `rule.name` 的规则
- 正则表达式编译失败（`new RegExp(rule.ttsrTrigger)` 抛出异常）

无效的正则触发器会以警告形式记录并被忽略；会话启动继续进行。

### 设置注意事项

`TtsrSettings.enabled` 会加载到管理器中，但当前在运行时门控中未进行检查。如果存在规则，匹配仍然会执行。

## 2. 流监控生命周期

TTSR 检测在 `AgentSession.#handleAgentEvent` 内部运行。

### 回合开始

在 `turn_start` 时，流缓冲区被重置：

- `ttsrManager.resetBuffer()`

### 流传输期间（`message_update`）

当助手更新到达且存在规则时：

- 监控 `text_delta` 和 `toolcall_delta`
- 将增量数据追加到管理器缓冲区
- 调用 `check(buffer)`

`check()` 遍历已注册的规则，返回所有通过重复策略（`#canTrigger`）的匹配规则。

## 3. 触发决策与立即中止路径

当一个或多个规则匹配时：

1. `markInjected(matches)` 在管理器注入状态中记录规则名称。
2. 匹配的规则被排入 `#pendingTtsrInjections` 队列。
3. `#ttsrAbortPending = true`。
4. 立即调用 `agent.abort()`。
5. 异步发出 `ttsr_triggered` 事件（发送即忘）。
6. 通过 `setTimeout(..., 50)` 调度重试工作。

中止不会等待扩展回调完成。

## 4. 重试调度、上下文模式与提醒注入

在 50ms 超时之后：

1. `#ttsrAbortPending = false`
2. 读取 `ttsrManager.getSettings().contextMode`
3. 如果 `contextMode === "discard"`，使用 `agent.popMessage()` 丢弃部分助手输出
4. 使用 `ttsr-interrupt.md` 模板从待处理规则构建注入内容
5. 追加一条合成用户消息，每个规则包含一个 `<system-interrupt ...>` 块
6. 调用 `agent.continue()` 重试生成

模板有效载荷为：

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

内容生成后清除待处理的注入。

### `contextMode` 对部分输出的行为

- `discard`：重试前移除部分/中止的助手消息。
- `keep`：部分助手输出保留在对话状态中；提醒在其之后追加。

## 5. 重复策略与间隔逻辑

`TtsrManager` 跟踪 `#messageCount` 和每个规则的 `lastInjectedAt`。

### `repeatMode: "once"`

规则在有注入记录后只能触发一次。

### `repeatMode: "after-gap"`

规则只有在以下条件满足时才能重新触发：

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` 在 `turn_end` 时递增，因此间隔以已完成的回合数而非流分块来衡量。

## 6. 事件发出与扩展/钩子接口

### 会话事件

`AgentSessionEvent` 包括：

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### 扩展运行器

`#emitSessionEvent()` 将事件路由至：

- 扩展监听器（`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`）
- 本地会话订阅者

### 钩子与自定义工具类型

- 扩展 API 暴露 `on("ttsr_triggered", ...)`
- 钩子 API 暴露 `on("ttsr_triggered", ...)`
- 自定义工具接收 `onSession({ reason: "ttsr_triggered", rules })`

### 交互模式渲染差异

交互模式使用 `session.isTtsrAbortPending` 在 TTSR 中断期间抑制将中止的助手停止原因显示为可见的失败，并在事件到达时渲染 `TtsrNotificationComponent`。

## 7. 持久化与恢复状态（当前实现）

`SessionManager` 对注入规则的持久化具有完整的 schema 支持：

- 条目类型：`ttsr_injection`
- 追加 API：`appendTtsrInjection(ruleNames)`
- 查询 API：`getInjectedTtsrRules()`
- 上下文重建包含 `SessionContext.injectedTtsrRules`

`TtsrManager` 也支持通过 `restoreInjected(ruleNames)` 进行恢复。

### 当前连接状态

在当前运行时路径中：

- `AgentSession` 在 TTSR 触发时不会追加 `ttsr_injection` 条目。
- `createAgentSession()` 不会将 `existingSession.injectedTtsrRules` 恢复回 `ttsrManager`。

实际效果：注入规则的抑制在活跃进程中通过内存强制执行，但当前在会话重载/恢复路径中不会持久化/恢复。

## 8. 竞态边界与顺序保证

### 中止 vs 重试回调

- 从 TTSR 处理器的角度来看，中止是同步的（立即调用 `agent.abort()`）
- 重试通过定时器延迟（`50ms`）
- 扩展通知是异步的，在中止/重试调度之前有意不等待其完成

### 同一流窗口内的多个匹配

`check()` 返回所有当前匹配的符合条件的规则。它们在下一条重试消息中作为批次注入。

### 中止与继续之间

在定时器窗口期间，状态可能发生变化（用户中断、模式操作、额外事件）。重试调用采用尽力而为策略：`agent.continue().catch(() => {})` 会吞掉后续错误。

## 9. 边界情况总结

- 无效的 `ttsr_trigger` 正则表达式：以警告跳过；其他规则继续执行。
- 能力层的重复规则名称：低优先级的重复项在注册前被遮蔽。
- 管理器层的重复名称：第二次注册被忽略。
- `contextMode: "keep"`：部分违规输出可能在提醒重试前保留在上下文中。
- 间隔重复（repeat-after-gap）依赖于 `turn_end` 时的回合计数递增；回合中的流分块不会推进间隔计数器。
