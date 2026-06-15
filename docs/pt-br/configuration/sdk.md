---
title: SDK
description: >-
  SDK para construção de agentes personalizados e integrações sobre o runtime do
  agente de codificação xcsh.
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

O SDK é a superfície de integração em processo para `@f5xc-salesdemos/xcsh`.
Use-o quando desejar acesso direto ao estado do agente, streaming de eventos, configuração de ferramentas e controle de sessão a partir do seu próprio processo Bun/Node.

Se você precisar de isolamento entre linguagens/processos, utilize o modo RPC.

## Instalação

```bash
bun add @f5xc-salesdemos/xcsh
```

## Pontos de entrada

`@f5xc-salesdemos/xcsh` exporta as APIs do SDK a partir da raiz do pacote (e também via `@f5xc-salesdemos/xcsh/sdk`).

Exportações principais para integradores:

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- Auxiliares de descoberta (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- Superfície de fábrica de ferramentas (`createTools`, `BUILTIN_TOOLS`, classes de ferramentas)

## Início rápido (padrões de autodescoberta)

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

`createAgentSession()` segue o princípio "forneça para substituir, omita para descobrir".

Se omitidos, os seguintes valores são resolvidos:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent` (via `getAgentDir()`)
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)` (com persistência em arquivo)
- skills/arquivos de contexto/templates de prompt/comandos slash/extensões/comandos TS personalizados
- ferramentas nativas via `createTools(...)`
- ferramentas MCP (habilitadas por padrão)
- integração LSP (habilitada por padrão)

### Entradas obrigatórias vs. opcionais

Normalmente, você precisa fornecer apenas o que deseja controlar:

- **Deve fornecer**: nada para uma sessão mínima
- **Geralmente fornecido explicitamente** em integradores:
    - `sessionManager` (se você precisar de memória volátil ou localização personalizada)
    - `authStorage` + `modelRegistry` (se você gerencia o ciclo de vida de credenciais/modelos)
    - `model` ou `modelPattern` (se a seleção determinística de modelo for importante)
    - `settings` (se você precisar de configuração isolada/de teste)

## Comportamento do gerenciador de sessão (persistente vs. em memória)

`AgentSession` sempre utiliza um `SessionManager`; o comportamento depende de qual fábrica você usa.

### Com persistência em arquivo (padrão)

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // caminho absoluto .jsonl
```

- Persiste conversas/mensagens/deltas de estado em arquivos de sessão.
- Suporta fluxos de retomada/abertura/listagem/ramificação.
- `session.sessionFile` está definido.

### Em memória

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- Sem persistência no sistema de arquivos.
- Útil para testes, workers efêmeros e agentes com escopo de requisição.
- Os métodos de sessão ainda funcionam, mas comportamentos específicos de persistência (retomada/ramificação por arquivo) são naturalmente limitados.

### Auxiliares de retomada/abertura/listagem

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## Configuração de modelo e autenticação

`createAgentSession()` utiliza `ModelRegistry` + `AuthStorage` para seleção de modelo e resolução de chaves de API.

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

1. restaura o modelo da sessão existente (se restaurável + chave disponível)
2. papel de modelo padrão nas configurações (`default`)
3. primeiro modelo disponível com autenticação válida

Se a restauração falhar, `modelFallbackMessage` explica o fallback utilizado.

### Prioridade de autenticação

`AuthStorage.getApiKey(...)` resolve na seguinte ordem:

1. substituição em tempo de execução (`setRuntimeApiKey`)
2. credenciais armazenadas no `agent.db`
3. variáveis de ambiente do provedor
4. fallback do resolvedor de provedor personalizado (se configurado)

## Modelo de assinatura de eventos

Inscreva-se com `session.subscribe(listener)`; o método retorna uma função para cancelar a assinatura.

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

`AgentSessionEvent` inclui o `AgentEvent` principal além de eventos no nível de sessão:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## Ciclo de vida do prompt

`session.prompt(text, options?)` é o ponto de entrada principal.

Comportamento:

1. expansão opcional de comandos/templates (comandos `/`, comandos personalizados, comandos slash de arquivo, templates de prompt)
2. se estiver fazendo streaming no momento:
    - requer `streamingBehavior: "steer" | "followUp"`
    - enfileira em vez de descartar o trabalho
3. se estiver ocioso:
    - valida o modelo + chave de API
    - acrescenta a mensagem do usuário
    - inicia o turno do agente

APIs relacionadas:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## Ferramentas e integração de extensões

### Ferramentas nativas e filtragem

- As ferramentas nativas vêm de `createTools(...)` e `BUILTIN_TOOLS`.
- `toolNames` funciona como uma lista de permissões para ferramentas nativas.
- Ferramentas `customTools` e ferramentas registradas por extensões ainda são incluídas.
- Ferramentas ocultas (por exemplo, `submit_result`) requerem opt-in, exceto quando exigidas pelas opções.

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### Extensões

- `extensions`: `ExtensionFactory[]` inline
- `additionalExtensionPaths`: carrega arquivos de extensão adicionais
- `disableExtensionDiscovery`: desabilita a varredura automática de extensões
- `preloadedExtensions`: reutiliza um conjunto de extensões já carregado

### Alterações no conjunto de ferramentas em tempo de execução

`AgentSession` suporta atualizações de ativação em tempo de execução:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

O prompt do sistema é reconstruído para refletir as alterações nas ferramentas ativas.

## Auxiliares de descoberta

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

Para consumidores do SDK que constroem orquestradores (semelhante ao fluxo de executor de tarefas):

- `outputSchema`: passa a expectativa de saída estruturada para o contexto da ferramenta
- `requireSubmitResultTool`: força a inclusão da ferramenta `submit_result`
- `taskDepth`: contexto de profundidade de recursão para sessões de tarefas aninhadas
- `parentTaskPrefix`: prefixo de nomenclatura de artefatos para saídas de tarefas aninhadas

Esses parâmetros são opcionais para incorporação normal de agente único.

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

Use `setToolUIContext(...)` somente se o seu integrador fornecer capacidades de UI que ferramentas/extensões devam utilizar.

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
