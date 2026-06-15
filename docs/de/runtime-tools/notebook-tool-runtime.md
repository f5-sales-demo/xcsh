---
title: Interna der Notebook-Werkzeug-Laufzeitumgebung
description: >-
  Jupyter-Notebook-Werkzeug-Laufzeitumgebung mit Zellenausführung,
  Kernel-Lebenszyklus und Ausgabe-Rendering.
sidebar:
  order: 2
  label: Notebook-Werkzeug
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# Interna der Notebook-Werkzeug-Laufzeitumgebung

Dieses Dokument beschreibt die aktuelle Implementierung des `notebook`-Werkzeugs und seine Beziehung zur kernel-gestützten Python-Laufzeitumgebung.

Die entscheidende Unterscheidung: **`notebook` ist ein JSON-Notebook-Editor, kein Notebook-Executor**. Es bearbeitet `.ipynb`-Zellenquellen direkt; es startet keinen Python-Kernel und kommuniziert auch nicht mit einem solchen.

## Implementierungsdateien

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) Laufzeitgrenze: Bearbeitung vs. Ausführung

## `notebook`-Werkzeug (`src/tools/notebook.ts`)

- Unterstützt `action: edit | insert | delete` für eine `.ipynb`-Datei.
- Löst den Pfad relativ zum Sitzungs-CWD auf (`resolveToCwd`).
- Lädt Notebook-JSON, validiert das `cells`-Array und die `cell_index`-Grenzen.
- Wendet Quellbearbeitungen im Arbeitsspeicher an und schreibt das vollständige Notebook-JSON mit `JSON.stringify(notebook, null, 1)` zurück.
- Gibt eine textuelle Zusammenfassung sowie strukturierte `details` zurück (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`).

In diesem Werkzeug existiert kein Kernel-Lebenszyklus:

- keine Gateway-Erfassung
- keine Kernel-Sitzungs-ID
- kein `execute_request`
- keine Stream-Chunks aus Kernel-Kanälen
- keine Rich-Display-Erfassung (`image/png`, JSON-Display, Status-MIME)

## Notebook-ähnlicher Ausführungspfad (`src/tools/python.ts` + `src/ipy/*`)

Wenn der Agent zellenartigen Python-Code ausführen muss (sequenzielle Zellen, persistenter Zustand, Rich-Displays), wird das über das **`python`-Werkzeug** abgewickelt, nicht über `notebook`.

Dort sind Kernel-Modi, Neustart-/Abbruchverhalten, Chunk-Streaming und die Kürzung von Ausgabe-Artefakten implementiert.

## 2) Semantik der Notebook-Zellenverarbeitung (`notebook`-Werkzeug)

## Quellnormalisierung

`content` wird in `source: string[]` mit Zeilenumbruch-Erhaltung aufgeteilt:

- Jede nicht-letzte Zeile behält das abschließende `\n`
- Die letzte Zeile hat keinen erzwungenen abschließenden Zeilenumbruch

Dies entspricht den Notebook-JSON-Konventionen und vermeidet eine versehentliche Zeilenzusammenfassung bei späteren Bearbeitungen.

## Aktionsverhalten

- `edit`
  - ersetzt `cells[cell_index].source`
  - behält den vorhandenen `cell_type` bei
- `insert`
  - fügt an Position `[0..cellCount]` ein
  - `cell_type` ist standardmäßig `code`
  - Code-Zellen initialisieren `execution_count: null` und `outputs: []`
  - Markdown-Zellen initialisieren nur `metadata` + `source`
- `delete`
  - entfernt `cells[cell_index]`
  - gibt die entfernte `source` in den Details für die Renderer-Vorschau zurück

## Fehlermeldungen

Schwerwiegende Fehler werden ausgelöst bei:

- fehlender Notebook-Datei
- ungültigem JSON
- fehlendem oder nicht-array-artigem `cells`
- außerhalb des gültigen Bereichs liegendem Index (Einfügen und Nicht-Einfügen haben unterschiedliche gültige Bereiche)
- fehlendem `content` für `edit`/`insert`

Diese werden zu `Error:`-Werkzeugantworten im vorgelagerten System; der Renderer verwendet den Notebook-Pfad und den formatierten Fehlertext.

## 3) Kernel-Sitzungssemantik (wo sie tatsächlich existiert)

Die Kernel-Semantik ist in `executePython` / `PythonKernel` implementiert und gilt für das `python`-Werkzeug.

## Modi

`PythonKernelMode`:

- `session` (Standard)
  - Kernels werden in der `kernelSessions`-Map zwischengespeichert
  - maximal 4 Sitzungen; älteste wird bei Überschreitung entfernt
  - Bereinigung inaktiver/toter Sitzungen alle 30 Sekunden, Timeout nach 5 Minuten
  - sitzungsbezogene Warteschlange serialisiert die Ausführung (`session.queue`)
- `per-call`
  - erstellt einen Kernel für die Anfrage
  - führt aus
  - fährt den Kernel immer in `finally` herunter

## Rücksetzverhalten

Das `python`-Werkzeug übergibt `reset` nur für die erste Zelle in einem Mehrfachzellen-Aufruf; spätere Zellen werden immer mit `reset: false` ausgeführt.

## Kernel-Absturz / Neustart / Wiederholung

Im Sitzungsmodus (`withKernelSession`):

- Abgestürzter Kernel wird durch Heartbeat erkannt (`kernel.isAlive()`-Prüfung alle 5 Sekunden) oder durch einen Ausführungsfehler.
- Ein vor der Ausführung erkannter toter Zustand löst `restartKernelSession` aus.
- Ein Absturz während der Ausführung wird einmal wiederholt: Kernel neu starten, Handler erneut ausführen.
- `restartCount > 1` in derselben Sitzung wirft `Python kernel restarted too many times in this session`.

Startwiederholungsverhalten:

- Die Kernel-Erstellung eines gemeinsam genutzten Gateways wird bei `SharedGatewayCreateError` mit HTTP 5xx einmal wiederholt.

Wiederherstellung bei Ressourcenerschöpfung:

- Erkennt Fehler vom Typ `EMFILE`/`ENFILE`/„Too many open files"
- Bereinigt verfolgte Sitzungen
- Ruft `shutdownSharedGateway()` auf
- Versucht die Kernel-Sitzungserstellung einmal erneut

## 4) Injektion von Umgebungs-/Sitzungsvariablen

Der Kernel-Start erhält eine optionale Umgebungsvariablen-Map vom Executor:

- `PI_SESSION_FILE` (Pfad zur Sitzungszustandsdatei)
- `ARTIFACTS` (Artefaktverzeichnis)

`PythonKernel.#initializeKernelEnvironment(...)` führt dann im Kernel ein Initialisierungsskript aus, um:

- `os.chdir(cwd)` auszuführen
- Umgebungseinträge in `os.environ` einzufügen
- das CWD in `sys.path` voranzustellen, falls nicht vorhanden

Implikation:

- Präambel-Hilfsfunktionen, die Sitzungs- oder Artefaktkontext lesen, verlassen sich auf diese Umgebungsvariablen im Python-Prozesszustand.

## 5) Streaming-/Chunk- und Display-Verarbeitung (kernel-gestützter Pfad)

Der Kernel-Client verarbeitet Jupyter-Protokollnachrichten pro Ausführung:

- `stream` -> Text-Chunk an `onChunk`
- `execute_result` / `display_data` ->
  - Anzeigetext nach MIME-Priorität ausgewählt: `text/markdown` > `text/plain` > konvertiertes `text/html`
  - strukturierte Ausgaben werden separat erfasst:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (keine Textausgabe)
- `error` -> Traceback-Text wird in den Chunk-Stream übertragen + strukturierte Fehlermetadaten
- `input_request` -> gibt eine stdin-Warnmeldung aus, sendet leere `input_reply`, markiert stdin als angefordert
- Der Abschluss wartet auf sowohl `execute_reply` als auch Kernel `status=idle`

Abbruch/Timeout:

- Abbruchsignal löst `interrupt()` aus (REST `/interrupt` + Control-Kanal `interrupt_request`)
- Ergebnis wird mit `cancelled=true` markiert
- Timeout-Pfad ergänzt die Ausgabe mit `Command timed out after <n> seconds`

## 6) Kürzung und Artefaktverhalten

`OutputSink` in `src/session/streaming-output.ts` wird von Kernel-Ausführungspfaden (`executeWithKernel`) verwendet:

- bereinigt jeden Chunk (`sanitizeText`)
- verfolgt Gesamt-/Ausgabezeilen und Bytes
- optionale Artefakt-Spill-Datei (`artifactPath`, `artifactId`)
- wenn der Arbeitsspeicherpuffer den Schwellenwert überschreitet (`DEFAULT_MAX_BYTES`, sofern nicht überschrieben):
  - markiert als gekürzt
  - behält die letzten Bytes im Arbeitsspeicher (UTF-8-sichere Grenze)
  - kann den vollständigen Stream in einen Artefakt-Sink auslagern

`dump()` gibt zurück:

- sichtbaren Ausgabetext (möglicherweise am Ende gekürzt)
- Kürzungs-Flag + Zählungen
- Artefakt-ID (für `artifact://<id>`-Referenzen)

Das `python`-Werkzeug wandelt diese Metadaten in Kürzungshinweise im Ergebnis und TUI-Warnungen um.

Das `notebook`-Werkzeug verwendet `OutputSink` **nicht**; es hat keine Stream-/Artefakt-Kürzungspipeline, da es keinen Code ausführt.

## 7) Renderer-Annahmen und Formatierung

## Notebook-Renderer (`notebookToolRenderer`)

- Aufrufansicht: Statuszeile mit Aktion + Notebook-Pfad + Zellen-/Typ-Metadaten
- Ergebnisansicht:
  - Erfolgszusammenfassung aus `details` abgeleitet
  - `cellSource` wird über `renderCodeCell` gerendert
  - Markdown-Zellen setzen den Sprachhinweis `markdown`; andere Zellen haben keine explizite Sprachüberschreibung
  - Limit für eingeklappte Code-Vorschau ist `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - unterstützt den erweiterten Modus über gemeinsame Render-Optionen
  - verwendet Render-Cache mit Schlüssel aus Breite + erweitertem Zustand

Annahme bei der Fehlerwiedergabe:

- Wenn der erste Textinhalt mit `Error:` beginnt, formatiert der Renderer diesen als Notebook-Fehlerblock.

## Python-Renderer (für tatsächliche Ausführungsausgabe)

Das kernel-gestützte Ausführungs-Rendering erwartet:

- zellenweise Statusübergänge (`pending/running/complete/error`)
- optionalen strukturierten Statustereignisabschnitt
- optionale JSON-Ausgabebäume
- Kürzungswarnungen + optionalen `artifact://<id>`-Zeiger

Dieses Renderer-Verhalten steht in keiner Beziehung zu den Ergebnissen der `notebook`-JSON-Bearbeitung, außer dass beide gemeinsame TUI-Primitive wiederverwenden.

## 8) Abweichung vom einfachen Python-Werkzeug-Verhalten

Wenn „einfaches Python-Werkzeug" den `python`-Ausführungspfad bedeutet:

- `python` führt Code in einem Kernel aus, hält den Zustand je nach Modus aufrecht, streamt Chunks, erfasst Rich-Displays, behandelt Interrupts/Timeouts und unterstützt die Ausgabekürzung/-artefakte.
- `notebook` führt ausschließlich deterministische Notebook-JSON-Mutationen durch; keine Ausführung, kein Kernel-Zustand, kein Chunk-Stream, keine Display-Ausgaben, keine Artefakt-Pipeline.

Wenn ein Workflow beides erfordert:

1. Notebook-Quelle mit `notebook` bearbeiten
2. Code-Zellen über `python` ausführen (Code manuell übergeben), nicht über `notebook`

Die aktuelle Implementierung bietet kein einzelnes Werkzeug, das sowohl `.ipynb` mutiert als auch Notebook-Zellen über einen Kernel-Kontext ausführt.
