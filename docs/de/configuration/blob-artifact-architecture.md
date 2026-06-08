---
title: Blob- und Artefakt-Speicherarchitektur
description: >-
  Content-adressierbarer Blob-Speicher und Artefakt-Registry für Session-Medien,
  Screenshots und Tool-Ausgaben.
sidebar:
  order: 7
  label: Blob- & Artefaktspeicher
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# Blob- und Artefakt-Speicherarchitektur

Dieses Dokument beschreibt, wie coding-agent große/binäre Nutzdaten außerhalb der Session-JSONL speichert, wie gekürzte Tool-Ausgaben persistiert werden und wie interne URLs (`artifact://`, `agent://`) auf gespeicherte Daten zurückaufgelöst werden.

## Warum zwei Speichersysteme existieren

Die Laufzeitumgebung verwendet zwei unterschiedliche Persistenzmechanismen für verschiedene Datenformen:

- **Content-adressierte Blobs** (`blob:sha256:<hash>`): globaler, binärorientierter Speicher zur Externalisierung großer Image-Base64-Nutzdaten aus persistierten Session-Einträgen.
- **Session-gebundene Artefakte** (Dateien unter `<sessionFile-ohne-.jsonl>/`): sitzungsbezogene Textdateien für vollständige Tool-Ausgaben und Subagent-Ausgaben.

Sie sind bewusst getrennt:

- Blob-Speicher optimiert Deduplizierung und stabile Referenzen durch Content-Hash,
- Artefakt-Speicher optimiert Append-only-Session-Tooling und Abruf durch Menschen/Tools über lokale IDs.

## Speichergrenzen und Verzeichnisstruktur auf der Festplatte

## Blob-Store-Grenze (global)

`SessionManager` erstellt `BlobStore(getBlobsDir())`, sodass Blob-Dateien in einem gemeinsamen globalen Blob-Verzeichnis liegen (nicht in einem Session-Ordner).

Blob-Dateinamensgebung:

- Dateipfad: `<blobsDir>/<sha256-hex>`
- keine Erweiterung
- in Einträgen gespeicherter Referenzstring: `blob:sha256:<sha256-hex>`

Implikationen:

- gleicher binärer Inhalt über Sessions hinweg wird zum selben Hash/Pfad aufgelöst,
- Schreibvorgänge sind auf Inhaltsebene idempotent,
- Blobs können jede einzelne Session-Datei überdauern.

## Artefakt-Grenze (session-lokal)

`ArtifactManager` leitet das Artefaktverzeichnis vom Session-Dateipfad ab:

- Session-Datei: `.../<timestamp>_<sessionId>.jsonl`
- Artefaktverzeichnis: `.../<timestamp>_<sessionId>/` (`.jsonl` entfernt)

Artefakttypen teilen sich dieses Verzeichnis:

- gekürzte Tool-Ausgabedateien: `<numericId>.<toolType>.log` (für `artifact://`)
- Subagent-Ausgabedateien: `<outputId>.md` (für `agent://`)

## ID- und Namenvergabe-Schemata

## Blob-IDs: Content-Hash

`BlobStore.put()` berechnet SHA-256 über die rohen Binärbytes und gibt zurück:

- `hash`: Hex-Digest,
- `path`: `<blobsDir>/<hash>`,
- `ref`: `blob:sha256:<hash>`.

Es wird kein session-lokaler Zähler verwendet.

## Artefakt-IDs: session-lokale monotone Ganzzahl

`ArtifactManager` durchsucht beim ersten Zugriff vorhandene `*.log`-Artefaktdateien, um die maximale vorhandene numerische ID zu finden, und setzt `nextId = max + 1`.

Vergabeverhalten:

- Dateiformat: `{id}.{toolType}.log`
- IDs sind sequenzielle Strings (`"0"`, `"1"`, ...)
- Wiederaufnahme überschreibt keine vorhandenen Artefakte, da der Scan vor der Vergabe stattfindet.

Wenn das Artefaktverzeichnis fehlt, ergibt der Scan eine leere Liste und die Vergabe beginnt bei `0`.

## Agent-Ausgabe-IDs (`agent://`)

`AgentOutputManager` vergibt IDs für Subagent-Ausgaben als `<index>-<requestedId>` (optional verschachtelt unter einem Eltern-Präfix, z.B. `0-Parent.1-Child`). Es durchsucht vorhandene `.md`-Dateien bei der Initialisierung, um bei der Wiederaufnahme beim nächsten Index fortzufahren.

## Persistenz-Datenfluss

## 1) Umschreibepfad bei der Session-Eintrags-Persistierung

Bevor Session-Einträge geschrieben werden (`#rewriteFile` / inkrementelle Persistierung), ruft `SessionManager` `prepareEntryForPersistence()` (über `truncateForPersistence`) auf.

Wichtige Verhaltensweisen:

1. **Kürzung langer Strings**: Übergroße Strings werden abgeschnitten und mit `"[Session persistence truncated large content]"` suffixiert.
2. **Entfernung transienter Felder**: `partialJson` und `jsonlEvents` werden aus persistierten Einträgen entfernt.
3. **Bild-Externalisierung in Blobs**:
   - gilt nur für Bildblöcke in `content`-Arrays,
   - nur wenn `data` nicht bereits eine Blob-Referenz ist,
   - nur wenn die Base64-Länge mindestens den Schwellenwert erreicht (`BLOB_EXTERNALIZE_THRESHOLD = 1024`),
   - ersetzt Inline-Base64 durch `blob:sha256:<hash>`.

Dies hält die Session-JSONL kompakt und bewahrt gleichzeitig die Wiederherstellbarkeit.

## 2) Rehydrierungspfad beim Session-Laden

Beim Öffnen einer Session (`setSessionFile`) führt `SessionManager` nach den Migrationen `resolveBlobRefsInEntries()` aus.

Für jeden Message-/Custom-Message-Bildblock mit `blob:sha256:<hash>`:

- liest Blob-Bytes aus dem Blob-Store,
- konvertiert Bytes zurück in Base64,
- mutiert den In-Memory-Eintrag zu Inline-Base64 für Laufzeit-Konsumenten.

Wenn der Blob fehlt:

- `resolveImageData()` protokolliert eine Warnung,
- gibt den ursprünglichen Referenzstring unverändert zurück,
- das Laden wird fortgesetzt (kein harter Absturz).

## 3) Tool-Ausgabe-Spill-/Kürzungspfad

`OutputSink` steuert die Streaming-Ausgabe in Bash/Python/SSH und verwandten Executoren.

Verhalten:

1. Jeder Chunk wird bereinigt und an den In-Memory-Tail-Buffer angehängt.
2. Wenn die In-Memory-Bytes den Spill-Schwellenwert überschreiten (`DEFAULT_MAX_BYTES`, 50KB), markiert der Sink die Ausgabe als gekürzt.
3. Wenn ein Artefaktpfad verfügbar ist, öffnet der Sink einen File-Writer und schreibt:
   - vorhandenen gepufferten Inhalt einmalig,
   - alle nachfolgenden Chunks.
4. Der In-Memory-Buffer wird immer auf das Tail-Fenster für die Anzeige getrimmt.
5. `dump()` gibt eine Zusammenfassung einschließlich `artifactId` nur zurück, wenn der File-Sink erfolgreich erstellt wurde.

Praktischer Effekt:

- UI/Tool-Rückgabe zeigt den gekürzten Tail,
- die vollständige Ausgabe wird in der Artefaktdatei gespeichert und als `artifact://<id>` referenziert.

Wenn die Erstellung des File-Sinks fehlschlägt (I/O-Fehler, fehlender Pfad, etc.), fällt der Sink stillschweigend auf reine In-Memory-Kürzung zurück; die vollständige Ausgabe wird nicht persistiert.

## URL-Zugriffsmodell

## `blob:`-Referenzen

`blob:sha256:<hash>` ist eine Persistenz-Referenz innerhalb von Session-Eintrags-Nutzdaten, kein internes URL-Schema, das vom Router verarbeitet wird. Die Auflösung erfolgt durch `SessionManager` während des Session-Ladens.

## `artifact://<id>`

Verarbeitet durch `ArtifactProtocolHandler`:

- erfordert ein aktives Session-Artefaktverzeichnis,
- ID muss numerisch sein,
- Auflösung durch Matching des Dateinamenpräfixes `<id>.`,
- gibt Rohtext (`text/plain`) aus der passenden `.log`-Datei zurück,
- bei fehlendem Eintrag enthält der Fehler eine Liste verfügbarer Artefakt-IDs.

Verhalten bei fehlendem Verzeichnis:

- wenn das Artefaktverzeichnis nicht existiert, wird `No artifacts directory found` geworfen.

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

## Wiederaufnahme-, Fork- und Verschiebe-Semantik

## Wiederaufnahme

- `ArtifactManager` durchsucht vorhandene `{id}.*.log`-Dateien bei der ersten Vergabe und setzt die Nummerierung fort.
- `AgentOutputManager` durchsucht vorhandene `.md`-Ausgabe-IDs und setzt die Nummerierung fort.
- `SessionManager` rehydriert Blob-Referenzen zu Base64 beim Laden.

## Fork

`SessionManager.fork()` erstellt eine neue Session-Datei mit neuer Session-ID und `parentSession`-Verknüpfung und gibt dann alte/neue Dateipfade zurück. Das Kopieren der Artefakte wird von `AgentSession.fork()` übernommen:

- versucht rekursives Kopieren des alten Artefaktverzeichnisses in das neue Artefaktverzeichnis,
- fehlendes altes Verzeichnis wird toleriert,
- Nicht-ENOENT-Kopierfehler werden als Warnungen protokolliert und der Fork wird dennoch abgeschlossen.

ID-Implikationen nach dem Fork:

- wenn das Kopieren erfolgreich war, setzen die Artefaktzähler in der neuen Session nach der maximalen kopierten ID fort,
- wenn das Kopieren fehlgeschlagen/übersprungen wurde, beginnen die Artefakt-IDs der neuen Session bei `0`.

Blob-Implikationen nach dem Fork:

- Blobs sind global und content-adressiert, daher ist kein Kopieren des Blob-Verzeichnisses erforderlich.

## Verschieben in ein neues cwd

`SessionManager.moveTo()` benennt sowohl die Session-Datei als auch das Artefaktverzeichnis in das neue Standard-Session-Verzeichnis um, mit Rollback-Logik falls ein späterer Schritt fehlschlägt. Dies bewahrt die Artefakt-Identität bei gleichzeitiger Verlagerung des Session-Scopes.

## Fehlerbehandlung und Fallback-Pfade

| Fall | Verhalten |
| --- | --- |
| Blob-Datei fehlt bei Rehydrierung | Warnung und Beibehaltung des `blob:sha256:`-Referenzstrings im Speicher |
| Blob-Lese-ENOENT über `BlobStore.get` | Gibt `null` zurück |
| Artefaktverzeichnis fehlt (`ArtifactManager.listFiles`) | Gibt leere Liste zurück (Vergabe kann neu beginnen) |
| Artefaktverzeichnis fehlt (`artifact://` / `agent://`) | Wirft explizit `No artifacts directory found` |
| Artefakt-ID nicht gefunden | Wirft Fehler mit Auflistung verfügbarer IDs |
| OutputSink-Artefakt-Writer-Initialisierung schlägt fehl | Fährt mit Tail-only-Kürzung fort (kein Vollausgabe-Artefakt) |
| Keine Session-Datei (einige Task-Pfade) | Task-Tool fällt auf temporäres Artefaktverzeichnis für Subagent-Ausgaben zurück |

## Binäre Blob-Externalisierung vs. Text-Ausgabe-Artefakte

- **Blob-Externalisierung** ist für binäre Bild-Nutzdaten innerhalb persistierter Session-Eintrags-Inhalte; sie ersetzt Inline-Base64 in JSONL durch stabile Content-Referenzen.
- **Artefakte** sind Klartextdateien für Ausführungsausgaben und Subagent-Ausgaben; sie sind über session-lokale IDs durch interne URLs adressierbar.

Die beiden Systeme überschneiden sich nur indirekt (beide reduzieren die Session-JSONL-Aufblähung), haben aber unterschiedliche Identitäts-, Lebensdauer- und Abrufpfade.

## Implementierungsdateien

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — Blob-Referenzformat, Hashing, Put/Get, Externalisierungs-/Auflösungs-Hilfsfunktionen.
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — Session-Artefaktverzeichnismodell und numerische Artefakt-ID-Vergabe.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — `OutputSink`-Kürzungs-/Spill-to-File-Verhalten und Zusammenfassungs-Metadaten.
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — Persistenz-Transformationen, Blob-Rehydrierung beim Laden, Session-Fork-/Verschiebe-Interaktionen.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — Artefaktverzeichnis-Kopie beim interaktiven Fork.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — Tool-Artefakt-Manager-Bootstrap und pro-Tool-Artefaktpfad-Vergabe.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — `artifact://`-Resolver.
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — `agent://`-Resolver + JSON-Extraktion.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — Internes URL-Router-Wiring und Artefaktverzeichnis-Resolver.
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — Session-gebundene Agent-Ausgabe-ID-Vergabe für `agent://`.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — Subagent-Ausgabe-Artefakt-Schreibvorgänge (`<id>.md`) und temporärer Artefaktverzeichnis-Fallback.
