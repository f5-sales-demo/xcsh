---
title: Architektur des Dateisystem-Scan-Caches
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

# Architekturvertrag des Dateisystem-Scan-Caches

Dieses Dokument definiert den aktuellen Vertrag für den gemeinsam genutzten Dateisystem-Scan-Cache, der in Rust implementiert ist (`crates/pi-natives/src/fs_cache.rs`) und von nativen Discovery-/Such-APIs verwendet wird, die für `packages/coding-agent` bereitgestellt werden.

## Was dieser Cache ist

Der Cache speichert vollständige Verzeichnis-Scan-Eintraglisten (`GlobMatch[]`), die nach Scan-Bereich und Traversierungsrichtlinie geschlüsselt sind, und ermöglicht es übergeordneten Operationen (Glob-Filterung, Fuzzy-Bewertung, Grep-Dateiauswahl), gegen diese gecachten Einträge zu arbeiten.

Primäre Ziele:

- Wiederholte Dateisystem-Durchläufe bei wiederholten Discovery-/Suchaufrufen vermeiden
- Konsistenz über `glob`, `fuzzyFind` und `grep` hinweg sicherstellen, wenn sie dieselbe Scan-Richtlinie teilen
- Explizite Veraltungs-Wiederherstellung für leere Ergebnisse und explizite Invalidierung nach Dateimutationen ermöglichen

## Eigentümerschaft und öffentliche Schnittstelle

- Cache-Implementierung und -Richtlinie: `crates/pi-natives/src/fs_cache.rs`
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

## Cache-Schlüssel-Partitionierung (verbindlicher Vertrag)

Jeder Eintrag wird geschlüsselt durch:

- kanonisierten `root`-Verzeichnispfad
- `include_hidden` Boolean
- `use_gitignore` Boolean

Implikationen:

- Scans mit und ohne versteckte Dateien teilen sich **keine** Einträge.
- Scans mit und ohne Gitignore-Beachtung teilen sich **keine** Einträge.
- Konsumenten müssen stabile Semantik für Hidden-/Gitignore-Verhalten übergeben; das Ändern eines der Flags erzeugt eine andere Cache-Partition.

Die `node_modules`-Einbeziehung ist **nicht** im Cache-Schlüssel enthalten. Der Cache speichert Einträge mit `node_modules` eingeschlossen; konsumentenspezifische Filterung wird nach dem Abruf angewendet.

## Scan-Sammlungsverhalten

Die Cache-Befüllung verwendet einen deterministischen Walker (`ignore::WalkBuilder`), konfiguriert durch `include_hidden` und `use_gitignore`:

- `follow_links(false)`
- sortiert nach Dateipfad
- `.git` wird immer übersprungen
- `node_modules` wird beim Cache-Scan immer gesammelt (und optional später gefiltert)
- Datei-Typ + `mtime` des Eintrags werden über `symlink_metadata` erfasst

Suchwurzeln werden durch `resolve_search_path` aufgelöst:

- Relative Pfade werden gegen das aktuelle cwd aufgelöst
- Das Ziel muss ein existierendes Verzeichnis sein
- Die Wurzel wird wenn möglich kanonisiert

## Aktualitäts- und Eviktionsrichtlinie

Globale Richtlinie (über Umgebungsvariablen überschreibbar):

- `FS_SCAN_CACHE_TTL_MS` (Standard `1000`)
- `FS_SCAN_EMPTY_RECHECK_MS` (Standard `200`)
- `FS_SCAN_CACHE_MAX_ENTRIES` (Standard `16`)

Verhalten:

- `get_or_scan(...)`
  - wenn TTL `0` ist: Cache vollständig umgehen, immer frischer Scan (`cache_age_ms = 0`)
  - bei Cache-Treffer innerhalb der TTL: gecachte Einträge + `cache_age_ms` ungleich null zurückgeben
  - bei abgelaufenem Treffer: Schlüssel eviktieren, neu scannen, frischen Eintrag speichern
- Max-Einträge-Durchsetzung erfolgt durch Älteste-zuerst-Evikion nach `created_at`

## Schnelle Neuprüfung bei leeren Ergebnissen (getrennt von normalen Treffern)

Normaler Cache-Treffer:

- Ein Cache-Treffer innerhalb der TTL gibt gecachte Einträge zurück und tut nichts weiter.

Schnelle Neuprüfung bei leeren Ergebnissen:

- Dies ist eine **aufruferseitige** Richtlinie unter Verwendung von `ScanResult.cache_age_ms`
- Wenn das gefilterte/abgefragte Ergebnis leer ist und das Alter des gecachten Scans mindestens `empty_recheck_ms()` beträgt, führt der Aufrufer einen `force_rescan(...)` durch und versucht es erneut
- Beabsichtigt, um veraltete Negativ-Ergebnisse zu reduzieren, wenn Dateien kürzlich hinzugefügt wurden, der Cache aber noch innerhalb der TTL liegt

Aktuelle Konsumenten:

- `glob`: Prüft erneut, wenn gefilterte Treffer leer sind und das Scan-Alter den Schwellenwert überschreitet
- `fuzzyFind` (`fd.rs`): Prüft nur erneut, wenn die Abfrage nicht leer ist und bewertete Treffer leer sind
- `grep`: Prüft erneut, wenn die ausgewählte Kandidaten-Dateiliste leer ist

## Konsumenten-Standardwerte und Cache-Nutzung

Der Cache ist bei allen exponierten APIs opt-in (`cache?: boolean`, Standard `false`).

Aktuelle Standardwerte in nativen APIs:

- `glob`: `hidden=false`, `gitignore=true`, `cache=false`
- `fuzzyFind`: `hidden=false`, `gitignore=true`, `cache=false`
- `grep`: `hidden=true`, `cache=false`, und der Cache-Scan verwendet immer `use_gitignore=true`

Coding-Agent-Aufrufer heute:

- Hochvolumige Mention-Kandidaten-Erkennung aktiviert den Cache:
  - `packages/coding-agent/src/utils/file-mentions.ts`
  - Profil: `hidden=true`, `gitignore=true`, `includeNodeModules=true`, `cache=true`
- `grep`-Integration auf Tool-Ebene deaktiviert derzeit den Scan-Cache (`cache: false`):
  - `packages/coding-agent/src/tools/grep.ts`

## Invalidierungsvertrag

Nativer Invalidierungs-Einstiegspunkt:

- `invalidateFsScanCache(path?: string)`
  - mit `path`: Cache-Einträge entfernen, deren Wurzel ein Präfix des Zielpfads ist
  - ohne Pfad: alle Scan-Cache-Einträge löschen

Details zur Pfadbehandlung:

- Relative Invalidierungspfade werden gegen cwd aufgelöst
- Invalidierung versucht Kanonisierung
- Wenn das Ziel nicht existiert (z.B. Löschung), wird als Fallback das übergeordnete Verzeichnis kanonisiert und der Dateiname wenn möglich wieder angehängt
- Dies erhält das Invalidierungsverhalten für Erstellen/Löschen/Umbenennen, wo eine Seite möglicherweise nicht existiert

## Verantwortlichkeiten beim Coding-Agent-Mutationsfluss

Coding-Agent-Code muss nach erfolgreichen Dateisystem-Mutationen invalidieren.

Zentrale Helfer:

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)` (invalidiert beide Seiten, wenn sich die Pfade unterscheiden)

Aktuelle Mutations-Tool-Aufrufstellen:

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts` (Hashline-/Patch-/Replace-Flüsse)

Regel: Wenn ein Fluss Dateisysteminhalte oder -standorte mutiert und diese Helfer umgeht, sind Cache-Veralterungs-Bugs zu erwarten.

## Einen neuen Cache-Konsumenten sicher hinzufügen

Beim Einführen der Cache-Nutzung in einem neuen Scanner-/Suchpfad:

1. **Stabile Scan-Richtlinien-Eingaben verwenden**
   - Hidden-/Gitignore-Semantik zuerst festlegen
   - Diese konsistent an `get_or_scan`/`force_rescan` übergeben, damit Cache-Partitionen beabsichtigt sind

2. **Cache-Daten als nur durch Traversierungsrichtlinie vorgefiltert behandeln**
   - Tool-spezifische Filterung (Glob-Muster, Typ-Filter, Node-Modules-Regeln) nach dem Abruf anwenden
   - Niemals annehmen, dass gecachte Einträge bereits Ihre übergeordneten Filter widerspiegeln

3. **Schnelle Neuprüfung bei leeren Ergebnissen nur für Veraltungs-Negativ-Risiken implementieren**
   - `scan.cache_age_ms >= empty_recheck_ms()` verwenden
   - Einmal mit `force_rescan(..., store=true, ...)` wiederholen
   - Diesen Pfad von der normalen Cache-Treffer-Logik getrennt halten

4. **No-Cache-Modus explizit respektieren**
   - Wenn der Aufrufer den Cache deaktiviert, `force_rescan(..., store=false, ...)` aufrufen
   - Den gemeinsamen Cache nicht in einem No-Cache-Anfragepfad befüllen

5. **Mutations-Invalidierung für jeden neuen Schreibpfad verdrahten**
   - Nach erfolgreichem Schreiben/Bearbeiten/Löschen/Umbenennen den Coding-Agent-Invalidierungshelfer aufrufen
   - Bei Umbenennung/Verschiebung sowohl alte als auch neue Pfade invalidieren

6. **Keine TTL-Regler pro Aufruf hinzufügen**
   - Der aktuelle Vertrag sieht nur eine globale Richtlinie vor (umgebungsvariablen-konfiguriert), keine TTL-Überschreibung pro Anfrage

## Bekannte Grenzen

- Der Cache-Bereich ist prozesslokal im Arbeitsspeicher (`DashMap`), nicht über Prozess-Neustarts hinweg persistiert.
- Der Cache speichert Scan-Einträge, keine endgültigen Tool-Ergebnisse.
- `glob`/`fuzzyFind`/`grep` teilen Scan-Einträge nur, wenn die Schlüsseldimensionen (`root`, `hidden`, `gitignore`) übereinstimmen.
- `.git` wird beim Scan-Sammeln immer ausgeschlossen, unabhängig von den Aufrufer-Optionen.
