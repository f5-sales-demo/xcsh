---
title: Extensions
description: >-
  Extension runtime overview covering types, runner lifecycle, registration, and
  discovery.
sidebar:
  order: 1
  label: Panoramica
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# Estensioni

Guida principale per la creazione di estensioni runtime in `packages/coding-agent`.

Questo documento copre il runtime delle estensioni attuale in:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

Per i percorsi di scoperta e le regole di caricamento dal filesystem, consultare `docs/extension-loading.md`.

## Cos'è un'estensione

Un'estensione è un modulo TS/JS che esporta una factory predefinita:

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

Le estensioni possono combinare tutti i seguenti elementi in un unico modulo:

- gestori di eventi (`pi.on(...)`)
- strumenti richiamabili dall'LLM (`pi.registerTool(...)`)
- comandi slash (`pi.registerCommand(...)`)
- scorciatoie da tastiera e flag
- rendering personalizzato dei messaggi
- API di iniezione sessione/messaggi (`sendMessage`, `sendUserMessage`, `appendEntry`)

## Modello di runtime

1. Le estensioni vengono importate e le loro funzioni factory vengono eseguite.
2. Durante la fase di caricamento, i metodi di registrazione sono validi; i metodi di azione runtime non sono ancora inizializzati.
3. `ExtensionRunner.initialize(...)` collega azioni/contesti live per la modalità attiva.
4. Gli eventi del ciclo di vita sessione/agente/strumento vengono emessi ai gestori.
5. Ogni esecuzione di strumento viene incapsulata con l'intercettazione dell'estensione (`tool_call` / `tool_result`).

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

Vincolo importante da `loader.ts`:

- chiamare metodi di azione come `pi.sendMessage()` durante il caricamento dell'estensione genera `ExtensionRuntimeNotInitializedError`
- registrare prima; eseguire il comportamento runtime da eventi/comandi/strumenti

## Avvio rapido

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

## Superfici dell'API delle estensioni

## 1) Registrazione e azioni (`ExtensionAPI`)

Metodi principali:

- `on(event, handler)`
- `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`
- `registerMessageRenderer`
- `sendMessage`, `sendUserMessage`, `appendEntry`
- `getActiveTools`, `getAllTools`, `setActiveTools`
- `getSessionName`, `setSessionName`
- `setModel`, `getThinkingLevel`, `setThinkingLevel`
- `registerProvider`
- `events` (bus eventi condiviso)

In modalità interattiva, i gestori `input` vengono eseguiti prima del controllo automatico del titolo del primo messaggio integrato. Le estensioni che chiamano `await pi.setSessionName(...)` da `input` possono impostare il nome di sessione persistente e impedire l'esecuzione del titolo generato automaticamente predefinito per quella sessione.

Esposti inoltre:

- `pi.logger`
- `pi.typebox`
- `pi.pi` (esportazioni del pacchetto)

### Semantica di consegna dei messaggi

`pi.sendMessage(message, options)` supporta:

- `deliverAs: "steer"` (predefinito) — interrompe l'esecuzione corrente
- `deliverAs: "followUp"` — accodato per l'esecuzione dopo l'esecuzione corrente
- `deliverAs: "nextTurn"` — memorizzato e iniettato al prossimo prompt dell'utente
- `triggerTurn: true` — avvia un turno quando inattivo (`nextTurn` ignora questa opzione)

`pi.sendUserMessage(content, { deliverAs })` passa sempre attraverso il flusso del prompt; durante lo streaming viene accodato come steer/follow-up.

## 2) Contesto del gestore (`ExtensionContext`)

I gestori e il metodo `execute` degli strumenti ricevono `ctx` con:

- `ui`
- `hasUI`
- `cwd`
- `sessionManager` (sola lettura)
- `modelRegistry`, `model`
- `getContextUsage()`
- `compact(...)`
- `isIdle()`, `hasPendingMessages()`, `abort()`
- `shutdown()`
- `getSystemPrompt()`

## 3) Contesto del comando (`ExtensionCommandContext`)

I gestori dei comandi ottengono inoltre:

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

Utilizzare il contesto del comando per i flussi di controllo della sessione; questi metodi sono intenzionalmente separati dai gestori di eventi generali.

## Superficie degli eventi (nomi e comportamento attuali)

Le unioni canoniche degli eventi e i tipi di payload si trovano in `types.ts`.

### Ciclo di vita della sessione

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

Pre-eventi annullabili:

- `session_before_switch` → `{ cancel?: boolean }`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`

### Ciclo di vita del prompt e del turno

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### Ciclo di vita degli strumenti

- `tool_call` (pre-esecuzione, può bloccare)
- `tool_result` (post-esecuzione, può modificare content/details/isError)
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` (osservabilità)

`tool_result` segue lo stile middleware: i gestori vengono eseguiti nell'ordine delle estensioni e ciascuno vede le modifiche precedenti.

### Segnali di affidabilità/runtime

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### Intercettazione dei comandi utente

- `user_bash` (sovrascrivere con `{ result }`)
- `user_python` (sovrascrivere con `{ result }`)

### `resources_discover`

`resources_discover` esiste nei tipi delle estensioni e in `ExtensionRunner`.
Nota sul runtime attuale: `ExtensionRunner.emitResourcesDiscover(...)` è implementato, ma non ci sono callsite in `AgentSession` che lo invocano nel codebase corrente.

## Dettagli sulla creazione degli strumenti

`registerTool` utilizza `ToolDefinition` da `types.ts`.

Firma attuale di `execute`:

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

`tool_call`/`tool_result` intercettano tutti gli strumenti una volta che il registro è incapsulato in `sdk.ts`, inclusi gli strumenti integrati e quelli delle estensioni/personalizzati.

## Punti di integrazione UI

`ctx.ui` implementa l'interfaccia `ExtensionUIContext`. Il supporto varia in base alla modalità.

### Modalità interattiva (`extension-ui-controller.ts`)

Supportato:

- dialoghi: `select`, `confirm`, `input`, `editor`
- notifiche/stato/testo editor/input terminale/overlay personalizzati
- elenco/caricamento temi per nome (`setTheme` supporta nomi stringa)
- toggle espansione strumenti

Metodi attualmente no-op in questo controller:

- `setFooter`
- `setHeader`
- `setEditorComponent`

Nota anche: `setWidget` attualmente inoltra al testo della riga di stato tramite `setHookWidget(...)`.

### Modalità RPC (`rpc-mode.ts`)

`ctx.ui` è supportato da eventi RPC `extension_ui_request`:

- i metodi di dialogo (`select`, `confirm`, `input`, `editor`) effettuano round-trip verso le risposte del client
- i metodi fire-and-forget emettono richieste (`notify`, `setStatus`, `setWidget` per array di stringhe, `setTitle`, `setEditorText`)

Non supportati/no-op nell'implementazione RPC:

- `onTerminalInput`
- `custom`
- `setFooter`, `setHeader`, `setEditorComponent`
- `setWorkingMessage`
- cambio/caricamento tema (`setTheme` restituisce fallimento)
- i controlli di espansione degli strumenti sono inerti

### Percorsi print/headless/subagent

Quando nessun contesto UI viene fornito all'inizializzazione del runner, `ctx.hasUI` è `false` e i metodi sono no-op/restituiscono valori predefiniti.

### Modalità interattiva in background

La modalità background installa un oggetto contesto UI non interattivo. Nell'implementazione attuale, `ctx.hasUI` può ancora essere `true` mentre i dialoghi interattivi restituiscono valori predefiniti/comportamento no-op.

## Pattern di sessione e stato

Per lo stato persistente delle estensioni:

1. Persistere con `pi.appendEntry(customType, data)`.
2. Ricostruire lo stato da `ctx.sessionManager.getBranch()` su `session_start`, `session_branch`, `session_tree`.
3. Mantenere strutturati i `details` dei risultati degli strumenti quando lo stato deve essere visibile/ricostruibile dalla cronologia dei risultati degli strumenti.

Pattern di ricostruzione di esempio:

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

## Punti di estensione per il rendering

## Renderer di messaggi personalizzato

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

Utilizzato dal rendering interattivo quando vengono visualizzati messaggi personalizzati.

## Renderer di chiamata/risultato dello strumento

Fornire `renderCall` / `renderResult` nelle definizioni di `registerTool` per la visualizzazione personalizzata degli strumenti nella TUI.

## Vincoli e insidie

- Le azioni runtime non sono disponibili durante il caricamento dell'estensione.
- Gli errori di `tool_call` bloccano l'esecuzione (fail-closed).
- I conflitti di nomi dei comandi con quelli integrati vengono saltati con diagnostica.
- Le scorciatoie riservate vengono ignorate (`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`).
- Trattare `ctx.reload()` come terminale per il frame corrente del gestore del comando.

## Estensioni vs hook vs custom-tools

Utilizzare la superficie appropriata:

- **Estensioni** (`src/extensibility/extensions/*`): sistema unificato (eventi + strumenti + comandi + renderer + registrazione provider).
- **Hook** (`src/extensibility/hooks/*`): API eventi legacy separata.
- **Custom-tools** (`src/extensibility/custom-tools/*`): moduli focalizzati sugli strumenti; quando caricati insieme alle estensioni vengono adattati e passano comunque attraverso i wrapper di intercettazione delle estensioni.

Se è necessario un singolo pacchetto che gestisce policy, strumenti, UX dei comandi e rendering insieme, utilizzare le estensioni.
