---
title: Native Rust-Taskausführung und -Abbruch
description: >-
  Rust-Async-Taskausführungsmodell mit kooperativem Abbruch und
  Bereinigungssemantik.
sidebar:
  order: 5
  label: Taskabbruch
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# Native Rust-Taskausführung und -Abbruch (`pi-natives`)

Dieses Dokument beschreibt, wie `crates/pi-natives` native Arbeit einplant und wie Abbrüche von JS-Optionen (`timeoutMs`, `AbortSignal`) zur Rust-Ausführung fließen.

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

`task.rs` definiert drei Kernbestandteile:

1. `task::blocking(tag, cancel_token, work)`
   - Wrapping von `napi::AsyncTask` / `Task`.
   - `compute()` läuft auf libuv-Worker-Threads (für CPU-gebundene oder blockierende/synchrone Systemaufrufe).
   - Gibt ein JS `Promise<T>` zurück.

2. `task::future(env, tag, work)`
   - Wrapping von `env.spawn_future(...)`.
   - Führt asynchrone Arbeit auf der Tokio-Runtime aus.
   - Gibt `PromiseRaw<'env, T>` zurück.

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` kombiniert Deadline + optionales `AbortSignal`.
   - `CancelToken::heartbeat()` ist kooperativer Abbruch für blockierende Schleifen.
   - `CancelToken::wait()` ist asynchrones Abbruch-Warten (`Signal` / `Timeout` / `User` Strg-C).
   - `AbortToken` ermöglicht es externem Code, einen Abbruch anzufordern (`abort(reason)`).

## `blocking` vs `future`: Ausführungsmodell und Auswahl

### `task::blocking` verwenden

Verwenden, wenn die Arbeit CPU-intensiv oder grundsätzlich synchron/blockierend ist:

- Regex-/Dateisuche (`grep`, `glob`, `fuzzy_find`)
- Synchrone PTY-Schleifeninterna (`run_pty_sync` über `spawn_blocking`)
- Zwischenablage-/Bild-/HTML-Konvertierungen

Verhalten:

- Der Arbeits-Closure erhält einen geklonten `CancelToken`.
- Abbruch wird nur dort beobachtet, wo der Code `ct.heartbeat()?` prüft.
- Closure `Err(...)` lehnt das JS-Promise ab.

### `task::future` verwenden

Verwenden, wenn die Arbeit asynchrone Operationen `await`en muss:

- Shell-Session-Orchestrierung (`shell.run`, `executeShell`)
- Task-Racing (`tokio::select!`) zwischen Abschluss und Abbruch

Verhalten:

- Der Future kann normalen Abschluss gegen `ct.wait()` racen.
- Auf dem Abbruchpfad propagieren asynchrone Implementierungen den Abbruch typischerweise an innere Subsysteme (z.B. `tokio_util::CancellationToken`) und erzwingen optional einen Abbruch nach Ablauf der Toleranzzeit.

## JS-API ↔ Rust-Export-Zuordnung (task-/abbruchrelevant)

| JS-seitige API | Rust-Export (`#[napi]`) | Scheduler | Abbruch-Anbindung |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` in Filterschleife |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` in Bewertungsschleife |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` wird gegen Run-Task geracet; Brücke zu Tokio `CancellationToken` |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | wie oben |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + inneres `spawn_blocking` | `CancelToken` wird in synchroner PTY-Schleife über `heartbeat()` geprüft |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | keiner (`()` Token) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | keiner (`()` Token) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | keiner (`()` Token) |

`text.rs` und `ps.rs` verwenden derzeit weder `task::blocking` noch `task::future` und nehmen daher nicht an diesem Abbruchpfad teil.

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
  - `task::future`-Nutzer, die auf `ct.wait()` racen, können den Abbruch sofort auflösen, sobald sie `select!` betreten.
  - `task::blocking`-Nutzer beobachten den Abbruch nur, wenn der Closure-Code `heartbeat()` erreicht. Wenn der Closure nicht frühzeitig heartbeatet, verzögert sich der Abbruch.

- **Während der Ausführung**:
  - `blocking`: nächster `heartbeat()` gibt `Err("Aborted: ...")` zurück.
  - `future`: `ct.wait()`-Branch gewinnt `select!`, dann bricht der Code untergeordnete asynchrone Mechanismen ab (für Shell: bricht Tokio-Token ab, wartet bis zu 2s, dann erzwingt Task-Abbruch).

## Heartbeat-Erwartungen für lang laufende Schleifen

`heartbeat()` muss in vorhersehbarer Kadenz in Schleifen mit unbegrenzten oder großen Arbeitsmengen laufen.

Beobachtete Muster:

- `glob::filter_entries`: Prüfung jedes Eintrags vor Filterung/Matching.
- `fd::score_entries`: Prüfung jedes gescannten Kandidaten.
- `grep_sync`: explizite Abbruchprüfung vor der aufwändigen Suchphase, plus fs-Cache-Aufrufe, die ebenfalls den Token erhalten.
- `run_pty_sync`: Prüfung bei jedem Schleifentakt (~16ms Sleep-Kadenz) und Beenden des Kindprozesses bei Abbruch.

Praktische Regel: Keine Schleife über extern dimensionierte Eingaben sollte ein kurzes begrenztes Intervall ohne Heartbeat überschreiten.

## Fehlerverhalten und Fehlerpropagation zu JS

### Blockierende Tasks

Fehlerpfad:

1. Closure gibt `Err(napi::Error)` zurück (einschließlich `heartbeat()`-Abbruch).
2. `Task::compute()` gibt `Err` zurück.
3. `AsyncTask` lehnt das JS-Promise ab.

Typische Fehlerzeichenketten:

- `Aborted: Timeout`
- `Aborted: Signal`
- Domänenfehler (`Failed to decode image: ...`, `Conversion error: ...`, etc.)

### Future-Tasks

Fehlerpfad:

1. Der asynchrone Body gibt `Err(napi::Error)` zurück oder ein Join-Fehler wird gemappt (`... task failed: {err}`).
2. Das von `task::future` erzeugte Promise wird abgelehnt.
3. Einige APIs geben absichtlich strukturierte Abbruchergebnisse anstelle einer Ablehnung zurück (`ShellRunResult`/`ShellExecuteResult` mit `cancelled`/`timed_out`-Flags und `exit_code: None`).

### Aufteilung der Abbruchmeldung

- **Abbruch als Fehler**: Die meisten blockierenden Exports, die `heartbeat()?` verwenden.
- **Abbruch als typisiertes Ergebnis**: Shell-/PTY-artige Kommando-APIs, die Abbruch in Ergebnis-Structs modellieren.

Wählen Sie ein Modell pro API und dokumentieren Sie es explizit.

## Häufige Fallstricke

1. **Fehlender Heartbeat in blockierenden Schleifen**
   - Symptom: Timeout/Signal scheint ignoriert zu werden, bis die Schleife endet.
   - Lösung: `ct.heartbeat()?` am Schleifenanfang und vor aufwändigen Schritten pro Element hinzufügen.

2. **Lange nicht abbrechbare Abschnitte**
   - Symptom: Abbruchlatenz-Spitzen während eines einzelnen großen Aufrufs (Dekodierung, Sortierung, Komprimierung, etc.).
   - Lösung: Arbeit in Chunks mit Heartbeat-Grenzen aufteilen; wenn unmöglich, Latenz dokumentieren.

3. **Blockierung des Async-Executors**
   - Symptom: Asynchrone API blockiert, wenn synchron-lastiger Code direkt im Future läuft.
   - Lösung: CPU-/synchrone Blöcke in `task::blocking` oder `tokio::task::spawn_blocking` verschieben.

4. **Inkonsistente Abbruchsemantik**
   - Symptom: Eine API lehnt bei Abbruch ab, eine andere löst mit Flags auf – verwirrend für Aufrufer.
   - Lösung: Pro Domäne standardisieren und Wrapper-Dokumentation abgleichen.

5. **Vergessene Abbruchbrücke bei verschachtelten asynchronen Tasks**
   - Symptom: Äußerer Token wird abgebrochen, aber innere Reader-/Subprozess-Tasks laufen weiter.
   - Lösung: Abbruch an inneren Token/Signal brücken und Toleranzzeit + erzwungenen Abbruch als Fallback durchsetzen.

## Checkliste für neue abbrechbare Exports

1. Arbeit korrekt klassifizieren:
   - CPU-gebunden oder synchron blockierend -> `task::blocking`
   - Asynchrone I/O / `await`-Orchestrierung -> `task::future`

2. Abbruch-Eingaben bei Bedarf bereitstellen:
   - `timeoutMs` und `signal` in `#[napi(object)]`-Optionen aufnehmen
   - `let ct = task::CancelToken::new(timeout_ms, signal);` erstellen

3. Abbruch durch alle Schichten verdrahten:
   - Blockierende Schleifen: `ct.heartbeat()?` in stabilen Intervallen
   - Asynchrone Orchestrierung: Race mit `ct.wait()` und Sub-Tasks/Tokens abbrechen

4. Abbruchvertrag festlegen:
   - Promise mit Abbruchfehler ablehnen, oder
   - Typisiertes `{ cancelled, timedOut, ... }` auflösen
   - Diesen Vertrag konsistent für die API-Familie halten

5. Fehler mit Kontext propagieren:
   - Fehler über `Error::from_reason(format!("...: {err}"))` mappen
   - Phasenspezifische Präfixe einschließen (`spawn`, `decode`, `wait`, etc.)

6. Abbruch vor dem Start und während der Ausführung behandeln:
   - Abbruchprüfung/Await muss vor dem aufwändigen Body und während langer Ausführung erfolgen

7. Keine Executor-Missbrauch validieren:
   - Keine langen synchronen Arbeiten direkt in asynchronen Futures ohne `spawn_blocking`/blockierenden Task-Wrapper
