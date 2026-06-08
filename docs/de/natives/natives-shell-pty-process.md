---
title: 'Natives Shell, PTY, Process, and Key Internals'
description: >-
  Shell-Ausführung, PTY-Verwaltung, Prozesslebenszyklus und
  Tastenevent-Behandlung in der nativen Schicht.
sidebar:
  order: 4
  label: 'Shell, PTY & Prozess'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# Natives Shell-, PTY-, Prozess- und Tasten-Interna

Dieses Dokument behandelt die **Ausführungs-/Prozess-/Terminal-Primitive** in `@f5xc-salesdemos/pi-natives`: `shell`, `pty`, `ps` und `keys`, unter Verwendung der Architekturbegriffe aus `docs/natives-architecture.md`.

## Implementierungsdateien

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs` (nur Windows)
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs` (gemeinsames Abbruchverhalten, verwendet von shell/pty)
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/bindings.ts`

## Schichtzuordnung

- **TS-Wrapper/API-Schicht** (`packages/natives/src/*`): typisierte Einstiegspunkte, Abbruchoberfläche (`timeoutMs`, `AbortSignal`) und JS-Ergonomie.
- **Rust N-API-Modulschicht** (`crates/pi-natives/src/*`): Shell-/PTY-Prozessausführung, Prozessbaum-Traversierung/-Terminierung und Tastensequenz-Parsing.
- **Validierungs-Gate** (`native.ts`, Architekturebene): stellt sicher, dass erforderliche Exporte (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, Tasten-Hilfsfunktionen) existieren, bevor Wrapper verwendet werden.

## Shell-Subsystem (`shell`)

### API-Modell

Zwei Ausführungsmodi werden bereitgestellt:

1. **Einmalausführung** über `executeShell(options, onChunk?)`.
2. **Persistente Sitzung** über `new Shell(options?)`, dann wiederholtes `shell.run(...)`.

Beide streamen die Ausgabe über einen threadsicheren Callback und geben `{ exitCode?, cancelled, timedOut }` zurück.

### Sitzungserstellung und Umgebungsmodell

Rust erstellt `brush_core::Shell` mit:

- nicht-interaktivem Modus,
- `do_not_inherit_env: true`,
- expliziter Umgebungsrekonstruktion aus der Host-Umgebung,
- Ausschlussliste für shell-sensitive Variablen (`PS1`, `PWD`, `SHLVL`, Bash-Funktionsexporte usw.).

Verhalten der Sitzungsumgebung:

- `ShellOptions.sessionEnv` wird einmalig bei der Sitzungserstellung angewendet.
- `ShellRunOptions.env` ist befehlsbezogen (`EnvironmentScope::Command`) und wird nach jedem Lauf entfernt.
- `PATH` wird unter Windows speziell mit groß-/kleinschreibungsunabhängiger Deduplizierung zusammengeführt.

Windows-spezifische Pfadanreicherung (`shell/windows.rs`): Erkannte Git-für-Windows-Pfade (`cmd`, `bin`, `usr/bin`) werden angehängt, wenn vorhanden und nicht bereits enthalten.

### Laufzeit-Lebenszyklus und Zustandsübergänge

Die persistente Shell (`Shell.run`) verwendet folgende Zustandsmaschine:

- **Leerlauf/Nicht initialisiert**: `session: None`.
- **Laufend**: Erster `run()`-Aufruf erstellt die Sitzung verzögert, speichert das `current_abort`-Token und führt den Befehl aus.
- **Abgeschlossen + Keepalive**: Wenn der Ausführungskontrollfluss `Normal` ist, wird `current_abort` gelöscht und die Sitzung wiederverwendet.
- **Abgeschlossen + Abbau**: Wenn der Kontrollfluss schleifen-/skript-/shell-exit-bezogen ist (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), wird die Sitzung verworfen (`session: None`).
- **Abgebrochen/Zeitüberschreitung**: Laufende Aufgabe wird abgebrochen, Gnadenfrist (2s), dann erzwungener Abbruch; Sitzung wird verworfen.
- **Fehler**: Sitzung wird verworfen.

Die Einmalausführung (`executeShell`) erstellt und verwirft stets eine neue Sitzung pro Aufruf.

### Streaming-/Ausgabeverhalten

- Stdout/Stderr werden in eine gemeinsame Pipe geleitet und parallel gelesen.
- Der Reader dekodiert UTF-8 inkrementell; ungültige Bytesequenzen erzeugen `U+FFFD`-Ersetzungschunks.
- Nach Prozessabschluss hat die Ausgabeentleerung Leerlauf-/Maximalschutz (`250ms` Leerlauf, `2s` Maximum), um ein Hängenbleiben bei Hintergrundprozessen zu vermeiden, die Deskriptoren offen halten.

### Abbruch, Zeitüberschreitung und Hintergrundprozesse

- `CancelToken` wird aus `timeoutMs` und optionalem `AbortSignal` konstruiert.
- Bei Abbruch/Zeitüberschreitung wird das Shell-Abbruchtoken ausgelöst, dann erhält die Aufgabe ein 2s-Gnadenfenster vor erzwungenem Abbruch.
- Bei Abbruch werden Hintergrundprozesse (`TERM`, dann verzögertes `KILL`) unter Verwendung der Brush-Job-Metadaten terminiert.

Verhalten von `Shell.abort()`:

- Bricht nur den aktuell laufenden Befehl für diese `Shell`-Instanz ab,
- erfolgreicher No-Op, wenn nichts läuft.

### Fehlerverhalten

Häufig aufgetretene Fehler umfassen:

- Fehler bei der Sitzungsinitialisierung (`Failed to initialize shell`),
- CWD-Fehler (`Failed to set cwd`),
- Fehler beim Setzen/Entfernen von Umgebungsvariablen,
- Fehler bei der Snapshot-Quelle,
- Fehler bei der Pipe-Erstellung/-Klonierung,
- Ausführungsfehler (`Shell execution failed: ...`),
- Task-Wrapper-Fehler (`Shell execution task failed: ...`).

Abbruchflags auf Ergebnisebene:

- Zeitüberschreitung -> `exitCode: undefined`, `timedOut: true`.
- Abbruchsignal -> `exitCode: undefined`, `cancelled: true`.

## PTY-Subsystem (`pty`)

### API-Modell

`new PtySession()` bietet:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### Laufzeit-Lebenszyklus und Zustandsübergänge

Zustandsmaschine von `PtySession`:

- **Leerlauf**: `core: None`.
- **Reserviert**: `start()` installiert den Kontrollkanal synchron (`core: Some`) bevor die asynchrone Arbeit beginnt, sodass `write/resize/kill` sofort gültig werden.
- **Laufend**: Blockierende PTY-Schleife behandelt Kindprozessstatus, Reader-Events, Abbruch-Heartbeat und Kontrollnachrichten.
- **Terminal geschlossen**: Kindprozess-Exit + Reader-Abschluss.
- **Finalisiert**: `core` wird nach Abschluss der Start-Aufgabe immer auf `None` zurückgesetzt (bei Erfolg oder Fehler).

Nebenläufigkeitsschutz:

- Ein Start während bereits laufender Sitzung gibt `PTY session already running` zurück.

### Spawn-/Attach-/Write-/Read-/Terminierungsmuster

- PTY wird über `portable_pty::native_pty_system().openpty(...)` geöffnet.
- Der Befehl wird derzeit als `sh -lc <command>` mit optionalem `cwd` und Umgebungsüberschreibungen ausgeführt.
- `write()` sendet Rohbytes an PTY-Stdin.
- `resize()` begrenzt die Dimensionen (`cols 20..400`, `rows 5..200`) und ruft Master-Resize auf.
- `kill()` markiert den Lauf als abgebrochen und beendet den Kindprozess.

Ausgabepfad:

- Ein dedizierter Reader-Thread liest den Master-Stream,
- inkrementelle UTF-8-Dekodierung mit `U+FFFD`-Ersetzung bei ungültigen Bytes,
- Chunks werden über einen N-API-threadsicheren Callback weitergeleitet.

### Abbruch- und Zeitüberschreitungssemantik

- `timeoutMs` und `AbortSignal` speisen ein `CancelToken`.
- Die Schleife ruft periodisch `ct.heartbeat()` auf; ein Abbruch löst das Beenden des Kindprozesses aus.
- Die Zeitüberschreitungsklassifizierung ist stringbasiert (`"Timeout"`-Teilstring im Heartbeat-Fehler).

### Fehlerverhalten

Fehlerflächen umfassen:

- PTY-Allokations-/Öffnungsfehler,
- PTY-Spawn-Fehler,
- Writer-/Reader-Erwerbsfehler,
- Fehler beim Kindprozessstatus/-Warten,
- Lock-Poisoning,
- Kontrollkanal-Verbindungsabbruch (`PTY session is no longer available`).

Fehler bei Kontrollaufrufen, wenn nicht laufend:

- `write/resize/kill` geben `PTY session is not running` zurück.

## Prozessbaum-Subsystem (`ps`)

### API-Modell

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

Der TS-Wrapper registriert auch die native Kill-Tree-Integration in gemeinsame Utilities über `setNativeKillTree(native.killTree)`.

### Plattformspezifische Implementierung

- **Linux**: Liest rekursiv `/proc/<pid>/task/<pid>/children`.
- **macOS**: Verwendet `libproc` `proc_listchildpids`.
- **Windows**: Erstellt einen Snapshot der Prozesstabelle mit `CreateToolhelp32Snapshot`, baut eine Eltern->Kinder-Zuordnung auf, terminiert mit `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### Kill-Tree-Verhalten

- Nachkommen werden rekursiv gesammelt.
- Die Terminierungsreihenfolge ist von unten nach oben (tiefste Nachkommen zuerst), um verwaiste Neuverknüpfungen zu reduzieren.
- Die Stamm-PID wird zuletzt beendet.
- Der Rückgabewert ist die Anzahl erfolgreicher Terminierungen.

Signalverhalten:

- POSIX: Das angegebene `signal` wird an `kill` übergeben.
- Windows: `signal` wird ignoriert; die Terminierung ist ein unbedingtes Prozessbeenden.

### Fehlerverhalten

Dieses Modul ist an der API-Oberfläche absichtlich nicht-werfend:

- Fehlende/unzugängliche Prozessbaumzweige werden übersprungen,
- Fehler beim Beenden einzelner PIDs werden als nicht erfolgreich gezählt (keine Fehler),
- Ein fehlgeschlagener Lookup ergibt typischerweise `[]` von `listDescendants` und `0` von `killTree`.

## Tasten-Parsing-Subsystem (`keys`)

### API-Modell

Bereitgestellte Hilfsfunktionen:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### Parsing-Modell

Der Parser kombiniert:

- direkte Einzelbyte-Zuordnungen (`enter`, `tab`, `ctrl+<Buchstabe>`, druckbares ASCII),
- O(1) Legacy-Escape-Sequenz-Lookup (PHF-Map),
- xterm `modifyOtherKeys`-Parsing,
- Kitty-Protokoll-Parsing (`CSI u`, `CSI ~`, `CSI 1;...<Buchstabe>`),
- Normalisierung zu Tasten-IDs (`ctrl+c`, `shift+tab`, `pageUp`, `f5` usw.).

Modifier-Behandlung:

- Nur Shift-/Alt-/Ctrl-Bits werden für den Tastenabgleich verglichen,
- Lock-Bits werden vor Vergleichen ausmaskiert.

Layout-Verhalten:

- Der Base-Layout-Fallback ist absichtlich eingeschränkt, damit umgemappte Layouts keine falschen Treffer für ASCII-Buchstaben/-Symbole erzeugen.

### Fehlerverhalten

- Nicht erkannte oder ungültige Sequenzen erzeugen `null` aus Parse-Funktionen.
- Match-Funktionen geben bei Parse-Fehler oder Nichtübereinstimmung `false` zurück.
- Keine geworfene Fehleroberfläche für fehlerhafte Tasteneingaben.

## JS-Wrapper-API ↔ Rust-Export-Zuordnung

### Shell + PTY + Prozess

| TS-Wrapper-API | Rust N-API-Export | Anmerkungen |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | Einmalige Shell-Ausführung |
| `new Shell(options?)` | `Shell`-Klasse | Persistente Shell-Sitzung |
| `shell.run(options, onChunk?)` | `Shell::run` | Wiederverwendung der Sitzung bei Keepalive-Kontrollfluss |
| `shell.abort()` | `Shell::abort` | Bricht den aktiven Lauf für diese Shell-Instanz ab |
| `new PtySession()` | `PtySession`-Klasse | Zustandsbehaftete PTY-Sitzung |
| `pty.start(options, onChunk?)` | `PtySession::start` | Interaktiver PTY-Lauf |
| `pty.write(data)` | `PtySession::write` | Roh-Stdin-Durchleitung |
| `pty.resize(cols, rows)` | `PtySession::resize` | Begrenzte Terminaldimensionen |
| `pty.kill()` | `PtySession::kill` | Erzwungenes Beenden des aktiven PTY-Kindprozesses |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | Kinder-zuerst-Prozessbaum-Terminierung |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | Rekursive Nachkommenauflistung |

### Tasten

| TS-Wrapper-API | Rust N-API-Export | Anmerkungen |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Kitty-Codepoint+Modifier-Abgleich |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Normalisierter Tasten-ID-Parser |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | Exakte Legacy-Sequenz-Map-Prüfung |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | Strukturiertes Kitty-Parse-Ergebnis |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | High-Level-Tastenmatcher |

## Aufräumen aufgegebener Sitzungen und Finalisierungshinweise

- **Persistente Shell-Sitzung**: Wenn ein Lauf abgebrochen/zeitüberschritten/fehlerhaft/nicht-Keepalive-Kontrollfluss ist, verwirft Rust explizit den internen Sitzungszustand. Erfolgreiche normale Läufe behalten die Sitzung zur Wiederverwendung.
- **PTY-Sitzung**: `core` wird nach Abschluss von `start()` immer zurückgesetzt, einschließlich Fehlerpfade.
- **Kein expliziter JS-Finalizer-gesteuerter Kill-Vertrag** wird von Wrappern bereitgestellt; die Aufräumung ist primär an Laufabschluss-/Abbruchpfade gebunden. Aufrufer sollten `timeoutMs`, `AbortSignal`, `shell.abort()` oder `pty.kill()` für deterministischen Abbau verwenden.
