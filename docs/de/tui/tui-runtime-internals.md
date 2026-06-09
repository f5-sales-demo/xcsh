---
title: TUI-Laufzeit-Interna
description: >-
  Interna der Terminal-UI-Laufzeitumgebung, einschließlich Rendering-Pipeline,
  Eingabeverarbeitung und Zustandsverwaltung.
sidebar:
  order: 2
  label: Laufzeit-Interna
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# TUI-Laufzeit-Interna

Dieses Dokument beschreibt den nicht-themenbezogenen Laufzeitpfad von der Terminaleingabe bis zur gerenderten Ausgabe im interaktiven Modus. Der Fokus liegt auf dem Verhalten in `packages/tui` und dessen Integration aus `packages/coding-agent`-Controllern.

## Laufzeitschichten und Zuständigkeiten

- **`packages/tui`-Engine**: Terminal-Lebenszyklus, stdin-Normalisierung, Fokus-Routing, Render-Scheduling, differenzielles Zeichnen, Overlay-Komposition, Hardware-Cursor-Positionierung.
- **`packages/coding-agent` interaktiver Modus**: baut den Komponentenbaum auf, bindet Editor-Callbacks und Keymaps, reagiert auf Agent-/Session-Events und übersetzt Domänenzustand (Streaming, Tool-Ausführung, Wiederholungen, Plan-Modus) in UI-Komponenten.

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

`init()` verdrahtet den Baum in dieser Reihenfolge, fokussiert den Editor, registriert Eingabe-Handler über `InputController`, startet die TUI und fordert ein erzwungenes Rendering an.

Ein erzwungenes Rendering (`requestRender(true)`) setzt vorherige Zeilen-Caches und Cursor-Buchführung zurück, bevor neu gezeichnet wird.

## Terminal-Lebenszyklus und stdin-Normalisierung

`ProcessTerminal.start()`:

1. Aktiviert Raw-Modus und Bracketed Paste.
2. Bindet Resize-Handler an.
3. Erstellt einen `StdinBuffer`, um partielle Escape-Chunks in vollständige Sequenzen aufzuteilen.
4. Fragt Kitty-Tastaturprotokoll-Unterstützung ab (`CSI ? u`) und aktiviert dann Protokoll-Flags, falls unterstützt.
5. Unter Windows wird versucht, VT-Eingabe über `kernel32`-Modus-Flags zu aktivieren.

`StdinBuffer`-Verhalten:

- Puffert fragmentierte Escape-Sequenzen (CSI/OSC/DCS/APC/SS3).
- Gibt `data` erst aus, wenn eine Sequenz vollständig ist oder per Timeout geflusht wird.
- Erkennt Bracketed Paste und gibt ein `paste`-Event mit dem rohen eingefügten Text aus.

Dies verhindert, dass partielle Escape-Chunks fälschlicherweise als normale Tastendrücke interpretiert werden.

## Eingabe-Routing und Fokus-Modell

Eingabepfad:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Routing-Details:

1. TUI führt zuerst registrierte Input-Listener aus (`addInputListener`), die Konsumier-/Transformationsverhalten ermöglichen.
2. TUI verarbeitet globale Debug-Tastenkombination (`shift+ctrl+d`) vor der Komponenten-Weiterleitung.
3. Falls die fokussierte Komponente zu einem Overlay gehört, das nun ausgeblendet/unsichtbar ist, weist TUI den Fokus dem nächsten sichtbaren Overlay oder dem gespeicherten Vor-Overlay-Fokus zu.
4. Key-Release-Events werden gefiltert, es sei denn, die fokussierte Komponente setzt `wantsKeyRelease = true`.
5. Nach der Weiterleitung plant TUI ein Rendering.

`setFocus()` schaltet auch `Focusable.focused` um, was steuert, ob Komponenten `CURSOR_MARKER` für die Hardware-Cursor-Positionierung ausgeben.

## Tastenverarbeitung aufgeteilt: Editor vs. Controller

`CustomEditor` fängt zuerst hochprioritäre Kombinationen ab (Escape, Strg-C/D/Z, Strg-V, Strg-P-Varianten, Strg-T, Alt-Oben, erweiterungsspezifische benutzerdefinierte Tasten) und delegiert den Rest an das Basis-`Editor`-Verhalten (Textbearbeitung, Historie, Autovervollständigung, Cursorbewegung).

`InputController.setupKeyHandlers()` bindet dann Editor-Callbacks an Modus-Aktionen:

- Abbruch / Modus-Exits bei `Escape`
- Herunterfahren bei doppeltem `Strg+C` oder `Strg+D` bei leerem Editor
- Suspendieren/Fortsetzen bei `Strg+Z`
- Slash-Befehle und Selektor-Hotkeys
- Follow-up/Dequeue-Umschaltungen und Erweiterungs-Toggles

Dies hält Tasten-Parsing/Editor-Mechaniken in `packages/tui` und Modus-Semantik in Coding-Agent-Controllern.

## Render-Schleife und Differenzierungsstrategie

`TUI.requestRender()` wird per `process.nextTick` auf ein Rendering pro Tick entprellt. Mehrere Zustandsänderungen im selben Turn werden zusammengeführt.

`#doRender()`-Pipeline:

1. Root-Komponentenbaum zu `newLines` rendern.
2. Sichtbare Overlays (falls vorhanden) darüber komponieren.
3. `CURSOR_MARKER` aus sichtbaren Viewport-Zeilen extrahieren und entfernen.
4. Segment-Reset-Suffixe für Nicht-Bild-Zeilen anhängen.
5. Zwischen vollständigem Neuzeichnen und differenziellem Patch wählen:
   - erster Frame
   - Breitenänderung
   - Verkleinerung mit aktiviertem `clearOnShrink` und ohne Overlays
   - Bearbeitungen oberhalb des vorherigen Viewports
6. Für differenzielle Updates nur den geänderten Zeilenbereich patchen und bei Bedarf veraltete nachfolgende Zeilen bereinigen.
7. Hardware-Cursor für IME-Unterstützung repositionieren.

Render-Schreibvorgänge verwenden den synchronisierten Ausgabemodus (`CSI ? 2026 h/l`), um Flackern/Tearing zu reduzieren.

## Render-Sicherheitsbeschränkungen

Kritische Sicherheitsprüfungen in `TUI`:

- Gerenderte Nicht-Bild-Zeilen dürfen die Terminalbreite nicht überschreiten; Überlauf löst einen Fehler aus und schreibt Crash-Diagnosen.
- Overlay-Komposition beinhaltet defensive Kürzung und Breitenverifikation nach der Komposition.
- Breitenänderungen erzwingen ein vollständiges Neuzeichnen, da sich die Umbruch-Semantik ändert.
- Die Cursorposition wird vor der Bewegung begrenzt.

Diese Beschränkungen sind Laufzeiterzwingungen, nicht nur Konventionen.

## Resize-Behandlung

Resize-Events werden ereignisgesteuert von `ProcessTerminal` an `TUI.requestRender()` weitergeleitet.

Auswirkungen:

- Jede Breitenänderung löst ein vollständiges Neuzeichnen aus.
- Viewport-/Top-Tracking (`#previousViewportTop`, `#maxLinesRendered`) vermeidet ungültige relative Cursor-Berechnungen, wenn sich Inhalt oder Terminalgröße ändern.
- Overlay-Sichtbarkeit kann von Terminaldimensionen abhängen (`OverlayOptions.visible`); der Fokus wird korrigiert, wenn Overlays nach einer Größenänderung nicht mehr sichtbar sind.

## Streaming und inkrementelle UI-Updates

`EventController` abonniert `AgentSessionEvent` und aktualisiert die UI inkrementell:

- `agent_start`: startet Loader in `statusContainer`.
- `message_start` Assistent: erstellt `streamingComponent` und bindet es ein.
- `message_update`: aktualisiert den Streaming-Assistenteninhalt; erstellt/aktualisiert Tool-Ausführungskomponenten, sobald Tool-Aufrufe erscheinen.
- `tool_execution_update/end`: aktualisiert Tool-Ergebniskomponenten und Abschlusszustand.
- `message_end`: finalisiert Assistenten-Stream, behandelt Abbruch-/Fehler-Annotationen, markiert ausstehende Tool-Argumente bei normalem Stopp als abgeschlossen.
- `agent_end`: stoppt Loader, bereinigt transienten Stream-Zustand, flusht aufgeschobenen Modellwechsel, gibt Abschlussbenachrichtigung aus, falls im Hintergrund.

Die Read-Tool-Gruppierung ist absichtlich zustandsbehaftet (`#lastReadGroup`), um aufeinanderfolgende Read-Tool-Aufrufe in einen visuellen Block zusammenzuführen, bis ein Nicht-Read-Unterbrechung auftritt.

## Status- und Loader-Orchestrierung

Status-Lane-Zuständigkeiten:

- `statusContainer` enthält transiente Loader (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` rendert persistente Status-/Hook-/Plan-Indikatoren und steuert Editor-Oberrand-Updates.

Loader-Verhalten:

- `Loader` aktualisiert alle 80ms per Intervall und fordert bei jedem Frame ein Rendering an.
- Escape-Handler werden während Auto-Compaction und Auto-Retry temporär überschrieben, um diese Operationen abbrechen zu können.
- Bei End-/Abbruchpfaden stellen Controller vorherige Escape-Handler wieder her und stoppen/bereinigen Loader-Komponenten.

## Modus-Übergänge und Hintergrundmodus

### Bash-/Python-Eingabemodi

Texteingabe-Präfixe schalten Editor-Randmodus-Flags um:

- `!` -> Bash-Modus
- `$` (Nicht-Template-Literal-Präfix) -> Python-Modus

Escape beendet den inaktiven Modus durch Leeren des Editor-Texts und Wiederherstellen der Randfarbe; wenn eine Ausführung aktiv ist, bricht Escape stattdessen die laufende Aufgabe ab.

### Plan-Modus

`InteractiveMode` verfolgt Plan-Modus-Flags, Status-Line-Zustand, aktive Tools und Modellwechsel. Ein-/Austritt aktualisiert Session-Modus-Einträge und Status-/UI-Zustand, einschließlich aufgeschobenem Modellwechsel, wenn Streaming aktiv ist.

### Suspendieren/Fortsetzen (`Strg+Z`)

`InputController.handleCtrlZ()`:

1. Registriert einen einmaligen `SIGCONT`-Handler, um TUI neu zu starten und ein erzwungenes Rendering auszulösen.
2. Stoppt TUI vor dem Suspendieren.
3. Sendet `SIGTSTP` an die Prozessgruppe.

### Hintergrundmodus (`/background` oder `/bg`)

`handleBackgroundCommand()`:

- Lehnt ab, wenn im Leerlauf.
- Wechselt den Tool-UI-Kontext auf nicht-interaktiv (`hasUI=false`), damit interaktive UI-Tools schnell fehlschlagen.
- Stoppt Loader/Status-Line und meldet den Vordergrund-Event-Handler ab.
- Abonniert den Hintergrund-Event-Handler (wartet hauptsächlich auf `agent_end`).
- Stoppt TUI und sendet `SIGTSTP` (POSIX-Job-Control-Pfad).

Bei `agent_end` im Hintergrund ohne wartende Arbeit sendet der Controller eine Abschlussbenachrichtigung und fährt herunter.

## Abbruchpfade

Primäre Abbruch-Eingaben:

- `Escape` während aktivem Stream-Loader: stellt wartende Nachrichten im Editor wieder her und bricht den Agenten ab.
- `Escape` während Bash-/Python-Ausführung: bricht den laufenden Befehl ab.
- `Escape` während Auto-Compaction/Retry: ruft dedizierte Abbruchmethoden über temporäre Escape-Handler auf.
- `Strg+C` einfach drücken: Editor leeren; doppelt drücken innerhalb von 500ms: Herunterfahren.

Abbruch ist zustandsabhängig; dieselbe Taste kann je nach Laufzeitzustand Abbruch, Modus-Exit, Selektor-Auslöser oder Keine-Aktion bedeuten.

## Ereignisgesteuertes vs. gedrosseltes Verhalten

Ereignisgesteuerte Updates:

- Agenten-Session-Events (`EventController`)
- Tasteneingabe-Callbacks (`InputController`)
- Terminal-Resize-Callback
- Theme-/Branch-Watcher in `InteractiveMode`

Gedrosselte/entprellte Pfade:

- TUI-Rendering wird tick-entprellt (`requestRender`-Zusammenführung).
- Loader-Animation ist festintervall (80ms), wobei jeder Frame ein Rendering anfordert.
- Editor-Autovervollständigungs-Updates (innerhalb von `Editor`) verwenden Entprell-Timer, um Neuberechnungs-Aufwand während des Tippens zu reduzieren.

Die Laufzeitumgebung mischt daher ereignisgesteuerte Zustandsübergänge mit begrenzter Render-Kadenz, um die Interaktivität responsiv zu halten, ohne Neuzeichnungs-Stürme auszulösen.
