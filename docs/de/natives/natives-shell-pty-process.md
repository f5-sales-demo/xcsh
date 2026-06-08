---
title: 'Natives Shell, PTY, Process und Key-Interna'
description: >-
  Shell-Ausführung, PTY-Verwaltung, Prozesslebenszyklus und
  Tastenereignisbehandlung in der nativen Schicht.
sidebar:
  order: 4
  label: 'Shell, PTY & Prozesse'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# Natives Shell, PTY, Process und Key-Interna

Dieses Dokument behandelt die **Ausführungs-/Prozess-/Terminal-Primitiven** in `@f5xc-salesdemos/pi-natives`: `shell`, `pty`, `ps` und `keys`, unter Verwendung der Architekturbegriffe aus `docs/natives-architecture.md`.

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
- **Validierungsschranke** (`native.ts`, Architekturebene): stellt sicher, dass erforderliche Exporte (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, Key-Hilfsfunktionen) existieren, bevor Wrapper verwendet werden.

## Shell-Subsystem (`shell`)

### API-Modell

Zwei Ausführungsmodi werden bereitgestellt:

1. **Einmalig** über `executeShell(options, onChunk?)`.
2. **Persistente Sitzung** über `new Shell(options?)` und dann wiederholtes `shell.run(...)`.

Beide streamen die Ausgabe über einen threadsicheren Callback und geben `{ exitCode?, cancelled, timedOut }` zurück.

### Sitzungserstellung und Umgebungsmodell

Rust erstellt `brush_core::Shell` mit:

- nicht-interaktivem Modus,
- `do_not_inherit_env: true`,
- expliziter Umgebungsrekonstruktion aus der Host-Umgebung,
- Ausschlussliste für shell-sensitive Variablen (`PS1`, `PWD`, `SHLVL`, Bash-Funktionsexporte usw.).

Sitzungs-Umgebungsverhalten:

- `ShellOptions.sessionEnv` wird einmalig bei der Sitzungserstellung angewendet.
- `ShellRunOptions.env` ist befehlsbezogen (`EnvironmentScope::Command`) und wird nach jedem Durchlauf entfernt.
- `PATH` wird unter Windows speziell mit case-insensitiver Deduplizierung zusammengeführt.

Windows-spezifische Pfadanreicherung (`shell/windows.rs`): Erkannte Git-für-Windows-Pfade (`cmd`, `bin`, `usr/bin`) werden angehängt, wenn vorhanden und nicht bereits enthalten.

### Laufzeitlebenszyklus und Zustandsübergänge

Die persistente Shell (`Shell.run`) verwendet diese Zustandsmaschine:

- **Idle/Nicht initialisiert**: `session: None`.
- **Laufend**: Der erste `run()`-Aufruf erstellt die Sitzung verzögert, speichert das `current_abort`-Token und führt den Befehl aus.
- **Abgeschlossen + Keepalive**: Wenn der Ausführungskontrollfluss `Normal` ist, wird `current_abort` gelöscht und die Sitzung wiederverwendet.
- **Abgeschlossen + Abbau**: Wenn der Kontrollfluss schleifen-/skript-/shell-exit-bezogen ist (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), wird die Sitzung verworfen (`session: None`).
- **Abgebrochen/Zeitüberschreitung**: Die Ausführungsaufgabe wird abgebrochen, Wartefrist (2s), dann erzwungener Abbruch; die Sitzung wird verworfen.
- **Fehler**: Die Sitzung wird verworfen.

Die einmalige Shell (`executeShell`) erstellt und verwirft immer eine neue Sitzung pro Aufruf.

### Streaming-/Ausgabeverhalten

- Stdout/stderr werden in eine gemeinsame Pipe geleitet und nebenläufig gelesen.
- Der Reader dekodiert UTF-8 inkrementell; ungültige Bytesequenzen erzeugen `U+FFFD`-Ersatzzeichen-Chunks.
- Nach Prozessabschluss hat das Ausgabe-Draining Idle-/Max-Schutzwerte (`250ms` Idle, `2s` Maximum), um ein Hängen bei Hintergrundjobs zu vermeiden, die Deskriptoren offen halten.

### Abbruch, Zeitüberschreitung und Hintergrundjobs

- `CancelToken` wird aus `timeoutMs` und optionalem `AbortSignal` konstruiert.
- Bei Abbruch/Zeitüberschreitung wird das Shell-Abbruch-Token ausgelöst, dann erhält die Aufgabe ein 2s-Kulanzfenster vor erzwungenem Abbruch.
- Bei Abbruch werden Hintergrundjobs terminiert (`TERM`, dann verzögertes `KILL`) unter Verwendung der Brush-Job-Metadaten.

`Shell.abort()`-Verhalten:

- Bricht nur den aktuell laufenden Befehl für diese `Shell`-Instanz ab,
- No-Op-Erfolg wenn nichts läuft.

### Fehlerverhalten

Häufig aufgetretene Fehler umfassen:

- Sitzungsinitialisierungsfehler (`Failed to initialize shell`),
- cwd-Fehler (`Failed to set cwd`),
- Fehler beim Setzen/Entfernen von Umgebungsvariablen,
- Snapshot-Quellfehler,
- Fehler beim Erstellen/Klonen von Pipes,
- Ausführungsfehler (`Shell execution failed: ...`),
- Task-Wrapper-Fehler (`Shell execution task failed: ...`).

Abbruch-Flags auf Ergebnisebene:

- Zeitüberschreitung -> `exitCode: undefined`, `timedOut: true`.
- Abort-Signal -> `exitCode: undefined`, `cancelled: true`.

## PTY-Subsystem (`pty`)

### API-Modell

`new PtySession()` stellt bereit:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### Laufzeitlebenszyklus und Zustandsübergänge

`PtySession`-Zustandsmaschine:

- **Idle**: `core: None`.
- **Reserviert**: `start()` installiert den Steuerkanal synchron (`core: Some`) bevor die asynchrone Arbeit beginnt, sodass `write/resize/kill` sofort gültig werden.
- **Laufend**: Eine blockierende PTY-Schleife behandelt den Kindprozess-Zustand, Reader-Ereignisse, Abbruch-Heartbeat und Steuernachrichten.
- **Terminal geschlossen**: Kindprozess-Exit + Reader-Abschluss.
- **Finalisiert**: `core` wird immer nach Abschluss der Start-Aufgabe auf `None` zurückgesetzt (Erfolg oder Fehler).

Nebenläufigkeitsschutz:

- Starten während bereits laufend gibt `PTY session already running` zurück.

### Spawn-/Attach-/Write-/Read-/Terminate-Muster

- PTY wird über `portable_pty::native_pty_system().openpty(...)` geöffnet.
- Der Befehl wird aktuell als `sh -lc <command>` mit optionalem `cwd` und Umgebungsüberschreibungen ausgeführt.
- `write()` sendet Roh-Bytes an PTY-stdin.
- `resize()` begrenzt die Dimensionen (`cols 20..400`, `rows 5..200`) und ruft die Master-Größenänderung auf.
- `kill()` markiert den Lauf als abgebrochen und beendet den Kindprozess.

Ausgabepfad:

- Ein dedizierter Reader-Thread liest den Master-Stream,
- inkrementelle UTF-8-Dekodierung mit `U+FFFD`-Ersatz bei ungültigen Bytes,
- Chunks werden über den N-API threadsicheren Callback weitergeleitet.

### Abbruch- und Zeitüberschreitungssemantik

- `timeoutMs` und `AbortSignal` speisen ein `CancelToken`.
- Die Schleife ruft periodisch `ct.heartbeat()` auf; ein Abbruch löst das Beenden des Kindprozesses aus.
- Die Zeitüberschreitungsklassifizierung ist zeichenkettenbasiert (`"Timeout"`-Teilstring im Heartbeat-Fehler).

### Fehlerverhalten

Fehleroberflächen umfassen:

- PTY-Allokations-/Öffnungsfehler,
- PTY-Spawn-Fehler,
- Writer-/Reader-Beschaffungsfehler,
- Fehler beim Kindprozess-Status/-Warten,
- Lock-Poisoning,
- Steuerkanal-Trennung (`PTY session is no longer available`).

Fehlverhalten von Steueraufrufen wenn nicht laufend:

- `write/resize/kill` geben `PTY session is not running` zurück.

## Prozessbaum-Subsystem (`ps`)

### API-Modell

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

Der TS-Wrapper registriert auch die native Kill-Tree-Integration in die gemeinsamen Hilfsfunktionen über `setNativeKillTree(native.killTree)`.

### Plattformspezifische Implementierung

- **Linux**: Liest rekursiv `/proc/<pid>/task/<pid>/children`.
- **macOS**: Verwendet `libproc` `proc_listchildpids`.
- **Windows**: Erstellt einen Snapshot der Prozesstabelle mit `CreateToolhelp32Snapshot`, baut eine Eltern->Kinder-Zuordnung auf, terminiert mit `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### Kill-Tree-Verhalten

- Nachkommen werden rekursiv erfasst.
- Die Kill-Reihenfolge ist von unten nach oben (tiefste Nachkommen zuerst), um Waisen-Umparentierung zu reduzieren.
- Die Wurzel-PID wird zuletzt beendet.
- Der Rückgabewert ist die Anzahl erfolgreicher Terminierungen.

Signalverhalten:

- POSIX: Das angegebene `signal` wird an `kill` weitergegeben.
- Windows: `signal` wird ignoriert; die Terminierung ist eine bedingungslose Prozessbeendigung.

### Fehlerverhalten

Dieses Modul ist absichtlich nicht-werfend an der API-Oberfläche:

- Fehlende/nicht zugängliche Prozessbaum-Zweige werden übersprungen,
- Kill-Fehler pro PID werden als erfolglos gezählt (keine Fehler),
- Lookup-Fehlschläge liefern typischerweise `[]` von `listDescendants` und `0` von `killTree`.

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

- direkte Einzelbyte-Zuordnungen (`enter`, `tab`, `ctrl+<buchstabe>`, druckbares ASCII),
- O(1) Legacy-Escape-Sequenz-Lookup (PHF-Map),
- xterm `modifyOtherKeys`-Parsing,
- Kitty-Protokoll-Parsing (`CSI u`, `CSI ~`, `CSI 1;...<buchstabe>`),
- Normalisierung zu Tasten-IDs (`ctrl+c`, `shift+tab`, `pageUp`, `f5` usw.).

Modifier-Behandlung:

- Nur Shift-/Alt-/Ctrl-Bits werden für den Tastenabgleich verglichen,
- Lock-Bits werden vor Vergleichen ausmaskiert.

Layout-Verhalten:

- Der Base-Layout-Fallback ist absichtlich eingeschränkt, damit umgemappte Layouts keine falschen Treffer für ASCII-Buchstaben/-Symbole erzeugen.

### Fehlerverhalten

- Nicht erkannte oder ungültige Sequenzen erzeugen `null` von Parse-Funktionen.
- Match-Funktionen geben `false` bei Parse-Fehler oder Nichtübereinstimmung zurück.
- Keine geworfene Fehleroberfläche für fehlerhafte Tasteneingaben.

## JS-Wrapper-API ↔ Rust-Export-Zuordnung

### Shell + PTY + Prozesse

| TS-Wrapper-API | Rust N-API-Export | Anmerkungen |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | Einmalige Shell-Ausführung |
| `new Shell(options?)` | `Shell` Klasse | Persistente Shell-Sitzung |
| `shell.run(options, onChunk?)` | `Shell::run` | Wiederverwendet Sitzung bei Keepalive-Kontrollfluss |
| `shell.abort()` | `Shell::abort` | Bricht aktiven Lauf für diese Shell-Instanz ab |
| `new PtySession()` | `PtySession` Klasse | Zustandsbehaftete PTY-Sitzung |
| `pty.start(options, onChunk?)` | `PtySession::start` | Interaktiver PTY-Lauf |
| `pty.write(data)` | `PtySession::write` | Rohe stdin-Durchleitung |
| `pty.resize(cols, rows)` | `PtySession::resize` | Begrenzte Terminal-Dimensionen |
| `pty.kill()` | `PtySession::kill` | Erzwingt Beendigung des aktiven PTY-Kindprozesses |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | Kinder-zuerst-Prozessbaum-Terminierung |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | Rekursive Nachkommen-Auflistung |

### Tasten

| TS-Wrapper-API | Rust N-API-Export | Anmerkungen |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Kitty-Codepoint+Modifier-Abgleich |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Normalisierter Tasten-ID-Parser |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | Exakte Legacy-Sequenz-Map-Prüfung |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | Strukturiertes Kitty-Parse-Ergebnis |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | Hochrangiger Tasten-Matcher |

## Bereinigung verlassener Sitzungen und Finalisierungshinweise

- **Persistente Shell-Sitzung**: Wenn ein Lauf abgebrochen/zeitüberschritten/fehlerhaft/mit nicht-Keepalive-Kontrollfluss ist, verwirft Rust explizit den internen Sitzungszustand. Erfolgreiche normale Läufe behalten die Sitzung zur Wiederverwendung.
- **PTY-Sitzung**: `core` wird immer nach Abschluss von `start()` gelöscht, einschließlich Fehlerpfade.
- **Kein expliziter JS-Finalizer-gesteuerter Kill-Vertrag** wird von den Wrappern bereitgestellt; die Bereinigung ist primär an Laufabschluss-/Abbruchpfade gebunden. Aufrufer sollten `timeoutMs`, `AbortSignal`, `shell.abort()` oder `pty.kill()` für deterministischen Abbau verwenden.
