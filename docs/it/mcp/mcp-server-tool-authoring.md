---
title: MCP Server and Tool Authoring
description: >-
  Guida alla creazione di server MCP personalizzati e alla registrazione degli
  strumenti per il coding agent.
sidebar:
  order: 4
  label: Creazione di server e strumenti
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# Creazione di server e strumenti MCP

Questo documento spiega come le definizioni dei server MCP diventano strumenti `mcp_*` richiamabili nel coding-agent e cosa gli operatori devono aspettarsi quando le configurazioni sono invalide, duplicate, disabilitate o protette da autenticazione.

## Panoramica dell'architettura

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

`src/mcp/types.ts` definisce la struttura di authoring utilizzata dagli autori di configurazione MCP e dal runtime:

- `stdio` (predefinito quando `type` è assente): richiede `command`, opzionali `args`, `env`, `cwd`
- `http`: richiede `url`, opzionali `headers`
- `sse`: richiede `url`, opzionali `headers` (mantenuto per compatibilità)
- campi condivisi: `enabled`, `timeout`, `auth`

`validateServerConfig()` (`src/mcp/config.ts`) applica i requisiti di base del trasporto:

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

## 2) Scoperta, normalizzazione e precedenza

### Scoperta basata sulle capability

`loadAllMCPConfigs()` (`src/mcp/config.ts`) carica gli elementi canonici `MCPServer` tramite `loadCapability(mcpCapability.id)`.

Il livello capability (`src/capability/index.ts`) quindi:

1. carica i provider in ordine di priorità
2. deduplica per `server.name` (la prima occorrenza vince = priorità più alta)
3. valida gli elementi deduplicati

Risultato: i nomi di server duplicati tra diverse sorgenti non vengono uniti. Una definizione vince; i duplicati a priorità inferiore vengono oscurati.

### `.mcp.json` e file correlati

Il provider di fallback dedicato in `src/discovery/mcp-json.ts` legge `mcp.json` e `.mcp.json` dalla radice del progetto (bassa priorità).

In pratica i server MCP provengono anche da provider a priorità più alta (ad esempio `.xcsh/...` nativo e directory di configurazione specifiche per strumento). Indicazioni per l'authoring:

- Preferire `.xcsh/mcp.json` (progetto) o `~/.xcsh/mcp.json` (utente) per un controllo esplicito.
- Usare `mcp.json` / `.mcp.json` nella radice quando serve compatibilità di fallback.
- Riutilizzare lo stesso nome di server in più sorgenti causa oscuramento per precedenza, non unione.

### Comportamento di normalizzazione

`convertToLegacyConfig()` (`src/mcp/config.ts`) mappa l'`MCPServer` canonico al `MCPServerConfig` di runtime.

Comportamento chiave:

- il trasporto viene dedotto come `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- i server disabilitati (`enabled === false`) vengono eliminati prima della connessione
- i campi opzionali vengono preservati quando presenti

### Espansione delle variabili d'ambiente durante la scoperta

`mcp-json.ts` espande i segnaposto delle variabili d'ambiente nei campi stringa con `expandEnvVarsDeep()`:

- supporta `${VAR}` e `${VAR:-default}`
- i valori non risolti rimangono come stringhe letterali `${VAR}`

`mcp-json.ts` esegue anche controlli di tipo a runtime per il JSON utente e registra warning per valori `enabled`/`timeout` invalidi invece di far fallire l'intero file.

## 3) Autenticazione e risoluzione dei valori a runtime

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) è il passaggio finale pre-connessione.

### Iniezione delle credenziali OAuth

Se la configurazione ha:

```ts
auth: { type: "oauth", credentialId: "..." }
```

e la credenziale esiste nello storage di autenticazione:

- `http`/`sse`: inietta l'header `Authorization: Bearer <access_token>`
- `stdio`: inietta la variabile d'ambiente `OAUTH_ACCESS_TOKEN`

Se il recupero della credenziale fallisce, il manager registra un warning e continua con l'autenticazione non risolta.

### Risoluzione dei valori di header/env

Prima della connessione, il manager risolve ogni valore di header/env tramite `resolveConfigValue()` (`src/config/resolve-config-value.ts`):

- il valore che inizia con `!` => esegue un comando shell, usa lo stdout trimmato (con cache)
- altrimenti, tratta il valore prima come nome di variabile d'ambiente (`process.env[name]`), con fallback al valore letterale
- i valori di comando/env non risolti vengono omessi dalla mappa finale di header/env

Avvertenza operativa: questo significa che un comando/chiave env di segreto digitata erroneamente può rimuovere silenziosamente quella voce di header/env, producendo errori 401/403 a valle o fallimenti nell'avvio del server.

## 4) Bridge degli strumenti: MCP -> strumenti richiamabili dall'agent

`src/mcp/tool-bridge.ts` converte le definizioni degli strumenti MCP in `CustomTool`.

### Naming e dominio delle collisioni

I nomi degli strumenti vengono generati come:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

Regole:

- conversione in minuscolo
- i caratteri non `[a-z_]` diventano `_`
- gli underscore ripetuti vengono compressi
- il prefisso ridondante `<server>_` nel nome dello strumento viene rimosso una volta

Questo evita molte collisioni, ma non tutte. Nomi grezzi diversi possono comunque essere sanitizzati nello stesso identificatore (ad esempio `my-server` e `my.server` vengono sanitizzati in modo simile), e l'inserimento nel registro segue la logica last-write-wins.

### Mappatura dello schema

`convertSchema()` mantiene il JSON Schema MCP sostanzialmente invariato ma corregge gli schemi oggetto privi di `properties` con `{}` per la compatibilità con i provider.

### Mappatura dell'esecuzione

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- chiama MCP `tools/call`
- appiattisce il contenuto MCP in testo visualizzabile
- restituisce dettagli strutturati (`serverName`, `mcpToolName`, metadati del provider)
- mappa `isError` riportato dal server in un risultato testuale `Error: ...`
- mappa i fallimenti di trasporto/runtime lanciati in `MCP error: ...`
- preserva la semantica di abort traducendo AbortError in `ToolAbortError`

## 5) Ciclo di vita dell'operatore: aggiunta/modifica/rimozione e aggiornamenti in tempo reale

La modalità interattiva espone `/mcp` in `src/modes/controllers/mcp-command-controller.ts`.

Operazioni supportate:

- `add` (wizard o quick-add)
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

`refreshMCPTools()` sostituisce tutte le voci `mcp_` nel registro e riattiva immediatamente l'ultimo set di strumenti MCP, quindi le modifiche hanno effetto senza riavviare la sessione.

### Differenze tra le modalità

- **Modalità interattiva/TUI**: `/mcp` offre un'interfaccia in-app (wizard, flusso OAuth, testo sullo stato della connessione, rebinding runtime immediato).
- **Integrazione SDK/headless**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) restituisce gli strumenti caricati + errori per server; nessuna interfaccia del comando `/mcp`.

## 6) Superfici di errore visibili all'utente

Stringhe di errore comuni che utenti/operatori vedono:

- fallimenti di validazione in aggiunta/aggiornamento:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- problemi con gli argomenti di quick-add:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- fallimenti di connessione/test:
  - `Failed to connect to "<name>": <message>`
  - testo di aiuto per il timeout che suggerisce di aumentare il timeout
  - testo di aiuto per l'autenticazione in caso di `401/403`
- flussi di autenticazione/OAuth:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- utilizzo di server disabilitati:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

Il JSON sorgente malformato nella fase di scoperta viene generalmente gestito come warning/log; i percorsi del config-writer lanciano errori espliciti.

## 7) Indicazioni pratiche per l'authoring

Per un authoring MCP robusto in questo codebase:

1. Mantenere i nomi dei server globalmente unici tra tutte le sorgenti di configurazione MCP.
2. Preferire nomi alfanumerici/con underscore per evitare collisioni di nomi sanitizzati nei nomi degli strumenti `mcp_*` generati.
3. Usare `type` esplicito per evitare default stdio accidentali.
4. Trattare `enabled: false` come spento definitivo: il server viene omesso dal set di connessione runtime.
5. Per le configurazioni OAuth, memorizzare un `credentialId` valido; altrimenti l'iniezione dell'autenticazione viene saltata.
6. Se si usa la risoluzione di segreti basata su comando (`!cmd`), verificare che l'output del comando sia stabile e non vuoto.

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
