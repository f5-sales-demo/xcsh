---
title: 'Natives Shell, PTY, Process, and Key Internals'
description: >-
  Esecuzione della shell, gestione PTY, ciclo di vita dei processi e gestione
  degli eventi dei tasti nel livello nativo.
sidebar:
  order: 4
  label: 'Shell, PTY & process'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# Internals nativi di Shell, PTY, Process e Key

Questo documento tratta le **primitive di esecuzione/processo/terminale** in `@f5xc-salesdemos/pi-natives`: `shell`, `pty`, `ps` e `keys`, utilizzando i termini architetturali da `docs/natives-architecture.md`.

## File di implementazione

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs` (solo Windows)
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs` (comportamento di cancellazione condiviso usato da shell/pty)
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/bindings.ts`

## Responsabilità dei livelli

- **Livello wrapper/API TS** (`packages/natives/src/*`): entrypoint tipizzati, superficie di cancellazione (`timeoutMs`, `AbortSignal`) ed ergonomia JS.
- **Livello modulo Rust N-API** (`crates/pi-natives/src/*`): esecuzione di processi shell/PTY, attraversamento/terminazione dell'albero dei processi e parsing delle sequenze di tasti.
- **Gate di validazione** (`native.ts`, livello architetturale): garantisce che gli export richiesti (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, helper per i tasti) esistano prima che i wrapper vengano utilizzati.

## Sottosistema Shell (`shell`)

### Modello API

Sono esposti due modalità di esecuzione:

1. **One-shot** tramite `executeShell(options, onChunk?)`.
2. **Sessione persistente** tramite `new Shell(options?)` poi `shell.run(...)` ripetutamente.

Entrambe trasmettono l'output attraverso una callback threadsafe e restituiscono `{ exitCode?, cancelled, timedOut }`.

### Creazione della sessione e modello di ambiente

Rust crea `brush_core::Shell` con:

- modalità non interattiva,
- `do_not_inherit_env: true`,
- ricostruzione esplicita dell'ambiente dall'env dell'host,
- skip-list per le variabili sensibili alla shell (`PS1`, `PWD`, `SHLVL`, esportazioni di funzioni bash, ecc.).

Comportamento dell'ambiente di sessione:

- `ShellOptions.sessionEnv` viene applicato una volta alla creazione della sessione.
- `ShellRunOptions.env` ha scope di comando (`EnvironmentScope::Command`) e viene rimosso dopo ogni esecuzione.
- `PATH` viene unito in modo speciale su Windows con deduplicazione case-insensitive.

Arricchimento dei percorsi solo per Windows (`shell/windows.rs`): i percorsi di Git-for-Windows individuati (`cmd`, `bin`, `usr/bin`) vengono aggiunti se presenti e non già inclusi.

### Ciclo di vita dell'esecuzione e transizioni di stato

La shell persistente (`Shell.run`) utilizza questa macchina a stati:

- **Idle/Non inizializzata**: `session: None`.
- **In esecuzione**: la prima `run()` crea la sessione in modo lazy, memorizza il token `current_abort`, esegue il comando.
- **Completata + keepalive**: se il flusso di controllo dell'esecuzione è `Normal`, `current_abort` viene cancellato e la sessione viene riutilizzata.
- **Completata + teardown**: se il flusso di controllo è relativo a loop/script/uscita dalla shell (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), la sessione viene rilasciata (`session: None`).
- **Cancellata/Timeout**: il task di esecuzione viene cancellato, attesa di grazia (2s), poi abort forzato; la sessione viene rilasciata.
- **Errore**: la sessione viene rilasciata.

La shell one-shot (`executeShell`) crea e rilascia sempre una sessione nuova per ogni chiamata.

### Comportamento di streaming/output

- Stdout/stderr sono instradati in una pipe condivisa e letti concorrentemente.
- Il reader decodifica UTF-8 in modo incrementale; sequenze di byte non valide emettono chunk di sostituzione `U+FFFD`.
- Dopo il completamento del processo, il drenaggio dell'output ha guardie idle/max (`250ms` idle, `2s` max) per evitare blocchi su job in background che mantengono aperti i descrittori.

### Cancellazione, timeout e job in background

- `CancelToken` viene costruito da `timeoutMs` e opzionalmente da `AbortSignal`.
- In caso di cancellazione/timeout, il token di cancellazione della shell viene attivato, poi il task ottiene una finestra di grazia di 2s prima dell'abort forzato.
- Se avviene la cancellazione, i job in background vengono terminati (`TERM`, poi `KILL` ritardato) utilizzando i metadati dei job di brush.

Comportamento di `Shell.abort()`:

- interrompe solo il comando attualmente in esecuzione per quell'istanza di `Shell`,
- successo no-op quando nulla è in esecuzione.

### Comportamento in caso di errore

Gli errori comuni esposti includono:

- fallimenti di inizializzazione della sessione (`Failed to initialize shell`),
- errori di cwd (`Failed to set cwd`),
- fallimenti di set/pop dell'ambiente,
- fallimenti della sorgente snapshot,
- fallimenti di creazione/clone della pipe,
- fallimento dell'esecuzione (`Shell execution failed: ...`),
- fallimenti del wrapper del task (`Shell execution task failed: ...`).

Flag di cancellazione a livello di risultato:

- timeout -> `exitCode: undefined`, `timedOut: true`.
- abort signal -> `exitCode: undefined`, `cancelled: true`.

## Sottosistema PTY (`pty`)

### Modello API

`new PtySession()` espone:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### Ciclo di vita dell'esecuzione e transizioni di stato

Macchina a stati di `PtySession`:

- **Idle**: `core: None`.
- **Riservata**: `start()` installa il canale di controllo in modo sincrono (`core: Some`) prima dell'inizio del lavoro asincrono, così `write/resize/kill` diventano immediatamente validi.
- **In esecuzione**: il loop PTY bloccante gestisce lo stato del processo figlio, gli eventi del reader, l'heartbeat di cancellazione e i messaggi di controllo.
- **Terminale chiuso**: uscita del processo figlio + completamento del reader.
- **Finalizzata**: `core` viene sempre resettato a `None` dopo il completamento del task di start (successo o errore).

Guardia di concorrenza:

- avviare mentre è già in esecuzione restituisce `PTY session already running`.

### Pattern di spawn/attach/write/read/terminate

- Il PTY viene aperto tramite `portable_pty::native_pty_system().openpty(...)`.
- Il comando attualmente viene eseguito come `sh -lc <command>` con opzionali override di `cwd` e env.
- `write()` invia byte grezzi allo stdin del PTY.
- `resize()` limita le dimensioni (`cols 20..400`, `rows 5..200`) e chiama il resize del master.
- `kill()` marca l'esecuzione come cancellata e termina il processo figlio.

Percorso dell'output:

- un thread reader dedicato legge lo stream master,
- decodifica UTF-8 incrementale con sostituzione `U+FFFD` su byte non validi,
- i chunk vengono inoltrati attraverso la callback threadsafe N-API.

### Semantica di cancellazione e timeout

- `timeoutMs` e `AbortSignal` alimentano un `CancelToken`.
- Il loop chiama `ct.heartbeat()` periodicamente; l'abort attiva la terminazione del processo figlio.
- La classificazione del timeout è basata su stringa (sottostringa `"Timeout"` nell'errore dell'heartbeat).

### Comportamento in caso di errore

Le superfici di errore includono:

- fallimento di allocazione/apertura del PTY,
- fallimento di spawn del PTY,
- fallimento di acquisizione del writer/reader,
- fallimenti di stato/attesa del processo figlio,
- avvelenamento del lock,
- disconnessione del canale di controllo (`PTY session is no longer available`).

Fallimenti delle chiamate di controllo quando non in esecuzione:

- `write/resize/kill` restituiscono `PTY session is not running`.

## Sottosistema dell'albero dei processi (`ps`)

### Modello API

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

Il wrapper TS registra anche l'integrazione nativa del kill-tree nelle utility condivise tramite `setNativeKillTree(native.killTree)`.

### Implementazione specifica per piattaforma

- **Linux**: legge ricorsivamente `/proc/<pid>/task/<pid>/children`.
- **macOS**: utilizza `libproc` `proc_listchildpids`.
- **Windows**: esegue uno snapshot della tabella dei processi con `CreateToolhelp32Snapshot`, costruisce una mappa parent->children, termina con `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### Comportamento del kill-tree

- I discendenti vengono raccolti ricorsivamente.
- L'ordine di terminazione è bottom-up (i discendenti più profondi prima) per ridurre il re-parenting degli orfani.
- Il pid radice viene terminato per ultimo.
- Il valore restituito è il conteggio delle terminazioni riuscite.

Comportamento del segnale:

- POSIX: il `signal` fornito viene passato a `kill`.
- Windows: `signal` viene ignorato; la terminazione è una chiusura incondizionata del processo.

### Comportamento in caso di errore

Questo modulo è intenzionalmente non-throwing a livello di superficie API:

- i rami dell'albero dei processi mancanti/inaccessibili vengono saltati,
- i fallimenti di kill per singolo pid vengono contati come non riusciti (non errori),
- un lookup mancato tipicamente produce `[]` da `listDescendants` e `0` da `killTree`.

## Sottosistema di parsing dei tasti (`keys`)

### Modello API

Helper esposti:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### Modello di parsing

Il parser combina:

- mapping diretti a singolo byte (`enter`, `tab`, `ctrl+<lettera>`, ASCII stampabile),
- lookup O(1) di sequenze di escape legacy (mappa PHF),
- parsing `modifyOtherKeys` di xterm,
- parsing del protocollo Kitty (`CSI u`, `CSI ~`, `CSI 1;...<lettera>`),
- normalizzazione a ID dei tasti (`ctrl+c`, `shift+tab`, `pageUp`, `f5`, ecc.).

Gestione dei modificatori:

- solo i bit shift/alt/ctrl vengono confrontati per il matching dei tasti,
- i bit di lock vengono mascherati prima dei confronti.

Comportamento del layout:

- il fallback al layout base è intenzionalmente vincolato in modo che i layout rimappati non creino falsi match per lettere/simboli ASCII.

### Comportamento in caso di errore

- Sequenze non riconosciute o non valide producono `null` dalle funzioni di parsing.
- Le funzioni di match restituiscono `false` in caso di fallimento del parsing o mismatch.
- Nessuna superficie di errori lanciati per input di tasti malformati.

## Mapping API wrapper JS ↔ export Rust

### Shell + PTY + Process

| API wrapper TS | Export Rust N-API | Note |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | Esecuzione shell one-shot |
| `new Shell(options?)` | classe `Shell` | Sessione shell persistente |
| `shell.run(options, onChunk?)` | `Shell::run` | Riutilizza la sessione su flusso di controllo keepalive |
| `shell.abort()` | `Shell::abort` | Interrompe l'esecuzione attiva per quell'istanza di shell |
| `new PtySession()` | classe `PtySession` | Sessione PTY con stato |
| `pty.start(options, onChunk?)` | `PtySession::start` | Esecuzione PTY interattiva |
| `pty.write(data)` | `PtySession::write` | Passthrough diretto allo stdin |
| `pty.resize(cols, rows)` | `PtySession::resize` | Dimensioni terminale con limiti |
| `pty.kill()` | `PtySession::kill` | Termina forzatamente il processo figlio PTY attivo |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | Terminazione dell'albero dei processi partendo dai figli |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | Elenco ricorsivo dei discendenti |

### Keys

| API wrapper TS | Export Rust N-API | Note |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Match codepoint+modificatore Kitty |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Parser normalizzato dell'ID del tasto |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | Controllo esatto sulla mappa delle sequenze legacy |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | Risultato strutturato del parsing Kitty |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | Matcher dei tasti ad alto livello |

## Pulizia delle sessioni abbandonate e note sulla finalizzazione

- **Sessione shell persistente**: se un'esecuzione viene cancellata/va in timeout/genera errore/ha un flusso di controllo non-keepalive, Rust rilascia esplicitamente lo stato interno della sessione. Le esecuzioni normali con successo mantengono la sessione per il riutilizzo.
- **Sessione PTY**: `core` viene sempre cancellato dopo che `start()` termina, inclusi i percorsi di errore.
- **Nessun contratto esplicito di kill guidato dal finalizer JS** è esposto dai wrapper; la pulizia è principalmente legata ai percorsi di completamento/cancellazione dell'esecuzione. I chiamanti dovrebbero usare `timeoutMs`, `AbortSignal`, `shell.abort()` o `pty.kill()` per un teardown deterministico.
