---
title: Native Text- und Such-Pipeline
description: >-
  Native Text-Such-Pipeline mit grep-, glob- und ripgrep-basierter
  Dateiinhaltsindizierung.
sidebar:
  order: 6
  label: Text- & Such-Pipeline
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# Native Text-/Such-Pipeline

Dieses Dokument bildet die Text-/Suchoberfläche (`grep`, `glob`, `text`, `highlight`) von `@f5xc-salesdemos/pi-natives` von TypeScript-Wrappern zu Rust N-API-Exporten und zurück zu JS-Ergebnisobjekten ab.

Die Terminologie folgt `docs/natives-architecture.md`:

- **Wrapper**: TS-API in `packages/natives/src/*`
- **Rust-Modulschicht**: N-API-Exporte in `crates/pi-natives/src/*`
- **Gemeinsamer Scan-Cache**: `fs_cache`-gestützter Verzeichniseintrag-Cache, der von Discovery-/Suchflüssen verwendet wird

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

1. Der TS-Wrapper leitet Optionen an die native Schicht weiter:
   - `grep/index.ts` übergibt `options` weitgehend unverändert und wandelt den Callback von `(match) => void` in die NAPI-Threadsafe-Callback-Form `(err, match)` um.
   - `searchContent` und `hasMatch` übergeben String/`Uint8Array` direkt.
2. Rust-Options-Structs in `grep.rs` deserialisieren camelCase-Felder (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`).
3. `grep` erstellt ein `CancelToken` aus `timeoutMs` + `AbortSignal` und läuft innerhalb von `task::blocking("grep", ...)`.

### Ausführungszweige

- **In-Memory-Zweig (reine Hilfsfunktion)**
  - `search` → `search_sync` → `run_search` auf den bereitgestellten Inhaltsbytes.
  - Kein Dateisystem-Scan, kein `fs_cache`.
- **Einzeldatei-Zweig (dateisystemabhängig)**
  - `grep_sync` löst den Pfad auf, prüft ob die Metadaten eine Datei beschreiben, streamt bis zu `MAX_FILE_BYTES` pro Datei (`4 MiB`) durch den ripgrep-Matcher.
- **Verzeichnis-Zweig (dateisystemabhängig)**
  - Optionaler Cache-Lookup über `fs_cache::get_or_scan` wenn `cache: true`.
  - Frischer Scan über `fs_cache::force_rescan` wenn `cache: false`.
  - Optionale Leer-Ergebnis-Neuprüfung wenn das Cache-Alter `empty_recheck_ms()` überschreitet.
  - Eintragsfilterung: nur Dateien + optionaler Glob-Filter (`glob_util`) + optionale Typfilter-Zuordnung (`js`, `ts`, `rust`, etc.).

### Such-/Sammlungssemantik

- Regex-Engine: `grep_regex::RegexMatcherBuilder` mit `ignoreCase` und `multiline`.
- Kontextauflösung:
  - `contextBefore/contextAfter` überschreiben das veraltete `context`.
  - Nicht-Inhaltsmodi setzen die Kontextsammlung auf null.
- Ausgabemodi:
  - `content` => ein `GrepMatch` pro Treffer.
  - `count` und `filesWithMatches` werden beide auf Zähleinträge abgebildet (`lineNumber=0`, `line=""`, `matchCount` gesetzt).
- Limits:
  - Globaler `offset` und `maxCount` werden dateiübergreifend angewendet.
  - Der parallele Pfad wird nur verwendet wenn `maxCount` nicht gesetzt ist und `offset == 0`; andernfalls bewahrt der sequentielle Pfad deterministische globale Offset-/Limit-Semantik.

### Ergebnisformung zurück zu JS

- Rust `SearchResult`/`GrepResult`-Felder werden über N-API-Objektfeldkonvertierung auf TS-Typen abgebildet.
- Zähler werden vor dem Überqueren der N-API-Grenze auf `u32` begrenzt.
- Optionale Boolesche Werte werden in einigen Pfaden ausgelassen, sofern sie nicht wahr sind (`limitReached`).
- Der Streaming-Callback empfängt jeden geformten `GrepMatch` (Inhalts- oder Zähleintrag).

### Fehlerverhalten

- `searchContent` gibt `SearchResult.error` bei Regex-/Suchfehlern zurück, anstatt zu werfen.
- `grep` lehnt bei harten Fehlern ab (ungültiger Pfad, ungültiger Glob/Regex, Abbruch-Timeout/Abort).
- `hasMatch` gibt `Result<bool>` zurück und wirft bei ungültigem Muster/UTF-8-Dekodierungsfehlern.
- Dateiöffnungs-/Suchfehler bei Multi-Datei-Scans werden pro Datei übersprungen; der Scan wird fortgesetzt.

### Behandlung fehlerhafter Regex

`grep.rs` bereinigt geschweifte Klammern vor der Regex-Kompilierung:

- Ungültige wiederholungsähnliche geschweifte Klammern werden escaped (`{`/`}` -> `\{`/`\}`), wenn sie kein `{N}`, `{N,}`, `{N,M}` bilden können.
- Dies verhindert, dass häufige Literal-Template-Fragmente (zum Beispiel `${platform}`) als fehlerhafte Wiederholung fehlschlagen.
- Verbleibende ungültige Regex-Syntax gibt weiterhin einen Regex-Fehler zurück.

## 2) Dateierkennung (`glob`) und unscharfe Pfadsuche (`fuzzyFind`)

`glob` und `fuzzyFind` teilen sich `fs_cache`-Scans; die Matching-Logik unterscheidet sich.

### `glob`-Fluss

1. TS-Wrapper (`glob/index.ts`):
   - `path.resolve(options.path)`.
   - Standardwerte: `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`.
2. Rust `glob` erstellt `GlobConfig` und kompiliert das Muster über `glob_util::compile_glob`.
3. Eintragsquelle:
   - `cache=true` => `get_or_scan` + optionaler veralteter leerer `force_rescan`.
   - `cache=false` => `force_rescan(..., store=false)` (nur frisch).
4. Filterung:
   - `.git` wird immer übersprungen.
   - `node_modules` wird übersprungen, sofern nicht angefordert (`includeNodeModules` oder Muster, das node_modules erwähnt).
   - Glob-Match anwenden.
   - Dateityp-Filter anwenden; Symlink-`file/dir`-Filter lösen Ziel-Metadaten auf.
5. Optionale Sortierung nach mtime absteigend (`sortByMtime`) vor dem Kürzen auf `maxResults`.

### `fuzzyFind`-Fluss (implementiert in `fd.rs`)

1. Der TS-Wrapper wird aus dem `grep`-Modul exportiert, aber die Rust-Implementierung befindet sich in `fd.rs`.
2. Gemeinsame Scan-Quelle aus `fs_cache` mit derselben Cache-/Kein-Cache-Aufteilung und Richtlinie zur Neuprüfung veralteter leerer Ergebnisse.
3. Bewertung:
   - Exakt / Beginnt-mit / Enthält / subsequenzbasierter Fuzzy-Score
   - Separator-/Interpunktions-normalisierter Bewertungspfad
   - Verzeichnis-Bonus und deterministischer Gleichstandsbrecher (`score absteigend`, dann `path aufsteigend`)
4. Symlink-Einträge werden von Fuzzy-Ergebnissen ausgeschlossen.

### Fehlerverhalten

- Ungültiges Glob-Muster => Fehler von `glob_util::compile_glob`.
- Das Suchstammverzeichnis muss ein existierendes Verzeichnis sein (`resolve_search_path`), andernfalls Fehler.
- Abbrüche/Timeouts werden als Abort-Fehler über `CancelToken::heartbeat()`-Prüfungen in Schleifen propagiert.

### Behandlung fehlerhafter Globs

`glob_util::build_glob_pattern` ist tolerant:

- Normalisiert `\` zu `/`.
- Stellt einfachen rekursiven Mustern automatisch `**/` voran wenn `recursive=true`.
- Schließt automatisch nicht geschlossene `{...`-Alternationsgruppen vor der Kompilierung.

## 3) Gemeinsamer Scan-/Cache-Lebenszyklus (`fs_cache`)

`fs_cache` speichert Scan-Ergebnisse als normalisierte relative Einträge (`path`, `fileType`, optionale `mtime`), indiziert durch:

- kanonisches Suchstammverzeichnis
- `include_hidden`
- `use_gitignore`

### Cache-Zustandsübergänge

1. **Fehltreffer / deaktiviert**
   - TTL ist `0` oder Schlüssel fehlt/abgelaufen -> frisches `collect_entries`.
2. **Treffer**
   - Eintragsalter `< cache_ttl_ms()` -> zwischengespeicherte Einträge + `cache_age_ms` zurückgeben.
3. **Veraltete-Leer-Neuprüfung** (Aufrufer-Richtlinie in `glob`/`grep`/`fd`)
   - Wenn die Abfrage null Treffer ergibt und `cache_age_ms >= empty_recheck_ms()`, einmaligen Rescan erzwingen.
4. **Invalidierung**
   - `invalidateFsScanCache(path?)`:
     - kein Argument: alle Schlüssel löschen
     - Pfad-Argument: Schlüssel entfernen, deren Stamm dem Zielpfad vorangestellt ist

### Kompromiss bei veralteten Ergebnissen

- Der Cache bevorzugt niedrige Latenz bei wiederholten Scans gegenüber sofortiger Konsistenz.
- Das TTL-Fenster kann veraltete positive/negative Ergebnisse zurückgeben.
- Die Leer-Ergebnis-Neuprüfung reduziert veraltete Negativergebnisse bei älteren zwischengespeicherten Scans auf Kosten eines zusätzlichen Scans.
- Explizite Invalidierung ist der vorgesehene Korrektheitsmechanismus nach Dateimutationen.

## 4) ANSI-Textdienstprogramme (`text`)

Dies sind reine In-Memory-Dienstprogramme (kein Dateisystem-Scanning).

### Grenzen und Verantwortlichkeiten

- **`text.rs` besitzt die Terminal-Zell-Semantik**:
  - ANSI-Sequenz-Parsing
  - Graphem-bewusste Breite und Slicing
  - Umbruch-/Kürzungs-/Bereinigungsverhalten
- **`grep.rs` Zeilenkürzung (`maxColumns`) ist separat**:
  - Einfache Zeichengrenze-Kürzung von Treffzeilen mit `...`
  - Nicht ANSI-Zustand-erhaltend und nicht Terminal-Zellbreite-bewusst

### Schlüsselverhalten

- `wrapTextWithAnsi`: Umbruch nach sichtbarer Breite, überträgt aktive SGR-Codes über umgebrochene Zeilen.
- `truncateToWidth`: Sichtbare-Zell-Kürzung mit Auslassungsrichtlinie (`Unicode`, `Ascii`, `Omit`), optionales rechtes Padding und Schnellpfad, der den ursprünglichen JS-String zurückgibt wenn unverändert.
- `sliceWithWidth`: Spalten-Slicing mit optionaler strikter Breitendurchsetzung.
- `extractSegments`: Extrahiert Vor-/Nach-Segmente um ein Overlay und stellt den ANSI-Zustand für das `after`-Segment wieder her.
- `sanitizeText`: Entfernt ANSI-Escape-Sequenzen + Steuerzeichen, verwirft einsame Surrogate, normalisiert CR/LF durch Entfernung von `\r`.
- `visibleWidth`: Zählt sichtbare Terminal-Zellen (Tabs verwenden feste `TAB_WIDTH` aus der Rust-Implementierung).

### Fehlerverhalten

Textfunktionen geben im Allgemeinen deterministisch transformierte Ausgaben zurück; Fehler beschränken sich auf JS-String-Konvertierungsgrenzen (N-API-Argumentkonvertierungsfehler).

## 5) Syntax-Hervorhebung (`highlight`)

`highlight.rs` ist reine Transformation (kein FS, kein Cache).

### Fluss

1. Der Wrapper leitet `code`, optionales `lang` und die ANSI-Farbpalette weiter.
2. Rust löst die Syntax auf durch:
   - Token-/Namenssuche
   - Erweiterungssuche
   - Alias-Tabellen-Fallback (`ts/tsx/js -> JavaScript`, etc.)
   - Fallback auf Klartext-Syntax wenn nicht aufgelöst
3. Jede Zeile mit syntect `ParseState` und Scope-Stack parsen.
4. Scopes auf 11 semantische Farbkategorien abbilden und ANSI-Farbcodes einfügen/zurücksetzen.

### Fehlerverhalten

- Ein Parse-Fehler pro Zeile lässt den Aufruf nicht fehlschlagen: Diese Zeile wird unhervorgehoben angehängt und die Verarbeitung wird fortgesetzt.
- Unbekannte/nicht unterstützte Sprache fällt auf Klartext-Syntax zurück.

## Reine Dienstprogramme vs. dateisystemabhängige Flüsse

| Fluss | Dateisystemzugriff | Gemeinsamer Cache | Anmerkungen |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | Nein | Nein | Regex nur auf bereitgestellten Bytes/Strings |
| `text`-Modulfunktionen | Nein | Nein | Nur ANSI/Breite/Bereinigung |
| `highlight`-Modulfunktionen | Nein | Nein | Nur Syntax + ANSI-Färbung |
| `glob` | Ja | Optional | Verzeichnis-Scans + Glob-Filterung |
| `fuzzyFind` | Ja | Optional | Verzeichnis-Scans + Fuzzy-Bewertung |
| `grep` (Datei-/Verzeichnispfad) | Ja | Optional (Verzeichnismodus) | ripgrep über Dateien, optionale Filter/Callbacks |

## End-to-End-Lebenszyklus-Zusammenfassung

1. Der Aufrufer ruft den TS-Wrapper mit typisierten Optionen auf.
2. Der Wrapper normalisiert Standardwerte (insbesondere `glob`) und leitet an den `native.*`-Export weiter.
3. Rust validiert/normalisiert Optionen und erstellt Matcher-/Suchkonfiguration.
4. Für Dateisystemflüsse werden Einträge gescannt (Cache-Treffer/Fehltreffer/Rescan), dann gefiltert/bewertet.
5. Worker-Schleifen rufen periodisch den Cancel-Heartbeat auf; Timeout/Abort kann die Ausführung beenden.
6. Rust formt Ausgaben in N-API-Objekte (`lineNumber`, `matchCount`, `limitReached`, etc.).
7. Der TS-Wrapper gibt typisierte JS-Objekte zurück (und optionale pro-Treffer-Callbacks für `grep`/`glob`).
