---
title: Pipeline nativa per testo e ricerca
description: >-
  Pipeline di ricerca testuale nativa con indicizzazione del contenuto dei file
  basata su grep, glob e ripgrep.
sidebar:
  order: 6
  label: Pipeline testo e ricerca
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# Pipeline nativa per testo/ricerca

Questo documento descrive la superficie testo/ricerca di `@f5xc-salesdemos/pi-natives` (`grep`, `glob`, `text`, `highlight`), dai wrapper TypeScript agli export N-API Rust e viceversa verso gli oggetti risultato JS.

La terminologia segue `docs/natives-architecture.md`:

- **Wrapper**: API TS in `packages/natives/src/*`
- **Livello modulo Rust**: export N-API in `crates/pi-natives/src/*`
- **Cache di scansione condivisa**: cache di voci directory basata su `fs_cache` usata dai flussi di discovery/ricerca

## File di implementazione

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

## Mappatura API JS ↔ export Rust

| API wrapper JS | Export Rust (`#[napi]`, snake_case -> camelCase) | Modulo Rust |
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

## Panoramica della pipeline per sottosistema

## 1) Ricerca regex (`grep`, `searchContent`, `hasMatch`)

### Flusso di input/opzioni

1. Il wrapper TS inoltra le opzioni al modulo nativo:
   - `grep/index.ts` passa `options` quasi invariato e avvolge il callback da `(match) => void` nella forma di callback napi threadsafe `(err, match)`.
   - `searchContent` e `hasMatch` passano direttamente stringa/`Uint8Array`.
2. Le struct di opzioni Rust in `grep.rs` deserializzano i campi camelCase (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`).
3. `grep` crea un `CancelToken` da `timeoutMs` + `AbortSignal` ed esegue all'interno di `task::blocking("grep", ...)`.

### Rami di esecuzione

- **Ramo in-memory (utilità pura)**
  - `search` → `search_sync` → `run_search` sui byte di contenuto forniti.
  - Nessuna scansione del filesystem, nessun `fs_cache`.
- **Ramo file singolo (dipendente dal filesystem)**
  - `grep_sync` risolve il percorso, verifica che i metadati siano di tipo file, legge fino a `MAX_FILE_BYTES` per file (`4 MiB`) attraverso il matcher ripgrep.
- **Ramo directory (dipendente dal filesystem)**
  - Ricerca facoltativa nella cache tramite `fs_cache::get_or_scan` quando `cache: true`.
  - Scansione aggiornata tramite `fs_cache::force_rescan` quando `cache: false`.
  - Ricontrollo facoltativo del risultato vuoto quando l'età della cache supera `empty_recheck_ms()`.
  - Filtraggio delle voci: solo file + filtro glob opzionale (`glob_util`) + mappatura filtro tipo opzionale (`js`, `ts`, `rust`, ecc.).

### Semantica di ricerca/raccolta

- Motore regex: `grep_regex::RegexMatcherBuilder` con `ignoreCase` e `multiline`.
- Risoluzione del contesto:
  - `contextBefore/contextAfter` sovrascrivono il `context` legacy.
  - Le modalità non-content azzerano la raccolta del contesto.
- Modalità di output:
  - `content` => un `GrepMatch` per corrispondenza.
  - `count` e `filesWithMatches` mappano entrambi su voci in stile count (`lineNumber=0`, `line=""`, `matchCount` impostato).
- Limiti:
  - `offset` globale e `maxCount` applicati tra i file.
  - Il percorso parallelo viene usato solo quando `maxCount` non è impostato e `offset == 0`; altrimenti il percorso sequenziale preserva la semantica deterministica di offset/limite globale.

### Formattazione del risultato verso JS

- I campi Rust `SearchResult`/`GrepResult` mappano sui tipi TS tramite conversione dei campi oggetto N-API.
- I contatori vengono limitati a `u32` prima di attraversare N-API.
- I booleani opzionali vengono omessi a meno che non siano veri in alcuni percorsi (`limitReached`).
- Il callback in streaming riceve ogni `GrepMatch` formattato (voce di contenuto o conteggio).

### Comportamento in caso di errore

- `searchContent` restituisce `SearchResult.error` per errori di regex/ricerca invece di lanciare eccezioni.
- `grep` rifiuta in caso di errori gravi (percorso non valido, glob/regex non valido, timeout di cancellazione/interruzione).
- `hasMatch` restituisce `Result<bool>` e lancia eccezioni per errori di pattern non valido/decodifica UTF-8.
- Gli errori di apertura/ricerca file nelle scansioni multi-file vengono ignorati per ogni file; la scansione continua.

### Gestione di regex malformata

`grep.rs` sanifica le parentesi graffe prima della compilazione regex:

- Le parentesi graffe simili a ripetizioni non valide vengono escape (`{`/`}` -> `\{`/`\}`) quando non possono formare `{N}`, `{N,}`, `{N,M}`.
- Questo impedisce ai frammenti comuni di template letterale (ad esempio `${platform}`) di fallire come ripetizione malformata.
- La sintassi regex non valida rimanente restituisce ancora un errore regex.

## 2) Discovery dei file (`glob`) e ricerca fuzzy dei percorsi (`fuzzyFind`)

`glob` e `fuzzyFind` condividono le scansioni `fs_cache`; la logica di corrispondenza è diversa.

### Flusso `glob`

1. Wrapper TS (`glob/index.ts`):
   - `path.resolve(options.path)`.
   - Valori predefiniti: `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`.
2. Rust `glob` costruisce `GlobConfig` e compila il pattern tramite `glob_util::compile_glob`.
3. Sorgente delle voci:
   - `cache=true` => `get_or_scan` + eventuale `force_rescan` per voci vuote obsolete.
   - `cache=false` => `force_rescan(..., store=false)` (solo aggiornamento).
4. Filtraggio:
   - Salta sempre `.git`.
   - Salta `node_modules` a meno che non richiesto (`includeNodeModules` o pattern che menziona node_modules).
   - Applica la corrispondenza glob.
   - Applica il filtro per tipo di file; i filtri symlink `file/dir` risolvono i metadati del target.
5. Ordinamento opzionale per mtime decrescente (`sortByMtime`) prima di troncare a `maxResults`.

### Flusso `fuzzyFind` (implementato in `fd.rs`)

1. Il wrapper TS è esportato dal modulo `grep`, ma l'implementazione Rust si trova in `fd.rs`.
2. Sorgente di scansione condivisa da `fs_cache` con la stessa logica cache/no-cache e policy di ricontrollo per voci vuote obsolete.
3. Punteggio:
   - punteggio fuzzy basato su corrispondenza esatta / starts-with / contains / sottosequenza
   - percorso di punteggio normalizzato per separatori/punteggiatura
   - bonus directory e tie-break deterministico (`punteggio desc`, poi `percorso asc`)
4. Le voci symlink sono escluse dai risultati fuzzy.

### Comportamento in caso di errore

- Pattern glob non valido => errore da `glob_util::compile_glob`.
- La radice di ricerca deve essere una directory esistente (`resolve_search_path`), altrimenti errore.
- Cancellazione/timeout si propagano come errori di interruzione tramite controlli `CancelToken::heartbeat()` nei cicli.

### Gestione di glob malformato

`glob_util::build_glob_pattern` è tollerante:

- Normalizza `\` in `/`.
- Aggiunge automaticamente il prefisso `**/` ai pattern ricorsivi semplici quando `recursive=true`.
- Chiude automaticamente i gruppi di alternazione `{...` non bilanciati prima della compilazione.

## 3) Ciclo di vita della scansione/cache condivisa (`fs_cache`)

`fs_cache` memorizza i risultati di scansione come voci relative normalizzate (`path`, `fileType`, `mtime` opzionale) indicizzate per:

- radice di ricerca canonica
- `include_hidden`
- `use_gitignore`

### Transizioni di stato della cache

1. **Miss / disabilitata**
   - TTL è `0` o chiave assente/scaduta -> `collect_entries` aggiornato.
2. **Hit**
   - Età voce `< cache_ttl_ms()` -> restituisce le voci in cache + `cache_age_ms`.
3. **Ricontrollo per voci vuote obsolete** (policy chiamante in `glob`/`grep`/`fd`)
   - Se la query produce zero corrispondenze e `cache_age_ms >= empty_recheck_ms()`, forza una nuova scansione.
4. **Invalidazione**
   - `invalidateFsScanCache(path?)`:
     - nessun argomento: cancella tutte le chiavi
     - argomento path: rimuove le chiavi la cui radice è prefisso del percorso target

### Compromesso per risultati obsoleti

- La cache privilegia le scansioni ripetute a bassa latenza rispetto alla coerenza immediata.
- La finestra TTL può restituire positivi/negativi obsoleti.
- Il ricontrollo per risultati vuoti riduce i falsi negativi obsoleti per le scansioni in cache più vecchie, al costo di una scansione extra.
- L'invalidazione esplicita è il meccanismo di correttezza previsto dopo le mutazioni dei file.

## 4) Utilità per testo ANSI (`text`)

Si tratta di utilità pure in-memory (nessuna scansione del filesystem).

### Confini e responsabilità

- **`text.rs` gestisce la semantica delle celle terminale**:
  - Analisi delle sequenze ANSI
  - larghezza e slicing con consapevolezza dei grafemi
  - comportamento di wrap/truncate/sanitize
- **La troncatura delle righe in `grep.rs` (`maxColumns`) è separata**:
  - semplice troncatura ai confini dei caratteri delle righe corrispondenti con `...`
  - non preserva lo stato ANSI e non è consapevole della larghezza delle celle terminale

### Comportamenti principali

- `wrapTextWithAnsi`: esegue il wrap in base alla larghezza visibile, riportando i codici SGR attivi sulle righe mandate a capo.
- `truncateToWidth`: troncatura a celle visibili con policy per i puntini di sospensione (`Unicode`, `Ascii`, `Omit`), padding opzionale a destra e percorso veloce che restituisce la stringa JS originale se invariata.
- `sliceWithWidth`: slicing per colonna con applicazione opzionale della larghezza esatta.
- `extractSegments`: estrae i segmenti prima/dopo attorno a un overlay ripristinando lo stato ANSI per il segmento `after`.
- `sanitizeText`: rimuove escape ANSI e caratteri di controllo, elimina i surrogate isolati, normalizza CR/LF rimuovendo `\r`.
- `visibleWidth`: conta le celle terminale visibili (i tab usano `TAB_WIDTH` fisso dall'implementazione Rust).

### Comportamento in caso di errore

Le funzioni di testo restituiscono generalmente output trasformato deterministico; gli errori sono limitati ai confini di conversione delle stringhe JS (errori di conversione degli argomenti N-API).

## 5) Evidenziazione della sintassi (`highlight`)

`highlight.rs` è una trasformazione pura (nessun FS, nessuna cache).

### Flusso

1. Il wrapper inoltra `code`, `lang` opzionale e palette di colori ANSI.
2. Rust risolve la sintassi tramite:
   - ricerca per token/nome
   - ricerca per estensione
   - tabella alias di fallback (`ts/tsx/js -> JavaScript`, ecc.)
   - fallback alla sintassi plain text quando non risolta
3. Analizza ogni riga con `ParseState` di syntect e stack degli scope.
4. Mappa gli scope su 11 categorie semantiche di colore e inietta/ripristina i codici colore ANSI.

### Comportamento in caso di errore

- L'errore di analisi per riga non causa il fallimento della chiamata: quella riga viene aggiunta senza evidenziazione e l'elaborazione continua.
- Il linguaggio sconosciuto/non supportato torna alla sintassi plain text.

## Flussi di utilità pura vs dipendenti dal filesystem

| Flusso | Accesso al filesystem | Cache condivisa | Note |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | No | No | regex solo sui byte/stringa forniti |
| Funzioni del modulo `text` | No | No | solo ANSI/larghezza/sanificazione |
| Funzioni del modulo `highlight` | No | No | solo sintassi + colorazione ANSI |
| `glob` | Sì | Opzionale | scansioni directory + filtraggio glob |
| `fuzzyFind` | Sì | Opzionale | scansioni directory + punteggio fuzzy |
| `grep` (percorso file/dir) | Sì | Opzionale (modalità dir) | ripgrep sui file, filtri/callback opzionali |

## Riepilogo del ciclo di vita end-to-end

1. Il chiamante invoca il wrapper TS con opzioni tipizzate.
2. Il wrapper normalizza i valori predefiniti (in particolare `glob`) e li inoltra all'export `native.*`.
3. Rust valida/normalizza le opzioni e costruisce la configurazione del matcher/ricerca.
4. Per i flussi filesystem, le voci vengono scansionate (cache hit/miss/rescan) poi filtrate/valorizzate.
5. I cicli worker chiamano periodicamente il heartbeat di cancellazione; timeout/interruzione possono terminare l'esecuzione.
6. Rust formatta gli output in oggetti N-API (`lineNumber`, `matchCount`, `limitReached`, ecc.).
7. Il wrapper TS restituisce oggetti JS tipizzati (e callback opzionali per corrispondenza per `grep`/`glob`).
