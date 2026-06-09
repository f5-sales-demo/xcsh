---
title: Ciclo di vita del runtime MCP
description: >-
  Ciclo di vita del processo del server MCP dall'inizializzazione alla
  registrazione degli strumenti, monitoraggio dello stato e arresto.
sidebar:
  order: 3
  label: Ciclo di vita del runtime
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# Ciclo di vita del runtime MCP

Questo documento descrive come i server MCP vengono scoperti, connessi, esposti come strumenti, aggiornati e terminati nel runtime del coding-agent.

## Panoramica del ciclo di vita

1. **Avvio dell'SDK** chiama `discoverAndLoadMCPTools()` (a meno che MCP non sia disabilitato).
2. **Scoperta** (`loadAllMCPConfigs`) risolve le configurazioni dei server MCP dalle sorgenti di capability, filtra le voci disabilitate/progetto/Exa e preserva i metadati della sorgente.
3. **Fase di connessione del manager** (`MCPManager.connectServers`) avvia connessione per server + `tools/list` in parallelo.
4. **Gate di avvio rapido** attende fino a 250ms, poi può restituire:
   - `MCPTool` completamente caricati,
   - errori per server,
   - o `DeferredMCPTool` in cache per i server ancora in sospeso.
5. **Collegamento SDK** unisce gli strumenti MCP nel registro degli strumenti del runtime per la sessione.
6. **Sessione attiva** può aggiornare gli strumenti MCP tramite i flussi `/mcp` (`disconnectAll` + riscoperta + `session.refreshMCPTools`).
7. **Smontaggio** avviene quando i chiamanti invocano `disconnectServer`/`disconnectAll`; il manager inoltre cancella le registrazioni degli strumenti MCP per i server disconnessi.

## Fase di scoperta e caricamento

### Percorso di ingresso dall'SDK

`createAgentSession()` in `src/sdk.ts` esegue l'avvio MCP quando `enableMCP` è true (predefinito):

- chiama `discoverAndLoadMCPTools(cwd, { ... })`,
- passa `authStorage`, storage della cache e l'impostazione `mcp.enableProjectConfig`,
- imposta sempre `filterExa: true`,
- registra nei log gli errori di caricamento/connessione per server,
- memorizza il manager restituito in `toolSession.mcpManager` e nel risultato della sessione.

Se `enableMCP` è false, la scoperta MCP viene completamente saltata.

### Scoperta e filtraggio della configurazione

`loadAllMCPConfigs()` (`src/mcp/config.ts`) carica gli elementi canonici del server MCP attraverso la scoperta delle capability, poi li converte nel formato legacy `MCPServerConfig`.

Comportamento del filtraggio:

- `enableProjectConfig: false` rimuove le voci a livello di progetto (`_source.level === "project"`).
- I server con `enabled: false` vengono saltati prima dei tentativi di connessione.
- I server Exa vengono filtrati per impostazione predefinita e le chiavi API vengono estratte per l'integrazione nativa dello strumento Exa.

Il risultato include sia `configs` che `sources` (metadati utilizzati successivamente per l'etichettatura del provider).

### Comportamento in caso di errore a livello di scoperta

`discoverAndLoadMCPTools()` distingue due classi di errore:

- **Errore grave nella scoperta** (eccezione da `manager.discoverAndConnect`, tipicamente dalla scoperta della configurazione): restituisce un set di strumenti vuoto e un errore sintetico `{ path: ".mcp.json", error }`.
- **Errore runtime/connessione per server**: il manager restituisce un successo parziale con mappa `errors`; gli altri server continuano.

Quindi l'avvio non fa fallire l'intera sessione dell'agente quando singoli server MCP falliscono.

## Modello di stato del manager

`MCPManager` tiene traccia del ciclo di vita del runtime con registri separati:

- `#connections: Map<string, MCPServerConnection>` — server completamente connessi.
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — handshake in corso.
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — connessi ma strumenti ancora in caricamento.
- `#tools: CustomTool[]` — vista corrente degli strumenti MCP esposta ai chiamanti.
- `#sources: Map<string, SourceMeta>` — metadati provider/sorgente anche prima del completamento della connessione.

`getConnectionStatus(name)` deriva lo stato da queste mappe:

- `connected` se presente in `#connections`,
- `connecting` se connessione in sospeso o caricamento strumenti in sospeso,
- `disconnected` altrimenti.

## Stabilimento della connessione e tempistiche di avvio

## Pipeline di connessione per server

Per ogni server scoperto in `connectServers()`:

1. memorizza/aggiorna i metadati della sorgente,
2. salta se già connesso/in sospeso,
3. valida i campi di trasporto (`validateServerConfig`),
4. risolve le sostituzioni auth/shell (`#resolveAuthConfig`),
5. chiama `connectToServer(name, resolvedConfig)`,
6. chiama `listTools(connection)`,
7. memorizza in cache le definizioni degli strumenti (`MCPToolCache.set`) come best-effort.

Comportamento di `connectToServer()` (`src/mcp/client.ts`):

- crea un trasporto stdio o HTTP/SSE,
- esegue MCP `initialize` + `notifications/initialized`,
- usa un timeout (`config.timeout` o 30s predefinito),
- chiude il trasporto in caso di fallimento dell'inizializzazione.

### Gate di avvio rapido + fallback differito

`connectServers()` attende una gara tra:

- tutti i task di connessione/caricamento strumenti completati, e
- `STARTUP_TIMEOUT_MS = 250`.

Dopo 250ms:

- i task completati con successo diventano `MCPTool` attivi,
- i task falliti producono errori per server,
- i task ancora in sospeso:
  - usano le definizioni degli strumenti in cache se disponibili (`MCPToolCache.get`) per creare `DeferredMCPTool`,
  - altrimenti bloccano fino al completamento dei task in sospeso.

Questo è un modello di avvio ibrido: ritorno rapido quando la cache è disponibile, attesa per correttezza quando la cache non è disponibile.

### Comportamento del completamento in background

Ogni `toolsPromise` in sospeso ha anche una continuazione in background che alla fine:

- sostituisce la porzione di strumenti di quel server nello stato del manager tramite `#replaceServerTools`,
- scrive nella cache,
- registra nei log i fallimenti tardivi solo dopo l'avvio (`allowBackgroundLogging`).

## Esposizione degli strumenti e disponibilità nella sessione attiva

### Registrazione all'avvio

`discoverAndLoadMCPTools()` converte gli strumenti del manager in `LoadedCustomTool[]` e decora i percorsi (`mcp:<server> via <providerName>` quando noto).

`createAgentSession()` poi inserisce questi strumenti in `customTools`, che vengono incapsulati e aggiunti al registro degli strumenti del runtime con nomi come `mcp_<server>_<tool>`.

### Chiamate agli strumenti

- `MCPTool` chiama gli strumenti attraverso una `MCPServerConnection` già connessa.
- `DeferredMCPTool` attende `waitForConnection(server)` prima di chiamare; questo permette agli strumenti in cache di esistere prima che la connessione sia pronta.

Entrambi restituiscono output strutturato degli strumenti e convertono gli errori di trasporto/strumento in contenuto `MCP error: ...` dello strumento (l'abort rimane abort).

## Percorsi di aggiornamento/ricaricamento (avvio vs ricaricamento in sessione)

### Percorso di avvio iniziale

- scoperta/caricamento una tantum in `sdk.ts`,
- gli strumenti vengono registrati nel registro iniziale degli strumenti della sessione.

### Percorso di ricaricamento interattivo

Il percorso `/mcp reload` (`src/modes/controllers/mcp-command-controller.ts`) esegue:

1. `mcpManager.disconnectAll()`,
2. `mcpManager.discoverAndConnect()`,
3. `session.refreshMCPTools(mcpManager.getTools())`.

`session.refreshMCPTools()` (`src/session/agent-session.ts`) rimuove tutti gli strumenti `mcp_`, re-incapsula gli strumenti MCP più recenti e riattiva il set di strumenti in modo che le modifiche MCP si applichino senza riavviare la sessione.

Esiste anche un percorso di follow-up per le connessioni tardive: dopo aver atteso un server specifico, se lo stato diventa `connected`, riesegue `session.refreshMCPTools(...)` in modo che gli strumenti appena disponibili vengano ricollegati nella sessione.

## Stato di salute, riconnessione e comportamento in caso di errore parziale

Il comportamento attuale del runtime è intenzionalmente minimale:

- **Nessun monitor di salute autonomo** nel manager/client.
- **Nessun ciclo di riconnessione automatica** quando un trasporto si interrompe.
- Il manager non si iscrive a `onClose`/`onError` del trasporto; lo stato è guidato dal registro.
- La riconnessione è esplicita: flusso di ricaricamento o invocazione diretta di `connectServers()`.

Operativamente:

- il fallimento di un server non rimuove gli strumenti dai server sani,
- gli errori di connessione/elenco sono isolati per server,
- la cache degli strumenti e gli aggiornamenti in background sono best-effort (avvisi/errori registrati nei log, nessun arresto forzato).

## Semantica dello smontaggio

### Smontaggio a livello di server

`disconnectServer(name)`:

- rimuove le voci in sospeso/metadati della sorgente,
- chiude il trasporto se connesso,
- rimuove gli strumenti `mcp_` di quel server dallo stato del manager.

### Smontaggio globale

`disconnectAll()`:

- chiude tutti i trasporti attivi con `Promise.allSettled`,
- cancella le mappe in sospeso, sorgenti, connessioni e lista degli strumenti del manager.

Nel cablaggio attuale, lo smontaggio esplicito viene utilizzato nei flussi dei comandi MCP (per ricaricamento/rimozione/disabilitazione). Non esiste un hook di disposizione automatica separato del manager nel percorso di avvio stesso; i chiamanti sono responsabili dell'invocazione dei metodi di disconnessione del manager quando necessitano di un arresto MCP deterministico.

## Modalità di errore e garanzie

| Scenario | Comportamento | Errore grave vs best-effort |
| --- | --- | --- |
| La scoperta lancia un'eccezione (percorso di caricamento capability/config) | Il loader restituisce strumenti vuoti + errore sintetico `.mcp.json` | Avvio sessione best-effort |
| Configurazione server non valida | Server saltato con voce di errore di validazione | Best-effort per server |
| Timeout di connessione/fallimento inizializzazione | Errore del server registrato; gli altri continuano | Best-effort per server |
| `tools/list` ancora in sospeso all'avvio con hit della cache | Strumenti differiti restituiti immediatamente | Avvio rapido best-effort |
| `tools/list` ancora in sospeso all'avvio senza cache | L'avvio attende il completamento dei task in sospeso | Attesa forzata per correttezza |
| Fallimento tardivo del caricamento strumenti in background | Registrato nei log dopo il gate di avvio | Logging best-effort |
| Trasporto interrotto a runtime | Nessuna riconnessione automatica; le chiamate future falliscono fino a riconnessione/ricaricamento | Recupero best-effort tramite azione manuale |

## Superficie API pubblica

`src/mcp/index.ts` ri-esporta le API di loader/manager/client per i chiamanti esterni. `src/sdk.ts` espone `discoverMCPServers()` come wrapper di convenienza che restituisce la stessa forma di risultato del loader.

## File di implementazione

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — facciata del loader, normalizzazione degli errori di scoperta, conversione `LoadedCustomTool`.
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — registri dello stato del ciclo di vita, flusso parallelo di connessione/elenco, aggiornamento/disconnessione.
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — configurazione del trasporto, handshake di inizializzazione, elenco/chiamata/disconnessione.
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — esportazioni API del modulo MCP.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — cablaggio dell'avvio nel registro sessione/strumenti.
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — scoperta/filtraggio/validazione della configurazione utilizzata dal manager.
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — comportamento runtime di `MCPTool` e `DeferredMCPTool`.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — ricollegamento in tempo reale `refreshMCPTools`.
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — flussi di ricaricamento/riconnessione interattivi.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — proxy MCP del subagent tramite connessioni del manager padre.
