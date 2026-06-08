---
title: Ciclo di vita del runtime MCP
description: >-
  Ciclo di vita del processo server MCP dall'inizializzazione alla registrazione
  degli strumenti, monitoraggio dello stato e arresto.
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

1. **L'avvio dell'SDK** chiama `discoverAndLoadMCPTools()` (a meno che MCP non sia disabilitato).
2. **La discovery** (`loadAllMCPConfigs`) risolve le configurazioni dei server MCP dalle sorgenti di capability, filtra le voci disabilitate/progetto/Exa e preserva i metadati della sorgente.
3. **La fase di connessione del Manager** (`MCPManager.connectServers`) avvia la connessione per server + `tools/list` in parallelo.
4. **Il gate di avvio rapido** attende fino a 250ms, poi può restituire:
   - `MCPTool` completamente caricati,
   - errori per server,
   - o `DeferredMCPTool` dalla cache per i server ancora in attesa.
5. **Il wiring dell'SDK** unisce gli strumenti MCP nel registro degli strumenti del runtime per la sessione.
6. **La sessione attiva** può aggiornare gli strumenti MCP tramite i flussi `/mcp` (`disconnectAll` + ri-discovery + `session.refreshMCPTools`).
7. **La terminazione** avviene quando i chiamanti invocano `disconnectServer`/`disconnectAll`; il manager cancella anche le registrazioni degli strumenti MCP per i server disconnessi.

## Fase di discovery e caricamento

### Percorso di ingresso dall'SDK

`createAgentSession()` in `src/sdk.ts` esegue l'avvio MCP quando `enableMCP` è true (predefinito):

- chiama `discoverAndLoadMCPTools(cwd, { ... })`,
- passa `authStorage`, lo storage della cache e l'impostazione `mcp.enableProjectConfig`,
- imposta sempre `filterExa: true`,
- registra nei log gli errori di caricamento/connessione per server,
- memorizza il manager restituito in `toolSession.mcpManager` e nel risultato della sessione.

Se `enableMCP` è false, la discovery MCP viene completamente saltata.

### Discovery e filtraggio della configurazione

`loadAllMCPConfigs()` (`src/mcp/config.ts`) carica gli elementi canonici del server MCP attraverso la discovery delle capability, poi li converte nella `MCPServerConfig` legacy.

Comportamento del filtraggio:

- `enableProjectConfig: false` rimuove le voci a livello di progetto (`_source.level === "project"`).
- I server con `enabled: false` vengono saltati prima dei tentativi di connessione.
- I server Exa vengono filtrati per impostazione predefinita e le chiavi API vengono estratte per l'integrazione nativa dello strumento Exa.

Il risultato include sia `configs` che `sources` (metadati usati successivamente per l'etichettatura del provider).

### Comportamento in caso di errore a livello di discovery

`discoverAndLoadMCPTools()` distingue due classi di errore:

- **Errore grave della discovery** (eccezione da `manager.discoverAndConnect`, tipicamente dalla discovery della configurazione): restituisce un set di strumenti vuoto e un errore sintetico `{ path: ".mcp.json", error }`.
- **Errore di runtime/connessione per server**: il manager restituisce un successo parziale con la mappa `errors`; gli altri server continuano.

Quindi l'avvio non fa fallire l'intera sessione dell'agente quando singoli server MCP falliscono.

## Modello di stato del Manager

`MCPManager` traccia il ciclo di vita del runtime con registri separati:

- `#connections: Map<string, MCPServerConnection>` — server completamente connessi.
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — handshake in corso.
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — connessi ma strumenti ancora in caricamento.
- `#tools: CustomTool[]` — vista corrente degli strumenti MCP esposta ai chiamanti.
- `#sources: Map<string, SourceMeta>` — metadati del provider/sorgente anche prima del completamento della connessione.

`getConnectionStatus(name)` deriva lo stato da queste mappe:

- `connected` se presente in `#connections`,
- `connecting` se in connessione pendente o caricamento strumenti pendente,
- `disconnected` altrimenti.

## Stabilimento della connessione e tempistica di avvio

## Pipeline di connessione per server

Per ogni server scoperto in `connectServers()`:

1. memorizzare/aggiornare i metadati della sorgente,
2. saltare se già connesso/pendente,
3. validare i campi di trasporto (`validateServerConfig`),
4. risolvere le sostituzioni di auth/shell (`#resolveAuthConfig`),
5. chiamare `connectToServer(name, resolvedConfig)`,
6. chiamare `listTools(connection)`,
7. mettere in cache le definizioni degli strumenti (`MCPToolCache.set`) in modalità best-effort.

Comportamento di `connectToServer()` (`src/mcp/client.ts`):

- crea un trasporto stdio o HTTP/SSE,
- esegue `initialize` MCP + `notifications/initialized`,
- utilizza un timeout (`config.timeout` o 30s predefinito),
- chiude il trasporto in caso di errore di inizializzazione.

### Gate di avvio rapido + fallback differito

`connectServers()` attende una gara tra:

- tutti i task di connessione/caricamento strumenti completati, e
- `STARTUP_TIMEOUT_MS = 250`.

Dopo 250ms:

- i task completati con successo diventano `MCPTool` attivi,
- i task rifiutati producono errori per server,
- i task ancora pendenti:
  - usano le definizioni degli strumenti dalla cache se disponibili (`MCPToolCache.get`) per creare `DeferredMCPTool`,
  - altrimenti attendono fino al completamento di quei task pendenti.

Questo è un modello di avvio ibrido: ritorno rapido quando la cache è disponibile, attesa per correttezza quando la cache non è disponibile.

### Comportamento di completamento in background

Ogni `toolsPromise` pendente ha anche una continuazione in background che alla fine:

- sostituisce la porzione di strumenti di quel server nello stato del manager tramite `#replaceServerTools`,
- scrive la cache,
- registra nei log gli errori tardivi solo dopo l'avvio (`allowBackgroundLogging`).

## Esposizione degli strumenti e disponibilità nella sessione attiva

### Registrazione all'avvio

`discoverAndLoadMCPTools()` converte gli strumenti del manager in `LoadedCustomTool[]` e decora i percorsi (`mcp:<server> via <providerName>` quando noto).

`createAgentSession()` poi inserisce questi strumenti in `customTools`, che vengono wrappati e aggiunti al registro degli strumenti del runtime con nomi come `mcp_<server>_<tool>`.

### Chiamate agli strumenti

- `MCPTool` chiama gli strumenti attraverso una `MCPServerConnection` già connessa.
- `DeferredMCPTool` attende `waitForConnection(server)` prima di chiamare; questo permette agli strumenti dalla cache di esistere prima che la connessione sia pronta.

Entrambi restituiscono output strutturato dello strumento e convertono gli errori di trasporto/strumento in contenuto dello strumento `MCP error: ...` (l'abort rimane abort).

## Percorsi di aggiornamento/ricaricamento (avvio vs ricaricamento dal vivo)

### Percorso di avvio iniziale

- discovery/caricamento una tantum in `sdk.ts`,
- gli strumenti vengono registrati nel registro degli strumenti della sessione iniziale.

### Percorso di ricaricamento interattivo

Il percorso `/mcp reload` (`src/modes/controllers/mcp-command-controller.ts`) esegue:

1. `mcpManager.disconnectAll()`,
2. `mcpManager.discoverAndConnect()`,
3. `session.refreshMCPTools(mcpManager.getTools())`.

`session.refreshMCPTools()` (`src/session/agent-session.ts`) rimuove tutti gli strumenti `mcp_`, ri-wrappa gli ultimi strumenti MCP e ri-attiva il set di strumenti in modo che le modifiche MCP si applichino senza riavviare la sessione.

Esiste anche un percorso di follow-up per le connessioni tardive: dopo aver atteso un server specifico, se lo stato diventa `connected`, ri-esegue `session.refreshMCPTools(...)` in modo che gli strumenti appena disponibili vengano riassociati nella sessione.

## Salute, riconnessione e comportamento in caso di errore parziale

Il comportamento attuale del runtime è intenzionalmente minimale:

- **Nessun monitor autonomo della salute** nel manager/client.
- **Nessun ciclo di riconnessione automatica** quando un trasporto si interrompe.
- Il manager non si iscrive a `onClose`/`onError` del trasporto; lo stato è guidato dal registro.
- La riconnessione è esplicita: flusso di ricaricamento o invocazione diretta di `connectServers()`.

Operativamente:

- il fallimento di un server non rimuove gli strumenti dai server sani,
- gli errori di connessione/lista sono isolati per server,
- la cache degli strumenti e gli aggiornamenti in background sono best-effort (warning/errori registrati nei log, nessun arresto forzato).

## Semantica della terminazione

### Terminazione a livello di server

`disconnectServer(name)`:

- rimuove le voci pendenti/metadati della sorgente,
- chiude il trasporto se connesso,
- rimuove gli strumenti `mcp_` di quel server dallo stato del manager.

### Terminazione globale

`disconnectAll()`:

- chiude tutti i trasporti attivi con `Promise.allSettled`,
- cancella le mappe pendenti, le sorgenti, le connessioni e la lista degli strumenti del manager.

Nel wiring attuale, la terminazione esplicita è usata nei flussi dei comandi MCP (per ricaricamento/rimozione/disabilitazione). Non esiste un hook separato di disposal automatico del manager nel percorso di avvio stesso; i chiamanti sono responsabili di invocare i metodi di disconnessione del manager quando necessitano di un arresto MCP deterministico.

## Modalità di errore e garanzie

| Scenario | Comportamento | Errore grave vs best-effort |
| --- | --- | --- |
| La discovery lancia un'eccezione (percorso di caricamento capability/config) | Il loader restituisce strumenti vuoti + errore sintetico `.mcp.json` | Avvio sessione best-effort |
| Configurazione server non valida | Server saltato con voce di errore di validazione | Best-effort per server |
| Timeout di connessione/errore di inizializzazione | Errore del server registrato; gli altri continuano | Best-effort per server |
| `tools/list` ancora pendente all'avvio con cache disponibile | Strumenti differiti restituiti immediatamente | Avvio rapido best-effort |
| `tools/list` ancora pendente all'avvio senza cache | L'avvio attende il completamento dei pendenti | Attesa forzata per correttezza |
| Errore tardivo di caricamento strumenti in background | Registrato nei log dopo il gate di avvio | Logging best-effort |
| Trasporto interrotto a runtime | Nessuna riconnessione automatica; le chiamate future falliscono fino a riconnessione/ricaricamento | Recupero best-effort tramite azione manuale |

## Superficie dell'API pubblica

`src/mcp/index.ts` ri-esporta le API del loader/manager/client per i chiamanti esterni. `src/sdk.ts` espone `discoverMCPServers()` come wrapper di convenienza che restituisce la stessa forma di risultato del loader.

## File di implementazione

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — facciata del loader, normalizzazione degli errori della discovery, conversione `LoadedCustomTool`.
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — registri di stato del ciclo di vita, flusso parallelo di connessione/lista, aggiornamento/disconnessione.
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — configurazione del trasporto, handshake di inizializzazione, lista/chiamata/disconnessione.
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — esportazioni dell'API del modulo MCP.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — wiring di avvio nel registro sessione/strumenti.
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — discovery/filtraggio/validazione della configurazione usata dal manager.
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — comportamento runtime di `MCPTool` e `DeferredMCPTool`.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — riassociazione dal vivo `refreshMCPTools`.
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — flussi interattivi di ricaricamento/riconnessione.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — proxy MCP del subagent tramite connessioni del manager padre.
