---
title: Interne Laufzeitstruktur des Notebook-Werkzeugs
description: >-
  Jupyter-Notebook-Werkzeug-Laufzeit mit Zellenausführung, Kernel-Lebenszyklus
  und Ausgabe-Rendering.
sidebar:
  order: 2
  label: Notebook-Werkzeug
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# Interne Laufzeitstruktur des Notebook-Werkzeugs

Dieses Dokument beschreibt die aktuelle Implementierung des `notebook`-Werkzeugs und seine Beziehung zur kernelgestützten Python-Laufzeit.

Der wesentliche Unterschied: **`notebook` ist ein JSON-Notebook-Editor, kein Notebook-Ausführungsprogramm**. Es bearbeitet `.ipynb`-Zellenquellen direkt; es startet keinen Python-Kernel und kommuniziert auch nicht mit einem.

## Implementierungsdateien

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) Laufzeitgrenze: Bearbeiten vs. Ausführen

## `notebook`-Werkzeug (`src/tools/notebook.ts`)

- Unterstützt `action: edit | insert | delete` für eine `.ipynb`-Datei.
- Löst den Pfad relativ zum Sitzungs-CWD auf (`resolveToCwd`).
- Lädt Notebook-JSON, validiert das `cells`-Array und überprüft die `cell_index`-Grenzen.
- Wendet Quelländerungen im Arbeitsspeicher an und schreibt das vollständige Notebook-JSON mit `JSON.stringify(notebook, null, 1)` zurück.
- Gibt eine textuelle Zusammenfassung sowie strukturierte `details` zurück (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`).

In diesem Werkzeug existiert kein Kernel-Lebenszyklus:

- keine Gateway-Erfassung
- keine Kernel-Sitzungs-ID
- kein `execute_request`
- keine Stream-Chunks aus Kernel-Kanälen
- keine Rich-Display-Erfassung (`image/png`, JSON-Anzeige, Status-MIME)

## Notebookähnlicher Ausführungspfad (`src/tools/python.ts` + `src/ipy/*`)

Wenn der Agent zellenartigen Python-Code ausführen muss (sequentielle Zellen, persistenter Zustand, Rich Displays), erfolgt dies über das **`python`-Werkzeug**, nicht über `notebook`.

Dort sind Kernel-Modi, Neustart-/Abbruchverhalten, Chunk-Streaming und das Abschneiden von Ausgabe-Artefakten implementiert.

## 2) Semantik der Notebook-Zellenverarbeitung (`notebook`-Werkzeug)

## Quellnormalisierung

`content` wird in `source: string[]` mit Zeilenumbrucherhaltung aufgeteilt:

- jede nicht-abschließende Zeile behält das abschließende `\n`
- die letzte Zeile hat kein erzwungenes abschließendes Zeilenumbruchzeichen

Dies entspricht den Notebook-JSON-Konventionen und vermeidet eine versehentliche Zeilenzusammenführung bei späteren Bearbeitungen.

## Aktionsverhalten

- `edit`
  - ersetzt `cells[cell_index].source`
  - behält den bestehenden `cell_type` bei
- `insert`
  - fügt bei `[0..cellCount]` ein
  - `cell_type` ist standardmäßig `code`
  - Code-Zellen initialisieren `execution_count: null` und `outputs: []`
  - Markdown-Zellen initialisieren nur `metadata` + `source`
- `delete`
  - entfernt `cells[cell_index]`
  - gibt die entfernte `source` in den Details für die Renderer-Vorschau zurück

## Fehleroberflächen

Schwere Fehler werden ausgelöst bei:

- fehlender Notebook-Datei
- ungültigem JSON
- fehlendem/nicht-Array-`cells`
- Index außerhalb des gültigen Bereichs (Einfügen und Nicht-Einfügen haben unterschiedliche gültige Bereiche)
- fehlendem `content` für `edit`/`insert`

Diese werden zu `Error:`-Werkzeugantworten weiter oben; der Renderer verwendet Notebook-Pfad und formatierten Fehlertext.

## 3) Kernel-Sitzungssemantik (wo sie tatsächlich existiert)

Kernel-Semantik ist in `executePython` / `PythonKernel` implementiert und gilt für das `python`-Werkzeug.

## Modi

`PythonKernelMode`:

- `session` (Standard)
  - Kernels werden in der `kernelSessions`-Map zwischengespeichert
  - maximal 4 Sitzungen; älteste wird bei Überlauf verdrängt
  - Bereinigung inaktiver/toter Kernels alle 30 Sekunden, Zeitlimit nach 5 Minuten
  - pro Sitzung serialisiert eine Warteschlange die Ausführung (`session.queue`)
- `per-call`
  - erstellt einen Kernel für die Anfrage
  - führt aus
  - fährt den Kernel immer in `finally` herunter

## Zurücksetzungsverhalten

Das `python`-Werkzeug übergibt `reset` nur für die erste Zelle in einem Mehrfachzellen-Aufruf; spätere Zellen werden immer mit `reset: false` ausgeführt.

## Kernel-Absturz / Neustart / Wiederholung

Im Sitzungsmodus (`withKernelSession`):

- Ein abgestürzter Kernel wird durch Heartbeat erkannt (`kernel.isAlive()`-Prüfung alle 5 Sekunden) oder durch einen Ausführungsfehler.
- Ein vor der Ausführung erkannter toter Zustand löst `restartKernelSession` aus.
- Ein Absturz während der Ausführung wird einmal wiederholt: Kernel neustarten, Handler erneut ausführen.
- `restartCount > 1` in derselben Sitzung löst `Python kernel restarted too many times in this session` aus.

Startwiederholungsverhalten:

- Die Erstellung von Shared-Gateway-Kernels wird bei `SharedGatewayCreateError` mit HTTP 5xx einmal wiederholt.

Wiederherstellung bei Ressourcenerschöpfung:

- Erkennt Fehler vom Typ `EMFILE`/`ENFILE`/„Zu viele geöffnete Dateien"
- Löscht verfolgte Sitzungen
- Ruft `shutdownSharedGateway()` auf
- Wiederholt die Kernel-Sitzungserstellung einmal

## 4) Injektion von Umgebungs-/Sitzungsvariablen

Der Kernel-Start empfängt eine optionale Umgebungsvariablen-Map vom Executor:

- `PI_SESSION_FILE` (Pfad zur Sitzungsstatusdatei)
- `ARTIFACTS` (Artefaktverzeichnis)

`PythonKernel.#initializeKernelEnvironment(...)` führt dann ein Initialisierungsskript im Kernel aus, um:

- `os.chdir(cwd)` auszuführen
- Umgebungseinträge in `os.environ` einzufügen
- cwd an `sys.path` voranzustellen, falls nicht vorhanden

Konsequenz:

- Prelude-Hilfsfunktionen, die Sitzungs- oder Artefaktkontext lesen, verlassen sich auf diese Umgebungsvariablen im Python-Prozessstatus.

## 5) Streaming/Chunk- und Display-Verarbeitung (kernelgestützter Pfad)

Der Kernel-Client verarbeitet Jupyter-Protokollnachrichten pro Ausführung:

- `stream` -> Textchunk an `onChunk`
- `execute_result` / `display_data` ->
  - Anzeigetext wird nach MIME-Priorität gewählt: `text/markdown` > `text/plain` > konvertiertes `text/html`
  - strukturierte Ausgaben werden separat erfasst:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (keine Textausgabe)
- `error` -> Traceback-Text wird in den Chunk-Stream übertragen + strukturierte Fehlermetadaten
- `input_request` -> gibt Stdin-Warnungstext aus, sendet leere `input_reply`, markiert Stdin als angefordert
- Abschluss wartet auf `execute_reply` und Kernel-`status=idle`

Abbruch/Zeitlimit:

- Ein Abbruchsignal löst `interrupt()` aus (REST `/interrupt` + Control-Kanal `interrupt_request`)
- Das Ergebnis wird mit `cancelled=true` markiert
- Der Zeitlimitpfad versieht die Ausgabe mit `Command timed out after <n> seconds`

## 6) Abschneideverhalten und Artefaktverhalten

`OutputSink` in `src/session/streaming-output.ts` wird von Kernel-Ausführungspfaden verwendet (`executeWithKernel`):

- bereinigt jeden Chunk (`sanitizeText`)
- verfolgt Gesamt-/Ausgabezeilen und Bytes
- optionale Artefakt-Spill-Datei (`artifactPath`, `artifactId`)
- wenn der In-Memory-Puffer den Schwellenwert überschreitet (`DEFAULT_MAX_BYTES`, sofern nicht überschrieben):
  - markiert als abgeschnitten
  - behält die letzten Bytes im Arbeitsspeicher (UTF-8-sichere Grenze)
  - kann den vollständigen Stream in eine Artefakt-Senke auslagern

`dump()` gibt zurück:

- sichtbaren Ausgabetext (möglicherweise am Ende abgeschnitten)
- Abschneide-Flag und Zählwerte
- Artefakt-ID (für `artifact://<id>`-Referenzen)

Das `python`-Werkzeug wandelt diese Metadaten in Ergebnis-Abschneidehinweise und TUI-Warnungen um.

Das `notebook`-Werkzeug verwendet `OutputSink` **nicht**; es verfügt über keine Stream-/Artefakt-Abschneidepipeline, da es keinen Code ausführt.

## 7) Renderer-Annahmen und Formatierung

## Notebook-Renderer (`notebookToolRenderer`)

- Aufrufansicht: Statuszeile mit Aktion + Notebook-Pfad + Zellen-/Typmetadaten
- Ergebnisansicht:
  - Erfolgszusammenfassung abgeleitet aus `details`
  - `cellSource` wird über `renderCodeCell` gerendert
  - Markdown-Zellen setzen den Sprachhinweis `markdown`; andere Zellen haben keine explizite Sprachüberschreibung
  - Das Limit für die eingeklappte Code-Vorschau ist `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - Unterstützt den erweiterten Modus über gemeinsame Render-Optionen
  - Verwendet Render-Cache, der nach Breite und erweitertem Zustand geordnet ist

Annahme beim Fehler-Rendering:

- Wenn der erste Textinhalt mit `Error:` beginnt, formatiert der Renderer ihn als Notebook-Fehlerblock.

## Python-Renderer (für tatsächliche Ausführungsausgabe)

Das kernelgestützte Ausführungs-Rendering erwartet:

- Zustandsübergänge pro Zelle (`pending/running/complete/error`)
- optionalen strukturierten Statusereignisbereich
- optionale JSON-Ausgabebäume
- Abschneidehinweise + optionalen `artifact://<id>`-Zeiger

Dieses Renderer-Verhalten steht in keiner Beziehung zu `notebook`-JSON-Bearbeitungsergebnissen, außer dass beide gemeinsame TUI-Primitive wiederverwenden.

## 8) Abweichung vom einfachen Python-Werkzeugverhalten

Wenn mit „einfachem Python-Werkzeug" der `python`-Ausführungspfad gemeint ist:

- `python` führt Code in einem Kernel aus, persistiert den Zustand nach Modus, streamt Chunks, erfasst Rich Displays, behandelt Unterbrechungen/Zeitlimits und unterstützt die Ausgabeabschneidung/Artefakte.
- `notebook` führt ausschließlich deterministische Notebook-JSON-Mutationen durch; keine Ausführung, kein Kernel-Zustand, kein Chunk-Stream, keine Display-Ausgaben, keine Artefaktpipeline.

Wenn ein Workflow beides benötigt:

1. Notebook-Quelle mit `notebook` bearbeiten
2. Code-Zellen über `python` ausführen (Code manuell übergeben), nicht über `notebook`

Die aktuelle Implementierung stellt kein einzelnes Werkzeug bereit, das sowohl `.ipynb`-Dateien mutiert als auch Notebook-Zellen über den Kernel-Kontext ausführt.
