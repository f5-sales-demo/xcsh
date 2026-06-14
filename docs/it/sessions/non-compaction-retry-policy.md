---
title: Politica di Riesecuzione Automatica Non-Compattazione
description: >-
  Politica di riesecuzione automatica per errori API transitori al di fuori del
  percorso di compattazione.
sidebar:
  order: 6
  label: Politica di riesecuzione
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# Politica di riesecuzione automatica non-compattazione

Questo documento descrive il percorso standard di riesecuzione degli errori API in `AgentSession`.

Esclude esplicitamente il recupero da overflow del contesto tramite auto-compattazione. L'overflow è gestito dalla logica di compattazione ed è documentato separatamente in [`compaction.md`](./compaction.md).

## File di implementazione

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## Confine dell'ambito rispetto alla compattazione

La riesecuzione e la compattazione vengono verificate dallo stesso percorso `agent_end`, ma sono intenzionalmente separate:

1. `agent_end` esamina l'ultimo messaggio dell'assistente.
2. `#isRetryableError(...)` viene eseguito per primo.
3. Se viene avviata una riesecuzione, i controlli di compattazione vengono ignorati per quel turno.
4. Gli errori di overflow del contesto sono esclusi in modo rigido dalla classificazione di riesecuzione (`isContextOverflow(...)` interrompe anticipatamente la riesecuzione).
5. L'overflow ricade quindi su `#checkCompaction(...)` anziché sulla riesecuzione standard.

In sintesi: i fallimenti di tipo sovraccarico/limite di frequenza/server/rete utilizzano questa politica di riesecuzione; l'overflow della finestra di contesto utilizza il recupero tramite compattazione.

## Classificazione della riesecuzione

`#isRetryableError(...)` richiede tutte le seguenti condizioni:

- `stopReason === "error"` dell'assistente
- `errorMessage` presente
- il messaggio **non** è un overflow del contesto
- `errorMessage` corrisponde a `#isRetryableErrorMessage(...)`

Insieme di pattern rieseguibili correnti (basati su espressioni regolari):

- overloaded
- rate limit / usage limit / too many requests
- Classi server simili a HTTP: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- formulazione `retry delay`

Si tratta di una classificazione basata su pattern di stringhe, non su codici di errore tipizzati del provider.

## Ciclo di vita della riesecuzione e transizioni di stato

Stato della sessione utilizzato dalla riesecuzione:

- `#retryAttempt: number` (`0` significa inattivo)
- `#retryPromise: Promise<void> | undefined` (traccia il ciclo di vita della riesecuzione in corso)
- `#retryResolve: (() => void) | undefined` (risolve `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (annulla il riposo del backoff)

Flusso (`#handleRetryableError`):

1. Legge il gruppo di impostazioni `retry`.
2. Se `retry.enabled === false`, si interrompe immediatamente (`false`, nessuna riesecuzione avviata).
3. Incrementa `#retryAttempt`.
4. Crea `#retryPromise` una sola volta (primo tentativo in una catena).
5. Se il tentativo supera `retry.maxRetries`, emette l'evento di fallimento finale e si interrompe.
6. Calcola il ritardo: `retry.baseDelayMs * 2^(tentativo-1)`.
7. Per gli errori di limite di utilizzo, analizza i suggerimenti di riesecuzione e chiama l'archiviazione di autenticazione (`markUsageLimitReached(...)`); se il cambio di provider/modello ha successo, forza il ritardo a `0`.
8. Emette `auto_retry_start`.
9. Rimuove il messaggio di errore dell'assistente finale dallo stato di runtime dell'agente (mantenuto nella cronologia della sessione persistita).
10. Si mette in attesa con supporto all'interruzione.
11. Al risveglio, pianifica `agent.continue()` tramite `setTimeout(..., 0)`.

### Cosa reimposta i contatori di riesecuzione

`#retryAttempt` viene reimpostato a `0` nei seguenti casi:

- primo messaggio dell'assistente riuscito, senza errori e non interrotto dopo l'avvio delle riesecuzioni (emette `auto_retry_end { success: true }`)
- annullamento della riesecuzione durante il riposo del backoff
- percorso di superamento del numero massimo di riesecuzioni

`#retryPromise` viene risolto/rimosso al termine della catena di riesecuzione (successo, annullamento o superamento del massimo), tramite `#resolveRetry()`.

## Semantica del backoff e del numero massimo di tentativi

Impostazioni:

- `retry.enabled` (predefinito `true`)
- `retry.maxRetries` (predefinito `3`)
- `retry.baseDelayMs` (predefinito `2000`)

Numerazione dei tentativi:

- il contatore dei tentativi viene incrementato prima del controllo del massimo
- gli eventi di avvio utilizzano il tentativo corrente (a partire da 1)
- l'evento di superamento del massimo riporta `attempt: this.#retryAttempt - 1` (ultimo numero di riesecuzioni tentato)

Sequenza di backoff con impostazioni predefinite:

- tentativo 1: 2000 ms
- tentativo 2: 4000 ms
- tentativo 3: 8000 ms

Gli input di override del ritardo vengono utilizzati solo nel percorso di gestione del limite di utilizzo e solo per influenzare la decisione di cambio modello/account nell'archiviazione di autenticazione. Nel percorso principale di riesecuzione non-compattazione, il backoff rimane un ritardo esponenziale locale a meno che il cambio non abbia successo (`delayMs = 0`).

## Meccanismi di interruzione

### Interruzione esplicita della riesecuzione

`abortRetry()`:

- interrompe `#retryAbortController` (se presente)
- risolve la promise di riesecuzione (`#resolveRetry()`) in modo che i processi in attesa vengano sbloccati

Se l'interruzione avviene durante il riposo, il percorso di catch emette:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- reimposta il tentativo/controller

### Interazione con l'interruzione globale dell'operazione

`abort()` chiama `abortRetry()` prima di interrompere lo stream dell'agente attivo. Ciò garantisce che il backoff della riesecuzione venga annullato quando l'utente emette un'interruzione generale.

### Interazione con la TUI

Su `auto_retry_start`, EventController:

- sostituisce il gestore `Esc` con `session.abortRetry()`
- visualizza il testo del caricamento: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

Su `auto_retry_end`, ripristina il precedente gestore `Esc` e cancella lo stato del caricamento.

## Comportamento dello streaming e del completamento del prompt

`prompt()` alla fine attende su `#waitForRetry()` dopo che `agent.prompt(...)` ritorna.

Effetto:

- una chiamata a prompt non si risolve completamente finché una catena di riesecuzione avviata non termina (successo/fallimento/annullamento)
- il ciclo di vita della riesecuzione fa parte di un singolo confine logico di esecuzione del prompt

Ciò impedisce ai chiamanti di considerare completato un turno in fase di riesecuzione troppo presto.

## Controlli: impostazioni e RPC

### Parametri di configurazione

Definiti nello schema delle impostazioni sotto il gruppo retry:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

Controlli programmatici nella sessione:

- `setAutoRetryEnabled(enabled)` scrive `retry.enabled`
- `autoRetryEnabled` legge `retry.enabled`
- `isRetrying` indica se la promise del ciclo di vita della riesecuzione è attiva

### Controlli RPC

Superficie dei comandi RPC:

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

Helper del client:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

Entrambi i comandi restituiscono risposte di successo; i dettagli sull'avanzamento/fallimento della riesecuzione provengono dagli eventi di sessione in streaming, non dai payload di risposta dei comandi.

## Emissione di eventi e segnalazione dei fallimenti

Eventi di riesecuzione a livello di sessione:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Propagazione:

- emessi tramite `AgentSession.subscribe(...)`
- inoltrati al runner dell'estensione come eventi dell'estensione
- in modalità RPC, inoltrati direttamente come oggetti evento JSON (`session.subscribe(event => output(event))`)
- nella TUI, consumati da `EventController` per la UI del caricamento/errore

Segnalazione del fallimento finale:

- In caso di superamento del massimo o annullamento, `auto_retry_end.success === false`
- La TUI mostra: `Retry failed after N attempts: <finalError>`
- Le estensioni/hook ricevono `auto_retry_end` con gli stessi campi
- I consumatori RPC ricevono lo stesso oggetto evento sullo stream stdout

## Condizioni di interruzione permanente

La riesecuzione si interrompe e non continuerà automaticamente quando si verifica una delle seguenti condizioni:

- `retry.enabled` è false
- l'errore non è classificato come rieseguibile
- l'errore è un overflow del contesto (delegato al percorso di compattazione)
- il numero massimo di riesecuzioni è stato superato
- l'utente annulla la riesecuzione (`abort_retry` o `Esc` durante il caricamento della riesecuzione)
- l'interruzione globale (`abort`) annulla prima la riesecuzione

Una nuova catena di riesecuzione può comunque avviarsi successivamente su un futuro errore rieseguibile dopo la reimpostazione dei contatori.

## Avvertenze operative

- La classificazione è basata su corrispondenza di testo tramite espressioni regolari; gli errori strutturati specifici del provider non vengono utilizzati qui.
- La riesecuzione rimuove l'errore dell'assistente in errore dal **contesto di runtime** prima di riprendere, ma la cronologia della sessione mantiene comunque quella voce di errore.
- `RpcSessionState` attualmente espone `autoCompactionEnabled` ma non un campo `autoRetryEnabled`; i chiamanti RPC devono tenere traccia del proprio stato di attivazione/disattivazione oppure interrogare le impostazioni tramite altre API.
