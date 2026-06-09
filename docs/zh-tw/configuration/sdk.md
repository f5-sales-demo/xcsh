---
title: SDK
description: 用於在 xcsh 編碼代理執行環境之上建構自訂代理與整合的 SDK。
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

SDK 是 `@f5xc-salesdemos/xcsh` 的行程內整合介面。
當您想從自己的 Bun/Node 行程直接存取代理狀態、事件串流、工具連接和工作階段控制時，請使用它。

如果您需要跨語言/行程隔離，請改用 RPC 模式。

## 安裝

```bash
bun add @f5xc-salesdemos/xcsh
```

## 進入點

`@f5xc-salesdemos/xcsh` 從套件根目錄匯出 SDK API（也可透過 `@f5xc-salesdemos/xcsh/sdk` 取得）。

嵌入者的核心匯出：

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- 探索輔助函式（`discoverExtensions`、`discoverSkills`、`discoverContextFiles`、`discoverPromptTemplates`、`discoverSlashCommands`、`discoverCustomTSCommands`、`discoverMCPServers`）
- 工具工廠介面（`createTools`、`BUILTIN_TOOLS`、工具類別）

## 快速開始（自動探索預設值）

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

## `createAgentSession()` 預設探索的內容

`createAgentSession()` 遵循「提供以覆寫，省略以探索」原則。

如果省略，它會解析：

- `cwd`：`getProjectDir()`
- `agentDir`：`~/.xcsh/agent`（透過 `getAgentDir()`）
- `authStorage`：`discoverAuthStorage(agentDir)`
- `modelRegistry`：`new ModelRegistry(authStorage)` + `await refresh()`
- `settings`：`await Settings.init({ cwd, agentDir })`
- `sessionManager`：`SessionManager.create(cwd)`（檔案支援）
- 技能/上下文檔案/提示範本/斜線命令/擴充功能/自訂 TS 命令
- 透過 `createTools(...)` 建立的內建工具
- MCP 工具（預設啟用）
- LSP 整合（預設啟用）

### 必要與可選輸入

通常您只需提供想要控制的部分：

- **必須提供**：最小工作階段不需要任何東西
- **嵌入者通常會明確提供**：
    - `sessionManager`（如果您需要記憶體內或自訂位置）
    - `authStorage` + `modelRegistry`（如果您擁有憑證/模型生命週期）
    - `model` 或 `modelPattern`（如果確定性模型選擇很重要）
    - `settings`（如果您需要隔離/測試設定）

## 工作階段管理器行為（持久化 vs 記憶體內）

`AgentSession` 總是使用 `SessionManager`；行為取決於您使用的工廠方法。

### 檔案支援（預設）

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absolute .jsonl path
```

- 將對話/訊息/狀態差異持久化到工作階段檔案。
- 支援恢復/開啟/列出/分支工作流程。
- `session.sessionFile` 已定義。

### 記憶體內

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- 無檔案系統持久化。
- 適用於測試、臨時 worker、請求範圍代理。
- 工作階段方法仍然可用，但與持久化相關的行為（檔案恢復/分支路徑）自然受到限制。

### 恢復/開啟/列出輔助函式

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## 模型與驗證連接

`createAgentSession()` 使用 `ModelRegistry` + `AuthStorage` 進行模型選擇和 API 金鑰解析。

### 明確連接

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

### 省略 `model` 時的選擇順序

當未提供明確的 `model`/`modelPattern` 時：

1. 從現有工作階段恢復模型（如果可恢復且金鑰可用）
2. 設定的預設模型角色（`default`）
3. 第一個具有有效驗證的可用模型

如果恢復失敗，`modelFallbackMessage` 會說明回退原因。

### 驗證優先順序

`AuthStorage.getApiKey(...)` 按以下順序解析：

1. 執行時覆寫（`setRuntimeApiKey`）
2. 儲存在 `agent.db` 中的憑證
3. 提供者環境變數
4. 自訂提供者解析器回退（如果已設定）

## 事件訂閱模型

使用 `session.subscribe(listener)` 訂閱；它會回傳一個取消訂閱函式。

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

`AgentSessionEvent` 包含核心 `AgentEvent` 加上工作階段層級事件：

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## 提示生命週期

`session.prompt(text, options?)` 是主要進入點。

行為：

1. 可選的命令/範本展開（`/` 命令、自訂命令、檔案斜線命令、提示範本）
2. 如果目前正在串流：
    - 需要 `streamingBehavior: "steer" | "followUp"`
    - 排隊而非丟棄工作
3. 如果閒置：
    - 驗證模型 + API 金鑰
    - 附加使用者訊息
    - 開始代理回合

相關 API：

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## 工具與擴充功能整合

### 內建工具與篩選

- 內建工具來自 `createTools(...)` 和 `BUILTIN_TOOLS`。
- `toolNames` 作為內建工具的允許清單。
- `customTools` 和擴充功能註冊的工具仍然會包含在內。
- 隱藏工具（例如 `submit_result`）除非選項要求，否則需要手動啟用。

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### 擴充功能

- `extensions`：內聯 `ExtensionFactory[]`
- `additionalExtensionPaths`：載入額外的擴充功能檔案
- `disableExtensionDiscovery`：停用自動擴充功能掃描
- `preloadedExtensions`：重複使用已載入的擴充功能集

### 執行時工具集變更

`AgentSession` 支援執行時啟用更新：

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

系統提示會重建以反映活動工具的變更。

## 探索輔助函式

當您想要部分控制而不重新建立內部探索邏輯時，請使用這些：

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## 子代理導向選項

適用於建構協調器的 SDK 使用者（類似任務執行器流程）：

- `outputSchema`：將結構化輸出期望傳遞到工具上下文中
- `requireSubmitResultTool`：強制包含 `submit_result` 工具
- `taskDepth`：巢狀任務工作階段的遞迴深度上下文
- `parentTaskPrefix`：巢狀任務輸出的產出物命名前綴

這些對於一般的單一代理嵌入是可選的。

## `createAgentSession()` 回傳值

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

僅當您的嵌入者提供工具/擴充功能應呼叫的 UI 功能時，才使用 `setToolUIContext(...)`。

## 最小受控嵌入範例

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
