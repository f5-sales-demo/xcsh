---
title: Hooks
description: >-
  Sistema di hook per l'automazione pre/post evento nel ciclo di vita
  dell'agente di coding.
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

Il pacchetto hook (`src/extensibility/hooks/`) è ancora esportato e utilizzabile come superficie API, ma il runtime CLI predefinito ora inizializza il percorso **extension runner**. Nel flusso di avvio attuale:

- `--hook` è trattato come un alias per `--extension` (i percorsi CLI vengono uniti in `additionalExtensionPaths`)
- gli strumenti sono avvolti da `ExtensionToolWrapper`, non da `HookToolWrapper`
- le trasformazioni di contesto e le emissioni del ciclo di vita passano attraverso `ExtensionRunner`

Quindi questo file documenta l'implementazione del sottosistema hook stesso (tipi/loader/runner/wrapper), incluso il comportamento legacy e i vincoli.

## File principali

- `src/extensibility/hooks/types.ts` — contesto hook, tipi di evento e contratti dei risultati
- `src/extensibility/hooks/loader.ts` — caricamento moduli e bridge di discovery degli hook
- `src/extensibility/hooks/runner.ts` — dispatch degli eventi, ricerca comandi, segnalazione errori
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

## Discovery e caricamento

`discoverAndLoadHooks(configuredPaths, cwd)` esegue:

1. Caricamento degli hook scoperti dal registro delle capability (`loadCapability("hooks")`)
2. Aggiunta dei percorsi configurati esplicitamente (deduplicati per percorso assoluto)
3. Chiamata a `loadHooks(allPaths, cwd)`

`loadHooks` quindi importa ogni percorso e si aspetta una funzione `default`.

### Risoluzione dei percorsi

`loader.ts` risolve i percorsi degli hook come:

- percorso assoluto: usato così com'è
- percorso `~`: espanso
- percorso relativo: risolto rispetto a `cwd`

### Importante discrepanza legacy

I provider di discovery per `hookCapability` modellano ancora file hook in stile shell pre/post (ad esempio `.claude/hooks/pre/*`, `.xcsh/.../hooks/pre/*`).

Il loader degli hook qui usa l'import dinamico di moduli e richiede una factory hook JS/TS con export default. Se un percorso hook scoperto non è importabile come modulo, il caricamento fallisce e viene riportato in `LoadHooksResult.errors`.

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

Questo è il modello core di intercettazione pre/post del sottosistema hook.

```text
Flusso di intercettazione strumento degli hook

gestori tool_call
   │
   ├─ qualcuno { block: true }? ── sì ──> throw (strumento bloccato)
   │
   └─ no
      │
      ▼
   esecuzione strumento sottostante
      │
      ├─ successo ──> i gestori tool_result possono sovrascrivere { content, details }
      │
      └─ errore   ──> emette tool_result(isError=true) poi rilancia l'errore originale
```

## Modello di esecuzione e semantica delle mutazioni

### 1) Pre-esecuzione: `tool_call`

`HookToolWrapper.execute()` emette `tool_call` prima dell'esecuzione dello strumento.

- se qualsiasi gestore restituisce `{ block: true }`, l'esecuzione si ferma
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

Se il gestore restituisce sovrascritture:

- `content` può sostituire il contenuto del risultato
- `details` può sostituire i dettagli del risultato

In caso di fallimento dello strumento, il wrapper emette `tool_result` con `isError: true` e il testo dell'errore come contenuto, poi rilancia l'errore originale.

### Cosa possono mutare gli hook

- Contesto LLM per una singola chiamata tramite `context` (catena di sostituzione `messages`)
- Contenuto/dettagli dell'output dello strumento nelle chiamate strumento riuscite (percorso `tool_result`)
- Messaggio iniettato pre-agente tramite `before_agent_start`
- Comportamento di cancellazione/compattazione personalizzata/albero tramite `session_before_*` e `session.compacting`

### Cosa gli hook non possono mutare in questa implementazione

- Parametri di input dello strumento raw sul posto (solo blocco/permesso su `tool_call`)
- Continuazione dell'esecuzione dopo errori dello strumento lanciati (il percorso errore rilancia)
- Stato finale successo/errore nel comportamento del wrapper (`isError` restituito è tipizzato ma non applicato da `HookToolWrapper`)

## Ordinamento e comportamento in caso di conflitti

### Ordinamento a livello di discovery

I provider di capability sono ordinati per priorità (più alta prima). La deduplicazione è per chiave di capability, il primo vince.

Per `hooks`, la chiave di capability è `${type}:${tool}:${name}`. I duplicati oscurati da provider a priorità inferiore vengono marcati ed esclusi dalla lista effettiva scoperta.

### Ordine di caricamento

`discoverAndLoadHooks` costruisce una lista piatta `allPaths`, deduplicata per percorso assoluto risolto, poi `loadHooks` itera in quell'ordine.
L'ordine dei file all'interno di ogni directory scoperta dipende dall'output di `readdir`; il loader degli hook non effettua un ordinamento aggiuntivo.

### Ordine dei gestori a runtime

All'interno di `HookRunner`, l'ordine è deterministico per sequenza di registrazione:

1. ordine dell'array degli hook
2. ordine di registrazione dei gestori per hook/evento

Comportamento in caso di conflitti per tipo di evento:

- `tool_call`: l'ultimo risultato restituito vince a meno che un gestore non blocchi; il primo blocco interrompe immediatamente
- `tool_result`: l'ultima sovrascrittura restituita vince (nessuna interruzione anticipata)
- `context`: concatenato; ogni gestore riceve l'output dei messaggi del gestore precedente
- `before_agent_start`: il primo messaggio restituito viene mantenuto; i messaggi successivi vengono ignorati
- `session_before_*`: l'ultimo risultato restituito viene tracciato; `cancel: true` interrompe immediatamente
- `session.compacting`: l'ultimo risultato restituito vince

Conflitti di comandi/renderer:

- `getCommand(name)` restituisce la prima corrispondenza tra tutti gli hook (il primo caricato vince)
- `getMessageRenderer(customType)` restituisce la prima corrispondenza
- `getRegisteredCommands()` restituisce tutti i comandi (senza deduplicazione)

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

`HookRunner.emit(...)` cattura gli errori dei gestori per la maggior parte degli eventi ed emette `HookError` ai listener (`hookPath`, `event`, `error`), poi continua.

`emitToolCall(...)` è più rigoroso: gli errori dei gestori non vengono soppressi lì; si propagano al chiamante. In `HookToolWrapper`, questo blocca la chiamata allo strumento (fail-safe).

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

### Registrare un comando slash con metodi di contesto command-safe

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

E la radice del pacchetto (`src/index.ts`) ri-esporta i **tipi** hook come superficie di compatibilità legacy.
