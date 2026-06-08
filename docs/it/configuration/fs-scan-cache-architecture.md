---
title: Architettura della cache di scansione del filesystem
description: >-
  Contratto della cache di scansione del filesystem per il rilevamento rapido
  dei file con semantica stale-while-revalidate.
sidebar:
  order: 8
  label: Cache di scansione del filesystem
i18n:
  sourceHash: 2a2bde1726ac
  translator: machine
---

# Contratto dell'architettura della cache di scansione del filesystem

Questo documento definisce il contratto corrente per la cache di scansione del filesystem condivisa, implementata in Rust (`crates/pi-natives/src/fs_cache.rs`) e utilizzata dalle API native di discovery/ricerca esposte a `packages/coding-agent`.

## Cos'è questa cache

La cache memorizza liste complete di entry da scansione di directory (`GlobMatch[]`) indicizzate per ambito di scansione e policy di attraversamento, consentendo poi alle operazioni di livello superiore (filtraggio glob, scoring fuzzy, selezione file grep) di operare su tali entry memorizzate.

Obiettivi principali:

- evitare scansioni ripetute del filesystem per chiamate ripetute di discovery/ricerca
- mantenere la coerenza tra `glob`, `fuzzyFind` e `grep` quando condividono la stessa policy di scansione
- consentire il recupero esplicito da risultati obsoleti per risultati vuoti e l'invalidazione esplicita dopo mutazioni dei file

## Ownership e superficie pubblica

- Implementazione della cache e policy: `crates/pi-natives/src/fs_cache.rs`
- Consumer nativi:
  - `crates/pi-natives/src/glob.rs`
  - `crates/pi-natives/src/fd.rs` (`fuzzyFind`)
  - `crates/pi-natives/src/grep.rs`
- Binding/export JS:
  - `packages/natives/src/glob/index.ts` (`invalidateFsScanCache`)
  - `packages/natives/src/glob/types.ts`
  - `packages/natives/src/grep/types.ts`
- Helper di invalidazione per mutazioni nel coding-agent:
  - `packages/coding-agent/src/tools/fs-cache-invalidation.ts`

## Partizionamento della chiave di cache (contratto vincolante)

Ogni entry è indicizzata da:

- percorso della directory `root` canonicalizzato
- booleano `include_hidden`
- booleano `use_gitignore`

Implicazioni:

- Le scansioni con e senza file nascosti **non** condividono le entry.
- Le scansioni che rispettano gitignore e quelle con ignore disabilitato **non** condividono le entry.
- I consumer devono passare semantiche stabili per il comportamento hidden/gitignore; cambiare uno dei due flag crea una partizione di cache diversa.

L'inclusione di `node_modules` **non** fa parte della chiave di cache. La cache memorizza le entry con `node_modules` incluso; il filtraggio specifico per consumer viene applicato dopo il recupero.

## Comportamento della raccolta durante la scansione

Il popolamento della cache utilizza un walker deterministico (`ignore::WalkBuilder`) configurato da `include_hidden` e `use_gitignore`:

- `follow_links(false)`
- ordinamento per percorso del file
- `.git` viene sempre ignorato
- `node_modules` viene sempre raccolto al momento della scansione della cache (e opzionalmente filtrato successivamente)
- il tipo di file dell'entry e `mtime` vengono acquisiti tramite `symlink_metadata`

Le radici di ricerca vengono risolte da `resolve_search_path`:

- i percorsi relativi vengono risolti rispetto alla cwd corrente
- il target deve essere una directory esistente
- la radice viene canonicalizzata quando possibile

## Policy di freschezza ed eviction

Policy globale (sovrascrivibile tramite variabili d'ambiente):

- `FS_SCAN_CACHE_TTL_MS` (default `1000`)
- `FS_SCAN_EMPTY_RECHECK_MS` (default `200`)
- `FS_SCAN_CACHE_MAX_ENTRIES` (default `16`)

Comportamento:

- `get_or_scan(...)`
  - se il TTL è `0`: bypassa completamente la cache, scansione sempre fresca (`cache_age_ms = 0`)
  - in caso di cache hit entro il TTL: restituisce le entry memorizzate + `cache_age_ms` diverso da zero
  - in caso di hit scaduto: rimuove la chiave, riscansiona, memorizza entry fresca
- l'applicazione del limite massimo di entry avviene tramite eviction oldest-first per `created_at`

## Ricontrollo rapido per risultati vuoti (separato dagli hit normali)

Cache hit normale:

- un cache hit entro il TTL restituisce le entry memorizzate e non fa nient'altro.

Ricontrollo rapido per risultati vuoti:

- questa è una policy **lato chiamante** che utilizza `ScanResult.cache_age_ms`
- se il risultato filtrato/della query è vuoto e l'età della scansione memorizzata è almeno `empty_recheck_ms()`, il chiamante esegue un `force_rescan(...)` e riprova
- pensato per ridurre i risultati negativi obsoleti quando i file sono stati aggiunti di recente ma la cache è ancora entro il TTL

Consumer attuali:

- `glob`: ricontrolla quando le corrispondenze filtrate sono vuote e l'età della scansione supera la soglia
- `fuzzyFind` (`fd.rs`): ricontrolla solo quando la query non è vuota e le corrispondenze con scoring sono vuote
- `grep`: ricontrolla quando la lista di file candidati selezionati è vuota

## Impostazioni predefinite dei consumer e utilizzo della cache

La cache è opt-in su tutte le API esposte (`cache?: boolean`, default `false`).

Impostazioni predefinite attuali nelle API native:

- `glob`: `hidden=false`, `gitignore=true`, `cache=false`
- `fuzzyFind`: `hidden=false`, `gitignore=true`, `cache=false`
- `grep`: `hidden=true`, `cache=false`, e la scansione della cache utilizza sempre `use_gitignore=true`

Chiamanti del coding-agent oggi:

- Il rilevamento ad alto volume di candidati per le menzioni abilita la cache:
  - `packages/coding-agent/src/utils/file-mentions.ts`
  - profilo: `hidden=true`, `gitignore=true`, `includeNodeModules=true`, `cache=true`
- L'integrazione di `grep` a livello di tool attualmente disabilita la cache di scansione (`cache: false`):
  - `packages/coding-agent/src/tools/grep.ts`

## Contratto di invalidazione

Entrypoint nativo di invalidazione:

- `invalidateFsScanCache(path?: string)`
  - con `path`: rimuove le entry della cache la cui radice è un prefisso del percorso target
  - senza path: cancella tutte le entry della cache di scansione

Dettagli sulla gestione dei percorsi:

- i percorsi di invalidazione relativi vengono risolti rispetto alla cwd
- l'invalidazione tenta la canonicalizzazione
- se il target non esiste (es. cancellazione), il fallback canonicalizza il genitore e riattacca il nome del file quando possibile
- questo preserva il comportamento di invalidazione per creazione/cancellazione/rinomina dove uno dei due lati potrebbe non esistere

## Responsabilità del flusso di mutazione del coding-agent

Il codice del coding-agent deve invalidare dopo mutazioni del filesystem avvenute con successo.

Helper centrali:

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)` (invalida entrambi i lati quando i percorsi differiscono)

Callsite attuali dei tool di mutazione:

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts` (flussi hashline/patch/replace)

Regola: se un flusso muta il contenuto o la posizione nel filesystem e bypassa questi helper, sono attesi bug di obsolescenza della cache.

## Aggiungere un nuovo consumer della cache in modo sicuro

Quando si introduce l'uso della cache in un nuovo percorso di scansione/ricerca:

1. **Utilizzare input stabili per la policy di scansione**
   - decidere prima la semantica hidden/gitignore
   - passarli in modo coerente a `get_or_scan`/`force_rescan` affinché le partizioni della cache siano intenzionali

2. **Trattare i dati della cache come pre-filtrati solo dalla policy di attraversamento**
   - applicare il filtraggio specifico del tool (pattern glob, filtri di tipo, regole node_modules) dopo il recupero
   - non assumere mai che le entry memorizzate riflettano già i propri filtri di livello superiore

3. **Implementare il ricontrollo rapido per risultati vuoti solo per rischio di risultati negativi obsoleti**
   - utilizzare `scan.cache_age_ms >= empty_recheck_ms()`
   - riprovare una volta con `force_rescan(..., store=true, ...)`
   - mantenere questo percorso separato dalla logica di cache-hit normale

4. **Rispettare esplicitamente la modalità no-cache**
   - quando il chiamante disabilita la cache, chiamare `force_rescan(..., store=false, ...)`
   - non popolare la cache condivisa in un percorso di richiesta no-cache

5. **Collegare l'invalidazione per mutazione per ogni nuovo percorso di scrittura**
   - dopo una scrittura/modifica/cancellazione/rinomina riuscita, chiamare l'helper di invalidazione del coding-agent
   - per rinomina/spostamento, invalidare sia il vecchio che il nuovo percorso

6. **Non aggiungere controlli TTL per singola chiamata**
   - il contratto attuale prevede solo policy globale (configurata tramite variabili d'ambiente), nessun override TTL per richiesta

## Limiti noti

- L'ambito della cache è in-memory e locale al processo (`DashMap`), non viene persistita tra riavvii del processo.
- La cache memorizza entry di scansione, non risultati finali dei tool.
- `glob`/`fuzzyFind`/`grep` condividono le entry di scansione solo quando le dimensioni chiave (`root`, `hidden`, `gitignore`) corrispondono.
- `.git` viene sempre escluso al momento della raccolta della scansione, indipendentemente dalle opzioni del chiamante.
