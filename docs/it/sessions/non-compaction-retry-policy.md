---
title: Non-Compaction Auto-Retry Policy
description: >-
  Politica di auto-retry per errori API transitori al di fuori del percorso di
  compattazione.
sidebar:
  order: 6
  label: Politica di retry
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# Politica di auto-retry non-compaction

Questo documento descrive il percorso standard di retry per errori API in `AgentSession`.

Esclude esplicitamente il recupero da context-overflow tramite auto-compattazione. L'overflow è gestito dalla logica di compattazione ed è documentato separatamente in [`compaction.md`](./compaction.md).

## File di implementazione

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## Confine di ambito tra retry e compattazione

Retry e compattazione vengono verificati dallo stesso percorso `agent_end`, ma sono intenzionalmente separati:

1. `agent_end` ispeziona l'ultimo messaggio dell'assistente.
2. `#isRetryableError(...)` viene eseguito per primo.
3. Se il retry viene avviato, i controlli di compattazione vengono saltati per quel turno.
4. Gli errori di context-overflow sono esclusi in modo definitivo dalla classificazione di retry (`isContextOverflow(...)` cortocircuita il retry).
5. L'overflow quindi prosegue verso `#checkCompaction(...)` invece del retry standard.

Quindi: i fallimenti di tipo overload/rate/server/network utilizzano questa politica di retry; l'overflow della finestra di contesto utilizza il recupero tramite compattazione.

## Classificazione dei retry

`#isRetryableError(...)` richiede tutte le seguenti condizioni:

- `stopReason === "error"` dell'assistente
- `errorMessage` esiste
- il messaggio **non** è un context overflow
- `errorMessage` corrisponde a `#isRetryableErrorMessage(...)`

Set corrente di pattern retryable (basato su regex):

- overloaded
- rate limit / usage limit / too many requests
- classi server di tipo HTTP: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- formulazioni con `retry delay`

Questa è una classificazione basata su pattern di stringhe, non su codici di errore tipizzati del provider.

## Ciclo di vita del retry e transizioni di stato

Stato della sessione utilizzato dal retry:

- `#retryAttempt: number` (`0` significa inattivo)
- `#retryPromise: Promise<void> | undefined` (traccia il ciclo di vita del retry in corso)
- `#retryResolve: (() => void) | undefined` (risolve `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (annulla lo sleep di backoff)

Flusso (`#handleRetryableError`):

1. Legge il gruppo di impostazioni `retry`.
2. Se `retry.enabled === false`, si interrompe immediatamente (`false`, nessun retry avviato).
3. Incrementa `#retryAttempt`.
4. Crea `#retryPromise` una sola volta (primo tentativo in una catena).
5. Se il tentativo ha superato `retry.maxRetries`, emette l'evento di fallimento finale e si interrompe.
6. Calcola il ritardo: `retry.baseDelayMs * 2^(attempt-1)`.
7. Per gli errori di usage-limit, analizza gli hint di retry e chiama l'auth storage (`markUsageLimitReached(...)`); se il cambio di provider/modello riesce, forza il ritardo a `0`.
8. Emette `auto_retry_start`.
9. Rimuove il messaggio di errore dell'assistente in coda dallo stato runtime dell'agente (mantenuto nella cronologia persistente della sessione).
10. Sleep con supporto per l'abort.
11. Al risveglio, pianifica `agent.continue()` tramite `setTimeout(..., 0)`.

### Cosa resetta i contatori di retry

`#retryAttempt` si resetta a `0` in questi casi:

- primo messaggio dell'assistente riuscito, non-errore e non-abortito dopo l'avvio dei retry (emette `auto_retry_end { success: true }`)
- cancellazione del retry durante lo sleep di backoff
- percorso di superamento del numero massimo di retry

`#retryPromise` si risolve/cancella quando la catena di retry termina (successo, cancellazione o superamento del massimo), tramite `#resolveRetry()`.

## Semantica del backoff e del numero massimo di tentativi

Impostazioni:

- `retry.enabled` (default `true`)
- `retry.maxRetries` (default `3`)
- `retry.baseDelayMs` (default `2000`)

Numerazione dei tentativi:

- il contatore dei tentativi viene incrementato prima del controllo del massimo
- gli eventi di avvio utilizzano il tentativo corrente (base 1)
- l'evento di fine per superamento del massimo riporta `attempt: this.#retryAttempt - 1` (conteggio dell'ultimo retry tentato)

Sequenza di backoff con impostazioni predefinite:

- tentativo 1: 2000 ms
- tentativo 2: 4000 ms
- tentativo 3: 8000 ms

Gli input di override del ritardo sono utilizzati solo nel percorso di gestione del usage-limit, e solo per influenzare la decisione di cambio modello/account nell'auth-storage. Nel percorso principale di retry non-compaction, il backoff rimane un ritardo esponenziale locale a meno che il cambio non riesca (`delayMs = 0`).

## Meccanica dell'abort

### Abort esplicito del retry

`abortRetry()`:

- aborta `#retryAbortController` (se presente)
- risolve la promise di retry (`#resolveRetry()`) in modo che chi è in attesa venga sbloccato

Se l'abort avviene durante lo sleep, il percorso di catch emette:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- resetta tentativo/controller

### Interazione con l'abort dell'operazione globale

`abort()` chiama `abortRetry()` prima di abortire lo stream attivo dell'agente. Questo garantisce che il backoff del retry venga cancellato quando l'utente emette un abort generale.

### Interazione con la TUI

Su `auto_retry_start`, EventController:

- sostituisce l'handler di `Esc` con `session.abortRetry()`
- visualizza il testo del loader: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

Su `auto_retry_end`, ripristina il precedente handler di `Esc` e cancella lo stato del loader.

## Comportamento dello streaming e del completamento del prompt

`prompt()` in ultima analisi attende `#waitForRetry()` dopo che `agent.prompt(...)` ritorna.

Effetto:

- una chiamata prompt non si risolve completamente fino a quando qualsiasi catena di retry avviata non termina (successo/fallimento/cancellazione)
- il ciclo di vita del retry è parte di un singolo confine logico di esecuzione del prompt

Questo impedisce ai chiamanti di considerare un turno in fase di retry come completato troppo presto.

## Controlli: impostazioni e RPC

### Parametri di configurazione

Definiti nello schema delle impostazioni sotto il gruppo retry:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

Toggle programmatici nella sessione:

- `setAutoRetryEnabled(enabled)` scrive `retry.enabled`
- `autoRetryEnabled` legge `retry.enabled`
- `isRetrying` indica se la promise del ciclo di vita del retry è attiva

### Controlli RPC

Superficie dei comandi RPC:

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

Helper del client:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

Entrambi i comandi restituiscono risposte di successo; i dettagli di progresso/fallimento del retry provengono dagli eventi di sessione in streaming, non dai payload di risposta dei comandi.

## Emissione degli eventi e visualizzazione dei fallimenti

Eventi di retry a livello di sessione:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Propagazione:

- emessi tramite `AgentSession.subscribe(...)`
- inoltrati all'extension runner come eventi di estensione
- in modalità RPC, inoltrati direttamente come oggetti evento JSON (`session.subscribe(event => output(event))`)
- nella TUI, consumati da `EventController` per l'interfaccia del loader/errore

Visualizzazione del fallimento finale:

- Al superamento del massimo o alla cancellazione, `auto_retry_end.success === false`
- La TUI mostra: `Retry failed after N attempts: <finalError>`
- Le estensioni/hook ricevono `auto_retry_end` con gli stessi campi
- I consumer RPC ricevono lo stesso oggetto evento sullo stream stdout

## Condizioni di arresto permanente

Il retry si interrompe e non continuerà automaticamente quando si verifica una qualsiasi di queste condizioni:

- `retry.enabled` è false
- l'errore non è classificato come retryable
- l'errore è un context overflow (delegato al percorso di compattazione)
- numero massimo di retry superato
- l'utente cancella il retry (`abort_retry` o `Esc` durante il loader di retry)
- abort globale (`abort`) cancella prima il retry

Una nuova catena di retry può comunque iniziare successivamente su un futuro errore retryable dopo il reset dei contatori.

## Avvertenze operative

- La classificazione è basata su corrispondenza di testo tramite regex; gli errori strutturati specifici del provider non vengono utilizzati qui.
- Il retry rimuove l'errore dell'assistente fallito dal **contesto runtime** prima di riprendere, ma la cronologia della sessione mantiene comunque quella voce di errore.
- `RpcSessionState` attualmente espone `autoCompactionEnabled` ma non un campo `autoRetryEnabled`; i chiamanti RPC devono tracciare il proprio stato del toggle o interrogare le impostazioni tramite altre API.
