---
title: Native Rust-Aufgabenausführung und Abbruch
description: >-
  Rust async-Aufgabenausführungsmodell mit kooperativem Abbruch und
  Bereinigungssemantik.
sidebar:
  order: 5
  label: Aufgabenabbruch
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# Native Rust-Aufgabenausführung und Abbruch (`pi-natives`)

Dieses Dokument beschreibt, wie `crates/pi-natives` native Arbeit plant und wie der Abbruch von JS-Optionen (`timeoutMs`, `AbortSignal`) zur Rust-Ausführung fließt.

## Implementierungsdateien

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

## Kernprimitive (`task.rs`)

`task.rs` definiert drei Kernelemente:

1. `task::blocking(tag, cancel_token, work)`
   - Kapselt `napi::AsyncTask` / `Task`.
   - `compute()` läuft auf libuv-Worker-Threads (für CPU-intensive oder blockierende/synchrone Systemaufrufe).
   - Gibt ein JS `Promise<T>` zurück.

2. `task::future(env, tag, work)`
   - Kapselt `env.spawn_future(...)`.
   - Führt asynchrone Arbeit auf der Tokio-Laufzeitumgebung aus.
   - Gibt `PromiseRaw<'env, T>` zurück.

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` kombiniert Deadline und optionales `AbortSignal`.
   - `CancelToken::heartbeat()` ist kooperativer Abbruch für blockierende Schleifen.
   - `CancelToken::wait()` ist asynchrones Abbruch-Warten (`Signal` / `Timeout` / `User` Ctrl-C).
   - `AbortToken` erlaubt externem Code, einen Abbruch anzufordern (`abort(reason)`).

## `blocking` vs. `future`: Ausführungsmodell und Auswahl

### `task::blocking` verwenden

Verwenden, wenn die Arbeit CPU-intensiv oder grundlegend synchron/blockierend ist:

- Regex-/Datei-Scanning (`grep`, `glob`, `fuzzy_find`)
- synchrone interne PTY-Schleifen (`run_pty_sync` über `spawn_blocking`)
- Clipboard-/Image-/HTML-Konvertierungen

Verhalten:

- Die Arbeitsclosure erhält einen geklonten `CancelToken`.
- Abbruch wird nur dort beobachtet, wo Code `ct.heartbeat()?` prüft.
- `Err(...)` der Closure lehnt das JS-Promise ab.

### `task::future` verwenden

Verwenden, wenn die Arbeit asynchrone Operationen `await`en muss:

- Shell-Session-Orchestrierung (`shell.run`, `executeShell`)
- Aufgaben-Racing (`tokio::select!`) zwischen Abschluss und Abbruch

Verhalten:

- Future kann normalen Abschluss gegen `ct.wait()` abwägen.
- Beim Abbruchpfad propagieren asynchrone Implementierungen den Abbruch typischerweise an innere Subsysteme (z. B. `tokio_util::CancellationToken`) und erzwingen optional einen Abbruch nach Ablauf der Nachfrist.

## JS-API ↔ Rust-Export-Zuordnung (aufgaben-/abbruchrelevant)

| JS-seitige API | Rust-Export (`#[napi]`) | Scheduler | Abbruch-Verknüpfung |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` in der Filterschleife |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` in der Bewertungsschleife |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` gegen Ausführungsaufgabe abgewogen; überbrückt zu Tokio `CancellationToken` |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | wie oben |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + inneres `spawn_blocking` | `CancelToken` in synchroner PTY-Schleife via `heartbeat()` geprüft |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | keiner (`()` Token) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | keiner (`()` Token) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | keiner (`()` Token) |

`text.rs` und `ps.rs` verwenden derzeit keine `task::blocking`/`task::future` und nehmen daher nicht an diesem Abbruchpfad teil.

## Abbruch-Lebenszyklus und Zustandsübergänge

### `CancelToken`-Lebenszyklus

`CancelToken` ist kooperativ und zustandsbehaftet:

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

### Abbruch vor dem Start vs. während der Ausführung

- **Vor dem Start / vor der ersten Abbruchprüfung**:
  - `task::future`-Nutzer, die auf `ct.wait()` warten, können den Abbruch sofort auflösen, sobald sie `select!` betreten.
  - `task::blocking`-Nutzer beobachten den Abbruch nur, wenn der Closure-Code `heartbeat()` erreicht. Wenn die Closure nicht frühzeitig einen Heartbeat sendet, wird der Abbruch verzögert.

- **Während der Ausführung**:
  - `blocking`: das nächste `heartbeat()` gibt `Err("Aborted: ...")` zurück.
  - `future`: der `ct.wait()`-Zweig gewinnt `select!`, dann bricht der Code untergeordnete asynchrone Mechanismen ab (bei Shell: bricht Tokio-Token ab, wartet bis zu 2 Sekunden, dann wird die Aufgabe abgebrochen).

## Heartbeat-Erwartungen für lang laufende Schleifen

`heartbeat()` muss in Schleifen mit unbegrenzten oder großen Arbeitsmengen mit vorhersehbarem Takt laufen.

Beobachtete Muster:

- `glob::filter_entries`: jeden Eintrag vor dem Filtern/Abgleichen prüfen.
- `fd::score_entries`: jeden gescannten Kandidaten prüfen.
- `grep_sync`: explizite Abbruchprüfung vor der intensiven Suchphase, plus fs-Cache-Aufrufe, die ebenfalls den Token erhalten.
- `run_pty_sync`: jeden Schleifendurchlauf prüfen (~16ms Schlaf-Takt) und Kind-Prozess beim Abbruch beenden.

Praktische Regel: Keine Schleife über extern dimensionierte Eingaben sollte ein kurzes begrenztes Intervall ohne Heartbeat überschreiten.

## Fehlerverhalten und Fehlerweiterleitung an JS

### Blockierende Aufgaben

Fehlerpfad:

1. Closure gibt `Err(napi::Error)` zurück (einschließlich `heartbeat()`-Abbruch).
2. `Task::compute()` gibt `Err` zurück.
3. `AsyncTask` lehnt das JS-Promise ab.

Typische Fehlerzeichenketten:

- `Aborted: Timeout`
- `Aborted: Signal`
- Domänenfehler (`Failed to decode image: ...`, `Conversion error: ...`, usw.)

### Asynchrone Aufgaben

Fehlerpfad:

1. Der asynchrone Rumpf gibt `Err(napi::Error)` zurück oder ein Join-Fehler wird abgebildet (`... task failed: {err}`).
2. Das von `task::future` erzeugte Promise wird abgelehnt.
3. Einige APIs geben absichtlich strukturierte Abbruchergebnisse anstelle einer Ablehnung zurück (`ShellRunResult`/`ShellExecuteResult` mit `cancelled`/`timed_out`-Flags und `exit_code: None`).

### Aufteilung der Abbruchmeldung

- **Abbruch als Fehler**: die meisten blockierenden Exporte, die `heartbeat()?` verwenden.
- **Abbruch als typisiertes Ergebnis**: Shell-/PTY-artige Befehls-APIs, die den Abbruch in Ergebnisstrukturen modellieren.

Wählen Sie ein Modell pro API und dokumentieren Sie es explizit.

## Häufige Fallstricke

1. **Fehlender Heartbeat in blockierenden Schleifen**
   - Symptom: Timeout/Signal erscheint ignoriert, bis die Schleife endet.
   - Lösung: `ct.heartbeat()?` am Schleifenanfang und vor teuren Schritten pro Element hinzufügen.

2. **Lange nicht abbrechbare Abschnitte**
   - Symptom: Abbruch-Latenz steigt bei einem einzelnen großen Aufruf (Dekodierung, Sortierung, Komprimierung usw.).
   - Lösung: Arbeit in Blöcke mit Heartbeat-Grenzen aufteilen; wenn unmöglich, Latenz dokumentieren.

3. **Blockierender asynchroner Ausführer**
   - Symptom: Asynchrone API stockt, wenn synchron-intensiver Code direkt in einem Future läuft.
   - Lösung: CPU-/Sync-Blöcke nach `task::blocking` oder `tokio::task::spawn_blocking` verschieben.

4. **Inkonsistente Abbruchsemantik**
   - Symptom: Eine API lehnt beim Abbruch ab, eine andere löst mit Flags auf, was Aufrufer verwirrt.
   - Lösung: Pro Domäne standardisieren und Wrapper-Dokumentation konsistent halten.

5. **Vergessene Abbruch-Überbrückung in verschachtelten asynchronen Aufgaben**
   - Symptom: Äußerer Token wird abgebrochen, aber innere Reader-/Teilprozess-Aufgaben laufen weiter.
   - Lösung: Abbruch auf inneren Token/Signal überbrücken und Nachfrist-Timeout sowie erzwungenen Abbruch als Fallback durchsetzen.

## Checkliste für neue abbrechbare Exporte

1. Arbeit korrekt klassifizieren:
   - CPU-intensiv oder synchron blockierend -> `task::blocking`
   - Asynchrone I/O / `await`-Orchestrierung -> `task::future`

2. Abbrucheingaben bei Bedarf bereitstellen:
   - `timeoutMs` und `signal` in `#[napi(object)]`-Optionen aufnehmen
   - `let ct = task::CancelToken::new(timeout_ms, signal);` erstellen

3. Abbruch durch alle Schichten hindurchführen:
   - Blockierende Schleifen: `ct.heartbeat()?` in stabilen Intervallen
   - Asynchrone Orchestrierung: mit `ct.wait()` abwägen und Teilaufgaben/-Token abbrechen

4. Abbruchvertrag festlegen:
   - Promise mit Abbruchfehler ablehnen, oder
   - typisiertes `{ cancelled, timedOut, ... }` auflösen
   - diesen Vertrag für die API-Familie konsistent halten

5. Fehler mit Kontext weitergeben:
   - Fehler über `Error::from_reason(format!("...: {err}"))` abbilden
   - stufenspezifische Präfixe einschließen (`spawn`, `decode`, `wait`, usw.)

6. Abbruch vor dem Start und während der Ausführung behandeln:
   - Abbruchprüfung/-warten muss vor dem teuren Rumpf und während langer Ausführung stattfinden

7. Keine fehlerhafte Verwendung des Ausführers sicherstellen:
   - keine lange synchrone Arbeit direkt innerhalb asynchroner Futures ohne `spawn_blocking`/blockierende Aufgaben-Kapselung
