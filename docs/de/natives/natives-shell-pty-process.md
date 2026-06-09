---
title: 'Interna der nativen Shell, PTY, Prozess- und Tastenverarbeitung'
description: >-
  Shell-Ausführung, PTY-Verwaltung, Prozesslebenszyklus und
  Tastenereignisverarbeitung in der nativen Schicht.
sidebar:
  order: 4
  label: 'Shell, PTY & Prozess'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# Interna der nativen Shell, PTY, Prozess- und Tastenverarbeitung

Dieses Dokument behandelt die **Ausführungs-/Prozess-/Terminal-Primitive** in `@f5xc-salesdemos/pi-natives`: `shell`, `pty`, `ps` und `keys`, unter Verwendung der Architekturterminologie aus `docs/natives-architecture.md`.

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

- **TS-Wrapper-/API-Schicht** (`packages/natives/src/*`): typisierte Einstiegspunkte, Abbruch-Oberfläche (`timeoutMs`, `AbortSignal`) und JS-Ergonomie.
- **Rust-N-API-Modulschicht** (`crates/pi-natives/src/*`): Shell-/PTY-Prozessausführung, Prozessbaum-Traversierung/-Terminierung und Tastensequenz-Parsing.
- **Validierungsschranke** (`native.ts`, Architekturebene): stellt sicher, dass erforderliche Exports (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, Key-Hilfsfunktionen) vorhanden sind, bevor Wrapper verwendet werden.

## Shell-Subsystem (`shell`)

### API-Modell

Zwei Ausführungsmodi werden bereitgestellt:

1. **Einmalausführung** über `executeShell(options, onChunk?)`.
2. **Persistente Sitzung** über `new Shell(options?)` und anschließend wiederholtes `shell.run(...)`.

Beide streamen Ausgaben über einen threadsicheren Callback und geben `{ exitCode?, cancelled, timedOut }` zurück.

### Sitzungserstellung und Umgebungsmodell

Rust erstellt `brush_core::Shell` mit:

- nicht-interaktivem Modus,
- `do_not_inherit_env: true`,
- expliziter Umgebungsrekonstruktion aus der Host-Umgebung,
- Ausschlussliste für shell-sensitive Variablen (`PS1`, `PWD`, `SHLVL`, Bash-Funktions-Exports usw.).

Sitzungs-Umgebungsverhalten:

- `ShellOptions.sessionEnv` wird einmalig bei der Sitzungserstellung angewendet.
- `ShellRunOptions.env` ist befehlsbezogen (`EnvironmentScope::Command`) und wird nach jedem Durchlauf entfernt.
- `PATH` wird unter Windows speziell mit groß-/kleinschreibungsunabhängiger Deduplizierung zusammengeführt.

Windows-spezifische Pfaderweiterung (`shell/windows.rs`): Erkannte Git-für-Windows-Pfade (`cmd`, `bin`, `usr/bin`) werden angehängt, sofern vorhanden und nicht bereits enthalten.

### Laufzeit-Lebenszyklus und Zustandsübergänge

Die persistente Shell (`Shell.run`) verwendet folgende Zustandsmaschine:

- **Leerlauf/Nicht initialisiert**: `session: None`.
- **Laufend**: Der erste `run()`-Aufruf erstellt die Sitzung verzögert, speichert das `current_abort`-Token und führt den Befehl aus.
- **Abgeschlossen + Keepalive**: Wenn der Ausführungskontrollfluss `Normal` ist, wird `current_abort` zurückgesetzt und die Sitzung wiederverwendet.
- **Abgeschlossen + Abbau**: Wenn der Kontrollfluss schleifen-/skript-/shell-exit-bezogen ist (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), wird die Sitzung verworfen (`session: None`).
- **Abgebrochen/Zeitüberschreitung**: Die Ausführungsaufgabe wird abgebrochen, Karenzzeit (2s), dann erzwungener Abbruch; Sitzung wird verworfen.
- **Fehler**: Sitzung wird verworfen.

Die Einmalausführung (`executeShell`) erstellt und verwirft stets eine frische Sitzung pro Aufruf.

### Streaming-/Ausgabeverhalten

- Stdout/Stderr werden in eine gemeinsame Pipe geleitet und nebenläufig gelesen.
- Der Reader dekodiert UTF-8 inkrementell; ungültige Bytesequenzen erzeugen `U+FFFD`-Ersetzungsblöcke.
- Nach Prozessabschluss hat das Ausgabe-Draining Leerlauf-/Maximalschutzwerte (`250ms` Leerlauf, `2s` Maximum), um Hängenbleiben durch Hintergrundprozesse zu vermeiden, die Deskriptoren offen halten.

### Abbruch, Zeitüberschreitung und Hintergrundprozesse

- `CancelToken` wird aus `timeoutMs` und optionalem `AbortSignal` konstruiert.
- Bei Abbruch/Zeitüberschreitung wird das Shell-Abbruch-Token ausgelöst, dann erhält die Aufgabe ein 2s-Karenzfenster vor erzwungenem Abbruch.
- Falls ein Abbruch erfolgt, werden Hintergrundprozesse terminiert (`TERM`, dann verzögertes `KILL`) unter Verwendung der Brush-Job-Metadaten.

`Shell.abort()`-Verhalten:

- Bricht nur den aktuell laufenden Befehl für diese `Shell`-Instanz ab,
- Erfolgreicher No-Op, wenn nichts läuft.

### Fehlerverhalten

Häufig gemeldete Fehler umfassen:

- Sitzungsinitialisierungsfehler (`Failed to initialize shell`),
- CWD-Fehler (`Failed to set cwd`),
- Fehler beim Setzen/Entfernen von Umgebungsvariablen,
- Snapshot-Quell-Fehler,
- Fehler bei der Pipe-Erstellung/-Duplizierung,
- Ausführungsfehler (`Shell execution failed: ...`),
- Task-Wrapper-Fehler (`Shell execution task failed: ...`).

Abbruch-Flags auf Ergebnisebene:

- Zeitüberschreitung -> `exitCode: undefined`, `timedOut: true`.
- Abbruchsignal -> `exitCode: undefined`, `cancelled: true`.

## PTY-Subsystem (`pty`)

### API-Modell

`new PtySession()` stellt bereit:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### Laufzeit-Lebenszyklus und Zustandsübergänge

`PtySession`-Zustandsmaschine:

- **Leerlauf**: `core: None`.
- **Reserviert**: `start()` installiert den Kontrollkanal synchron (`core: Some`) bevor asynchrone Arbeit beginnt, sodass `write/resize/kill` sofort gültig werden.
- **Laufend**: Die blockierende PTY-Schleife verarbeitet Kindprozessstatus, Reader-Ereignisse, Abbruch-Heartbeat und Kontrollnachrichten.
- **Terminal geschlossen**: Kindprozess-Exit + Reader-Abschluss.
- **Finalisiert**: `core` wird stets nach Abschluss der Start-Aufgabe auf `None` zurückgesetzt (Erfolg oder Fehler).

Nebenläufigkeitsschutz:

- Starten während bereits läuft gibt `PTY session already running` zurück.

### Spawn-/Attach-/Write-/Read-/Terminierungsmuster

- PTY wird über `portable_pty::native_pty_system().openpty(...)` geöffnet.
- Der Befehl wird derzeit als `sh -lc <command>` ausgeführt, mit optionalem `cwd` und Umgebungsüberschreibungen.
- `write()` sendet rohe Bytes an PTY-Stdin.
- `resize()` begrenzt Dimensionen (`cols 20..400`, `rows 5..200`) und ruft Master-Resize auf.
- `kill()` markiert den Durchlauf als abgebrochen und beendet den Kindprozess.

Ausgabepfad:

- Ein dedizierter Reader-Thread liest den Master-Stream,
- inkrementelle UTF-8-Dekodierung mit `U+FFFD`-Ersetzung bei ungültigen Bytes,
- Blöcke werden über N-API-threadsicheren Callback weitergeleitet.

### Abbruch- und Zeitüberschreitungssemantik

- `timeoutMs` und `AbortSignal` speisen ein `CancelToken`.
- Die Schleife ruft periodisch `ct.heartbeat()` auf; Abbruch löst Kindprozess-Kill aus.
- Zeitüberschreitungsklassifizierung erfolgt stringbasiert (`"Timeout"`-Teilstring im Heartbeat-Fehler).

### Fehlerverhalten

Fehleroberflächen umfassen:

- PTY-Allokations-/Öffnungsfehler,
- PTY-Spawn-Fehler,
- Writer-/Reader-Erwerbsfehler,
- Kindprozess-Status-/Wait-Fehler,
- Lock-Vergiftung,
- Kontrollkanal-Trennung (`PTY session is no longer available`).

Fehler bei Kontrollaufrufen, wenn nicht laufend:

- `write/resize/kill` geben `PTY session is not running` zurück.

## Prozessbaum-Subsystem (`ps`)

### API-Modell

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

Der TS-Wrapper registriert außerdem die native Kill-Tree-Integration in gemeinsame Utilities über `setNativeKillTree(native.killTree)`.

### Plattformspezifische Implementierung

- **Linux**: Liest rekursiv `/proc/<pid>/task/<pid>/children`.
- **macOS**: Verwendet `libproc` `proc_listchildpids`.
- **Windows**: Erstellt einen Snapshot der Prozesstabelle mit `CreateToolhelp32Snapshot`, baut eine Eltern->Kinder-Zuordnung auf, terminiert mit `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### Kill-Tree-Verhalten

- Nachkommen werden rekursiv gesammelt.
- Die Terminierungsreihenfolge ist Bottom-Up (tiefste Nachkommen zuerst), um Waisen-Neuverteilung zu reduzieren.
- Die Stamm-PID wird zuletzt beendet.
- Der Rückgabewert ist die Anzahl erfolgreicher Terminierungen.

Signalverhalten:

- POSIX: Das übergebene `signal` wird an `kill` weitergereicht.
- Windows: `signal` wird ignoriert; Terminierung ist eine bedingungslose Prozessbeendigung.

### Fehlerverhalten

Dieses Modul ist an der API-Oberfläche bewusst nicht-werfend:

- Fehlende/unzugängliche Prozessbaum-Zweige werden übersprungen,
- Einzelne PID-Kill-Fehler werden als nicht erfolgreich gezählt (keine Fehler),
- Lookup-Misserfolge ergeben typischerweise `[]` von `listDescendants` und `0` von `killTree`.

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
- O(1)-Legacy-Escape-Sequenz-Lookup (PHF-Map),
- xterm `modifyOtherKeys`-Parsing,
- Kitty-Protokoll-Parsing (`CSI u`, `CSI ~`, `CSI 1;...<Buchstabe>`),
- Normalisierung zu Key-IDs (`ctrl+c`, `shift+tab`, `pageUp`, `f5` usw.).

Modifikator-Behandlung:

- Nur Shift-/Alt-/Ctrl-Bits werden beim Tastenabgleich verglichen,
- Lock-Bits werden vor Vergleichen maskiert.

Layoutverhalten:

- Der Basis-Layout-Fallback ist bewusst eingeschränkt, damit umgemappte Layouts keine falschen Treffer für ASCII-Buchstaben/-Symbole erzeugen.

### Fehlerverhalten

- Nicht erkannte oder ungültige Sequenzen erzeugen `null` bei Parse-Funktionen.
- Match-Funktionen geben `false` bei Parse-Fehlern oder Nichtübereinstimmung zurück.
- Keine geworfene Fehleroberfläche bei fehlerhafter Tasteneingabe.

## JS-Wrapper-API ↔ Rust-Export-Zuordnung

### Shell + PTY + Prozess

| TS-Wrapper-API | Rust-N-API-Export | Hinweise |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | Einmalige Shell-Ausführung |
| `new Shell(options?)` | `Shell`-Klasse | Persistente Shell-Sitzung |
| `shell.run(options, onChunk?)` | `Shell::run` | Wiederverwendet Sitzung bei Keepalive-Kontrollfluss |
| `shell.abort()` | `Shell::abort` | Bricht aktiven Durchlauf für diese Shell-Instanz ab |
| `new PtySession()` | `PtySession`-Klasse | Zustandsbehaftete PTY-Sitzung |
| `pty.start(options, onChunk?)` | `PtySession::start` | Interaktiver PTY-Durchlauf |
| `pty.write(data)` | `PtySession::write` | Rohe Stdin-Weiterleitung |
| `pty.resize(cols, rows)` | `PtySession::resize` | Begrenzte Terminaldimensionen |
| `pty.kill()` | `PtySession::kill` | Erzwingt Beendigung des aktiven PTY-Kindprozesses |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | Kinder-zuerst-Prozessbaum-Terminierung |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | Rekursive Nachkommen-Auflistung |

### Tasten

| TS-Wrapper-API | Rust-N-API-Export | Hinweise |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Kitty-Codepoint+Modifikator-Abgleich |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Normalisierter Key-ID-Parser |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | Exakte Legacy-Sequenz-Map-Prüfung |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | Strukturiertes Kitty-Parse-Ergebnis |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | Hochstufiger Tastenmatcher |

## Bereinigung verlassener Sitzungen und Finalisierungshinweise

- **Persistente Shell-Sitzung**: Wenn ein Durchlauf abgebrochen/zeitüberschritten/fehlerhaft/Nicht-Keepalive-Kontrollfluss ist, verwirft Rust explizit den internen Sitzungszustand. Erfolgreiche normale Durchläufe behalten die Sitzung zur Wiederverwendung.
- **PTY-Sitzung**: `core` wird stets nach Abschluss von `start()` zurückgesetzt, einschließlich Fehlerpfaden.
- **Kein expliziter JS-Finalizer-gesteuerter Kill-Vertrag** wird von den Wrappern bereitgestellt; die Bereinigung ist primär an Durchlauf-Abschluss-/Abbruchpfade gebunden. Aufrufer sollten `timeoutMs`, `AbortSignal`, `shell.abort()` oder `pty.kill()` für deterministischen Abbau verwenden.
