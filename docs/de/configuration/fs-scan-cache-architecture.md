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

Dieses Dokument definiert den aktuellen Vertrag für den gemeinsam genutzten Dateisystem-Scan-Cache, der in Rust (`crates/pi-natives/src/fs_cache.rs`) implementiert ist und von nativen Discovery-/Such-APIs genutzt wird, die für `packages/coding-agent` bereitgestellt werden.

## Was dieser Cache ist

Der Cache speichert vollständige Verzeichnis-Scan-Eintragslisten (`GlobMatch[]`), die nach Scan-Scope und Traversierungsrichtlinie indiziert sind, und ermöglicht es übergeordneten Operationen (Glob-Filterung, Fuzzy-Bewertung, Grep-Dateiauswahl), gegen diese gecachten Einträge zu arbeiten.

Primäre Ziele:

- wiederholte Dateisystem-Durchläufe für wiederholte Discovery-/Suchaufrufe vermeiden
- Konsistenz zwischen `glob`, `fuzzyFind` und `grep` sicherstellen, wenn sie dieselbe Scan-Richtlinie teilen
- explizite Veralterungs-Wiederherstellung für leere Ergebnisse und explizite Invalidierung nach Datei-Mutationen ermöglichen

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

## Cache-Schlüssel-Partitionierung (harter Vertrag)

Jeder Eintrag wird indiziert durch:

- kanonisierter `root`-Verzeichnispfad
- `include_hidden` Boolean
- `use_gitignore` Boolean

Implikationen:

- Scans mit und ohne versteckte Dateien teilen sich **keine** Einträge.
- Scans mit und ohne Gitignore-Beachtung teilen sich **keine** Einträge.
- Konsumenten müssen stabile Semantik für Hidden-/Gitignore-Verhalten übergeben; das Ändern eines der Flags erzeugt eine andere Cache-Partition.

Die `node_modules`-Einbeziehung ist **nicht** im Cache-Schlüssel enthalten. Der Cache speichert Einträge mit eingeschlossenen `node_modules`; die konsumentenspezifische Filterung wird nach dem Abruf angewendet.

## Scan-Erfassungsverhalten

Die Cache-Befüllung verwendet einen deterministischen Walker (`ignore::WalkBuilder`), der durch `include_hidden` und `use_gitignore` konfiguriert wird:

- `follow_links(false)`
- sortiert nach Dateipfad
- `.git` wird immer übersprungen
- `node_modules` wird zum Zeitpunkt des Cache-Scans immer erfasst (und optional später gefiltert)
- Eintrags-Dateityp + `mtime` werden über `symlink_metadata` erfasst

Such-Wurzelverzeichnisse werden durch `resolve_search_path` aufgelöst:

- relative Pfade werden gegen das aktuelle cwd aufgelöst
- das Ziel muss ein existierendes Verzeichnis sein
- das Wurzelverzeichnis wird wenn möglich kanonisiert

## Frische- und Eviktionsrichtlinie

Globale Richtlinie (über Umgebungsvariablen überschreibbar):

- `FS_SCAN_CACHE_TTL_MS` (Standard `1000`)
- `FS_SCAN_EMPTY_RECHECK_MS` (Standard `200`)
- `FS_SCAN_CACHE_MAX_ENTRIES` (Standard `16`)

Verhalten:

- `get_or_scan(...)`
  - wenn TTL `0` ist: Cache vollständig umgehen, immer frischer Scan (`cache_age_ms = 0`)
  - bei Cache-Treffer innerhalb der TTL: gecachte Einträge + nicht-null `cache_age_ms` zurückgeben
  - bei abgelaufenem Treffer: Schlüssel eviktieren, neu scannen, frischen Eintrag speichern
- Maximale Eintragsanzahl wird durch Ältester-zuerst-Eviktierung nach `created_at` durchgesetzt

## Schnelle Nachprüfung bei leeren Ergebnissen (getrennt von normalen Treffern)

Normaler Cache-Treffer:

- ein Cache-Treffer innerhalb der TTL gibt gecachte Einträge zurück und tut nichts weiter.

Schnelle Nachprüfung bei leeren Ergebnissen:

- dies ist eine **aufruferseitige** Richtlinie unter Verwendung von `ScanResult.cache_age_ms`
- wenn das gefilterte/abgefragte Ergebnis leer ist und das Alter des gecachten Scans mindestens `empty_recheck_ms()` beträgt, führt der Aufrufer einen `force_rescan(...)` durch und versucht es erneut
- dient dazu, falsch-negative Ergebnisse durch Veralterung zu reduzieren, wenn Dateien kürzlich hinzugefügt wurden, der Cache aber noch innerhalb der TTL liegt

Aktuelle Konsumenten:

- `glob`: prüft erneut, wenn gefilterte Treffer leer sind und das Scan-Alter den Schwellenwert überschreitet
- `fuzzyFind` (`fd.rs`): prüft nur erneut, wenn die Abfrage nicht leer ist und bewertete Treffer leer sind
- `grep`: prüft erneut, wenn die ausgewählte Kandidaten-Dateiliste leer ist

## Konsumenten-Standardwerte und Cache-Nutzung

Der Cache ist Opt-in bei allen exponierten APIs (`cache?: boolean`, Standard `false`).

Aktuelle Standardwerte in nativen APIs:

- `glob`: `hidden=false`, `gitignore=true`, `cache=false`
- `fuzzyFind`: `hidden=false`, `gitignore=true`, `cache=false`
- `grep`: `hidden=true`, `cache=false`, und der Cache-Scan verwendet immer `use_gitignore=true`

Coding-Agent-Aufrufer heute:

- Hochvolumige Mention-Kandidaten-Discovery aktiviert den Cache:
  - `packages/coding-agent/src/utils/file-mentions.ts`
  - Profil: `hidden=true`, `gitignore=true`, `includeNodeModules=true`, `cache=true`
- Tool-Level-`grep`-Integration deaktiviert derzeit den Scan-Cache (`cache: false`):
  - `packages/coding-agent/src/tools/grep.ts`

## Invalidierungsvertrag

Nativer Invalidierungs-Einstiegspunkt:

- `invalidateFsScanCache(path?: string)`
  - mit `path`: Cache-Einträge entfernen, deren Root ein Präfix des Zielpfades ist
  - ohne Pfad: alle Scan-Cache-Einträge löschen

Details zur Pfadbehandlung:

- relative Invalidierungspfade werden gegen cwd aufgelöst
- die Invalidierung versucht eine Kanonisierung
- wenn das Ziel nicht existiert (z.B. bei Löschung), wird als Fallback das übergeordnete Verzeichnis kanonisiert und der Dateiname wenn möglich wieder angehängt
- dies bewahrt das Invalidierungsverhalten für Erstellen/Löschen/Umbenennen, bei denen eine Seite möglicherweise nicht existiert

## Verantwortlichkeiten beim Coding-Agent-Mutationsablauf

Coding-Agent-Code muss nach erfolgreichen Dateisystem-Mutationen invalidieren.

Zentrale Helfer:

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)` (invalidiert beide Seiten, wenn die Pfade unterschiedlich sind)

Aktuelle Mutations-Tool-Aufrufstellen:

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts` (Hashline-/Patch-/Replace-Abläufe)

Regel: Wenn ein Ablauf Dateisystem-Inhalte oder -Positionen mutiert und diese Helfer umgeht, sind Cache-Veralterungs-Bugs zu erwarten.

## Einen neuen Cache-Konsumenten sicher hinzufügen

Beim Einführen der Cache-Nutzung in einem neuen Scanner-/Suchpfad:

1. **Stabile Scan-Richtlinien-Eingaben verwenden**
   - Hidden-/Gitignore-Semantik zuerst festlegen
   - diese konsistent an `get_or_scan`/`force_rescan` übergeben, damit Cache-Partitionen beabsichtigt sind

2. **Cache-Daten als nur durch Traversierungsrichtlinie vorgefiltert behandeln**
   - toolspezifische Filterung (Glob-Muster, Typfilter, node_modules-Regeln) nach dem Abruf anwenden
   - niemals annehmen, dass gecachte Einträge bereits Ihre übergeordneten Filter widerspiegeln

3. **Schnelle Nachprüfung bei leeren Ergebnissen nur bei Risiko falsch-negativer Veralterung implementieren**
   - `scan.cache_age_ms >= empty_recheck_ms()` verwenden
   - einmal mit `force_rescan(..., store=true, ...)` wiederholen
   - diesen Pfad von der normalen Cache-Treffer-Logik getrennt halten

4. **No-Cache-Modus explizit beachten**
   - wenn der Aufrufer den Cache deaktiviert, `force_rescan(..., store=false, ...)` aufrufen
   - den gemeinsamen Cache nicht in einem No-Cache-Anfragepfad befüllen

5. **Mutations-Invalidierung für jeden neuen Schreibpfad verdrahten**
   - nach erfolgreichem Schreiben/Bearbeiten/Löschen/Umbenennen den Coding-Agent-Invalidierungshelfer aufrufen
   - bei Umbenennen/Verschieben beide alten und neuen Pfade invalidieren

6. **Keine Pro-Aufruf-TTL-Regler hinzufügen**
   - der aktuelle Vertrag sieht nur eine globale Richtlinie vor (über Umgebungsvariablen konfiguriert), keine Pro-Anfrage-TTL-Überschreibung

## Bekannte Grenzen

- Der Cache-Scope ist prozesslokal im Speicher (`DashMap`), nicht persistent über Prozessneustarts hinweg.
- Der Cache speichert Scan-Einträge, keine endgültigen Tool-Ergebnisse.
- `glob`/`fuzzyFind`/`grep` teilen Scan-Einträge nur, wenn die Schlüsseldimensionen (`root`, `hidden`, `gitignore`) übereinstimmen.
- `.git` wird unabhängig von Aufruferoptionen immer zum Zeitpunkt der Scan-Erfassung ausgeschlossen.
