---
title: Pipeline nativo di testo e ricerca
description: >-
  Pipeline di ricerca testuale nativa con indicizzazione del contenuto dei file
  basata su grep, glob e ripgrep.
sidebar:
  order: 6
  label: Pipeline di testo e ricerca
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# Pipeline nativo di testo/ricerca

Questo documento mappa la superficie di testo/ricerca (`grep`, `glob`, `text`, `highlight`) di `@f5xc-salesdemos/pi-natives` dai wrapper TypeScript alle esportazioni Rust N-API e di ritorno agli oggetti risultato JS.

La terminologia segue `docs/natives-architecture.md`:

- **Wrapper**: API TS in `packages/natives/src/*`
- **Livello modulo Rust**: esportazioni N-API in `crates/pi-natives/src/*`
- **Cache di scansione condivisa**: cache delle entry di directory supportata da `fs_cache` utilizzata dai flussi di discovery/ricerca

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

## Mappatura API JS ↔ esportazione Rust

| API wrapper JS | Esportazione Rust (`#[napi]`, snake_case -> camelCase) | Modulo Rust |
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

1. Il wrapper TS inoltra le opzioni al nativo:
   - `grep/index.ts` passa le `options` sostanzialmente invariate e adatta la callback da `(match) => void` alla forma di callback threadsafe napi `(err, match)`.
   - `searchContent` e `hasMatch` passano direttamente stringhe/`Uint8Array`.
2. Le struct delle opzioni Rust in `grep.rs` deserializzano i campi in camelCase (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`).
3. `grep` crea un `CancelToken` da `timeoutMs` + `AbortSignal` e viene eseguito all'interno di `task::blocking("grep", ...)`.

### Rami di esecuzione

- **Ramo in memoria (utility pura)**
  - `search` → `search_sync` → `run_search` sui byte del contenuto fornito.
  - Nessuna scansione del filesystem, nessun `fs_cache`.
- **Ramo file singolo (dipendente dal filesystem)**
  - `grep_sync` risolve il percorso, verifica che i metadati siano di un file, elabora fino a `MAX_FILE_BYTES` per file (`4 MiB`) attraverso il matcher ripgrep.
- **Ramo directory (dipendente dal filesystem)**
  - Lookup opzionale nella cache tramite `fs_cache::get_or_scan` quando `cache: true`.
  - Scansione fresca tramite `fs_cache::force_rescan` quando `cache: false`.
  - Ricontrollo opzionale dei risultati vuoti quando l'età della cache supera `empty_recheck_ms()`.
  - Filtraggio delle entry: solo file + filtro glob opzionale (`glob_util`) + mappatura opzionale del filtro per tipo (`js`, `ts`, `rust`, ecc.).

### Semantica di ricerca/raccolta

- Motore regex: `grep_regex::RegexMatcherBuilder` con `ignoreCase` e `multiline`.
- Risoluzione del contesto:
  - `contextBefore/contextAfter` sovrascrivono il legacy `context`.
  - Le modalità non-content azzerano la raccolta del contesto.
- Modalità di output:
  - `content` => un `GrepMatch` per ogni corrispondenza.
  - `count` e `filesWithMatches` mappano entrambi a entry di tipo conteggio (`lineNumber=0`, `line=""`, `matchCount` impostato).
- Limiti:
  - `offset` e `maxCount` globali applicati su tutti i file.
  - Il percorso parallelo è utilizzato solo quando `maxCount` non è impostato e `offset == 0`; altrimenti il percorso sequenziale preserva la semantica deterministica di offset/limite globale.

### Formattazione del risultato verso JS

- I campi di `SearchResult`/`GrepResult` in Rust mappano ai tipi TS tramite la conversione dei campi oggetto N-API.
- I contatori vengono limitati a `u32` prima di attraversare N-API.
- I booleani opzionali vengono omessi a meno che non siano true in alcuni percorsi (`limitReached`).
- La callback di streaming riceve ogni `GrepMatch` formattato (entry di contenuto o di conteggio).

### Comportamento in caso di errore

- `searchContent` restituisce `SearchResult.error` per errori di regex/ricerca invece di lanciare eccezioni.
- `grep` rifiuta su errori gravi (percorso non valido, glob/regex non valido, timeout/abort della cancellazione).
- `hasMatch` restituisce `Result<bool>` e lancia eccezione su pattern non valido o errori di decodifica UTF-8.
- Gli errori di apertura/ricerca file nelle scansioni multi-file vengono ignorati per singolo file; la scansione prosegue.

### Gestione delle regex malformate

`grep.rs` sanitizza le parentesi graffe prima della compilazione regex:

- Le parentesi graffe simili a ripetizioni non valide vengono escape (`{`/`}` -> `\{`/`\}`) quando non possono formare `{N}`, `{N,}`, `{N,M}`.
- Questo impedisce che frammenti comuni di template letterali (ad esempio `${platform}`) falliscano come ripetizioni malformate.
- La sintassi regex non valida rimanente restituisce comunque un errore regex.

## 2) Scoperta dei file (`glob`) e ricerca fuzzy dei percorsi (`fuzzyFind`)

`glob` e `fuzzyFind` condividono le scansioni `fs_cache`; la logica di matching differisce.

### Flusso di `glob`

1. Wrapper TS (`glob/index.ts`):
   - `path.resolve(options.path)`.
   - Valori predefiniti: `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`.
2. Rust `glob` costruisce `GlobConfig` e compila il pattern tramite `glob_util::compile_glob`.
3. Sorgente delle entry:
   - `cache=true` => `get_or_scan` + opzionale `force_rescan` per stale-empty.
   - `cache=false` => `force_rescan(..., store=false)` (solo fresco).
4. Filtraggio:
   - `.git` viene sempre ignorato.
   - `node_modules` viene ignorato a meno che non sia richiesto (`includeNodeModules` o pattern che menziona node_modules).
   - Applicazione della corrispondenza glob.
   - Applicazione del filtro per tipo di file; i filtri `file/dir` dei symlink risolvono i metadati del target.
5. Ordinamento opzionale per mtime decrescente (`sortByMtime`) prima del troncamento a `maxResults`.

### Flusso di `fuzzyFind` (implementato in `fd.rs`)

1. Il wrapper TS è esportato dal modulo `grep`, ma l'implementazione Rust risiede in `fd.rs`.
2. Sorgente di scansione condivisa da `fs_cache` con la stessa suddivisione cache/no-cache e la politica di ricontrollo stale-empty.
3. Punteggio:
   - punteggio fuzzy basato su esatto / inizia-con / contiene / sottosequenza
   - percorso di punteggio normalizzato per separatori/punteggiatura
   - bonus per directory e tie-break deterministico (`score desc`, poi `path asc`)
4. Le entry symlink sono escluse dai risultati fuzzy.

### Comportamento in caso di errore

- Pattern glob non valido => errore da `glob_util::compile_glob`.
- La radice di ricerca deve essere una directory esistente (`resolve_search_path`), altrimenti errore.
- Cancellazione/timeout si propagano come errori di abort tramite i controlli `CancelToken::heartbeat()` nei cicli.

### Gestione dei glob malformati

`glob_util::build_glob_pattern` è tollerante:

- Normalizza `\` in `/`.
- Prefissa automaticamente i pattern ricorsivi semplici con `**/` quando `recursive=true`.
- Chiude automaticamente i gruppi di alternazione `{...` non bilanciati prima della compilazione.

## 3) Ciclo di vita della scansione/cache condivisa (`fs_cache`)

`fs_cache` memorizza i risultati delle scansioni come entry relative normalizzate (`path`, `fileType`, `mtime` opzionale) indicizzate per:

- radice di ricerca canonica
- `include_hidden`
- `use_gitignore`

### Transizioni di stato della cache

1. **Miss / disabilitata**
   - Il TTL è `0` o la chiave è assente/scaduta -> `collect_entries` fresco.
2. **Hit**
   - Età della entry `< cache_ttl_ms()` -> restituisce le entry memorizzate + `cache_age_ms`.
3. **Ricontrollo stale-empty** (politica del chiamante in `glob`/`grep`/`fd`)
   - Se la query produce zero corrispondenze e `cache_age_ms >= empty_recheck_ms()`, forza una riscansione.
4. **Invalidazione**
   - `invalidateFsScanCache(path?)`:
     - senza argomento: cancella tutte le chiavi
     - con argomento path: rimuove le chiavi la cui radice è prefisso del percorso target

### Compromesso sui risultati obsoleti

- La cache favorisce la bassa latenza delle scansioni ripetute rispetto alla consistenza immediata.
- La finestra TTL può restituire falsi positivi/negativi obsoleti.
- Il ricontrollo dei risultati vuoti riduce i falsi negativi obsoleti per le scansioni memorizzate più vecchie al costo di una scansione aggiuntiva.
- L'invalidazione esplicita è il meccanismo di correttezza previsto dopo le mutazioni dei file.

## 4) Utility di testo ANSI (`text`)

Queste sono utility pure, in memoria (nessuna scansione del filesystem).

### Confini e responsabilità

- **`text.rs` gestisce la semantica delle celle terminale**:
  - Parsing delle sequenze ANSI
  - Larghezza e slicing consapevoli dei grafemi
  - Comportamento di wrap/troncamento/sanitizzazione
- **Il troncamento delle righe di `grep.rs` (`maxColumns`) è separato**:
  - Troncamento semplice ai confini dei caratteri delle righe con corrispondenze con `...`
  - Non preserva lo stato ANSI e non è consapevole della larghezza delle celle terminale

### Comportamenti principali

- `wrapTextWithAnsi`: esegue il wrap per larghezza visibile, trasportando i codici SGR attivi attraverso le righe wrappate.
- `truncateToWidth`: troncamento per celle visibili con politica di ellipsis (`Unicode`, `Ascii`, `Omit`), padding destro opzionale e fast-path che restituisce la stringa JS originale quando invariata.
- `sliceWithWidth`: slicing per colonna con applicazione opzionale della larghezza rigorosa.
- `extractSegments`: estrae i segmenti prima/dopo attorno a un overlay ripristinando lo stato ANSI per il segmento `after`.
- `sanitizeText`: rimuove gli escape ANSI + caratteri di controllo, elimina i surrogati isolati, normalizza CR/LF rimuovendo `\r`.
- `visibleWidth`: conta le celle terminale visibili (i tab usano un `TAB_WIDTH` fisso dall'implementazione Rust).

### Comportamento in caso di errore

Le funzioni di testo generalmente restituiscono output trasformato deterministico; gli errori sono limitati ai confini di conversione delle stringhe JS (errori di conversione degli argomenti N-API).

## 5) Evidenziazione della sintassi (`highlight`)

`highlight.rs` è una trasformazione pura (nessun FS, nessuna cache).

### Flusso

1. Il wrapper inoltra `code`, `lang` opzionale e la palette di colori ANSI.
2. Rust risolve la sintassi tramite:
   - lookup per token/nome
   - lookup per estensione
   - tabella di alias come fallback (`ts/tsx/js -> JavaScript`, ecc.)
   - fallback alla sintassi di testo semplice quando non risolta
3. Analizza ogni riga con `ParseState` di syntect e lo stack degli scope.
4. Mappa gli scope a 11 categorie semantiche di colore e inietta/resetta i codici colore ANSI.

### Comportamento in caso di errore

- Un errore di parsing per riga non fa fallire la chiamata: quella riga viene aggiunta senza evidenziazione e l'elaborazione prosegue.
- Un linguaggio sconosciuto/non supportato ricade sulla sintassi di testo semplice.

## Flussi di utility pura vs dipendenti dal filesystem

| Flusso | Accesso al filesystem | Cache condivisa | Note |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | No | No | Regex solo sui byte/stringa forniti |
| Funzioni del modulo `text` | No | No | Solo ANSI/larghezza/sanitizzazione |
| Funzioni del modulo `highlight` | No | No | Solo sintassi + colorazione ANSI |
| `glob` | Sì | Opzionale | Scansioni directory + filtraggio glob |
| `fuzzyFind` | Sì | Opzionale | Scansioni directory + punteggio fuzzy |
| `grep` (percorso file/dir) | Sì | Opzionale (modalità dir) | ripgrep sui file, filtri/callback opzionali |

## Riepilogo del ciclo di vita end-to-end

1. Il chiamante invoca il wrapper TS con opzioni tipizzate.
2. Il wrapper normalizza i valori predefiniti (in particolare `glob`) e inoltra all'esportazione `native.*`.
3. Rust valida/normalizza le opzioni e costruisce il matcher/configurazione di ricerca.
4. Per i flussi filesystem, le entry vengono scansionate (cache hit/miss/rescan) e poi filtrate/valutate.
5. I cicli dei worker chiamano periodicamente l'heartbeat di cancellazione; timeout/abort possono terminare l'esecuzione.
6. Rust formatta gli output in oggetti N-API (`lineNumber`, `matchCount`, `limitReached`, ecc.).
7. Il wrapper TS restituisce oggetti JS tipizzati (e callback opzionali per ogni corrispondenza per `grep`/`glob`).
