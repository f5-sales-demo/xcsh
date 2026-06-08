---
title: 'Sitzungsoperationen: Exportieren, Dump, Teilen, Forken, Fortsetzen'
description: >-
  Sitzungsoperationen zum Exportieren, Teilen, Forken und Fortsetzen von
  Konversationen.
sidebar:
  order: 3
  label: Operationen
i18n:
  sourceHash: e3c210b29c3e
  translator: machine
---

# Sitzungsoperationen: export, dump, share, fork, resume/continue

Dieses Dokument beschreibt das für Operatoren sichtbare Verhalten der Sitzungsoperationen Export/Teilen/Fork/Fortsetzen, wie sie derzeit implementiert sind.

## Implementierungsdateien

- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/export/html/index.ts`](../../packages/coding-agent/src/export/html/index.ts)
- [`../src/export/custom-share.ts`](../../packages/coding-agent/src/export/custom-share.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)

## Operationsmatrix

| Operation | Einstiegspfad | Sitzungsmutation | Sitzungsdatei-Erstellung/-Wechsel | Ausgabeartefakt |
|---|---|---|---|---|
| `/dump` | Interaktiver Slash-Befehl | Nein | Nein | Zwischenablage-Text |
| `/export [path]` | Interaktiver Slash-Befehl | Nein | Nein | HTML-Datei |
| `--export <session.jsonl> [outputPath]` | CLI-Start-Schnellpfad | Keine Laufzeit-Sitzungsmutation | Keine aktive Sitzung; liest Zieldatei | HTML-Datei |
| `/share` | Interaktiver Slash-Befehl | Nein | Nein | Temporäre HTML + Share-URL/Gist |
| `/fork` | Interaktiver Slash-Befehl | Ja (aktive Sitzungsidentität ändert sich) | Erstellt neue Sitzungsdatei und wechselt die aktuelle Sitzung dorthin (nur im persistenten Modus) | Kopiert das Artefaktverzeichnis in den neuen Sitzungsnamensraum, falls vorhanden |
| `/resume` | Interaktiver Slash-Befehl | Ja (aktiver In-Memory-Zustand wird ersetzt) | Wechselt zu ausgewählter bestehender Sitzungsdatei | Keines |
| `--resume` | CLI-Start (Auswahldialog) | Ja, nach Sitzungserstellung | Öffnet ausgewählte bestehende Sitzungsdatei | Keines |
| `--resume <id\|path>` | CLI-Start | Ja, nach Sitzungserstellung | Öffnet bestehende Sitzung; projektübergreifender Fall kann in aktuelles Projekt forken | Keines |
| `--continue` | CLI-Start | Ja, nach Sitzungserstellung | Öffnet Terminal-Breadcrumb oder zuletzt verwendete Sitzung; erstellt eine neue, falls keine existiert | Keines |

## Export und Dump

### `/export [outputPath]` (interaktiv)

Ablauf:

1. `InputController` leitet `/export...` an `CommandController.handleExportCommand` weiter.
2. Der Befehl teilt anhand von Leerzeichen und verwendet nur das erste Argument nach `/export` als `outputPath`.
3. `AgentSession.exportToHtml()` ruft `exportSessionToHtml(sessionManager, state, { outputPath, themeName })` auf.
4. Bei Erfolg zeigt die UI den Pfad an und öffnet die Datei im Browser.

Verhaltensdetails:

- Die Argumente `--copy`, `clipboard` und `copy` werden explizit mit einem Hinweis auf `/dump` abgelehnt.
- Der Export bettet den Sitzungs-Header/Einträge/Blatt sowie den aktuellen `systemPrompt` und Tool-Beschreibungen aus dem Agent-Zustand ein.
- Während des Exports werden keine Sitzungseinträge hinzugefügt.

Einschränkung:

- Das Argument-Parsing basiert auf Leerzeichen (`text.split(/\s+/)`), sodass Pfade mit Leerzeichen in Anführungszeichen von diesem Befehlspfad nicht als einzelner Pfad erhalten bleiben.

### `--export <inputSessionFile> [outputPath]` (CLI)

Ablauf in `main.ts`:

1. Wird früh behandelt (vor interaktivem/Sitzungs-Start).
2. Ruft `exportFromFile(inputPath, outputPath?)` auf.
3. `SessionManager.open(inputPath)` lädt die Einträge, dann wird HTML generiert und geschrieben.
4. Der Prozess gibt `Exported to: ...` aus und beendet sich.

Verhaltensdetails:

- Eine fehlende Eingabedatei wird als `File not found: <path>` angezeigt.
- Dieser Pfad erstellt keine `AgentSession` und mutiert keine laufende Sitzung.

### `/dump` (interaktiver Zwischenablage-Export)

Ablauf:

1. `CommandController.handleDumpCommand()` ruft `session.formatSessionAsText()` auf.
2. Bei leerem String wird `No messages to dump yet.` gemeldet.
3. Andernfalls wird über natives `copyToClipboard` in die Zwischenablage kopiert.

Der Dump-Inhalt umfasst:

- System-Prompt
- Aktives Modell/Denk-Level
- Tool-Definitionen + Parameter
- Benutzer-/Assistenten-Nachrichten
- Denkblöcke und Tool-Aufrufe
- Tool-Ergebnisse und Ausführungsblöcke (außer `excludeFromContext` Bash/Python-Einträge)
- Benutzerdefinierte/Hook-/Dateierwähnungs-/Branch-Zusammenfassungs-/Kompaktierungs-Zusammenfassungseinträge

Durch das Dumpen werden keine Sitzungspersistenz-Änderungen vorgenommen.

## Teilen

`/share` ist ausschließlich interaktiv und beginnt immer mit dem Export der aktuellen Sitzung in eine temporäre HTML-Datei.

### Phase 1: Temporärer Export

- Temporärer Dateipfad: `${os.tmpdir()}/${Snowflake.next()}.html`
- Verwendet `session.exportToHtml(tmpFile)`
- Falls der Export fehlschlägt (insbesondere bei In-Memory-Sitzungen), endet das Teilen mit einem Fehler.

### Phase 2: Benutzerdefinierter Share-Handler (falls vorhanden)

`loadCustomShare()` prüft `~/.xcsh/agent` auf den ersten vorhandenen Kandidaten:

- `share.ts`
- `share.js`
- `share.mjs`

Anforderungen:

- Das Modul muss als Default-Export eine Funktion `(htmlPath) => Promise<CustomShareResult | string | undefined>` bereitstellen.

Falls vorhanden und gültig:

- Die UI wechselt in den `Sharing...`-Ladezustand.
- Ergebnisinterpretation des Handlers:
  - String => wird als URL behandelt, angezeigt und geöffnet
  - Objekt => `url` und/oder `message` werden angezeigt; `url` wird geöffnet
  - `undefined`/falsy => generische Meldung `Session shared`
- Die temporäre Datei wird nach Abschluss gelöscht.

Kritisches Fallback-Verhalten:

- Falls ein benutzerdefinierter Handler existiert, aber das Laden fehlschlägt, gibt der Befehl einen Fehler aus und kehrt zurück.
- Falls ein benutzerdefinierter Handler ausgeführt wird und einen Fehler wirft, gibt der Befehl einen Fehler aus und kehrt zurück.
- In beiden Fehlerfällen wird **nicht** auf GitHub Gist zurückgefallen.
- Das Gist-Fallback findet nur statt, wenn kein benutzerdefiniertes Share-Skript existiert.

### Phase 3: Standard-Gist-Fallback

Nur wenn kein benutzerdefinierter Share-Handler gefunden wird:

1. Validiert `gh auth status`.
2. Zeigt `Creating gist...`-Ladeanzeige.
3. Führt `gh gist create --public=false <tmpFile>` aus.
4. Parst die Gist-URL, leitet die Gist-ID ab, erstellt die Vorschau-URL `https://gistpreview.github.io/?<id>`.
5. Zeigt sowohl Vorschau- als auch Gist-URLs an; öffnet die Vorschau.

Abbruch-/Abort-Semantik beim Teilen:

- Der Ladeindikator hat einen `onAbort`-Hook, der die Editor-UI wiederherstellt und `Share cancelled` meldet.
- Dem zugrunde liegenden `gh gist create`-Befehl wird in diesem Codepfad kein Abort-Signal übergeben; der Abbruch erfolgt auf UI-Ebene und wird nach Rückkehr des Befehls geprüft.

## Fork

`/fork` erstellt eine neue Sitzung aus der aktuellen und wechselt die aktive Sitzungsidentität.

### Vorbedingungen und sofortige Prüfungen

- Falls der Agent streamt, wird `/fork` mit einer Warnung abgelehnt.
- UI-Status-/Ladeindikatoren werden vor der Operation gelöscht.

### Ablauf auf Sitzungsebene

`AgentSession.fork()`:

1. Emittiert `session_before_switch` mit `reason: "fork"` (abbrechbar).
2. Leert ausstehende Schreibvorgänge.
3. Ruft `SessionManager.fork()` auf.
4. Kopiert das Artefaktverzeichnis vom alten Sitzungsnamensraum in den neuen Namensraum (Best-Effort; Kopierfehler, die nicht ENOENT sind, werden protokolliert, sind aber nicht fatal).
5. Aktualisiert `agent.sessionId`.
6. Emittiert `session_switch` mit `reason: "fork"`.

Verhalten von `SessionManager.fork()`:

- Erfordert den persistenten Modus und eine bestehende Sitzungsdatei.
- Erstellt eine neue Sitzungs-ID und einen neuen JSONL-Dateipfad.
- Schreibt den Header mit folgenden Änderungen neu:
  - neue `id`
  - neuer Zeitstempel
  - `cwd` unverändert
  - `parentSession` wird auf die vorherige Sitzungs-ID gesetzt
- Behält alle Nicht-Header-Einträge in der neuen Datei unverändert bei.

### Nicht-persistentes Verhalten

- Der In-Memory-Sitzungsmanager gibt `undefined` von `fork()` zurück.
- `AgentSession.fork()` gibt `false` zurück.
- Die UI meldet `Fork failed (session not persisted or cancelled)`.

## Fortsetzen und Weiterführen

## Interaktives `/resume`

Ablauf:

1. Öffnet den Sitzungsauswahldialog, befüllt über `SessionManager.list(currentCwd, currentSessionDir)`.
2. Bei Auswahl ruft `SelectorController.handleResumeSession(sessionPath)` `session.switchSession(sessionPath)` auf.
3. Die UI löscht/baut Chat und Todos neu auf und meldet dann `Resumed session`.

Hinweise:

- Dieser Auswahldialog listet nur Sitzungen im aktuellen Sitzungsverzeichnis-Bereich auf.
- Er verwendet keine globale projektübergreifende Suche.

## CLI `--resume`

### `--resume` (ohne Wert)

- `main.ts` listet Sitzungen für das aktuelle cwd/sessionDir auf und öffnet den Auswahldialog.
- Der ausgewählte Pfad wird mit `SessionManager.open(selectedPath)` vor der Sitzungserstellung geöffnet.

### `--resume <value>`

Auflösungsreihenfolge in `createSessionManager()`:

1. Falls der Wert wie ein Pfad aussieht (`/`, `\` oder `.jsonl`), direkt öffnen.
2. Andernfalls als ID-Präfix behandeln:
   - im aktuellen Bereich suchen (`SessionManager.list(cwd, sessionDir)`)
   - falls nicht gefunden und kein explizites `sessionDir`, global suchen (`SessionManager.listAll()`)

Verhalten bei projektübergreifendem ID-Match:

- Falls das cwd der gefundenen Sitzung vom aktuellen cwd abweicht, fragt die CLI:
  - `Session found in different project ... Fork into current directory? [y/N]`
- Bei Ja: `SessionManager.forkFrom(match.path, cwd, sessionDir)` erstellt eine neue lokale geforkte Datei.
- Bei Nein/Non-TTY-Standard: Der Befehl gibt einen Fehler aus.

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)`:

1. Löst das Sitzungsverzeichnis für das aktuelle cwd auf.
2. Liest zuerst den Terminal-spezifischen Breadcrumb.
3. Fällt auf die zuletzt geänderte Sitzungsdatei zurück.
4. Öffnet die gefundene Sitzung; falls keine existiert, wird eine neue Sitzung erstellt.

Dies ist ein reines Start-Verhalten; es gibt keinen interaktiven `/continue`-Slash-Befehl.

## Wie der Sitzungswechsel den Laufzeitzustand tatsächlich mutiert

`AgentSession.switchSession(sessionPath)` führt den Laufzeitübergang durch, der von Resume-ähnlichen Operationen verwendet wird:

1. Emittiert `session_before_switch` mit `reason: "resume"` und `targetSessionFile` (abbrechbar).
2. Trennt die Agent-Event-Subscription und bricht laufende Arbeit ab.
3. Löscht ausstehende Steering-/Follow-up-/Next-Turn-Nachrichten.
4. Leert ausstehende Schreibvorgänge des Sitzungsmanagers.
5. `sessionManager.setSessionFile(sessionPath)` und aktualisiert `agent.sessionId`.
6. Erstellt den Sitzungskontext aus den geladenen Einträgen.
7. Emittiert `session_switch` mit `reason: "resume"`.
8. Ersetzt die Agent-Nachrichten aus dem Kontext.
9. Stellt das Modell wieder her (falls in der aktuellen Registry verfügbar).
10. Stellt das Denk-Level wieder her oder initialisiert es.
11. Verbindet die Agent-Event-Subscription erneut.

Durch `switchSession()` selbst wird keine neue Sitzungsdatei erstellt.

## Event-Emissionen und Abbruchpunkte

### Switch/Fork-Lebenszyklus-Hooks

Für `newSession`, `fork` und `switchSession`:

- Vorher-Event: `session_before_switch`
  - Gründe: `new`, `fork`, `resume`
  - Abbrechbar durch Rückgabe von `{ cancel: true }`
- Nachher-Event: `session_switch`
  - Gleicher Grund-Satz
  - Enthält `previousSessionFile`

`ExtensionRunner.emit()` kehrt beim ersten abbrechenden Vorher-Event-Ergebnis frühzeitig zurück.

### `onSession`-Verhalten benutzerdefinierter Tools

Die SDK-Bridge leitet Extension-Sitzungsevents an `onSession`-Callbacks benutzerdefinierter Tools weiter:

- `session_switch` -> `onSession({ reason: "switch", previousSessionFile })`
- `session_branch` -> `reason: "branch"`
- `session_start` -> `reason: "start"`
- `session_tree` -> `reason: "tree"`
- `session_shutdown` -> `reason: "shutdown"`

Diese Callbacks sind observational; sie brechen keinen Switch/Fork ab.

### Weitere für dieses Dokument relevante Abbruchoberflächen

- `/fork` wird während des Streamings blockiert (der Benutzer muss die aktuelle Antwort erst abwarten/abbrechen).
- Der `/resume`-Auswahldialog kann vom Benutzer durch Schließen des Dialogs abgebrochen werden.
- Projektübergreifendes `--resume <id>` kann durch Ablehnung der Fork-Aufforderung abgebrochen werden.
- `/share` hat einen UI-Abbruchpfad (`Share cancelled`) für den Gist-Ablauf; es verdrahtet keine Prozess-Kill-Semantik für `gh gist create` in diesem Codepfad.

## Nicht-persistentes (In-Memory) Sitzungsverhalten

Wenn der Sitzungsmanager mit `SessionManager.inMemory()` (`--no-session`) erstellt wird:

- Der Sitzungsdateipfad ist nicht vorhanden.
- `/export` und `/share` scheitern mit `Cannot export in-memory session to HTML` (weitergeleitet an die Befehlsfehler-UI).
- `/fork` scheitert, da `SessionManager.fork()` Persistenz erfordert.
- `/dump` funktioniert weiterhin, da es den In-Memory-Agent-Zustand serialisiert.
- CLI-Resume/Continue-Semantiken werden umgangen, wenn `--no-session` gesetzt ist, da die Manager-Erstellung sofort In-Memory zurückgibt.

## Bekannte Implementierungseinschränkungen (Stand aktueller Code)

- `SelectorController.handleResumeSession()` prüft nicht das boolesche Ergebnis von `session.switchSession(...)`; ein durch einen Hook abgebrochener Wechsel kann dennoch den UI-Pfad "Resumed session" (Neuzeichnen/Status) durchlaufen.
- Fehler beim benutzerdefinierten Teilen bei `/share` fallen nicht auf das Standard-Gist-Fallback zurück; sie beenden den Befehl mit einem Fehler.
- Die Argument-Tokenisierung bei `/export` ist vereinfacht und erhält keine Pfade mit Leerzeichen in Anführungszeichen.
