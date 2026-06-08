---
title: Native Rust Task-Ausführung und -Abbruch
description: >-
  Rust-Async-Task-Ausführungsmodell mit kooperativem Abbruch und
  Bereinigungssemantik.
sidebar:
  order: 5
  label: Task-Abbruch
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# Native Rust-Task-Ausführung und -Abbruch (`pi-natives`)

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

`task.rs` definiert drei Kernbestandteile:

1. `task::blocking(tag, cancel_token, work)`
   - Kapselt `napi::AsyncTask` / `Task`.
   - `compute()` läuft auf libuv-Worker-Threads (für CPU-gebundene oder blockierende/synchrone Systemaufrufe).
   - Gibt ein JS `Promise<T>` zurück.

2. `task::future(env, tag, work)`
   - Kapselt `env.spawn_future(...)`.
   - Führt asynchrone Arbeit auf der Tokio-Runtime aus.
   - Gibt `PromiseRaw<'env, T>` zurück.

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` kombiniert Deadline + optionales `AbortSignal`.
   - `CancelToken::heartbeat()` ist kooperativer Abbruch für blockierende Schleifen.
   - `CancelToken::wait()` ist asynchrones Abbruch-Warten (`Signal` / `Timeout` / `User` Strg-C).
   - `AbortToken` ermöglicht externem Code, einen Abbruch anzufordern (`abort(reason)`).

## `blocking` vs `future`: Ausführungsmodell und Auswahl

### Verwenden Sie `task::blocking`

Verwenden Sie dies, wenn die Arbeit CPU-intensiv oder grundlegend synchron/blockierend ist:

- Regex-/Dateiscanning (`grep`, `glob`, `fuzzy_find`)
- Synchrone PTY-Schleifeninterna (`run_pty_sync` über `spawn_blocking`)
- Clipboard-/Bild-/HTML-Konvertierungen

Verhalten:

- Die Arbeits-Closure erhält ein geklontes `CancelToken`.
- Der Abbruch wird nur dort beobachtet, wo Code `ct.heartbeat()?` prüft.
- Closure `Err(...)` lehnt das JS-Promise ab.

### Verwenden Sie `task::future`

Verwenden Sie dies, wenn die Arbeit asynchrone Operationen mit `await` ausführen muss:

- Shell-Session-Orchestrierung (`shell.run`, `executeShell`)
- Task-Racing (`tokio::select!`) zwischen Fertigstellung und Abbruch

Verhalten:

- Der Future kann den normalen Abschluss gegen `ct.wait()` racen.
- Auf dem Abbruchpfad propagieren asynchrone Implementierungen typischerweise den Abbruch an innere Subsysteme (z.B. `tokio_util::CancellationToken`) und erzwingen optional den Abbruch nach einer Karenzzeit.

## JS-API ↔ Rust-Export-Zuordnung (Task-/Abbruch-relevant)

| JS-seitige API | Rust-Export (`#[napi]`) | Scheduler | Abbruch-Anbindung |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` in der Filter-Schleife |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` in der Bewertungsschleife |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` geracet gegen den Run-Task; Bridge zum Tokio `CancellationToken` |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | wie oben |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + inneres `spawn_blocking` | `CancelToken` in synchroner PTY-Schleife über `heartbeat()` geprüft |
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

### Abbruch vor Start vs. während der Ausführung

- **Vor dem Start / vor der ersten Abbruchprüfung**:
  - `task::future`-Nutzer, die auf `ct.wait()` racen, können den Abbruch sofort auflösen, sobald sie `select!` betreten.
  - `task::blocking`-Nutzer bemerken den Abbruch erst, wenn der Closure-Code `heartbeat()` erreicht. Wenn die Closure nicht frühzeitig einen Heartbeat durchführt, verzögert sich der Abbruch.

- **Während der Ausführung**:
  - `blocking`: Der nächste `heartbeat()`-Aufruf gibt `Err("Aborted: ...")` zurück.
  - `future`: Der `ct.wait()`-Branch gewinnt das `select!`, dann bricht der Code untergeordnete asynchrone Mechanismen ab (für Shell: bricht Tokio-Token ab, wartet bis zu 2s, dann erzwungener Abbruch des Tasks).

## Heartbeat-Erwartungen für langlebige Schleifen

`heartbeat()` muss in Schleifen mit unbegrenzten oder großen Arbeitsmengen in vorhersehbarer Kadenz ausgeführt werden.

Beobachtete Muster:

- `glob::filter_entries`: Prüfung jedes Eintrags vor dem Filtern/Matching.
- `fd::score_entries`: Prüfung jedes gescannten Kandidaten.
- `grep_sync`: Explizite Abbruchprüfung vor der rechenintensiven Suchphase, plus fs-Cache-Aufrufe, die ebenfalls das Token erhalten.
- `run_pty_sync`: Prüfung bei jedem Schleifentick (~16ms Sleep-Kadenz) und Beenden des Kindprozesses bei Abbruch.

Praktische Regel: Keine Schleife über extern dimensionierte Eingaben sollte ein kurzes begrenztes Intervall ohne Heartbeat überschreiten.

## Fehlerverhalten und Fehlerpropagierung zu JS

### Blockierende Tasks

Fehlerpfad:

1. Closure gibt `Err(napi::Error)` zurück (einschließlich `heartbeat()`-Abbruch).
2. `Task::compute()` gibt `Err` zurück.
3. `AsyncTask` lehnt das JS-Promise ab.

Typische Fehlerzeichenketten:

- `Aborted: Timeout`
- `Aborted: Signal`
- Domänenfehler (`Failed to decode image: ...`, `Conversion error: ...`, usw.)

### Future-Tasks

Fehlerpfad:

1. Der asynchrone Body gibt `Err(napi::Error)` zurück oder ein Join-Fehler wird zugeordnet (`... task failed: {err}`).
2. Das durch `task::future` erzeugte Promise wird abgelehnt.
3. Einige APIs geben absichtlich strukturierte Abbruchergebnisse statt einer Ablehnung zurück (`ShellRunResult`/`ShellExecuteResult` mit `cancelled`/`timed_out`-Flags und `exit_code: None`).

### Aufteilung der Abbruchberichterstattung

- **Abbruch als Fehler**: Die meisten blockierenden Exports, die `heartbeat()?` verwenden.
- **Abbruch als typisiertes Ergebnis**: Shell-/PTY-artige Befehls-APIs, die den Abbruch in Ergebnisstrukturen modellieren.

Wählen Sie ein Modell pro API und dokumentieren Sie es explizit.

## Häufige Fallstricke

1. **Fehlender Heartbeat in blockierenden Schleifen**
   - Symptom: Timeout/Signal erscheint ignoriert, bis die Schleife endet.
   - Lösung: `ct.heartbeat()?` am Schleifenanfang und vor teuren pro-Element-Schritten hinzufügen.

2. **Lange nicht-abbrechbare Abschnitte**
   - Symptom: Abbruch-Latenzspitzen während eines einzelnen großen Aufrufs (Dekodierung, Sortierung, Komprimierung usw.).
   - Lösung: Arbeit in Blöcke mit Heartbeat-Grenzen aufteilen; falls unmöglich, Latenz dokumentieren.

3. **Blockierung des asynchronen Executors**
   - Symptom: Asynchrone API stockt, wenn synchron-intensiver Code direkt im Future läuft.
   - Lösung: CPU-/Sync-Blöcke in `task::blocking` oder `tokio::task::spawn_blocking` verlagern.

4. **Inkonsistente Abbruch-Semantik**
   - Symptom: Eine API lehnt bei Abbruch ab, eine andere löst mit Flags auf, was Aufrufer verwirrt.
   - Lösung: Pro Domäne standardisieren und Wrapper-Dokumentation abgestimmt halten.

5. **Vergessene Abbruch-Bridge in verschachtelten asynchronen Tasks**
   - Symptom: Äußerer Token ist abgebrochen, aber innere Reader-/Subprozess-Tasks laufen weiter.
   - Lösung: Abbruch an inneren Token/Signal weiterleiten und Karenzzeit + erzwungenen Abbruch als Fallback durchsetzen.

## Checkliste für neue abbrechbare Exports

1. Arbeit korrekt klassifizieren:
   - CPU-gebunden oder synchron blockierend -> `task::blocking`
   - Async-I/O / `await`-Orchestrierung -> `task::future`

2. Abbruch-Eingaben bei Bedarf bereitstellen:
   - `timeoutMs` und `signal` in `#[napi(object)]`-Optionen einbinden
   - `let ct = task::CancelToken::new(timeout_ms, signal);` erstellen

3. Abbruch durch alle Schichten verdrahten:
   - Blockierende Schleifen: `ct.heartbeat()?` in stabilen Intervallen
   - Asynchrone Orchestrierung: Race mit `ct.wait()` und Sub-Tasks/Tokens abbrechen

4. Abbruchvertrag festlegen:
   - Promise mit Abbruchfehler ablehnen, oder
   - Typisiertes `{ cancelled, timedOut, ... }` auflösen
   - Diesen Vertrag konsistent für die API-Familie halten

5. Fehler mit Kontext propagieren:
   - Fehler über `Error::from_reason(format!("...: {err}"))` zuordnen
   - Phasenspezifische Präfixe einbinden (`spawn`, `decode`, `wait`, usw.)

6. Abbruch vor Start und während der Ausführung behandeln:
   - Abbruchprüfung/-await muss vor dem teuren Body und während langer Ausführung erfolgen

7. Sicherstellen, dass kein Executor-Missbrauch vorliegt:
   - Keine lange synchrone Arbeit direkt in asynchronen Futures ohne `spawn_blocking`/Blocking-Task-Wrapper
