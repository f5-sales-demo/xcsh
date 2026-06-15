---
title: TUI Laufzeit-Interna
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

# TUI Laufzeit-Interna

Dieses Dokument beschreibt den Laufzeitpfad außerhalb des Themes – von der Terminalein­gabe bis zur gerenderten Ausgabe im interaktiven Modus. Der Fokus liegt auf dem Verhalten in `packages/tui` und dessen Integration durch `packages/coding-agent`-Controller.

## Laufzeitschichten und Zuständigkeiten

- **`packages/tui`-Engine**: Terminal-Lebenszyklus, stdin-Normalisierung, Fokus-Routing, Render-Scheduling, differenzielles Zeichnen, Overlay-Komposition, Hardware-Cursor-Platzierung.
- **`packages/coding-agent` interaktiver Modus**: erstellt den Komponentenbaum, bindet Editor-Callbacks und Keymaps, reagiert auf Agent-/Session-Ereignisse und übersetzt den Domänenzustand (Streaming, Werkzeugausführung, Wiederholungen, Plan-Modus) in UI-Komponenten.

Grenzregel: Die TUI-Engine ist nachrichtenagnostisch. Sie kennt nur `Component.render(width)`, `handleInput(data)`, Fokus und Overlays. Agent-Semantik verbleibt in den interaktiven Controllern.

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

`InteractiveMode` instanziiert `TUI(new ProcessTerminal(), showHardwareCursor)` und erstellt persistente Container:

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (enthält `CustomEditor`)

`init()` verdrahtet den Baum in dieser Reihenfolge, setzt den Fokus auf den Editor, registriert Eingabe-Handler über `InputController`, startet die TUI und fordert ein erzwungenes Rendering an.

Ein erzwungenes Rendering (`requestRender(true)`) setzt Zeilencaches und Cursor-Bookkeeping zurück, bevor neu gezeichnet wird.

## Terminal-Lebenszyklus und stdin-Normalisierung

`ProcessTerminal.start()`:

1. Aktiviert Raw-Modus und Bracketed Paste.
2. Fügt einen Resize-Handler ein.
3. Erstellt einen `StdinBuffer`, um fragmentierte Escape-Chunks in vollständige Sequenzen aufzuteilen.
4. Fragt die Unterstützung des Kitty-Keyboard-Protokolls ab (`CSI ? u`) und aktiviert Protokoll-Flags, sofern unterstützt.
5. Versucht unter Windows die VT-Eingabe-Aktivierung über `kernel32`-Modus-Flags.

Verhalten von `StdinBuffer`:

- Puffert fragmentierte Escape-Sequenzen (CSI/OSC/DCS/APC/SS3).
- Gibt `data` nur aus, wenn eine Sequenz vollständig ist oder nach einem Timeout geleert wird.
- Erkennt Bracketed Paste und gibt ein `paste`-Ereignis mit dem unverarbeiteten eingefügten Text aus.

Dies verhindert, dass fragmentierte Escape-Chunks fälschlicherweise als normale Tastenanschläge interpretiert werden.

## Eingabe-Routing und Fokusmodell

Eingabepfad:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Details zum Routing:

1. Die TUI führt zunächst registrierte Eingabe-Listener aus (`addInputListener`), was ein Verbrauchs-/Transformationsverhalten ermöglicht.
2. Die TUI verarbeitet den globalen Debug-Shortcut (`shift+ctrl+d`), bevor die Komponente den Dispatch erhält.
3. Falls die fokussierte Komponente zu einem Overlay gehört, das nun ausgeblendet/unsichtbar ist, weist die TUI den Fokus dem nächsten sichtbaren Overlay oder dem gespeicherten Fokus vor dem Overlay zu.
4. Key-Release-Ereignisse werden herausgefiltert, es sei denn, die fokussierte Komponente setzt `wantsKeyRelease = true`.
5. Nach dem Dispatch plant die TUI ein Rendering.

`setFocus()` schaltet auch `Focusable.focused` um, was steuert, ob Komponenten `CURSOR_MARKER` für die Hardware-Cursor-Platzierung ausgeben.

## Aufteilung der Tastaturverarbeitung: Editor vs. Controller

`CustomEditor` fängt hochpriore Kombinationen zuerst ab (Escape, Strg-C/D/Z, Strg-V, Strg-P-Varianten, Strg-T, Alt-Pfeil-hoch, benutzerdefinierte Erweiterungstasten) und delegiert den Rest an das Basisverhalten von `Editor` (Textbearbeitung, Verlauf, Autovervollständigung, Cursor-Bewegung).

`InputController.setupKeyHandlers()` bindet anschließend Editor-Callbacks an Modus-Aktionen:

- Abbruch / Modusbeendigung bei `Escape`
- Herunterfahren bei doppeltem `Strg+C` oder `Strg+D` bei leerem Editor
- Suspend/Resume bei `Strg+Z`
- Slash-Befehle und Selektor-Hotkeys
- Toggles für Folgeverarbeitung/Warteschlangen-Dequeue und Erweiterungsstufen

Dadurch verbleiben die Tastaturanalyse und Editor-Mechanik in `packages/tui`, während die Modussemantik in den Coding-Agent-Controllern bleibt.

## Render-Schleife und Diff-Strategie

`TUI.requestRender()` wird per `process.nextTick` auf ein Rendering pro Tick entprellt. Mehrere Zustandsänderungen im selben Durchlauf werden zusammengefasst.

Pipeline von `#doRender()`:

1. Rendert den Root-Komponentenbaum zu `newLines`.
2. Setzt sichtbare Overlays zusammen (sofern vorhanden).
3. Extrahiert und entfernt `CURSOR_MARKER` aus den sichtbaren Viewport-Zeilen.
4. Fügt Segment-Reset-Suffixe für Nicht-Bild-Zeilen an.
5. Wählt zwischen vollständigem Neuzeichnen und differentiellem Patch:
   - Erstes Frame
   - Breitenänderung
   - Verkleinerung mit aktiviertem `clearOnShrink` und ohne Overlays
   - Bearbeitungen oberhalb des vorherigen Viewports
6. Bei differenziellen Aktualisierungen wird nur der geänderte Zeilenbereich gepatcht und veraltete nachlaufende Zeilen werden bei Bedarf gelöscht.
7. Neupositionierung des Hardware-Cursors für IME-Unterstützung.

Render-Schreibvorgänge verwenden den synchronisierten Ausgabemodus (`CSI ? 2026 h/l`), um Flimmern und Tearing zu reduzieren.

## Sicherheitsbeschränkungen beim Rendering

Kritische Sicherheitsprüfungen in `TUI`:

- Gerenderte Nicht-Bild-Zeilen dürfen die Terminalbreite nicht überschreiten; bei Überlauf wird eine Ausnahme ausgelöst und Absturz-Diagnosedaten werden geschrieben.
- Die Overlay-Komposition umfasst defensive Kürzung und eine Breitenprüfung nach der Komposition.
- Breitenänderungen erzwingen ein vollständiges Neuzeichnen, da sich die Umbruchsemantik ändert.
- Die Cursorposition wird vor der Bewegung begrenzt.

Diese Einschränkungen sind Laufzeit-Erzwingungen, nicht nur Konventionen.

## Resize-Verarbeitung

Resize-Ereignisse werden ereignisgesteuert von `ProcessTerminal` an `TUI.requestRender()` weitergeleitet.

Auswirkungen:

- Jede Breitenänderung löst ein vollständiges Neuzeichnen aus.
- Das Viewport-/Top-Tracking (`#previousViewportTop`, `#maxLinesRendered`) vermeidet ungültige relative Cursor-Berechnungen bei Änderungen des Inhalts oder der Terminalgröße.
- Die Overlay-Sichtbarkeit kann von den Terminalabmessungen abhängen (`OverlayOptions.visible`); der Fokus wird korrigiert, wenn Overlays nach einem Resize nicht mehr sichtbar sind.

## Streaming und inkrementelle UI-Aktualisierungen

`EventController` abonniert `AgentSessionEvent` und aktualisiert die UI inkrementell:

- `agent_start`: Startet den Loader in `statusContainer`.
- `message_start` Assistent: Erstellt `streamingComponent` und bindet es ein.
- `message_update`: Aktualisiert den gestreamten Assistenteninhalt; erstellt/aktualisiert Werkzeugausführungs-Komponenten, sobald Werkzeugaufrufe erscheinen.
- `tool_execution_update/end`: Aktualisiert Werkzeugergebnis-Komponenten und den Abschluss-Status.
- `message_end`: Schließt den Assistenten-Stream ab, verarbeitet abgebrochene/Fehler-Annotationen, markiert ausstehende Werkzeugargumente bei normalem Stop als abgeschlossen.
- `agent_end`: Stoppt Loader, löscht transienten Stream-Zustand, führt aufgeschobene Modellwechsel durch, gibt bei Hintergrundausführung eine Abschlussbenachrichtigung aus.

Das Gruppieren von Read-Werkzeugen ist absichtlich zustandsbehaftet (`#lastReadGroup`), um aufeinanderfolgende Read-Werkzeugaufrufe zu einem visuellen Block zusammenzufassen, bis ein Nicht-Read-Unterbrecher auftritt.

## Status- und Loader-Orchestrierung

Zuständigkeit für die Status-Lane:

- `statusContainer` enthält transiente Loader (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` rendert persistente Status-/Hook-/Plan-Indikatoren und steuert die Aktualisierungen des oberen Editor-Rahmens.

Loader-Verhalten:

- `Loader` aktualisiert alle 80 ms über ein Intervall und fordert pro Frame ein Rendering an.
- Escape-Handler werden während der automatischen Komprimierung und automatischer Wiederholung temporär überschrieben, um diese Vorgänge abbrechen zu können.
- Bei Beendigungs-/Abbruchpfaden stellen Controller die vorherigen Escape-Handler wieder her und stoppen/löschen Loader-Komponenten.

## Modusübergänge und Hintergrundausführung

### Bash-/Python-Eingabemodi

Texteingabe-Präfixe schalten Editor-Rahmenmodus-Flags um:

- `!` -> Bash-Modus
- `$` (kein Template-Literal-Präfix) -> Python-Modus

Escape beendet den inaktiven Modus durch Löschen des Editor-Texts und Wiederherstellen der Rahmenfarbe; bei aktiver Ausführung bricht Escape stattdessen die laufende Aufgabe ab.

### Plan-Modus

`InteractiveMode` verfolgt Plan-Modus-Flags, Status-Zeilen-Zustand, aktive Werkzeuge und Modellwechsel. Beim Ein-/Austritt werden Session-Modus-Einträge sowie Status und UI-Zustand aktualisiert, einschließlich eines aufgeschobenen Modellwechsels, wenn Streaming aktiv ist.

### Suspend/Resume (`Strg+Z`)

`InputController.handleCtrlZ()`:

1. Registriert einen einmaligen `SIGCONT`-Handler, um die TUI neu zu starten und ein erzwungenes Rendering anzufordern.
2. Stoppt die TUI vor dem Suspend.
3. Sendet `SIGTSTP` an die Prozessgruppe.

### Hintergrundmodus (`/background` oder `/bg`)

`handleBackgroundCommand()`:

- Lehnt ab, wenn im Leerlauf.
- Wechselt den Werkzeug-UI-Kontext zu nicht-interaktiv (`hasUI=false`), sodass interaktive UI-Werkzeuge sofort fehlschlagen.
- Stoppt Loader/Status-Zeile und hebt die Subscription des Vordergrundereignis-Handlers auf.
- Abonniert den Hintergrundereignis-Handler (wartet primär auf `agent_end`).
- Stoppt die TUI und sendet `SIGTSTP` (POSIX-Job-Control-Pfad).

Bei `agent_end` im Hintergrund ohne ausstehende Arbeit sendet der Controller eine Abschlussbenachrichtigung und fährt herunter.

## Abbruchpfade

Primäre Abbrucheingaben:

- `Escape` während aktivem Stream-Loader: Stellt wartende Nachrichten in den Editor zurück und bricht den Agenten ab.
- `Escape` während der Bash-/Python-Ausführung: Bricht den laufenden Befehl ab.
- `Escape` während automatischer Komprimierung/Wiederholung: Ruft dedizierte Abbruchmethoden über temporäre Escape-Handler auf.
- `Strg+C` einfach: Editor leeren; doppelt innerhalb von 500 ms: Herunterfahren.

Abbrüche sind zustandsbedingt; dieselbe Taste kann je nach Laufzeitzustand Abbruch, Modusbeendigung, Selektor-Auslösung oder Nichts bedeuten.

## Ereignisgesteuerte vs. gedrosselte Verarbeitung

Ereignisgesteuerte Aktualisierungen:

- Agent-Session-Ereignisse (`EventController`)
- Tastatur-Eingabe-Callbacks (`InputController`)
- Terminal-Resize-Callback
- Theme-/Branch-Watcher in `InteractiveMode`

Gedrosselte/entprellte Pfade:

- TUI-Rendering ist Tick-entprellt (`requestRender`-Zusammenfassung).
- Loader-Animation ist festintervallbasiert (80 ms), jedes Frame fordert ein Rendering an.
- Editor-Autovervollständigungs-Aktualisierungen (innerhalb von `Editor`) verwenden Entprell-Timer, um Neuberechnungen während der Eingabe zu reduzieren.

Die Laufzeit kombiniert somit ereignisgesteuerte Zustandsübergänge mit begrenzter Render-Kadenz, um Interaktivität reaktionsfähig zu halten, ohne Repaint-Stürme zu verursachen.
