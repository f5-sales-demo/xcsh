---
title: Sitzungswechsel und Liste der zuletzt verwendeten Sitzungen
description: >-
  Mechanismen zum Sitzungswechsel sowie die Auflistung zuletzt verwendeter
  Sitzungen mit Such- und Filterfunktionen.
sidebar:
  order: 4
  label: Wechseln & Zuletzt verwendet
i18n:
  sourceHash: aae56130b508
  translator: machine
---

# Sitzungswechsel und Liste der zuletzt verwendeten Sitzungen

Dieses Dokument beschreibt, wie der Coding-Agent zuletzt verwendete Sitzungen ermittelt, `--resume`-Ziele auflöst, Sitzungsauswahldialoge anzeigt und die aktive Laufzeitsitzung wechselt.

Der Schwerpunkt liegt auf dem aktuellen Implementierungsverhalten, einschließlich Fallback-Pfaden und Einschränkungen.

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

## Ermittlung zuletzt verwendeter Sitzungen

### Verzeichnisbereich

`SessionManager` speichert Sitzungen standardmäßig in einem cwd-bezogenen Verzeichnis:

- `~/.xcsh/agent/sessions/--<cwd-encoded>--/*.jsonl`

`SessionManager.list(cwd, sessionDir?)` liest ausschließlich dieses Verzeichnis, sofern kein explizites `sessionDir` angegeben wird.

### Zwei Auflistungspfade mit unterschiedlichen Nutzdaten

Es gibt zwei verschiedene Auflistungs-Pipelines:

1. `getRecentSessions(sessionDir, limit)` (Willkommens-/Zusammenfassungsansicht)
   - Liest nur ein 4-KB-Präfix (`readTextPrefix(..., 4096)`) aus jeder Datei.
   - Parst Header + früheste Benutzertextvorschau.
   - Gibt ein schlankes `RecentSessionInfo`-Objekt mit verzögerten `name`- und `timeAgo`-Gettern zurück.
   - Sortiert nach Datei-`mtime` absteigend.

2. `SessionManager.list(...)` / `SessionManager.listAll()` (Sitzungsauswahl für Wiederaufnahme und ID-Abgleich)
   - Liest vollständige Sitzungsdateien.
   - Erstellt `SessionInfo`-Objekte (`id`, `cwd`, `title`, `messageCount`, `firstMessage`, `allMessagesText`, Zeitstempel).
   - Verwirft Sitzungen mit null `message`-Einträgen.
   - Sortiert nach `modified` absteigend.

### Metadaten-Fallback-Verhalten

Für aktuelle Zusammenfassungen (`RecentSessionInfo`):

- Präferenz für den Anzeigenamen: `header.title` -> erste Benutzereingabe -> `header.id` -> Dateiname
- Der Name wird für kompakte Anzeigen auf 40 Zeichen gekürzt
- Steuerzeichen/Zeilenumbrüche werden aus titelabgeleiteten Namen entfernt/bereinigt

Für `SessionInfo`-Listeneinträge:

- `title` ist `header.title` oder der neueste Kompaktierungs-`shortSummary`
- `firstMessage` ist der Text der ersten Benutzernachricht oder `"(no messages)"`

## `--continue`-Auflösung und Terminalnavigations-Präferenz

`SessionManager.continueRecent(cwd, sessionDir?)` löst das Ziel in dieser Reihenfolge auf:

1. Terminalspezifischen Breadcrumb lesen (`~/.xcsh/agent/terminal-sessions/<terminal-id>`)
2. Breadcrumb validieren:
   - Das aktuelle Terminal kann identifiziert werden
   - Das Breadcrumb-cwd stimmt mit dem aktuellen cwd überein (aufgelöster Pfadvergleich)
   - Die referenzierte Datei ist noch vorhanden
3. Wenn der Breadcrumb ungültig/fehlend ist, auf die neueste Datei nach mtime im Sitzungsverzeichnis zurückfallen (`findMostRecentSession`)
4. Wenn keine Datei gefunden wird, eine neue Sitzung erstellen

Die Terminal-ID-Ableitung bevorzugt den TTY-Pfad und greift auf umgebungsbasierte Bezeichner zurück (`KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION`).

Breadcrumb-Schreibvorgänge erfolgen nach bestem Bemühen und sind nicht fatal.

## Auflösung des Wiederaufnahmeziels beim Start (`main.ts`)

### `--resume <value>`

`createSessionManager(...)` verarbeitet einen zeichenkettenbasierten `--resume`-Wert in zwei Modi:

1. Pfadähnlicher Wert (enthält `/`, `\\` oder endet mit `.jsonl`)
   - direktes `SessionManager.open(sessionArg, parsed.sessionDir)`

2. ID-Präfix-Wert
   - Treffer in `SessionManager.list(cwd, sessionDir)` über `id.startsWith(sessionArg)` suchen
   - Wenn kein lokaler Treffer und `sessionDir` nicht erzwungen, `SessionManager.listAll()` versuchen
   - Der erste Treffer wird verwendet (keine Mehrdeutigkeitsabfrage)

Verhalten bei projektübergreifenden Treffern:

- Wenn das cwd der gefundenen Sitzung vom aktuellen cwd abweicht, fragt die CLI, ob in das aktuelle Projekt verzweigt werden soll
- Ja -> `SessionManager.forkFrom(...)`
- Nein -> Fehler wird ausgelöst (`Session "..." is in another project (...)`)

Kein Treffer -> Fehler wird ausgelöst (`Session "..." not found.`).

### `--resume` (kein Wert)

Wird nach der anfänglichen Sitzungsmanager-Erstellung behandelt:

1. Lokale Sitzungen mit `SessionManager.list(cwd, parsed.sessionDir)` auflisten
2. Wenn leer: `No sessions found` ausgeben und frühzeitig beenden
3. TUI-Auswahldialog öffnen (`selectSession`)
4. Wenn abgebrochen: `No session selected` ausgeben und frühzeitig beenden
5. Wenn ausgewählt: `SessionManager.open(selectedPath)`

### `--continue`

Verwendet `SessionManager.continueRecent(...)` direkt (Breadcrumb-First-Verhalten wie oben beschrieben).

## Interna der auswahlbasierten Sitzungsauswahl

## CLI-Auswahldialog (`src/cli/session-picker.ts`)

`selectSession(sessions)` erstellt eine eigenständige TUI mit `SessionSelectorComponent` und löst genau einmal auf:

- Auswahl -> gibt den ausgewählten Pfad zurück
- Abbruch (Esc) -> gibt `null` zurück
- Hartes Beenden (Ctrl+C-Pfad) -> stoppt die TUI und ruft `process.exit(0)` auf

## Interaktiver In-Sitzungs-Auswahldialog (`SelectorController.showSessionSelector`)

Ablauf:

1. Sitzungen aus dem aktuellen Sitzungsverzeichnis über `SessionManager.list(currentCwd, currentSessionDir)` abrufen
2. `SessionSelectorComponent` im Editor-Bereich über `showSelector(...)` einbinden
3. Rückrufe:
   - Auswahl -> Auswahldialog schließen und `handleResumeSession(sessionPath)` aufrufen
   - Abbruch -> Editor wiederherstellen und neu rendern
   - Beenden -> `ctx.shutdown()`

## Verhalten der Sitzungsauswahl-Komponente

`SessionList` unterstützt:

- Pfeil-/Seitennavigation
- Eingabe zur Auswahl
- Esc zum Abbrechen
- Ctrl+C zum Beenden
- Fuzzy-Suche über Sitzungs-ID/Titel/cwd/erste Nachricht/alle Nachrichten/Pfad

Darstellungsverhalten bei leerer Liste:

- Zeigt eine Meldung an, anstatt abzustürzen
- Eingabe bei leerer Liste hat keine Wirkung (kein Rückruf)
- Esc/Ctrl+C funktionieren weiterhin

Hinweis: Der UI-Text lautet `Press Tab to view all`, aber diese Komponente hat derzeit keinen Tab-Handler, und die aktuelle Verdrahtung listet nur Sitzungen im aktuellen Bereich auf.

## Ausführung des Laufzeit-Sitzungswechsels (`AgentSession.switchSession`)

`switchSession(sessionPath)` ist der zentrale In-Process-Wechselpfad.

Lebenszyklus/Zustandsübergang:

1. `previousSessionFile` erfassen
2. Hook-Ereignis `session_before_switch` auslösen (`reason: "resume"`, abbrechbar)
3. Wenn abgebrochen -> `false` zurückgeben, kein Wechsel
4. Vom aktuellen Agent-Ereignisstrom trennen
5. Aktiven Generierungs-/Werkzeugablauf abbrechen
6. Warteschlangen für Steuerungs-/Folgemeldungen/Nächste-Runde-Nachrichtenpuffer leeren
7. Sitzungsschreiber leeren (`sessionManager.flush()`), um ausstehende Schreibvorgänge zu persistieren
8. `sessionManager.setSessionFile(sessionPath)`
   - Aktualisiert den Sitzungsdateizeiger
   - Schreibt Terminal-Breadcrumb
   - Lädt Einträge / migriert / löst Blobs auf / indiziert neu
   - Bei fehlender/ungültiger Datei: Initialisiert eine neue Sitzung unter diesem Pfad und schreibt den Header neu
9. `agent.sessionId` aktualisieren
10. Kontext über `buildSessionContext()` neu aufbauen
11. Hook-Ereignis `session_switch` auslösen (`reason: "resume"`, `previousSessionFile`)
12. Agent-Nachrichten durch neu aufgebauten Kontext ersetzen
13. Standardmodell aus `sessionContext.models.default` wiederherstellen, wenn verfügbar und im Modellregister vorhanden
14. Denk-Ebene wiederherstellen:
    - Wenn der Zweig bereits `thinking_level_change` enthält, gespeicherte Sitzungsebene anwenden
    - Andernfalls Standard-Denk-Ebene aus Einstellungen ableiten, auf Modellkapazität begrenzen, setzen und neuen `thinking_level_change`-Eintrag anfügen
15. Agent-Listener neu verbinden und `true` zurückgeben

## UI-Zustandswiederherstellung nach interaktivem Wechsel

`SelectorController.handleResumeSession` führt UI-Reset um `switchSession` herum durch:

- Ladeanimation stoppen
- Statuscontainer leeren
- Ausstehende Nachrichten-UI und ausstehende Werkzeugzuordnung zurücksetzen
- Streaming-Komponenten-/Nachrichtenreferenzen zurücksetzen
- `session.switchSession(...)` aufrufen
- Chat-Container leeren und aus Sitzungskontext neu rendern (`renderInitialMessages`)
- Aufgaben aus neuen Sitzungsartefakten neu laden
- `Resumed session` anzeigen

Der sichtbare Gesprächs-/Aufgabenstatus wird also aus der neuen Sitzungsdatei neu aufgebaut.

## Wiederaufnahme beim Start vs. In-Sitzungs-Wechsel

### Wiederaufnahme beim Start (`--continue`, `--resume`, direktes Öffnen)

- Die Sitzungsdatei wird vor `createAgentSession(...)` ausgewählt.
- `sdk.ts` erstellt `existingSession = sessionManager.buildSessionContext()`.
- Agent-Nachrichten werden einmalig während der Sitzungserstellung wiederhergestellt.
- Modell/Denken werden während der Erstellung ausgewählt (einschließlich Wiederherstellungs-/Fallback-Logik).
- Der interaktive Modus führt dann `#restoreModeFromSession()` aus, um den persistierten Moduszustand wieder aufzunehmen (derzeit plan/plan_paused).

### In-Sitzungs-Wechsel (`/resume`-artiger Auswahlpfad)

- Verwendet `AgentSession.switchSession(...)` in einer bereits laufenden `AgentSession`.
- Nachrichten/Modell/Denken werden sofort an Ort und Stelle neu aufgebaut.
- Hook-Ereignisse `session_before_switch`/`session_switch` werden ausgelöst.
- UI-Chat/Aufgaben werden aktualisiert.
- Nach dem Wechsel wird kein dedizierter Moduswiederherstellungsaufruf im Auswahlpfad durchgeführt; das Moduswiederaufnahmeverhalten ist nicht symmetrisch mit dem Start-`#restoreModeFromSession()`.

## Fehler- und Randfall-Verhalten

### Abbruchpfade

- CLI-Auswahldialogabbruch -> gibt `null` zurück, Aufrufer gibt `No session selected` aus, Prozess endet frühzeitig.
- Interaktiver Auswahldialogabbruch -> Editor wird wiederhergestellt, keine Sitzungsänderung.
- Hook-Abbruch (`session_before_switch`) -> `switchSession()` gibt `false` zurück.

### Leere Listenpfade

- CLI `--resume` (kein Wert): Leere Liste gibt `No sessions found` aus und beendet.
- Interaktiver Auswahldialog: Leere Liste zeigt Meldung an und bleibt abbrechbar.

### Fehlende/ungültige Zielsitzungsdatei

Beim Öffnen/Wechseln zu einem bestimmten Pfad (`setSessionFile`):

- ENOENT -> wird als leer behandelt -> neue Sitzung wird unter diesem genauen Pfad initialisiert und persistiert.
- Fehlerhafter/ungültiger Header (oder effektiv nicht lesbare geparste Einträge) -> wird als leer behandelt -> neue Sitzung wird initialisiert und persistiert.

Dies ist Wiederherstellungsverhalten, kein harter Fehler.

### Schwerwiegende Fehler

Wechseln/Öffnen kann bei echten E/A-Fehlern (Berechtigungsfehler, Schreibfehler usw.) weiterhin Ausnahmen auslösen, die an die Aufrufer weitergegeben werden.

### Einschränkungen beim ID-Präfix-Abgleich

- Der ID-Abgleich verwendet `startsWith` und nimmt den ersten Treffer in der sortierten Liste.
- Keine Mehrdeutigkeits-UI, wenn mehrere Sitzungen denselben Präfix teilen.
- `SessionManager.list(...)` schließt Sitzungen mit null Nachrichten aus, sodass diese Sitzungen nicht über ID-Abgleich/Listenauswahl wiederaufgenommen werden können.
