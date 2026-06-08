---
title: TUI Runtime Internals
description: >-
  Interne Abläufe der Terminal-UI-Laufzeitumgebung, einschließlich
  Rendering-Pipeline, Eingabeverarbeitung und Zustandsverwaltung.
sidebar:
  order: 2
  label: Laufzeit-Interna
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# TUI-Laufzeit-Interna

Dieses Dokument beschreibt den nicht-themenbezogenen Laufzeitpfad von der Terminaleingabe bis zur gerenderten Ausgabe im interaktiven Modus. Der Schwerpunkt liegt auf dem Verhalten in `packages/tui` und dessen Integration über die Controller in `packages/coding-agent`.

## Laufzeitschichten und Zuständigkeiten

- **`packages/tui`-Engine**: Terminal-Lebenszyklus, Stdin-Normalisierung, Fokus-Routing, Render-Scheduling, differenzielles Zeichnen, Overlay-Komposition, Hardware-Cursor-Platzierung.
- **Interaktiver Modus von `packages/coding-agent`**: baut den Komponentenbaum auf, bindet Editor-Callbacks und Keymaps, reagiert auf Agent-/Sitzungsereignisse und übersetzt Domänenzustand (Streaming, Tool-Ausführung, Wiederholungsversuche, Plan-Modus) in UI-Komponenten.

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

## Boot und Aufbau des Komponentenbaums

`InteractiveMode` konstruiert `TUI(new ProcessTerminal(), showHardwareCursor)` und erstellt persistente Container:

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (enthält `CustomEditor`)

`init()` verknüpft den Baum in dieser Reihenfolge, fokussiert den Editor, registriert Eingabe-Handler über `InputController`, startet die TUI und fordert ein erzwungenes Rendering an.

Ein erzwungenes Rendering (`requestRender(true)`) setzt die Caches für vorherige Zeilen und die Cursor-Verwaltung zurück, bevor neu gezeichnet wird.

## Terminal-Lebenszyklus und Stdin-Normalisierung

`ProcessTerminal.start()`:

1. Aktiviert Raw-Modus und Bracketed Paste.
2. Registriert einen Resize-Handler.
3. Erstellt einen `StdinBuffer`, um partielle Escape-Chunks in vollständige Sequenzen aufzuteilen.
4. Fragt die Unterstützung des Kitty-Tastaturprotokolls ab (`CSI ? u`) und aktiviert dann Protokoll-Flags, falls unterstützt.
5. Unter Windows wird versucht, VT-Eingabe über `kernel32`-Modus-Flags zu aktivieren.

`StdinBuffer`-Verhalten:

- Puffert fragmentierte Escape-Sequenzen (CSI/OSC/DCS/APC/SS3).
- Gibt `data` nur aus, wenn eine Sequenz vollständig ist oder per Timeout geflusht wird.
- Erkennt Bracketed Paste und gibt ein `paste`-Ereignis mit dem rohen eingefügten Text aus.

Dies verhindert, dass partielle Escape-Chunks fälschlicherweise als normale Tastendrücke interpretiert werden.

## Eingabe-Routing und Fokus-Modell

Eingabepfad:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Routing-Details:

1. Die TUI führt zuerst registrierte Eingabe-Listener aus (`addInputListener`), was Konsumieren/Transformieren ermöglicht.
2. Die TUI verarbeitet den globalen Debug-Shortcut (`shift+ctrl+d`) vor der Komponentenweiterleitung.
3. Wenn die fokussierte Komponente zu einem Overlay gehört, das nun ausgeblendet/unsichtbar ist, weist die TUI den Fokus dem nächsten sichtbaren Overlay oder dem gespeicherten Vor-Overlay-Fokus zu.
4. Tastenfreigabe-Ereignisse werden gefiltert, es sei denn, die fokussierte Komponente setzt `wantsKeyRelease = true`.
5. Nach der Weiterleitung plant die TUI ein Rendering.

`setFocus()` schaltet auch `Focusable.focused` um, was steuert, ob Komponenten `CURSOR_MARKER` für die Hardware-Cursor-Platzierung ausgeben.

## Tastenverarbeitung aufgeteilt: Editor vs. Controller

`CustomEditor` fängt zuerst hochprioritäre Kombinationen ab (Escape, Strg-C/D/Z, Strg-V, Strg-P-Varianten, Strg-T, Alt-Oben, benutzerdefinierte Erweiterungstasten) und delegiert den Rest an das Basis-`Editor`-Verhalten (Textbearbeitung, Verlauf, Autovervollständigung, Cursorbewegung).

`InputController.setupKeyHandlers()` bindet dann Editor-Callbacks an Modus-Aktionen:

- Abbruch / Modus-Austritte bei `Escape`
- Herunterfahren bei doppeltem `Strg+C` oder `Strg+D` bei leerem Editor
- Anhalten/Fortsetzen bei `Strg+Z`
- Slash-Befehle und Selektor-Hotkeys
- Follow-up/Dequeue-Umschaltungen und Erweiterungs-Umschaltungen

Dies hält Tasten-Parsing/Editor-Mechaniken in `packages/tui` und Modus-Semantik in den Coding-Agent-Controllern.

## Render-Schleife und Differenzierungsstrategie

`TUI.requestRender()` wird auf ein Rendering pro Tick gedrosselt, indem `process.nextTick` verwendet wird. Mehrere Zustandsänderungen im selben Durchlauf werden zusammengeführt.

`#doRender()`-Pipeline:

1. Root-Komponentenbaum zu `newLines` rendern.
2. Sichtbare Overlays zusammensetzen (falls vorhanden).
3. `CURSOR_MARKER` aus den sichtbaren Viewport-Zeilen extrahieren und entfernen.
4. Segment-Reset-Suffixe für Nicht-Bild-Zeilen anhängen.
5. Zwischen vollständigem Neuzeichnen und differentiellem Patch wählen:
   - Erster Frame
   - Breitenänderung
   - Verkleinerung mit aktiviertem `clearOnShrink` und ohne Overlays
   - Bearbeitungen oberhalb des vorherigen Viewports
6. Für differentielle Aktualisierungen nur den geänderten Zeilenbereich patchen und bei Bedarf veraltete nachfolgende Zeilen löschen.
7. Hardware-Cursor für IME-Unterstützung repositionieren.

Render-Schreibvorgänge verwenden den synchronisierten Ausgabemodus (`CSI ? 2026 h/l`), um Flimmern/Tearing zu reduzieren.

## Render-Sicherheitsbeschränkungen

Kritische Sicherheitsprüfungen in der `TUI`:

- Gerenderte Nicht-Bild-Zeilen dürfen die Terminalbreite nicht überschreiten; ein Überlauf löst einen Fehler aus und schreibt Absturz-Diagnosen.
- Overlay-Komposition beinhaltet defensives Abschneiden und eine Breitenverifizierung nach der Komposition.
- Breitenänderungen erzwingen ein vollständiges Neuzeichnen, da sich die Umbruch-Semantik ändert.
- Die Cursorposition wird vor der Bewegung begrenzt.

Diese Beschränkungen sind Laufzeit-Durchsetzungen, nicht nur Konventionen.

## Resize-Behandlung

Resize-Ereignisse werden ereignisgesteuert von `ProcessTerminal` an `TUI.requestRender()` weitergeleitet.

Auswirkungen:

- Jede Breitenänderung löst ein vollständiges Neuzeichnen aus.
- Viewport/Top-Tracking (`#previousViewportTop`, `#maxLinesRendered`) vermeidet ungültige relative Cursor-Berechnungen, wenn sich Inhalt oder Terminalgröße ändern.
- Die Overlay-Sichtbarkeit kann von den Terminaldimensionen abhängen (`OverlayOptions.visible`); der Fokus wird korrigiert, wenn Overlays nach einem Resize nicht mehr sichtbar sind.

## Streaming und inkrementelle UI-Aktualisierungen

`EventController` abonniert `AgentSessionEvent` und aktualisiert die UI inkrementell:

- `agent_start`: startet den Loader in `statusContainer`.
- `message_start` Assistent: erstellt `streamingComponent` und bindet es ein.
- `message_update`: aktualisiert den streamenden Assistenten-Inhalt; erstellt/aktualisiert Tool-Ausführungskomponenten, sobald Tool-Aufrufe erscheinen.
- `tool_execution_update/end`: aktualisiert Tool-Ergebnis-Komponenten und Abschlusszustand.
- `message_end`: finalisiert den Assistenten-Stream, behandelt Abbruch-/Fehler-Annotationen, markiert ausstehende Tool-Argumente bei normalem Stopp als vollständig.
- `agent_end`: stoppt Loader, löscht transienten Stream-Zustand, führt verzögerten Modellwechsel durch, gibt Abschlussbenachrichtigung aus, wenn im Hintergrund.

Die Read-Tool-Gruppierung ist absichtlich zustandsbehaftet (`#lastReadGroup`), um aufeinanderfolgende Read-Tool-Aufrufe in einen visuellen Block zusammenzufassen, bis ein Nicht-Read-Unterbruch auftritt.

## Status- und Loader-Orchestrierung

Status-Kanal-Zuständigkeiten:

- `statusContainer` enthält transiente Loader (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` rendert persistente Status-/Hook-/Plan-Indikatoren und steuert Editor-Oberkanten-Aktualisierungen.

Loader-Verhalten:

- `Loader` aktualisiert alle 80ms über ein Intervall und fordert bei jedem Frame ein Rendering an.
- Escape-Handler werden während Auto-Komprimierung und Auto-Wiederholung vorübergehend überschrieben, um diese Operationen abbrechen zu können.
- Auf End-/Abbruchpfaden stellen Controller vorherige Escape-Handler wieder her und stoppen/löschen Loader-Komponenten.

## Modusübergänge und Hintergrundmodus

### Bash-/Python-Eingabemodi

Textpräfixe in der Eingabe schalten Editor-Rahmen-Modus-Flags um:

- `!` -> Bash-Modus
- `$` (kein Template-Literal-Präfix) -> Python-Modus

Escape beendet den inaktiven Modus, indem der Editor-Text gelöscht und die Rahmenfarbe wiederhergestellt wird; wenn eine Ausführung aktiv ist, bricht Escape stattdessen die laufende Aufgabe ab.

### Plan-Modus

`InteractiveMode` verfolgt Plan-Modus-Flags, Status-Zeilen-Zustand, aktive Tools und Modellwechsel. Eintreten/Verlassen aktualisiert Sitzungsmodus-Einträge und Status-/UI-Zustand, einschließlich verzögertem Modellwechsel, wenn Streaming aktiv ist.

### Anhalten/Fortsetzen (`Strg+Z`)

`InputController.handleCtrlZ()`:

1. Registriert einen einmaligen `SIGCONT`-Handler, um die TUI neu zu starten und ein erzwungenes Rendering durchzuführen.
2. Stoppt die TUI vor dem Anhalten.
3. Sendet `SIGTSTP` an die Prozessgruppe.

### Hintergrundmodus (`/background` oder `/bg`)

`handleBackgroundCommand()`:

- Lehnt ab, wenn im Leerlauf.
- Wechselt den Tool-UI-Kontext auf nicht-interaktiv (`hasUI=false`), damit interaktive UI-Tools schnell fehlschlagen.
- Stoppt Loader/Statuszeile und meldet den Vordergrund-Event-Handler ab.
- Abonniert den Hintergrund-Event-Handler (wartet primär auf `agent_end`).
- Stoppt die TUI und sendet `SIGTSTP` (POSIX-Job-Control-Pfad).

Bei `agent_end` im Hintergrund ohne ausstehende Arbeit sendet der Controller eine Abschlussbenachrichtigung und fährt herunter.

## Abbruchpfade

Primäre Abbruch-Eingaben:

- `Escape` während des aktiven Stream-Loaders: stellt in die Warteschlange gestellte Nachrichten im Editor wieder her und bricht den Agenten ab.
- `Escape` während der Bash-/Python-Ausführung: bricht den laufenden Befehl ab.
- `Escape` während Auto-Komprimierung/Wiederholung: ruft dedizierte Abbruchmethoden über temporäre Escape-Handler auf.
- `Strg+C` einfach drücken: Editor leeren; doppelt drücken innerhalb von 500ms: Herunterfahren.

Der Abbruch ist zustandsbedingt; dieselbe Taste kann je nach Laufzeitzustand Abbruch, Modus-Austritt, Selektor-Auslöser oder Keine-Aktion bedeuten.

## Ereignisgesteuertes vs. gedrosseltes Verhalten

Ereignisgesteuerte Aktualisierungen:

- Agent-Sitzungsereignisse (`EventController`)
- Tasten-Eingabe-Callbacks (`InputController`)
- Terminal-Resize-Callback
- Theme-/Branch-Watcher in `InteractiveMode`

Gedrosselte/Entprellte Pfade:

- TUI-Rendering ist tick-entprellt (`requestRender`-Zusammenführung).
- Loader-Animation ist fest-intervalliert (80ms), wobei jeder Frame ein Rendering anfordert.
- Editor-Autovervollständigungs-Aktualisierungen (innerhalb von `Editor`) verwenden Entprell-Timer, um den Neuberechnungsaufwand während des Tippens zu reduzieren.

Die Laufzeitumgebung mischt daher ereignisgesteuerte Zustandsübergänge mit begrenzter Render-Kadenz, um die Interaktivität responsiv zu halten, ohne Neuzeichnungs-Stürme zu verursachen.
