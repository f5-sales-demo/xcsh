---
title: Protocollo MCP e componenti interni del trasporto
description: >-
  Implementazione del protocollo MCP con livelli di trasporto stdio, SSE e HTTP
  streamable.
sidebar:
  order: 2
  label: Protocollo e trasporti
i18n:
  sourceHash: 48632064dd00
  translator: machine
---

# Protocollo MCP e componenti interni del trasporto

Questo documento descrive come coding-agent implementa la messaggistica MCP JSON-RPC e come le problematiche del protocollo vengono separate da quelle del trasporto.

## Ambito

Tratta:

- Flusso di richiesta/risposta e notifica JSON-RPC
- Correlazione delle richieste e ciclo di vita per i trasporti stdio e HTTP/SSE
- Comportamento di timeout e cancellazione
- Propagazione degli errori e gestione dei payload non validi
- Limiti di selezione del trasporto (`stdio` vs `http`/`sse`)
- Quali responsabilità di riconnessione/ripetizione appartengono al livello di trasporto rispetto al livello manager

Non tratta l'esperienza utente per la creazione di estensioni né l'interfaccia utente dei comandi.

## File di implementazione

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/transports/stdio.ts`](../../packages/coding-agent/src/mcp/transports/stdio.ts)
- [`src/mcp/transports/http.ts`](../../packages/coding-agent/src/mcp/transports/http.ts)
- [`src/mcp/transports/index.ts`](../../packages/coding-agent/src/mcp/transports/index.ts)
- [`src/mcp/json-rpc.ts`](../../packages/coding-agent/src/mcp/json-rpc.ts)
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)

## Limiti dei livelli

### Livello protocollo (JSON-RPC + metodi MCP)

- Le forme dei messaggi sono definite in `types.ts` (`JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcResponse`, `JsonRpcMessage`).
- La logica del client MCP (`client.ts`) determina l'ordine dei metodi e l'handshake di sessione:
  1. Richiesta `initialize`
  2. Notifica `notifications/initialized`
  3. Chiamate a metodi come `tools/list`, `tools/call`

### Livello di trasporto (`MCPTransport`)

`MCPTransport` astrae la consegna e il ciclo di vita:

- `request(method, params, options?) -> Promise<T>`
- `notify(method, params?) -> Promise<void>`
- `close()`
- `connected`
- callback opzionali: `onClose`, `onError`, `onNotification`

Le implementazioni del trasporto gestiscono il framing e i dettagli di I/O:

- `StdioTransport`: JSON delimitato da newline tramite stdio del sottoprocesso
- `HttpTransport`: JSON-RPC tramite HTTP POST, con risposte/ascolto SSE opzionali

### Avvertenza importante attuale

I callback del trasporto (`onClose`, `onError`, `onNotification`) sono implementati, ma i flussi attuali di `MCPClient`/`MCPManager` non collegano la logica di riconnessione a questi callback. Le notifiche vengono consumate solo se il chiamante registra i gestori.

## Selezione del trasporto

`client.ts:createTransport()` sceglie il trasporto dalla configurazione:

- `type` omesso o `"stdio"` -> `createStdioTransport`
- `"http"` o `"sse"` -> `createHttpTransport`

`"sse"` è trattato come una variante del trasporto HTTP (stessa classe), non come un'implementazione di trasporto separata.

## Flusso dei messaggi JSON-RPC e correlazione

## ID delle richieste

Ogni trasporto genera ID per richiesta (`Math.random` + stringa timestamp). Gli ID sono token di correlazione locali al trasporto.

## Percorso di correlazione stdio

- La richiesta in uscita è serializzata come un oggetto JSON + `\n`.
- `#pendingRequests: Map<id, {resolve,reject}>` memorizza le richieste in corso.
- Il ciclo di lettura analizza il JSONL dallo stdout e chiama `#handleMessage`.
- Se il messaggio in entrata ha un `id` corrispondente, la richiesta viene risolta o rifiutata.
- Se il messaggio in entrata ha `method` ma nessun `id`, viene trattato come notifica e inviato a `onNotification`.

Gli ID sconosciuti vengono ignorati (nessun rifiuto, nessun callback di errore).

## Percorso di correlazione HTTP

- La richiesta in uscita è una `POST` HTTP con corpo JSON e `id` generato.
- Percorso risposta non-SSE: analizza una risposta JSON-RPC e restituisce `result` oppure genera un'eccezione su `error`.
- Percorso risposta SSE (`Content-Type: text/event-stream`): trasmette eventi in streaming, restituisce il primo messaggio il cui `id` corrisponde all'ID di richiesta atteso e che contiene `result` o `error`.
- I messaggi SSE con `method` e senza `id` vengono trattati come notifiche.

Se il flusso SSE termina prima di ricevere la risposta corrispondente, la richiesta fallisce con `No response received for request ID ...`.

## Notifiche

Il client emette notifiche JSON-RPC tramite `transport.notify(...)`.

- Stdio: scrive il frame di notifica sullo stdin (`jsonrpc`, `method`, `params` opzionale) più newline.
- HTTP: invia il corpo POST senza `id`; il successo accetta `2xx` o `202 Accepted`.

Le notifiche avviate dal server vengono esposte solo tramite `onNotification` del trasporto; non esiste un sottoscrittore globale predefinito nel manager/client.

## Componenti interni del trasporto stdio

## Ciclo di vita e transizioni di stato

- Iniziale: `connected=false`, `process=null`, mappa pending vuota
- `connect()`:
  - avvia il sottoprocesso con comando/argomenti/env/cwd configurati
  - segna come connesso
  - avvia il ciclo di lettura stdout (`readJsonl`)
  - avvia il ciclo stderr (lettura/scarto; attualmente silenzioso)
- `close()`:
  - segna come disconnesso
  - rifiuta tutte le richieste pending (`Transport closed`)
  - termina il sottoprocesso
  - attende la chiusura del ciclo di lettura
  - emette `onClose`

Se il ciclo di lettura termina inaspettatamente, il blocco `finally` attiva `#handleClose()` che esegue lo stesso rifiuto delle richieste pending e il callback di chiusura.

## Timeout e cancellazione

Per ogni richiesta:

- il timeout predefinito è `config.timeout ?? 30000`
- `AbortSignal` opzionale dal chiamante
- abort e timeout rifiutano entrambi la promise pending e puliscono la voce nella mappa

La cancellazione è solo locale: il trasporto non invia notifiche di cancellazione a livello di protocollo al server.

## Gestione dei payload non validi

Nel ciclo di lettura:

- ogni riga JSONL analizzata viene passata a `#handleMessage` in un blocco `try/catch`
- le eccezioni nella gestione di messaggi non validi vengono scartate (commento `Skip malformed lines`)
- il ciclo continua, quindi un messaggio errato non interrompe la connessione

Se il parser del flusso sottostante genera un'eccezione, viene invocato `onError` (quando ancora connesso), quindi la connessione si chiude.

## Comportamento in caso di disconnessione/errore

Quando il processo termina o il flusso si chiude:

- tutte le richieste in corso vengono rifiutate con `Transport closed`
- nessun riavvio o riconnessione automatica
- i livelli superiori devono riconnettersi creando un nuovo trasporto

## Note su backpressure/streaming

- Le scritture in uscita utilizzano `stdin.write()` + `flush()` senza attendere la semantica di drain.
- Non esiste una gestione esplicita della coda o della soglia massima nel trasporto.
- L'elaborazione in entrata è guidata dallo stream (`for await` su `readJsonl`), un messaggio analizzato alla volta.

## Componenti interni del trasporto HTTP/SSE

## Ciclo di vita e semantica della connessione

Il trasporto HTTP ha uno stato di connessione logico, ma il percorso delle richieste è senza stato per ogni chiamata HTTP:

- `connect()` imposta `connected=true` (nessun handshake socket/sessione)
- tracciamento opzionale della sessione server tramite header `Mcp-Session-Id`
- `close()` invia opzionalmente `DELETE` con `Mcp-Session-Id`, interrompe il listener SSE, emette `onClose`

Quindi `connected` significa "trasporto utilizzabile", non "flusso persistente stabilito".

## Comportamento dell'header di sessione

- Alla risposta POST, se è presente l'header `Mcp-Session-Id`, il trasporto lo memorizza.
- Le richieste/notifiche successive includono `Mcp-Session-Id`.
- `close()` tenta di terminare la sessione server con HTTP DELETE; i fallimenti di terminazione vengono ignorati.

## Timeout e cancellazione

Per `request()` e `notify()`:

- il timeout utilizza `AbortController` (`config.timeout ?? 30000`)
- il segnale esterno, se fornito, viene unito tramite `AbortSignal.any([...])`
- la gestione di AbortError distingue tra abort del chiamante e timeout

Errori generati:

- timeout: `Request timeout after ...ms` (o `SSE response timeout ...`, `Notify timeout ...`)
- abort del chiamante: l'AbortError originale viene rigenerato quando il segnale esterno è già stato interrotto

## Propagazione degli errori HTTP

In caso di risposta non OK:

- il testo della risposta è incluso nell'errore generato (`HTTP <status>: <text>`)
- se presenti, gli hint di autenticazione da `WWW-Authenticate` e `Mcp-Auth-Server` vengono aggiunti

In caso di oggetto errore JSON-RPC:

- genera `MCP error <code>: <message>`

I fallimenti nella lettura del corpo JSON (`response.json()`) si propagano come eccezione di parsing.

## Comportamento SSE e modalità

Esistono due percorsi SSE:

1. **Risposta SSE per richiesta** (`#parseSSEResponse`)
   - utilizzato quando il tipo di contenuto della risposta POST è `text/event-stream`
   - consuma il flusso fino a trovare l'id di risposta corrispondente
   - può elaborare notifiche intercalate durante lo stesso flusso

2. **Listener SSE in background** (`startSSEListener()`)
   - listener GET opzionale per notifiche avviate dal server
   - attualmente non avviato automaticamente dal manager/client MCP
   - se la GET restituisce `405`, il listener si disabilita silenziosamente (il server non supporta questa modalità)

## Gestione dei payload non validi e disconnessione

Gli errori di parsing JSON SSE emergono da `readSseJson` e rifiutano la richiesta/il listener.

- Gli errori di parsing SSE nella richiesta rifiutano la richiesta attiva.
- Gli errori del listener in background attivano `onError` (ad eccezione di AbortError).
- Nessuna riconnessione automatica per il listener in background.

## Utilità `json-rpc.ts` vs astrazione del trasporto

`src/mcp/json-rpc.ts` fornisce gli helper `callMCP()` e `parseSSE()` per chiamate MCP HTTP dirette (utilizzate dall'integrazione Exa), non l'astrazione `MCPTransport` utilizzata da `MCPClient`/`MCPManager`.

Differenze notevoli rispetto a `HttpTransport`:

- analizza prima l'intero testo della risposta, poi estrae la prima riga `data:` (`parseSSE`), con fallback JSON
- nessuna gestione del timeout delle richieste, nessuna API di abort, nessuna gestione di session-id, nessun ciclo di vita del trasporto
- restituisce l'oggetto envelope JSON-RPC grezzo

Questo percorso è leggero ma meno robusto rispetto all'implementazione completa del trasporto.

## Responsabilità di ripetizione/riconnessione

## A livello di trasporto

Le implementazioni attuali del trasporto **non**:

- ripetono le richieste fallite
- si riconnettono dopo l'uscita del processo stdio
- riconnettono i listener SSE
- reinviano le richieste in corso dopo la disconnessione

Falliscono rapidamente e propagano gli errori.

## A livello di manager/client

`MCPManager` gestisce l'orchestrazione della scoperta/connessione iniziale e può riconnettersi solo rieseguendo i flussi di connessione (`connectToServer`/percorsi `discoverAndConnect`). Non ripara automaticamente un trasporto già connesso in caso di callback di errore a runtime.

`MCPManager` ha un comportamento di fallback all'avvio per i server lenti (strumenti differiti dalla cache), ma questo è un fallback per la disponibilità degli strumenti, non un meccanismo di ripetizione del trasporto.

## Riepilogo degli scenari di errore

- **Riga di messaggio stdio non valida**: scartata; il flusso continua.
- **Il flusso/processo stdio termina**: il trasporto si chiude; le richieste pending vengono rifiutate come `Transport closed`.
- **HTTP non-2xx**: la richiesta/notifica genera un errore HTTP.
- **Risposta JSON non valida**: l'eccezione di parsing viene propagata.
- **SSE termina senza id corrispondente**: la richiesta fallisce con `No response received for request ID ...`.
- **Timeout**: errore di timeout specifico del trasporto.
- **Abort del chiamante**: AbortError/ragione propagata dal segnale del chiamante.

## Regola pratica sui limiti

Se la problematica riguarda la forma del messaggio, la correlazione degli id o l'ordinamento dei metodi MCP, appartiene alla logica di protocollo/client.

Se la problematica riguarda il framing (JSONL vs HTTP/SSE), il parsing del flusso, il ciclo di vita di fetch/spawn, i clock di timeout o la chiusura della connessione, appartiene all'implementazione del trasporto.
