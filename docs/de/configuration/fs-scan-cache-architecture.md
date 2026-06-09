---
title: Dateisystem-Scan-Cache-Architektur
description: >-
  Dateisystem-Scan-Cache-Vertrag für schnelle Dateierkennung mit
  Stale-While-Revalidate-Semantik.
sidebar:
  order: 8
  label: Dateisystem-Scan-Cache
i18n:
  sourceHash: 2a2bde1726ac
  translator: machine
---

# Architekturvertrag für den Dateisystem-Scan-Cache

Dieses Dokument definiert den aktuellen Vertrag für den gemeinsam genutzten Dateisystem-Scan-Cache, der in Rust implementiert ist (`crates/pi-natives/src/fs_cache.rs`) und von nativen Discovery-/Such-APIs verwendet wird, die für `packages/coding-agent` bereitgestellt werden.

## Was dieser Cache ist

Der Cache speichert vollständige Verzeichnis-Scan-Eintragslisten (`GlobMatch[]`), die nach Scan-Bereich und Traversierungsrichtlinie indiziert sind, und ermöglicht es übergeordneten Operationen (Glob-Filterung, Fuzzy-Bewertung, Grep-Dateiauswahl), gegen diese gecachten Einträge zu arbeiten.

Primäre Ziele:

- wiederholte Dateisystem-Durchläufe bei wiederholten Discovery-/Suchaufrufen vermeiden
- Konsistenz über `glob`, `fuzzyFind` und `grep` hinweg sicherstellen, wenn sie dieselbe Scan-Richtlinie teilen
- explizite Wiederherstellung bei Veralterung für leere Ergebnisse und explizite Invalidierung nach Dateimutationen ermöglichen

## Eigentümerschaft und öffentliche Schnittstelle

- Cache-Implementierung und Richtlinie: `crates/pi-natives/src/fs_cache.rs`
- Native Konsumenten:
  - `crates/pi-natives/src/glob.rs`
  - `crates/pi-natives/src/fd.rs` (`fuzzyFind`)
  - `crates/pi-natives/src/grep.rs`
- JS-Binding/Export:
  - `packages/natives/src/glob/index.ts` (`invalidateFsScanCache`)
  - `packages/natives/src/glob/types.ts`
  - `packages/natives/src/grep/types.ts`
- Coding-Agent-Mutations-Invalidierungshelfer:
  - `packages/coding-agent/src/tools/fs-cache-invalidation.ts`

## Cache-Schlüssel-Partitionierung (fester Vertrag)

Jeder Eintrag wird indiziert durch:

- kanonisierten `root`-Verzeichnispfad
- `include_hidden` Boolean
- `use_gitignore` Boolean

Implikationen:

- Scans mit und ohne versteckte Dateien teilen sich **keine** Einträge.
- Scans mit Gitignore-Beachtung und mit deaktiviertem Ignore teilen sich **keine** Einträge.
- Konsumenten müssen stabile Semantik für Hidden-/Gitignore-Verhalten übergeben; das Ändern eines der Flags erzeugt eine andere Cache-Partition.

Die `node_modules`-Einbeziehung ist **nicht** im Cache-Schlüssel enthalten. Der Cache speichert Einträge mit `node_modules` eingeschlossen; konsumentenspezifische Filterung wird nach dem Abruf angewendet.

## Scan-Sammlungsverhalten

Die Cache-Befüllung verwendet einen deterministischen Walker (`ignore::WalkBuilder`), konfiguriert durch `include_hidden` und `use_gitignore`:

- `follow_links(false)`
- sortiert nach Dateipfad
- `.git` wird immer übersprungen
- `node_modules` wird immer zum Zeitpunkt des Cache-Scans erfasst (und optional später gefiltert)
- Eintrags-Dateityp + `mtime` werden über `symlink_metadata` erfasst

Suchwurzeln werden durch `resolve_search_path` aufgelöst:

- relative Pfade werden gegen das aktuelle cwd aufgelöst
- das Ziel muss ein existierendes Verzeichnis sein
- die Wurzel wird wenn möglich kanonisiert

## Frische- und Eviktionsrichtlinie

Globale Richtlinie (über Umgebungsvariablen überschreibbar):

- `FS_SCAN_CACHE_TTL_MS` (Standard `1000`)
- `FS_SCAN_EMPTY_RECHECK_MS` (Standard `200`)
- `FS_SCAN_CACHE_MAX_ENTRIES` (Standard `16`)

Verhalten:

- `get_or_scan(...)`
  - wenn TTL `0` ist: Cache vollständig umgehen, immer frischer Scan (`cache_age_ms = 0`)
  - bei Cache-Treffer innerhalb der TTL: gecachte Einträge zurückgeben + `cache_age_ms` ungleich Null
  - bei abgelaufenem Treffer: Schlüssel eviktieren, neu scannen, frischen Eintrag speichern
- Durchsetzung maximaler Einträge erfolgt durch Eviction der ältesten nach `created_at`

## Schnelle Neuprüfung bei leeren Ergebnissen (getrennt von normalen Treffern)

Normaler Cache-Treffer:

- ein Cache-Treffer innerhalb der TTL gibt gecachte Einträge zurück und tut nichts weiter.

Schnelle Neuprüfung bei leeren Ergebnissen:

- dies ist eine **aufruferseitige** Richtlinie unter Verwendung von `ScanResult.cache_age_ms`
- wenn das gefilterte/abgefragte Ergebnis leer ist und das Alter des gecachten Scans mindestens `empty_recheck_ms()` beträgt, führt der Aufrufer einen `force_rescan(...)` durch und versucht es erneut
- beabsichtigt, um falsch-negative Ergebnisse durch Veralterung zu reduzieren, wenn Dateien kürzlich hinzugefügt wurden, der Cache aber noch innerhalb der TTL liegt

Aktuelle Konsumenten:

- `glob`: prüft erneut, wenn gefilterte Treffer leer sind und das Scan-Alter den Schwellenwert überschreitet
- `fuzzyFind` (`fd.rs`): prüft nur erneut, wenn die Abfrage nicht leer ist und bewertete Treffer leer sind
- `grep`: prüft erneut, wenn die ausgewählte Kandidaten-Dateiliste leer ist

## Konsumenten-Standardwerte und Cache-Nutzung

Der Cache ist bei allen bereitgestellten APIs opt-in (`cache?: boolean`, Standard `false`).

Aktuelle Standardwerte in nativen APIs:

- `glob`: `hidden=false`, `gitignore=true`, `cache=false`
- `fuzzyFind`: `hidden=false`, `gitignore=true`, `cache=false`
- `grep`: `hidden=true`, `cache=false`, und der Cache-Scan verwendet immer `use_gitignore=true`

Coding-Agent-Aufrufer heute:

- Hochvolumige Mention-Kandidaten-Erkennung aktiviert den Cache:
  - `packages/coding-agent/src/utils/file-mentions.ts`
  - Profil: `hidden=true`, `gitignore=true`, `includeNodeModules=true`, `cache=true`
- Tool-Level-`grep`-Integration deaktiviert derzeit den Scan-Cache (`cache: false`):
  - `packages/coding-agent/src/tools/grep.ts`

## Invalidierungsvertrag

Nativer Invalidierungs-Einstiegspunkt:

- `invalidateFsScanCache(path?: string)`
  - mit `path`: Cache-Einträge entfernen, deren Wurzel ein Präfix des Zielpfads ist
  - ohne Pfad: alle Scan-Cache-Einträge löschen

Details zur Pfadbehandlung:

- relative Invalidierungspfade werden gegen cwd aufgelöst
- die Invalidierung versucht eine Kanonisierung
- wenn das Ziel nicht existiert (z.B. nach Löschung), wird als Fallback das übergeordnete Verzeichnis kanonisiert und der Dateiname wenn möglich wieder angehängt
- dies bewahrt das Invalidierungsverhalten für Erstellen/Löschen/Umbenennen, bei denen eine Seite möglicherweise nicht existiert

## Coding-Agent-Mutations-Ablaufverantwortlichkeiten

Coding-Agent-Code muss nach erfolgreichen Dateisystem-Mutationen invalidieren.

Zentrale Helfer:

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)` (invalidiert beide Seiten, wenn sich die Pfade unterscheiden)

Aktuelle Mutations-Tool-Aufrufstellen:

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts` (Hashline-/Patch-/Replace-Abläufe)

Regel: Wenn ein Ablauf Dateisysteminhalte oder -standorte verändert und diese Helfer umgeht, sind Cache-Veralterungsfehler zu erwarten.

## Sicheres Hinzufügen eines neuen Cache-Konsumenten

Beim Einführen der Cache-Nutzung in einem neuen Scanner-/Suchpfad:

1. **Stabile Scan-Richtlinien-Eingaben verwenden**
   - zuerst Hidden-/Gitignore-Semantik festlegen
   - diese konsistent an `get_or_scan`/`force_rescan` übergeben, damit Cache-Partitionen beabsichtigt sind

2. **Cache-Daten als nur nach Traversierungsrichtlinie vorgefiltert behandeln**
   - toolspezifische Filterung (Glob-Muster, Typfilter, node_modules-Regeln) nach dem Abruf anwenden
   - niemals annehmen, dass gecachte Einträge bereits Ihre übergeordneten Filter widerspiegeln

3. **Schnelle Neuprüfung bei leeren Ergebnissen nur bei Risiko falsch-negativer Veralterung implementieren**
   - `scan.cache_age_ms >= empty_recheck_ms()` verwenden
   - einmal mit `force_rescan(..., store=true, ...)` erneut versuchen
   - diesen Pfad getrennt von der normalen Cache-Treffer-Logik halten

4. **No-Cache-Modus explizit beachten**
   - wenn der Aufrufer den Cache deaktiviert, `force_rescan(..., store=false, ...)` aufrufen
   - den gemeinsamen Cache in einem No-Cache-Anfragepfad nicht befüllen

5. **Mutations-Invalidierung für jeden neuen Schreibpfad verdrahten**
   - nach erfolgreichem Schreiben/Bearbeiten/Löschen/Umbenennen den Coding-Agent-Invalidierungshelfer aufrufen
   - bei Umbenennung/Verschiebung sowohl alte als auch neue Pfade invalidieren

6. **Keine Pro-Aufruf-TTL-Einstellungen hinzufügen**
   - der aktuelle Vertrag sieht nur eine globale Richtlinie vor (über Umgebungsvariablen konfiguriert), keine TTL-Überschreibung pro Anfrage

## Bekannte Grenzen

- Der Cache-Bereich ist prozesslokal im Speicher (`DashMap`), wird nicht über Prozessneustarts hinweg persistiert.
- Der Cache speichert Scan-Einträge, nicht finale Tool-Ergebnisse.
- `glob`/`fuzzyFind`/`grep` teilen Scan-Einträge nur, wenn die Schlüsseldimensionen (`root`, `hidden`, `gitignore`) übereinstimmen.
- `.git` wird immer zum Zeitpunkt der Scan-Sammlung ausgeschlossen, unabhängig von Aufruferoptionen.
