---
title: Hooks
description: >-
  Sistema de hooks para automação de eventos pré/pós no ciclo de vida do agente
  de codificação.
sidebar:
  order: 4
  label: Hooks
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# Hooks

Este documento descreve o **código atual do subsistema de hooks** em `src/extensibility/hooks/*`.

## Status atual no runtime

O pacote de hooks (`src/extensibility/hooks/`) ainda é exportado e utilizável como superfície de API, mas o runtime padrão da CLI agora inicializa o caminho do **extension runner**. No fluxo de inicialização atual:

- `--hook` é tratado como um alias para `--extension` (os caminhos da CLI são mesclados em `additionalExtensionPaths`)
- as ferramentas são encapsuladas por `ExtensionToolWrapper`, não por `HookToolWrapper`
- transformações de contexto e emissões de ciclo de vida passam pelo `ExtensionRunner`

Portanto, este arquivo documenta a implementação do subsistema de hooks em si (tipos/loader/runner/wrapper), incluindo comportamento legado e restrições.

## Arquivos principais

- `src/extensibility/hooks/types.ts` — contexto de hook, tipos de evento e contratos de resultado
- `src/extensibility/hooks/loader.ts` — carregamento de módulos e ponte de descoberta de hooks
- `src/extensibility/hooks/runner.ts` — despacho de eventos, busca de comandos, sinalização de erros
- `src/extensibility/hooks/tool-wrapper.ts` — wrapper de interceptação pré/pós de ferramentas
- `src/extensibility/hooks/index.ts` — exports/re-exports

## O que é um módulo de hook

Um módulo de hook deve exportar por padrão uma factory:

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function hook(pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf")) {
   return { block: true, reason: "blocked by policy" };
  }
 });
}
```

A factory pode:

- registrar manipuladores de eventos com `pi.on(...)`
- enviar mensagens personalizadas persistentes com `pi.sendMessage(...)`
- persistir estado não-LLM com `pi.appendEntry(...)`
- registrar comandos slash via `pi.registerCommand(...)`
- registrar renderizadores de mensagens personalizados via `pi.registerMessageRenderer(...)`
- executar comandos shell via `pi.exec(...)`

## Descoberta e carregamento

`discoverAndLoadHooks(configuredPaths, cwd)` faz:

1. Carrega hooks descobertos a partir do registro de capacidades (`loadCapability("hooks")`)
2. Adiciona caminhos explicitamente configurados (deduplicados por caminho absoluto)
3. Chama `loadHooks(allPaths, cwd)`

`loadHooks` então importa cada caminho e espera uma função `default`.

### Resolução de caminhos

`loader.ts` resolve caminhos de hooks como:

- caminho absoluto: usado como está
- caminho com `~`: expandido
- caminho relativo: resolvido em relação ao `cwd`

### Incompatibilidade legada importante

Os provedores de descoberta para `hookCapability` ainda modelam arquivos de hook no estilo shell pré/pós (por exemplo `.claude/hooks/pre/*`, `.xcsh/.../hooks/pre/*`).

O loader de hooks aqui usa importação dinâmica de módulos e requer uma factory JS/TS de hook com export padrão. Se um caminho de hook descoberto não for importável como módulo, o carregamento falha e é reportado em `LoadHooksResult.errors`.

## Superfícies de eventos

Os eventos de hook são fortemente tipados em `types.ts`.

### Eventos de sessão

- `session_start`
- `session_before_switch` → pode retornar `{ cancel?: boolean }`
- `session_switch`
- `session_before_branch` → pode retornar `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_branch`
- `session_before_compact` → pode retornar `{ cancel?: boolean; compaction?: CompactionResult }`
- `session.compacting` → pode retornar `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }`
- `session_compact`
- `session_before_tree` → pode retornar `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`
- `session_tree`
- `session_shutdown`

### Eventos de agente/contexto

- `context` → pode retornar `{ messages?: Message[] }`
- `before_agent_start` → pode retornar `{ message?: { customType; content; display; details } }`
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `auto_compaction_start`
- `auto_compaction_end`
- `auto_retry_start`
- `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### Eventos de ferramentas (modelo pré/pós)

- `tool_call` (pré-execução) → pode retornar `{ block?: boolean; reason?: string }`
- `tool_result` (pós-execução) → pode retornar `{ content?; details?; isError? }`

Este é o modelo central de interceptação pré/pós do subsistema de hooks.

```text
Fluxo de interceptação de ferramentas por hook

manipuladores de tool_call
   │
   ├─ algum { block: true }? ── sim ──> lança exceção (ferramenta bloqueada)
   │
   └─ não
      │
      ▼
   executa ferramenta subjacente
      │
      ├─ sucesso ──> manipuladores de tool_result podem sobrescrever { content, details }
      │
      └─ erro    ──> emite tool_result(isError=true) e relança o erro original
```

## Modelo de execução e semântica de mutação

### 1) Pré-execução: `tool_call`

`HookToolWrapper.execute()` emite `tool_call` antes da execução da ferramenta.

- se qualquer manipulador retornar `{ block: true }`, a execução para
- se o manipulador lançar exceção, o wrapper falha de forma segura e bloqueia a execução
- o `reason` retornado se torna o texto do erro lançado

### 2) Execução da ferramenta

A ferramenta subjacente executa normalmente se não for bloqueada.

### 3) Pós-execução: `tool_result`

Após o sucesso, o wrapper emite `tool_result` com:

- `toolName`, `toolCallId`, `input`
- `content`
- `details`
- `isError: false`

Se o manipulador retornar substituições:

- `content` pode substituir o conteúdo do resultado
- `details` pode substituir os detalhes do resultado

Em caso de falha da ferramenta, o wrapper emite `tool_result` com `isError: true` e conteúdo de texto de erro, então relança o erro original.

### O que os hooks podem mutar

- Contexto LLM para uma única chamada via `context` (cadeia de substituição de `messages`)
- Conteúdo/detalhes de saída de ferramentas em chamadas bem-sucedidas (caminho `tool_result`)
- Mensagem injetada pré-agente via `before_agent_start`
- Comportamento de cancelamento/compactação personalizada/árvore via `session_before_*` e `session.compacting`

### O que os hooks não podem mutar nesta implementação

- Parâmetros de entrada de ferramentas brutos in-place (apenas bloquear/permitir em `tool_call`)
- Continuação da execução após erros de ferramenta lançados (o caminho de erro relança)
- Status final de sucesso/erro no comportamento do wrapper (`isError` retornado é tipado mas não aplicado pelo `HookToolWrapper`)

## Ordenação e comportamento de conflitos

### Ordenação em nível de descoberta

Os provedores de capacidade são ordenados por prioridade (maior primeiro). A deduplicação é por chave de capacidade, o primeiro vence.

Para `hooks`, a chave de capacidade é `${type}:${tool}:${name}`. Duplicatas sombreadas de provedores de menor prioridade são marcadas e excluídas da lista efetiva descoberta.

### Ordem de carregamento

`discoverAndLoadHooks` constrói uma lista plana `allPaths`, deduplicada por caminho absoluto resolvido, então `loadHooks` itera nessa ordem.
A ordem dos arquivos dentro de cada diretório descoberto depende da saída de `readdir`; o loader de hooks não realiza uma ordenação adicional.

### Ordem dos manipuladores em runtime

Dentro de `HookRunner`, a ordem é determinística pela sequência de registro:

1. ordem do array de hooks
2. ordem de registro de manipuladores por hook/evento

Comportamento de conflito por tipo de evento:

- `tool_call`: o último resultado retornado vence, a menos que um manipulador bloqueie; o primeiro bloqueio causa curto-circuito
- `tool_result`: a última substituição retornada vence (sem curto-circuito)
- `context`: encadeado; cada manipulador recebe a saída de mensagens do manipulador anterior
- `before_agent_start`: a primeira mensagem retornada é mantida; mensagens posteriores são ignoradas
- `session_before_*`: o último resultado retornado é rastreado; `cancel: true` causa curto-circuito imediatamente
- `session.compacting`: o último resultado retornado vence

Conflitos de comando/renderizador:

- `getCommand(name)` retorna a primeira correspondência entre hooks (primeiro carregado vence)
- `getMessageRenderer(customType)` retorna a primeira correspondência
- `getRegisteredCommands()` retorna todos os comandos (sem deduplicação)

## Interações de UI (`HookContext.ui`)

`HookUIContext` inclui:

- `select`, `confirm`, `input`, `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`, `getEditorText`
- getter `theme`

`ctx.hasUI` indica se a UI interativa está disponível.

Ao executar sem UI, o comportamento padrão do contexto no-op é:

- `select/input/editor` retornam `undefined`
- `confirm` retorna `false`
- `notify`, `setStatus`, `setEditorText` são no-ops
- `getEditorText` retorna `""`

### Comportamento da linha de status

O texto de status do hook definido via `ctx.ui.setStatus(key, text)` é:

- armazenado por chave
- ordenado pelo nome da chave
- sanitizado (`\r`, `\n`, `\t` → espaços; espaços repetidos colapsados)
- concatenado e truncado por largura para exibição

## Propagação de erros e fallback

### Em tempo de carregamento

- módulo inválido ou export padrão ausente → capturado em `LoadHooksResult.errors`
- o carregamento continua para os demais hooks

### Em tempo de evento

`HookRunner.emit(...)` captura erros de manipuladores para a maioria dos eventos e emite `HookError` para os ouvintes (`hookPath`, `event`, `error`), então continua.

`emitToolCall(...)` é mais restritivo: erros de manipuladores não são engolidos ali; eles propagam para o chamador. No `HookToolWrapper`, isso bloqueia a chamada da ferramenta (fail-safe).

## Exemplos realistas de API

### Bloquear comandos bash inseguros

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "bash") return;
  const cmd = String(event.input.command ?? "");
  if (!cmd.includes("rm -rf")) return;

  if (!ctx.hasUI) return { block: true, reason: "rm -rf blocked (no UI)" };
  const ok = await ctx.ui.confirm("Dangerous command", `Allow: ${cmd}`);
  if (!ok) return { block: true, reason: "user denied command" };
 });
}
```

### Redatar saída de ferramenta na pós-execução

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_result", async event => {
  if (event.toolName !== "read" || event.isError) return;

  const redacted = event.content.map(chunk => {
   if (chunk.type !== "text") return chunk;
   return { ...chunk, text: chunk.text.replaceAll(/API_KEY=\S+/g, "API_KEY=[REDACTED]") };
  });

  return { content: redacted };
 });
}
```

### Modificar contexto do modelo por chamada LLM

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### Registrar comando slash com métodos de contexto seguros para comandos

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.registerCommand("handoff", {
  description: "Create a new session with setup message",
  handler: async (_args, ctx) => {
   await ctx.waitForIdle();
   await ctx.newSession({
    parentSession: ctx.sessionManager.getSessionFile(),
    setup: async sm => {
     sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Continue from prior session summary." }],
      timestamp: Date.now(),
     });
    },
   });
  },
 });
}
```

## Superfície de exportação

`src/extensibility/hooks/index.ts` exporta:

- APIs de carregamento (`discoverAndLoadHooks`, `loadHooks`)
- runner e wrapper (`HookRunner`, `HookToolWrapper`)
- todos os tipos de hook
- re-exportação de `execCommand`

E a raiz do pacote (`src/index.ts`) re-exporta **tipos** de hook como uma superfície de compatibilidade legada.
