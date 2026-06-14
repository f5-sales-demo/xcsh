---
title: SDK
description: 用於在 xcsh 編碼代理程式執行階段上構建自訂代理程式和整合的 SDK。
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

SDK 是 `@f5xc-salesdemos/xcsh` 的同進程整合介面。
當您需要從自己的 Bun/Node 進程直接存取代理程式狀態、事件串流、工具串接和會話控制時，請使用此 SDK。

如果您需要跨語言/進程隔離，請改用 RPC 模式。

## 安裝

```bash
bun add @f5xc-salesdemos/xcsh
```

## 進入點

`@f5xc-salesdemos/xcsh` 從套件根目錄匯出 SDK API（也可透過 `@f5xc-salesdemos/xcsh/sdk` 存取）。

嵌入器的核心匯出項目：

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- 探索輔助函式（`discoverExtensions`、`discoverSkills`、`discoverContextFiles`、`discoverPromptTemplates`、`discoverSlashCommands`、`discoverCustomTSCommands`、`discoverMCPServers`）
- 工具工廠介面（`createTools`、`BUILTIN_TOOLS`、工具類別）

## 快速入門（自動探索預設值）

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

`createAgentSession()` 遵循「提供即覆寫，省略即探索」的原則。

若省略，將自動解析：

- `cwd`：`getProjectDir()`
- `agentDir`：`~/.xcsh/agent`（透過 `getAgentDir()`）
- `authStorage`：`discoverAuthStorage(agentDir)`
- `modelRegistry`：`new ModelRegistry(authStorage)` + `await refresh()`
- `settings`：`await Settings.init({ cwd, agentDir })`
- `sessionManager`：`SessionManager.create(cwd)`（檔案後端）
- 技能/上下文檔案/提示範本/斜線指令/擴充套件/自訂 TS 指令
- 透過 `createTools(...)` 建立的內建工具
- MCP 工具（預設啟用）
- LSP 整合（預設啟用）

### 必要與選用輸入

通常您只需提供想要控制的部分：

- **必須提供**：最小會話無需提供任何內容
- **嵌入器中通常需明確提供**：
    - `sessionManager`（若需要記憶體模式或自訂位置）
    - `authStorage` + `modelRegistry`（若您自行管理憑證/模型生命週期）
    - `model` 或 `modelPattern`（若需要確定性的模型選擇）
    - `settings`（若需要隔離/測試設定）

## 會話管理器行為（持久化 vs 記憶體模式）

`AgentSession` 始終使用 `SessionManager`；行為取決於您使用的工廠方法。

### 檔案後端（預設）

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // 絕對 .jsonl 路徑
```

- 將對話/訊息/狀態差異持久化至會話檔案。
- 支援繼續/開啟/列出/分叉工作流程。
- `session.sessionFile` 有定義值。

### 記憶體模式

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- 不進行檔案系統持久化。
- 適用於測試、臨時工作者、請求範圍的代理程式。
- 會話方法仍可正常運作，但與持久化相關的行為（檔案繼續/分叉路徑）自然受到限制。

### 繼續/開啟/列出輔助函式

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## 模型與驗證串接

`createAgentSession()` 使用 `ModelRegistry` + `AuthStorage` 進行模型選擇和 API 金鑰解析。

### 明確串接

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

當未明確提供 `model`/`modelPattern` 時：

1. 從現有會話還原模型（若可還原且金鑰可用）
2. 設定中的預設模型角色（`default`）
3. 具有有效驗證的第一個可用模型

若還原失敗，`modelFallbackMessage` 將說明回退原因。

### 驗證優先順序

`AuthStorage.getApiKey(...)` 依以下順序解析：

1. 執行階段覆寫（`setRuntimeApiKey`）
2. 儲存在 `agent.db` 中的憑證
3. 提供者環境變數
4. 自訂提供者解析器回退（若已設定）

## 事件訂閱模型

使用 `session.subscribe(listener)` 訂閱；返回一個取消訂閱函式。

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

`AgentSessionEvent` 包含核心 `AgentEvent` 以及會話層級事件：

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## 提示詞生命週期

`session.prompt(text, options?)` 是主要進入點。

行為說明：

1. 選用的指令/範本展開（`/` 指令、自訂指令、檔案斜線指令、提示範本）
2. 若目前正在串流中：
    - 需要 `streamingBehavior: "steer" | "followUp"`
    - 加入佇列而非丟棄工作
3. 若處於閒置狀態：
    - 驗證模型 + API 金鑰
    - 附加使用者訊息
    - 啟動代理程式輪次

相關 API：

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## 工具與擴充套件整合

### 內建工具與篩選

- 內建工具來自 `createTools(...)` 和 `BUILTIN_TOOLS`。
- `toolNames` 作為內建工具的允許清單。
- `customTools` 和擴充套件註冊的工具仍會包含在內。
- 隱藏工具（例如 `submit_result`）需明確選用，除非選項要求。

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### 擴充套件

- `extensions`：內嵌 `ExtensionFactory[]`
- `additionalExtensionPaths`：載入額外的擴充套件檔案
- `disableExtensionDiscovery`：停用自動擴充套件掃描
- `preloadedExtensions`：重複使用已載入的擴充套件集合

### 執行階段工具集變更

`AgentSession` 支援執行階段啟用更新：

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

系統提示詞將重新建立以反映啟用工具的變更。

## 探索輔助函式

當您需要部分控制而不重建內部探索邏輯時，請使用以下函式：

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## 子代理程式導向選項

適用於構建協調器的 SDK 使用者（類似任務執行器流程）：

- `outputSchema`：將結構化輸出預期傳遞至工具上下文
- `requireSubmitResultTool`：強制包含 `submit_result` 工具
- `taskDepth`：巢狀任務會話的遞迴深度上下文
- `parentTaskPrefix`：巢狀任務輸出的產出物命名前綴

這些對於一般單一代理程式嵌入而言皆為選用。

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

僅當您的嵌入器提供工具/擴充套件應呼叫的 UI 功能時，才需使用 `setToolUIContext(...)`。

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
