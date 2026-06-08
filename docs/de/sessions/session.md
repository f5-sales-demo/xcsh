---
title: Sitzungsspeicherung und Eintragsmodell
description: >-
  Append-only-Sitzungsspeichermodell mit Eintragstypen, Persistenz und Migration
  zwischen Formaten.
sidebar:
  order: 1
  label: Speicherung & Eintragsmodell
i18n:
  sourceHash: 42fe17549e00
  translator: machine
---

# Sitzungsspeicherung und Eintragsmodell

Dieses Dokument ist die maßgebliche Quelle dafür, wie Coding-Agent-Sitzungen repräsentiert, persistiert, migriert und zur Laufzeit rekonstruiert werden.

## Geltungsbereich

Umfasst:

- JSONL-Format und Versionierung von Sitzungen
- Eintragstaxonomie und Baumsemantik (`id`/`parentId` + Blattzeiger)
- Migrations-/Kompatibilitätsverhalten beim Laden alter oder fehlerhafter Dateien
- Kontextrekonstruktion (`buildSessionContext`)
- Persistenzgarantien, Fehlerverhalten, Kürzung/Blob-Externalisierung
- Speicherabstraktionen (`FileSessionStorage`, `MemorySessionStorage`) und zugehörige Hilfsprogramme

Umfasst nicht das `/tree`-UI-Rendering-Verhalten über die Semantik hinaus, die Sitzungsdaten betrifft.

## Implementierungsdateien

- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`src/session/messages.ts`](../../packages/coding-agent/src/session/messages.ts)
- [`src/session/session-storage.ts`](../../packages/coding-agent/src/session/session-storage.ts)
- [`src/session/history-storage.ts`](../../packages/coding-agent/src/session/history-storage.ts)
- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts)

## Layout auf der Festplatte

Standardmäßiger Speicherort für Sitzungsdateien:

```text
~/.xcsh/agent/sessions/--<cwd-encoded>--/<timestamp>_<sessionId>.jsonl
```

`<cwd-encoded>` wird aus dem Arbeitsverzeichnis abgeleitet, indem der führende Schrägstrich entfernt und `/`, `\\` sowie `:` durch `-` ersetzt werden.

Speicherort des Blob-Stores:

```text
~/.xcsh/agent/blobs/<sha256>
```

Terminal-Breadcrumb-Dateien werden geschrieben unter:

```text
~/.xcsh/agent/terminal-sessions/<terminal-id>
```

Der Breadcrumb-Inhalt besteht aus zwei Zeilen: dem ursprünglichen Arbeitsverzeichnis und dem Pfad zur Sitzungsdatei. `continueRecent()` bevorzugt diesen terminalspezifischen Zeiger, bevor nach der neuesten mtime gesucht wird.

## Dateiformat

Sitzungsdateien sind im JSONL-Format: ein JSON-Objekt pro Zeile.

- Zeile 1 ist immer der Sitzungsheader (`type: "session"`).
- Die übrigen Zeilen sind `SessionEntry`-Werte.
- Einträge werden zur Laufzeit nur angehängt (Append-only); bei der Branchnavigation wird ein Zeiger (`leafId`) verschoben, anstatt bestehende Einträge zu verändern.

### Header (`SessionHeader`)

```json
{
  "type": "session",
  "version": 3,
  "id": "1f9d2a6b9c0d1234",
  "timestamp": "2026-02-16T10:20:30.000Z",
  "cwd": "/work/pi",
  "title": "optional session title",
  "parentSession": "optional lineage marker"
}
```

Hinweise:

- `version` ist in v1-Dateien optional; Abwesenheit bedeutet v1.
- `parentSession` ist eine opake Abstammungszeichenkette. Der aktuelle Code schreibt je nach Ablauf entweder eine Sitzungs-ID oder einen Sitzungspfad (`fork`, `forkFrom`, `createBranchedSession` oder explizit `newSession({ parentSession })`). Behandeln Sie dies als Metadaten, nicht als typisierten Fremdschlüssel.

### Eintragsbasis (`SessionEntryBase`)

Alle Nicht-Header-Einträge enthalten:

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

`parentId` kann `null` sein für einen Wurzeleintrag (erstes Anhängen oder nach `resetLeaf()`).

## Eintragstaxonomie

`SessionEntry` ist die Vereinigung von:

- `message`
- `thinking_level_change`
- `model_change`
- `compaction`
- `branch_summary`
- `custom`
- `custom_message`
- `label`
- `ttsr_injection`
- `session_init`
- `mode_change`

### `message`

Speichert eine `AgentMessage` direkt.

```json
{
  "type": "message",
  "id": "a1b2c3d4",
  "parentId": null,
  "timestamp": "2026-02-16T10:21:00.000Z",
  "message": {
    "role": "assistant",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "content": [{ "type": "text", "text": "Done." }],
    "usage": { "input": 100, "output": 20, "cacheRead": 0, "cacheWrite": 0, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } },
    "timestamp": 1760000000000
  }
}
```

### `model_change`

```json
{
  "type": "model_change",
  "id": "b1c2d3e4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:21:30.000Z",
  "model": "openai/gpt-4o",
  "role": "default"
}
```

`role` ist optional; fehlend wird bei der Kontextrekonstruktion als `default` behandelt.

### `thinking_level_change`

```json
{
  "type": "thinking_level_change",
  "id": "c1d2e3f4",
  "parentId": "b1c2d3e4",
  "timestamp": "2026-02-16T10:22:00.000Z",
  "thinkingLevel": "high"
}
```

### `compaction`

```json
{
  "type": "compaction",
  "id": "d1e2f3a4",
  "parentId": "c1d2e3f4",
  "timestamp": "2026-02-16T10:23:00.000Z",
  "summary": "Conversation summary",
  "shortSummary": "Short recap",
  "firstKeptEntryId": "a1b2c3d4",
  "tokensBefore": 42000,
  "details": { "readFiles": ["src/a.ts"] },
  "preserveData": { "hookState": true },
  "fromExtension": false
}
```

### `branch_summary`

```json
{
  "type": "branch_summary",
  "id": "e1f2a3b4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:24:00.000Z",
  "fromId": "a1b2c3d4",
  "summary": "Summary of abandoned path",
  "details": { "note": "optional" },
  "fromExtension": true
}
```

Wenn vom Wurzelknoten abgezweigt wird (`branchFromId === null`), ist `fromId` die Literalzeichenkette `"root"`.

### `custom`

Erweiterungs-Zustandspersistenz; wird von `buildSessionContext` ignoriert.

```json
{
  "type": "custom",
  "id": "f1a2b3c4",
  "parentId": "e1f2a3b4",
  "timestamp": "2026-02-16T10:25:00.000Z",
  "customType": "my-extension",
  "data": { "state": 1 }
}
```

### `custom_message`

Von einer Erweiterung bereitgestellte Nachricht, die am LLM-Kontext teilnimmt.

```json
{
  "type": "custom_message",
  "id": "a2b3c4d5",
  "parentId": "f1a2b3c4",
  "timestamp": "2026-02-16T10:26:00.000Z",
  "customType": "my-extension",
  "content": "Injected context",
  "display": true,
  "details": { "debug": false }
}
```

### `label`

```json
{
  "type": "label",
  "id": "b2c3d4e5",
  "parentId": "a2b3c4d5",
  "timestamp": "2026-02-16T10:27:00.000Z",
  "targetId": "a1b2c3d4",
  "label": "checkpoint"
}
```

`label: undefined` entfernt ein Label für `targetId`.

### `ttsr_injection`

```json
{
  "type": "ttsr_injection",
  "id": "c2d3e4f5",
  "parentId": "b2c3d4e5",
  "timestamp": "2026-02-16T10:28:00.000Z",
  "injectedRules": ["ruleA", "ruleB"]
}
```

### `session_init`

```json
{
  "type": "session_init",
  "id": "d2e3f4a5",
  "parentId": "c2d3e4f5",
  "timestamp": "2026-02-16T10:29:00.000Z",
  "systemPrompt": "...",
  "task": "...",
  "tools": ["read", "edit"],
  "outputSchema": { "type": "object" }
}
```

### `mode_change`

```json
{
  "type": "mode_change",
  "id": "e2f3a4b5",
  "parentId": "d2e3f4a5",
  "timestamp": "2026-02-16T10:30:00.000Z",
  "mode": "plan",
  "data": { "planFile": "/tmp/plan.md" }
}
```

## Versionierung und Migration

Aktuelle Sitzungsversion: `3`.

### v1 -> v2

Wird angewendet, wenn der Header `version` fehlt oder `< 2` ist:

- Fügt `id` und `parentId` zu jedem Nicht-Header-Eintrag hinzu.
- Rekonstruiert eine lineare Elternkette anhand der Dateireihenfolge.
- Migriert das Compaction-Feld `firstKeptEntryIndex` -> `firstKeptEntryId`, wenn vorhanden.
- Setzt Header `version = 2`.

### v2 -> v3

Wird angewendet, wenn Header `version < 3`:

- Für `message`-Einträge: Schreibt das veraltete `message.role === "hookMessage"` zu `"custom"` um.
- Setzt Header `version = 3`.

### Migrationsauslöser und Persistenz

- Migrationen werden beim Laden der Sitzung ausgeführt (`setSessionFile`).
- Wenn eine Migration ausgeführt wurde, wird die gesamte Datei sofort auf die Festplatte neu geschrieben.
- Die Migration verändert zuerst die In-Memory-Einträge und persistiert dann das neu geschriebene JSONL.

## Lade- und Kompatibilitätsverhalten

Verhalten von `loadEntriesFromFile(path)`:

- Fehlende Datei (`ENOENT`) -> gibt `[]` zurück.
- Nicht parsbare Zeilen werden vom nachsichtigen JSONL-Parser (`parseJsonlLenient`) behandelt.
- Wenn der erste geparste Eintrag kein gültiger Sitzungsheader ist (`type !== "session"` oder fehlende Zeichenkette `id`) -> gibt `[]` zurück.

Verhalten von `SessionManager.setSessionFile()`:

- `[]` vom Loader wird als leere/nicht vorhandene Sitzung behandelt und durch eine neue initialisierte Sitzungsdatei an diesem Pfad ersetzt.
- Gültige Dateien werden geladen, bei Bedarf migriert, Blob-Referenzen aufgelöst und dann indiziert.

## Baum- und Blattsemantik

Das zugrundeliegende Modell ist ein Append-only-Baum + veränderlicher Blattzeiger:

- Jede Append-Methode erstellt genau einen neuen Eintrag, dessen `parentId` die aktuelle `leafId` ist.
- Der neue Eintrag wird zur neuen `leafId`.
- `branch(entryId)` verschiebt nur `leafId`; bestehende Einträge bleiben unverändert.
- `resetLeaf()` setzt `leafId = null`; das nächste Anhängen erstellt einen neuen Wurzeleintrag (`parentId: null`).
- `branchWithSummary()` setzt das Blatt auf das Branchziel und hängt einen `branch_summary`-Eintrag an.

`getEntries()` gibt alle Nicht-Header-Einträge in Einfügereihenfolge zurück. Bestehende Einträge werden im normalen Betrieb nicht gelöscht; Neuschreibungen bewahren die logische Historie, während die Repräsentation aktualisiert wird (Migrationen, Verschiebungen, gezielte Neuschreibungshilfen).

## Kontextrekonstruktion (`buildSessionContext`)

`buildSessionContext(entries, leafId, byId?)` ermittelt, was an das Modell gesendet wird.

Algorithmus:

1. Blatt bestimmen:
   - `leafId === null` -> leeren Kontext zurückgeben.
   - explizite `leafId` -> diesen Eintrag verwenden, falls gefunden.
   - andernfalls Fallback auf den letzten Eintrag.
2. Die `parentId`-Kette vom Blatt zur Wurzel durchlaufen und zum Wurzel->Blatt-Pfad umkehren.
3. Laufzeitzustand über den Pfad ableiten:
   - `thinkingLevel` aus dem neuesten `thinking_level_change` (Standard `"off"`)
   - Modellzuordnung aus `model_change`-Einträgen (`role ?? "default"`)
   - Fallback `models.default` aus dem Provider/Modell der Assistentennachricht, wenn keine explizite Modelländerung vorliegt
   - Deduplizierte `injectedTtsrRules` aus allen `ttsr_injection`-Einträgen
   - Modus/Modusdaten aus dem neuesten `mode_change` (Standardmodus `"none"`)
4. Nachrichtenliste erstellen:
   - `message`-Einträge werden durchgereicht
   - `custom_message`-Einträge werden über `createCustomMessage` zu `custom`-AgentMessages
   - `branch_summary`-Einträge werden über `createBranchSummaryMessage` zu `branchSummary`-AgentMessages
   - Wenn eine `compaction` auf dem Pfad existiert:
     - Zuerst die Compaction-Zusammenfassung ausgeben (`createCompactionSummaryMessage`)
     - Pfadeinträge ab `firstKeptEntryId` bis zur Compaction-Grenze ausgeben
     - Einträge nach der Compaction-Grenze ausgeben

`custom`- und `session_init`-Einträge injizieren keinen Modellkontext direkt.

## Persistenzgarantien und Fehlermodell

### Persistenz vs. In-Memory

- `SessionManager.create/open/continueRecent/forkFrom` -> persistenter Modus (`persist = true`).
- `SessionManager.inMemory` -> nicht-persistenter Modus (`persist = false`) mit `MemorySessionStorage`.

### Schreibpipeline

Schreibvorgänge werden über eine interne Promise-Kette (`#persistChain`) und `NdjsonFileWriter` serialisiert.

- `append*` aktualisiert den In-Memory-Zustand sofort.
- Die Persistierung wird aufgeschoben, bis mindestens eine Assistentennachricht existiert.
  - Vor der ersten Assistentennachricht: Einträge werden im Speicher gehalten; kein Dateischreibvorgang erfolgt.
  - Wenn die erste Assistentennachricht existiert: Die vollständige In-Memory-Sitzung wird in die Datei geflusht.
  - Danach: Neue Einträge werden inkrementell angehängt.

Begründung im Code: Vermeidung der Persistierung von Sitzungen, die nie eine Assistentenantwort erzeugt haben.

### Haltbarkeitsoperationen

- `flush()` flusht den Writer und ruft `fsync()` auf.
- Atomare vollständige Neuschreibungen (`#rewriteFile`) schreiben in eine temporäre Datei, flushen+fsyncen, schließen und benennen dann über die Zieldatei um.
- Wird verwendet für Migrationen, `setSessionName`, `rewriteEntries`, Verschiebungsoperationen und Neuschreibungen von Tool-Call-Argumenten.

### Fehlerverhalten

- Persistenzfehler werden gespeichert (`#persistError`) und bei nachfolgenden Operationen erneut ausgelöst.
- Der erste Fehler wird einmalig mit Sitzungsdateikontext protokolliert.
- Das Schließen des Writers erfolgt bestmöglich, propagiert aber den ersten bedeutsamen Fehler.

## Datengrößenkontrollen und Blob-Externalisierung

Vor der Persistierung von Einträgen:

- Große Zeichenketten werden auf `MAX_PERSIST_CHARS` (500.000 Zeichen) gekürzt mit Hinweis:
  - `"[Session persistence truncated large content]"`
- Transiente Felder `partialJson` und `jsonlEvents` werden entfernt.
- Wenn ein Objekt sowohl `content` als auch `lineCount` hat, wird die Zeilenzahl nach der Kürzung neu berechnet.
- Bildblöcke in `content`-Arrays mit Base64-Länge >= 1024 werden zu Blob-Referenzen externalisiert:
  - Gespeichert als `blob:sha256:<hash>`
  - Rohdaten werden in den Blob-Store geschrieben (`BlobStore.put`)

Beim Laden werden Blob-Referenzen für Bildblöcke in message/custom_message zurück zu Base64 aufgelöst.

## Speicherabstraktionen

Das `SessionStorage`-Interface stellt alle Dateisystemoperationen bereit, die von `SessionManager` verwendet werden:

- synchron: `ensureDirSync`, `existsSync`, `writeTextSync`, `statSync`, `listFilesSync`
- asynchron: `exists`, `readText`, `readTextPrefix`, `writeText`, `rename`, `unlink`, `openWriter`

Implementierungen:

- `FileSessionStorage`: echtes Dateisystem (Bun + node fs)
- `MemorySessionStorage`: Map-basierte In-Memory-Implementierung für Tests/nicht-persistente Sitzungen

`SessionStorageWriter` stellt `writeLine`, `flush`, `fsync`, `close`, `getError` bereit.

## Hilfsprogramme zur Sitzungserkennung

Definiert in `session-manager.ts`:

- `getRecentSessions(sessionDir, limit)` -> leichtgewichtige Metadaten für UI/Sitzungsauswahl
- `findMostRecentSession(sessionDir)` -> neueste nach mtime
- `list(cwd, sessionDir?)` -> Sitzungen in einem Projektbereich
- `listAll()` -> Sitzungen über alle Projektbereiche unter `~/.xcsh/agent/sessions`

Die Metadatenextraktion liest nach Möglichkeit nur ein Präfix (`readTextPrefix(..., 4096)`).

## Verwandt, aber eigenständig: Prompt-Verlaufsspeicherung

`HistoryStorage` (`history-storage.ts`) ist ein separates SQLite-Subsystem für Prompt-Rückruf/-Suche, nicht für die Sitzungswiedergabe.

- Datenbank: `~/.xcsh/agent/history.db`
- Tabelle: `history(id, prompt, created_at, cwd)`
- FTS5-Index: `history_fts` mit trigger-gestützter Synchronisation
- Dedupliziert aufeinanderfolgende identische Prompts mittels In-Memory-Letzter-Prompt-Cache
- Asynchrone Einfügung (`setImmediate`), damit die Prompt-Erfassung die Ausführung des Turns nicht blockiert

Verwenden Sie Sitzungsdateien für die Konversationsgraph-/Zustandswiedergabe; verwenden Sie `HistoryStorage` für die Prompt-Verlauf-UX.
