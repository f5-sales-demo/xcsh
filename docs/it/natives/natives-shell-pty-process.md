---
title: 'Internals nativi di Shell, PTY, Process e Key'
description: >-
  Esecuzione shell, gestione PTY, ciclo di vita dei processi e gestione degli
  eventi chiave nel livello nativo.
sidebar:
  order: 4
  label: 'Shell, PTY e processo'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# Internals nativi di Shell, PTY, Process e Key

Questo documento tratta le **primitive di esecuzione/processo/terminale** in `@f5xc-salesdemos/pi-natives`: `shell`, `pty`, `ps` e `keys`, utilizzando i termini architetturali di `docs/natives-architecture.md`.

## File di implementazione

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs` (solo Windows)
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs` (comportamento di cancellazione condiviso utilizzato da shell/pty)
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/bindings.ts`

## Proprietà dei livelli

- **Livello wrapper/API TS** (`packages/natives/src/*`): entrypoint tipizzati, superficie di cancellazione (`timeoutMs`, `AbortSignal`) ed ergonomia JS.
- **Livello modulo Rust N-API** (`crates/pi-natives/src/*`): esecuzione di processi shell/PTY, attraversamento/terminazione dell'albero di processi e analisi delle sequenze di tasti.
- **Gate di validazione** (`native.ts`, a livello architetturale): verifica che le esportazioni richieste (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, helper per i tasti) esistano prima che i wrapper vengano utilizzati.

## Sottosistema Shell (`shell`)

### Modello API

Sono esposti due modalità di esecuzione:

1. **Esecuzione singola** tramite `executeShell(options, onChunk?)`.
2. **Sessione persistente** tramite `new Shell(options?)` e poi `shell.run(...)` ripetutamente.

Entrambe trasmettono l'output tramite una callback threadsafe e restituiscono `{ exitCode?, cancelled, timedOut }`.

### Creazione della sessione e modello di ambiente

Rust crea `brush_core::Shell` con:

- modalità non interattiva,
- `do_not_inherit_env: true`,
- ricostruzione esplicita dell'ambiente dall'env dell'host,
- lista di esclusione per le variabili sensibili alla shell (`PS1`, `PWD`, `SHLVL`, esportazioni di funzioni bash, ecc.).

Comportamento dell'env di sessione:

- `ShellOptions.sessionEnv` viene applicato una volta alla creazione della sessione.
- `ShellRunOptions.env` è a scope di comando (`EnvironmentScope::Command`) e viene rimosso dopo ogni esecuzione.
- `PATH` viene unito in modo speciale su Windows con deduplicazione case-insensitive.

Arricchimento del percorso solo per Windows (`shell/windows.rs`): i percorsi Git-for-Windows rilevati (`cmd`, `bin`, `usr/bin`) vengono aggiunti se presenti e non già inclusi.

### Ciclo di vita in esecuzione e transizioni di stato

La shell persistente (`Shell.run`) utilizza questa macchina a stati:

- **Idle/Non inizializzata**: `session: None`.
- **In esecuzione**: la prima `run()` crea la sessione in modo lazy, memorizza il token `current_abort`, esegue il comando.
- **Completata + keepalive**: se il flusso di controllo dell'esecuzione è `Normal`, `current_abort` viene azzerato e la sessione viene riutilizzata.
- **Completata + teardown**: se il flusso di controllo è correlato a loop/script/uscita dalla shell (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), la sessione viene eliminata (`session: None`).
- **Cancellata/Scaduta per timeout**: il task di esecuzione viene cancellato, attesa di tolleranza (2s), poi interruzione forzata; la sessione viene eliminata.
- **Errore**: la sessione viene eliminata.

La shell monouso (`executeShell`) crea e distrugge sempre una nuova sessione per ogni chiamata.

### Comportamento di streaming/output

- Stdout/stderr vengono instradati in una pipe condivisa e letti in modo concorrente.
- Il lettore decodifica UTF-8 in modo incrementale; le sequenze di byte non valide emettono chunk di sostituzione `U+FFFD`.
- Dopo il completamento del processo, lo svuotamento dell'output ha limiti di inattività/massimo (`250ms` di inattività, `2s` massimo) per evitare blocchi causati da job in background che mantengono aperto i descrittori.

### Cancellazione, timeout e job in background

- `CancelToken` viene costruito da `timeoutMs` e da un eventuale `AbortSignal`.
- In caso di cancellazione/timeout, viene attivato il token di cancellazione della shell, poi il task riceve una finestra di tolleranza di 2s prima dell'interruzione forzata.
- Se si verifica la cancellazione, i job in background vengono terminati (`TERM`, poi `KILL` con ritardo) utilizzando i metadati dei job di brush.

Comportamento di `Shell.abort()`:

- interrompe solo il comando attualmente in esecuzione per quella istanza di `Shell`,
- è un no-op con successo quando non è in esecuzione nulla.

### Comportamento in caso di errore

Gli errori comuni esposti includono:

- errori di inizializzazione della sessione (`Failed to initialize shell`),
- errori di directory di lavoro (`Failed to set cwd`),
- errori di impostazione/rimozione dell'env,
- errori di recupero dello snapshot sorgente,
- errori di creazione/clonazione della pipe,
- errore di esecuzione (`Shell execution failed: ...`),
- errori del wrapper del task (`Shell execution task failed: ...`).

Flag di cancellazione a livello di risultato:

- timeout -> `exitCode: undefined`, `timedOut: true`.
- segnale di abort -> `exitCode: undefined`, `cancelled: true`.

## Sottosistema PTY (`pty`)

### Modello API

`new PtySession()` espone:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### Ciclo di vita in esecuzione e transizioni di stato

Macchina a stati di `PtySession`:

- **Idle**: `core: None`.
- **Riservata**: `start()` installa il canale di controllo in modo sincrono (`core: Some`) prima che inizi il lavoro asincrono, rendendo immediatamente validi `write/resize/kill`.
- **In esecuzione**: il loop PTY bloccante gestisce lo stato del processo figlio, gli eventi del lettore, il heartbeat di cancellazione e i messaggi di controllo.
- **Terminale chiuso**: uscita del figlio + completamento del lettore.
- **Finalizzata**: `core` viene sempre reimpostato a `None` dopo il completamento del task di start (successo o errore).

Guard di concorrenza:

- avviare una sessione già in esecuzione restituisce `PTY session already running`.

### Pattern di spawn/attach/write/read/terminate

- PTY aperto tramite `portable_pty::native_pty_system().openpty(...)`.
- Il comando viene attualmente eseguito come `sh -lc <command>` con override opzionali di `cwd` e env.
- `write()` invia byte raw allo stdin del PTY.
- `resize()` limita le dimensioni (`cols 20..400`, `rows 5..200`) e chiama il resize del master.
- `kill()` segna l'esecuzione come cancellata e termina il processo figlio.

Percorso di output:

- un thread dedicato al lettore legge lo stream del master,
- decodifica UTF-8 incrementale con sostituzione `U+FFFD` per i byte non validi,
- i chunk vengono inoltrati tramite callback threadsafe N-API.

### Semantica di cancellazione e timeout

- `timeoutMs` e `AbortSignal` alimentano un `CancelToken`.
- il loop chiama `ct.heartbeat()` periodicamente; l'abort attiva la terminazione del figlio.
- la classificazione del timeout è basata su stringa (sottostringa `"Timeout"` nell'errore del heartbeat).

### Comportamento in caso di errore

Le superfici di errore includono:

- errore di allocazione/apertura PTY,
- errore di spawn PTY,
- errore di acquisizione writer/reader,
- errori di stato/attesa del figlio,
- avvelenamento del lock,
- disconnessione del canale di controllo (`PTY session is no longer available`).

Errori nelle chiamate di controllo quando non in esecuzione:

- `write/resize/kill` restituiscono `PTY session is not running`.

## Sottosistema dell'albero di processi (`ps`)

### Modello API

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

Il wrapper TS registra anche l'integrazione nativa del kill-tree nelle utilità condivise tramite `setNativeKillTree(native.killTree)`.

### Implementazione specifica per piattaforma

- **Linux**: legge ricorsivamente `/proc/<pid>/task/<pid>/children`.
- **macOS**: utilizza `libproc` `proc_listchildpids`.
- **Windows**: cattura la tabella dei processi con `CreateToolhelp32Snapshot`, costruisce una mappa parent->children, termina con `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### Comportamento di kill-tree

- I discendenti vengono raccolti ricorsivamente.
- L'ordine di terminazione è dal basso verso l'alto (prima i discendenti più profondi) per ridurre il ri-parenting degli orfani.
- Il pid radice viene terminato per ultimo.
- Il valore restituito è il conteggio delle terminazioni riuscite.

Comportamento dei segnali:

- POSIX: il `signal` fornito viene passato a `kill`.
- Windows: `signal` viene ignorato; la terminazione è un processo terminate incondizionato.

### Comportamento in caso di errore

Questo modulo è intenzionalmente non-throwing a livello di superficie API:

- i rami dell'albero di processi mancanti/inaccessibili vengono saltati,
- i fallimenti di kill per singolo pid vengono contati come non riusciti (non come errori),
- una ricerca mancante restituisce tipicamente `[]` da `listDescendants` e `0` da `killTree`.

## Sottosistema di analisi dei tasti (`keys`)

### Modello API

Helper esposti:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### Modello di analisi

Il parser combina:

- mappature dirette a singolo byte (`enter`, `tab`, `ctrl+<lettera>`, ASCII stampabile),
- lookup O(1) di sequenze escape legacy (mappa PHF),
- analisi di `modifyOtherKeys` xterm,
- analisi del protocollo Kitty (`CSI u`, `CSI ~`, `CSI 1;...<lettera>`),
- normalizzazione agli ID dei tasti (`ctrl+c`, `shift+tab`, `pageUp`, `f5`, ecc.).

Gestione dei modificatori:

- per la corrispondenza dei tasti vengono confrontati solo i bit shift/alt/ctrl,
- i bit di lock vengono mascherati prima dei confronti.

Comportamento del layout:

- il fallback al layout di base è intenzionalmente limitato in modo che i layout rimappati non creino false corrispondenze per lettere/simboli ASCII.

### Comportamento in caso di errore

- Le sequenze non riconosciute o non valide producono `null` dalle funzioni di analisi.
- Le funzioni di corrispondenza restituiscono `false` in caso di errore di analisi o mancata corrispondenza.
- Nessuna superficie di errore generata per input di tasti malformati.

## Mappatura API wrapper JS ↔ esportazioni Rust

### Shell + PTY + Process

| API wrapper TS | Esportazione Rust N-API | Note |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | Esecuzione shell monouso |
| `new Shell(options?)` | classe `Shell` | Sessione shell persistente |
| `shell.run(options, onChunk?)` | `Shell::run` | Riutilizza la sessione con flusso di controllo keepalive |
| `shell.abort()` | `Shell::abort` | Interrompe l'esecuzione attiva per quella istanza shell |
| `new PtySession()` | classe `PtySession` | Sessione PTY con stato |
| `pty.start(options, onChunk?)` | `PtySession::start` | Esecuzione PTY interattiva |
| `pty.write(data)` | `PtySession::write` | Passthrough raw stdin |
| `pty.resize(cols, rows)` | `PtySession::resize` | Dimensioni terminale limitate |
| `pty.kill()` | `PtySession::kill` | Termina forzatamente il processo figlio PTY attivo |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | Terminazione dell'albero di processi partendo dai figli |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | Elenco ricorsivo dei discendenti |

### Tasti

| API wrapper TS | Esportazione Rust N-API | Note |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Corrispondenza Kitty codepoint+modificatore |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Parser di key-id normalizzato |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | Controllo esatto sulla mappa delle sequenze legacy |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | Risultato strutturato dell'analisi Kitty |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | Matcher di tasti ad alto livello |

## Note sulla pulizia delle sessioni abbandonate e sulla finalizzazione

- **Sessione shell persistente**: se un'esecuzione viene cancellata/scaduta per timeout/in errore/con flusso di controllo non-keepalive, Rust elimina esplicitamente lo stato della sessione interna. Le esecuzioni normali con successo mantengono la sessione per il riutilizzo.
- **Sessione PTY**: `core` viene sempre azzerato dopo il completamento di `start()`, inclusi i percorsi di errore.
- **Nessun contratto di kill guidato da finalizzatore JS esplicito** è esposto dai wrapper; la pulizia è principalmente legata ai percorsi di completamento/cancellazione dell'esecuzione. I chiamanti dovrebbero utilizzare `timeoutMs`, `AbortSignal`, `shell.abort()` o `pty.kill()` per un teardown deterministico.
