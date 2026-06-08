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
| `/dump` | Interaktiver Slash-Befehl | Nein | Nein | Zwischenablagetext |
| `/export [path]` | Interaktiver Slash-Befehl | Nein | Nein | HTML-Datei |
| `--export <session.jsonl> [outputPath]` | CLI-Start-Schnellpfad | Keine Laufzeit-Sitzungsmutation | Keine aktive Sitzung; liest Zieldatei | HTML-Datei |
| `/share` | Interaktiver Slash-Befehl | Nein | Nein | Temporäre HTML + Share-URL/Gist |
| `/fork` | Interaktiver Slash-Befehl | Ja (aktive Sitzungsidentität ändert sich) | Erstellt neue Sitzungsdatei und wechselt aktuelle Sitzung dorthin (nur im persistenten Modus) | Kopiert Artefaktverzeichnis in neuen Sitzungs-Namensraum, sofern vorhanden |
| `/resume` | Interaktiver Slash-Befehl | Ja (aktiver In-Memory-Zustand wird ersetzt) | Wechselt zu ausgewählter bestehender Sitzungsdatei | Keins |
| `--resume` | CLI-Start (Auswahldialog) | Ja nach Sitzungserstellung | Öffnet ausgewählte bestehende Sitzungsdatei | Keins |
| `--resume <id\|path>` | CLI-Start | Ja nach Sitzungserstellung | Öffnet bestehende Sitzung; projektübergreifender Fall kann in aktuelles Projekt forken | Keins |
| `--continue` | CLI-Start | Ja nach Sitzungserstellung | Öffnet Terminal-Breadcrumb oder zuletzt verwendete Sitzung; erstellt neue, wenn keine existiert | Keins |

## Export und Dump

### `/export [outputPath]` (interaktiv)

Ablauf:

1. `InputController` leitet `/export...` an `CommandController.handleExportCommand` weiter.
2. Der Befehl teilt bei Leerzeichen und verwendet nur das erste Argument nach `/export` als `outputPath`.
3. `AgentSession.exportToHtml()` ruft `exportSessionToHtml(sessionManager, state, { outputPath, themeName })` auf.
4. Bei Erfolg zeigt die UI den Pfad an und öffnet die Datei im Browser.

Verhaltensdetails:

- `--copy`, `clipboard` und `copy` als Argumente werden explizit mit einer Warnung abgelehnt, `/dump` zu verwenden.
- Der Export bettet Sitzungs-Header/Einträge/Blatt plus den aktuellen `systemPrompt` und Toolbeschreibungen aus dem Agentenstatus ein.
- Während des Exports werden keine Sitzungseinträge hinzugefügt.

Einschränkung:

- Das Argument-Parsing ist leerzeichenbasiert (`text.split(/\s+/)`), sodass Pfade mit Leerzeichen in Anführungszeichen von diesem Befehlspfad nicht als einzelner Pfad beibehalten werden.

### `--export <inputSessionFile> [outputPath]` (CLI)

Ablauf in `main.ts`:

1. Wird frühzeitig verarbeitet (vor interaktivem/Sitzungs-Start).
2. Ruft `exportFromFile(inputPath, outputPath?)` auf.
3. `SessionManager.open(inputPath)` lädt Einträge, dann wird HTML generiert und geschrieben.
4. Der Prozess gibt `Exported to: ...` aus und beendet sich.

Verhaltensdetails:

- Eine fehlende Eingabedatei wird als `File not found: <path>` gemeldet.
- Dieser Pfad erstellt keine `AgentSession` und mutiert keine laufende Sitzung.

### `/dump` (interaktiver Zwischenablage-Export)

Ablauf:

1. `CommandController.handleDumpCommand()` ruft `session.formatSessionAsText()` auf.
2. Bei leerem String wird `No messages to dump yet.` gemeldet.
3. Andernfalls wird in die Zwischenablage über natives `copyToClipboard` kopiert.

Dump-Inhalt umfasst:

- System-Prompt
- Aktives Modell/Thinking-Level
- Tool-Definitionen + Parameter
- Benutzer-/Assistenten-Nachrichten
- Thinking-Blöcke und Tool-Aufrufe
- Tool-Ergebnisse und Ausführungsblöcke (außer `excludeFromContext` Bash/Python-Einträge)
- Benutzerdefinierte/Hook-/Dateierwähnungs-/Branch-Zusammenfassungs-/Komprimierungszusammenfassungs-Einträge

Durch das Dumping werden keine Sitzungs-Persistenzänderungen vorgenommen.

## Teilen

`/share` ist nur interaktiv verfügbar und beginnt immer mit dem Export der aktuellen Sitzung in eine temporäre HTML-Datei.

### Phase 1: Temporärer Export

- Temporärer Dateipfad: `${os.tmpdir()}/${Snowflake.next()}.html`
- Verwendet `session.exportToHtml(tmpFile)`
- Wenn der Export fehlschlägt (insbesondere bei In-Memory-Sitzungen), endet das Teilen mit einem Fehler.

### Phase 2: Benutzerdefinierter Share-Handler (falls vorhanden)

`loadCustomShare()` prüft `~/.xcsh/agent` auf den ersten vorhandenen Kandidaten:

- `share.ts`
- `share.js`
- `share.mjs`

Anforderungen:

- Das Modul muss eine Funktion als Default-Export bereitstellen: `(htmlPath) => Promise<CustomShareResult | string | undefined>`.

Falls vorhanden und gültig:

- Die UI wechselt in den `Sharing...`-Ladezustand.
- Interpretation des Handler-Ergebnisses:
  - String => wird als URL behandelt, angezeigt und geöffnet
  - Objekt => `url` und/oder `message` werden angezeigt; `url` wird geöffnet
  - `undefined`/falsy => generisches `Session shared`
- Die temporäre Datei wird nach Abschluss entfernt.

Kritisches Fallback-Verhalten:

- Wenn ein benutzerdefinierter Handler existiert, aber das Laden fehlschlägt, gibt der Befehl einen Fehler aus und kehrt zurück.
- Wenn ein benutzerdefinierter Handler ausgeführt wird und eine Exception wirft, gibt der Befehl einen Fehler aus und kehrt zurück.
- In beiden Fehlerfällen fällt er **nicht** auf GitHub Gist zurück.
- Das Gist-Fallback tritt nur ein, wenn kein benutzerdefiniertes Share-Skript existiert.

### Phase 3: Standard-Gist-Fallback

Nur wenn kein benutzerdefinierter Share-Handler gefunden wird:

1. Validiert `gh auth status`.
2. Zeigt `Creating gist...`-Ladezustand.
3. Führt `gh gist create --public=false <tmpFile>` aus.
4. Parst die Gist-URL, leitet die Gist-ID ab, erstellt Vorschau-URL `https://gistpreview.github.io/?<id>`.
5. Zeigt sowohl Vorschau- als auch Gist-URLs an; öffnet die Vorschau.

Abbruch-/Abort-Semantik beim Teilen:

- Der Ladezustand hat einen `onAbort`-Hook, der die Editor-UI wiederherstellt und `Share cancelled` meldet.
- Dem zugrunde liegenden `gh gist create`-Befehl wird in diesem Codepfad kein Abort-Signal übergeben; der Abbruch erfolgt auf UI-Ebene und wird nach Rückkehr des Befehls geprüft.

## Fork

`/fork` erstellt eine neue Sitzung aus der aktuellen und wechselt die aktive Sitzungsidentität.

### Vorbedingungen und sofortige Schutzprüfungen

- Wenn der Agent streamt, wird `/fork` mit einer Warnung abgelehnt.
- UI-Status-/Ladeanzeigen werden vor der Operation zurückgesetzt.

### Sitzungsebene-Ablauf

`AgentSession.fork()`:

1. Emittiert `session_before_switch` mit `reason: "fork"` (abbrechbar).
2. Flusht ausstehende Schreibvorgänge.
3. Ruft `SessionManager.fork()` auf.
4. Kopiert das Artefaktverzeichnis vom alten Sitzungs-Namensraum in den neuen (Best-Effort; Nicht-ENOENT-Kopierfehler werden geloggt, sind aber nicht fatal).
5. Aktualisiert `agent.sessionId`.
6. Emittiert `session_switch` mit `reason: "fork"`.

`SessionManager.fork()`-Verhalten:

- Erfordert persistenten Modus und bestehende Sitzungsdatei.
- Erstellt neue Sitzungs-ID und neuen JSONL-Dateipfad.
- Schreibt Header neu mit:
  - neuer `id`
  - neuem Zeitstempel
  - `cwd` unverändert
  - `parentSession` auf vorherige Sitzungs-ID gesetzt
- Behält alle Nicht-Header-Einträge in der neuen Datei unverändert bei.

### Nicht-persistentes Verhalten

- Der In-Memory-Session-Manager gibt `undefined` von `fork()` zurück.
- `AgentSession.fork()` gibt `false` zurück.
- Die UI meldet `Fork failed (session not persisted or cancelled)`.

## Fortsetzen und Continue

## Interaktives `/resume`

Ablauf:

1. Öffnet den Sitzungsauswahldialog, befüllt über `SessionManager.list(currentCwd, currentSessionDir)`.
2. Bei Auswahl ruft `SelectorController.handleResumeSession(sessionPath)` `session.switchSession(sessionPath)` auf.
3. Die UI löscht/baut Chat und Todos neu auf und meldet dann `Resumed session`.

Hinweise:

- Dieser Auswahldialog listet nur Sitzungen im aktuellen Sitzungsverzeichnis-Scope auf.
- Er verwendet keine globale projektübergreifende Suche.

## CLI `--resume`

### `--resume` (ohne Wert)

- `main.ts` listet Sitzungen für aktuelles cwd/sessionDir auf und öffnet den Auswahldialog.
- Der ausgewählte Pfad wird mit `SessionManager.open(selectedPath)` vor der Sitzungserstellung geöffnet.

### `--resume <value>`

Auflösungsreihenfolge in `createSessionManager()`:

1. Wenn der Wert wie ein Pfad aussieht (`/`, `\` oder `.jsonl`), direkt öffnen.
2. Andernfalls als ID-Präfix behandeln:
   - aktuellen Scope durchsuchen (`SessionManager.list(cwd, sessionDir)`)
   - wenn nicht gefunden und kein explizites `sessionDir`, global suchen (`SessionManager.listAll()`)

Projektübergreifendes ID-Match-Verhalten:

- Wenn das cwd der gefundenen Sitzung vom aktuellen cwd abweicht, fragt die CLI:
  - `Session found in different project ... Fork into current directory? [y/N]`
- Bei Ja: `SessionManager.forkFrom(match.path, cwd, sessionDir)` erstellt eine neue lokale geforkte Datei.
- Bei Nein/Nicht-TTY-Standard: Der Befehl endet mit Fehler.

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)`:

1. Löst das Sitzungsverzeichnis für das aktuelle cwd auf.
2. Liest zuerst den terminalspezifischen Breadcrumb.
3. Fällt auf die zuletzt geänderte Sitzungsdatei zurück.
4. Öffnet die gefundene Sitzung; wenn keine existiert, wird eine neue Sitzung erstellt.

Dies ist ein reines Startverhalten; es gibt keinen interaktiven `/continue`-Slash-Befehl.

## Wie der Sitzungswechsel den Laufzeitzustand tatsächlich mutiert

`AgentSession.switchSession(sessionPath)` führt den Laufzeitübergang durch, der von Resume-ähnlichen Operationen verwendet wird:

1. Emittiert `session_before_switch` mit `reason: "resume"` und `targetSessionFile` (abbrechbar).
2. Trennt die Agent-Event-Subscription und bricht laufende Arbeit ab.
3. Löscht eingereihte Steering-/Follow-up-/Next-Turn-Nachrichten.
4. Flusht aktuelle Session-Manager-Schreibvorgänge.
5. `sessionManager.setSessionFile(sessionPath)` und aktualisiert `agent.sessionId`.
6. Baut den Sitzungskontext aus geladenen Einträgen auf.
7. Emittiert `session_switch` mit `reason: "resume"`.
8. Ersetzt Agent-Nachrichten aus dem Kontext.
9. Stellt das Modell wieder her (falls in der aktuellen Registry verfügbar).
10. Stellt den Thinking-Level wieder her oder initialisiert ihn.
11. Verbindet die Agent-Event-Subscription erneut.

`switchSession()` selbst erstellt keine neue Sitzungsdatei.

## Event-Emissionen und Abbruchpunkte

### Switch/Fork-Lifecycle-Hooks

Für `newSession`, `fork` und `switchSession`:

- Vorher-Event: `session_before_switch`
  - Gründe: `new`, `fork`, `resume`
  - Abbrechbar durch Rückgabe von `{ cancel: true }`
- Nachher-Event: `session_switch`
  - Gleiche Gründe
  - Enthält `previousSessionFile`

`ExtensionRunner.emit()` kehrt beim ersten abbrechenden Vorher-Event-Ergebnis frühzeitig zurück.

### Benutzerdefiniertes Tool `onSession`-Verhalten

Das SDK leitet Extension-Sitzungs-Events an benutzerdefinierte Tool-`onSession`-Callbacks weiter:

- `session_switch` -> `onSession({ reason: "switch", previousSessionFile })`
- `session_branch` -> `reason: "branch"`
- `session_start` -> `reason: "start"`
- `session_tree` -> `reason: "tree"`
- `session_shutdown` -> `reason: "shutdown"`

Diese Callbacks sind beobachtend; sie brechen weder Switch noch Fork ab.

### Weitere für dieses Dokument relevante Abbruchoberflächen

- `/fork` wird während des Streamings blockiert (der Benutzer muss die aktuelle Antwort erst abwarten/abbrechen).
- Der `/resume`-Auswahldialog kann vom Benutzer durch Schließen des Dialogs abgebrochen werden.
- Projektübergreifendes `--resume <id>` kann durch Ablehnung der Fork-Aufforderung abgebrochen werden.
- `/share` hat einen UI-Abbruchpfad (`Share cancelled`) für den Gist-Flow; es werden in diesem Codepfad keine Process-Kill-Semantiken für `gh gist create` verdrahtet.

## Nicht-persistentes (In-Memory) Sitzungsverhalten

Wenn der Session-Manager mit `SessionManager.inMemory()` (`--no-session`) erstellt wird:

- Der Sitzungsdateipfad fehlt.
- `/export` und `/share` schlagen mit `Cannot export in-memory session to HTML` fehl (wird an die Befehls-Fehler-UI weitergegeben).
- `/fork` schlägt fehl, weil `SessionManager.fork()` Persistenz erfordert.
- `/dump` funktioniert weiterhin, da es den In-Memory-Agentenstatus serialisiert.
- CLI-Resume/Continue-Semantiken werden umgangen, wenn `--no-session` gesetzt ist, da die Manager-Erstellung sofort In-Memory zurückkehrt.

## Bekannte Implementierungseinschränkungen (Stand aktueller Code)

- `SelectorController.handleResumeSession()` prüft nicht das boolesche Ergebnis von `session.switchSession(...)`; ein durch einen Hook abgebrochener Wechsel kann dennoch durch den UI-Pfad "Resumed session" (Neuzeichnung/Status) fortschreiten.
- Fehler bei `/share` mit benutzerdefiniertem Share-Handler degradieren nicht zum Standard-Gist-Fallback; sie beenden den Befehl mit einem Fehler.
- Die Argument-Tokenisierung bei `/export` ist simplistisch und bewahrt keine Pfade mit Leerzeichen in Anführungszeichen.
