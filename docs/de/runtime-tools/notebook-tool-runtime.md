---
title: Interne Funktionsweise des Notebook-Tool-Laufzeitsystems
description: >-
  Jupyter-Notebook-Tool-Laufzeitsystem mit Zellausführung, Kernel-Lebenszyklus
  und Ausgabe-Rendering.
sidebar:
  order: 2
  label: Notebook-Tool
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# Interne Funktionsweise des Notebook-Tool-Laufzeitsystems

Dieses Dokument beschreibt die aktuelle Implementierung des `notebook`-Tools und dessen Beziehung zur Kernel-gestützten Python-Laufzeitumgebung.

Die entscheidende Unterscheidung: **`notebook` ist ein JSON-Notebook-Editor, kein Notebook-Executor**. Es bearbeitet `.ipynb`-Zellquellen direkt; es startet keinen Python-Kernel und kommuniziert auch nicht mit einem.

## Implementierungsdateien

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) Laufzeitgrenze: Bearbeiten vs. Ausführen

## `notebook`-Tool (`src/tools/notebook.ts`)

- Unterstützt `action: edit | insert | delete` auf einer `.ipynb`-Datei.
- Löst den Pfad relativ zum Sitzungs-CWD auf (`resolveToCwd`).
- Lädt Notebook-JSON, validiert das `cells`-Array, validiert die `cell_index`-Grenzen.
- Wendet Quelländerungen im Arbeitsspeicher an und schreibt das vollständige Notebook-JSON mit `JSON.stringify(notebook, null, 1)` zurück.
- Gibt eine textuelle Zusammenfassung + strukturierte `details` zurück (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`).

In diesem Tool existiert kein Kernel-Lebenszyklus:

- keine Gateway-Beschaffung
- keine Kernel-Sitzungs-ID
- kein `execute_request`
- keine Stream-Chunks von Kernel-Kanälen
- keine Rich-Display-Erfassung (`image/png`, JSON-Display, Status-MIME)

## Notebook-ähnlicher Ausführungspfad (`src/tools/python.ts` + `src/ipy/*`)

Wenn der Agent zellähnlichen Python-Code ausführen muss (sequenzielle Zellen, persistenter Zustand, Rich-Displays), erfolgt dies über das **`python`-Tool**, nicht über `notebook`.

In diesem Pfad befinden sich die Kernel-Modi, das Neustart-/Abbruchverhalten, das Chunk-Streaming und die Ausgabe-Artefakt-Kürzung.

## 2) Semantik der Notebook-Zellbehandlung (`notebook`-Tool)

## Quellnormalisierung

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
  - gibt entfernten `source` in den Details für die Renderer-Vorschau zurück

## Fehleroberflächen

Harte Fehler werden ausgelöst bei:

- fehlender Notebook-Datei
- ungültigem JSON
- fehlendem/nicht-Array `cells`
- Index außerhalb des gültigen Bereichs (Einfügen und Nicht-Einfügen haben unterschiedliche gültige Bereiche)
- fehlendem `content` für `edit`/`insert`

Diese werden zu `Error:`-Tool-Antworten im übergeordneten System; der Renderer verwendet den Notebook-Pfad + formatierten Fehlertext.

## 3) Kernel-Sitzungssemantik (wo sie tatsächlich existiert)

Die Kernel-Semantik ist in `executePython` / `PythonKernel` implementiert und gilt für das `python`-Tool.

## Modi

`PythonKernelMode`:

- `session` (Standard)
  - Kernel werden in der `kernelSessions`-Map zwischengespeichert
  - maximal 4 Sitzungen; älteste werden bei Überlauf verdrängt
  - Idle-/Dead-Bereinigung alle 30 Sekunden, Timeout nach 5 Minuten
  - pro Sitzung serialisiert eine Warteschlange die Ausführung (`session.queue`)
- `per-call`
  - erstellt einen Kernel pro Anfrage
  - führt aus
  - fährt den Kernel immer im `finally`-Block herunter

## Rücksetzverhalten

Das `python`-Tool übergibt `reset` nur für die erste Zelle in einem Mehrfachzellen-Aufruf; spätere Zellen werden immer mit `reset: false` ausgeführt.

## Kernel-Tod / Neustart / Wiederholung

Im Sitzungsmodus (`withKernelSession`):

- Toter Kernel wird durch Heartbeat erkannt (`kernel.isAlive()`-Prüfung alle 5 Sekunden) oder Ausführungsfehler.
- Ein vor der Ausführung erkannter Totzustand löst `restartKernelSession` aus.
- Der Absturzpfad während der Ausführung wiederholt einmal: Kernel neu starten, Handler erneut ausführen.
- `restartCount > 1` in derselben Sitzung wirft `Python kernel restarted too many times in this session`.

Startup-Wiederholungsverhalten:

- Die Kernel-Erstellung über das Shared-Gateway wiederholt einmal bei `SharedGatewayCreateError` mit HTTP 5xx.

Wiederherstellung bei Ressourcenerschöpfung:

- Erkennt `EMFILE`/`ENFILE`/"Too many open files"-artige Fehler
- Löscht verfolgte Sitzungen
- Ruft `shutdownSharedGateway()` auf
- Wiederholt die Kernel-Sitzungserstellung einmal

## 4) Umgebungs-/Sitzungsvariablen-Injektion

Der Kernel-Start empfängt eine optionale Env-Map vom Executor:

- `PI_SESSION_FILE` (Pfad zur Sitzungszustandsdatei)
- `ARTIFACTS` (Artefakt-Verzeichnis)

`PythonKernel.#initializeKernelEnvironment(...)` führt dann ein Init-Skript innerhalb des Kernels aus, um:

- `os.chdir(cwd)` auszuführen
- Env-Einträge in `os.environ` zu injizieren
- cwd an `sys.path` voranzustellen, falls fehlend

Implikation:

- Prelude-Hilfsfunktionen, die Sitzungs- oder Artefaktkontext lesen, sind auf diese Umgebungsvariablen im Python-Prozesszustand angewiesen.

## 5) Streaming-/Chunk- und Display-Behandlung (Kernel-gestützter Pfad)

Der Kernel-Client verarbeitet Jupyter-Protokollnachrichten pro Ausführung:

- `stream` -> Text-Chunk an `onChunk`
- `execute_result` / `display_data` ->
  - Anzeigetext wird nach MIME-Priorität gewählt: `text/markdown` > `text/plain` > konvertiertes `text/html`
  - Strukturierte Ausgaben werden separat erfasst:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (keine Textausgabe)
- `error` -> Traceback-Text wird in den Chunk-Stream geschoben + strukturierte Fehlermetadaten
- `input_request` -> gibt Stdin-Warnungstext aus, sendet leere `input_reply`, markiert Stdin als angefordert
- Abschluss wartet sowohl auf `execute_reply` als auch auf Kernel-`status=idle`

Abbruch/Timeout:

- Abbruchsignal löst `interrupt()` aus (REST `/interrupt` + Control-Channel `interrupt_request`)
- Ergebnis wird mit `cancelled=true` markiert
- Der Timeout-Pfad versieht die Ausgabe mit dem Hinweis `Command timed out after <n> seconds`

## 6) Kürzungs- und Artefaktverhalten

`OutputSink` in `src/session/streaming-output.ts` wird von Kernel-Ausführungspfaden verwendet (`executeWithKernel`):

- Bereinigt jeden Chunk (`sanitizeText`)
- Verfolgt Gesamt-/Ausgabezeilen und -Bytes
- Optionale Artefakt-Spilldatei (`artifactPath`, `artifactId`)
- Wenn der Arbeitsspeicher-Puffer den Schwellenwert überschreitet (`DEFAULT_MAX_BYTES`, sofern nicht überschrieben):
  - markiert als gekürzt
  - behält Tail-Bytes im Arbeitsspeicher (UTF-8-sichere Grenze)
  - kann den vollständigen Stream in die Artefakt-Senke auslagern

`dump()` gibt zurück:

- sichtbaren Ausgabetext (möglicherweise am Ende gekürzt)
- Kürzungs-Flag + Zähler
- Artefakt-ID (für `artifact://<id>`-Referenzen)

Das `python`-Tool konvertiert diese Metadaten in Kürzungshinweise und TUI-Warnungen.

Das `notebook`-Tool verwendet **nicht** `OutputSink`; es hat keine Stream-/Artefakt-Kürzungspipeline, da es keinen Code ausführt.

## 7) Renderer-Annahmen und Formatierung

## Notebook-Renderer (`notebookToolRenderer`)

- Aufrufansicht: Statuszeile mit Aktion + Notebook-Pfad + Zell-/Typ-Metadaten
- Ergebnisansicht:
  - Erfolgszusammenfassung abgeleitet aus `details`
  - `cellSource` wird über `renderCodeCell` gerendert
  - Markdown-Zellen setzen den Sprachhinweis `markdown`; andere Zellen haben keine explizite Sprachüberschreibung
  - Die eingeklappte Code-Vorschaugrenze beträgt `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - Unterstützt den erweiterten Modus über gemeinsame Render-Optionen
  - Verwendet Render-Cache, der nach Breite + erweitertem Zustand geschlüsselt ist

Annahme bei der Fehlerdarstellung:

- Wenn der erste Textinhalt mit `Error:` beginnt, formatiert der Renderer ihn als Notebook-Fehlerblock.

## Python-Renderer (für tatsächliche Ausführungsausgabe)

Das Kernel-gestützte Ausführungs-Rendering erwartet:

- Statuszustandsübergänge pro Zelle (`pending/running/complete/error`)
- optionalen strukturierten Statusereignis-Abschnitt
- optionale JSON-Ausgabebäume
- Kürzungswarnungen + optionalen `artifact://<id>`-Zeiger

Dieses Renderer-Verhalten steht in keinem Zusammenhang mit `notebook`-JSON-Bearbeitungsergebnissen, außer dass beide gemeinsame TUI-Grundelemente wiederverwenden.

## 8) Abweichung vom Verhalten des reinen Python-Tools

Wenn "reines Python-Tool" den `python`-Ausführungspfad meint:

- `python` führt Code in einem Kernel aus, persistiert den Zustand nach Modus, streamt Chunks, erfasst Rich-Displays, behandelt Interrupts/Timeouts und unterstützt Ausgabekürzung/Artefakte.
- `notebook` führt ausschließlich deterministische Notebook-JSON-Mutationen durch; keine Ausführung, kein Kernel-Zustand, kein Chunk-Stream, keine Display-Ausgaben, keine Artefakt-Pipeline.

Wenn ein Workflow beides benötigt:

1. Notebook-Quelle mit `notebook` bearbeiten
2. Code-Zellen über `python` ausführen (Code manuell übergeben), nicht über `notebook`

Die aktuelle Implementierung bietet kein einzelnes Tool, das sowohl `.ipynb` mutiert als auch Notebook-Zellen über den Kernel-Kontext ausführt.
