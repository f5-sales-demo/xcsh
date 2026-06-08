---
title: Natives Text- und Such-Pipeline
description: >-
  Native Text-Such-Pipeline mit grep-, glob- und ripgrep-basierter
  Dateiinhaltsindexierung.
sidebar:
  order: 6
  label: Text & Such-Pipeline
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# Natives Text/Such-Pipeline

Dieses Dokument bildet die Text-/Suchoberfläche (`grep`, `glob`, `text`, `highlight`) von `@f5xc-salesdemos/pi-natives` ab – von TypeScript-Wrappern über Rust N-API-Exports bis hin zu JS-Ergebnisobjekten.

Die Terminologie folgt `docs/natives-architecture.md`:

- **Wrapper**: TS-API in `packages/natives/src/*`
- **Rust-Modulschicht**: N-API-Exports in `crates/pi-natives/src/*`
- **Gemeinsamer Scan-Cache**: `fs_cache`-gestützter Verzeichniseintrags-Cache, der von Discovery-/Suchflüssen verwendet wird

## Implementierungsdateien

- `packages/natives/src/grep/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/highlight/types.ts`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/glob_util.rs`
- `crates/pi-natives/src/fs_cache.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/highlight.rs`
- `crates/pi-natives/src/fd.rs`

## JS-API ↔ Rust-Export-Zuordnung

| JS-Wrapper-API | Rust-Export (`#[napi]`, snake_case -> camelCase) | Rust-Modul |
| --- | --- | --- |
| `grep(options, onMatch?)` | `grep` | `grep.rs` |
| `searchContent(content, options)` | `search` | `grep.rs` |
| `hasMatch(content, pattern, options?)` | `hasMatch` | `grep.rs` |
| `fuzzyFind(options)` | `fuzzyFind` | `fd.rs` |
| `glob(options, onMatch?)` | `glob` | `glob.rs` |
| `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `fs_cache.rs` |
| `wrapTextWithAnsi(text, width)` | `wrapTextWithAnsi` | `text.rs` |
| `truncateToWidth(text, maxWidth, ellipsis, pad)` | `truncateToWidth` | `text.rs` |
| `sliceWithWidth(line, startCol, length, strict?)` | `sliceWithWidth` | `text.rs` |
| `extractSegments(line, beforeEnd, afterStart, afterLen, strictAfter)` | `extractSegments` | `text.rs` |
| `sanitizeText(text)` | `sanitizeText` | `text.rs` |
| `visibleWidth(text)` | `visibleWidth` | `text.rs` |
| `highlightCode(code, lang, colors)` | `highlightCode` | `highlight.rs` |
| `supportsLanguage(lang)` | `supportsLanguage` | `highlight.rs` |
| `getSupportedLanguages()` | `getSupportedLanguages` | `highlight.rs` |

## Pipeline-Übersicht nach Subsystem

## 1) Regex-Suche (`grep`, `searchContent`, `hasMatch`)

### Eingabe-/Optionsfluss

1. Der TS-Wrapper leitet Optionen an den nativen Code weiter:
   - `grep/index.ts` übergibt `options` weitgehend unverändert und wandelt den Callback von `(match) => void` in die napi-threadsafe-Callback-Form `(err, match)` um.
   - `searchContent` und `hasMatch` übergeben String/`Uint8Array` direkt.
2. Rust-Optionsstrukturen in `grep.rs` deserialisieren camelCase-Felder (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`).
3. `grep` erstellt ein `CancelToken` aus `timeoutMs` + `AbortSignal` und wird innerhalb von `task::blocking("grep", ...)` ausgeführt.

### Ausführungszweige

- **In-Memory-Zweig (reine Hilfsfunktion)**
  - `search` → `search_sync` → `run_search` auf übergebenen Inhaltsbytes.
  - Kein Dateisystem-Scan, kein `fs_cache`.
- **Einzeldatei-Zweig (dateisystemabhängig)**
  - `grep_sync` löst den Pfad auf, prüft ob Metadaten eine Datei anzeigen, streamt bis zu `MAX_FILE_BYTES` pro Datei (`4 MiB`) durch den ripgrep-Matcher.
- **Verzeichnis-Zweig (dateisystemabhängig)**
  - Optionaler Cache-Lookup über `fs_cache::get_or_scan` wenn `cache: true`.
  - Frischer Scan über `fs_cache::force_rescan` wenn `cache: false`.
  - Optionale Leer-Ergebnis-Neuprüfung wenn das Cache-Alter `empty_recheck_ms()` überschreitet.
  - Eintragsfilterung: nur Dateien + optionaler Glob-Filter (`glob_util`) + optionale Typfilter-Zuordnung (`js`, `ts`, `rust`, etc.).

### Such-/Sammlungssemantik

- Regex-Engine: `grep_regex::RegexMatcherBuilder` mit `ignoreCase` und `multiline`.
- Kontextauflösung:
  - `contextBefore/contextAfter` überschreiben das Legacy-Feld `context`.
  - Nicht-Content-Modi setzen die Kontextsammlung auf null.
- Ausgabemodi:
  - `content` => ein `GrepMatch` pro Treffer.
  - `count` und `filesWithMatches` werden beide auf Zählstil-Einträge abgebildet (`lineNumber=0`, `line=""`, `matchCount` gesetzt).
- Limits:
  - Globales `offset` und `maxCount` werden dateiübergreifend angewendet.
  - Der parallele Pfad wird nur verwendet wenn `maxCount` nicht gesetzt und `offset == 0` ist; andernfalls bewahrt der sequentielle Pfad deterministische globale Offset-/Limit-Semantik.

### Ergebnisformung zurück zu JS

- Rust `SearchResult`/`GrepResult`-Felder werden über N-API-Objektfeldkonvertierung auf TS-Typen abgebildet.
- Zähler werden vor der N-API-Grenze auf `u32` begrenzt.
- Optionale Booleans werden ausgelassen, sofern sie nicht in einigen Pfaden true sind (`limitReached`).
- Der Streaming-Callback empfängt jeden geformten `GrepMatch` (Content- oder Zähleintrag).

### Fehlerverhalten

- `searchContent` gibt `SearchResult.error` bei Regex-/Suchfehlern zurück, anstatt zu werfen.
- `grep` lehnt bei schwerwiegenden Fehlern ab (ungültiger Pfad, ungültiger Glob/Regex, Abbruch-Timeout/Abort).
- `hasMatch` gibt `Result<bool>` zurück und wirft bei ungültigem Pattern/UTF-8-Dekodierungsfehlern.
- Dateiöffnungs-/Suchfehler bei Multi-Datei-Scans werden pro Datei übersprungen; der Scan wird fortgesetzt.

### Behandlung fehlerhafter Regex

`grep.rs` bereinigt geschweifte Klammern vor der Regex-Kompilierung:

- Ungültige wiederholungsartige geschweifte Klammern werden escapt (`{`/`}` -> `\{`/`\}`), wenn sie nicht `{N}`, `{N,}`, `{N,M}` bilden können.
- Dies verhindert, dass häufige Literal-Template-Fragmente (zum Beispiel `${platform}`) als fehlerhafte Wiederholung fehlschlagen.
- Verbleibende ungültige Regex-Syntax gibt weiterhin einen Regex-Fehler zurück.

## 2) Dateierkennung (`glob`) und unscharfe Pfadsuche (`fuzzyFind`)

`glob` und `fuzzyFind` teilen sich `fs_cache`-Scans; die Matching-Logik unterscheidet sich.

### `glob`-Ablauf

1. TS-Wrapper (`glob/index.ts`):
   - `path.resolve(options.path)`.
   - Standardwerte: `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`.
2. Rust `glob` erstellt `GlobConfig` und kompiliert das Pattern über `glob_util::compile_glob`.
3. Eintragsquelle:
   - `cache=true` => `get_or_scan` + optionaler Stale-Empty `force_rescan`.
   - `cache=false` => `force_rescan(..., store=false)` (nur frisch).
4. Filterung:
   - `.git` wird immer übersprungen.
   - `node_modules` wird übersprungen, sofern nicht angefordert (`includeNodeModules` oder Pattern das node_modules erwähnt).
   - Glob-Match anwenden.
   - Dateityp-Filter anwenden; Symlink `file/dir`-Filter lösen Ziel-Metadaten auf.
5. Optionale Sortierung nach mtime absteigend (`sortByMtime`) vor der Begrenzung auf `maxResults`.

### `fuzzyFind`-Ablauf (implementiert in `fd.rs`)

1. Der TS-Wrapper wird aus dem `grep`-Modul exportiert, aber die Rust-Implementierung befindet sich in `fd.rs`.
2. Gemeinsame Scan-Quelle aus `fs_cache` mit der gleichen Cache/Kein-Cache-Aufteilung und Stale-Empty-Neuprüfungsrichtlinie.
3. Scoring:
   - exakt / beginnt-mit / enthält / subsequenzbasierter Fuzzy-Score
   - Separator/Interpunktion-normalisierter Scoring-Pfad
   - Verzeichnis-Bonus und deterministischer Gleichstand-Aufbruch (`score desc`, dann `path asc`)
4. Symlink-Einträge werden von Fuzzy-Ergebnissen ausgeschlossen.

### Fehlerverhalten

- Ungültiges Glob-Pattern => Fehler von `glob_util::compile_glob`.
- Suchwurzel muss ein existierendes Verzeichnis sein (`resolve_search_path`), andernfalls Fehler.
- Abbruch/Timeouts werden als Abort-Fehler über `CancelToken::heartbeat()`-Prüfungen in Schleifen propagiert.

### Behandlung fehlerhafter Globs

`glob_util::build_glob_pattern` ist tolerant:

- Normalisiert `\` zu `/`.
- Einfache rekursive Patterns werden automatisch mit `**/` präfixiert wenn `recursive=true`.
- Nicht geschlossene `{...`-Alternierungsgruppen werden vor der Kompilierung automatisch geschlossen.

## 3) Gemeinsamer Scan/Cache-Lebenszyklus (`fs_cache`)

`fs_cache` speichert Scan-Ergebnisse als normalisierte relative Einträge (`path`, `fileType`, optionale `mtime`), indiziert nach:

- kanonischer Suchwurzel
- `include_hidden`
- `use_gitignore`

### Cache-Zustandsübergänge

1. **Miss / deaktiviert**
   - TTL ist `0` oder Schlüssel fehlt/abgelaufen -> frisches `collect_entries`.
2. **Hit**
   - Eintragsalter `< cache_ttl_ms()` -> gecachte Einträge + `cache_age_ms` zurückgeben.
3. **Stale-Empty-Neuprüfung** (Aufrufer-Richtlinie in `glob`/`grep`/`fd`)
   - Wenn die Abfrage null Treffer ergibt und `cache_age_ms >= empty_recheck_ms()`, wird ein Rescan erzwungen.
4. **Invalidierung**
   - `invalidateFsScanCache(path?)`:
     - kein Argument: alle Schlüssel löschen
     - Pfad-Argument: Schlüssel entfernen, deren Wurzel diesen Zielpfad als Präfix hat

### Stale-Ergebnis-Kompromiss

- Der Cache bevorzugt latenzarme wiederholte Scans gegenüber sofortiger Konsistenz.
- Das TTL-Fenster kann veraltete positive/negative Ergebnisse zurückgeben.
- Die Leer-Ergebnis-Neuprüfung reduziert veraltete Negativergebnisse bei älteren gecachten Scans auf Kosten eines zusätzlichen Scans.
- Explizite Invalidierung ist der vorgesehene Korrektheitsmechanismus nach Dateimutationen.

## 4) ANSI-Texthilfsfunktionen (`text`)

Dies sind reine In-Memory-Hilfsfunktionen (kein Dateisystem-Scanning).

### Grenzen und Verantwortlichkeiten

- **`text.rs` besitzt die Terminal-Zellen-Semantik**:
  - ANSI-Sequenz-Parsing
  - Graphem-bewusste Breiten- und Slicing-Operationen
  - Wrap-/Truncate-/Sanitize-Verhalten
- **`grep.rs` Zeilentrunkierung (`maxColumns`) ist separat**:
  - einfache Zeichengrenz-Trunkierung von übereinstimmenden Zeilen mit `...`
  - nicht ANSI-Zustand-erhaltend und nicht Terminal-Zellenbreite-bewusst

### Wesentliche Verhaltensweisen

- `wrapTextWithAnsi`: Umbruch nach sichtbarer Breite, trägt aktive SGR-Codes über umgebrochene Zeilen hinweg.
- `truncateToWidth`: Sichtbare-Zellen-Trunkierung mit Auslassungsrichtlinie (`Unicode`, `Ascii`, `Omit`), optionalem rechten Padding und Fast-Path, der den originalen JS-String zurückgibt wenn unverändert.
- `sliceWithWidth`: Spalten-Slicing mit optionaler strikter Breitendurchsetzung.
- `extractSegments`: Extrahiert Vorher-/Nachher-Segmente um ein Overlay und stellt den ANSI-Zustand für das `after`-Segment wieder her.
- `sanitizeText`: Entfernt ANSI-Escapes + Steuerzeichen, verwirft alleinstehende Surrogate, normalisiert CR/LF durch Entfernung von `\r`.
- `visibleWidth`: Zählt sichtbare Terminal-Zellen (Tabs verwenden feste `TAB_WIDTH` aus der Rust-Implementierung).

### Fehlerverhalten

Textfunktionen geben generell deterministisch transformierte Ausgaben zurück; Fehler beschränken sich auf JS-String-Konvertierungsgrenzen (N-API-Argumentkonvertierungsfehler).

## 5) Syntax-Highlighting (`highlight`)

`highlight.rs` ist eine reine Transformation (kein FS, kein Cache).

### Ablauf

1. Der Wrapper leitet `code`, optionales `lang` und eine ANSI-Farbpalette weiter.
2. Rust löst die Syntax auf durch:
   - Token/Name-Lookup
   - Erweiterungs-Lookup
   - Alias-Tabellen-Fallback (`ts/tsx/js -> JavaScript`, etc.)
   - Fallback auf Klartext-Syntax wenn nicht auflösbar
3. Jede Zeile wird mit syntect `ParseState` und Scope-Stack geparst.
4. Scopes werden auf 11 semantische Farbkategorien abgebildet und ANSI-Farbcodes werden eingefügt/zurückgesetzt.

### Fehlerverhalten

- Ein Parse-Fehler pro Zeile lässt den Aufruf nicht fehlschlagen: diese Zeile wird unhervorgehoben angehängt und die Verarbeitung wird fortgesetzt.
- Unbekannte/nicht unterstützte Sprache fällt auf Klartext-Syntax zurück.

## Reine Hilfsfunktionen vs. dateisystemabhängige Abläufe

| Ablauf | Dateisystemzugriff | Gemeinsamer Cache | Anmerkungen |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | Nein | Nein | Regex nur auf übergebenen Bytes/Strings |
| `text`-Modulfunktionen | Nein | Nein | Nur ANSI/Breite/Sanitization |
| `highlight`-Modulfunktionen | Nein | Nein | Nur Syntax + ANSI-Farbgebung |
| `glob` | Ja | Optional | Verzeichnis-Scans + Glob-Filterung |
| `fuzzyFind` | Ja | Optional | Verzeichnis-Scans + Fuzzy-Scoring |
| `grep` (Datei-/Verzeichnispfad) | Ja | Optional (Verzeichnismodus) | ripgrep über Dateien, optionale Filter/Callback |

## End-to-End-Lebenszyklus-Zusammenfassung

1. Der Aufrufer ruft den TS-Wrapper mit typisierten Optionen auf.
2. Der Wrapper normalisiert Standardwerte (insbesondere `glob`) und leitet an den `native.*`-Export weiter.
3. Rust validiert/normalisiert Optionen und erstellt Matcher/Suchkonfiguration.
4. Für Dateisystem-Abläufe werden Einträge gescannt (Cache-Hit/Miss/Rescan) und dann gefiltert/bewertet.
5. Worker-Schleifen rufen periodisch den Cancel-Heartbeat auf; Timeout/Abort kann die Ausführung beenden.
6. Rust formt Ausgaben in N-API-Objekte (`lineNumber`, `matchCount`, `limitReached`, etc.).
7. Der TS-Wrapper gibt typisierte JS-Objekte zurück (und optionale Pro-Match-Callbacks für `grep`/`glob`).
