---
title: SDK
description: >-
  SDK per la creazione di agenti personalizzati e integrazioni sul runtime
  dell'agente di codifica xcsh.
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

L'SDK è la superficie di integrazione in-process per `@f5-sales-demo/xcsh`.
Utilizzarlo quando si desidera accesso diretto allo stato dell'agente, allo streaming di eventi, al collegamento degli strumenti e al controllo della sessione dal proprio processo Bun/Node.

Se è necessario l'isolamento cross-linguaggio/processo, utilizzare invece la modalità RPC.

## Installazione

```bash
bun add @f5-sales-demo/xcsh
```

## Punti di ingresso

`@f5-sales-demo/xcsh` esporta le API dell'SDK dalla radice del pacchetto (e anche tramite `@f5-sales-demo/xcsh/sdk`).

Esportazioni principali per gli embedder:

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- Helper di discovery (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- Superficie factory degli strumenti (`createTools`, `BUILTIN_TOOLS`, classi di strumenti)

## Avvio rapido (impostazioni predefinite di auto-discovery)

```ts
import { createAgentSession } from "@f5-sales-demo/xcsh";

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

## Cosa scopre `createAgentSession()` per impostazione predefinita

`createAgentSession()` segue il principio "fornire per sovrascrivere, omettere per scoprire".

Se omesso, risolve:

- `cwd`: `getProjectDir()`
- `agentDir`: `~/.xcsh/agent` (tramite `getAgentDir()`)
- `authStorage`: `discoverAuthStorage(agentDir)`
- `modelRegistry`: `new ModelRegistry(authStorage)` + `await refresh()`
- `settings`: `await Settings.init({ cwd, agentDir })`
- `sessionManager`: `SessionManager.create(cwd)` (basato su file)
- skills/file di contesto/template di prompt/comandi slash/estensioni/comandi TS personalizzati
- strumenti integrati tramite `createTools(...)`
- strumenti MCP (abilitati per impostazione predefinita)
- integrazione LSP (abilitata per impostazione predefinita)

### Input obbligatori vs opzionali

In genere è necessario fornire solo ciò che si desidera controllare:

- **Da fornire obbligatoriamente**: niente per una sessione minimale
- **Di solito forniti esplicitamente** negli embedder:
    - `sessionManager` (se si necessita di in-memory o di una posizione personalizzata)
    - `authStorage` + `modelRegistry` (se si gestisce il ciclo di vita delle credenziali/modelli)
    - `model` o `modelPattern` (se la selezione deterministica del modello è importante)
    - `settings` (se si necessita di una configurazione isolata/di test)

## Comportamento del gestore di sessione (persistente vs in-memory)

`AgentSession` utilizza sempre un `SessionManager`; il comportamento dipende dalla factory utilizzata.

### Basato su file (predefinito)

```ts
import { createAgentSession, SessionManager } from "@f5-sales-demo/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // percorso assoluto .jsonl
```

- Persiste conversazioni/messaggi/delta di stato nei file di sessione.
- Supporta i flussi di lavoro di ripristino/apertura/elenco/fork.
- `session.sessionFile` è definito.

### In-memory

```ts
import { createAgentSession, SessionManager } from "@f5-sales-demo/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- Nessuna persistenza nel filesystem.
- Utile per test, worker effimeri, agenti con scope di richiesta.
- I metodi di sessione funzionano ancora, ma i comportamenti specifici della persistenza (percorsi di ripristino/fork su file) sono naturalmente limitati.

### Helper di ripristino/apertura/elenco

```ts
import { SessionManager } from "@f5-sales-demo/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## Collegamento di modello e autenticazione

`createAgentSession()` utilizza `ModelRegistry` + `AuthStorage` per la selezione del modello e la risoluzione della chiave API.

### Collegamento esplicito

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
} from "@f5-sales-demo/xcsh";

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

### Ordine di selezione quando `model` è omesso

Quando non viene fornito un `model`/`modelPattern` esplicito:

1. ripristino del modello dalla sessione esistente (se ripristinabile + chiave disponibile)
2. ruolo del modello predefinito nelle impostazioni (`default`)
3. primo modello disponibile con autenticazione valida

Se il ripristino fallisce, `modelFallbackMessage` spiega il fallback.

### Priorità di autenticazione

`AuthStorage.getApiKey(...)` risolve in questo ordine:

1. override di runtime (`setRuntimeApiKey`)
2. credenziali memorizzate in `agent.db`
3. variabili d'ambiente del provider
4. fallback del resolver custom-provider (se configurato)

## Modello di sottoscrizione agli eventi

Sottoscrivere con `session.subscribe(listener)`; restituisce una funzione di annullamento della sottoscrizione.

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

`AgentSessionEvent` include gli `AgentEvent` principali più gli eventi a livello di sessione:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## Ciclo di vita del prompt

`session.prompt(text, options?)` è il punto di ingresso principale.

Comportamento:

1. espansione opzionale di comandi/template (comandi `/`, comandi personalizzati, comandi slash da file, template di prompt)
2. se attualmente in streaming:
    - richiede `streamingBehavior: "steer" | "followUp"`
    - mette in coda invece di scartare il lavoro
3. se inattivo:
    - valida il modello + la chiave API
    - aggiunge il messaggio utente
    - avvia il turno dell'agente

API correlate:

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## Strumenti e integrazione delle estensioni

### Integrati e filtraggio

- Gli integrati provengono da `createTools(...)` e `BUILTIN_TOOLS`.
- `toolNames` funge da allowlist per gli integrati.
- Gli strumenti `customTools` e quelli registrati dalle estensioni sono comunque inclusi.
- Gli strumenti nascosti (ad esempio `submit_result`) sono opt-in a meno che non siano richiesti dalle opzioni.

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### Estensioni

- `extensions`: `ExtensionFactory[]` inline
- `additionalExtensionPaths`: carica file di estensione aggiuntivi
- `disableExtensionDiscovery`: disabilita la scansione automatica delle estensioni
- `preloadedExtensions`: riutilizza un set di estensioni già caricato

### Modifiche al set di strumenti a runtime

`AgentSession` supporta aggiornamenti di attivazione a runtime:

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

Il prompt di sistema viene ricostruito per riflettere le modifiche agli strumenti attivi.

## Helper di discovery

Utilizzarli quando si desidera un controllo parziale senza ricreare la logica di discovery interna:

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## Opzioni orientate ai subagent

Per i consumatori dell'SDK che costruiscono orchestratori (simile al flusso dell'esecutore di task):

- `outputSchema`: trasmette l'aspettativa di output strutturato nel contesto dello strumento
- `requireSubmitResultTool`: forza l'inclusione dello strumento `submit_result`
- `taskDepth`: contesto di profondità di ricorsione per sessioni di task annidate
- `parentTaskPrefix`: prefisso di denominazione degli artefatti per gli output di task annidate

Questi sono opzionali per il normale embedding a singolo agente.

## Valore di ritorno di `createAgentSession()`

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

Utilizzare `setToolUIContext(...)` solo se il proprio embedder fornisce capacità UI che gli strumenti/le estensioni devono richiamare.

## Esempio minimale di embed controllato

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
 Settings,
} from "@f5-sales-demo/xcsh";

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
