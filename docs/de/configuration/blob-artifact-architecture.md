---
title: Architektur der Blob- und Artefakt-Speicherung
description: >-
  Inhaltsadressierter Blob-Speicher und Artefakt-Registry für Sitzungsmedien,
  Screenshots und Tool-Ausgaben.
sidebar:
  order: 7
  label: Blob- & Artefakt-Speicherung
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# Architektur der Blob- und Artefakt-Speicherung

Dieses Dokument beschreibt, wie der Coding-Agent große/binäre Nutzdaten außerhalb der Sitzungs-JSONL speichert, wie abgeschnittene Tool-Ausgaben persistiert werden und wie interne URLs (`artifact://`, `agent://`) auf gespeicherte Daten zurückauflösen.

## Warum zwei Speichersysteme existieren

Die Laufzeitumgebung verwendet zwei verschiedene Persistenzmechanismen für unterschiedliche Datenformen:

- **Inhaltsadressierte Blobs** (`blob:sha256:<hash>`): globaler, binärorientierter Speicher, der verwendet wird, um große Base64-Bild-Nutzdaten aus persistierten Sitzungseinträgen auszulagern.
- **Sitzungsbezogene Artefakte** (Dateien unter `<sessionFile-ohne-.jsonl>/`): sitzungsspezifische Textdateien für vollständige Tool-Ausgaben und Subagent-Ausgaben.

Sie sind absichtlich getrennt:

- Blob-Speicherung optimiert Deduplizierung und stabile Referenzen durch Inhalts-Hash,
- Artefakt-Speicherung optimiert Append-only-Sitzungswerkzeuge und Abruf durch Menschen/Tools über lokale IDs.

## Speichergrenzen und Festplattenstruktur

## Blob-Speichergrenze (global)

`SessionManager` konstruiert `BlobStore(getBlobsDir())`, sodass Blob-Dateien in einem gemeinsamen globalen Blob-Verzeichnis liegen (nicht in einem Sitzungsordner).

Blob-Dateibenennung:

- Dateipfad: `<blobsDir>/<sha256-hex>`
- keine Erweiterung
- In Einträgen gespeicherter Referenzstring: `blob:sha256:<sha256-hex>`

Implikationen:

- derselbe binäre Inhalt über Sitzungen hinweg löst zum selben Hash/Pfad auf,
- Schreibvorgänge sind auf Inhaltsebene idempotent,
- Blobs können jede einzelne Sitzungsdatei überdauern.

## Artefakt-Grenze (sitzungslokal)

`ArtifactManager` leitet das Artefakt-Verzeichnis vom Sitzungsdateipfad ab:

- Sitzungsdatei: `.../<timestamp>_<sessionId>.jsonl`
- Artefakt-Verzeichnis: `.../<timestamp>_<sessionId>/` (`.jsonl` entfernen)

Artefakttypen teilen sich dieses Verzeichnis:

- Abgeschnittene Tool-Ausgabedateien: `<numericId>.<toolType>.log` (für `artifact://`)
- Subagent-Ausgabedateien: `<outputId>.md` (für `agent://`)

## ID- und Namensallokationsschemata

## Blob-IDs: Inhalts-Hash

`BlobStore.put()` berechnet SHA-256 über die rohen Binärbytes und gibt zurück:

- `hash`: Hex-Digest,
- `path`: `<blobsDir>/<hash>`,
- `ref`: `blob:sha256:<hash>`.

Es wird kein sitzungslokaler Zähler verwendet.

## Artefakt-IDs: sitzungslokal monoton steigende Ganzzahl

`ArtifactManager` durchsucht bestehende `*.log`-Artefaktdateien bei der ersten Verwendung, um die maximale vorhandene numerische ID zu finden, und setzt `nextId = max + 1`.

Allokationsverhalten:

- Dateiformat: `{id}.{toolType}.log`
- IDs sind sequenzielle Strings (`"0"`, `"1"`, ...)
- Wiederaufnahme überschreibt keine bestehenden Artefakte, da der Scan vor der Allokation stattfindet.

Wenn das Artefakt-Verzeichnis fehlt, ergibt der Scan eine leere Liste und die Allokation beginnt bei `0`.

## Agent-Ausgabe-IDs (`agent://`)

`AgentOutputManager` allokiert IDs für Subagent-Ausgaben als `<index>-<requestedId>` (optional unter einem übergeordneten Präfix verschachtelt, z.B. `0-Parent.1-Child`). Er durchsucht bei der Initialisierung bestehende `.md`-Dateien, um bei der Wiederaufnahme mit dem nächsten Index fortzufahren.

## Persistenz-Datenfluss

## 1) Umschreibpfad bei der Sitzungseintrags-Persistierung

Bevor Sitzungseinträge geschrieben werden (`#rewriteFile` / inkrementelle Persistierung), ruft `SessionManager` `prepareEntryForPersistence()` auf (über `truncateForPersistence`).

Schlüsselverhalten:

1. **Abschneiden großer Strings**: Übergroße Strings werden abgeschnitten und mit `"[Session persistence truncated large content]"` suffigiert.
2. **Entfernen transienter Felder**: `partialJson` und `jsonlEvents` werden aus persistierten Einträgen entfernt.
3. **Bildauslagerung in Blobs**:
   - gilt nur für Bildblöcke in `content`-Arrays,
   - nur wenn `data` nicht bereits eine Blob-Referenz ist,
   - nur wenn die Base64-Länge mindestens den Schwellenwert erreicht (`BLOB_EXTERNALIZE_THRESHOLD = 1024`),
   - ersetzt Inline-Base64 durch `blob:sha256:<hash>`.

Dies hält die Sitzungs-JSONL kompakt und bewahrt gleichzeitig die Wiederherstellbarkeit.

## 2) Rehydrierungspfad beim Laden der Sitzung

Beim Öffnen einer Sitzung (`setSessionFile`) führt `SessionManager` nach den Migrationen `resolveBlobRefsInEntries()` aus.

Für jeden Nachrichten-/benutzerdefinierte-Nachricht-Bildblock mit `blob:sha256:<hash>`:

- liest Blob-Bytes aus dem Blob-Speicher,
- konvertiert Bytes zurück in Base64,
- mutiert den In-Memory-Eintrag zu Inline-Base64 für Laufzeit-Konsumenten.

Wenn ein Blob fehlt:

- `resolveImageData()` gibt eine Warnung aus,
- gibt den ursprünglichen Referenzstring unverändert zurück,
- das Laden wird fortgesetzt (kein harter Absturz).

## 3) Tool-Ausgabe-Auslagerungs-/Abschneidepfad

`OutputSink` ermöglicht Streaming-Ausgabe in bash/python/ssh und verwandten Executors.

Verhalten:

1. Jeder Chunk wird bereinigt und an den In-Memory-Tail-Puffer angehängt.
2. Wenn die In-Memory-Bytes den Auslagerungsschwellenwert überschreiten (`DEFAULT_MAX_BYTES`, 50KB), markiert der Sink die Ausgabe als abgeschnitten.
3. Wenn ein Artefaktpfad verfügbar ist, öffnet der Sink einen Datei-Writer und schreibt:
   - bestehenden gepufferten Inhalt einmalig,
   - alle nachfolgenden Chunks.
4. Der In-Memory-Puffer wird immer auf das Tail-Fenster für die Anzeige getrimmt.
5. `dump()` gibt eine Zusammenfassung einschließlich `artifactId` nur zurück, wenn der Datei-Sink erfolgreich erstellt wurde.

Praktische Auswirkung:

- UI/Tool-Rückgabe zeigt den abgeschnittenen Tail,
- die vollständige Ausgabe wird in der Artefaktdatei gespeichert und als `artifact://<id>` referenziert.

Wenn die Erstellung des Datei-Sinks fehlschlägt (I/O-Fehler, fehlender Pfad usw.), fällt der Sink stillschweigend auf reine In-Memory-Abschneidung zurück; die vollständige Ausgabe wird nicht persistiert.

## URL-Zugriffsmodell

## `blob:`-Referenzen

`blob:sha256:<hash>` ist eine Persistenzreferenz innerhalb von Sitzungseintrag-Nutzdaten, kein internes URL-Schema, das vom Router verarbeitet wird. Die Auflösung erfolgt durch `SessionManager` während des Sitzungsladens.

## `artifact://<id>`

Wird vom `ArtifactProtocolHandler` verarbeitet:

- erfordert ein aktives Sitzungs-Artefakt-Verzeichnis,
- ID muss numerisch sein,
- löst auf durch Abgleich des Dateinamenpräfixes `<id>.`,
- gibt Rohtext (`text/plain`) aus der übereinstimmenden `.log`-Datei zurück,
- bei Fehlen enthält die Fehlermeldung eine Liste verfügbarer Artefakt-IDs.

Verhalten bei fehlendem Verzeichnis:

- wenn das Artefakt-Verzeichnis nicht existiert, wird `No artifacts directory found` geworfen.

## `agent://<id>`

Wird vom `AgentProtocolHandler` über `<artifactsDir>/<id>.md` verarbeitet:

- die einfache Form gibt Markdown-Text zurück,
- `/path` oder `?q=`-Formen führen JSON-Extraktion durch,
- Pfad- und Query-Extraktion können nicht kombiniert werden,
- wenn Extraktion angefordert wird, muss der Dateiinhalt als JSON parsbar sein.

Verhalten bei fehlendem Verzeichnis:

- wirft `No artifacts directory found`.

Verhalten bei fehlender Ausgabe:

- wirft `Not found: <id>` mit verfügbaren IDs aus vorhandenen `.md`-Dateien.

Read-Tool-Integration:

- `read` unterstützt Offset/Limit-Paginierung für Nicht-Extraktions-Lesevorgänge interner URLs,
- lehnt `offset/limit` ab, wenn `agent://`-Extraktion verwendet wird.

## Semantik von Wiederaufnahme, Fork und Verschiebung

## Wiederaufnahme

- `ArtifactManager` durchsucht bestehende `{id}.*.log`-Dateien bei der ersten Allokation und setzt die Nummerierung fort.
- `AgentOutputManager` durchsucht bestehende `.md`-Ausgabe-IDs und setzt die Nummerierung fort.
- `SessionManager` rehydriert Blob-Referenzen zu Base64 beim Laden.

## Fork

`SessionManager.fork()` erstellt eine neue Sitzungsdatei mit neuer Sitzungs-ID und `parentSession`-Verknüpfung und gibt dann alte/neue Dateipfade zurück. Das Kopieren von Artefakten wird von `AgentSession.fork()` übernommen:

- versucht rekursives Kopieren des alten Artefakt-Verzeichnisses in das neue Artefakt-Verzeichnis,
- fehlendes altes Verzeichnis wird toleriert,
- Kopierfehler, die nicht ENOENT sind, werden als Warnungen protokolliert und der Fork wird trotzdem abgeschlossen.

ID-Implikationen nach dem Fork:

- wenn das Kopieren erfolgreich war, setzen die Artefaktzähler in der neuen Sitzung nach der maximalen kopierten ID fort,
- wenn das Kopieren fehlgeschlagen/übersprungen wurde, beginnen die Artefakt-IDs der neuen Sitzung bei `0`.

Blob-Implikationen nach dem Fork:

- Blobs sind global und inhaltsadressiert, daher ist kein Kopieren des Blob-Verzeichnisses erforderlich.

## Verschiebung in ein neues Arbeitsverzeichnis

`SessionManager.moveTo()` benennt sowohl die Sitzungsdatei als auch das Artefakt-Verzeichnis in das neue Standard-Sitzungsverzeichnis um, mit Rollback-Logik, falls ein späterer Schritt fehlschlägt. Dies bewahrt die Artefakt-Identität bei gleichzeitiger Verlagerung des Sitzungsbereichs.

## Fehlerbehandlung und Fallback-Pfade

| Fall | Verhalten |
| --- | --- |
| Blob-Datei fehlt während der Rehydrierung | Warnung und `blob:sha256:`-Referenzstring im Speicher beibehalten |
| Blob-Lese-ENOENT über `BlobStore.get` | Gibt `null` zurück |
| Artefakt-Verzeichnis fehlt (`ArtifactManager.listFiles`) | Gibt leere Liste zurück (Allokation kann neu beginnen) |
| Artefakt-Verzeichnis fehlt (`artifact://` / `agent://`) | Wirft explizit `No artifacts directory found` |
| Artefakt-ID nicht gefunden | Wirft mit Auflistung verfügbarer IDs |
| OutputSink-Artefakt-Writer-Initialisierung fehlgeschlagen | Fährt mit reiner Tail-Abschneidung fort (kein Vollausgabe-Artefakt) |
| Keine Sitzungsdatei (einige Task-Pfade) | Task-Tool fällt auf temporäres Artefakt-Verzeichnis für Subagent-Ausgaben zurück |

## Binäre Blob-Auslagerung vs. Textausgabe-Artefakte

- **Blob-Auslagerung** ist für binäre Bild-Nutzdaten innerhalb persistierter Sitzungseintrags-Inhalte; sie ersetzt Inline-Base64 in JSONL durch stabile Inhaltsreferenzen.
- **Artefakte** sind Klartext-Dateien für Ausführungsausgaben und Subagent-Ausgaben; sie sind über sitzungslokale IDs durch interne URLs adressierbar.

Die beiden Systeme überschneiden sich nur indirekt (beide reduzieren die Aufblähung der Sitzungs-JSONL), haben aber unterschiedliche Identitäts-, Lebensdauer- und Abrufpfade.

## Implementierungsdateien

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — Blob-Referenzformat, Hashing, Put/Get, Auslagerungs-/Auflösungs-Hilfsfunktionen.
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — Sitzungs-Artefakt-Verzeichnismodell und numerische Artefakt-ID-Allokation.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink`-Abschneide-/Auslagerungs-in-Datei-Verhalten und Zusammenfassungsmetadaten.
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — Persistenztransformationen, Blob-Rehydrierung beim Laden, Sitzungs-Fork-/Verschiebeinteraktionen.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — Artefakt-Verzeichniskopie während interaktivem Fork.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — Tool-Artefakt-Manager-Bootstrap und tool-spezifische Artefaktpfad-Allokation.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://`-Resolver.
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — `agent://`-Resolver + JSON-Extraktion.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — Interne-URL-Router-Verdrahtung und Artefakt-Verzeichnis-Resolver.
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — Sitzungsbezogene Agent-Ausgabe-ID-Allokation für `agent://`.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — Subagent-Ausgabe-Artefakt-Schreibvorgänge (`<id>.md`) und temporärer Artefakt-Verzeichnis-Fallback.
