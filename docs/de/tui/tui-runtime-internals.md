---
title: TUI-Laufzeit-Interna
description: >-
  Interna der Terminal-UI-Laufzeit, einschließlich Rendering-Pipeline,
  Eingabeverarbeitung und Zustandsverwaltung.
sidebar:
  order: 2
  label: Laufzeit-Interna
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# TUI-Laufzeit-Interna

Dieses Dokument beschreibt den themenunabhängigen Laufzeitpfad von der Terminaleingabe zur gerenderten Ausgabe im interaktiven Modus. Es konzentriert sich auf das Verhalten in `packages/tui` und dessen Integration aus `packages/coding-agent`-Controllern.

## Laufzeitschichten und Zuständigkeiten

- **`packages/tui`-Engine**: Terminal-Lebenszyklus, stdin-Normalisierung, Fokus-Routing, Render-Planung, differenzielles Painting, Overlay-Komposition, Hardware-Cursor-Platzierung.
- **`packages/coding-agent` interaktiver Modus**: erstellt den Komponentenbaum, bindet Editor-Callbacks und Tastenbelegungen, reagiert auf Agent/Session-Ereignisse und übersetzt den Domänenzustand (Streaming, Werkzeugausführung, Wiederholungsversuche, Planmodus) in UI-Komponenten.

Abgrenzungsregel: Die TUI-Engine ist nachrichtenunabhängig. Sie kennt nur `Component.render(width)`, `handleInput(data)`, Fokus und Overlays. Agent-Semantiken verbleiben in den interaktiven Controllern.

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

## Start und Aufbau des Komponentenbaums

`InteractiveMode` erstellt `TUI(new ProcessTerminal(), showHardwareCursor)` und erzeugt persistente Container:

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (enthält `CustomEditor`)

`init()` verbindet den Baum in dieser Reihenfolge, setzt den Fokus auf den Editor, registriert Eingabe-Handler über `InputController`, startet die TUI und fordert ein erzwungenes Rendering an.

Ein erzwungenes Rendering (`requestRender(true)`) setzt Caches für vorherige Zeilen und die Cursor-Buchführung zurück, bevor neu gezeichnet wird.

## Terminal-Lebenszyklus und stdin-Normalisierung

`ProcessTerminal.start()`:

1. Aktiviert den Raw-Modus und Bracketed Paste.
2. Fügt einen Resize-Handler hinzu.
3. Erstellt einen `StdinBuffer`, um unvollständige Escape-Sequenzen in vollständige Sequenzen aufzuteilen.
4. Fragt die Unterstützung des Kitty-Tastaturprotokolls ab (`CSI ? u`) und aktiviert anschließend Protokoll-Flags, falls unterstützt.
5. Unter Windows wird versucht, die VT-Eingabe über `kernel32`-Modus-Flags zu aktivieren.

`StdinBuffer`-Verhalten:

- Puffert fragmentierte Escape-Sequenzen (CSI/OSC/DCS/APC/SS3).
- Gibt `data` nur aus, wenn eine Sequenz vollständig ist oder per Timeout ausgeleert wurde.
- Erkennt Bracketed Paste und gibt ein `paste`-Ereignis mit dem rohen eingefügten Text aus.

Dies verhindert, dass unvollständige Escape-Sequenzen als normale Tastendrücke fehlinterpretiert werden.

## Eingabe-Routing und Fokusmodell

Eingabepfad:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Routing-Details:

1. Die TUI führt zuerst registrierte Eingabe-Listener aus (`addInputListener`), wodurch Consume/Transform-Verhalten ermöglicht wird.
2. Die TUI verarbeitet den globalen Debug-Shortcut (`shift+ctrl+d`), bevor die Komponente aufgerufen wird.
3. Falls die fokussierte Komponente zu einem Overlay gehört, das nun ausgeblendet/unsichtbar ist, weist die TUI den Fokus dem nächsten sichtbaren Overlay oder dem gespeicherten Fokus vor dem Overlay zu.
4. Key-Release-Ereignisse werden gefiltert, es sei denn, die fokussierte Komponente setzt `wantsKeyRelease = true`.
5. Nach der Weiterleitung plant die TUI ein Rendering.

`setFocus()` schaltet auch `Focusable.focused` um, was steuert, ob Komponenten `CURSOR_MARKER` für die Hardware-Cursor-Platzierung ausgeben.

## Aufteilung der Tastenverarbeitung: Editor vs. Controller

`CustomEditor` fängt zuerst hochpriore Kombinationen ab (Escape, Ctrl-C/D/Z, Ctrl-V, Ctrl-P-Varianten, Ctrl-T, Alt-Auf, benutzerdefinierte Erweiterungstasten) und delegiert den Rest an das Basis-`Editor`-Verhalten (Textbearbeitung, Verlauf, Autovervollständigung, Cursorbewegung).

`InputController.setupKeyHandlers()` bindet anschließend Editor-Callbacks an Modusaktionen:

- Abbruch / Modusbeendigung bei `Escape`
- Herunterfahren bei doppeltem `Ctrl+C` oder leerem Editor bei `Ctrl+D`
- Suspend/Resume bei `Ctrl+Z`
- Slash-Befehle und Selektor-Hotkeys
- Umschalten von Folgefragen/Dequeue und Erweiterungsumschalten

Dies hält das Tastenparsing/die Editor-Mechanik in `packages/tui` und die Modussemantiken in den Coding-Agent-Controllern.

## Render-Schleife und Diff-Strategie

`TUI.requestRender()` wird auf ein Rendering pro Tick mittels `process.nextTick` entprellt. Mehrere Zustandsänderungen im selben Durchlauf werden zusammengeführt.

Pipeline von `#doRender()`:

1. Rendert den Wurzel-Komponentenbaum nach `newLines`.
2. Setzt sichtbare Overlays zusammen (falls vorhanden).
3. Extrahiert und entfernt `CURSOR_MARKER` aus den sichtbaren Viewport-Zeilen.
4. Fügt Segment-Reset-Suffixe für Nicht-Bild-Zeilen hinzu.
5. Wählt zwischen vollständigem Neuzeichnen und differentiellem Patch:
   - erstes Frame
   - Breitenänderung
   - Verkleinerung mit aktiviertem `clearOnShrink` und keinen Overlays
   - Änderungen oberhalb des vorherigen Viewports
6. Bei differenziellen Aktualisierungen wird nur der geänderte Zeilenbereich gepatcht und veraltete nachfolgende Zeilen werden bei Bedarf gelöscht.
7. Neupositionierung des Hardware-Cursors für IME-Unterstützung.

Render-Schreibvorgänge verwenden den synchronisierten Ausgabemodus (`CSI ? 2026 h/l`), um Flackern/Tearing zu reduzieren.

## Sicherheitsbeschränkungen beim Rendering

Kritische Sicherheitsprüfungen in `TUI`:

- Nicht-Bild-gerenderte Zeilen dürfen die Terminalbreite nicht überschreiten; bei Überlauf wird eine Ausnahme ausgelöst und Absturz-Diagnosen werden geschrieben.
- Die Overlay-Komposition umfasst eine defensive Kürzung und eine Breitenüberprüfung nach der Komposition.
- Breitenänderungen erzwingen ein vollständiges Neuzeichnen, da sich die Umbruchsemantik ändert.
- Die Cursorposition wird vor der Bewegung begrenzt.

Diese Einschränkungen sind Laufzeit-Durchsetzung, nicht nur Konventionen.

## Größenänderungsbehandlung

Größenänderungsereignisse werden ereignisgesteuert von `ProcessTerminal` an `TUI.requestRender()` weitergeleitet.

Auswirkungen:

- Jede Breitenänderung löst ein vollständiges Neuzeichnen aus.
- Viewport/Top-Tracking (`#previousViewportTop`, `#maxLinesRendered`) vermeidet ungültige relative Cursor-Berechnungen bei Änderungen von Inhalt oder Terminalgröße.
- Die Overlay-Sichtbarkeit kann von den Terminalabmessungen abhängen (`OverlayOptions.visible`); der Fokus wird korrigiert, wenn Overlays nach einer Größenänderung unsichtbar werden.

## Streaming und inkrementelle UI-Aktualisierungen

`EventController` abonniert `AgentSessionEvent` und aktualisiert die UI inkrementell:

- `agent_start`: startet den Loader in `statusContainer`.
- `message_start` Assistent: erstellt `streamingComponent` und hängt es ein.
- `message_update`: aktualisiert den gestreamten Assistenten-Inhalt; erstellt/aktualisiert Werkzeugausführungs-Komponenten, wenn Werkzeugaufrufe erscheinen.
- `tool_execution_update/end`: aktualisiert Werkzeugergebnis-Komponenten und den Abschlussstatus.
- `message_end`: finalisiert den Assistenten-Stream, behandelt abgebrochene/Fehler-Annotationen, markiert ausstehende Werkzeugargumente bei normalem Stop als abgeschlossen.
- `agent_end`: stoppt Loader, löscht transienten Stream-Zustand, führt verzögerte Modellwechsel durch, gibt Abschlussbenachrichtigung aus, wenn im Hintergrund ausgeführt.

Die Read-Werkzeug-Gruppierung ist absichtlich zustandsbehaftet (`#lastReadGroup`), um aufeinanderfolgende Read-Werkzeugaufrufe in einem visuellen Block zusammenzufassen, bis ein Nicht-Read-Umbruch auftritt.

## Status- und Loader-Orchestrierung

Zuständigkeiten der Status-Lane:

- `statusContainer` enthält transiente Loader (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` rendert persistente Status-/Hooks-/Plan-Indikatoren und steuert die Aktualisierungen des oberen Editor-Rahmens.

Loader-Verhalten:

- `Loader` aktualisiert sich alle 80ms per Intervall und fordert pro Frame ein Rendering an.
- Escape-Handler werden während der automatischen Komprimierung und des automatischen Wiederholungsversuchs vorübergehend überschrieben, um diese Operationen abzubrechen.
- Bei Beendigungs-/Abbruchpfaden stellen Controller die vorherigen Escape-Handler wieder her und stoppen/leeren Loader-Komponenten.

## Modusübergänge und Hintergrundmodus

### Bash/Python-Eingabemodi

Texteingabe-Präfixe schalten Editor-Rahmenmodus-Flags um:

- `!` -> Bash-Modus
- `$` (kein Template-Literal-Präfix) -> Python-Modus

Escape beendet den inaktiven Modus durch Löschen des Editortexts und Wiederherstellen der Rahmenfarbe; wenn eine Ausführung aktiv ist, bricht Escape stattdessen die laufende Aufgabe ab.

### Planmodus

`InteractiveMode` verfolgt Planmodus-Flags, Status-Zeilen-Zustand, aktive Werkzeuge und Modellwechsel. Ein- und Ausstieg aktualisiert Sitzungsmoduseintragungen sowie Status/UI-Zustand, einschließlich eines verzögerten Modellwechsels, falls Streaming aktiv ist.

### Suspend/Resume (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. Registriert einen einmaligen `SIGCONT`-Handler, um die TUI neu zu starten und ein erzwungenes Rendering anzufordern.
2. Stoppt die TUI vor dem Suspend.
3. Sendet `SIGTSTP` an die Prozessgruppe.

### Hintergrundmodus (`/background` oder `/bg`)

`handleBackgroundCommand()`:

- Lehnt ab, wenn im Leerlauf.
- Wechselt den Werkzeug-UI-Kontext auf nicht-interaktiv (`hasUI=false`), sodass interaktive UI-Werkzeuge schnell fehlschlagen.
- Stoppt Loader/Statuszeile und hebt das Abonnement des Vordergrund-Ereignis-Handlers auf.
- Abonniert den Hintergrund-Ereignis-Handler (wartet primär auf `agent_end`).
- Stoppt die TUI und sendet `SIGTSTP` (POSIX-Job-Control-Pfad).

Bei `agent_end` im Hintergrund ohne eingereihte Arbeit sendet der Controller eine Abschlussbenachrichtigung und fährt herunter.

## Abbruchpfade

Primäre Abbrucheingaben:

- `Escape` während des aktiven Stream-Loaders: stellt eingereihte Nachrichten im Editor wieder her und bricht den Agenten ab.
- `Escape` während der Bash/Python-Ausführung: bricht den laufenden Befehl ab.
- `Escape` während der automatischen Komprimierung/Wiederholung: ruft dedizierte Abbruchmethoden über temporäre Escape-Handler auf.
- Einzelner `Ctrl+C`-Druck: Editor leeren; doppelter Druck innerhalb von 500ms: Herunterfahren.

Der Abbruch ist zustandsabhängig; dieselbe Taste kann je nach Laufzeitzustand Abbruch, Modusbeendigung, Selektor-Auslösung oder keine Aktion bedeuten.

## Ereignisgesteuerte vs. gedrosselte Verarbeitung

Ereignisgesteuerte Aktualisierungen:

- Agent-Session-Ereignisse (`EventController`)
- Tasten-Eingabe-Callbacks (`InputController`)
- Terminal-Größenänderungs-Callback
- Themen-/Branch-Watcher in `InteractiveMode`

Gedrosselte/entprellte Pfade:

- TUI-Rendering ist Tick-entprellt (Zusammenführung von `requestRender`).
- Loader-Animation ist festintervallbasiert (80ms), wobei jedes Frame ein Rendering anfordert.
- Editor-Autovervollständigungsaktualisierungen (innerhalb von `Editor`) verwenden Entprell-Timer, um Neuberechnungen während des Tippens zu reduzieren.

Die Laufzeit kombiniert daher ereignisgesteuerte Zustandsübergänge mit begrenzter Render-Kadenz, um die Interaktivität reaktionsschnell zu halten, ohne Rendering-Stürme zu verursachen.
