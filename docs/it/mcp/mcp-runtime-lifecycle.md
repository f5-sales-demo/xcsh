---
title: Ciclo di vita runtime MCP
description: >-
  Ciclo di vita del processo del server MCP dall'inizializzazione alla
  registrazione degli strumenti, al monitoraggio dello stato di salute e allo
  spegnimento.
sidebar:
  order: 3
  label: Ciclo di vita runtime
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# Ciclo di vita runtime MCP

Questo documento descrive come i server MCP vengono scoperti, connessi, esposti come strumenti, aggiornati e terminati nel runtime del coding-agent.

## Ciclo di vita in sintesi

1. **L'avvio dell'SDK** chiama `discoverAndLoadMCPTools()` (a meno che MCP non sia disabilitato).
2. **La scoperta** (`loadAllMCPConfigs`) risolve le configurazioni dei server MCP dalle sorgenti di capacità, filtra le voci disabilitate/di progetto/Exa e preserva i metadati delle sorgenti.
3. **La fase di connessione del manager** (`MCPManager.connectServers`) avvia in parallelo la connessione per ogni server e `tools/list`.
4. **Il gate di avvio rapido** attende fino a 250ms, poi può restituire:
   - `MCPTool` completamente caricati,
   - errori per singolo server,
   - oppure `DeferredMCPTool` dalla cache per server ancora in attesa.
5. **Il collegamento dell'SDK** unisce gli strumenti MCP nel registro degli strumenti runtime per la sessione.
6. **La sessione live** può aggiornare gli strumenti MCP tramite i flussi `/mcp` (`disconnectAll` + riscoperta + `session.refreshMCPTools`).
7. **La terminazione** avviene quando i chiamanti invocano `disconnectServer`/`disconnectAll`; il manager cancella anche le registrazioni degli strumenti MCP per i server disconnessi.

## Fase di scoperta e caricamento

### Percorso di ingresso dall'SDK

`createAgentSession()` in `src/sdk.ts` esegue l'avvio MCP quando `enableMCP` è true (predefinito):

- chiama `discoverAndLoadMCPTools(cwd, { ... })`,
- passa `authStorage`, lo storage della cache e l'impostazione `mcp.enableProjectConfig`,
- imposta sempre `filterExa: true`,
- registra nei log gli errori di caricamento/connessione per singolo server,
- memorizza il manager restituito in `toolSession.mcpManager` e nel risultato della sessione.

Se `enableMCP` è false, la scoperta MCP viene completamente saltata.

### Scoperta e filtraggio della configurazione

`loadAllMCPConfigs()` (`src/mcp/config.ts`) carica gli elementi canonici dei server MCP tramite la scoperta delle capacità, poi li converte nella `MCPServerConfig` legacy.

Comportamento del filtraggio:

- `enableProjectConfig: false` rimuove le voci a livello di progetto (`_source.level === "project"`).
- I server con `enabled: false` vengono saltati prima dei tentativi di connessione.
- I server Exa vengono filtrati per impostazione predefinita e le chiavi API vengono estratte per l'integrazione nativa dello strumento Exa.

Il risultato include sia `configs` che `sources` (metadati utilizzati successivamente per l'etichettatura del provider).

### Comportamento in caso di errore nella fase di scoperta

`discoverAndLoadMCPTools()` distingue due classi di errore:

- **Errore grave nella scoperta** (eccezione da `manager.discoverAndConnect`, tipicamente dalla scoperta della configurazione): restituisce un set di strumenti vuoto e un errore sintetico `{ path: ".mcp.json", error }`.
- **Errore runtime/connessione per singolo server**: il manager restituisce un successo parziale con la mappa `errors`; gli altri server continuano.

Quindi l'avvio non fa fallire l'intera sessione dell'agente quando singoli server MCP falliscono.

## Modello di stato del manager

`MCPManager` traccia il ciclo di vita runtime con registri separati:

- `#connections: Map<string, MCPServerConnection>` — server completamente connessi.
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — handshake in corso.
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — connessi ma strumenti ancora in caricamento.
- `#tools: CustomTool[]` — vista corrente degli strumenti MCP esposta ai chiamanti.
- `#sources: Map<string, SourceMeta>` — metadati del provider/sorgente anche prima del completamento della connessione.

`getConnectionStatus(name)` deriva lo stato da queste mappe:

- `connected` se presente in `#connections`,
- `connecting` se in connessione in attesa o caricamento strumenti in attesa,
- `disconnected` altrimenti.

## Stabilimento della connessione e tempistica di avvio

## Pipeline di connessione per singolo server

Per ogni server scoperto in `connectServers()`:

1. memorizza/aggiorna i metadati della sorgente,
2. salta se già connesso/in attesa,
3. valida i campi di trasporto (`validateServerConfig`),
4. risolve le sostituzioni auth/shell (`#resolveAuthConfig`),
5. chiama `connectToServer(name, resolvedConfig)`,
6. chiama `listTools(connection)`,
7. memorizza nella cache le definizioni degli strumenti (`MCPToolCache.set`) su base best-effort.

Comportamento di `connectToServer()` (`src/mcp/client.ts`):

- crea un trasporto stdio o HTTP/SSE,
- esegue MCP `initialize` + `notifications/initialized`,
- usa un timeout (`config.timeout` o 30s predefinito),
- chiude il trasporto in caso di errore nell'inizializzazione.

### Gate di avvio rapido + fallback differito

`connectServers()` attende in una gara tra:

- tutte le attività di connessione/caricamento strumenti concluse, e
- `STARTUP_TIMEOUT_MS = 250`.

Dopo 250ms:

- le attività completate diventano `MCPTool` attivi,
- le attività fallite producono errori per singolo server,
- le attività ancora in attesa:
  - usano le definizioni degli strumenti dalla cache se disponibili (`MCPToolCache.get`) per creare `DeferredMCPTool`,
  - altrimenti attendono fino alla conclusione delle attività in sospeso.

Questo è un modello di avvio ibrido: ritorno rapido quando la cache è disponibile, attesa per correttezza quando non lo è.

### Comportamento di completamento in background

Ogni `toolsPromise` in sospeso ha anche una continuazione in background che alla fine:

- sostituisce la porzione di strumenti di quel server nello stato del manager tramite `#replaceServerTools`,
- scrive nella cache,
- registra nei log i fallimenti tardivi solo dopo l'avvio (`allowBackgroundLogging`).

## Esposizione degli strumenti e disponibilità nella sessione live

### Registrazione all'avvio

`discoverAndLoadMCPTools()` converte gli strumenti del manager in `LoadedCustomTool[]` e decora i percorsi (`mcp:<server> via <providerName>` quando noto).

`createAgentSession()` poi inserisce questi strumenti in `customTools`, che vengono wrappati e aggiunti al registro degli strumenti runtime con nomi come `mcp_<server>_<tool>`.

### Chiamate agli strumenti

- `MCPTool` chiama gli strumenti tramite una `MCPServerConnection` già connessa.
- `DeferredMCPTool` attende `waitForConnection(server)` prima di chiamare; questo permette agli strumenti in cache di esistere prima che la connessione sia pronta.

Entrambi restituiscono output strutturato degli strumenti e convertono errori di trasporto/strumento in contenuto `MCP error: ...` (l'abort rimane abort).

## Percorsi di aggiornamento/ricaricamento (avvio vs ricaricamento live)

### Percorso di avvio iniziale

- scoperta/caricamento una tantum in `sdk.ts`,
- gli strumenti sono registrati nel registro degli strumenti della sessione iniziale.

### Percorso di ricaricamento interattivo

Il percorso `/mcp reload` (`src/modes/controllers/mcp-command-controller.ts`) esegue:

1. `mcpManager.disconnectAll()`,
2. `mcpManager.discoverAndConnect()`,
3. `session.refreshMCPTools(mcpManager.getTools())`.

`session.refreshMCPTools()` (`src/session/agent-session.ts`) rimuove tutti gli strumenti `mcp_`, ri-wrappa gli strumenti MCP più recenti e riattiva il set di strumenti in modo che le modifiche MCP si applichino senza riavviare la sessione.

Esiste anche un percorso di follow-up per le connessioni tardive: dopo aver atteso un server specifico, se lo stato diventa `connected`, viene rieseguito `session.refreshMCPTools(...)` in modo che gli strumenti appena disponibili vengano riassociati nella sessione.

## Stato di salute, riconnessione e comportamento in caso di errore parziale

Il comportamento runtime attuale è intenzionalmente minimale:

- **Nessun monitor autonomo dello stato di salute** nel manager/client.
- **Nessun ciclo di riconnessione automatica** quando un trasporto si interrompe.
- Il manager non si sottoscrive a `onClose`/`onError` del trasporto; lo stato è guidato dal registro.
- La riconnessione è esplicita: flusso di ricaricamento o invocazione diretta di `connectServers()`.

Operativamente:

- il fallimento di un server non rimuove gli strumenti dai server sani,
- gli errori di connessione/list sono isolati per singolo server,
- la cache degli strumenti e gli aggiornamenti in background sono best-effort (avvisi/errori registrati nei log, nessun arresto forzato).

## Semantica della terminazione

### Terminazione a livello di server

`disconnectServer(name)`:

- rimuove le voci in sospeso/metadati della sorgente,
- chiude il trasporto se connesso,
- rimuove gli strumenti `mcp_` di quel server dallo stato del manager.

### Terminazione globale

`disconnectAll()`:

- chiude tutti i trasporti attivi con `Promise.allSettled`,
- cancella le mappe in sospeso, le sorgenti, le connessioni e la lista degli strumenti del manager.

Nel collegamento attuale, la terminazione esplicita viene utilizzata nei flussi dei comandi MCP (per ricaricamento/rimozione/disabilitazione). Non esiste un hook separato di disposizione automatica del manager nel percorso di avvio stesso; i chiamanti sono responsabili di invocare i metodi di disconnessione del manager quando necessitano di uno spegnimento MCP deterministico.

## Modalità di errore e garanzie

| Scenario | Comportamento | Errore grave vs best-effort |
| --- | --- | --- |
| La scoperta lancia un'eccezione (percorso di caricamento capacità/configurazione) | Il loader restituisce strumenti vuoti + errore sintetico `.mcp.json` | Avvio sessione best-effort |
| Configurazione server non valida | Server saltato con voce di errore di validazione | Best-effort per singolo server |
| Timeout di connessione/errore di inizializzazione | Errore del server registrato; gli altri continuano | Best-effort per singolo server |
| `tools/list` ancora in attesa all'avvio con cache hit | Strumenti differiti restituiti immediatamente | Avvio rapido best-effort |
| `tools/list` ancora in attesa all'avvio senza cache | L'avvio attende che le attività in sospeso si concludano | Attesa forzata per correttezza |
| Fallimento tardivo del caricamento strumenti in background | Registrato nei log dopo il gate di avvio | Logging best-effort |
| Trasporto interrotto a runtime | Nessuna riconnessione automatica; le chiamate future falliscono fino a riconnessione/ricaricamento | Recupero best-effort tramite azione manuale |

## Superficie API pubblica

`src/mcp/index.ts` riesporta le API del loader/manager/client per i chiamanti esterni. `src/sdk.ts` espone `discoverMCPServers()` come wrapper di convenienza che restituisce la stessa struttura del risultato del loader.

## File di implementazione

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — facciata del loader, normalizzazione errori di scoperta, conversione `LoadedCustomTool`.
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — registri di stato del ciclo di vita, flusso parallelo di connessione/list, aggiornamento/disconnessione.
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — configurazione del trasporto, handshake di inizializzazione, list/call/disconnect.
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — esportazioni API del modulo MCP.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — collegamento all'avvio nel registro sessione/strumenti.
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — scoperta/filtraggio/validazione della configurazione utilizzata dal manager.
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — comportamento runtime di `MCPTool` e `DeferredMCPTool`.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — riassociazione live di `refreshMCPTools`.
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — flussi interattivi di ricaricamento/riconnessione.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — proxying MCP del subagent tramite le connessioni del manager padre.
