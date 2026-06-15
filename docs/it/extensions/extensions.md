---
title: Estensioni
description: >-
  Panoramica del runtime delle estensioni che copre tipi, ciclo di vita del
  runner, registrazione e discovery.
sidebar:
  order: 1
  label: Panoramica
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# Estensioni

Guida principale per la creazione di estensioni runtime in `packages/coding-agent`.

Questo documento illustra il runtime delle estensioni corrente in:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

Per i percorsi di discovery e le regole di caricamento dal filesystem, consultare `docs/extension-loading.md`.

## Cos'è un'estensione

Un'estensione è un modulo TS/JS che esporta una factory predefinita:

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

Le estensioni possono combinare tutti gli elementi seguenti in un unico modulo:

- gestori di eventi (`pi.on(...)`)
- strumenti richiamabili dall'LLM (`pi.registerTool(...)`)
- comandi slash (`pi.registerCommand(...)`)
- scorciatoie da tastiera e flag
- rendering personalizzato dei messaggi
- API di iniezione sessione/messaggio (`sendMessage`, `sendUserMessage`, `appendEntry`)

## Modello di runtime

1. Le estensioni vengono importate e le loro funzioni factory eseguite.
2. Durante la fase di caricamento, i metodi di registrazione sono validi; i metodi di azione runtime non sono ancora inizializzati.
3. `ExtensionRunner.initialize(...)` collega azioni/contesti attivi per la modalità corrente.
4. Gli eventi del ciclo di vita di sessione/agente/strumento vengono emessi ai gestori.
5. Ogni esecuzione di strumenti è avvolta con l'intercettazione delle estensioni (`tool_call` / `tool_result`).

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

- la chiamata di metodi di azione come `pi.sendMessage()` durante il caricamento dell'estensione genera `ExtensionRuntimeNotInitializedError`
- registrare prima; eseguire il comportamento runtime dagli eventi/comandi/strumenti

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

In modalità interattiva, i gestori `input` vengono eseguiti prima del controllo automatico del titolo del primo messaggio integrato. Le estensioni che chiamano `await pi.setSessionName(...)` da `input` possono impostare il nome della sessione persistente e impedire l'esecuzione del titolo generato automaticamente per tale sessione.

Esposti anche:

- `pi.logger`
- `pi.typebox`
- `pi.pi` (esportazioni del pacchetto)

### Semantica di consegna dei messaggi

`pi.sendMessage(message, options)` supporta:

- `deliverAs: "steer"` (predefinito) — interrompe l'esecuzione corrente
- `deliverAs: "followUp"` — messo in coda per l'esecuzione dopo quella corrente
- `deliverAs: "nextTurn"` — memorizzato e iniettato al prossimo prompt utente
- `triggerTurn: true` — avvia un turno quando inattivo (`nextTurn` ignora questo)

`pi.sendUserMessage(content, { deliverAs })` passa sempre attraverso il flusso di prompt; durante lo streaming viene messo in coda come steer/follow-up.

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

I gestori di comandi ricevono in aggiunta:

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

Utilizzare il contesto del comando per i flussi di controllo della sessione; questi metodi sono intenzionalmente separati dai gestori di eventi generali.

## Superficie degli eventi (nomi e comportamenti correnti)

Le union canoniche degli eventi e i tipi di payload si trovano in `types.ts`.

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

`tool_result` ha stile middleware: i gestori vengono eseguiti nell'ordine delle estensioni e ciascuno vede le modifiche precedenti.

### Segnali di affidabilità/runtime

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### Intercettazione dei comandi utente

- `user_bash` (sovrascrivibile con `{ result }`)
- `user_python` (sovrascrivibile con `{ result }`)

### `resources_discover`

`resources_discover` esiste nei tipi delle estensioni e in `ExtensionRunner`.
Nota sul runtime corrente: `ExtensionRunner.emitResourcesDiscover(...)` è implementato, ma nel codebase corrente non esistono callsite di `AgentSession` che lo invocano.

## Dettagli per la creazione di strumenti

`registerTool` utilizza `ToolDefinition` da `types.ts`.

Firma corrente di `execute`:

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

`tool_call`/`tool_result` intercettano tutti gli strumenti una volta che il registro è incapsulato in `sdk.ts`, inclusi quelli integrati e quelli personalizzati/delle estensioni.

## Punti di integrazione dell'interfaccia utente

`ctx.ui` implementa l'interfaccia `ExtensionUIContext`. Il supporto varia in base alla modalità.

### Modalità interattiva (`extension-ui-controller.ts`)

Supportato:

- finestre di dialogo: `select`, `confirm`, `input`, `editor`
- notifiche/stato/testo editor/input terminale/overlay personalizzati
- elenco/caricamento dei temi per nome (`setTheme` supporta nomi stringa)
- toggle espansione strumenti

Metodi attualmente non operativi in questo controller:

- `setFooter`
- `setHeader`
- `setEditorComponent`

Nota: `setWidget` attualmente instrada verso il testo della barra di stato tramite `setHookWidget(...)`.

### Modalità RPC (`rpc-mode.ts`)

`ctx.ui` è supportato da eventi RPC `extension_ui_request`:

- i metodi di dialogo (`select`, `confirm`, `input`, `editor`) eseguono round-trip verso le risposte del client
- i metodi fire-and-forget emettono richieste (`notify`, `setStatus`, `setWidget` per array di stringhe, `setTitle`, `setEditorText`)

Non supportati/non operativi nell'implementazione RPC:

- `onTerminalInput`
- `custom`
- `setFooter`, `setHeader`, `setEditorComponent`
- `setWorkingMessage`
- cambio/caricamento del tema (`setTheme` restituisce un errore)
- i controlli di espansione degli strumenti sono inerti

### Percorsi print/headless/subagent

Quando al runner init non viene fornito alcun contesto UI, `ctx.hasUI` è `false` e i metodi sono no-op/restituiscono valori predefiniti.

### Modalità interattiva in background

La modalità background installa un oggetto di contesto UI non interattivo. Nell'implementazione corrente, `ctx.hasUI` può comunque essere `true` mentre le finestre di dialogo interattive restituiscono valori predefiniti/comportamento no-op.

## Sessione e pattern di stato

Per lo stato durevole delle estensioni:

1. Persistere con `pi.appendEntry(customType, data)`.
2. Ricostruire lo stato da `ctx.sessionManager.getBranch()` su `session_start`, `session_branch`, `session_tree`.
3. Mantenere i `details` del risultato degli strumenti strutturati quando lo stato deve essere visibile/ricostruibile dalla cronologia dei risultati degli strumenti.

Esempio di pattern di ricostruzione:

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

## Punti di estensione del rendering

## Renderer personalizzato per i messaggi

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

Utilizzato dal rendering interattivo quando vengono visualizzati messaggi personalizzati.

## Renderer di chiamata/risultato degli strumenti

Fornire `renderCall` / `renderResult` nelle definizioni `registerTool` per la visualizzazione personalizzata degli strumenti nel TUI.

## Vincoli e insidie

- Le azioni runtime non sono disponibili durante il caricamento dell'estensione.
- Gli errori di `tool_call` bloccano l'esecuzione (fail-closed).
- I conflitti di nome dei comandi con quelli integrati vengono ignorati con diagnostiche.
- Le scorciatoie riservate vengono ignorate (`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`).
- Trattare `ctx.reload()` come terminale per il frame del gestore del comando corrente.

## Estensioni vs hook vs strumenti personalizzati

Utilizzare la superficie appropriata:

- **Estensioni** (`src/extensibility/extensions/*`): sistema unificato (eventi + strumenti + comandi + renderer + registrazione provider).
- **Hook** (`src/extensibility/hooks/*`): API eventi legacy separata.
- **Strumenti personalizzati** (`src/extensibility/custom-tools/*`): moduli orientati agli strumenti; quando caricati insieme alle estensioni vengono adattati e passano comunque attraverso i wrapper di intercettazione delle estensioni.

Se si necessita di un unico pacchetto che gestisca policy, strumenti, UX dei comandi e rendering insieme, utilizzare le estensioni.
