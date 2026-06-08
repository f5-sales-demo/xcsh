---
title: Hooks
description: >-
  Sistema di hook per l'automazione pre/post evento nel ciclo di vita
  dell'agente di codifica.
sidebar:
  order: 4
  label: Hooks
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# Hooks

Questo documento descrive il **codice attuale del sottosistema hook** in `src/extensibility/hooks/*`.

## Stato attuale nel runtime

Il pacchetto hook (`src/extensibility/hooks/`) è ancora esportato e utilizzabile come superficie API, ma il runtime CLI predefinito ora inizializza il percorso dell'**extension runner**. Nel flusso di avvio attuale:

- `--hook` è trattato come un alias per `--extension` (i percorsi CLI vengono uniti in `additionalExtensionPaths`)
- gli strumenti sono wrappati da `ExtensionToolWrapper`, non da `HookToolWrapper`
- le trasformazioni di contesto e le emissioni del ciclo di vita passano attraverso `ExtensionRunner`

Quindi questo file documenta l'implementazione del sottosistema hook stesso (tipi/loader/runner/wrapper), incluso il comportamento legacy e i vincoli.

## File principali

- `src/extensibility/hooks/types.ts` — contesto hook, tipi di evento e contratti di risultato
- `src/extensibility/hooks/loader.ts` — caricamento moduli e bridge di scoperta hook
- `src/extensibility/hooks/runner.ts` — dispatch eventi, ricerca comandi, segnalazione errori
- `src/extensibility/hooks/tool-wrapper.ts` — wrapper di intercettazione pre/post strumento
- `src/extensibility/hooks/index.ts` — esportazioni/ri-esportazioni

## Cos'è un modulo hook

Un modulo hook deve esportare come default una factory:

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

La factory può:

- registrare gestori di eventi con `pi.on(...)`
- inviare messaggi personalizzati persistenti con `pi.sendMessage(...)`
- persistere stato non-LLM con `pi.appendEntry(...)`
- registrare comandi slash tramite `pi.registerCommand(...)`
- registrare renderer di messaggi personalizzati tramite `pi.registerMessageRenderer(...)`
- eseguire comandi shell tramite `pi.exec(...)`

## Scoperta e caricamento

`discoverAndLoadHooks(configuredPaths, cwd)` esegue:

1. Carica gli hook scoperti dal registro delle capability (`loadCapability("hooks")`)
2. Aggiunge i percorsi configurati esplicitamente (deduplicati per percorso assoluto)
3. Chiama `loadHooks(allPaths, cwd)`

`loadHooks` quindi importa ogni percorso e si aspetta una funzione `default`.

### Risoluzione dei percorsi

`loader.ts` risolve i percorsi degli hook come:

- percorso assoluto: utilizzato così com'è
- percorso `~`: espanso
- percorso relativo: risolto rispetto a `cwd`

### Importante disallineamento legacy

I provider di scoperta per `hookCapability` modellano ancora file hook pre/post in stile shell (ad esempio `.claude/hooks/pre/*`, `.xcsh/.../hooks/pre/*`).

Il loader degli hook qui utilizza l'import dinamico di moduli e richiede una factory hook JS/TS con export default. Se un percorso hook scoperto non è importabile come modulo, il caricamento fallisce e viene segnalato in `LoadHooksResult.errors`.

## Superfici degli eventi

Gli eventi hook sono fortemente tipizzati in `types.ts`.

### Eventi di sessione

- `session_start`
- `session_before_switch` → può restituire `{ cancel?: boolean }`
- `session_switch`
- `session_before_branch` → può restituire `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_branch`
- `session_before_compact` → può restituire `{ cancel?: boolean; compaction?: CompactionResult }`
- `session.compacting` → può restituire `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }`
- `session_compact`
- `session_before_tree` → può restituire `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`
- `session_tree`
- `session_shutdown`

### Eventi agente/contesto

- `context` → può restituire `{ messages?: Message[] }`
- `before_agent_start` → può restituire `{ message?: { customType; content; display; details } }`
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

### Eventi strumento (modello pre/post)

- `tool_call` (pre-esecuzione) → può restituire `{ block?: boolean; reason?: string }`
- `tool_result` (post-esecuzione) → può restituire `{ content?; details?; isError? }`

Questo è il modello centrale di intercettazione pre/post del sottosistema hook.

```text
Hook tool interception flow

tool_call handlers
   │
   ├─ any { block: true }? ── yes ──> throw (tool blocked)
   │
   └─ no
      │
      ▼
   execute underlying tool
      │
      ├─ success ──> tool_result handlers can override { content, details }
      │
      └─ error   ──> emit tool_result(isError=true) then rethrow original error
```

## Modello di esecuzione e semantica delle mutazioni

### 1) Pre-esecuzione: `tool_call`

`HookToolWrapper.execute()` emette `tool_call` prima dell'esecuzione dello strumento.

- se qualsiasi gestore restituisce `{ block: true }`, l'esecuzione si interrompe
- se il gestore lancia un'eccezione, il wrapper fallisce in modo sicuro e blocca l'esecuzione
- il `reason` restituito diventa il testo dell'errore lanciato

### 2) Esecuzione dello strumento

Lo strumento sottostante viene eseguito normalmente se non bloccato.

### 3) Post-esecuzione: `tool_result`

Dopo il successo, il wrapper emette `tool_result` con:

- `toolName`, `toolCallId`, `input`
- `content`
- `details`
- `isError: false`

Se il gestore restituisce override:

- `content` può sostituire il contenuto del risultato
- `details` può sostituire i dettagli del risultato

In caso di fallimento dello strumento, il wrapper emette `tool_result` con `isError: true` e il testo dell'errore come contenuto, quindi rilancia l'errore originale.

### Cosa gli hook possono mutare

- Il contesto LLM per una singola chiamata tramite `context` (catena di sostituzione `messages`)
- Il contenuto/dettagli dell'output dello strumento su chiamate strumento riuscite (percorso `tool_result`)
- Il messaggio iniettato pre-agente tramite `before_agent_start`
- Il comportamento di cancellazione/compattazione personalizzata/albero tramite `session_before_*` e `session.compacting`

### Cosa gli hook non possono mutare in questa implementazione

- I parametri di input dello strumento raw in-place (solo blocco/permesso su `tool_call`)
- La continuazione dell'esecuzione dopo errori dello strumento lanciati (il percorso di errore rilancia)
- Lo stato finale successo/errore nel comportamento del wrapper (`isError` restituito è tipizzato ma non applicato da `HookToolWrapper`)

## Ordinamento e comportamento in caso di conflitti

### Ordinamento a livello di scoperta

I provider delle capability sono ordinati per priorità (più alta prima). La deduplicazione avviene per chiave di capability, il primo vince.

Per `hooks`, la chiave di capability è `${type}:${tool}:${name}`. I duplicati oscurati da provider a priorità inferiore vengono contrassegnati ed esclusi dalla lista effettiva scoperta.

### Ordine di caricamento

`discoverAndLoadHooks` costruisce una lista piatta `allPaths`, deduplicata per percorso assoluto risolto, quindi `loadHooks` itera in quell'ordine.
L'ordine dei file all'interno di ogni directory scoperta dipende dall'output di `readdir`; il loader degli hook non esegue un ordinamento aggiuntivo.

### Ordine dei gestori a runtime

All'interno di `HookRunner`, l'ordine è deterministico per sequenza di registrazione:

1. ordine dell'array hooks
2. ordine di registrazione dei gestori per hook/evento

Comportamento in caso di conflitto per tipo di evento:

- `tool_call`: l'ultimo risultato restituito vince a meno che un gestore non blocchi; il primo blocco causa un cortocircuito
- `tool_result`: l'ultimo override restituito vince (nessun cortocircuito)
- `context`: concatenato; ogni gestore riceve l'output dei messaggi del gestore precedente
- `before_agent_start`: il primo messaggio restituito viene mantenuto; i messaggi successivi vengono ignorati
- `session_before_*`: l'ultimo risultato restituito viene tracciato; `cancel: true` causa un cortocircuito immediato
- `session.compacting`: l'ultimo risultato restituito vince

Conflitti di comandi/renderer:

- `getCommand(name)` restituisce la prima corrispondenza tra gli hook (il primo caricato vince)
- `getMessageRenderer(customType)` restituisce la prima corrispondenza
- `getRegisteredCommands()` restituisce tutti i comandi (nessuna deduplicazione)

## Interazioni UI (`HookContext.ui`)

`HookUIContext` include:

- `select`, `confirm`, `input`, `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`, `getEditorText`
- getter `theme`

`ctx.hasUI` indica se l'interfaccia utente interattiva è disponibile.

Quando si esegue senza UI, il comportamento predefinito del contesto no-op è:

- `select/input/editor` restituiscono `undefined`
- `confirm` restituisce `false`
- `notify`, `setStatus`, `setEditorText` sono no-op
- `getEditorText` restituisce `""`

### Comportamento della riga di stato

Il testo di stato dell'hook impostato tramite `ctx.ui.setStatus(key, text)` è:

- memorizzato per chiave
- ordinato per nome della chiave
- sanificato (`\r`, `\n`, `\t` → spazi; spazi ripetuti compressi)
- unito e troncato in larghezza per la visualizzazione

## Propagazione degli errori e fallback

### Al momento del caricamento

- modulo non valido o export default mancante → catturato in `LoadHooksResult.errors`
- il caricamento continua per gli altri hook

### Al momento dell'evento

`HookRunner.emit(...)` cattura gli errori dei gestori per la maggior parte degli eventi ed emette `HookError` ai listener (`hookPath`, `event`, `error`), quindi continua.

`emitToolCall(...)` è più rigoroso: gli errori dei gestori non vengono soppressi; si propagano al chiamante. In `HookToolWrapper`, questo blocca la chiamata dello strumento (fail-safe).

## Esempi API realistici

### Bloccare comandi bash non sicuri

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

### Oscurare l'output dello strumento in post-esecuzione

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

### Modificare il contesto del modello per chiamata LLM

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### Registrare un comando slash con metodi di contesto sicuri per i comandi

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

## Superficie di esportazione

`src/extensibility/hooks/index.ts` esporta:

- API di caricamento (`discoverAndLoadHooks`, `loadHooks`)
- runner e wrapper (`HookRunner`, `HookToolWrapper`)
- tutti i tipi hook
- ri-esportazione di `execCommand`

E la root del pacchetto (`src/index.ts`) ri-esporta i **tipi** hook come superficie di compatibilità legacy.
