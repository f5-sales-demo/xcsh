---
title: 'Interni nativi di Shell, PTY, Process e Key'
description: >-
  Esecuzione shell, gestione PTY, ciclo di vita dei processi e gestione degli
  eventi tastiera nel livello nativo.
sidebar:
  order: 4
  label: 'Shell, PTY e process'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# Interni nativi di Shell, PTY, Process e Key

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

- **Livello wrapper/API TS** (`packages/natives/src/*`): punti di ingresso tipizzati, superficie di cancellazione (`timeoutMs`, `AbortSignal`) ed ergonomia JS.
- **Livello modulo Rust N-API** (`crates/pi-natives/src/*`): esecuzione di processi shell/PTY, attraversamento/terminazione dell'albero dei processi e parsing delle sequenze di tasti.
- **Gate di validazione** (`native.ts`, a livello architetturale): garantisce che gli export richiesti (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, helper per i tasti) esistano prima che i wrapper vengano utilizzati.

## Sottosistema Shell (`shell`)

### Modello API

Sono esposti due modi di esecuzione:

1. **One-shot** tramite `executeShell(options, onChunk?)`.
2. **Sessione persistente** tramite `new Shell(options?)` poi `shell.run(...)` ripetutamente.

Entrambi trasmettono l'output attraverso un callback threadsafe e restituiscono `{ exitCode?, cancelled, timedOut }`.

### Creazione della sessione e modello dell'ambiente

Rust crea `brush_core::Shell` con:

- modalità non interattiva,
- `do_not_inherit_env: true`,
- ricostruzione esplicita dell'ambiente dall'env dell'host,
- lista di esclusione per variabili sensibili alla shell (`PS1`, `PWD`, `SHLVL`, esportazioni di funzioni bash, ecc.).

Comportamento dell'ambiente di sessione:

- `ShellOptions.sessionEnv` viene applicato una sola volta alla creazione della sessione.
- `ShellRunOptions.env` ha scope di comando (`EnvironmentScope::Command`) e viene rimosso dopo ogni esecuzione.
- `PATH` viene unito in modo speciale su Windows con deduplicazione case-insensitive.

Arricchimento dei percorsi solo per Windows (`shell/windows.rs`): i percorsi di Git-for-Windows individuati (`cmd`, `bin`, `usr/bin`) vengono aggiunti se presenti e non già inclusi.

### Ciclo di vita a runtime e transizioni di stato

La shell persistente (`Shell.run`) utilizza questa macchina a stati:

- **Idle/Non inizializzata**: `session: None`.
- **In esecuzione**: il primo `run()` crea la sessione in modo lazy, memorizza il token `current_abort`, esegue il comando.
- **Completata + keepalive**: se il flusso di controllo dell'esecuzione è `Normal`, `current_abort` viene rimosso e la sessione viene riutilizzata.
- **Completata + teardown**: se il flusso di controllo è relativo a loop/script/uscita dalla shell (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), la sessione viene rilasciata (`session: None`).
- **Cancellata/Scaduta**: il task di esecuzione viene cancellato, attesa di grazia (2s), poi abort forzato; la sessione viene rilasciata.
- **Errore**: la sessione viene rilasciata.

La shell one-shot (`executeShell`) crea e rilascia sempre una sessione nuova per ogni chiamata.

### Comportamento dello streaming/output

- Stdout/stderr vengono instradati in una pipe condivisa e letti in modo concorrente.
- Il lettore decodifica UTF-8 in modo incrementale; le sequenze di byte non valide emettono chunk di sostituzione `U+FFFD`.
- Dopo il completamento del processo, il drenaggio dell'output ha guard idle/max (`250ms` idle, `2s` max) per evitare blocchi su job in background che mantengono aperti i descrittori.

### Cancellazione, timeout e job in background

- `CancelToken` viene costruito da `timeoutMs` e opzionalmente da `AbortSignal`.
- Alla cancellazione/timeout, il token di cancellazione della shell viene attivato, poi il task ottiene una finestra di grazia di 2s prima dell'abort forzato.
- Se avviene la cancellazione, i job in background vengono terminati (`TERM`, poi `KILL` con ritardo) utilizzando i metadati dei job di brush.

Comportamento di `Shell.abort()`:

- annulla solo il comando attualmente in esecuzione per quell'istanza di `Shell`,
- successo senza operazione quando nulla è in esecuzione.

### Comportamento in caso di errore

Gli errori comunemente esposti includono:

- errori di inizializzazione della sessione (`Failed to initialize shell`),
- errori di cwd (`Failed to set cwd`),
- errori di set/pop dell'ambiente,
- errori di sorgente snapshot,
- errori di creazione/clonazione della pipe,
- errori di esecuzione (`Shell execution failed: ...`),
- errori del wrapper del task (`Shell execution task failed: ...`).

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

### Ciclo di vita a runtime e transizioni di stato

Macchina a stati di `PtySession`:

- **Idle**: `core: None`.
- **Riservata**: `start()` installa il canale di controllo in modo sincrono (`core: Some`) prima che il lavoro asincrono inizi, così `write/resize/kill` diventano immediatamente validi.
- **In esecuzione**: il loop PTY bloccante gestisce lo stato del child, eventi del reader, heartbeat di cancellazione e messaggi di controllo.
- **Terminale chiuso**: uscita del child + completamento del reader.
- **Finalizzata**: `core` viene sempre resettato a `None` dopo il completamento del task di start (successo o errore).

Guard di concorrenza:

- avviare mentre è già in esecuzione restituisce `PTY session already running`.

### Pattern di spawn/attach/write/read/terminate

- Il PTY viene aperto tramite `portable_pty::native_pty_system().openpty(...)`.
- Il comando attualmente viene eseguito come `sh -lc <command>` con `cwd` e override dell'ambiente opzionali.
- `write()` invia byte grezzi allo stdin del PTY.
- `resize()` vincola le dimensioni (`cols 20..400`, `rows 5..200`) e chiama il resize del master.
- `kill()` marca l'esecuzione come cancellata e termina il processo child.

Percorso dell'output:

- un thread reader dedicato legge lo stream del master,
- decodifica UTF-8 incrementale con sostituzione `U+FFFD` per byte non validi,
- i chunk vengono inoltrati attraverso il callback threadsafe N-API.

### Semantica di cancellazione e timeout

- `timeoutMs` e `AbortSignal` alimentano un `CancelToken`.
- il loop chiama `ct.heartbeat()` periodicamente; l'abort attiva il kill del child.
- la classificazione del timeout è basata su stringa (sottostringa `"Timeout"` nell'errore dell'heartbeat).

### Comportamento in caso di errore

Le superfici di errore includono:

- errore di allocazione/apertura del PTY,
- errore di spawn del PTY,
- errore di acquisizione del writer/reader,
- errori di stato/attesa del child,
- avvelenamento del lock,
- disconnessione del canale di controllo (`PTY session is no longer available`).

Errori delle chiamate di controllo quando non in esecuzione:

- `write/resize/kill` restituiscono `PTY session is not running`.

## Sottosistema albero dei processi (`ps`)

### Modello API

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

Il wrapper TS registra anche l'integrazione nativa del kill-tree nelle utility condivise tramite `setNativeKillTree(native.killTree)`.

### Implementazione specifica per piattaforma

- **Linux**: legge ricorsivamente `/proc/<pid>/task/<pid>/children`.
- **macOS**: utilizza `libproc` `proc_listchildpids`.
- **Windows**: acquisisce uno snapshot della tabella dei processi con `CreateToolhelp32Snapshot`, costruisce una mappa parent->children, termina con `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### Comportamento del kill-tree

- I discendenti vengono raccolti ricorsivamente.
- L'ordine di terminazione è dal basso verso l'alto (discendenti più profondi per primi) per ridurre il re-parenting degli orfani.
- Il pid radice viene terminato per ultimo.
- Il valore di ritorno è il conteggio delle terminazioni riuscite.

Comportamento del segnale:

- POSIX: il `signal` fornito viene passato a `kill`.
- Windows: il `signal` viene ignorato; la terminazione è una terminazione incondizionata del processo.

### Comportamento in caso di errore

Questo modulo è intenzionalmente non-throwing a livello di superficie API:

- i rami dell'albero dei processi mancanti/inaccessibili vengono saltati,
- gli errori di kill per singolo pid vengono conteggiati come non riusciti (non come errori),
- una mancata corrispondenza nella ricerca tipicamente produce `[]` da `listDescendants` e `0` da `killTree`.

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

- mappature dirette a singolo byte (`enter`, `tab`, `ctrl+<lettera>`, ASCII stampabile),
- lookup O(1) di sequenze di escape legacy (mappa PHF),
- parsing `modifyOtherKeys` di xterm,
- parsing del protocollo Kitty (`CSI u`, `CSI ~`, `CSI 1;...<lettera>`),
- normalizzazione a ID di tasto (`ctrl+c`, `shift+tab`, `pageUp`, `f5`, ecc.).

Gestione dei modificatori:

- solo i bit shift/alt/ctrl vengono confrontati per il matching dei tasti,
- i bit di lock vengono mascherati prima dei confronti.

Comportamento del layout:

- il fallback al layout base è intenzionalmente vincolato affinché i layout rimappati non creino falsi match per lettere/simboli ASCII.

### Comportamento in caso di errore

- Le sequenze non riconosciute o non valide producono `null` dalle funzioni di parsing.
- Le funzioni di matching restituiscono `false` in caso di errore di parsing o mancata corrispondenza.
- Nessuna superficie di errori lanciati per input di tasti malformati.

## Mappatura API wrapper JS ↔ export Rust

### Shell + PTY + Process

| API wrapper TS | Export Rust N-API | Note |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | Esecuzione shell one-shot |
| `new Shell(options?)` | Classe `Shell` | Sessione shell persistente |
| `shell.run(options, onChunk?)` | `Shell::run` | Riutilizza la sessione con flusso di controllo keepalive |
| `shell.abort()` | `Shell::abort` | Annulla l'esecuzione attiva per quell'istanza shell |
| `new PtySession()` | Classe `PtySession` | Sessione PTY con stato |
| `pty.start(options, onChunk?)` | `PtySession::start` | Esecuzione PTY interattiva |
| `pty.write(data)` | `PtySession::write` | Passthrough grezzo dello stdin |
| `pty.resize(cols, rows)` | `PtySession::resize` | Dimensioni terminale vincolate |
| `pty.kill()` | `PtySession::kill` | Termina forzatamente il child PTY attivo |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | Terminazione dell'albero dei processi partendo dai figli |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | Elenco ricorsivo dei discendenti |

### Tasti

| API wrapper TS | Export Rust N-API | Note |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Match codepoint+modificatore Kitty |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Parser di key-id normalizzato |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | Controllo esatto sulla mappa delle sequenze legacy |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | Risultato di parsing strutturato Kitty |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | Matcher di tasti ad alto livello |

## Note su pulizia delle sessioni abbandonate e finalizzazione

- **Sessione shell persistente**: se un'esecuzione viene cancellata/scade/genera un errore/ha un flusso di controllo non-keepalive, Rust rilascia esplicitamente lo stato interno della sessione. Le esecuzioni normali riuscite mantengono la sessione per il riutilizzo.
- **Sessione PTY**: `core` viene sempre azzerato dopo che `start()` termina, inclusi i percorsi di errore.
- **Nessun contratto esplicito di kill guidato dal finalizer JS** è esposto dai wrapper; la pulizia è principalmente legata ai percorsi di completamento/cancellazione dell'esecuzione. I chiamanti dovrebbero usare `timeoutMs`, `AbortSignal`, `shell.abort()` o `pty.kill()` per un teardown deterministico.
