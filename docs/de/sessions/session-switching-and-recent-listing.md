---
title: Sitzungswechsel und Auflistung kürzlicher Sitzungen
description: >-
  Mechanik des Sitzungswechsels und Auflistung kürzlicher Sitzungen mit Suche
  und Filterung.
sidebar:
  order: 4
  label: Wechsel & kürzliche
i18n:
  sourceHash: aae56130b508
  translator: machine
---

# Sitzungswechsel und Auflistung kürzlicher Sitzungen

Dieses Dokument beschreibt, wie coding-agent kürzliche Sitzungen erkennt, `--resume`-Ziele auflöst, Sitzungsauswahlen präsentiert und die aktive Laufzeitsitzung wechselt.

Es konzentriert sich auf das aktuelle Implementierungsverhalten, einschließlich Fallback-Pfade und Einschränkungen.

## Implementierungsdateien

- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/cli/session-picker.ts`](../../packages/coding-agent/src/cli/session-picker.ts)
- [`../src/modes/components/session-selector.ts`](../../packages/coding-agent/src/modes/components/session-selector.ts)
- [`../src/modes/controllers/selector-controller.ts`](../../packages/coding-agent/src/modes/controllers/selector-controller.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)

## Erkennung kürzlicher Sitzungen

### Verzeichnisbereich

`SessionManager` speichert Sitzungen standardmäßig in einem cwd-bezogenen Verzeichnis:

- `~/.xcsh/agent/sessions/--<cwd-encoded>--/*.jsonl`

`SessionManager.list(cwd, sessionDir?)` liest nur dieses Verzeichnis, es sei denn, ein explizites `sessionDir` wird angegeben.

### Zwei Auflistungspfade mit unterschiedlichen Nutzdaten

Es gibt zwei verschiedene Auflistungspipelines:

1. `getRecentSessions(sessionDir, limit)` (Willkommens-/Zusammenfassungsansicht)
   - Liest nur einen 4KB-Präfix (`readTextPrefix(..., 4096)`) aus jeder Datei.
   - Parst Header + früheste Benutzertext-Vorschau.
   - Gibt leichtgewichtige `RecentSessionInfo` mit lazy `name`- und `timeAgo`-Gettern zurück.
   - Sortiert nach Datei-`mtime` absteigend.

2. `SessionManager.list(...)` / `SessionManager.listAll()` (Resume-Auswahlen und ID-Abgleich)
   - Liest vollständige Sitzungsdateien.
   - Erstellt `SessionInfo`-Objekte (`id`, `cwd`, `title`, `messageCount`, `firstMessage`, `allMessagesText`, Zeitstempel).
   - Verwirft Sitzungen mit null `message`-Einträgen.
   - Sortiert nach `modified` absteigend.

### Metadaten-Fallback-Verhalten

Für kürzliche Zusammenfassungen (`RecentSessionInfo`):

- Anzeigename-Präferenz: `header.title` -> erster Benutzer-Prompt -> `header.id` -> Dateiname
- Name wird auf 40 Zeichen für kompakte Anzeigen gekürzt
- Steuerzeichen/Zeilenumbrüche werden aus von Titeln abgeleiteten Namen entfernt/bereinigt

Für `SessionInfo`-Listeneinträge:

- `title` ist `header.title` oder neueste Kompaktierungs-`shortSummary`
- `firstMessage` ist der erste Benutzernachrichtentext oder `"(no messages)"`

## `--continue`-Auflösung und Terminal-Breadcrumb-Präferenz

`SessionManager.continueRecent(cwd, sessionDir?)` löst das Ziel in dieser Reihenfolge auf:

1. Terminal-bezogenen Breadcrumb lesen (`~/.xcsh/agent/terminal-sessions/<terminal-id>`)
2. Breadcrumb validieren:
   - aktuelles Terminal kann identifiziert werden
   - Breadcrumb-cwd stimmt mit aktuellem cwd überein (aufgelöster Pfadvergleich)
   - referenzierte Datei existiert noch
3. Wenn Breadcrumb ungültig/fehlend ist, Fallback auf neueste Datei nach mtime im Sitzungsverzeichnis (`findMostRecentSession`)
4. Wenn keine gefunden wird, neue Sitzung erstellen

Terminal-ID-Ableitung bevorzugt den TTY-Pfad und fällt auf umgebungsbasierte Identifikatoren zurück (`KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION`).

Breadcrumb-Schreibvorgänge sind Best-Effort und nicht-fatal.

## Auflösung des Resume-Ziels zur Startzeit (`main.ts`)

### `--resume <value>`

`createSessionManager(...)` verarbeitet string-wertige `--resume` in zwei Modi:

1. Pfadartiger Wert (enthält `/`, `\\` oder endet mit `.jsonl`)
   - direktes `SessionManager.open(sessionArg, parsed.sessionDir)`

2. ID-Präfix-Wert
   - Übereinstimmung in `SessionManager.list(cwd, sessionDir)` durch `id.startsWith(sessionArg)` finden
   - wenn keine lokale Übereinstimmung und `sessionDir` nicht erzwungen wird, `SessionManager.listAll()` versuchen
   - erste Übereinstimmung wird verwendet (keine Mehrdeutigkeits-Abfrage)

Projektübergreifendes Übereinstimmungsverhalten:

- wenn das cwd der übereinstimmenden Sitzung vom aktuellen cwd abweicht, fragt die CLI, ob ins aktuelle Projekt geforkt werden soll
- ja -> `SessionManager.forkFrom(...)`
- nein -> wirft Fehler (`Session "..." is in another project (...)`)

Keine Übereinstimmung -> wirft Fehler (`Session "..." not found.`).

### `--resume` (ohne Wert)

Wird nach der initialen Session-Manager-Konstruktion verarbeitet:

1. lokale Sitzungen mit `SessionManager.list(cwd, parsed.sessionDir)` auflisten
2. wenn leer: `No sessions found` ausgeben und frühzeitig beenden
3. TUI-Auswahl öffnen (`selectSession`)
4. wenn abgebrochen: `No session selected` ausgeben und frühzeitig beenden
5. wenn ausgewählt: `SessionManager.open(selectedPath)`

### `--continue`

Verwendet `SessionManager.continueRecent(...)` direkt (Breadcrumb-zuerst-Verhalten wie oben beschrieben).

## Interna der Auswahl-basierten Selektion

## CLI-Auswahl (`src/cli/session-picker.ts`)

`selectSession(sessions)` erstellt eine eigenständige TUI mit `SessionSelectorComponent` und löst genau einmal auf:

- Auswahl -> löst ausgewählten Pfad auf
- Abbruch (Esc) -> löst `null` auf
- Harter Abbruch (Ctrl+C-Pfad) -> stoppt TUI und `process.exit(0)`

## Interaktive In-Session-Auswahl (`SelectorController.showSessionSelector`)

Ablauf:

1. Sitzungen aus dem aktuellen Sitzungsverzeichnis über `SessionManager.list(currentCwd, currentSessionDir)` abrufen
2. `SessionSelectorComponent` im Editorbereich mittels `showSelector(...)` einbinden
3. Callbacks:
   - Auswahl -> Selektor schließen und `handleResumeSession(sessionPath)` aufrufen
   - Abbruch -> Editor wiederherstellen und neu rendern
   - Beenden -> `ctx.shutdown()`

## Verhalten der Sitzungsauswahl-Komponente

`SessionList` unterstützt:

- Pfeil-/Seitennavigation
- Enter zum Auswählen
- Esc zum Abbrechen
- Ctrl+C zum Beenden
- Fuzzy-Suche über Sitzungs-ID/Titel/cwd/erste Nachricht/alle Nachrichten/Pfad

Verhalten bei leerer Liste:

- zeigt eine Nachricht anstatt abzustürzen
- Enter bei leerer Liste bewirkt nichts (kein Callback)
- Esc/Ctrl+C funktionieren weiterhin

Einschränkung: Der UI-Text sagt `Press Tab to view all`, aber diese Komponente hat derzeit keinen Tab-Handler und die aktuelle Verdrahtung listet nur Sitzungen des aktuellen Bereichs auf.

## Ausführung des Laufzeitwechsels (`AgentSession.switchSession`)

`switchSession(sessionPath)` ist der zentrale In-Process-Wechselpfad.

Lebenszyklus/Zustandsübergang:

1. `previousSessionFile` erfassen
2. `session_before_switch`-Hook-Event emittieren (`reason: "resume"`, abbrechbar)
3. wenn abgebrochen -> `false` zurückgeben ohne Wechsel
4. Verbindung zum aktuellen Agent-Event-Stream trennen
5. aktive Generierung/Tool-Ablauf abbrechen
6. ausstehende Steering-/Follow-up-/Next-Turn-Nachrichtenpuffer leeren
7. Session-Writer flushen (`sessionManager.flush()`) um ausstehende Schreibvorgänge zu persistieren
8. `sessionManager.setSessionFile(sessionPath)`
   - aktualisiert den Sitzungsdateizeiger
   - schreibt Terminal-Breadcrumb
   - lädt Einträge / migriert / löst Blobs auf / reindexiert
   - bei fehlenden/ungültigen Dateidaten: initialisiert eine neue Sitzung unter diesem Pfad und schreibt den Header neu
9. `agent.sessionId` aktualisieren
10. Kontext über `buildSessionContext()` neu aufbauen
11. `session_switch`-Hook-Event emittieren (`reason: "resume"`, `previousSessionFile`)
12. Agent-Nachrichten durch neu aufgebauten Kontext ersetzen
13. Standardmodell aus `sessionContext.models.default` wiederherstellen, falls verfügbar und in der Modellregistrierung vorhanden
14. Denk-Level wiederherstellen:
    - wenn der Branch bereits ein `thinking_level_change` hat, gespeichertes Sitzungslevel anwenden
    - andernfalls Standard-Denk-Level aus den Einstellungen ableiten, auf Modellfähigkeit begrenzen, setzen und einen neuen `thinking_level_change`-Eintrag anhängen
15. Agent-Listener wieder verbinden und `true` zurückgeben

## UI-Zustandswiederherstellung nach interaktivem Wechsel

`SelectorController.handleResumeSession` führt einen UI-Reset um `switchSession` herum durch:

- Ladeanimation stoppen
- Status-Container leeren
- Ausstehende-Nachricht-UI und ausstehende Tool-Map zurücksetzen
- Streaming-Komponenten-/Nachrichtenreferenzen zurücksetzen
- `session.switchSession(...)` aufrufen
- Chat-Container leeren und aus dem Sitzungskontext neu rendern (`renderInitialMessages`)
- Todos aus den neuen Sitzungsartefakten neu laden
- `Resumed session` anzeigen

Der sichtbare Konversations-/Todo-Zustand wird also aus der neuen Sitzungsdatei neu aufgebaut.

## Start-Resume vs. In-Session-Wechsel

### Start-Resume (`--continue`, `--resume`, direktes Öffnen)

- Sitzungsdatei wird vor `createAgentSession(...)` ausgewählt.
- `sdk.ts` baut `existingSession = sessionManager.buildSessionContext()`.
- Agent-Nachrichten werden einmalig während der Sitzungserstellung wiederhergestellt.
- Modell/Denken werden während der Erstellung ausgewählt (einschließlich Wiederherstellungs-/Fallback-Logik).
- Der interaktive Modus führt dann `#restoreModeFromSession()` aus, um den persistierten Moduszustand wieder einzunehmen (derzeit plan/plan_paused).

### In-Session-Wechsel (`/resume`-artiger Selektor-Pfad)

- Verwendet `AgentSession.switchSession(...)` auf einer bereits laufenden `AgentSession`.
- Nachrichten/Modell/Denken werden sofort vor Ort neu aufgebaut.
- Hook-Events `session_before_switch`/`session_switch` werden emittiert.
- UI-Chat/Todos werden aktualisiert.
- Im Selektor-Ablauf wird kein dedizierter Post-Wechsel-Moduswiederherstellungsaufruf durchgeführt; das Modus-Wiedereintrittsverhalten ist nicht symmetrisch zum `#restoreModeFromSession()` beim Start.

## Fehler- und Grenzfallverhalten

### Abbruchpfade

- CLI-Auswahl-Abbruch -> gibt `null` zurück, Aufrufer gibt `No session selected` aus, Prozess beendet sich frühzeitig.
- Interaktive Auswahl-Abbruch -> Editor wird wiederhergestellt, kein Sitzungswechsel.
- Hook-Abbruch (`session_before_switch`) -> `switchSession()` gibt `false` zurück.

### Leere-Liste-Pfade

- CLI `--resume` (ohne Wert): leere Liste gibt `No sessions found` aus und beendet sich.
- Interaktiver Selektor: leere Liste zeigt Nachricht an und bleibt abbrechbar.

### Fehlende/ungültige Ziel-Sitzungsdatei

Beim Öffnen/Wechseln zu einem bestimmten Pfad (`setSessionFile`):

- ENOENT -> wird als leer behandelt -> neue Sitzung wird unter genau diesem Pfad initialisiert und persistiert.
- fehlerhafter/ungültiger Header (oder effektiv unlesbare geparste Einträge) -> wird als leer behandelt -> neue Sitzung wird initialisiert und persistiert.

Dies ist Wiederherstellungsverhalten, kein harter Fehler.

### Harte Fehler

Wechsel/Öffnen kann bei echten I/O-Fehlern (Berechtigungsfehler, Neuschreibfehler usw.) weiterhin Fehler werfen, die an die Aufrufer weitergegeben werden.

### Einschränkungen beim ID-Präfix-Abgleich

- ID-Abgleich verwendet `startsWith` und nimmt die erste Übereinstimmung in der sortierten Liste.
- Keine Mehrdeutigkeits-UI, wenn mehrere Sitzungen denselben Präfix teilen.
- `SessionManager.list(...)` schließt Sitzungen mit null Nachrichten aus, sodass diese Sitzungen nicht über ID-Abgleich/Listen-Auswahl wiederaufnehmbar sind.
