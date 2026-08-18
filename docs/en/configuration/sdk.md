---
title: SDK
description: SDK for building custom agents and integrations on top of the xcsh coding agent runtime.
sidebar:
  order: 6
  label: SDK
---

The SDK provides an in-process programmatic integration surface for `@f5-sales-demo/xcsh`. Use the SDK when you need direct access to agent state, event streaming, tool configuration, and session management from within your own Bun or Node.js process.

If you require cross-language integration or process isolation, use RPC mode instead.

## Installation

Install the package via Bun:

```bash
bun add @f5-sales-demo/xcsh
```

## Primary entry points

`@f5-sales-demo/xcsh` exports the SDK API surface from the root package:

- Core session builder: `createAgentSession`
- State and lifecycle classes: `SessionManager`, `Settings`, `AuthStorage`, `ModelRegistry`
- Authentication helpers: `discoverAuthStorage`
- Capability discovery helpers: `discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`
- Tool registry APIs: `createTools`, `BUILTIN_TOOLS`, and tool implementation classes

## Quick start

The following example demonstrates launching a session with default discovery:

```ts
import { createAgentSession } from "@f5-sales-demo/xcsh";

const { session, modelFallbackMessage } = await createAgentSession();

if (modelFallbackMessage) {
  process.stderr.write(`${modelFallbackMessage}\n`);
}

const unsubscribe = session.subscribe(event => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("Summarize this repository in three bullet points.");
unsubscribe();
await session.dispose();
```

## Default discovery behavior

`createAgentSession()` follows a "provide to override, omit to discover" convention. When options are omitted, the SDK resolves:

- `cwd`: Evaluates `getProjectDir()`.
- `agentDir`: Resolves `~/.xcsh/agent` (via `getAgentDir()`).
- `authStorage`: Loads credentials via `discoverAuthStorage(agentDir)`.
- `modelRegistry`: Initializes `new ModelRegistry(authStorage)` and executes `await refresh()`.
- `settings`: Loads settings via `await Settings.init({ cwd, agentDir })`.
- `sessionManager`: Creates a file-backed session manager via `SessionManager.create(cwd)`.
- Capabilities: Automatically discovers skills, context files, prompt templates, slash commands, extensions, and custom TypeScript commands.
- Tools: Resolves built-in tools via `createTools(...)`, along with MCP and LSP integrations.

### Explicit inputs versus defaults

- **Minimal session**: Requires zero explicit parameters.
- **Custom embeddings**: Applications typically provide explicit values for:
  - `sessionManager`: When using in-memory sessions or custom filesystem storage locations.
  - `authStorage` and `modelRegistry`: When managing credentials or model lifecycles directly.
  - `model` or `modelPattern`: When requiring deterministic model selection.
  - `settings`: When configuring isolated test environments or overriding policy settings.

## Session manager persistence models

`AgentSession` requires a `SessionManager` instance. Choose between file-backed or in-memory persistence based on your requirements.

### File-backed sessions (default)

```ts
import { createAgentSession, SessionManager } from "@f5-sales-demo/xcsh";

const { session } = await createAgentSession({
  sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // Absolute path to .jsonl session file
```

- Persists conversation messages, state deltas, and tool executions to session files.
- Supports resuming, listing, and branching session trees.
- Exposes the active file path through `session.sessionFile`.

### In-memory sessions

```ts
import { createAgentSession, SessionManager } from "@f5-sales-demo/xcsh";

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- Operates purely in memory without disk persistence.
- Ideal for unit testing, ephemeral tasks, and stateless API handlers.
- Retains all runtime session APIs, while filesystem-dependent operations (such as session resumption) remain disabled.

### Session lookup helpers

```ts
import { SessionManager } from "@f5-sales-demo/xcsh";

const recentSession = await SessionManager.continueRecent(process.cwd());
const allSessions = await SessionManager.list(process.cwd());
const specificSession = allSessions[0] ? await SessionManager.open(allSessions[0].path) : null;
```

## Model and authentication wiring

`createAgentSession()` integrates `ModelRegistry` and `AuthStorage` to resolve models and API credentials.

### Explicit configuration

```ts
import {
  createAgentSession,
  discoverAuthStorage,
  ModelRegistry,
  SessionManager,
} from "@f5-sales-demo/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const availableModels = modelRegistry.getAvailable();
if (availableModels.length === 0) {
  throw new Error("No authenticated models available");
}

const { session } = await createAgentSession({
  authStorage,
  modelRegistry,
  model: availableModels[0],
  thinkingLevel: "medium",
  sessionManager: SessionManager.inMemory(),
});
```

### Model selection precedence

When `model` and `modelPattern` are omitted, the SDK applies the following priority order:

1. Restore the model previously saved in the resumed session (if supported and credentials exist).
2. Fall back to the default model role configured in `Settings` (`default`).
3. Select the first available model possessing valid credentials in `ModelRegistry`.

If restoring the saved model fails, `modelFallbackMessage` details the fallback resolution.

### Credential resolution precedence

`AuthStorage.getApiKey(...)` resolves API keys in the following order:

1. Runtime overrides specified via `setRuntimeApiKey`.
2. Stored credentials in SQLite `agent.db`.
3. Provider environment variables.
4. Custom provider fallback resolvers.

## Event subscription model

Register listeners via `session.subscribe(listener)`. The method returns an unsubscribe callback:

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

`AgentSessionEvent` includes core `AgentEvent` objects plus session-level lifecycle events:

- `auto_compaction_start` and `auto_compaction_end`
- `auto_retry_start` and `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## Prompt execution lifecycle

`session.prompt(text, options?)` provides the primary interaction method:

1. Expands prompt templates, slash commands, and custom commands.
2. If the agent is actively streaming:
   - Requires `streamingBehavior: "steer" | "followUp"`.
   - Queues the message without interrupting execution.
3. If the agent is idle:
   - Validates model availability and credentials.
   - Appends the user message to session history.
   - Initiates an agent execution turn.

Related control methods:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## Tools and extension integration

### Built-in tools and filtering

- Built-in tools originate from `createTools(...)` and `BUILTIN_TOOLS`.
- `toolNames` acts as an allowlist for built-in tools.
- `customTools` and extension-provided tools remain included.
- Specialized tools (such as `submit_result`) require explicit opt-in.

```ts
const { session } = await createAgentSession({
  toolNames: ["read", "grep", "find", "write"],
  requireSubmitResultTool: true,
});
```

### Extension configuration

- `extensions`: Supply inline `ExtensionFactory[]` definitions.
- `additionalExtensionPaths`: Load extensions from specific file paths.
- `disableExtensionDiscovery`: Prevent automatic extension discovery.
- `preloadedExtensions`: Reuse previously loaded extension collections.

### Dynamic tool reconfiguration

`AgentSession` supports updating active tools at runtime:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

When active tools change, the runtime regenerates the system prompt automatically.

## Capability discovery helpers

Use these helper functions when customizing discovery behavior:

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## Subagent and orchestrator options

When building multi-agent systems or orchestrators:

- `outputSchema`: Passes structured JSON schema requirements into tool execution contexts.
- `requireSubmitResultTool`: Forces registration of the `submit_result` tool.
- `taskDepth`: Sets the nesting depth context for child task sessions.
- `parentTaskPrefix`: Configures artifact prefixing for hierarchical tasks.

## Return structure of `createAgentSession()`

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

Invoke `setToolUIContext(...)` when your application provides custom UI dialogs or renderers for extensions.

## Complete integration example

```ts
import {
  createAgentSession,
  discoverAuthStorage,
  ModelRegistry,
  SessionManager,
  Settings,
} from "@f5-sales-demo/xcsh";

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

await session.prompt("Identify pending items and recommend next steps.");
await session.dispose();
```
