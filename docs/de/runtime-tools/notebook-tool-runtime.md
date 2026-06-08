---
title: Notebook Tool Runtime Internals
description: >-
  Jupyter notebook tool runtime with cell execution, kernel lifecycle, and
  output rendering.
sidebar:
  order: 2
  label: Notebook tool
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# Interne Funktionsweise der Notebook-Tool-Laufzeitumgebung

Dieses Dokument beschreibt die aktuelle Implementierung des `notebook`-Tools und seine Beziehung zur kernelgestützten Python-Laufzeitumgebung.

Die entscheidende Unterscheidung: **`notebook` ist ein JSON-Notebook-Editor, kein Notebook-Executor**. Es bearbeitet `.ipynb`-Zellquellen direkt; es startet keinen Python-Kernel und kommuniziert nicht mit einem.

## Implementierungsdateien

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) Laufzeitgrenze: Bearbeiten vs. Ausführen

## `notebook`-Tool (`src/tools/notebook.ts`)

- Unterstützt `action: edit | insert | delete` auf einer `.ipynb`-Datei.
- Löst den Pfad relativ zum Session-CWD auf (`resolveToCwd`).
- Lädt Notebook-JSON, validiert das `cells`-Array, validiert die `cell_index`-Grenzen.
- Wendet Quelltextänderungen im Speicher an und schreibt das vollständige Notebook-JSON mit `JSON.stringify(notebook, null, 1)` zurück.
- Gibt eine textuelle Zusammenfassung + strukturierte `details` zurück (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`).

In diesem Tool existiert kein Kernel-Lebenszyklus:

- kein Gateway-Erwerb
- keine Kernel-Session-ID
- kein `execute_request`
- keine Stream-Chunks von Kernel-Kanälen
- keine Rich-Display-Erfassung (`image/png`, JSON-Display, Status-MIME)

## Notebook-ähnlicher Ausführungspfad (`src/tools/python.ts` + `src/ipy/*`)

Wenn der Agent zellenartigen Python-Code ausführen muss (sequentielle Zellen, persistenter Zustand, Rich-Displays), läuft das über das **`python`-Tool**, nicht über `notebook`.

Dieser Pfad ist der Ort, an dem Kernel-Modi, Neustart-/Abbruchverhalten, Chunk-Streaming und Ausgabe-Artefakt-Kürzung implementiert sind.

## 2) Semantik der Notebook-Zellbehandlung (`notebook`-Tool)

## Quelltext-Normalisierung

`content` wird in `source: string[]` mit Zeilenumbruch-Erhaltung aufgeteilt:

- jede nicht-letzte Zeile behält den abschließenden `\n`
- die letzte Zeile hat keinen erzwungenen abschließenden Zeilenumbruch

Dies entspricht den Notebook-JSON-Konventionen und vermeidet versehentliche Zeilenverkettung bei späteren Bearbeitungen.

## Aktionsverhalten

- `edit`
  - ersetzt `cells[cell_index].source`
  - behält den bestehenden `cell_type` bei
- `insert`
  - fügt an Position `[0..cellCount]` ein
  - `cell_type` ist standardmäßig `code`
  - Code-Zellen initialisieren `execution_count: null` und `outputs: []`
  - Markdown-Zellen initialisieren nur `metadata` + `source`
- `delete`
  - entfernt `cells[cell_index]`
  - gibt entfernten `source` in Details für die Renderer-Vorschau zurück

## Fehleroberflächen

Harte Fehler werden ausgelöst bei:

- fehlender Notebook-Datei
- ungültigem JSON
- fehlendem/nicht-Array `cells`
- Index außerhalb des Bereichs (Einfügen und Nicht-Einfügen haben unterschiedliche gültige Bereiche)
- fehlendem `content` für `edit`/`insert`

Diese werden zu `Error:`-Tool-Antworten upstream; der Renderer verwendet den Notebook-Pfad + formatierten Fehlertext.

## 3) Kernel-Session-Semantik (wo sie tatsächlich existiert)

Kernel-Semantik ist in `executePython` / `PythonKernel` implementiert und gilt für das `python`-Tool.

## Modi

`PythonKernelMode`:

- `session` (Standard)
  - Kernel werden in der `kernelSessions`-Map gecacht
  - maximal 4 Sessions; älteste werden bei Überlauf verdrängt
  - Leerlauf-/Tot-Bereinigung alle 30s, Timeout nach 5 Minuten
  - pro-Session-Warteschlange serialisiert die Ausführung (`session.queue`)
- `per-call`
  - erstellt Kernel für die Anfrage
  - führt aus
  - fährt den Kernel immer im `finally` herunter

## Reset-Verhalten

Das `python`-Tool übergibt `reset` nur für die erste Zelle in einem Multi-Zellen-Aufruf; spätere Zellen werden immer mit `reset: false` ausgeführt.

## Kernel-Tod / Neustart / Wiederholung

Im Session-Modus (`withKernelSession`):

- Toter Kernel wird durch Heartbeat erkannt (`kernel.isAlive()`-Prüfung alle 5s) oder durch Ausführungsfehler.
- Toter Zustand vor der Ausführung löst `restartKernelSession` aus.
- Absturzpfad zur Ausführungszeit wiederholt einmal: Kernel neu starten, Handler erneut ausführen.
- `restartCount > 1` in derselben Session löst `Python kernel restarted too many times in this session` aus.

Startup-Wiederholungsverhalten:

- Shared-Gateway-Kernel-Erstellung wiederholt einmal bei `SharedGatewayCreateError` mit HTTP 5xx.

Ressourcenerschöpfungs-Wiederherstellung:

- erkennt `EMFILE`/`ENFILE`/"Too many open files"-artige Fehler
- leert verfolgte Sessions
- ruft `shutdownSharedGateway()` auf
- wiederholt die Kernel-Session-Erstellung einmal

## 4) Umgebungs-/Session-Variablen-Injektion

Der Kernel-Start erhält eine optionale Env-Map vom Executor:

- `PI_SESSION_FILE` (Session-Zustandsdateipfad)
- `ARTIFACTS` (Artefakt-Verzeichnis)

`PythonKernel.#initializeKernelEnvironment(...)` führt dann ein Init-Skript im Kernel aus, um:

- `os.chdir(cwd)` auszuführen
- Env-Einträge in `os.environ` zu injizieren
- CWD dem `sys.path` voranzustellen, falls fehlend

Implikation:

- Prelude-Helper, die Session- oder Artefakt-Kontext lesen, sind auf diese Umgebungsvariablen im Python-Prozesszustand angewiesen.

## 5) Streaming/Chunk- und Display-Behandlung (kernelgestützter Pfad)

Der Kernel-Client verarbeitet Jupyter-Protokollnachrichten pro Ausführung:

- `stream` -> Text-Chunk an `onChunk`
- `execute_result` / `display_data` ->
  - Anzeigetext wird nach MIME-Priorität gewählt: `text/markdown` > `text/plain` > konvertiertes `text/html`
  - strukturierte Ausgaben werden separat erfasst:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (keine Textausgabe)
- `error` -> Traceback-Text wird zum Chunk-Stream hinzugefügt + strukturierte Fehlermetadaten
- `input_request` -> gibt Stdin-Warnungstext aus, sendet leere `input_reply`, markiert Stdin als angefordert
- Abschluss wartet sowohl auf `execute_reply` als auch auf Kernel-`status=idle`

Abbruch/Timeout:

- Abort-Signal löst `interrupt()` aus (REST `/interrupt` + Control-Channel `interrupt_request`)
- Ergebnis markiert `cancelled=true`
- Timeout-Pfad annotiert Ausgabe mit `Command timed out after <n> seconds`

## 6) Kürzungs- und Artefakt-Verhalten

`OutputSink` in `src/session/streaming-output.ts` wird von Kernel-Ausführungspfaden verwendet (`executeWithKernel`):

- bereinigt jeden Chunk (`sanitizeText`)
- verfolgt Gesamt-/Ausgabezeilen und Bytes
- optionale Artefakt-Spilldatei (`artifactPath`, `artifactId`)
- wenn der In-Memory-Puffer den Schwellenwert überschreitet (`DEFAULT_MAX_BYTES`, sofern nicht überschrieben):
  - markiert als gekürzt
  - behält Tail-Bytes im Speicher (UTF-8-sichere Grenze)
  - kann den vollständigen Stream in die Artefakt-Senke auslagern

`dump()` gibt zurück:

- sichtbaren Ausgabetext (möglicherweise tail-gekürzt)
- Kürzungs-Flag + Zähler
- Artefakt-ID (für `artifact://<id>`-Referenzen)

Das `python`-Tool konvertiert diese Metadaten in Kürzungshinweise und TUI-Warnungen.

Das `notebook`-Tool verwendet **nicht** `OutputSink`; es hat keine Stream-/Artefakt-Kürzungspipeline, da es keinen Code ausführt.

## 7) Renderer-Annahmen und Formatierung

## Notebook-Renderer (`notebookToolRenderer`)

- Aufrufansicht: Statuszeile mit Aktion + Notebook-Pfad + Zell-/Typ-Metadaten
- Ergebnisansicht:
  - Erfolgszusammenfassung abgeleitet aus `details`
  - `cellSource` gerendert über `renderCodeCell`
  - Markdown-Zellen setzen den Sprachhinweis `markdown`; andere Zellen haben keine explizite Sprachüberschreibung
  - eingeklappte Code-Vorschaulimit ist `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - unterstützt erweiterten Modus über gemeinsame Render-Optionen
  - verwendet Render-Cache mit Schlüssel aus Breite + erweitertem Zustand

Fehler-Rendering-Annahme:

- wenn der erste Textinhalt mit `Error:` beginnt, formatiert der Renderer als Notebook-Fehlerblock.

## Python-Renderer (für tatsächliche Ausführungsausgabe)

Kernelgestütztes Ausführungs-Rendering erwartet:

- pro-Zell-Statusübergänge (`pending/running/complete/error`)
- optionalen strukturierten Status-Event-Bereich
- optionale JSON-Ausgabebäume
- Kürzungswarnungen + optionalen `artifact://<id>`-Verweis

Dieses Renderer-Verhalten steht in keinem Zusammenhang mit `notebook`-JSON-Bearbeitungsergebnissen, außer dass beide gemeinsame TUI-Primitive wiederverwenden.

## 8) Abweichung vom einfachen Python-Tool-Verhalten

Wenn "einfaches Python-Tool" den `python`-Ausführungspfad meint:

- `python` führt Code in einem Kernel aus, persistiert den Zustand nach Modus, streamt Chunks, erfasst Rich-Displays, behandelt Interrupts/Timeouts und unterstützt Ausgabekürzung/Artefakte.
- `notebook` führt ausschließlich deterministische Notebook-JSON-Mutationen durch; keine Ausführung, kein Kernel-Zustand, kein Chunk-Stream, keine Display-Ausgaben, keine Artefakt-Pipeline.

Wenn ein Workflow beides benötigt:

1. Notebook-Quelltext mit `notebook` bearbeiten
2. Code-Zellen über `python` ausführen (Code manuell übergeben), nicht über `notebook`

Die aktuelle Implementierung bietet kein einzelnes Tool, das sowohl `.ipynb` mutiert als auch Notebook-Zellen über den Kernel-Kontext ausführt.
