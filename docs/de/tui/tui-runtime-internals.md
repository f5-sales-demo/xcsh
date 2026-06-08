---
title: TUI Runtime Internals
description: >-
  Interne Funktionsweise der Terminal-UI-Laufzeitumgebung, einschließlich
  Rendering-Pipeline, Eingabeverarbeitung und Zustandsverwaltung.
sidebar:
  order: 2
  label: Runtime-Interna
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# TUI-Runtime-Interna

Dieses Dokument beschreibt den nicht-themenbezogenen Laufzeitpfad von der Terminaleingabe bis zur gerenderten Ausgabe im interaktiven Modus. Der Schwerpunkt liegt auf dem Verhalten in `packages/tui` und dessen Integration über die Controller in `packages/coding-agent`.

## Laufzeitschichten und Zuständigkeiten

- **`packages/tui`-Engine**: Terminal-Lebenszyklus, Stdin-Normalisierung, Fokus-Routing, Render-Scheduling, differentielles Painting, Overlay-Komposition, Hardware-Cursor-Platzierung.
- **`packages/coding-agent` interaktiver Modus**: erstellt den Komponentenbaum, bindet Editor-Callbacks und Keymaps, reagiert auf Agent-/Session-Ereignisse und übersetzt Domänenzustand (Streaming, Tool-Ausführung, Wiederholungen, Plan-Modus) in UI-Komponenten.

Grenzregel: Die TUI-Engine ist nachrichtenagnostisch. Sie kennt nur `Component.render(width)`, `handleInput(data)`, Fokus und Overlays. Agenten-Semantik verbleibt in den interaktiven Controllern.

## Implementierungsdateien

- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/components/custom-editor.ts`](../../packages/coding-agent/src/modes/components/custom-editor.ts)
- [`../../tui/src/tui.ts`](../../packages/tui/src/tui.ts)
- [`../../tui/src/terminal.ts`](../../packages/tui/src/terminal.ts)
- [`../../tui/src/editor-component.ts`](../../packages/tui/src/editor-component.ts)
- [`../../tui/src/stdin-buffer.ts`](../../packages/tui/src/stdin-buffer.ts)
- [`../../tui/src/components/loader.ts`](../../packages/tui/src/components/loader.ts)

## Boot und Komponentenbaum-Aufbau

`InteractiveMode` konstruiert `TUI(new ProcessTerminal(), showHardwareCursor)` und erstellt persistente Container:

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (enthält `CustomEditor`)

`init()` verbindet den Baum in dieser Reihenfolge, fokussiert den Editor, registriert Eingabe-Handler über `InputController`, startet die TUI und fordert ein erzwungenes Rendering an.

Ein erzwungenes Rendering (`requestRender(true)`) setzt vorherige Zeilen-Caches und Cursor-Buchhaltung zurück, bevor neu gezeichnet wird.

## Terminal-Lebenszyklus und Stdin-Normalisierung

`ProcessTerminal.start()`:

1. Aktiviert Raw-Modus und Bracketed Paste.
2. Registriert Resize-Handler.
3. Erstellt einen `StdinBuffer`, um partielle Escape-Chunks in vollständige Sequenzen aufzuteilen.
4. Fragt Kitty-Keyboard-Protokoll-Unterstützung ab (`CSI ? u`) und aktiviert dann Protokoll-Flags, falls unterstützt.
5. Unter Windows wird versucht, VT-Eingabe über `kernel32`-Modus-Flags zu aktivieren.

`StdinBuffer`-Verhalten:

- Puffert fragmentierte Escape-Sequenzen (CSI/OSC/DCS/APC/SS3).
- Emittiert `data` nur, wenn eine Sequenz vollständig ist oder per Timeout geflusht wird.
- Erkennt Bracketed Paste und emittiert ein `paste`-Ereignis mit dem rohen eingefügten Text.

Dies verhindert, dass partielle Escape-Chunks als normale Tastendrücke fehlinterpretiert werden.

## Eingabe-Routing und Fokus-Modell

Eingabepfad:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Routing-Details:

1. TUI führt zuerst registrierte Eingabe-Listener aus (`addInputListener`), was Consume-/Transform-Verhalten ermöglicht.
2. TUI verarbeitet den globalen Debug-Shortcut (`shift+ctrl+d`) vor der Komponenten-Weiterleitung.
3. Wenn die fokussierte Komponente zu einem Overlay gehört, das nun ausgeblendet/unsichtbar ist, weist TUI den Fokus dem nächsten sichtbaren Overlay oder dem gespeicherten Vor-Overlay-Fokus zu.
4. Key-Release-Ereignisse werden gefiltert, es sei denn, die fokussierte Komponente setzt `wantsKeyRelease = true`.
5. Nach der Weiterleitung plant TUI ein Rendering.

`setFocus()` schaltet auch `Focusable.focused` um, was steuert, ob Komponenten `CURSOR_MARKER` für die Hardware-Cursor-Platzierung emittieren.

## Aufteilung der Tastaturverarbeitung: Editor vs. Controller

`CustomEditor` fängt zuerst hochprioritäre Kombinationen ab (Escape, Strg-C/D/Z, Strg-V, Strg-P-Varianten, Strg-T, Alt-Hoch, benutzerdefinierte Erweiterungstasten) und delegiert den Rest an das Basis-`Editor`-Verhalten (Textbearbeitung, History, Autovervollständigung, Cursorbewegung).

`InputController.setupKeyHandlers()` bindet dann Editor-Callbacks an Modus-Aktionen:

- Abbruch / Modus-Exits bei `Escape`
- Herunterfahren bei doppeltem `Strg+C` oder `Strg+D` bei leerem Editor
- Suspend/Resume bei `Strg+Z`
- Slash-Befehle und Selektor-Hotkeys
- Follow-up/Dequeue-Umschalter und Erweiterungs-Umschalter

Dies hält Tasten-Parsing/Editor-Mechaniken in `packages/tui` und Modus-Semantik in den Coding-Agent-Controllern.

## Render-Schleife und Differenzierungsstrategie

`TUI.requestRender()` wird auf ein Rendering pro Tick mittels `process.nextTick` entprellt. Mehrere Zustandsänderungen im selben Turn werden zusammengefasst.

`#doRender()`-Pipeline:

1. Root-Komponentenbaum zu `newLines` rendern.
2. Sichtbare Overlays komponieren (falls vorhanden).
3. `CURSOR_MARKER` aus sichtbaren Viewport-Zeilen extrahieren und entfernen.
4. Segment-Reset-Suffixe für Nicht-Bild-Zeilen anhängen.
5. Zwischen vollständigem Neuzeichnen und differentiellem Patch wählen:
   - Erster Frame
   - Breitenänderung
   - Verkleinerung mit aktiviertem `clearOnShrink` und ohne Overlays
   - Bearbeitungen oberhalb des vorherigen Viewports
6. Bei differentiellen Updates nur den geänderten Zeilenbereich patchen und bei Bedarf veraltete nachfolgende Zeilen löschen.
7. Hardware-Cursor für IME-Unterstützung neu positionieren.

Render-Schreibvorgänge verwenden den synchronisierten Ausgabemodus (`CSI ? 2026 h/l`), um Flackern/Tearing zu reduzieren.

## Render-Sicherheitsbeschränkungen

Kritische Sicherheitsprüfungen in `TUI`:

- Gerenderte Nicht-Bild-Zeilen dürfen die Terminalbreite nicht überschreiten; Überlauf löst einen Fehler aus und schreibt Crash-Diagnosen.
- Overlay-Komposition beinhaltet defensive Kürzung und Post-Komposit-Breitenverifikation.
- Breitenänderungen erzwingen ein vollständiges Neuzeichnen, da sich die Umbruch-Semantik ändert.
- Die Cursorposition wird vor der Bewegung begrenzt.

Diese Einschränkungen sind Laufzeit-Durchsetzungen, nicht nur Konventionen.

## Resize-Behandlung

Resize-Ereignisse werden ereignisgesteuert von `ProcessTerminal` an `TUI.requestRender()` weitergeleitet.

Auswirkungen:

- Jede Breitenänderung löst ein vollständiges Neuzeichnen aus.
- Viewport-/Top-Tracking (`#previousViewportTop`, `#maxLinesRendered`) vermeidet ungültige relative Cursor-Berechnungen, wenn sich Inhalt oder Terminalgröße ändert.
- Overlay-Sichtbarkeit kann von den Terminaldimensionen abhängen (`OverlayOptions.visible`); der Fokus wird korrigiert, wenn Overlays nach einem Resize nicht mehr sichtbar sind.

## Streaming und inkrementelle UI-Updates

`EventController` abonniert `AgentSessionEvent` und aktualisiert die UI inkrementell:

- `agent_start`: startet Loader in `statusContainer`.
- `message_start` assistant: erstellt `streamingComponent` und hängt es ein.
- `message_update`: aktualisiert den Streaming-Assistenten-Inhalt; erstellt/aktualisiert Tool-Ausführungskomponenten, sobald Tool-Aufrufe erscheinen.
- `tool_execution_update/end`: aktualisiert Tool-Ergebniskomponenten und Abschlusszustand.
- `message_end`: finalisiert den Assistenten-Stream, verarbeitet Abbruch-/Fehler-Annotationen, markiert ausstehende Tool-Argumente als vollständig bei normalem Stopp.
- `agent_end`: stoppt Loader, löscht transienten Stream-Zustand, flusht aufgeschobenen Modellwechsel, sendet Abschlussbenachrichtigung bei Hintergrund-Ausführung.

Read-Tool-Gruppierung ist absichtlich zustandsbehaftet (`#lastReadGroup`), um aufeinanderfolgende Read-Tool-Aufrufe in einen visuellen Block zusammenzufassen, bis ein Nicht-Read-Unterbrechung auftritt.

## Status- und Loader-Orchestrierung

Status-Bereich-Zuständigkeiten:

- `statusContainer` hält transiente Loader (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` rendert persistente Status-/Hooks-/Plan-Indikatoren und steuert Editor-Oberkanten-Aktualisierungen.

Loader-Verhalten:

- `Loader` aktualisiert alle 80ms per Intervall und fordert bei jedem Frame ein Rendering an.
- Escape-Handler werden während Auto-Compaction und Auto-Retry temporär überschrieben, um diese Operationen abbrechen zu können.
- Bei End-/Abbruch-Pfaden stellen Controller vorherige Escape-Handler wieder her und stoppen/löschen Loader-Komponenten.

## Modus-Übergänge und Hintergrund-Ausführung

### Bash-/Python-Eingabemodi

Texteingabe-Präfixe schalten Editor-Rahmen-Modus-Flags um:

- `!` -> Bash-Modus
- `$` (Nicht-Template-Literal-Präfix) -> Python-Modus

Escape beendet den inaktiven Modus, indem der Editor-Text gelöscht und die Rahmenfarbe wiederhergestellt wird; bei aktiver Ausführung bricht Escape stattdessen die laufende Aufgabe ab.

### Plan-Modus

`InteractiveMode` verfolgt Plan-Modus-Flags, Status-Zeilen-Zustand, aktive Tools und Modellwechsel. Eintreten/Verlassen aktualisiert Session-Modus-Einträge und Status-/UI-Zustand, einschließlich aufgeschobenem Modellwechsel bei aktivem Streaming.

### Suspend/Resume (`Strg+Z`)

`InputController.handleCtrlZ()`:

1. Registriert einen einmaligen `SIGCONT`-Handler, um die TUI neu zu starten und ein Rendering zu erzwingen.
2. Stoppt die TUI vor dem Suspend.
3. Sendet `SIGTSTP` an die Prozessgruppe.

### Hintergrund-Modus (`/background` oder `/bg`)

`handleBackgroundCommand()`:

- Lehnt ab, wenn im Leerlauf.
- Wechselt den Tool-UI-Kontext auf nicht-interaktiv (`hasUI=false`), sodass interaktive UI-Tools schnell fehlschlagen.
- Stoppt Loader/Statuszeile und meldet den Vordergrund-Event-Handler ab.
- Abonniert den Hintergrund-Event-Handler (wartet primär auf `agent_end`).
- Stoppt die TUI und sendet `SIGTSTP` (POSIX-Job-Control-Pfad).

Bei `agent_end` im Hintergrund ohne Warteschlangen-Arbeit sendet der Controller eine Abschlussbenachrichtigung und fährt herunter.

## Abbruch-Pfade

Primäre Abbruch-Eingaben:

- `Escape` während des aktiven Stream-Loaders: stellt wartende Nachrichten im Editor wieder her und bricht den Agenten ab.
- `Escape` während der Bash-/Python-Ausführung: bricht den laufenden Befehl ab.
- `Escape` während Auto-Compaction/Retry: ruft dedizierte Abbruch-Methoden über temporäre Escape-Handler auf.
- `Strg+C` einfacher Druck: Editor leeren; doppelter Druck innerhalb von 500ms: Herunterfahren.

Abbruch ist zustandsabhängig; dieselbe Taste kann je nach Laufzeitzustand Abbruch, Modus-Exit, Selektor-Auslöser oder No-Op bedeuten.

## Ereignisgesteuertes vs. gedrosseltes Verhalten

Ereignisgesteuerte Updates:

- Agenten-Session-Ereignisse (`EventController`)
- Tasteneingabe-Callbacks (`InputController`)
- Terminal-Resize-Callback
- Theme-/Branch-Watcher in `InteractiveMode`

Gedrosselte/entprellte Pfade:

- TUI-Rendering ist tick-entprellt (`requestRender`-Zusammenfassung).
- Loader-Animation hat ein festes Intervall (80ms), wobei jeder Frame ein Rendering anfordert.
- Editor-Autovervollständigungs-Updates (innerhalb von `Editor`) verwenden Entprell-Timer, um Neuberechnungen während des Tippens zu reduzieren.

Die Laufzeitumgebung mischt daher ereignisgesteuerte Zustandsübergänge mit begrenzter Render-Kadenz, um die Interaktivität reaktionsfähig zu halten, ohne Neuzeichnungs-Stürme zu verursachen.
