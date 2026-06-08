---
title: Custom Tools
description: >-
  Registrazione di strumenti personalizzati, definizione dello schema e pipeline
  di esecuzione per estendere l'agente.
sidebar:
  order: 4
  label: Custom tools
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# Strumenti Personalizzati

Gli strumenti personalizzati sono funzioni richiamabili dal modello che si integrano nella stessa pipeline di esecuzione degli strumenti built-in.

Uno strumento personalizzato è un modulo TypeScript/JavaScript che esporta una factory. La factory riceve un'API host (`CustomToolAPI`) e restituisce uno strumento o un array di strumenti.

## Cosa è (e cosa non è)

- **Strumento personalizzato**: richiamabile dal modello durante un turno (`execute` + schema TypeBox).
- **Estensione**: framework di ciclo di vita/eventi che può registrare strumenti e intercettare/modificare eventi.
- **Hook**: script esterni pre/post comando.
- **Skill**: pacchetto statico di guida/contesto, non codice eseguibile di strumenti.

Se avete bisogno che il modello richiami direttamente del codice, utilizzate uno strumento personalizzato.

## Percorsi di integrazione nel codice attuale

Esistono due stili di integrazione attivi:

1. **Strumenti personalizzati forniti dall'SDK** (`options.customTools`)
   - Incapsulati in strumenti dell'agente tramite `CustomToolAdapter` o wrapper di estensioni.
   - Sempre inclusi nel set iniziale di strumenti attivi nel bootstrap dell'SDK.

2. **Moduli scoperti dal filesystem tramite API loader** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - Esposti come API di libreria in `src/extensibility/custom-tools/loader.ts`.
   - Il codice host può richiamare queste API per scoprire e caricare moduli di strumenti da percorsi di configurazione/provider/plugin.

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

## Posizioni di scoperta (API loader)

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` unisce:

1. Provider di capacità (`toolCapability`), inclusi:
   - Configurazione OMP nativa (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Configurazione Claude (`~/.claude/tools`, `.claude/tools`)
   - Configurazione Codex (`~/.codex/tools`, `.codex/tools`)
   - Provider della cache del marketplace di plugin Claude
2. Manifesti di plugin installati (`~/.xcsh/plugins/node_modules/*` tramite il loader dei plugin)
3. Percorsi configurati esplicitamente passati al loader

### Comportamento importante

- I percorsi risolti duplicati vengono deduplicati.
- I conflitti di nomi degli strumenti vengono rifiutati rispetto ai built-in e agli strumenti personalizzati già caricati.
- I file `.md` e `.json` vengono scoperti come metadati degli strumenti da alcuni provider, ma il loader dei moduli eseguibili li rifiuta come strumenti eseguibili.
- I percorsi configurati relativi vengono risolti a partire da `cwd`; `~` viene espanso.

## Contratto del modulo

Un modulo di strumento personalizzato deve esportare una funzione (preferibilmente come export default):

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

Tipo di ritorno della factory:

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## Superficie API passata alle factory (`CustomToolAPI`)

Da `types.ts` e `loader.ts`:

- `cwd`: directory di lavoro dell'host
- `exec(command, args, options?)`: helper per l'esecuzione di processi
- `ui`: contesto UI (può essere no-op in modalità headless)
- `hasUI`: `false` nei flussi non interattivi
- `logger`: logger condiviso su file
- `typebox`: `@sinclair/typebox` iniettato
- `pi`: export di `@f5xc-salesdemos/xcsh` iniettati
- `pushPendingAction(action)`: registra un'azione di anteprima per lo strumento nascosto `resolve` (`docs/resolve-tool-runtime.md`)

Il loader parte con un contesto UI no-op e richiede che il codice host chiami `setUIContext(...)` quando l'UI reale è pronta.

## Contratto di esecuzione e tipizzazione

Firma di `CustomTool.execute`:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` è tipizzato staticamente dal vostro schema TypeBox tramite `Static<TParams>`.
- La validazione degli argomenti a runtime avviene prima dell'esecuzione nel loop dell'agente.
- `onUpdate` emette risultati parziali per lo streaming dell'UI.
- `ctx` include lo stato della sessione/modello e un helper `abort()`.
- `signal` trasporta la cancellazione.

`CustomToolAdapter` fa da ponte verso l'interfaccia degli strumenti dell'agente e inoltra le chiamate nell'ordine corretto degli argomenti.

## Come gli strumenti vengono esposti al modello

- Gli strumenti vengono incapsulati in istanze `AgentTool` (`CustomToolAdapter` o wrapper di estensioni).
- Vengono inseriti nel registro degli strumenti della sessione per nome.
- Nel bootstrap dell'SDK, gli strumenti personalizzati e quelli registrati dalle estensioni vengono forzatamente inclusi nel set attivo iniziale.
- L'opzione CLI `--tools` attualmente valida solo i nomi degli strumenti built-in; l'inclusione degli strumenti personalizzati viene gestita attraverso i percorsi di scoperta/registrazione e le opzioni dell'SDK.

## Hook di rendering

Hook di rendering opzionali:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

Comportamento a runtime nella TUI:

- Se gli hook esistono, l'output dello strumento viene renderizzato all'interno di un contenitore `Box`.
- `renderResult` riceve `{ expanded, isPartial, spinnerFrame? }`.
- Gli errori del renderer vengono catturati e registrati nel log; l'UI torna al rendering testuale predefinito.

## Gestione della sessione/stato

L'opzionale `onSession(event, ctx)` riceve eventi del ciclo di vita della sessione, inclusi:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

Utilizzate `ctx.sessionManager` per ricostruire lo stato dalla cronologia quando il contesto di branch/sessione cambia.

## Semantica di fallimenti e cancellazione

### Fallimenti sincroni/asincroni

- Il lancio di eccezioni (o promise rifiutate) in `execute` viene trattato come fallimento dello strumento.
- Il runtime dell'agente converte i fallimenti in messaggi di risultato dello strumento con `isError: true` e contenuto testuale dell'errore.
- Con i wrapper delle estensioni, i gestori `tool_result` possono ulteriormente riscrivere contenuto/dettagli e persino sovrascrivere lo stato di errore.

### Cancellazione

- L'abort dell'agente si propaga attraverso `AbortSignal` a `execute`.
- Inoltrate `signal` al lavoro dei sottoprocessi (`pi.exec(..., { signal })`) per la cancellazione cooperativa.
- `ctx.abort()` permette a uno strumento di richiedere l'abort dell'operazione corrente dell'agente.

### Errori di onSession

- Gli errori di `onSession` vengono catturati e registrati come warning; non causano il crash della sessione.

## Vincoli reali per la progettazione

- I nomi degli strumenti devono essere globalmente univoci nel registro attivo.
- Preferite output deterministici e conformi allo schema in `details` per la ricostruzione del renderer/stato.
- Proteggete l'uso dell'UI con `pi.hasUI`.
- Trattate i file `.md`/`.json` nelle directory degli strumenti come metadati, non come moduli eseguibili.
