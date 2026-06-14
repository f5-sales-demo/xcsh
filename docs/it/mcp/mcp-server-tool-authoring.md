---
title: Creazione di server e strumenti MCP
description: >-
  Guida alla creazione di server MCP personalizzati e alla registrazione di
  strumenti per l'agente di codifica.
sidebar:
  order: 4
  label: Creazione di server e strumenti
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# Creazione di server e strumenti MCP

Questo documento spiega come le definizioni di server MCP diventano strumenti `mcp_*` richiamabili nell'agente di codifica, e cosa devono aspettarsi gli operatori quando le configurazioni sono non valide, duplicate, disabilitate o protette da autenticazione.

## Architettura in sintesi

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

`src/mcp/types.ts` definisce la struttura di creazione utilizzata dai writer di configurazione MCP e dal runtime:

- `stdio` (predefinito quando `type` è assente): richiede `command`, opzionali `args`, `env`, `cwd`
- `http`: richiede `url`, opzionali `headers`
- `sse`: richiede `url`, opzionali `headers` (mantenuto per compatibilità)
- campi condivisi: `enabled`, `timeout`, `auth`

`validateServerConfig()` (`src/mcp/config.ts`) applica le regole di base sul trasporto:

- rifiuta configurazioni che impostano sia `command` che `url`
- richiede `command` per stdio
- richiede `url` per http/sse
- rifiuta `type` sconosciuti

`config-writer.ts` applica questa validazione per le operazioni di aggiunta/aggiornamento e valida anche i nomi dei server:

- non vuoti
- massimo 100 caratteri
- solo `[a-zA-Z0-9_.-]`

### Problemi comuni con il trasporto

- `type` omesso significa stdio. Se si intendeva HTTP/SSE ma `type` è stato omesso, `command` diventa obbligatorio.
- `sse` è ancora accettato ma trattato internamente come trasporto HTTP (`createHttpTransport`).
- La validazione è strutturale, non di raggiungibilità: un URL sintatticamente valido può comunque fallire in fase di connessione.

## 2) Discovery, normalizzazione e precedenza

### Discovery basata su funzionalità

`loadAllMCPConfigs()` (`src/mcp/config.ts`) carica elementi canonici `MCPServer` tramite `loadCapability(mcpCapability.id)`.

Il livello di funzionalità (`src/capability/index.ts`) poi:

1. carica i provider in ordine di priorità
2. deduplica per `server.name` (vince il primo = priorità più alta)
3. valida gli elementi deduplicati

Risultato: i nomi di server duplicati tra le sorgenti non vengono uniti. Vince una sola definizione; i duplicati a priorità inferiore vengono oscurati.

### `.mcp.json` e file correlati

Il provider di fallback dedicato in `src/discovery/mcp-json.ts` legge `mcp.json` e `.mcp.json` alla radice del progetto (priorità bassa).

In pratica i server MCP provengono anche da provider ad alta priorità (ad esempio nativi `.xcsh/...` e directory di configurazione specifiche per strumenti). Indicazioni per la creazione:

- Preferire `.xcsh/mcp.json` (progetto) o `~/.xcsh/mcp.json` (utente) per un controllo esplicito.
- Usare `mcp.json` / `.mcp.json` alla radice quando si necessita di compatibilità con il fallback.
- Il riutilizzo dello stesso nome server in più sorgenti causa oscuramento per precedenza, non unione.

### Comportamento di normalizzazione

`convertToLegacyConfig()` (`src/mcp/config.ts`) mappa il canonico `MCPServer` al runtime `MCPServerConfig`.

Comportamento principale:

- il trasporto viene dedotto come `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- i server disabilitati (`enabled === false`) vengono eliminati prima della connessione
- i campi opzionali vengono preservati quando presenti

### Espansione delle variabili d'ambiente durante la discovery

`mcp-json.ts` espande i segnaposto delle variabili d'ambiente nei campi stringa con `expandEnvVarsDeep()`:

- supporta `${VAR}` e `${VAR:-default}`
- i valori non risolti rimangono come stringhe letterali `${VAR}`

`mcp-json.ts` esegue anche controlli di tipo a runtime sul JSON utente e registra avvisi per valori `enabled`/`timeout` non validi invece di causare il fallimento dell'intero file.

## 3) Autenticazione e risoluzione dei valori a runtime

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) è il passaggio finale prima della connessione.

### Iniezione delle credenziali OAuth

Se la configurazione contiene:

```ts
auth: { type: "oauth", credentialId: "..." }
```

e la credenziale esiste nell'archivio di autenticazione:

- `http`/`sse`: inietta l'header `Authorization: Bearer <access_token>`
- `stdio`: inietta la variabile d'ambiente `OAUTH_ACCESS_TOKEN`

Se il recupero della credenziale fallisce, il manager registra un avviso e continua con l'autenticazione non risolta.

### Risoluzione dei valori di header/env

Prima della connessione, il manager risolve ogni valore di header/env tramite `resolveConfigValue()` (`src/config/resolve-config-value.ts`):

- valore che inizia con `!` => esegui il comando shell, usa lo stdout senza spazi (con cache)
- altrimenti, tratta il valore come nome di variabile d'ambiente (`process.env[name]`), con fallback al valore letterale
- i valori di comando/env non risolti vengono omessi dalla mappa finale di header/env

Avvertenza operativa: questo significa che una chiave di comando/env di un segreto digitata in modo errato può rimuovere silenziosamente quella voce di header/env, producendo errori 401/403 a valle o fallimenti all'avvio del server.

## 4) Bridge degli strumenti: MCP -> strumenti richiamabili dall'agente

`src/mcp/tool-bridge.ts` converte le definizioni degli strumenti MCP in `CustomTool`.

### Denominazione e dominio delle collisioni

I nomi degli strumenti vengono generati come:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

Regole:

- conversione in minuscolo
- i caratteri non appartenenti a `[a-z_]` diventano `_`
- i trattini bassi ripetuti vengono compressi
- il prefisso ridondante `<server>_` nel nome dello strumento viene rimosso una volta

Questo evita molte collisioni, ma non tutte. Nomi grezzi diversi possono comunque essere sanitizzati nello stesso identificatore (ad esempio `my-server` e `my.server` vengono sanitizzati in modo simile), e l'inserimento nel registro avviene in modalità last-write-wins.

### Mappatura dello schema

`convertSchema()` mantiene lo schema JSON MCP pressoché invariato, ma corregge gli schemi oggetto privi di `properties` aggiungendo `{}` per compatibilità con il provider.

### Mappatura dell'esecuzione

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- chiama `tools/call` MCP
- appiattisce il contenuto MCP in testo visualizzabile
- restituisce dettagli strutturati (`serverName`, `mcpToolName`, metadati del provider)
- mappa `isError` riportato dal server in un risultato testuale `Error: ...`
- mappa i fallimenti di trasporto/runtime in `MCP error: ...`
- preserva la semantica di interruzione traducendo AbortError in `ToolAbortError`

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

`refreshMCPTools()` sostituisce tutte le voci del registro `mcp_` e riattiva immediatamente l'ultimo set di strumenti MCP, quindi le modifiche hanno effetto senza riavviare la sessione.

### Differenze tra modalità

- **Modalità interattiva/TUI**: `/mcp` fornisce un'interfaccia utente integrata (wizard, flusso OAuth, testo dello stato di connessione, rebinding a runtime immediato).
- **Integrazione SDK/headless**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) restituisce gli strumenti caricati e gli errori per server; nessuna UX del comando `/mcp`.

## 6) Superfici di errore visibili all'utente

Stringhe di errore comuni visibili agli utenti/operatori:

- errori di validazione durante aggiunta/aggiornamento:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- problemi con gli argomenti di aggiunta rapida:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- errori di connessione/test:
  - `Failed to connect to "<name>": <message>`
  - il testo di aiuto per il timeout suggerisce di aumentare il timeout
  - il testo di aiuto per l'autenticazione per `401/403`
- flussi di autenticazione/OAuth:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- utilizzo di server disabilitato:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

Il JSON sorgente non valido durante la discovery viene generalmente gestito come avvisi/log; i percorsi config-writer generano errori espliciti.

## 7) Indicazioni pratiche per la creazione

Per una creazione MCP robusta in questa codebase:

1. Mantenere i nomi dei server globalmente univoci in tutte le sorgenti di configurazione compatibili con MCP.
2. Preferire nomi alfanumerici/con trattino basso per evitare collisioni di nomi sanitizzati nei nomi degli strumenti `mcp_*` generati.
3. Usare `type` esplicito per evitare impostazioni predefinite stdio accidentali.
4. Trattare `enabled: false` come disattivazione totale: il server viene omesso dal set di connessione a runtime.
5. Per le configurazioni OAuth, memorizzare un `credentialId` valido; altrimenti l'iniezione dell'autenticazione viene saltata.
6. Se si utilizza la risoluzione di segreti basata su comando (`!cmd`), verificare che l'output del comando sia stabile e non vuoto.

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
