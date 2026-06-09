---
title: Extensões
description: >-
  Visão geral do runtime de extensões cobrindo tipos, ciclo de vida do runner,
  registro e descoberta.
sidebar:
  order: 1
  label: Visão geral
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# Extensões

Guia principal para criação de extensões de runtime em `packages/coding-agent`.

Este documento cobre o runtime de extensões atual em:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

Para caminhos de descoberta e regras de carregamento do sistema de arquivos, consulte `docs/extension-loading.md`.

## O que é uma extensão

Uma extensão é um módulo TS/JS que exporta uma factory padrão:

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

Extensões podem combinar todos os seguintes elementos em um único módulo:

- manipuladores de eventos (`pi.on(...)`)
- ferramentas chamáveis por LLM (`pi.registerTool(...)`)
- comandos slash (`pi.registerCommand(...)`)
- atalhos de teclado e flags
- renderização personalizada de mensagens
- APIs de injeção de sessão/mensagem (`sendMessage`, `sendUserMessage`, `appendEntry`)

## Modelo de runtime

1. As extensões são importadas e suas funções factory são executadas.
2. Durante essa fase de carregamento, os métodos de registro são válidos; os métodos de ação em runtime ainda não estão inicializados.
3. `ExtensionRunner.initialize(...)` conecta as ações/contextos ativos para o modo ativo.
4. Eventos de ciclo de vida de sessão/agente/ferramenta são emitidos para os manipuladores.
5. Toda execução de ferramenta é envolvida com interceptação de extensão (`tool_call` / `tool_result`).

```text
Extension lifecycle (simplified)

load paths
   │
   ▼
import module + run factory (registration only)
   │
   ▼
ExtensionRunner.initialize(mode/session/tool registry)
   │
   ├─ emit session/agent events to handlers
   ├─ wrap tool execution (tool_call/tool_result)
   └─ expose runtime actions (sendMessage, setActiveTools, ...)
```

Restrição importante do `loader.ts`:

- chamar métodos de ação como `pi.sendMessage()` durante o carregamento da extensão lança `ExtensionRuntimeNotInitializedError`
- registre primeiro; execute comportamento de runtime a partir de eventos/comandos/ferramentas

## Início rápido

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
 pi.setLabel("Safety + Utilities");

 pi.on("session_start", async (_event, ctx) => {
  ctx.ui.notify(`Extension loaded in ${ctx.cwd}`, "info");
 });

 pi.on("tool_call", async (event) => {
  if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
   return { block: true, reason: "Blocked by extension policy" };
  }
 });

 pi.registerTool({
  name: "hello_extension",
  label: "Hello Extension",
  description: "Return a greeting",
  parameters: Type.Object({ name: Type.String() }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
   return {
    content: [{ type: "text", text: `Hello, ${params.name}` }],
    details: { greeted: params.name },
   };
  },
 });

 pi.registerCommand("hello-ext", {
  description: "Show queue state",
  handler: async (_args, ctx) => {
   ctx.ui.notify(`pending=${ctx.hasPendingMessages()}`, "info");
  },
 });
}
```

## Superfícies da API de extensão

## 1) Registro e ações (`ExtensionAPI`)

Métodos principais:

- `on(event, handler)`
- `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`
- `registerMessageRenderer`
- `sendMessage`, `sendUserMessage`, `appendEntry`
- `getActiveTools`, `getAllTools`, `setActiveTools`
- `getSessionName`, `setSessionName`
- `setModel`, `getThinkingLevel`, `setThinkingLevel`
- `registerProvider`
- `events` (barramento de eventos compartilhado)

No modo interativo, manipuladores de `input` são executados antes da verificação integrada de auto-título da primeira mensagem. Extensões que chamam `await pi.setSessionName(...)` a partir de `input` podem definir o nome de sessão persistido e impedir que o título auto-gerado padrão seja executado para aquela sessão.

Também expostos:

- `pi.logger`
- `pi.typebox`
- `pi.pi` (exportações do pacote)

### Semântica de entrega de mensagens

`pi.sendMessage(message, options)` suporta:

- `deliverAs: "steer"` (padrão) — interrompe a execução atual
- `deliverAs: "followUp"` — enfileirado para executar após a execução atual
- `deliverAs: "nextTurn"` — armazenado e injetado no próximo prompt do usuário
- `triggerTurn: true` — inicia um turno quando ocioso (`nextTurn` ignora isso)

`pi.sendUserMessage(content, { deliverAs })` sempre passa pelo fluxo de prompt; durante streaming é enfileirado como steer/follow-up.

## 2) Contexto do manipulador (`ExtensionContext`)

Manipuladores e `execute` de ferramentas recebem `ctx` com:

- `ui`
- `hasUI`
- `cwd`
- `sessionManager` (somente leitura)
- `modelRegistry`, `model`
- `getContextUsage()`
- `compact(...)`
- `isIdle()`, `hasPendingMessages()`, `abort()`
- `shutdown()`
- `getSystemPrompt()`

## 3) Contexto de comando (`ExtensionCommandContext`)

Manipuladores de comando adicionalmente recebem:

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

Use o contexto de comando para fluxos de controle de sessão; esses métodos são intencionalmente separados dos manipuladores de eventos gerais.

## Superfície de eventos (nomes atuais e comportamento)

Uniões de eventos canônicos e tipos de payload estão em `types.ts`.

### Ciclo de vida da sessão

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

Pré-eventos canceláveis:

- `session_before_switch` → `{ cancel?: boolean }`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`

### Ciclo de vida de prompt e turno

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### Ciclo de vida de ferramentas

- `tool_call` (pré-execução, pode bloquear)
- `tool_result` (pós-execução, pode alterar content/details/isError)
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` (observabilidade)

`tool_result` é estilo middleware: manipuladores são executados na ordem das extensões e cada um vê as modificações anteriores.

### Sinais de confiabilidade/runtime

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### Interceptação de comandos do usuário

- `user_bash` (sobrescrever com `{ result }`)
- `user_python` (sobrescrever com `{ result }`)

### `resources_discover`

`resources_discover` existe nos tipos de extensão e no `ExtensionRunner`.
Nota sobre o runtime atual: `ExtensionRunner.emitResourcesDiscover(...)` está implementado, mas não há callsites em `AgentSession` que o invoquem no codebase atual.

## Detalhes de criação de ferramentas

`registerTool` usa `ToolDefinition` de `types.ts`.

Assinatura atual de `execute`:

```ts
execute(
 toolCallId,
 params,
 signal,
 onUpdate,
 ctx,
): Promise<AgentToolResult>
```

Template:

```ts
pi.registerTool({
 name: "my_tool",
 label: "My Tool",
 description: "...",
 parameters: Type.Object({}),
 async execute(_id, _params, signal, onUpdate, ctx) {
  if (signal?.aborted) {
   return { content: [{ type: "text", text: "Cancelled" }] };
  }
  onUpdate?.({ content: [{ type: "text", text: "Working..." }] });
  return { content: [{ type: "text", text: "Done" }], details: {} };
 },
 onSession(event, ctx) {
  // reason: start|switch|branch|tree|shutdown
 },
 renderCall(args, theme) {
  // optional TUI render
 },
 renderResult(result, options, theme, args) {
  // optional TUI render
 },
});
```

`tool_call`/`tool_result` interceptam todas as ferramentas uma vez que o registro é envolvido em `sdk.ts`, incluindo ferramentas integradas e ferramentas de extensão/personalizadas.

## Pontos de integração de UI

`ctx.ui` implementa a interface `ExtensionUIContext`. O suporte difere por modo.

### Modo interativo (`extension-ui-controller.ts`)

Suportado:

- diálogos: `select`, `confirm`, `input`, `editor`
- notificações/status/texto do editor/entrada de terminal/overlays personalizados
- listagem/carregamento de temas por nome (`setTheme` suporta nomes como string)
- alternância de expansão de ferramentas

Métodos no-op atuais neste controlador:

- `setFooter`
- `setHeader`
- `setEditorComponent`

Nota adicional: `setWidget` atualmente direciona para texto da linha de status via `setHookWidget(...)`.

### Modo RPC (`rpc-mode.ts`)

`ctx.ui` é suportado por eventos RPC `extension_ui_request`:

- métodos de diálogo (`select`, `confirm`, `input`, `editor`) fazem round-trip para respostas do cliente
- métodos fire-and-forget emitem requisições (`notify`, `setStatus`, `setWidget` para arrays de string, `setTitle`, `setEditorText`)

Não suportado/no-op na implementação RPC:

- `onTerminalInput`
- `custom`
- `setFooter`, `setHeader`, `setEditorComponent`
- `setWorkingMessage`
- alternância/carregamento de temas (`setTheme` retorna falha)
- controles de expansão de ferramentas são inertes

### Caminhos print/headless/subagente

Quando nenhum contexto de UI é fornecido ao init do runner, `ctx.hasUI` é `false` e os métodos são no-op/retornam valores padrão.

### Modo interativo em segundo plano

O modo em segundo plano instala um objeto de contexto de UI não interativo. Na implementação atual, `ctx.hasUI` pode ainda ser `true` enquanto diálogos interativos retornam valores padrão/comportamento no-op.

## Padrões de sessão e estado

Para estado durável de extensão:

1. Persista com `pi.appendEntry(customType, data)`.
2. Reconstrua o estado a partir de `ctx.sessionManager.getBranch()` em `session_start`, `session_branch`, `session_tree`.
3. Mantenha `details` do resultado da ferramenta estruturados quando o estado deve ser visível/reconstruível a partir do histórico de resultados de ferramentas.

Padrão de reconstrução de exemplo:

```ts
pi.on("session_start", async (_event, ctx) => {
 let latest;
 for (const entry of ctx.sessionManager.getBranch()) {
  if (entry.type === "custom" && entry.customType === "my-state") {
   latest = entry.data;
  }
 }
 // restore from latest
});
```

## Pontos de extensão de renderização

## Renderizador de mensagem personalizado

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

Usado pela renderização interativa quando mensagens personalizadas são exibidas.

## Renderizador de chamada/resultado de ferramenta

Forneça `renderCall` / `renderResult` nas definições de `registerTool` para visualização personalizada de ferramentas na TUI.

## Restrições e armadilhas

- Ações de runtime não estão disponíveis durante o carregamento da extensão.
- Erros em `tool_call` bloqueiam a execução (fail-closed).
- Conflitos de nome de comando com integrados são ignorados com diagnósticos.
- Atalhos reservados são ignorados (`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`).
- Trate `ctx.reload()` como terminal para o frame do manipulador de comando atual.

## Extensões vs hooks vs custom-tools

Use a superfície correta:

- **Extensões** (`src/extensibility/extensions/*`): sistema unificado (eventos + ferramentas + comandos + renderizadores + registro de provedor).
- **Hooks** (`src/extensibility/hooks/*`): API de eventos legada separada.
- **Custom-tools** (`src/extensibility/custom-tools/*`): módulos focados em ferramentas; quando carregados junto com extensões, são adaptados e ainda passam pelos wrappers de interceptação de extensão.

Se você precisa de um pacote que gerencie política, ferramentas, UX de comandos e renderização juntos, use extensões.
