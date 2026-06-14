---
title: 'Natives Shell, PTY, Prozess und Schlüssel-Interna'
description: >-
  Shell-Ausführung, PTY-Verwaltung, Prozess-Lebenszyklus und
  Tastenereignisverarbeitung in der nativen Ebene.
sidebar:
  order: 4
  label: 'Shell, PTY & Prozess'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# Natives Shell, PTY, Prozess und Schlüssel-Interna

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

## Ebenenzuständigkeit

- **TS-Wrapper-/API-Ebene** (`packages/natives/src/*`): typisierte Einstiegspunkte, Abbruch-Oberfläche (`timeoutMs`, `AbortSignal`) und JS-Ergonomie.
- **Rust-N-API-Modulebene** (`crates/pi-natives/src/*`): Shell-/PTY-Prozessausführung, Prozessketten-Traversierung/-Beendigung und Tastensequenz-Parsing.
- **Validierungsgate** (`native.ts`, Architekturebene): stellt sicher, dass erforderliche Exporte (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, Schlüsselhilfsfunktionen) vor der Verwendung von Wrappern vorhanden sind.

## Shell-Subsystem (`shell`)

### API-Modell

Zwei Ausführungsmodi werden bereitgestellt:

1. **Einmalig** über `executeShell(options, onChunk?)`.
2. **Persistente Sitzung** über `new Shell(options?)`, dann wiederholt `shell.run(...)`.

Beide streamen die Ausgabe über einen threadsicheren Callback und geben `{ exitCode?, cancelled, timedOut }` zurück.

### Sitzungserstellung und Umgebungsmodell

Rust erstellt `brush_core::Shell` mit:

- nicht-interaktivem Modus,
- `do_not_inherit_env: true`,
- expliziter Umgebungsrekonstruktion aus der Host-Umgebung,
- Ausschlussliste für shell-sensitive Variablen (`PS1`, `PWD`, `SHLVL`, Bash-Funktionsexporte usw.).

Sitzungsumgebungsverhalten:

- `ShellOptions.sessionEnv` wird einmalig bei der Sitzungserstellung angewendet.
- `ShellRunOptions.env` ist befehlsbezogen (`EnvironmentScope::Command`) und wird nach jedem Lauf zurückgesetzt.
- `PATH` wird unter Windows mit Groß-/Kleinschreibungsunempfindlicher Deduplizierung speziell zusammengeführt.

Nur-Windows-Pfaderweiterung (`shell/windows.rs`): Gefundene Git-for-Windows-Pfade (`cmd`, `bin`, `usr/bin`) werden angehängt, sofern vorhanden und noch nicht enthalten.

### Laufzeit-Lebenszyklus und Zustandsübergänge

Die persistente Shell (`Shell.run`) verwendet diese Zustandsmaschine:

- **Leerlauf/Nicht initialisiert**: `session: None`.
- **Läuft**: der erste `run()` erstellt die Sitzung verzögert, speichert das `current_abort`-Token und führt den Befehl aus.
- **Abgeschlossen + Keepalive**: wenn der Ausführungssteuerungsfluss `Normal` ist, wird `current_abort` gelöscht und die Sitzung wiederverwendet.
- **Abgeschlossen + Beendigung**: wenn der Steuerungsfluss schleifen-/skript-/shell-exit-bezogen ist (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), wird die Sitzung verworfen (`session: None`).
- **Abgebrochen/Zeitüberschreitung**: der Lauftask wird abgebrochen, Wartezeit (2 s), dann erzwungener Abbruch; Sitzung wird verworfen.
- **Fehler**: Sitzung wird verworfen.

Die Einmal-Shell (`executeShell`) erstellt und verwirft immer eine neue Sitzung pro Aufruf.

### Streaming-/Ausgabeverhalten

- Stdout/Stderr werden in eine gemeinsame Pipe geleitet und gleichzeitig gelesen.
- Der Reader dekodiert UTF-8 inkrementell; ungültige Bytesequenzen erzeugen `U+FFFD`-Ersatzchunks.
- Nach Prozessabschluss hat der Ausgabeabfluss Leerlauf-/Maximalwächter (`250 ms` Leerlauf, `2 s` Maximum), um bei Hintergrundjobs, die Deskriptoren offen halten, kein Hängen zu verursachen.

### Abbruch, Zeitüberschreitung und Hintergrundjobs

- `CancelToken` wird aus `timeoutMs` und optionalem `AbortSignal` konstruiert.
- Bei Abbruch/Zeitüberschreitung wird das Shell-Abbruchtoken ausgelöst, dann erhält der Task ein 2-sekündiges Kulanzfenster vor dem erzwungenen Abbruch.
- Bei einem Abbruch werden Hintergrundjobs beendet (`TERM`, dann verzögertes `KILL`) unter Verwendung von Brush-Job-Metadaten.

Verhalten von `Shell.abort()`:

- bricht nur den aktuell laufenden Befehl für diese `Shell`-Instanz ab,
- ist eine erfolgreiche No-Operation, wenn nichts läuft.

### Fehlerverhalten

Häufig aufgetretene Fehler umfassen:

- Sitzungsinitialisierungsfehler (`Failed to initialize shell`),
- Arbeitsverzeichnisfehler (`Failed to set cwd`),
- Fehler beim Setzen/Zurücksetzen der Umgebung,
- Snapshot-Quellfehler,
- Fehler bei der Pipe-Erstellung/-Klonierung,
- Ausführungsfehler (`Shell execution failed: ...`),
- Task-Wrapper-Fehler (`Shell execution task failed: ...`).

Abbruchflags auf Ergebnisebene:

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
- **Reserviert**: `start()` installiert den Steuerkanal synchron (`core: Some`), bevor die asynchrone Arbeit beginnt, sodass `write/resize/kill` sofort gültig werden.
- **Läuft**: die blockierende PTY-Schleife verarbeitet Kindprozesszustand, Reader-Ereignisse, Abbruch-Heartbeat und Steuernachrichten.
- **Terminal geschlossen**: Kindprozessbeendigung + Reader-Abschluss.
- **Finalisiert**: `core` wird nach Abschluss des Start-Tasks immer auf `None` zurückgesetzt (Erfolg oder Fehler).

Gleichzeitigkeitswächter:

- Ein Start während eines laufenden Prozesses gibt `PTY session already running` zurück.

### Spawn-/Anhänge-/Schreib-/Lese-/Beendigungsmuster

- PTY wird über `portable_pty::native_pty_system().openpty(...)` geöffnet.
- Der Befehl wird aktuell als `sh -lc <command>` mit optionalen `cwd`- und Umgebungsüberschreibungen ausgeführt.
- `write()` sendet rohe Bytes an PTY-stdin.
- `resize()` klemmt Dimensionen (`cols 20..400`, `rows 5..200`) und ruft Master-Resize auf.
- `kill()` markiert den Lauf als abgebrochen und beendet den Kindprozess.

Ausgabepfad:

- ein dedizierter Reader-Thread liest den Master-Stream,
- inkrementelle UTF-8-Dekodierung mit `U+FFFD`-Ersetzung bei ungültigen Bytes,
- Chunks werden über den N-API-threadsicheren Callback weitergeleitet.

### Abbruch- und Zeitüberschreitungssemantik

- `timeoutMs` und `AbortSignal` speisen einen `CancelToken`.
- Die Schleife ruft periodisch `ct.heartbeat()` auf; ein Abbruch löst das Beenden des Kindprozesses aus.
- Die Zeitüberschreitungsklassifizierung ist zeichenfolgenbasiert (`"Timeout"`-Teilstring im Heartbeat-Fehler).

### Fehlerverhalten

Fehlerflächen umfassen:

- PTY-Zuteilungs-/Öffnungsfehler,
- PTY-Spawn-Fehler,
- Writer-/Reader-Beschaffungsfehler,
- Fehler beim Kindprozessstatus/-warten,
- Lock-Vergiftung,
- Steuerkanal-Trennung (`PTY session is no longer available`).

Steueraufruffehler bei nicht laufendem Prozess:

- `write/resize/kill` geben `PTY session is not running` zurück.

## Prozessbaum-Subsystem (`ps`)

### API-Modell

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

Der TS-Wrapper registriert außerdem die native Kill-Tree-Integration in gemeinsam genutzte Dienstprogramme über `setNativeKillTree(native.killTree)`.

### Plattformspezifische Implementierung

- **Linux**: liest rekursiv `/proc/<pid>/task/<pid>/children`.
- **macOS**: verwendet `libproc` `proc_listchildpids`.
- **Windows**: erstellt einen Snapshot der Prozesstabelle mit `CreateToolhelp32Snapshot`, baut eine Eltern-Kind-Zuordnung auf und beendet mit `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### Kill-Tree-Verhalten

- Nachkommen werden rekursiv gesammelt.
- Die Beendigungsreihenfolge ist von unten nach oben (tiefste Nachkommen zuerst), um die Neuverwaiserung zu reduzieren.
- Die Wurzel-PID wird zuletzt beendet.
- Der Rückgabewert ist die Anzahl erfolgreicher Beendigungen.

Signalverhalten:

- POSIX: das angegebene `signal` wird an `kill` übergeben.
- Windows: `signal` wird ignoriert; die Beendigung ist eine bedingungslose Prozessbeendigung.

### Fehlerverhalten

Dieses Modul wirft absichtlich keine Fehler an der API-Oberfläche:

- fehlende/nicht zugängliche Prozessbaumzweige werden übersprungen,
- Kill-Fehler pro PID werden als erfolglos gezählt (keine Fehler),
- ein Lookup-Fehlschlag ergibt typischerweise `[]` von `listDescendants` und `0` von `killTree`.

## Schlüssel-Parsing-Subsystem (`keys`)

### API-Modell

Bereitgestellte Hilfsfunktionen:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### Parsing-Modell

Der Parser kombiniert:

- direkte Einzelbyte-Zuordnungen (`enter`, `tab`, `ctrl+<letter>`, druckbares ASCII),
- O(1)-Legacy-Escape-Sequenz-Lookup (PHF-Map),
- xterm-`modifyOtherKeys`-Parsing,
- Kitty-Protokoll-Parsing (`CSI u`, `CSI ~`, `CSI 1;...<letter>`),
- Normalisierung zu Schlüssel-IDs (`ctrl+c`, `shift+tab`, `pageUp`, `f5` usw.).

Modifikatorverarbeitung:

- beim Schlüsselabgleich werden nur Shift-/Alt-/Ctrl-Bits verglichen,
- Lock-Bits werden vor Vergleichen maskiert.

Layout-Verhalten:

- der Basis-Layout-Fallback ist absichtlich eingeschränkt, sodass neu zugeordnete Layouts keine falschen Übereinstimmungen für ASCII-Buchstaben/-Symbole erzeugen.

### Fehlerverhalten

- Nicht erkannte oder ungültige Sequenzen erzeugen `null` aus Parse-Funktionen.
- Match-Funktionen geben `false` bei Parse-Fehler oder Nichtübereinstimmung zurück.
- Für fehlerhafte Tasteneingaben wird keine Fehlerausnahme ausgelöst.

## JS-Wrapper-API ↔ Rust-Export-Zuordnung

### Shell + PTY + Prozess

| TS-Wrapper-API | Rust-N-API-Export | Hinweise |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | Einmalige Shell-Ausführung |
| `new Shell(options?)` | `Shell`-Klasse | Persistente Shell-Sitzung |
| `shell.run(options, onChunk?)` | `Shell::run` | Wiederverwendet Sitzung bei Keepalive-Steuerungsfluss |
| `shell.abort()` | `Shell::abort` | Bricht aktiven Lauf für diese Shell-Instanz ab |
| `new PtySession()` | `PtySession`-Klasse | Zustandsbehaftete PTY-Sitzung |
| `pty.start(options, onChunk?)` | `PtySession::start` | Interaktiver PTY-Lauf |
| `pty.write(data)` | `PtySession::write` | Rohe stdin-Weiterleitung |
| `pty.resize(cols, rows)` | `PtySession::resize` | Geklemmte Terminaldimensionen |
| `pty.kill()` | `PtySession::kill` | Beendet erzwungen den aktiven PTY-Kindprozess |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | Prozessbaum-Beendigung mit Kindern zuerst |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | Rekursive Nachkommenauflistung |

### Schlüssel

| TS-Wrapper-API | Rust-N-API-Export | Hinweise |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Kitty-Codepunkt+Modifikator-Abgleich |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Normalisierter Schlüssel-ID-Parser |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | Exakter Legacy-Sequenz-Map-Abgleich |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | Strukturiertes Kitty-Parse-Ergebnis |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | Übergeordneter Schlüsselabgleicher |

## Aufgegebene Sitzungsbereinigung und Finalisierungshinweise

- **Persistente Shell-Sitzung**: wenn ein Lauf abgebrochen wurde, eine Zeitüberschreitung aufgetreten ist, Fehler aufgetreten sind oder kein Keepalive-Steuerungsfluss vorliegt, verwirft Rust explizit den internen Sitzungszustand. Erfolgreiche normale Läufe behalten die Sitzung zur Wiederverwendung bei.
- **PTY-Sitzung**: `core` wird nach Abschluss von `start()` immer gelöscht, einschließlich Fehlerpfade.
- **Es ist kein expliziter JS-Finalizer-gesteuerter Kill-Vertrag** durch Wrapper freigelegt; die Bereinigung ist primär an Laufabschluss-/Abbruchpfade gebunden. Aufrufer sollten `timeoutMs`, `AbortSignal`, `shell.abort()` oder `pty.kill()` für eine deterministische Beendigung verwenden.
