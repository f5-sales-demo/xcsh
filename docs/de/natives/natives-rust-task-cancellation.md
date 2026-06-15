---
title: Native Rust-Aufgabenausführung und Abbruch
description: >-
  Rust async Aufgabenausführungsmodell mit kooperativem Abbruch und
  Bereinigungssemantik.
sidebar:
  order: 5
  label: Aufgabenabbruch
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# Native Rust-Aufgabenausführung und Abbruch (`pi-natives`)

Dieses Dokument beschreibt, wie `crates/pi-natives` native Arbeit plant und wie Abbrüche von JS-Optionen (`timeoutMs`, `AbortSignal`) zur Rust-Ausführung fließen.

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
   - `compute()` wird auf libuv-Worker-Threads ausgeführt (für CPU-intensive oder blockierende/synchrone Systemaufrufe).
   - Gibt ein JS `Promise<T>` zurück.

2. `task::future(env, tag, work)`
   - Kapselt `env.spawn_future(...)`.
   - Führt asynchrone Arbeit auf der Tokio-Laufzeitumgebung aus.
   - Gibt `PromiseRaw<'env, T>` zurück.

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` kombiniert Deadline + optionales `AbortSignal`.
   - `CancelToken::heartbeat()` ist kooperativer Abbruch für blockierende Schleifen.
   - `CancelToken::wait()` ist asynchrones Abbruch-Warten (`Signal` / `Timeout` / `User` Ctrl-C).
   - `AbortToken` ermöglicht es externem Code, einen Abbruch anzufordern (`abort(reason)`).

## `blocking` vs. `future`: Ausführungsmodell und Auswahl

### `task::blocking` verwenden

Verwenden, wenn die Arbeit CPU-intensiv oder grundlegend synchron/blockierend ist:

- Regex-/Datei-Scanning (`grep`, `glob`, `fuzzy_find`)
- Synchrone PTY-Schleifeninterna (`run_pty_sync` über `spawn_blocking`)
- Zwischenablage-/Bild-/HTML-Konvertierungen

Verhalten:

- Der Arbeits-Closure erhält ein geklontes `CancelToken`.
- Abbrüche werden nur dort beobachtet, wo Code `ct.heartbeat()?` prüft.
- Closure `Err(...)` lehnt das JS-Promise ab.

### `task::future` verwenden

Verwenden, wenn die Arbeit asynchrone Operationen `await`en muss:

- Shell-Session-Orchestrierung (`shell.run`, `executeShell`)
- Aufgaben-Racing (`tokio::select!`) zwischen Abschluss und Abbruch

Verhalten:

- Ein Future kann den normalen Abschluss gegen `ct.wait()` abwägen.
- Beim Abbruchpfad propagieren asynchrone Implementierungen den Abbruch typischerweise an innere Subsysteme (z. B. `tokio_util::CancellationToken`) und erzwingen optional einen Abbruch nach einem Kulanz-Timeout.

## JS-API ↔ Rust-Export-Zuordnung (aufgaben-/abbruchrelevant)

| JS-seitige API | Rust-Export (`#[napi]`) | Planer | Abbruch-Anbindung |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` in Filterschleife |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` in Bewertungsschleife |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` gegen Laufaufgabe abgewogen; überbrückt zu Tokio `CancellationToken` |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | wie oben |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + inneres `spawn_blocking` | `CancelToken` in synchroner PTY-Schleife über `heartbeat()` geprüft |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | keine (`()` Token) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | keine (`()` Token) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | keine (`()` Token) |

`text.rs` und `ps.rs` verwenden derzeit weder `task::blocking` noch `task::future` und nehmen daher nicht an diesem Abbruchpfad teil.

## Abbruch-Lebenszyklus und Zustandsübergänge

### `CancelToken`-Lebenszyklus

`CancelToken` ist kooperativ und zustandsbehaftet:

```text
Erstellt
  ├─ kein Signal + kein Timeout  -> passives Token (bricht nie ab, außer extern gesetzt)
  ├─ Signal registriert           -> wartet auf AbortSignal-Callback
  └─ Deadline gesetzt             -> Timeout-Prüfung wird aktiv

Laufend
  ├─ heartbeat()/wait() sieht Signal   -> AbortReason::Signal
  ├─ heartbeat()/wait() sieht Deadline -> AbortReason::Timeout
  ├─ wait() sieht Ctrl-C               -> AbortReason::User
  └─ kein Abbruch                      -> fortsetzen

Abgebrochen (terminal)
  └─ erster Abbruchgrund gewinnt (atomares Flag + Benachrichtiger)
```

### Abbruch vor dem Start vs. während der Ausführung

- **Vor dem Start / vor der ersten Abbruchprüfung**:
  - `task::future`-Nutzer, die auf `ct.wait()` abwägen, können den Abbruch sofort auflösen, sobald sie `select!` betreten.
  - `task::blocking`-Nutzer beobachten den Abbruch nur, wenn der Closure-Code `heartbeat()` erreicht. Wenn der Closure nicht frühzeitig einen Heartbeat sendet, verzögert sich der Abbruch.

- **Während der Ausführung**:
  - `blocking`: das nächste `heartbeat()` gibt `Err("Aborted: ...")` zurück.
  - `future`: der `ct.wait()`-Zweig gewinnt `select!`, dann bricht Code untergeordnete asynchrone Mechanismen ab (bei Shell: Tokio-Token abbrechen, bis zu 2 s warten, dann Aufgabe zwangsweise beenden).

## Heartbeat-Anforderungen für langlaufende Schleifen

`heartbeat()` muss in Schleifen mit unbegrenzten oder großen Arbeitsmengen in vorhersehbarer Kadenz ausgeführt werden.

Beobachtete Muster:

- `glob::filter_entries`: jeden Eintrag vor dem Filtern/Abgleichen prüfen.
- `fd::score_entries`: jeden gescannten Kandidaten prüfen.
- `grep_sync`: explizite Abbruchprüfung vor der intensiven Suchphase, plus fs-Cache-Aufrufe, die ebenfalls das Token erhalten.
- `run_pty_sync`: jeden Schleifentakt prüfen (~16 ms Sleep-Kadenz) und Kind-Prozess bei Abbruch beenden.

Praktische Regel: Keine Schleife über extern große Eingaben sollte ein kurzes begrenztes Intervall ohne Heartbeat überschreiten.

## Fehlerverhalten und Fehlerpropagation zu JS

### Blockierende Aufgaben

Fehlerpfad:

1. Closure gibt `Err(napi::Error)` zurück (einschließlich `heartbeat()`-Abbruch).
2. `Task::compute()` gibt `Err` zurück.
3. `AsyncTask` lehnt JS-Promise ab.

Typische Fehlerzeichenketten:

- `Aborted: Timeout`
- `Aborted: Signal`
- Domänenfehler (`Failed to decode image: ...`, `Conversion error: ...`, usw.)

### Asynchrone Aufgaben

Fehlerpfad:

1. Asynchroner Body gibt `Err(napi::Error)` zurück oder Join-Fehler wird zugeordnet (`... task failed: {err}`).
2. `task::future`-erstelltes Promise wird abgelehnt.
3. Einige APIs geben absichtlich strukturierte Abbruchergebnisse statt einer Ablehnung zurück (`ShellRunResult`/`ShellExecuteResult` mit `cancelled`/`timed_out`-Flags und `exit_code: None`).

### Aufteilung der Abbruchmeldung

- **Abbruch als Fehler**: die meisten blockierenden Exporte verwenden `heartbeat()?`.
- **Abbruch als typisiertes Ergebnis**: Shell/PTY-Befehls-APIs, die Abbrüche in Ergebnisstrukturen modellieren.

Wählen Sie ein Modell pro API und dokumentieren Sie es explizit.

## Häufige Fallstricke

1. **Fehlender Heartbeat in blockierenden Schleifen**
   - Symptom: Timeout/Signal erscheint ignoriert, bis die Schleife endet.
   - Behebung: `ct.heartbeat()?` am Schleifenanfang und vor kostspieligen Schritten pro Element hinzufügen.

2. **Lange nicht abbrechbare Abschnitte**
   - Symptom: Abbruchlatenz steigt bei einzelnen großen Aufrufen (Dekodierung, Sortierung, Komprimierung usw.).
   - Behebung: Arbeit in Stücke mit Heartbeat-Grenzen aufteilen; falls nicht möglich, Latenz dokumentieren.

3. **Blockierung des asynchronen Executors**
   - Symptom: Asynchrone API blockiert, wenn synchron-intensiver Code direkt in einem Future ausgeführt wird.
   - Behebung: CPU-/Sync-Blöcke in `task::blocking` oder `tokio::task::spawn_blocking` verschieben.

4. **Inkonsistente Abbruchsemantik**
   - Symptom: Eine API lehnt bei Abbruch ab, eine andere löst mit Flags auf und verwirrt Aufrufer.
   - Behebung: Pro Domäne standardisieren und Wrapper-Dokumentation aktuell halten.

5. **Vergessene Abbruchbrücke in verschachtelten asynchronen Aufgaben**
   - Symptom: Äußeres Token wird abgebrochen, aber innere Leser-/Teilprozessaufgaben laufen weiter.
   - Behebung: Abbruch zum inneren Token/Signal überbrücken und Kulanz-Timeout + erzwungenen Abbruch als Fallback durchsetzen.

## Checkliste für neue abbrechbare Exporte

1. Arbeit korrekt klassifizieren:
   - CPU-intensiv oder synchron blockierend -> `task::blocking`
   - Asynchrone E/A / `await`-Orchestrierung -> `task::future`

2. Abbrucheingaben bei Bedarf verfügbar machen:
   - `timeoutMs` und `signal` in `#[napi(object)]`-Optionen einschließen
   - `let ct = task::CancelToken::new(timeout_ms, signal);` erstellen

3. Abbruch durch alle Schichten verdrahten:
   - Blockierende Schleifen: `ct.heartbeat()?` in stabilen Intervallen
   - Asynchrone Orchestrierung: gegen `ct.wait()` abwägen und Unteraufgaben/Token abbrechen

4. Abbruchvertrag festlegen:
   - Promise mit Abbruchfehler ablehnen, oder
   - typisiertes `{ cancelled, timedOut, ... }` auflösen
   - diesen Vertrag für die API-Familie konsistent halten

5. Fehler mit Kontext propagieren:
   - Fehler über `Error::from_reason(format!("...: {err}"))` zuordnen
   - phasenspezifische Präfixe einschließen (`spawn`, `decode`, `wait`, usw.)

6. Abbruch vor dem Start und während der Ausführung behandeln:
   - Abbruchprüfung/-warten muss vor dem kostspieligen Body und während langer Ausführung erfolgen

7. Sicherstellen, dass kein Executor-Missbrauch vorliegt:
   - Keine langen synchronen Arbeiten direkt in asynchronen Futures ohne `spawn_blocking`/blockierende Aufgaben-Kapselung
