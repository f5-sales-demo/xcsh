---
title: 'Natives Shell-, PTY-, Prozess- und Tastatur-Interna'
description: >-
  Shell-Ausführung, PTY-Verwaltung, Prozesslebenszyklus und
  Tastaturereignisverarbeitung in der nativen Schicht.
sidebar:
  order: 4
  label: 'Shell, PTY & Prozess'
i18n:
  sourceHash: 00ea95614c6a
  translator: machine
---

# Natives Shell-, PTY-, Prozess- und Tastatur-Interna

Dieses Dokument behandelt die **Ausführungs-/Prozess-/Terminal-Primitive** in `@f5-sales-demo/pi-natives`: `shell`, `pty`, `ps` und `keys`, unter Verwendung der Architekturbegriffe aus `docs/natives-architecture.md`.

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

## Schichtzuständigkeit

- **TS-Wrapper-/API-Schicht** (`packages/natives/src/*`): typisierte Einstiegspunkte, Abbruchoberfläche (`timeoutMs`, `AbortSignal`) und JS-Ergonomie.
- **Rust-N-API-Modulschicht** (`crates/pi-natives/src/*`): Shell-/PTY-Prozessausführung, Prozessbaum-Traversierung/-Beendigung und Tastensequenz-Analyse.
- **Validierungs-Gate** (`native.ts`, Architekturebene): stellt sicher, dass erforderliche Exporte (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, Schlüsselhilfsfunktionen) vorhanden sind, bevor Wrapper verwendet werden.

## Shell-Subsystem (`shell`)

### API-Modell

Zwei Ausführungsmodi werden bereitgestellt:

1. **Einmalig** über `executeShell(options, onChunk?)`.
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
- `ShellRunOptions.env` ist befehlsbezogen (`EnvironmentScope::Command`) und wird nach jedem Lauf zurückgesetzt.
- `PATH` wird unter Windows speziell mit Groß-/Kleinschreibungs-unempfindlicher Deduplizierung zusammengeführt.

Nur-Windows-Pfaderweiterung (`shell/windows.rs`): Erkannte Git-for-Windows-Pfade (`cmd`, `bin`, `usr/bin`) werden angehängt, sofern vorhanden und noch nicht enthalten.

### Laufzeit-Lebenszyklus und Zustandsübergänge

Die persistente Shell (`Shell.run`) verwendet diese Zustandsmaschine:

- **Inaktiv/Nicht initialisiert**: `session: None`.
- **Laufend**: das erste `run()` erstellt die Sitzung verzögert, speichert das `current_abort`-Token und führt den Befehl aus.
- **Abgeschlossen + Keepalive**: wenn der Ausführungssteuerungsfluss `Normal` ist, wird `current_abort` gelöscht und die Sitzung wiederverwendet.
- **Abgeschlossen + Abbau**: wenn der Steuerungsfluss schleifen-/skript-/shell-exit-bezogen ist (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), wird die Sitzung verworfen (`session: None`).
- **Abgebrochen/Zeitüberschreitung**: Der Lauf-Task wird abgebrochen, Wartezeit (2 s), dann erzwungener Abbruch; Sitzung wird verworfen.
- **Fehler**: Sitzung wird verworfen.

Die einmalige Shell (`executeShell`) erstellt und verwirft bei jedem Aufruf immer eine neue Sitzung.

### Streaming-/Ausgabeverhalten

- Stdout/Stderr werden in eine gemeinsame Pipe geleitet und gleichzeitig gelesen.
- Der Leseprozess dekodiert UTF-8 inkrementell; ungültige Bytesequenzen erzeugen `U+FFFD`-Ersatz-Chunks.
- Nach Abschluss des Prozesses hat der Ausgabe-Drain Leerlauf-/Maximumsbeschränkungen (`250 ms` Leerlauf, `2 s` Maximum), um ein Hängenbleiben bei Hintergrundjobs zu vermeiden, die Dateideskriptoren offenhalten.

### Abbruch, Zeitüberschreitung und Hintergrundjobs

- `CancelToken` wird aus `timeoutMs` und einem optionalen `AbortSignal` konstruiert.
- Bei Abbruch/Zeitüberschreitung wird der Shell-Abbruch-Token ausgelöst, anschließend erhält der Task ein 2-s-Zeitfenster für einen geordneten Abbruch, bevor ein erzwungener Abbruch erfolgt.
- Bei einem Abbruch werden Hintergrundjobs beendet (`TERM`, dann verzögertes `KILL`) unter Verwendung von Brush-Job-Metadaten.

Verhalten von `Shell.abort()`:

- bricht nur den aktuell laufenden Befehl für diese `Shell`-Instanz ab,
- ist eine erfolgreiche Nulloperation, wenn nichts ausgeführt wird.

### Fehlerverhalten

Häufig auftretende Fehler umfassen:

- Sitzungsinitialisierungsfehler (`Failed to initialize shell`),
- Arbeitsverzeichnisfehler (`Failed to set cwd`),
- Fehler beim Setzen/Zurücksetzen der Umgebung,
- Snapshot-Quellfehler,
- Fehler beim Erstellen/Klonen von Pipes,
- Ausführungsfehler (`Shell execution failed: ...`),
- Task-Wrapper-Fehler (`Shell execution task failed: ...`).

Ergebnisebene der Abbruch-Flags:

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

- **Inaktiv**: `core: None`.
- **Reserviert**: `start()` installiert den Steuerkanal synchron (`core: Some`), bevor die asynchrone Arbeit beginnt, sodass `write/resize/kill` sofort gültig werden.
- **Laufend**: Die blockierende PTY-Schleife verarbeitet den Kindprozesszustand, Leseereignisse, Abbruch-Heartbeat und Steuernachrichten.
- **Terminal geschlossen**: Kindprozess-Exit + Leseabschluss.
- **Abgeschlossen**: `core` wird nach Abschluss des Start-Tasks immer auf `None` zurückgesetzt (Erfolg oder Fehler).

Nebenläufigkeits-Guard:

- Ein Start während bereits ausgeführter Sitzung gibt `PTY session already running` zurück.

### Spawn-/Anhänge-/Schreib-/Lese-/Beendigungsmuster

- PTY wird über `portable_pty::native_pty_system().openpty(...)` geöffnet.
- Befehle werden derzeit als `sh -lc <command>` mit optionalem `cwd` und Umgebungsüberschreibungen ausgeführt.
- `write()` sendet rohe Bytes an PTY-Stdin.
- `resize()` begrenzt Dimensionen (`cols 20..400`, `rows 5..200`) und ruft die Master-Größenänderung auf.
- `kill()` markiert den Lauf als abgebrochen und beendet den Kindprozess.

Ausgabepfad:

- ein dedizierter Leser-Thread liest den Master-Stream,
- inkrementelle UTF-8-Dekodierung mit `U+FFFD`-Ersatz bei ungültigen Bytes,
- Chunks werden über den N-API-Threadsafe-Callback weitergeleitet.

### Abbruch- und Zeitüberschreitungssemantik

- `timeoutMs` und `AbortSignal` speisen einen `CancelToken`.
- Die Schleife ruft periodisch `ct.heartbeat()` auf; der Abbruch löst das Beenden des Kindprozesses aus.
- Die Zeitüberschreitungsklassifizierung ist zeichenkettenbasiert (Teilstring `"Timeout"` im Heartbeat-Fehler).

### Fehlerverhalten

Fehlerfälle umfassen:

- PTY-Zuweisungs-/Öffnungsfehler,
- PTY-Spawn-Fehler,
- Fehler beim Erwerb von Writer/Reader,
- Fehler beim Kindprozessstatus/-warten,
- Lock-Vergiftung,
- Steuerkanal-Trennung (`PTY session is no longer available`).

Steueraufruf-Fehler bei nicht laufender Sitzung:

- `write/resize/kill` geben `PTY session is not running` zurück.

## Prozessbaum-Subsystem (`ps`)

### API-Modell

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

Der TS-Wrapper registriert außerdem die native Kill-Tree-Integration in gemeinsame Dienstprogramme über `setNativeKillTree(native.killTree)`.

### Plattformspezifische Implementierung

- **Linux**: liest rekursiv `/proc/<pid>/task/<pid>/children`.
- **macOS**: verwendet `libproc` `proc_listchildpids`.
- **Windows**: erstellt einen Snapshot der Prozesstabelle mit `CreateToolhelp32Snapshot`, baut eine Eltern->Kinder-Zuordnung auf und beendet mit `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### Kill-Tree-Verhalten

- Nachkommen werden rekursiv gesammelt.
- Die Beendigungsreihenfolge ist bottom-up (tiefste Nachkommen zuerst), um Neu-Elternschaft von Waisen zu reduzieren.
- Der Root-PID wird zuletzt beendet.
- Der Rückgabewert ist die Anzahl erfolgreicher Beendigungen.

Signalverhalten:

- POSIX: Das angegebene `signal` wird an `kill` übergeben.
- Windows: `signal` wird ignoriert; die Beendigung ist eine bedingungslose Prozessbeendigung.

### Fehlerverhalten

Dieses Modul wirft absichtlich keine Fehler auf der API-Oberfläche:

- fehlende/nicht zugängliche Prozessbaumzweige werden übersprungen,
- Kill-Fehler pro PID werden als erfolglos gezählt (keine Fehler),
- ein Nachschlage-Fehltreffer liefert typischerweise `[]` von `listDescendants` und `0` von `killTree`.

## Tastaturanalyse-Subsystem (`keys`)

### API-Modell

Bereitgestellte Hilfsfunktionen:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### Analysemodell

Der Parser kombiniert:

- direkte Einzelbyte-Zuordnungen (`enter`, `tab`, `ctrl+<Buchstabe>`, druckbares ASCII),
- O(1)-Legacy-Escape-Sequenz-Nachschlagen (PHF-Map),
- xterm-`modifyOtherKeys`-Analyse,
- Kitty-Protokoll-Analyse (`CSI u`, `CSI ~`, `CSI 1;...<Buchstabe>`),
- Normalisierung zu Tasten-IDs (`ctrl+c`, `shift+tab`, `pageUp`, `f5` usw.).

Modifikatorverarbeitung:

- Nur Shift-/Alt-/Ctrl-Bits werden für den Tastenabgleich verglichen,
- Lock-Bits werden vor dem Vergleich maskiert.

Layout-Verhalten:

- Der Basis-Layout-Fallback ist absichtlich eingeschränkt, sodass remappte Layouts keine falschen Übereinstimmungen für ASCII-Buchstaben/-Symbole erzeugen.

### Fehlerverhalten

- Nicht erkannte oder ungültige Sequenzen erzeugen `null` aus Parse-Funktionen.
- Abgleichsfunktionen geben `false` bei Parse-Fehler oder Nichtübereinstimmung zurück.
- Kein geworfener Fehler für fehlerhafte Tastatureingaben.

## JS-Wrapper-API ↔ Rust-Export-Zuordnung

### Shell + PTY + Prozess

| TS-Wrapper-API | Rust-N-API-Export | Hinweise |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | Einmalige Shell-Ausführung |
| `new Shell(options?)` | `Shell`-Klasse | Persistente Shell-Sitzung |
| `shell.run(options, onChunk?)` | `Shell::run` | Sitzung bei Keepalive-Steuerungsfluss wiederverwenden |
| `shell.abort()` | `Shell::abort` | Bricht aktiven Lauf für diese Shell-Instanz ab |
| `new PtySession()` | `PtySession`-Klasse | Zustandsbehaftete PTY-Sitzung |
| `pty.start(options, onChunk?)` | `PtySession::start` | Interaktiver PTY-Lauf |
| `pty.write(data)` | `PtySession::write` | Rohe Stdin-Weiterleitung |
| `pty.resize(cols, rows)` | `PtySession::resize` | Begrenzte Terminaldimensionen |
| `pty.kill()` | `PtySession::kill` | Erzwingt die Beendigung des aktiven PTY-Kindprozesses |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | Kindprozesse-zuerst-Prozessbaum-Beendigung |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | Rekursive Nachkommenauflistung |

### Tasten

| TS-Wrapper-API | Rust-N-API-Export | Hinweise |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Kitty-Codepoint+Modifikator-Abgleich |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Normalisierter Tasten-ID-Parser |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | Exakte Legacy-Sequenz-Map-Prüfung |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | Strukturiertes Kitty-Parse-Ergebnis |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | High-Level-Tastenabgleich |

## Bereinigung verlassener Sitzungen und Finalisierungshinweise

- **Persistente Shell-Sitzung**: Wenn ein Lauf abgebrochen/durch Zeitüberschreitung beendet/fehlergeschlagen/ohne Keepalive-Steuerungsfluss ist, verwirft Rust explizit den internen Sitzungszustand. Erfolgreiche normale Läufe behalten die Sitzung zur Wiederverwendung.
- **PTY-Sitzung**: `core` wird immer nach Abschluss von `start()` gelöscht, einschließlich Fehlerpfade.
- **Kein expliziter JS-Finalizer-gesteuerter Kill-Vertrag** wird durch Wrapper bereitgestellt; die Bereinigung ist primär an Laufabschluss-/Abbruchpfade gebunden. Aufrufer sollten `timeoutMs`, `AbortSignal`, `shell.abort()` oder `pty.kill()` für einen deterministischen Abbau verwenden.
