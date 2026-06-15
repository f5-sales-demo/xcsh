---
title: Politica di ripetizione automatica per errori non legati alla compattazione
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

# Politica di ripetizione automatica per errori non legati alla compattazione

Questo documento descrive il percorso standard di ripetizione in caso di errori API in `AgentSession`.

Esclude esplicitamente il ripristino in caso di overflow del contesto tramite compattazione automatica. L'overflow è gestito dalla logica di compattazione ed è documentato separatamente in [`compaction.md`](./compaction.md).

## File di implementazione

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## Limite di ambito rispetto alla compattazione

La ripetizione e la compattazione vengono verificate dallo stesso percorso `agent_end`, ma sono intenzionalmente separate:

1. `agent_end` ispeziona l'ultimo messaggio dell'assistente.
2. `#isRetryableError(...)` viene eseguito per primo.
3. Se viene avviata la ripetizione, i controlli di compattazione vengono saltati per quel turno.
4. Gli errori di overflow del contesto sono esclusi in modo definitivo dalla classificazione delle ripetizioni (`isContextOverflow(...)` interrompe anticipatamente la ripetizione).
5. L'overflow ricade quindi su `#checkCompaction(...)` anziché sulla ripetizione standard.

Pertanto: i fallimenti di tipo overload/rate/server/rete utilizzano questa politica di ripetizione; l'overflow della finestra di contesto utilizza il ripristino tramite compattazione.

## Classificazione delle ripetizioni

`#isRetryableError(...)` richiede che siano soddisfatte tutte le seguenti condizioni:

- `stopReason === "error"` dell'assistente
- `errorMessage` esiste
- il messaggio **non** è un overflow del contesto
- `errorMessage` corrisponde a `#isRetryableErrorMessage(...)`

Insieme di pattern ripetibili correnti (basati su espressioni regolari):

- overloaded
- rate limit / usage limit / too many requests
- classi server di tipo HTTP: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- formulazione `retry delay`

Si tratta di classificazione tramite pattern su stringhe, non di codici di errore tipizzati del provider.

## Ciclo di vita della ripetizione e transizioni di stato

Stato della sessione utilizzato dalla ripetizione:

- `#retryAttempt: number` (`0` indica inattivo)
- `#retryPromise: Promise<void> | undefined` (tiene traccia del ciclo di vita della ripetizione in corso)
- `#retryResolve: (() => void) | undefined` (risolve `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (annulla il ritardo di backoff)

Flusso (`#handleRetryableError`):

1. Legge il gruppo di impostazioni `retry`.
2. Se `retry.enabled === false`, si ferma immediatamente (`false`, nessuna ripetizione avviata).
3. Incrementa `#retryAttempt`.
4. Crea `#retryPromise` una sola volta (primo tentativo in una catena).
5. Se il tentativo supera `retry.maxRetries`, emette l'evento di fallimento finale e si ferma.
6. Calcola il ritardo: `retry.baseDelayMs * 2^(tentativo-1)`.
7. Per gli errori di limite di utilizzo, analizza i suggerimenti di ripetizione e chiama l'archiviazione di autenticazione (`markUsageLimitReached(...)`); se il cambio di provider/modello ha successo, forza il ritardo a `0`.
8. Emette `auto_retry_start`.
9. Rimuove il messaggio di errore dell'assistente in coda dallo stato di runtime dell'agente (mantenuto nella cronologia della sessione persistita).
10. Attende con supporto all'interruzione.
11. Al risveglio, pianifica `agent.continue()` tramite `setTimeout(..., 0)`.

### Cosa reimposta i contatori di ripetizione

`#retryAttempt` viene reimpostato a `0` nei seguenti casi:

- primo messaggio dell'assistente riuscito, senza errori e non interrotto, dopo l'avvio delle ripetizioni (emette `auto_retry_end { success: true }`)
- annullamento della ripetizione durante il ritardo di backoff
- percorso di superamento del numero massimo di ripetizioni

`#retryPromise` viene risolto/cancellato al termine della catena di ripetizioni (successo, annullamento o superamento del massimo), tramite `#resolveRetry()`.

## Semantica del backoff e del numero massimo di tentativi

Impostazioni:

- `retry.enabled` (valore predefinito `true`)
- `retry.maxRetries` (valore predefinito `3`)
- `retry.baseDelayMs` (valore predefinito `2000`)

Numerazione dei tentativi:

- il contatore dei tentativi viene incrementato prima del controllo del massimo
- gli eventi di avvio utilizzano il tentativo corrente (basato su 1)
- l'evento di fine per superamento del massimo riporta `attempt: this.#retryAttempt - 1` (ultimo conteggio di ripetizione tentato)

Sequenza di backoff con le impostazioni predefinite:

- tentativo 1: 2000 ms
- tentativo 2: 4000 ms
- tentativo 3: 8000 ms

Gli input di override del ritardo vengono utilizzati esclusivamente nel percorso di gestione del limite di utilizzo, e solo per influenzare la decisione di cambio modello/account nell'archiviazione di autenticazione. Nel percorso principale di ripetizione non legato alla compattazione, il backoff rimane un ritardo esponenziale locale, a meno che il cambio non abbia successo (`delayMs = 0`).

## Meccanismi di interruzione

### Interruzione esplicita della ripetizione

`abortRetry()`:

- interrompe `#retryAbortController` (se presente)
- risolve la promise di ripetizione (`#resolveRetry()`) in modo da sbloccare i chiamanti in attesa

Se l'interruzione avviene durante l'attesa, il percorso di cattura emette:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- reimposta il tentativo e il controller

### Interazione con l'interruzione globale dell'operazione

`abort()` chiama `abortRetry()` prima di interrompere il flusso dell'agente attivo. Questo garantisce l'annullamento del backoff di ripetizione quando l'utente emette un'interruzione generale.

### Interazione con l'interfaccia TUI

All'evento `auto_retry_start`, EventController:

- sostituisce il gestore `Esc` con `session.abortRetry()`
- mostra il testo del loader: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

All'evento `auto_retry_end`, ripristina il gestore `Esc` precedente e cancella lo stato del loader.

## Comportamento dello streaming e del completamento del prompt

`prompt()` attende infine su `#waitForRetry()` dopo che `agent.prompt(...)` ha restituito il controllo.

Effetto:

- una chiamata a prompt non si risolve completamente finché non termina qualsiasi catena di ripetizione avviata (successo/fallimento/annullamento)
- il ciclo di vita della ripetizione fa parte di un unico confine logico di esecuzione del prompt

Ciò impedisce ai chiamanti di considerare concluso un turno in fase di ripetizione troppo presto.

## Controlli: impostazioni e RPC

### Parametri di configurazione

Definiti nello schema delle impostazioni nel gruppo retry:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

Controlli programmatici nella sessione:

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

Entrambi i comandi restituiscono risposte di successo; i dettagli sull'avanzamento/fallimento della ripetizione provengono dagli eventi di sessione in streaming, non dai payload delle risposte ai comandi.

## Emissione di eventi e rilevamento dei fallimenti

Eventi di ripetizione a livello di sessione:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Propagazione:

- emessi tramite `AgentSession.subscribe(...)`
- inoltrati al runner dell'estensione come eventi dell'estensione
- in modalità RPC, inoltrati direttamente come oggetti evento JSON (`session.subscribe(event => output(event))`)
- nell'interfaccia TUI, consumati da `EventController` per la UI di loader/errore

Rilevamento del fallimento finale:

- In caso di superamento del massimo o annullamento, `auto_retry_end.success === false`
- L'interfaccia TUI mostra: `Retry failed after N attempts: <finalError>`
- Le estensioni/hook ricevono `auto_retry_end` con gli stessi campi
- I consumatori RPC ricevono lo stesso oggetto evento sullo stream stdout

## Condizioni di arresto permanente

La ripetizione si interrompe e non prosegue automaticamente quando si verifica una delle seguenti condizioni:

- `retry.enabled` è false
- l'errore non è classificato come ripetibile
- l'errore è un overflow del contesto (delegato al percorso di compattazione)
- è stato superato il numero massimo di ripetizioni
- l'utente annulla la ripetizione (`abort_retry` oppure `Esc` durante il loader di ripetizione)
- l'interruzione globale (`abort`) annulla prima la ripetizione

Una nuova catena di ripetizione può comunque avviarsi successivamente in seguito a un nuovo errore ripetibile, dopo la reimpostazione dei contatori.

## Avvertenze operative

- La classificazione è basata su corrispondenza di pattern testuali tramite espressioni regolari; gli errori strutturati specifici del provider non vengono utilizzati qui.
- La ripetizione rimuove l'errore dell'assistente dal **contesto di runtime** prima di continuare, ma la cronologia della sessione mantiene comunque quella voce di errore.
- `RpcSessionState` attualmente espone `autoCompactionEnabled` ma non un campo `autoRetryEnabled`; i chiamanti RPC devono tenere traccia del proprio stato di attivazione o interrogare le impostazioni tramite altre API.
