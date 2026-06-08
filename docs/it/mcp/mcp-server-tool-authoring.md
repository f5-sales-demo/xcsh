---
title: MCP Server and Tool Authoring
description: >-
  Guida alla creazione di server MCP personalizzati e alla registrazione di tool
  per il coding agent.
sidebar:
  order: 4
  label: Server & creazione tool
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# Creazione di server e tool MCP

Questo documento spiega come le definizioni dei server MCP diventano tool `mcp_*` invocabili nel coding-agent, e cosa gli operatori devono aspettarsi quando le configurazioni sono invalide, duplicate, disabilitate o protette da autenticazione.

## Architettura a colpo d'occhio

```text
Config sources (.xcsh/.claude/.cursor/.vscode/mcp.json, mcp.json, etc.)
  -> discovery providers normalize to canonical MCPServer
  -> capability loader dedupes by server name (higher provider priority wins)
  -> loadAllMCPConfigs converts to MCPServerConfig + skips enabled:false
  -> MCPManager connects/listTools (with auth/header/env resolution)
  -> MCPTool/DeferredMCPTool bridge exposes tools as mcp_<server>_<tool>
  -> AgentSession.refreshMCPTools replaces live MCP tools immediately
```

## 1) Modello di configurazione del server e validazione

`src/mcp/types.ts` definisce la struttura di authoring utilizzata dagli autori di configurazioni MCP e dal runtime:

- `stdio` (predefinito quando `type` è assente): richiede `command`, opzionali `args`, `env`, `cwd`
- `http`: richiede `url`, opzionali `headers`
- `sse`: richiede `url`, opzionali `headers` (mantenuto per compatibilità)
- campi condivisi: `enabled`, `timeout`, `auth`

`validateServerConfig()` (`src/mcp/config.ts`) applica le regole di base del trasporto:

- rifiuta le configurazioni che impostano sia `command` che `url`
- richiede `command` per stdio
- richiede `url` per http/sse
- rifiuta `type` sconosciuti

`config-writer.ts` applica questa validazione per le operazioni di aggiunta/aggiornamento e valida anche i nomi dei server:

- non vuoti
- massimo 100 caratteri
- solo `[a-zA-Z0-9_.-]`

### Insidie del trasporto

- `type` omesso significa stdio. Se si intendeva HTTP/SSE ma si è omesso `type`, `command` diventa obbligatorio.
- `sse` è ancora accettato ma trattato internamente come trasporto HTTP (`createHttpTransport`).
- La validazione è strutturale, non di raggiungibilità: un URL sintatticamente valido può comunque fallire al momento della connessione.

## 2) Discovery, normalizzazione e precedenza

### Discovery basato sulle capability

`loadAllMCPConfigs()` (`src/mcp/config.ts`) carica gli elementi canonici `MCPServer` tramite `loadCapability(mcpCapability.id)`.

Il livello capability (`src/capability/index.ts`) quindi:

1. carica i provider in ordine di priorità
2. elimina i duplicati per `server.name` (il primo vince = priorità più alta)
3. valida gli elementi deduplicati

Risultato: i nomi di server duplicati tra diverse sorgenti non vengono uniti. Una definizione vince; i duplicati a priorità inferiore vengono oscurati.

### `.mcp.json` e file correlati

Il provider di fallback dedicato in `src/discovery/mcp-json.ts` legge `mcp.json` e `.mcp.json` dalla root del progetto (bassa priorità).

In pratica i server MCP provengono anche da provider a priorità più alta (ad esempio `.xcsh/...` nativi e directory di configurazione specifiche per tool). Indicazioni per l'authoring:

- Preferire `.xcsh/mcp.json` (progetto) o `~/.xcsh/mcp.json` (utente) per un controllo esplicito.
- Usare `mcp.json` / `.mcp.json` nella root quando è necessaria compatibilità di fallback.
- Riutilizzare lo stesso nome di server in più sorgenti causa oscuramento per precedenza, non unione.

### Comportamento di normalizzazione

`convertToLegacyConfig()` (`src/mcp/config.ts`) mappa l'`MCPServer` canonico al `MCPServerConfig` di runtime.

Comportamento chiave:

- il trasporto è inferito come `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- i server disabilitati (`enabled === false`) vengono eliminati prima della connessione
- i campi opzionali vengono preservati quando presenti

### Espansione delle variabili d'ambiente durante il discovery

`mcp-json.ts` espande i segnaposto delle variabili d'ambiente nei campi stringa con `expandEnvVarsDeep()`:

- supporta `${VAR}` e `${VAR:-default}`
- i valori non risolti rimangono stringhe letterali `${VAR}`

`mcp-json.ts` esegue anche controlli di tipo a runtime per il JSON utente e registra warning per valori `enabled`/`timeout` non validi invece di far fallire l'intero file.

## 3) Autenticazione e risoluzione dei valori a runtime

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) è il passaggio finale prima della connessione.

### Iniezione delle credenziali OAuth

Se la configurazione ha:

```ts
auth: { type: "oauth", credentialId: "..." }
```

e la credenziale esiste nello storage di autenticazione:

- `http`/`sse`: inietta l'header `Authorization: Bearer <access_token>`
- `stdio`: inietta la variabile d'ambiente `OAUTH_ACCESS_TOKEN`

Se la ricerca della credenziale fallisce, il manager registra un warning e continua con l'autenticazione non risolta.

### Risoluzione dei valori di header/env

Prima della connessione, il manager risolve ogni valore di header/env tramite `resolveConfigValue()` (`src/config/resolve-config-value.ts`):

- un valore che inizia con `!` => esegue il comando shell, usa lo stdout trimmato (con cache)
- altrimenti, tratta il valore prima come nome di variabile d'ambiente (`process.env[name]`), fallback al valore letterale
- i valori di comando/env non risolti vengono omessi dalla mappa finale di header/env

Avvertenza operativa: questo significa che un comando/chiave env segreto con errore di battitura può rimuovere silenziosamente quella voce di header/env, producendo errori 401/403 a valle o fallimenti nell'avvio del server.

## 4) Bridge dei tool: da MCP a tool invocabili dall'agente

`src/mcp/tool-bridge.ts` converte le definizioni di tool MCP in `CustomTool`.

### Denominazione e dominio delle collisioni

I nomi dei tool vengono generati come:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

Regole:

- conversione in minuscolo
- i caratteri non `[a-z_]` diventano `_`
- gli underscore ripetuti vengono compressi
- il prefisso ridondante `<server>_` nel nome del tool viene rimosso una volta

Questo evita molte collisioni, ma non tutte. Nomi grezzi diversi possono comunque risultare nello stesso identificatore dopo la sanitizzazione (ad esempio `my-server` e `my.server` vengono sanitizzati in modo simile), e l'inserimento nel registro funziona con last-write-wins.

### Mappatura dello schema

`convertSchema()` mantiene lo JSON Schema MCP sostanzialmente invariato ma corregge gli schemi oggetto privi di `properties` con `{}` per la compatibilità con i provider.

### Mappatura dell'esecuzione

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- invoca `tools/call` MCP
- appiattisce il contenuto MCP in testo visualizzabile
- restituisce dettagli strutturati (`serverName`, `mcpToolName`, metadati del provider)
- mappa `isError` riportato dal server in un risultato di testo `Error: ...`
- mappa i fallimenti di trasporto/runtime lanciati come eccezione in `MCP error: ...`
- preserva la semantica di abort traducendo AbortError in `ToolAbortError`

## 5) Ciclo di vita dell'operatore: aggiunta/modifica/rimozione e aggiornamenti in tempo reale

La modalità interattiva espone `/mcp` in `src/modes/controllers/mcp-command-controller.ts`.

Operazioni supportate:

- `add` (wizard o aggiunta rapida)
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

Le scritture di configurazione sono atomiche (`writeMCPConfigFile`: file temporaneo + rinomina).

Dopo le modifiche, il controller chiama `#reloadMCP()`:

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

`refreshMCPTools()` sostituisce tutte le voci `mcp_` nel registro e riattiva immediatamente l'ultimo set di tool MCP, quindi le modifiche hanno effetto senza riavviare la sessione.

### Differenze tra modalità

- **Modalità interattiva/TUI**: `/mcp` fornisce un'interfaccia in-app (wizard, flusso OAuth, testo sullo stato della connessione, rebinding runtime immediato).
- **Integrazione SDK/headless**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) restituisce i tool caricati + errori per server; nessuna UX del comando `/mcp`.

## 6) Superfici di errore visibili all'utente

Stringhe di errore comuni che utenti/operatori visualizzano:

- fallimenti di validazione in aggiunta/aggiornamento:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- problemi con argomenti dell'aggiunta rapida:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- fallimenti di connessione/test:
  - `Failed to connect to "<name>": <message>`
  - testo di aiuto sul timeout che suggerisce di aumentare il timeout
  - testo di aiuto sull'autenticazione per `401/403`
- flussi di autenticazione/OAuth:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- utilizzo di server disabilitati:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

Il JSON sorgente malformato nel discovery viene generalmente gestito come warning/log; i percorsi di config-writer lanciano errori espliciti.

## 7) Indicazioni pratiche per l'authoring

Per un authoring MCP robusto in questo codebase:

1. Mantenere i nomi dei server globalmente univoci tra tutte le sorgenti di configurazione MCP.
2. Preferire nomi alfanumerici/con underscore per evitare collisioni di nomi sanitizzati nei nomi dei tool `mcp_*` generati.
3. Usare `type` esplicito per evitare default stdio accidentali.
4. Trattare `enabled: false` come spegnimento totale: il server viene omesso dal set di connessione a runtime.
5. Per le configurazioni OAuth, memorizzare un `credentialId` valido; altrimenti l'iniezione dell'autenticazione viene saltata.
6. Se si utilizza la risoluzione dei segreti basata su comandi (`!cmd`), verificare che l'output del comando sia stabile e non vuoto.

## File di implementazione

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts)
- [`src/mcp/config-writer.ts`](../../packages/coding-agent/src/mcp/config-writer.ts)
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts)
- [`src/discovery/mcp-json.ts`](../../packages/coding-agent/src/discovery/mcp-json.ts)
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/config/resolve-config-value.ts`](../../packages/coding-agent/src/config/resolve-config-value.ts)
- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts)
