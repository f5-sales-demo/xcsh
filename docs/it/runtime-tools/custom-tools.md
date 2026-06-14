---
title: Strumenti personalizzati
description: >-
  Registrazione di strumenti personalizzati, definizione dello schema e pipeline
  di esecuzione per estendere l'agente.
sidebar:
  order: 4
  label: Strumenti personalizzati
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# Strumenti personalizzati

Gli strumenti personalizzati sono funzioni richiamabili dal modello che si collegano alla stessa pipeline di esecuzione degli strumenti integrati.

Uno strumento personalizzato è un modulo TypeScript/JavaScript che esporta una factory. La factory riceve un'API host (`CustomToolAPI`) e restituisce uno strumento o un array di strumenti.

## Cosa è (e cosa non è)

- **Strumento personalizzato**: richiamabile dal modello durante un turno (`execute` + schema TypeBox).
- **Estensione**: framework lifecycle/eventi che può registrare strumenti e intercettare/modificare eventi.
- **Hook**: script pre/post comando esterni.
- **Skill**: pacchetto statico di guidance/contesto, non codice eseguibile come strumento.

Se si necessita che il modello chiami codice direttamente, utilizzare uno strumento personalizzato.

## Percorsi di integrazione nel codice corrente

Esistono due stili di integrazione attivi:

1. **Strumenti personalizzati forniti dall'SDK** (`options.customTools`)
   - Incapsulati in strumenti agente tramite `CustomToolAdapter` o wrapper di estensione.
   - Sempre inclusi nell'insieme di strumenti attivi iniziale durante il bootstrap dell'SDK.

2. **Moduli scoperti da filesystem tramite API loader** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - Esposti come API di libreria in `src/extensibility/custom-tools/loader.ts`.
   - Il codice host può chiamarli per scoprire e caricare moduli di strumenti da percorsi di configurazione/provider/plugin.

```text
Model tool call flow

LLM tool call
   │
   ▼
Tool registry (built-ins + custom tool adapters)
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> streamed partial result
   └─ return result  -> final tool content/details
```

## Posizioni di discovery (API loader)

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` combina:

1. Provider di capacità (`toolCapability`), inclusi:
   - Configurazione nativa OMP (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Configurazione Claude (`~/.claude/tools`, `.claude/tools`)
   - Configurazione Codex (`~/.codex/tools`, `.codex/tools`)
   - Provider della cache dei plugin del marketplace Claude
2. Manifest dei plugin installati (`~/.xcsh/plugins/node_modules/*` tramite plugin loader)
3. Percorsi configurati esplicitamente passati al loader

### Comportamento importante

- I percorsi risolti duplicati vengono deduplicati.
- I conflitti di nome degli strumenti vengono rifiutati rispetto agli strumenti integrati e agli strumenti personalizzati già caricati.
- I file `.md` e `.json` vengono scoperti come metadati degli strumenti da alcuni provider, ma il loader dei moduli eseguibili li rifiuta come strumenti eseguibili.
- I percorsi configurati relativi vengono risolti da `cwd`; `~` viene espanso.

## Contratto del modulo

Un modulo di strumento personalizzato deve esportare una funzione (export default preferito):

```ts
import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh";

const factory: CustomToolFactory = (pi) => ({
 name: "repo_stats",
 label: "Repo Stats",
 description: "Counts tracked TypeScript files",
 parameters: pi.typebox.Type.Object({
  glob: pi.typebox.Type.Optional(pi.typebox.Type.String({ default: "**/*.ts" })),
 }),

 async execute(toolCallId, params, onUpdate, ctx, signal) {
  onUpdate?.({
   content: [{ type: "text", text: "Scanning files..." }],
   details: { phase: "scan" },
  });

  const result = await pi.exec("git", ["ls-files", params.glob ?? "**/*.ts"], { signal, cwd: pi.cwd });
  if (result.killed) {
   throw new Error("Scan was cancelled");
  }
  if (result.code !== 0) {
   throw new Error(result.stderr || "git ls-files failed");
  }

  const files = result.stdout.split("\n").filter(Boolean);
  return {
   content: [{ type: "text", text: `Found ${files.length} files` }],
   details: { count: files.length, sample: files.slice(0, 10) },
  };
 },

 onSession(event) {
  if (event.reason === "shutdown") {
   // cleanup resources if needed
  }
 },
});

export default factory;
```

Tipo restituito dalla factory:

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## Superficie API passata alle factory (`CustomToolAPI`)

Da `types.ts` e `loader.ts`:

- `cwd`: directory di lavoro dell'host
- `exec(command, args, options?)`: helper per l'esecuzione di processi
- `ui`: contesto UI (può essere no-op in modalità headless)
- `hasUI`: `false` nei flussi non interattivi
- `logger`: logger su file condiviso
- `typebox`: `@sinclair/typebox` iniettato
- `pi`: export di `@f5xc-salesdemos/xcsh` iniettati
- `pushPendingAction(action)`: registra un'azione di anteprima per lo strumento nascosto `resolve` (`docs/resolve-tool-runtime.md`)

Il loader parte con un contesto UI no-op e richiede che il codice host chiami `setUIContext(...)` quando la UI reale è pronta.

## Contratto di esecuzione e tipizzazione

Firma di `CustomTool.execute`:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` è tipizzato staticamente dallo schema TypeBox tramite `Static<TParams>`.
- La validazione degli argomenti a runtime avviene prima dell'esecuzione nel loop dell'agente.
- `onUpdate` emette risultati parziali per lo streaming UI.
- `ctx` include lo stato sessione/modello e un helper `abort()`.
- `signal` trasporta la cancellazione.

`CustomToolAdapter` collega questo all'interfaccia degli strumenti agente e inoltra le chiamate nell'ordine corretto degli argomenti.

## Come gli strumenti vengono esposti al modello

- Gli strumenti vengono incapsulati in istanze `AgentTool` (`CustomToolAdapter` o wrapper di estensione).
- Vengono inseriti nel registro degli strumenti della sessione per nome.
- Nel bootstrap dell'SDK, gli strumenti personalizzati e quelli registrati tramite estensione vengono forzatamente inclusi nell'insieme attivo iniziale.
- La CLI `--tools` attualmente valida solo i nomi degli strumenti integrati; l'inclusione degli strumenti personalizzati è gestita tramite i percorsi di discovery/registrazione e le opzioni dell'SDK.

## Hook di rendering

Hook di rendering opzionali:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

Comportamento a runtime nella TUI:

- Se gli hook esistono, l'output dello strumento viene renderizzato all'interno di un contenitore `Box`.
- `renderResult` riceve `{ expanded, isPartial, spinnerFrame? }`.
- Gli errori del renderer vengono catturati e registrati; la UI ricade sul rendering testuale predefinito.

## Gestione della sessione/stato

L'`onSession(event, ctx)` opzionale riceve gli eventi del ciclo di vita della sessione, inclusi:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

Utilizzare `ctx.sessionManager` per ricostruire lo stato dalla cronologia quando il contesto di branch/sessione cambia.

## Semantica dei fallimenti e della cancellazione

### Fallimenti sincroni/asincroni

- Un'eccezione (o una promise rifiutata) in `execute` viene trattata come fallimento dello strumento.
- Il runtime dell'agente converte i fallimenti in messaggi di risultato dello strumento con `isError: true` e contenuto di testo dell'errore.
- Con i wrapper di estensione, i gestori `tool_result` possono ulteriormente riscrivere contenuto/dettagli e persino sovrascrivere lo stato di errore.

### Cancellazione

- L'abort dell'agente si propaga tramite `AbortSignal` a `execute`.
- Inoltrare `signal` al lavoro sui sottoprocessi (`pi.exec(..., { signal })`) per la cancellazione cooperativa.
- `ctx.abort()` consente a uno strumento di richiedere l'abort dell'operazione corrente dell'agente.

### Errori di onSession

- Gli errori di `onSession` vengono catturati e registrati come avvisi; non causano il crash della sessione.

## Vincoli reali per cui progettare

- I nomi degli strumenti devono essere globalmente univoci nel registro attivo.
- Preferire output deterministici a forma di schema in `details` per il rendering/la ricostruzione dello stato.
- Proteggere l'uso della UI con `pi.hasUI`.
- Trattare i file `.md`/`.json` nelle directory degli strumenti come metadati, non come moduli eseguibili.
