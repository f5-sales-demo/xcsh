---
title: 'Nativi Shell, PTY, Processo e Gestione delle Chiavi Interne'
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

# Nativi Shell, PTY, Processo e Gestione delle Chiavi Interne

Questo documento descrive le **primitive di esecuzione/processo/terminale** in `@f5xc-salesdemos/pi-natives`: `shell`, `pty`, `ps` e `keys`, utilizzando i termini architetturali tratti da `docs/natives-architecture.md`.

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
- **Livello modulo N-API Rust** (`crates/pi-natives/src/*`): esecuzione dei processi shell/PTY, attraversamento/terminazione dell'albero dei processi e analisi delle sequenze tasto.
- **Cancello di validazione** (`native.ts`, livello architetturale): garantisce che le esportazioni richieste (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, helper per i tasti) esistano prima che i wrapper vengano utilizzati.

## Sottosistema Shell (`shell`)

### Modello API

Vengono esposti due modalità di esecuzione:

1. **Esecuzione singola** tramite `executeShell(options, onChunk?)`.
2. **Sessione persistente** tramite `new Shell(options?)` poi `shell.run(...)` ripetutamente.

Entrambe trasmettono l'output tramite una callback thread-safe e restituiscono `{ exitCode?, cancelled, timedOut }`.

### Creazione della sessione e modello dell'ambiente

Rust crea `brush_core::Shell` con:

- modalità non interattiva,
- `do_not_inherit_env: true`,
- ricostruzione esplicita dell'ambiente dall'env dell'host,
- lista di esclusione per variabili sensibili alla shell (`PS1`, `PWD`, `SHLVL`, esportazioni di funzioni bash, ecc.).

Comportamento dell'env di sessione:

- `ShellOptions.sessionEnv` viene applicato una sola volta alla creazione della sessione.
- `ShellRunOptions.env` ha scope di comando (`EnvironmentScope::Command`) e viene rimosso dopo ogni esecuzione.
- `PATH` viene unito in modo speciale su Windows con deduplicazione case-insensitive.

Arricchimento del percorso solo su Windows (`shell/windows.rs`): i percorsi Git-for-Windows rilevati (`cmd`, `bin`, `usr/bin`) vengono aggiunti se presenti e non già inclusi.

### Ciclo di vita del runtime e transizioni di stato

La shell persistente (`Shell.run`) utilizza questa macchina a stati:

- **Inattiva/Non inizializzata**: `session: None`.
- **In esecuzione**: il primo `run()` crea la sessione in modo lazy, memorizza il token `current_abort` ed esegue il comando.
- **Completata + keepalive**: se il flusso di controllo dell'esecuzione è `Normal`, `current_abort` viene azzerato e la sessione viene riutilizzata.
- **Completata + teardown**: se il flusso di controllo è correlato a loop/script/uscita dalla shell (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), la sessione viene eliminata (`session: None`).
- **Cancellata/Scaduta**: il task di esecuzione viene cancellato, attesa di tolleranza (2s), poi abort forzato; la sessione viene eliminata.
- **Errore**: la sessione viene eliminata.

La shell a esecuzione singola (`executeShell`) crea e distrugge sempre una nuova sessione per ogni chiamata.

### Comportamento di streaming/output

- Stdout/stderr vengono instradati in un pipe condiviso e letti in modo concorrente.
- Il lettore decodifica UTF-8 in modo incrementale; le sequenze di byte non valide emettono chunk di sostituzione `U+FFFD`.
- Al completamento del processo, lo svuotamento dell'output ha guardie di inattività/massimo (`250ms` inattività, `2s` massimo) per evitare blocchi causati da job in background che mantengono aperto i descrittori.

### Cancellazione, timeout e job in background

- `CancelToken` viene costruito da `timeoutMs` e dall'`AbortSignal` opzionale.
- In caso di cancellazione/timeout, il token di cancellazione della shell viene attivato, poi il task riceve una finestra di grazia di 2s prima dell'abort forzato.
- Se si verifica la cancellazione, i job in background vengono terminati (`TERM`, poi `KILL` ritardato) utilizzando i metadati dei job di brush.

Comportamento di `Shell.abort()`:

- interrompe solo il comando in esecuzione corrente per quell'istanza di `Shell`,
- è un no-op di successo quando non è in esecuzione nulla.

### Comportamento in caso di errore

Gli errori comuni esposti includono:

- errori di inizializzazione della sessione (`Failed to initialize shell`),
- errori di directory di lavoro (`Failed to set cwd`),
- errori di impostazione/rimozione dell'env,
- errori della sorgente snapshot,
- errori di creazione/clonazione del pipe,
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

### Ciclo di vita del runtime e transizioni di stato

Macchina a stati di `PtySession`:

- **Inattiva**: `core: None`.
- **Riservata**: `start()` installa il canale di controllo in modo sincrono (`core: Some`) prima che inizi il lavoro asincrono, quindi `write/resize/kill` diventano immediatamente validi.
- **In esecuzione**: il ciclo PTY bloccante gestisce lo stato del figlio, gli eventi del lettore, il heartbeat di cancellazione e i messaggi di controllo.
- **Terminale chiuso**: uscita del figlio + completamento del lettore.
- **Finalizzata**: `core` viene sempre reimpostato a `None` dopo il completamento del task di avvio (successo o errore).

Guardia di concorrenza:

- avviare mentre è già in esecuzione restituisce `PTY session already running`.

### Pattern di spawn/attach/write/read/terminate

- PTY aperto tramite `portable_pty::native_pty_system().openpty(...)`.
- Il comando attualmente viene eseguito come `sh -lc <command>` con override opzionali di `cwd` e env.
- `write()` invia byte grezzi allo stdin del PTY.
- `resize()` limita le dimensioni (`cols 20..400`, `rows 5..200`) e chiama il resize del master.
- `kill()` contrassegna l'esecuzione come cancellata e termina il processo figlio.

Percorso di output:

- un thread lettore dedicato legge lo stream del master,
- decodifica UTF-8 incrementale con sostituzione `U+FFFD` su byte non validi,
- i chunk vengono inoltrati tramite callback N-API thread-safe.

### Semantica di cancellazione e timeout

- `timeoutMs` e `AbortSignal` alimentano un `CancelToken`.
- il ciclo chiama `ct.heartbeat()` periodicamente; l'abort attiva la terminazione del figlio.
- la classificazione del timeout è basata su stringa (sottostringa `"Timeout"` nell'errore del heartbeat).

### Comportamento in caso di errore

Le superfici di errore includono:

- errore di allocazione/apertura PTY,
- errore di spawn PTY,
- errore di acquisizione del writer/reader,
- errori di stato/attesa del figlio,
- avvelenamento del lock,
- disconnessione del canale di controllo (`PTY session is no longer available`).

Errori nelle chiamate di controllo quando non in esecuzione:

- `write/resize/kill` restituiscono `PTY session is not running`.

## Sottosistema dell'albero dei processi (`ps`)

### Modello API

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

Il wrapper TS registra anche l'integrazione nativa kill-tree negli utils condivisi tramite `setNativeKillTree(native.killTree)`.

### Implementazione specifica per piattaforma

- **Linux**: legge ricorsivamente `/proc/<pid>/task/<pid>/children`.
- **macOS**: utilizza `libproc` `proc_listchildpids`.
- **Windows**: crea uno snapshot della tabella dei processi con `CreateToolhelp32Snapshot`, costruisce una mappa parent->children, termina con `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### Comportamento di kill-tree

- I discendenti vengono raccolti ricorsivamente.
- L'ordine di terminazione è dal basso verso l'alto (prima i discendenti più profondi) per ridurre il re-parenting degli orfani.
- Il pid radice viene terminato per ultimo.
- Il valore restituito è il conteggio delle terminazioni riuscite.

Comportamento dei segnali:

- POSIX: il `signal` fornito viene passato a `kill`.
- Windows: `signal` viene ignorato; la terminazione è un process terminate incondizionato.

### Comportamento in caso di errore

Questo modulo è intenzionalmente non-throwing a livello di API:

- i rami dell'albero dei processi mancanti/inaccessibili vengono saltati,
- gli errori di terminazione per singolo pid vengono conteggiati come non riusciti (non come errori),
- un miss di ricerca produce tipicamente `[]` da `listDescendants` e `0` da `killTree`.

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

- mappature dirette a byte singolo (`enter`, `tab`, `ctrl+<lettera>`, ASCII stampabile),
- lookup O(1) di sequenze escape legacy (mappa PHF),
- analisi di `modifyOtherKeys` xterm,
- analisi del protocollo Kitty (`CSI u`, `CSI ~`, `CSI 1;...<lettera>`),
- normalizzazione verso ID tasto (`ctrl+c`, `shift+tab`, `pageUp`, `f5`, ecc.).

Gestione dei modificatori:

- per la corrispondenza dei tasti vengono confrontati solo i bit shift/alt/ctrl,
- i bit di lock vengono mascherati prima dei confronti.

Comportamento del layout:

- il fallback al layout base è intenzionalmente vincolato affinché i layout rimappati non creino false corrispondenze per lettere/simboli ASCII.

### Comportamento in caso di errore

- Le sequenze non riconosciute o non valide producono `null` dalle funzioni di analisi.
- Le funzioni di corrispondenza restituiscono `false` in caso di errore di analisi o mancata corrispondenza.
- Non viene esposta alcuna superficie di errori generati per input di tasti non validi.

## Mappatura API wrapper JS ↔ esportazioni Rust

### Shell + PTY + Processo

| API wrapper TS | Esportazione N-API Rust | Note |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | Esecuzione shell a singola chiamata |
| `new Shell(options?)` | classe `Shell` | Sessione shell persistente |
| `shell.run(options, onChunk?)` | `Shell::run` | Riutilizza la sessione con flusso di controllo keepalive |
| `shell.abort()` | `Shell::abort` | Interrompe l'esecuzione attiva per quell'istanza shell |
| `new PtySession()` | classe `PtySession` | Sessione PTY con stato |
| `pty.start(options, onChunk?)` | `PtySession::start` | Esecuzione PTY interattiva |
| `pty.write(data)` | `PtySession::write` | Passthrough grezzo dello stdin |
| `pty.resize(cols, rows)` | `PtySession::resize` | Dimensioni terminale limitate |
| `pty.kill()` | `PtySession::kill` | Termina forzatamente il figlio PTY attivo |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | Terminazione dell'albero dei processi prima i figli |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | Elenco ricorsivo dei discendenti |

### Tasti

| API wrapper TS | Esportazione N-API Rust | Note |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Corrispondenza codepoint+modificatore Kitty |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Parser di ID tasto normalizzato |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | Verifica esatta nella mappa delle sequenze legacy |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | Risultato strutturato dell'analisi Kitty |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | Matcher di tasti di alto livello |

## Note sulla pulizia delle sessioni abbandonate e sulla finalizzazione

- **Sessione shell persistente**: se un'esecuzione viene cancellata/scaduta/in errore/con flusso di controllo non-keepalive, Rust elimina esplicitamente lo stato della sessione interna. Le esecuzioni normali riuscite mantengono la sessione per il riutilizzo.
- **Sessione PTY**: `core` viene sempre azzerato al termine di `start()`, inclusi i percorsi di errore.
- **Nessun contratto esplicito di terminazione guidato dal finalizer JS** è esposto dai wrapper; la pulizia è principalmente legata ai percorsi di completamento/cancellazione dell'esecuzione. I chiamanti dovrebbero utilizzare `timeoutMs`, `AbortSignal`, `shell.abort()` o `pty.kill()` per un teardown deterministico.
