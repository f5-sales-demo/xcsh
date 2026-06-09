---
title: Esecuzione e cancellazione nativa dei task in Rust
description: >-
  Modello di esecuzione dei task async in Rust con cancellazione cooperativa e
  semantica di cleanup.
sidebar:
  order: 5
  label: Cancellazione dei task
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# Esecuzione e cancellazione nativa dei task in Rust (`pi-natives`)

Questo documento descrive come `crates/pi-natives` pianifica il lavoro nativo e come la cancellazione fluisce dalle opzioni JS (`timeoutMs`, `AbortSignal`) all'esecuzione in Rust.

## File di implementazione

- `crates/pi-natives/src/task.rs`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/fd.rs`
- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/ps.rs`

## Primitive fondamentali (`task.rs`)

`task.rs` definisce tre elementi fondamentali:

1. `task::blocking(tag, cancel_token, work)`
   - Incapsula `napi::AsyncTask` / `Task`.
   - `compute()` viene eseguito sui thread worker di libuv (per operazioni CPU-bound o chiamate di sistema bloccanti/sincrone).
   - Restituisce una `Promise<T>` JS.

2. `task::future(env, tag, work)`
   - Incapsula `env.spawn_future(...)`.
   - Esegue il lavoro asincrono sul runtime Tokio.
   - Restituisce `PromiseRaw<'env, T>`.

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` combina deadline + `AbortSignal` opzionale.
   - `CancelToken::heartbeat()` è la cancellazione cooperativa per i loop bloccanti.
   - `CancelToken::wait()` è l'attesa asincrona di cancellazione (`Signal` / `Timeout` / `User` Ctrl-C).
   - `AbortToken` permette al codice esterno di richiedere l'abort (`abort(reason)`).

## `blocking` vs `future`: modello di esecuzione e selezione

### Usare `task::blocking`

Da utilizzare quando il lavoro è CPU-intensive o fondamentalmente sincrono/bloccante:

- scansione regex/file (`grep`, `glob`, `fuzzy_find`)
- componenti interne del loop PTY sincrono (`run_pty_sync` tramite `spawn_blocking`)
- conversioni clipboard/immagini/html

Comportamento:

- La closure di lavoro riceve un `CancelToken` clonato.
- La cancellazione viene osservata solo dove il codice verifica `ct.heartbeat()?`.
- Un `Err(...)` nella closure rifiuta la promise JS.

### Usare `task::future`

Da utilizzare quando il lavoro deve fare `await` su operazioni asincrone:

- orchestrazione di sessioni shell (`shell.run`, `executeShell`)
- competizione tra task (`tokio::select!`) tra completamento e cancellazione

Comportamento:

- Il future può mettere in competizione il completamento normale contro `ct.wait()`.
- Nel percorso di cancellazione, le implementazioni asincrone tipicamente propagano la cancellazione ai sottosistemi interni (es. `tokio_util::CancellationToken`) e opzionalmente forzano l'abort al timeout di grazia.

## Mappatura API JS ↔ export Rust (rilevante per task/cancellazione)

| API lato JS | Export Rust (`#[napi]`) | Scheduler | Collegamento alla cancellazione |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` nel loop di filtro |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` nel loop di scoring |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` in competizione con il task di esecuzione; collegamento al `CancellationToken` di Tokio |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | come sopra |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + `spawn_blocking` interno | `CancelToken` verificato nel loop PTY sincrono tramite `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | nessuno (token `()`) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | nessuno (token `()`) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | nessuno (token `()`) |

`text.rs` e `ps.rs` attualmente non utilizzano `task::blocking`/`task::future` e pertanto non partecipano a questo percorso di cancellazione.

## Ciclo di vita della cancellazione e transizioni di stato

### Ciclo di vita di `CancelToken`

`CancelToken` è cooperativo e con stato:

```text
Created
  ├─ no signal + no timeout  -> passive token (never aborts unless externally emplaced)
  ├─ signal registered        -> waits for AbortSignal callback
  └─ deadline set             -> timeout check becomes active

Running
  ├─ heartbeat()/wait() sees signal   -> AbortReason::Signal
  ├─ heartbeat()/wait() sees deadline -> AbortReason::Timeout
  ├─ wait() sees Ctrl-C               -> AbortReason::User
  └─ no abort                         -> continue

Aborted (terminal)
  └─ first abort reason wins (atomic flag + notifier)
```

### Cancellazione prima dell'avvio vs durante l'esecuzione

- **Prima dell'avvio / prima del primo controllo di cancellazione**:
  - Gli utenti di `task::future` che competono su `ct.wait()` possono risolvere la cancellazione immediatamente una volta entrati in `select!`.
  - Gli utenti di `task::blocking` osservano la cancellazione solo quando il codice della closure raggiunge `heartbeat()`. Se la closure non esegue l'heartbeat tempestivamente, la cancellazione viene ritardata.

- **Durante l'esecuzione**:
  - `blocking`: il prossimo `heartbeat()` restituisce `Err("Aborted: ...")`.
  - `future`: il ramo `ct.wait()` vince il `select!`, quindi il codice cancella i meccanismi asincroni subordinati (per shell: cancella il token Tokio, attende fino a 2s, poi forza l'abort del task).

## Aspettative di heartbeat per loop a lunga esecuzione

`heartbeat()` deve essere eseguito a cadenza prevedibile nei loop con set di lavoro illimitati o di grandi dimensioni.

Pattern osservati:

- `glob::filter_entries`: controllo su ogni entry prima del filtraggio/matching.
- `fd::score_entries`: controllo su ogni candidato scansionato.
- `grep_sync`: controllo esplicito di cancellazione prima della fase di ricerca pesante, più chiamate alla cache del filesystem che ricevono anch'esse il token.
- `run_pty_sync`: controllo ad ogni tick del loop (cadenza di sleep ~16ms) e terminazione del processo figlio alla cancellazione.

Regola pratica: nessun loop su input di dimensione esterna dovrebbe superare un breve intervallo limitato senza un heartbeat.

## Comportamento in caso di errore e propagazione degli errori verso JS

### Task bloccanti

Percorso di errore:

1. La closure restituisce `Err(napi::Error)` (incluso l'abort da `heartbeat()`).
2. `Task::compute()` restituisce `Err`.
3. `AsyncTask` rifiuta la promise JS.

Stringhe di errore tipiche:

- `Aborted: Timeout`
- `Aborted: Signal`
- errori di dominio (`Failed to decode image: ...`, `Conversion error: ...`, ecc.)

### Task future

Percorso di errore:

1. Il corpo asincrono restituisce `Err(napi::Error)` oppure il fallimento del join viene mappato (`... task failed: {err}`).
2. La promise creata da `task::future` viene rifiutata.
3. Alcune API restituiscono intenzionalmente risultati strutturati di cancellazione invece del rifiuto (`ShellRunResult`/`ShellExecuteResult` con flag `cancelled`/`timed_out` e `exit_code: None`).

### Suddivisione nella segnalazione della cancellazione

- **Abort come errore**: la maggior parte degli export bloccanti che usano `heartbeat()?`.
- **Abort come risultato tipizzato**: API in stile shell/pty per comandi che modellano la cancellazione nelle struct di risultato.

Scegliere un modello per API e documentarlo esplicitamente.

## Insidie comuni

1. **Heartbeat mancante nei loop bloccanti**
   - Sintomo: timeout/segnale sembra ignorato fino al termine del loop.
   - Soluzione: aggiungere `ct.heartbeat()?` all'inizio del loop e prima dei passaggi costosi per ogni elemento.

2. **Sezioni lunghe non cancellabili**
   - Sintomo: picchi di latenza nella cancellazione durante una singola chiamata pesante (decodifica, ordinamento, compressione, ecc.).
   - Soluzione: suddividere il lavoro in blocchi con limiti di heartbeat; se impossibile, documentare la latenza.

3. **Blocco dell'executor asincrono**
   - Sintomo: l'API asincrona si blocca quando codice pesantemente sincrono viene eseguito direttamente nel future.
   - Soluzione: spostare i blocchi CPU/sincroni in `task::blocking` o `tokio::task::spawn_blocking`.

4. **Semantica di cancellazione inconsistente**
   - Sintomo: un'API rifiuta alla cancellazione, un'altra si risolve con flag, confondendo i chiamanti.
   - Soluzione: standardizzare per dominio e mantenere allineata la documentazione dei wrapper.

5. **Dimenticanza del bridge di cancellazione nei task asincroni annidati**
   - Sintomo: il token esterno è cancellato ma i reader interni/task del sottoprocesso continuano a eseguire.
   - Soluzione: collegare la cancellazione al token/segnale interno e applicare un timeout di grazia + fallback con abort forzato.

## Checklist per nuovi export cancellabili

1. Classificare correttamente il lavoro:
   - CPU-bound o bloccante sincrono -> `task::blocking`
   - I/O asincrono / orchestrazione con `await` -> `task::future`

2. Esporre gli input di cancellazione quando necessario:
   - includere `timeoutMs` e `signal` nelle opzioni `#[napi(object)]`
   - creare `let ct = task::CancelToken::new(timeout_ms, signal);`

3. Collegare la cancellazione attraverso tutti i livelli:
   - loop bloccanti: `ct.heartbeat()?` a intervalli stabili
   - orchestrazione asincrona: competizione con `ct.wait()` e cancellazione dei sub-task/token

4. Decidere il contratto di cancellazione:
   - rifiutare la promise con errore di abort, oppure
   - risolvere con risultato tipizzato `{ cancelled, timedOut, ... }`
   - mantenere questo contratto consistente per la famiglia di API

5. Propagare gli errori con contesto:
   - mappare gli errori tramite `Error::from_reason(format!("...: {err}"))`
   - includere prefissi specifici per la fase (`spawn`, `decode`, `wait`, ecc.)

6. Gestire la cancellazione prima dell'avvio e durante l'esecuzione:
   - il controllo/attesa di cancellazione deve avvenire prima del corpo costoso e durante l'esecuzione prolungata

7. Verificare che non ci sia uso improprio dell'executor:
   - nessun lavoro sincrono prolungato direttamente all'interno di future asincroni senza wrapper `spawn_blocking`/task bloccante
