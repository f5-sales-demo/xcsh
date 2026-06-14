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

`src/mcp/types.ts` definisce la struttura di creazione utilizzata dagli autori di configurazioni MCP e dal runtime:

- `stdio` (predefinito quando manca `type`): richiede `command`, opzionalmente `args`, `env`, `cwd`
- `http`: richiede `url`, opzionalmente `headers`
- `sse`: richiede `url`, opzionalmente `headers` (mantenuto per compatibilità)
- campi condivisi: `enabled`, `timeout`, `auth`

`validateServerConfig()` (`src/mcp/config.ts`) applica le regole fondamentali di trasporto:

- rifiuta le configurazioni che impostano sia `command` che `url`
- richiede `command` per stdio
- richiede `url` per http/sse
- rifiuta valori `type` sconosciuti

`config-writer.ts` applica questa validazione per le operazioni di aggiunta/aggiornamento e verifica anche i nomi dei server:

- non vuoti
- massimo 100 caratteri
- solo `[a-zA-Z0-9_.-]`

### Problematiche di trasporto

- L'omissione di `type` implica stdio. Se si intende HTTP/SSE ma si omette `type`, `command` diventa obbligatorio.
- `sse` è ancora accettato ma trattato internamente come trasporto HTTP (`createHttpTransport`).
- La validazione è strutturale, non verifica la raggiungibilità: un URL sintatticamente valido può comunque fallire al momento della connessione.

## 2) Scoperta, normalizzazione e precedenza

### Scoperta basata sulle capacità

`loadAllMCPConfigs()` (`src/mcp/config.ts`) carica gli elementi canonici `MCPServer` tramite `loadCapability(mcpCapability.id)`.

Il livello di capacità (`src/capability/index.ts`) quindi:

1. carica i provider in ordine di priorità
2. deduplica per `server.name` (il primo vince = priorità più alta)
3. valida gli elementi deduplicati

Risultato: i nomi di server duplicati tra le sorgenti non vengono uniti. Una sola definizione vince; i duplicati con priorità inferiore vengono oscurati.

### `.mcp.json` e file correlati

Il provider di fallback dedicato in `src/discovery/mcp-json.ts` legge `mcp.json` e `.mcp.json` nella root del progetto (bassa priorità).

In pratica, i server MCP provengono anche da provider con priorità più alta (ad esempio i file nativi `.xcsh/...` e le directory di configurazione specifiche degli strumenti). Linee guida per la creazione:

- Preferire `.xcsh/mcp.json` (progetto) o `~/.xcsh/mcp.json` (utente) per un controllo esplicito.
- Usare `mcp.json` / `.mcp.json` nella root quando si necessita di compatibilità di fallback.
- Il riutilizzo dello stesso nome di server in più sorgenti causa un oscuramento per precedenza, non una fusione.

### Comportamento di normalizzazione

`convertToLegacyConfig()` (`src/mcp/config.ts`) mappa il `MCPServer` canonico nel `MCPServerConfig` di runtime.

Comportamento chiave:

- il trasporto viene dedotto come `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- i server disabilitati (`enabled === false`) vengono esclusi prima della connessione
- i campi opzionali vengono preservati quando presenti

### Espansione delle variabili d'ambiente durante la scoperta

`mcp-json.ts` espande i segnaposto di ambiente nei campi stringa con `expandEnvVarsDeep()`:

- supporta `${VAR}` e `${VAR:-default}`
- i valori non risolti rimangono come stringhe letterali `${VAR}`

`mcp-json.ts` esegue inoltre verifiche del tipo a runtime per il JSON dell'utente e registra avvisi per valori `enabled`/`timeout` non validi invece di far fallire l'intero file.

## 3) Risoluzione dei valori di autenticazione e runtime

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) è il passaggio finale prima della connessione.

### Iniezione delle credenziali OAuth

Se la configurazione contiene:

```ts
auth: { type: "oauth", credentialId: "..." }
```

e la credenziale esiste nell'archivio di autenticazione:

- `http`/`sse`: inietta l'intestazione `Authorization: Bearer <access_token>`
- `stdio`: inietta la variabile d'ambiente `OAUTH_ACCESS_TOKEN`

Se la ricerca delle credenziali fallisce, il manager registra un avviso e continua con l'autenticazione non risolta.

### Risoluzione dei valori di intestazione/ambiente

Prima della connessione, il manager risolve ogni valore di intestazione/ambiente tramite `resolveConfigValue()` (`src/config/resolve-config-value.ts`):

- valore che inizia con `!` => esegue il comando shell, usa lo stdout pulito (memorizzato nella cache)
- altrimenti, tratta il valore prima come nome di variabile d'ambiente (`process.env[name]`), con fallback al valore letterale
- i valori di comando/ambiente non risolti vengono omessi dalla mappa finale di intestazioni/ambiente

Avvertenza operativa: ciò significa che una chiave di comando/ambiente per il segreto scritta in modo errato può rimuovere silenziosamente quella voce di intestazione/ambiente, producendo errori 401/403 a valle o errori di avvio del server.

## 4) Bridge degli strumenti: MCP -> strumenti richiamabili dall'agente

`src/mcp/tool-bridge.ts` converte le definizioni degli strumenti MCP in `CustomTool`.

### Denominazione e dominio delle collisioni

I nomi degli strumenti vengono generati come:

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

Regole:

- conversione in minuscolo
- i caratteri non conformi a `[a-z_]` diventano `_`
- i trattini bassi ripetuti vengono compressi
- il prefisso ridondante `<server>_` nel nome dello strumento viene rimosso una volta

Questo evita molte collisioni, ma non tutte. Nomi raw diversi possono comunque produrre lo stesso identificatore dopo la sanitizzazione (ad esempio `my-server` e `my.server` producono risultati simili), e l'inserimento nel registro è last-write-wins.

### Mappatura dello schema

`convertSchema()` mantiene lo schema JSON MCP per lo più invariato, ma corregge gli schemi oggetto privi di `properties` aggiungendo `{}` per la compatibilità con i provider.

### Mappatura dell'esecuzione

`MCPTool.execute()` / `DeferredMCPTool.execute()`:

- chiama MCP `tools/call`
- appiattisce il contenuto MCP in testo visualizzabile
- restituisce dettagli strutturati (`serverName`, `mcpToolName`, metadati del provider)
- mappa `isError` segnalato dal server in un risultato testuale `Error: ...`
- mappa i fallimenti di trasporto/runtime lanciati in `MCP error: ...`
- preserva la semantica di interruzione traducendo AbortError in `ToolAbortError`

## 5) Ciclo di vita dell'operatore: aggiunta/modifica/rimozione e aggiornamenti in tempo reale

La modalità interattiva espone `/mcp` in `src/modes/controllers/mcp-command-controller.ts`.

Operazioni supportate:

- `add` (procedura guidata o aggiunta rapida)
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

`refreshMCPTools()` sostituisce tutte le voci `mcp_` nel registro e riattiva immediatamente il set più recente di strumenti MCP, quindi le modifiche hanno effetto senza riavviare la sessione.

### Differenze tra modalità

- **Modalità interattiva/TUI**: `/mcp` fornisce un'interfaccia utente in-app (procedura guidata, flusso OAuth, testo dello stato della connessione, ricollegamento immediato al runtime).
- **Integrazione SDK/headless**: `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) restituisce gli strumenti caricati e gli errori per server; nessuna interfaccia utente per il comando `/mcp`.

## 6) Superfici di errore visibili all'utente

Stringhe di errore comuni che utenti/operatori vedono:

- errori di validazione in aggiunta/aggiornamento:
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- problemi con gli argomenti di aggiunta rapida:
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- errori di connessione/test:
  - `Failed to connect to "<name>": <message>`
  - il testo di aiuto per il timeout suggerisce di aumentare il valore
  - il testo di aiuto per l'autenticazione per `401/403`
- flussi di autenticazione/OAuth:
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- utilizzo di un server disabilitato:
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

Il JSON sorgente non valido durante la scoperta viene generalmente gestito come avvisi/log; i percorsi di config-writer generano errori espliciti.

## 7) Linee guida pratiche per la creazione

Per una creazione robusta di MCP in questa codebase:

1. Mantenere i nomi dei server globalmente univoci in tutte le sorgenti di configurazione compatibili con MCP.
2. Preferire nomi alfanumerici/con trattino basso per evitare collisioni di nomi sanitizzati nei nomi degli strumenti `mcp_*` generati.
3. Usare `type` esplicito per evitare impostazioni predefinite stdio accidentali.
4. Trattare `enabled: false` come disattivazione completa: il server viene omesso dal set di connessione al runtime.
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
