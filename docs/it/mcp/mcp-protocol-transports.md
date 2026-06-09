---
title: Protocollo MCP e componenti interni dei trasporti
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

# Protocollo MCP e componenti interni dei trasporti

Questo documento descrive come coding-agent implementa la messaggistica MCP JSON-RPC e come le responsabilità del protocollo sono separate da quelle del trasporto.

## Ambito

Copre:

- Flusso di richiesta/risposta e notifiche JSON-RPC
- Correlazione delle richieste e ciclo di vita per i trasporti stdio e HTTP/SSE
- Comportamento di timeout e cancellazione
- Propagazione degli errori e gestione dei payload malformati
- Confini di selezione del trasporto (`stdio` vs `http`/`sse`)
- Quali responsabilità di riconnessione/ripetizione sono a livello di trasporto vs a livello di manager

Non copre l'UX per la creazione di estensioni o l'interfaccia utente dei comandi.

## File di implementazione

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/transports/stdio.ts`](../../packages/coding-agent/src/mcp/transports/stdio.ts)
- [`src/mcp/transports/http.ts`](../../packages/coding-agent/src/mcp/transports/http.ts)
- [`src/mcp/transports/index.ts`](../../packages/coding-agent/src/mcp/transports/index.ts)
- [`src/mcp/json-rpc.ts`](../../packages/coding-agent/src/mcp/json-rpc.ts)
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)

## Confini dei livelli

### Livello protocollo (JSON-RPC + metodi MCP)

- Le strutture dei messaggi sono definite in `types.ts` (`JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcResponse`, `JsonRpcMessage`).
- La logica del client MCP (`client.ts`) decide l'ordine dei metodi e l'handshake di sessione:
  1. Richiesta `initialize`
  2. Notifica `notifications/initialized`
  3. Chiamate ai metodi come `tools/list`, `tools/call`

### Livello trasporto (`MCPTransport`)

`MCPTransport` astrae la consegna e il ciclo di vita:

- `request(method, params, options?) -> Promise<T>`
- `notify(method, params?) -> Promise<void>`
- `close()`
- `connected`
- callback opzionali: `onClose`, `onError`, `onNotification`

Le implementazioni del trasporto gestiscono i dettagli di framing e I/O:

- `StdioTransport`: JSON delimitato da nuova riga su stdio del sottoprocesso
- `HttpTransport`: JSON-RPC su HTTP POST, con risposte/ascolto SSE opzionali

### Avvertenza importante attuale

I callback del trasporto (`onClose`, `onError`, `onNotification`) sono implementati, ma i flussi correnti di `MCPClient`/`MCPManager` non collegano la logica di riconnessione a questi callback. Le notifiche vengono consumate solo se il chiamante registra degli handler.

## Selezione del trasporto

`client.ts:createTransport()` sceglie il trasporto dalla configurazione:

- `type` omesso o `"stdio"` -> `createStdioTransport`
- `"http"` o `"sse"` -> `createHttpTransport`

`"sse"` è trattato come una variante del trasporto HTTP (stessa classe), non come un'implementazione di trasporto separata.

## Flusso dei messaggi JSON-RPC e correlazione

## ID delle richieste

Ogni trasporto genera ID per ogni richiesta (stringa `Math.random` + timestamp). Gli ID sono token di correlazione locali al trasporto.

## Percorso di correlazione stdio

- La richiesta in uscita viene serializzata come un singolo oggetto JSON + `\n`.
- `#pendingRequests: Map<id, {resolve,reject}>` memorizza le richieste in corso.
- Il ciclo di lettura analizza JSONL da stdout e chiama `#handleMessage`.
- Se il messaggio in arrivo ha un `id` corrispondente, la richiesta viene risolta/rifiutata.
- Se il messaggio in arrivo ha `method` e nessun `id`, viene trattato come notifica e inviato a `onNotification`.

Gli ID sconosciuti vengono ignorati (nessun rifiuto, nessun callback di errore).

## Percorso di correlazione HTTP

- La richiesta in uscita è un HTTP `POST` con corpo JSON e `id` generato.
- Percorso di risposta non-SSE: analizza una singola risposta JSON-RPC e restituisce `result`/lancia eccezione su `error`.
- Percorso di risposta SSE (`Content-Type: text/event-stream`): trasmette eventi in streaming, restituisce il primo messaggio il cui `id` corrisponde all'ID della richiesta atteso e che ha `result` o `error`.
- I messaggi SSE con `method` e senza `id` vengono trattati come notifiche.

Se lo stream SSE termina prima della risposta corrispondente, la richiesta fallisce con `No response received for request ID ...`.

## Notifiche

Il client emette notifiche JSON-RPC tramite `transport.notify(...)`.

- Stdio: scrive il frame di notifica su stdin (`jsonrpc`, `method`, `params` opzionale) più nuova riga.
- HTTP: invia il corpo POST senza `id`; il successo accetta `2xx` o `202 Accepted`.

Le notifiche iniziate dal server vengono esposte solo tramite il `onNotification` del trasporto; non esiste un sottoscrittore globale predefinito nel manager/client.

## Componenti interni del trasporto stdio

## Ciclo di vita e transizioni di stato

- Iniziale: `connected=false`, `process=null`, mappa dei pending vuota
- `connect()`:
  - avvia il sottoprocesso con comando/argomenti/env/cwd configurati
  - segna come connesso
  - avvia il ciclo di lettura stdout (`readJsonl`)
  - avvia il ciclo stderr (lettura/scarto; attualmente silenzioso)
- `close()`:
  - segna come disconnesso
  - rifiuta tutte le richieste in sospeso (`Transport closed`)
  - termina il sottoprocesso
  - attende l'arresto del ciclo di lettura
  - emette `onClose`

Se il ciclo di lettura termina inaspettatamente, il `finally` attiva `#handleClose()` che esegue lo stesso rifiuto delle richieste in sospeso e il callback di chiusura.

## Timeout e cancellazione

Per ogni richiesta:

- il timeout predefinito è `config.timeout ?? 30000`
- `AbortSignal` opzionale dal chiamante
- sia abort che timeout rifiutano la promise in sospeso e puliscono l'entry nella mappa

La cancellazione è solo locale: il trasporto non invia una notifica di cancellazione a livello di protocollo al server.

## Gestione dei payload malformati

Nel ciclo di lettura:

- ogni riga JSONL analizzata viene passata a `#handleMessage` in `try/catch`
- le eccezioni di gestione dei messaggi malformati/invalidi vengono scartate (commento `Skip malformed lines`)
- il ciclo continua, quindi un singolo messaggio errato non interrompe la connessione

Se il parser dello stream sottostante lancia un'eccezione, viene invocato `onError` (quando ancora connesso), poi la connessione si chiude.

## Comportamento in caso di disconnessione/errore

Quando il processo termina o lo stream si chiude:

- tutte le richieste in corso vengono rifiutate con `Transport closed`
- nessun riavvio o riconnessione automatica
- i livelli superiori devono riconnettersi creando un nuovo trasporto

## Note su backpressure/streaming

- Le scritture in uscita usano `stdin.write()` + `flush()` senza attendere la semantica di drain.
- Non c'è gestione esplicita di code o high-watermark nel trasporto.
- L'elaborazione in ingresso è guidata dallo stream (`for await` su `readJsonl`), un messaggio analizzato alla volta.

## Componenti interni del trasporto HTTP/SSE

## Ciclo di vita e semantica di connessione

Il trasporto HTTP ha uno stato di connessione logico, ma il percorso delle richieste è stateless per ogni chiamata HTTP:

- `connect()` imposta `connected=true` (nessun handshake socket/sessione)
- tracciamento opzionale della sessione server tramite header `Mcp-Session-Id`
- `close()` invia opzionalmente `DELETE` con `Mcp-Session-Id`, interrompe il listener SSE, emette `onClose`

Quindi `connected` significa "trasporto utilizzabile", non "stream persistente stabilito".

## Comportamento dell'header di sessione

- Nella risposta al POST, se l'header `Mcp-Session-Id` è presente, il trasporto lo memorizza.
- Le richieste/notifiche successive includono `Mcp-Session-Id`.
- `close()` tenta di terminare la sessione server con HTTP DELETE; i fallimenti nella terminazione vengono ignorati.

## Timeout e cancellazione

Per sia `request()` che `notify()`:

- il timeout usa `AbortController` (`config.timeout ?? 30000`)
- il signal esterno, se fornito, viene unito tramite `AbortSignal.any([...])`
- la gestione di AbortError distingue tra abort del chiamante e timeout

Errori lanciati:

- timeout: `Request timeout after ...ms` (o `SSE response timeout ...`, `Notify timeout ...`)
- abort del chiamante: l'AbortError originale viene rilanciato quando il signal esterno è già stato interrotto

## Propagazione degli errori HTTP

In caso di risposta non-OK:

- il testo della risposta è incluso nell'errore lanciato (`HTTP <status>: <text>`)
- se presenti, gli hint di autenticazione da `WWW-Authenticate` e `Mcp-Auth-Server` vengono aggiunti

In caso di oggetto errore JSON-RPC:

- lancia `MCP error <code>: <message>`

Il fallimento nell'analisi del corpo JSON (`response.json()`) si propaga come eccezione di parsing.

## Comportamento SSE e modalità

Esistono due percorsi SSE:

1. **Risposta SSE per richiesta** (`#parseSSEResponse`)
   - usato quando il content type della risposta POST è `text/event-stream`
   - consuma lo stream fino a trovare l'id di risposta corrispondente
   - può elaborare notifiche intercalate durante lo stesso stream

2. **Listener SSE in background** (`startSSEListener()`)
   - listener GET opzionale per notifiche iniziate dal server
   - attualmente non avviato automaticamente dal manager/client MCP
   - se GET restituisce `405`, il listener si disabilita silenziosamente (il server non supporta questa modalità)

## Gestione dei payload malformati e disconnessione

Gli errori di parsing JSON SSE emergono da `readSseJson` e rifiutano la richiesta/listener.

- Gli errori di parsing SSE della richiesta rifiutano la richiesta attiva.
- Gli errori del listener in background attivano `onError` (eccetto AbortError).
- Nessuna riconnessione automatica per il listener in background.

## Utilità `json-rpc.ts` vs astrazione del trasporto

`src/mcp/json-rpc.ts` fornisce gli helper `callMCP()` e `parseSSE()` per chiamate MCP HTTP dirette (usate dall'integrazione Exa), non l'astrazione `MCPTransport` usata da `MCPClient`/`MCPManager`.

Differenze notevoli rispetto a `HttpTransport`:

- analizza prima l'intero testo della risposta, poi estrae la prima riga `data:` (`parseSSE`), con fallback JSON
- nessuna gestione del timeout delle richieste, nessuna API di abort, nessuna gestione del session-id, nessun ciclo di vita del trasporto
- restituisce l'oggetto envelope JSON-RPC grezzo

Questo percorso è leggero ma meno robusto dell'implementazione completa del trasporto.

## Responsabilità di ripetizione/riconnessione

## Livello trasporto

Le implementazioni correnti del trasporto **non**:

- ripetono le richieste fallite
- si riconnettono dopo l'uscita del processo stdio
- riconnettono i listener SSE
- rinviano le richieste in corso dopo una disconnessione

Falliscono rapidamente e propagano gli errori.

## Livello manager/client

`MCPManager` gestisce il discovery/orchestrazione della connessione iniziale e può riconnettersi solo eseguendo nuovamente i flussi di connessione (percorsi `connectToServer`/`discoverAndConnect`). Non ripara automaticamente un trasporto già connesso in caso di callback di errore a runtime.

`MCPManager` ha un comportamento di fallback all'avvio per server lenti (strumenti differiti dalla cache), ma questo è un fallback di disponibilità degli strumenti, non una ripetizione del trasporto.

## Riepilogo degli scenari di errore

- **Riga di messaggio stdio malformata**: scartata; lo stream continua.
- **Stream/processo stdio terminato**: il trasporto si chiude; le richieste in sospeso vengono rifiutate come `Transport closed`.
- **HTTP non-2xx**: richiesta/notifica lancia errore HTTP.
- **Risposta JSON non valida**: eccezione di parsing propagata.
- **SSE termina senza id corrispondente**: la richiesta fallisce con `No response received for request ID ...`.
- **Timeout**: errore di timeout specifico del trasporto.
- **Abort del chiamante**: AbortError/motivo propagato dal signal del chiamante.

## Regola pratica di confine

Se la responsabilità riguarda la struttura del messaggio, la correlazione degli id o l'ordinamento dei metodi MCP, appartiene alla logica del protocollo/client.

Se la responsabilità riguarda il framing (JSONL vs HTTP/SSE), il parsing dello stream, il ciclo di vita di fetch/spawn, i timer di timeout o la chiusura della connessione, appartiene all'implementazione del trasporto.
