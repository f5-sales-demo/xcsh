---
title: SDK
description: 用于在 xcsh 编程代理运行时之上构建自定义代理和集成的 SDK。
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

SDK 是 `@f5xc-salesdemos/xcsh` 的进程内集成接口。
当您需要从自己的 Bun/Node 进程直接访问代理状态、事件流、工具连接和会话控制时，请使用它。

如果您需要跨语言/进程隔离，请改用 RPC 模式。

## 安装

```bash
bun add @f5xc-salesdemos/xcsh
```

## 入口点

`@f5xc-salesdemos/xcsh` 从包根目录导出 SDK API（也可以通过 `@f5xc-salesdemos/xcsh/sdk` 导出）。

面向嵌入者的核心导出：

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- 发现辅助函数（`discoverExtensions`、`discoverSkills`、`discoverContextFiles`、`discoverPromptTemplates`、`discoverSlashCommands`、`discoverCustomTSCommands`、`discoverMCPServers`）
- 工具工厂接口（`createTools`、`BUILTIN_TOOLS`、工具类）

## 快速开始（自动发现默认值）

```ts
import { createAgentSession } from "@f5xc-salesdemos/xcsh";

const { session, modelFallbackMessage } = await createAgentSession();

if (modelFallbackMessage) {
 process.stderr.write(`${modelFallbackMessage}\n`);
}

const unsubscribe = session.subscribe(event => {
 if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
  process.stdout.write(event.assistantMessageEvent.delta);
 }
});

await session.prompt("Summarize this repository in 3 bullets.");
unsubscribe();
await session.dispose();
```

## `createAgentSession()` 默认发现的内容

`createAgentSession()` 遵循"提供则覆盖，省略则发现"的原则。

如果省略，它会解析：

- `cwd`：`getProjectDir()`
- `agentDir`：`~/.xcsh/agent`（通过 `getAgentDir()`）
- `authStorage`：`discoverAuthStorage(agentDir)`
- `modelRegistry`：`new ModelRegistry(authStorage)` + `await refresh()`
- `settings`：`await Settings.init({ cwd, agentDir })`
- `sessionManager`：`SessionManager.create(cwd)`（基于文件）
- skills/context files/prompt templates/slash commands/extensions/custom TS commands
- 通过 `createTools(...)` 获取内置工具
- MCP 工具（默认启用）
- LSP 集成（默认启用）

### 必需输入与可选输入

通常您只需提供想要控制的部分：

- **必须提供**：最小会话无需任何内容
- **嵌入者通常需要显式提供**：
    - `sessionManager`（如果需要内存模式或自定义位置）
    - `authStorage` + `modelRegistry`（如果您自行管理凭据/模型生命周期）
    - `model` 或 `modelPattern`（如果确定性模型选择很重要）
    - `settings`（如果需要隔离/测试配置）

## 会话管理器行为（持久化 vs 内存）

`AgentSession` 始终使用 `SessionManager`；行为取决于您使用的工厂方法。

### 基于文件（默认）

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absolute .jsonl path
```

- 将对话/消息/状态增量持久化到会话文件。
- 支持恢复/打开/列表/分叉工作流。
- `session.sessionFile` 有定义值。

### 内存模式

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- 无文件系统持久化。
- 适用于测试、临时工作进程、请求作用域代理。
- 会话方法仍然可用，但持久化相关的行为（文件恢复/分叉路径）自然受限。

### 恢复/打开/列表辅助函数

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## 模型和认证连接

`createAgentSession()` 使用 `ModelRegistry` + `AuthStorage` 进行模型选择和 API 密钥解析。

### 显式连接

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
} from "@f5xc-salesdemos/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const available = modelRegistry.getAvailable();
if (available.length === 0) throw new Error("No authenticated models available");

const { session } = await createAgentSession({
 authStorage,
 modelRegistry,
 model: available[0],
 thinkingLevel: "medium",
 sessionManager: SessionManager.inMemory(),
});
```

### 省略 `model` 时的选择顺序

当未提供显式的 `model`/`modelPattern` 时：

1. 从现有会话恢复模型（如果可恢复且密钥可用）
2. 设置中的默认模型角色（`default`）
3. 第一个具有有效认证的可用模型

如果恢复失败，`modelFallbackMessage` 会说明回退原因。

### 认证优先级

`AuthStorage.getApiKey(...)` 按以下顺序解析：

1. 运行时覆盖（`setRuntimeApiKey`）
2. 存储在 `agent.db` 中的凭据
3. 提供商环境变量
4. 自定义提供商解析器回退（如果已配置）

## 事件订阅模型

使用 `session.subscribe(listener)` 订阅；它返回一个取消订阅函数。

```ts
const unsubscribe = session.subscribe(event => {
 switch (event.type) {
  case "agent_start":
  case "turn_start":
  case "tool_execution_start":
   break;
  case "message_update":
   if (event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
   }
   break;
 }
});
```

`AgentSessionEvent` 包含核心 `AgentEvent` 以及会话级事件：

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## 提示生命周期

`session.prompt(text, options?)` 是主要入口点。

行为：

1. 可选的命令/模板展开（`/` 命令、自定义命令、文件斜杠命令、提示模板）
2. 如果当前正在流式传输：
    - 需要 `streamingBehavior: "steer" | "followUp"`
    - 排队而不是丢弃工作
3. 如果空闲：
    - 验证模型 + API 密钥
    - 追加用户消息
    - 启动代理轮次

相关 API：

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## 工具和扩展集成

### 内置工具和过滤

- 内置工具来自 `createTools(...)` 和 `BUILTIN_TOOLS`。
- `toolNames` 作为内置工具的允许列表。
- `customTools` 和扩展注册的工具仍然包含在内。
- 隐藏工具（例如 `submit_result`）除非选项要求，否则需要显式启用。

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### 扩展

- `extensions`：内联 `ExtensionFactory[]`
- `additionalExtensionPaths`：加载额外的扩展文件
- `disableExtensionDiscovery`：禁用自动扩展扫描
- `preloadedExtensions`：重用已加载的扩展集

### 运行时工具集更改

`AgentSession` 支持运行时激活更新：

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

系统提示会重新构建以反映活动工具的更改。

## 发现辅助函数

当您需要部分控制而不想重新创建内部发现逻辑时，请使用这些函数：

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## 面向子代理的选项

适用于构建编排器的 SDK 消费者（类似于任务执行器流程）：

- `outputSchema`：将结构化输出期望传递到工具上下文中
- `requireSubmitResultTool`：强制包含 `submit_result` 工具
- `taskDepth`：嵌套任务会话的递归深度上下文
- `parentTaskPrefix`：嵌套任务输出的工件命名前缀

这些对于普通的单代理嵌入是可选的。

## `createAgentSession()` 返回值

```ts
type CreateAgentSessionResult = {
 session: AgentSession;
 extensionsResult: LoadExtensionsResult;
 setToolUIContext: (uiContext: ExtensionUIContext, hasUI: boolean) => void;
 mcpManager?: MCPManager;
 modelFallbackMessage?: string;
 lspServers?: Array<{ name: string; status: "ready" | "error"; fileTypes: string[]; error?: string }>;
};
```

仅当您的嵌入器提供工具/扩展应调用的 UI 功能时，才使用 `setToolUIContext(...)`。

## 最小受控嵌入示例

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
 Settings,
} from "@f5xc-salesdemos/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const settings = Settings.isolated({
 "compaction.enabled": true,
 "retry.enabled": true,
});

const { session } = await createAgentSession({
 authStorage,
 modelRegistry,
 settings,
 sessionManager: SessionManager.inMemory(),
 toolNames: ["read", "grep", "find", "edit", "write"],
 enableMCP: false,
 enableLsp: true,
});

session.subscribe(event => {
 if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
  process.stdout.write(event.assistantMessageEvent.delta);
 }
});

await session.prompt("Find all TODO comments in this repo and propose fixes.");
await session.dispose();
```
