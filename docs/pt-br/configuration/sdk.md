---
title: SDK
description: >-
  SDK for building custom agents and integrations on top of the xcsh coding
  agent runtime.
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

O SDK é a superfície de integração em processo para o `@f5xc-salesdemos/xcsh`.
Use-o quando você quiser acesso direto ao estado do agente, streaming de eventos, configuração de ferramentas e controle de sessão a partir do seu próprio processo Bun/Node.

Se você precisar de isolamento entre linguagens/processos, use o modo RPC.

## Instalação

```bash
bun add @f5xc-salesdemos/xcsh
```

## Pontos de entrada

O `@f5xc-salesdemos/xcsh` exporta as APIs do SDK a partir da raiz do pacote (e também via `@f5xc-salesdemos/xcsh/sdk`).

Exportações principais para integradores:

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- Helpers de descoberta (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- Superfície de fábrica de ferramentas (`createTools`, `BUILTIN_TOOLS`, classes de ferramentas)

## Início rápido (padrões com auto-descoberta)

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

## O que `createAgentSession()` descobre por padrão

`createAgentSession()` segue o princípio "forneça para sobrescrever, omita para descobrir".

Se omitido, ele resolve:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent` (via `getAgentDir()`)
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)` (baseado em arquivo)
- skills/arquivos de contexto/templates de prompt/comandos slash/extensões/comandos TS personalizados
- ferramentas integradas via `createTools(...)`
- ferramentas MCP (habilitadas por padrão)
- integração LSP (habilitada por padrão)

### Entradas obrigatórias vs opcionais

Normalmente você deve fornecer apenas o que deseja controlar:

- **Deve fornecer**: nada para uma sessão mínima
- **Geralmente fornecido explicitamente** em integrações:
    - `sessionManager` (se você precisar de armazenamento em memória ou localização personalizada)
    - `authStorage` + `modelRegistry` (se você gerencia o ciclo de vida de credenciais/modelos)
    - `model` ou `modelPattern` (se a seleção determinística de modelo for importante)
    - `settings` (se você precisar de configuração isolada/de teste)

## Comportamento do gerenciador de sessão (persistente vs em memória)

`AgentSession` sempre usa um `SessionManager`; o comportamento depende de qual fábrica você utiliza.

### Baseado em arquivo (padrão)

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absolute .jsonl path
```

- Persiste conversas/mensagens/deltas de estado em arquivos de sessão.
- Suporta fluxos de retomada/abertura/listagem/bifurcação.
- `session.sessionFile` é definido.

### Em memória

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- Sem persistência no sistema de arquivos.
- Útil para testes, workers efêmeros, agentes com escopo de requisição.
- Os métodos de sessão ainda funcionam, mas comportamentos específicos de persistência (caminhos de retomada/bifurcação de arquivo) são naturalmente limitados.

### Helpers de retomada/abertura/listagem

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## Configuração de modelo e autenticação

`createAgentSession()` usa `ModelRegistry` + `AuthStorage` para seleção de modelo e resolução de chave de API.

### Configuração explícita

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

### Ordem de seleção quando `model` é omitido

Quando nenhum `model`/`modelPattern` explícito é fornecido:

1. restaurar modelo da sessão existente (se restaurável + chave disponível)
2. modelo padrão das configurações por papel (`default`)
3. primeiro modelo disponível com autenticação válida

Se a restauração falhar, `modelFallbackMessage` explica o fallback.

### Prioridade de autenticação

`AuthStorage.getApiKey(...)` resolve nesta ordem:

1. sobrescrita em tempo de execução (`setRuntimeApiKey`)
2. credenciais armazenadas em `agent.db`
3. variáveis de ambiente do provedor
4. fallback do resolvedor de provedor personalizado (se configurado)

## Modelo de assinatura de eventos

Assine com `session.subscribe(listener)`; ele retorna uma função de cancelamento de assinatura.

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

`AgentSessionEvent` inclui o `AgentEvent` principal mais eventos no nível da sessão:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## Ciclo de vida do prompt

`session.prompt(text, options?)` é o ponto de entrada principal.

Comportamento:

1. expansão opcional de comando/template (comandos `/`, comandos personalizados, comandos slash de arquivo, templates de prompt)
2. se estiver em streaming atualmente:
    - requer `streamingBehavior: "steer" | "followUp"`
    - enfileira em vez de descartar o trabalho
3. se estiver ocioso:
    - valida modelo + chave de API
    - adiciona mensagem do usuário
    - inicia turno do agente

APIs relacionadas:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## Ferramentas e integração de extensões

### Ferramentas integradas e filtragem

- As ferramentas integradas vêm de `createTools(...)` e `BUILTIN_TOOLS`.
- `toolNames` atua como uma lista de permissão para ferramentas integradas.
- `customTools` e ferramentas registradas por extensões ainda são incluídas.
- Ferramentas ocultas (por exemplo `submit_result`) são opt-in, a menos que exigidas pelas opções.

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### Extensões

- `extensions`: `ExtensionFactory[]` inline
- `additionalExtensionPaths`: carregar arquivos de extensão adicionais
- `disableExtensionDiscovery`: desabilitar a varredura automática de extensões
- `preloadedExtensions`: reutilizar um conjunto de extensões já carregado

### Alterações do conjunto de ferramentas em tempo de execução

`AgentSession` suporta atualizações de ativação em tempo de execução:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

O prompt de sistema é reconstruído para refletir as alterações nas ferramentas ativas.

## Helpers de descoberta

Use-os quando quiser controle parcial sem recriar a lógica interna de descoberta:

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## Opções orientadas a subagentes

Para consumidores do SDK construindo orquestradores (semelhante ao fluxo de executor de tarefas):

- `outputSchema`: passa a expectativa de saída estruturada para o contexto da ferramenta
- `requireSubmitResultTool`: força a inclusão da ferramenta `submit_result`
- `taskDepth`: contexto de profundidade de recursão para sessões de tarefas aninhadas
- `parentTaskPrefix`: prefixo de nomeação de artefatos para saídas de tarefas aninhadas

Estes são opcionais para integração normal com agente único.

## Valor de retorno de `createAgentSession()`

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

Use `setToolUIContext(...)` apenas se seu integrador fornecer capacidades de UI que ferramentas/extensões devem invocar.

## Exemplo mínimo de integração controlada

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
