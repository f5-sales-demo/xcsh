---
title: Blob- und Artefakt-Speicherarchitektur
description: >-
  Inhaltsadressierbarer Blob-Speicher und Artefakt-Registry für Sitzungsmedien,
  Screenshots und Tool-Ausgaben.
sidebar:
  order: 7
  label: Blob- & Artefakt-Speicher
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# Blob- und Artefakt-Speicherarchitektur

Dieses Dokument beschreibt, wie coding-agent große/binäre Nutzdaten außerhalb der Sitzungs-JSONL speichert, wie gekürzte Tool-Ausgaben persistiert werden und wie interne URLs (`artifact://`, `agent://`) auf gespeicherte Daten aufgelöst werden.

## Warum zwei Speichersysteme existieren

Die Laufzeitumgebung verwendet zwei unterschiedliche Persistenzmechanismen für verschiedene Datenformen:

- **Inhaltsadressierte Blobs** (`blob:sha256:<hash>`): globaler, binärorientierter Speicher, der verwendet wird, um große Image-Base64-Nutzdaten aus persistierten Sitzungseinträgen auszulagern.
- **Sitzungsbezogene Artefakte** (Dateien unter `<sessionFile-without-.jsonl>/`): sitzungsspezifische Textdateien für vollständige Tool-Ausgaben und Subagent-Ausgaben.

Sie sind bewusst getrennt:

- Blob-Speicher optimiert Deduplizierung und stabile Referenzen durch Inhalts-Hash,
- Artefakt-Speicher optimiert Append-only-Sitzungs-Tooling und Mensch/Tool-Abruf über lokale IDs.

## Speichergrenzen und Festplatten-Layout

## Blob-Speichergrenze (global)

`SessionManager` konstruiert `BlobStore(getBlobsDir())`, sodass Blob-Dateien in einem gemeinsamen globalen Blob-Verzeichnis liegen (nicht in einem Sitzungsordner).

Blob-Dateibenennnung:

- Dateipfad: `<blobsDir>/<sha256-hex>`
- keine Erweiterung
- Referenzstring in Einträgen gespeichert: `blob:sha256:<sha256-hex>`

Implikationen:

- gleicher binärer Inhalt über Sitzungen hinweg wird zum gleichen Hash/Pfad aufgelöst,
- Schreibvorgänge sind auf Inhaltsebene idempotent,
- Blobs können jede einzelne Sitzungsdatei überdauern.

## Artefakt-Grenze (sitzungslokal)

`ArtifactManager` leitet das Artefakt-Verzeichnis vom Sitzungsdateipfad ab:

- Sitzungsdatei: `.../<timestamp>_<sessionId>.jsonl`
- Artefakt-Verzeichnis: `.../<timestamp>_<sessionId>/` (`.jsonl` entfernen)

Artefakttypen teilen sich dieses Verzeichnis:

- Gekürzte Tool-Ausgabedateien: `<numericId>.<toolType>.log` (für `artifact://`)
- Subagent-Ausgabedateien: `<outputId>.md` (für `agent://`)

## ID- und Namens-Zuweisungsschemata

## Blob-IDs: Inhalts-Hash

`BlobStore.put()` berechnet SHA-256 über die rohen Binärbytes und gibt zurück:

- `hash`: Hex-Digest,
- `path`: `<blobsDir>/<hash>`,
- `ref`: `blob:sha256:<hash>`.

Es wird kein sitzungslokaler Zähler verwendet.

## Artefakt-IDs: sitzungslokal monoton ansteigender Integer

`ArtifactManager` durchsucht bei erster Verwendung vorhandene `*.log`-Artefaktdateien, um die maximale vorhandene numerische ID zu finden, und setzt `nextId = max + 1`.

Zuweisungsverhalten:

- Dateiformat: `{id}.{toolType}.log`
- IDs sind sequentielle Strings (`"0"`, `"1"`, ...)
- Wiederaufnahme überschreibt keine vorhandenen Artefakte, da der Scan vor der Zuweisung erfolgt.

Wenn das Artefakt-Verzeichnis fehlt, liefert der Scan eine leere Liste und die Zuweisung beginnt bei `0`.

## Agent-Ausgabe-IDs (`agent://`)

`AgentOutputManager` weist IDs für Subagent-Ausgaben als `<index>-<requestedId>` zu (optional unter einem Eltern-Präfix verschachtelt, z.B. `0-Parent.1-Child`). Es durchsucht vorhandene `.md`-Dateien bei der Initialisierung, um bei Wiederaufnahme beim nächsten Index fortzufahren.

## Persistenz-Datenfluss

## 1) Umschreibungspfad bei der Persistierung von Sitzungseinträgen

Bevor Sitzungseinträge geschrieben werden (`#rewriteFile` / inkrementelle Persistierung), ruft `SessionManager` `prepareEntryForPersistence()` (über `truncateForPersistence`) auf.

Wichtige Verhaltensweisen:

1. **Kürzung großer Strings**: Übergroße Strings werden abgeschnitten und mit `"[Session persistence truncated large content]"` suffigiert.
2. **Entfernung transienter Felder**: `partialJson` und `jsonlEvents` werden aus persistierten Einträgen entfernt.
3. **Bild-Externalisierung in Blobs**:
   - gilt nur für Bildblöcke in `content`-Arrays,
   - nur wenn `data` nicht bereits eine Blob-Referenz ist,
   - nur wenn die Base64-Länge mindestens den Schwellenwert erreicht (`BLOB_EXTERNALIZE_THRESHOLD = 1024`),
   - ersetzt Inline-Base64 durch `blob:sha256:<hash>`.

Dies hält die Sitzungs-JSONL kompakt und bewahrt gleichzeitig die Wiederherstellbarkeit.

## 2) Rehydrierungspfad beim Laden der Sitzung

Beim Öffnen einer Sitzung (`setSessionFile`), nach Migrationen, führt `SessionManager` `resolveBlobRefsInEntries()` aus.

Für jeden Nachrichten-/Custom-Message-Bildblock mit `blob:sha256:<hash>`:

- liest Blob-Bytes aus dem Blob-Speicher,
- konvertiert Bytes zurück in Base64,
- mutiert den In-Memory-Eintrag zu Inline-Base64 für Laufzeitkonsumenten.

Wenn der Blob fehlt:

- `resolveImageData()` protokolliert eine Warnung,
- gibt den Original-Referenzstring unverändert zurück,
- das Laden wird fortgesetzt (kein harter Absturz).

## 3) Tool-Ausgabe-Spill-/Kürzungspfad

`OutputSink` ermöglicht Streaming-Ausgabe in bash/python/ssh und verwandten Executors.

Verhalten:

1. Jeder Chunk wird bereinigt und an den In-Memory-Tail-Puffer angehängt.
2. Wenn die In-Memory-Bytes den Spill-Schwellenwert überschreiten (`DEFAULT_MAX_BYTES`, 50KB), markiert der Sink die Ausgabe als gekürzt.
3. Wenn ein Artefaktpfad verfügbar ist, öffnet der Sink einen Datei-Writer und schreibt:
   - vorhandenen gepufferten Inhalt einmalig,
   - alle nachfolgenden Chunks.
4. Der In-Memory-Puffer wird für die Anzeige immer auf das Tail-Fenster gekürzt.
5. `dump()` gibt eine Zusammenfassung einschließlich `artifactId` nur zurück, wenn der Datei-Sink erfolgreich erstellt wurde.

Praktische Auswirkung:

- UI/Tool-Rückgabe zeigt den gekürzten Tail,
- die vollständige Ausgabe wird in der Artefaktdatei gespeichert und als `artifact://<id>` referenziert.

Wenn die Erstellung des Datei-Sinks fehlschlägt (I/O-Fehler, fehlender Pfad etc.), fällt der Sink stillschweigend auf reine In-Memory-Kürzung zurück; die vollständige Ausgabe wird nicht persistiert.

## URL-Zugriffsmodell

## `blob:`-Referenzen

`blob:sha256:<hash>` ist eine Persistenz-Referenz innerhalb von Sitzungseintrags-Nutzdaten, kein internes URL-Schema, das vom Router verarbeitet wird. Die Auflösung erfolgt durch `SessionManager` beim Laden der Sitzung.

## `artifact://<id>`

Verarbeitet durch `ArtifactProtocolHandler`:

- erfordert ein aktives Sitzungs-Artefaktverzeichnis,
- ID muss numerisch sein,
- Auflösung durch Abgleich des Dateinamen-Präfixes `<id>.`,
- gibt Rohtext (`text/plain`) aus der übereinstimmenden `.log`-Datei zurück,
- bei Fehlen enthält die Fehlermeldung eine Liste verfügbarer Artefakt-IDs.

Verhalten bei fehlendem Verzeichnis:

- wenn das Artefakt-Verzeichnis nicht existiert, wird `No artifacts directory found` geworfen.

## `agent://<id>`

Verarbeitet durch `AgentProtocolHandler` über `<artifactsDir>/<id>.md`:

- einfache Form gibt Markdown-Text zurück,
- `/path`- oder `?q=`-Formen führen JSON-Extraktion durch,
- Pfad- und Query-Extraktion können nicht kombiniert werden,
- wenn Extraktion angefordert wird, muss der Dateiinhalt als JSON parsebar sein.

Verhalten bei fehlendem Verzeichnis:

- wirft `No artifacts directory found`.

Verhalten bei fehlender Ausgabe:

- wirft `Not found: <id>` mit verfügbaren IDs aus vorhandenen `.md`-Dateien.

Read-Tool-Integration:

- `read` unterstützt Offset/Limit-Paginierung für Nicht-Extraktions-Lesevorgänge interner URLs,
- lehnt `offset/limit` ab, wenn `agent://`-Extraktion verwendet wird.

## Semantik bei Wiederaufnahme, Fork und Verschiebung

## Wiederaufnahme

- `ArtifactManager` durchsucht vorhandene `{id}.*.log`-Dateien bei der ersten Zuweisung und setzt die Nummerierung fort.
- `AgentOutputManager` durchsucht vorhandene `.md`-Ausgabe-IDs und setzt die Nummerierung fort.
- `SessionManager` rehydriert Blob-Referenzen zu Base64 beim Laden.

## Fork

`SessionManager.fork()` erstellt eine neue Sitzungsdatei mit neuer Sitzungs-ID und `parentSession`-Verknüpfung und gibt dann alte/neue Dateipfade zurück. Das Kopieren der Artefakte wird durch `AgentSession.fork()` gehandhabt:

- versucht rekursives Kopieren des alten Artefakt-Verzeichnisses in das neue Artefakt-Verzeichnis,
- fehlendes altes Verzeichnis wird toleriert,
- Kopierfehler außer ENOENT werden als Warnungen protokolliert und der Fork wird dennoch abgeschlossen.

ID-Implikationen nach dem Fork:

- wenn das Kopieren erfolgreich war, setzen die Artefakt-Zähler in der neuen Sitzung nach der maximalen kopierten ID fort,
- wenn das Kopieren fehlschlug/übersprungen wurde, beginnen die Artefakt-IDs der neuen Sitzung bei `0`.

Blob-Implikationen nach dem Fork:

- Blobs sind global und inhaltsadressiert, daher ist kein Kopieren des Blob-Verzeichnisses erforderlich.

## Verschiebung in neues cwd

`SessionManager.moveTo()` benennt sowohl die Sitzungsdatei als auch das Artefakt-Verzeichnis in das neue Standard-Sitzungsverzeichnis um, mit Rollback-Logik falls ein späterer Schritt fehlschlägt. Dies bewahrt die Artefakt-Identität bei gleichzeitiger Verlagerung des Sitzungsbereichs.

## Fehlerbehandlung und Fallback-Pfade

| Fall | Verhalten |
| --- | --- |
| Blob-Datei fehlt bei Rehydrierung | Warnung und `blob:sha256:`-Referenzstring im Speicher beibehalten |
| Blob-Lese-ENOENT über `BlobStore.get` | Gibt `null` zurück |
| Artefakt-Verzeichnis fehlt (`ArtifactManager.listFiles`) | Gibt leere Liste zurück (Zuweisung kann neu beginnen) |
| Artefakt-Verzeichnis fehlt (`artifact://` / `agent://`) | Wirft explizit `No artifacts directory found` |
| Artefakt-ID nicht gefunden | Wirft mit Auflistung verfügbarer IDs |
| OutputSink-Artefakt-Writer-Initialisierung schlägt fehl | Fährt mit reiner Tail-Kürzung fort (kein Vollausgabe-Artefakt) |
| Keine Sitzungsdatei (einige Task-Pfade) | Task-Tool fällt auf temporäres Artefakt-Verzeichnis für Subagent-Ausgaben zurück |

## Binäre Blob-Externalisierung vs. Text-Ausgabe-Artefakte

- **Blob-Externalisierung** ist für binäre Bild-Nutzdaten innerhalb persistierter Sitzungseintrags-Inhalte; sie ersetzt Inline-Base64 in JSONL durch stabile Inhaltsreferenzen.
- **Artefakte** sind Klartextdateien für Ausführungsausgaben und Subagent-Ausgaben; sie sind über sitzungslokale IDs durch interne URLs adressierbar.

Die beiden Systeme überschneiden sich nur indirekt (beide reduzieren die Aufblähung der Sitzungs-JSONL), haben aber unterschiedliche Identitäts-, Lebensdauer- und Abrufpfade.

## Implementierungsdateien

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — Blob-Referenzformat, Hashing, Put/Get, Externalisierungs-/Auflösungshelfer.
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — Sitzungs-Artefaktverzeichnis-Modell und numerische Artefakt-ID-Zuweisung.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink`-Kürzungs-/Spill-to-File-Verhalten und Zusammenfassungs-Metadaten.
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — Persistenz-Transformationen, Blob-Rehydrierung beim Laden, Sitzungs-Fork-/Verschiebungsinteraktionen.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — Artefaktverzeichnis-Kopie während interaktivem Fork.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — Tool-Artefakt-Manager-Bootstrap und Pro-Tool-Artefaktpfad-Zuweisung.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://`-Resolver.
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — `agent://`-Resolver + JSON-Extraktion.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — Interne URL-Router-Verdrahtung und Artefakt-Verzeichnis-Resolver.
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — Sitzungsbezogene Agent-Ausgabe-ID-Zuweisung für `agent://`.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — Subagent-Ausgabe-Artefakt-Schreibvorgänge (`<id>.md`) und temporärer Artefaktverzeichnis-Fallback.
