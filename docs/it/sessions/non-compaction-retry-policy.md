---
title: Politica di ripetizione automatica non relativa alla compattazione
description: >-
  Politica di ripetizione automatica per errori API transitori al di fuori del
  percorso di compattazione.
sidebar:
  order: 6
  label: Politica di ripetizione
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# Politica di ripetizione automatica non relativa alla compattazione

Questo documento descrive il percorso standard di ripetizione per errori API in `AgentSession`.

Esclude esplicitamente il recupero da overflow del contesto tramite auto-compattazione. L'overflow è gestito dalla logica di compattazione ed è documentato separatamente in [`compaction.md`](./compaction.md).

## File di implementazione

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## Confine di ambito rispetto alla compattazione

Ripetizione e compattazione vengono verificate dallo stesso percorso `agent_end`, ma sono intenzionalmente separate:

1. `agent_end` esamina l'ultimo messaggio dell'assistente.
2. `#isRetryableError(...)` viene eseguito per primo.
3. Se viene avviata la ripetizione, i controlli di compattazione vengono saltati per quel turno.
4. Gli errori di overflow del contesto sono esclusi in modo rigido dalla classificazione di ripetizione (`isContextOverflow(...)` cortocircuita la ripetizione).
5. L'overflow viene quindi indirizzato a `#checkCompaction(...)` anziché alla ripetizione standard.

Pertanto: i fallimenti di tipo sovraccarico/rate limit/server/rete utilizzano questa politica di ripetizione; l'overflow della finestra di contesto utilizza il recupero tramite compattazione.

## Classificazione della ripetizione

`#isRetryableError(...)` richiede tutte le seguenti condizioni:

- `stopReason === "error"` dell'assistente
- `errorMessage` esiste
- il messaggio **non** è un overflow del contesto
- `errorMessage` corrisponde a `#isRetryableErrorMessage(...)`

Set corrente di pattern ripetibili (basato su regex):

- overloaded
- rate limit / usage limit / too many requests
- classi server HTTP: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- formulazione `retry delay`

Si tratta di classificazione basata su pattern di stringhe, non su codici di errore strutturati del provider.

## Ciclo di vita della ripetizione e transizioni di stato

Stato della sessione utilizzato dalla ripetizione:

- `#retryAttempt: number` (`0` significa inattivo)
- `#retryPromise: Promise<void> | undefined` (traccia il ciclo di vita della ripetizione in corso)
- `#retryResolve: (() => void) | undefined` (risolve `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (annulla la pausa di backoff)

Flusso (`#handleRetryableError`):

1. Legge il gruppo di impostazioni `retry`.
2. Se `retry.enabled === false`, si ferma immediatamente (`false`, nessuna ripetizione avviata).
3. Incrementa `#retryAttempt`.
4. Crea `#retryPromise` una sola volta (primo tentativo in una catena).
5. Se il tentativo supera `retry.maxRetries`, emette l'evento di fallimento finale e si ferma.
6. Calcola il ritardo: `retry.baseDelayMs * 2^(attempt-1)`.
7. Per errori di limite di utilizzo, analizza i suggerimenti di ripetizione e chiama l'auth storage (`markUsageLimitReached(...)`); se il cambio di provider/modello riesce, forza il ritardo a `0`.
8. Emette `auto_retry_start`.
9. Rimuove il messaggio di errore dell'assistente in coda dallo stato di runtime dell'agente (mantenuto nella cronologia della sessione persistita).
10. Pausa con supporto all'interruzione.
11. Al risveglio, pianifica `agent.continue()` tramite `setTimeout(..., 0)`.

### Cosa resetta i contatori di ripetizione

`#retryAttempt` viene resettato a `0` in questi casi:

- primo messaggio dell'assistente riuscito, non in errore e non interrotto, dopo l'inizio delle ripetizioni (emette `auto_retry_end { success: true }`)
- annullamento della ripetizione durante la pausa di backoff
- percorso di superamento del numero massimo di tentativi

`#retryPromise` viene risolto/cancellato quando la catena di ripetizione termina (successo, annullamento o superamento del massimo), tramite `#resolveRetry()`.

## Semantica del backoff e del numero massimo di tentativi

Impostazioni:

- `retry.enabled` (predefinito `true`)
- `retry.maxRetries` (predefinito `3`)
- `retry.baseDelayMs` (predefinito `2000`)

Numerazione dei tentativi:

- il contatore dei tentativi viene incrementato prima del controllo del massimo
- gli eventi di inizio usano il tentativo corrente (base 1)
- l'evento di fine per superamento del massimo riporta `attempt: this.#retryAttempt - 1` (conteggio dell'ultimo tentativo effettuato)

Sequenza di backoff con impostazioni predefinite:

- tentativo 1: 2000 ms
- tentativo 2: 4000 ms
- tentativo 3: 8000 ms

Gli input di override del ritardo vengono utilizzati solo nel percorso di gestione del limite di utilizzo, e solo per influenzare la decisione di cambio modello/account nell'auth-storage. Nel percorso principale di ripetizione non relativo alla compattazione, il backoff rimane un ritardo esponenziale locale a meno che il cambio non riesca (`delayMs = 0`).

## Meccaniche di interruzione

### Interruzione esplicita della ripetizione

`abortRetry()`:

- interrompe `#retryAbortController` (se presente)
- risolve la promise di ripetizione (`#resolveRetry()`) così che chi è in attesa venga sbloccato

Se l'interruzione avviene durante la pausa, il percorso catch emette:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- resetta tentativo/controller

### Interazione con l'interruzione globale dell'operazione

`abort()` chiama `abortRetry()` prima di interrompere lo stream attivo dell'agente. Questo garantisce che il backoff della ripetizione venga annullato quando l'utente emette un'interruzione generale.

### Interazione con la TUI

Su `auto_retry_start`, EventController:

- sostituisce il gestore `Esc` con `session.abortRetry()`
- visualizza il testo del loader: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

Su `auto_retry_end`, ripristina il gestore `Esc` precedente e cancella lo stato del loader.

## Comportamento dello streaming e del completamento del prompt

`prompt()` alla fine attende `#waitForRetry()` dopo che `agent.prompt(...)` ritorna.

Effetto:

- una chiamata prompt non si risolve completamente finché qualsiasi catena di ripetizione avviata non termina (successo/fallimento/annullamento)
- il ciclo di vita della ripetizione fa parte di un unico confine logico di esecuzione del prompt

Questo impedisce ai chiamanti di considerare un turno in fase di ripetizione come completato troppo presto.

## Controlli: impostazioni e RPC

### Parametri di configurazione

Definiti nello schema delle impostazioni nel gruppo retry:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

Toggle programmatici nella sessione:

- `setAutoRetryEnabled(enabled)` scrive `retry.enabled`
- `autoRetryEnabled` legge `retry.enabled`
- `isRetrying` indica se la promise del ciclo di vita della ripetizione è attiva

### Controlli RPC

Superficie dei comandi RPC:

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

Helper del client:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

Entrambi i comandi restituiscono risposte di successo; i dettagli di progresso/fallimento della ripetizione provengono dagli eventi di sessione trasmessi in streaming, non dai payload di risposta dei comandi.

## Emissione di eventi e visualizzazione dei fallimenti

Eventi di ripetizione a livello di sessione:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Propagazione:

- emessi tramite `AgentSession.subscribe(...)`
- inoltrati al runner delle estensioni come eventi di estensione
- in modalità RPC, inoltrati direttamente come oggetti evento JSON (`session.subscribe(event => output(event))`)
- nella TUI, consumati da `EventController` per l'interfaccia del loader/errore

Visualizzazione del fallimento finale:

- Al superamento del massimo o all'annullamento, `auto_retry_end.success === false`
- La TUI mostra: `Retry failed after N attempts: <finalError>`
- Le estensioni/hook ricevono `auto_retry_end` con gli stessi campi
- I consumer RPC ricevono lo stesso oggetto evento sullo stream stdout

## Condizioni di arresto permanente

La ripetizione si ferma e non continua automaticamente quando si verifica una qualsiasi di queste condizioni:

- `retry.enabled` è false
- l'errore non è classificato come ripetibile
- l'errore è un overflow del contesto (delegato al percorso di compattazione)
- numero massimo di tentativi superato
- l'utente annulla la ripetizione (`abort_retry` o `Esc` durante il loader di ripetizione)
- l'interruzione globale (`abort`) annulla prima la ripetizione

Una nuova catena di ripetizione può comunque iniziare successivamente su un futuro errore ripetibile dopo il reset dei contatori.

## Avvertenze operative

- La classificazione avviene tramite corrispondenza regex del testo; gli errori strutturati specifici del provider non vengono utilizzati qui.
- La ripetizione rimuove l'errore dell'assistente fallito dal **contesto di runtime** prima di ri-continuare, ma la cronologia della sessione mantiene comunque quella voce di errore.
- `RpcSessionState` attualmente espone `autoCompactionEnabled` ma non un campo `autoRetryEnabled`; i chiamanti RPC devono tracciare il proprio stato del toggle o interrogare le impostazioni tramite altre API.
