---
title: 'Runbook di compilazione, rilascio e debug dei nativi'
description: >-
  Runbook di compilazione, rilascio e debug per l'addon nativo Rust su tutte le
  piattaforme.
sidebar:
  order: 8
  label: 'Compilazione, rilascio e debug'
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# Runbook di compilazione, rilascio e debug dei nativi

Questo runbook descrive come la pipeline di build di `@f5xc-salesdemos/pi-natives` produce gli addon `.node`, come le distribuzioni compilate li caricano e come eseguire il debug dei fallimenti del loader/build.

Segue i termini architetturali di `docs/natives-architecture.md`:

- **produzione degli artefatti in fase di build** (`scripts/build-native.ts`)
- **generazione del manifesto degli addon incorporati** (`scripts/embed-native.ts`)
- **caricamento degli addon a runtime + gate di validazione** (`src/native.ts`)

## File di implementazione

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## Panoramica della pipeline di build

### 1) Punti di ingresso del build

Script in `packages/natives/package.json`:

- `bun scripts/build-native.ts` (`build`) → build di rilascio
- `bun scripts/build-native.ts --dev` (`dev:native`) → build con profilo debug/dev (stessa convenzione di denominazione dell'output)
- `bun scripts/embed-native.ts` (`embed:native`) → genera `src/embedded-addon.ts` dai file compilati

### 2) Build dell'artefatto Rust

`build-native.ts` esegue Cargo in `crates/pi-natives`:

- comando base: `cargo build`
- la modalità release aggiunge `--release` a meno che non venga passato `--dev`
- il target cross aggiunge `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` dichiara `crate-type = ["cdylib"]`, quindi Cargo emette una libreria condivisa (`.so`/`.dylib`/`.dll`) che viene poi copiata/rinominata con un nome file di addon `.node`.

### 3) Individuazione e installazione dell'artefatto

Dopo il completamento di Cargo, `build-native.ts` analizza le directory di output candidate in ordine:

1. `${CARGO_TARGET_DIR}` (se impostato)
2. `<repo>/target`
3. `crates/pi-natives/target`

Per ogni radice controlla le directory del profilo:

- build cross: `<root>/<crossTarget>/<profile>` poi `<root>/<profile>`
- build nativo: `<root>/<profile>`

Poi cerca uno tra:

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

Quando trovato, installa atomicamente in `packages/natives/native/` con semantica di file temporaneo + rinomina (il fallback per Windows gestisce esplicitamente i fallimenti di sostituzione di DLL bloccate).

## Modello di target/variante e convenzioni di denominazione

## Tag piattaforma

Sia il build che il runtime utilizzano il tag piattaforma:

`<platform>-<arch>` (esempio: `darwin-arm64`, `linux-x64`)

## Modello di variante (solo x64)

x64 supporta varianti CPU:

- `modern` (percorso con supporto AVX2)
- `baseline` (fallback)

Le architetture non-x64 utilizzano un singolo artefatto predefinito (senza suffisso di variante).

### Nomi dei file di output

Build di rilascio:

- x64: `pi_natives.<platform>-<arch>-modern.node` o `...-baseline.node`
- non-x64: `pi_natives.<platform>-<arch>.node`

Build dev (`--dev`):

- Utilizza i flag del profilo debug ma mantiene la denominazione standard dell'output con tag piattaforma

Ordine dei candidati del loader a runtime in `native.ts`:

- candidati di rilascio
- la modalità compilata antepone i candidati estratti/cache prima dei file locali al pacchetto

## Flag d'ambiente e opzioni di build

## Flag a runtime

- `PI_DEV` (comportamento del loader): abilita la diagnostica del loader
- `PI_NATIVE_VARIANT` (comportamento del loader, solo x64): forza la selezione `modern` o `baseline` a runtime
- `PI_COMPILED` (comportamento del loader): abilita il comportamento di candidato/estrazione per binari compilati

## Flag/opzioni in fase di build

- `--dev` (argomento script): compila con profilo debug
- `CROSS_TARGET`: passato a Cargo `--target`
- `TARGET_PLATFORM`: sovrascrive la denominazione del tag piattaforma nell'output
- `TARGET_ARCH`: sovrascrive la denominazione dell'architettura nell'output
- `TARGET_VARIANT` (solo x64): forza `modern` o `baseline` per il nome del file di output e la politica RUSTFLAGS
- `CARGO_TARGET_DIR`: radice aggiuntiva nella ricerca degli output di Cargo
- `RUSTFLAGS`:
  - se non impostato e non in cross-compilazione, lo script imposta:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - non-x64 / nessuna variante: `-C target-cpu=native`
  - se già impostato, lo script non sovrascrive

## Transizioni di stato/ciclo di vita del build

### Ciclo di vita del build (`build-native.ts`)

1. **Inizializzazione**: analisi degli argomenti/env (`--dev`, override del target, flag cross)
2. **Risoluzione della variante**:
   - non-x64 → nessuna variante
   - x64 + `TARGET_VARIANT` → variante esplicita
   - x64 cross-build senza `TARGET_VARIANT` → errore fatale
   - x64 build locale senza override → rilevamento AVX2 dell'host
3. **Compilazione**: esecuzione di Cargo con profilo/target risolti
4. **Localizzazione dell'artefatto**: scansione delle radici target/directory profilo/nomi libreria
5. **Installazione**: copia + rinomina atomica in `packages/natives/native`
6. **Completamento**: addon pronto per i candidati del loader

I fallimenti con uscita avvengono in qualsiasi fase con testo di errore esplicito (variante non valida, build cargo fallito, libreria di output mancante, fallimento di installazione/rinomina).

### Ciclo di vita dell'embedding (`embed-native.ts`)

1. **Inizializzazione**: calcolo del tag piattaforma da `TARGET_PLATFORM`/`TARGET_ARCH` o valori dell'host
2. **Set di candidati**:
   - x64 si aspetta sia `modern` che `baseline`
   - non-x64 si aspetta un singolo file predefinito
3. **Validazione della disponibilità** in `packages/natives/native`
4. **Generazione del manifesto** (`src/embedded-addon.ts`) con import `file` di Bun e versione del pacchetto
5. **Estrazione a runtime pronta** per la modalità compilata

`--reset` bypassa la validazione e scrive uno stub di manifesto nullo (`embeddedAddon = null`).

## Flusso di lavoro dev vs comportamento distribuito/compilato

## Flusso di lavoro di sviluppo locale

Ciclo locale tipico:

1. Compilare l'addon:
   - rilascio: `bun --cwd=packages/natives run build`
   - profilo debug: `bun --cwd=packages/natives run dev:native`
2. Impostare `PI_DEV=1` quando si testa la diagnostica del loader
3. Il loader in `native.ts` risolve i candidati locali al pacchetto in `native/` (e il fallback della directory dell'eseguibile)
4. `validateNative` applica la compatibilità degli export prima che i wrapper utilizzino il binding

## Flusso di lavoro del binario distribuito/compilato

In modalità compilata (`PI_COMPILED` o marcatori embedded di Bun):

1. Il loader calcola la directory cache con versione: `<getNativesDir()>/<packageVersion>` (operativamente `~/.xcsh/natives/<version>`)
2. Se il manifesto embedded corrisponde alla piattaforma+versione corrente, il loader può estrarre il file embedded selezionato in quella directory con versione
3. L'ordine dei candidati a runtime include:
   - directory cache con versione
   - directory legacy del binario compilato (`%LOCALAPPDATA%/xcsh` su Windows, `~/.local/bin` altrove)
   - directory del pacchetto/eseguibile
4. Il primo addon caricato con successo deve comunque superare `validateNative`

Ecco perché le aspettative del packaging e del loader a runtime devono essere allineate: i nomi dei file, i tag piattaforma e i simboli esportati devono corrispondere a ciò che `native.ts` verifica e valida.

## Mappatura API JS ↔ export Rust (sottoinsieme del gate di validazione)

`native.ts` richiede che questi export visibili da JS esistano sull'addon caricato. Corrispondono agli export N-API Rust in `crates/pi-natives/src`:

| Nome JS richiesto da `validateNative` | Dichiarazione export Rust | File sorgente Rust |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (export in camelCase) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

Se un qualsiasi simbolo richiesto manca, il loader fallisce immediatamente con un suggerimento di ricompilazione.

## Comportamento in caso di errore e diagnostica

## Errori in fase di build

- Configurazione della variante non valida:
  - `TARGET_VARIANT` impostato su non-x64 → errore immediato
  - cross-build x64 senza `TARGET_VARIANT` esplicito → errore immediato
- Fallimento del build Cargo:
  - lo script mostra il codice di uscita non-zero e lo stderr
- Artefatto non trovato:
  - lo script stampa ogni directory di profilo controllata
- Fallimento dell'installazione:
  - messaggio esplicito; su Windows include un suggerimento per file bloccati

## Errori del loader a runtime (`native.ts`)

- Tag piattaforma non supportato:
  - lancia un'eccezione con la lista delle piattaforme supportate
- Nessun candidato caricabile:
  - lancia un'eccezione con la lista completa degli errori dei candidati e suggerimenti di rimedio specifici per la modalità
- Export mancanti:
  - lancia un'eccezione con i nomi esatti dei simboli mancanti e il comando di ricompilazione
- Problemi di estrazione embedded:
  - gli errori di mkdir/write dell'estrazione vengono registrati e inclusi nella diagnostica finale

## Matrice di risoluzione dei problemi

| Sintomo | Causa probabile | Verifica | Soluzione |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | Binario `.node` obsoleto, mismatch nel nome dell'export Rust, o binario errato caricato | Eseguire con `PI_DEV=1` per vedere il percorso caricato; ispezionare la lista degli export per quel file | Ricompilare con `build`; assicurarsi che il nome dell'export `#[napi]` di Rust (o l'alias esplicito quando necessario) corrisponda alla chiave JS; rimuovere i file obsoleti nella cache/con versione |
| La macchina x64 carica baseline quando ci si aspetta modern | `PI_NATIVE_VARIANT=baseline`, AVX2 non rilevato, o solo il file baseline presente | Controllare `PI_NATIVE_VARIANT`; ispezionare `native/` per il file `-modern` | Compilare la variante modern (`TARGET_VARIANT=modern ... build`) e assicurarsi che il file sia distribuito |
| Il cross-build produce un binario inutilizzabile/con etichetta errata | Mismatch tra `CROSS_TARGET` e `TARGET_PLATFORM`/`TARGET_ARCH`, o `TARGET_VARIANT` mancante per x64 | Confermare la tupla env e il nome del file di output | Rieseguire con valori env coerenti e `TARGET_VARIANT` esplicito per x64 |
| Il binario compilato fallisce dopo un aggiornamento | Cache estratta obsoleta (`~/.xcsh/natives/<old-or-mismatched-version>`) o mismatch del manifesto embedded | Ispezionare la directory natives con versione e la lista degli errori del loader | Eliminare la cache natives con versione per la versione del pacchetto e rieseguire; rigenerare il manifesto embedded durante il packaging |
| Il loader verifica molti percorsi e nessuno funziona | Mismatch di piattaforma o artefatto di rilascio mancante nella directory `native/` del pacchetto | Controllare `platformTag` rispetto ai nomi file effettivi | Assicurarsi che il nome del file compilato corrisponda esattamente alla convenzione `pi_natives.<platform>-<arch>(-variant).node` e che il pacchetto includa `native/` |
| `embed:native` fallisce con "Incomplete native addons" | I file delle varianti richieste non sono stati compilati prima dell'embedding | Controllare la lista attesi vs trovati nel testo dell'errore | Compilare prima i file richiesti (x64: sia modern+baseline; non-x64: predefinito), poi rieseguire `embed:native` |

## Comandi operativi

```bash
# Artefatto di rilascio per l'host corrente
bun --cwd=packages/natives run build

# Build con profilo debug
bun --cwd=packages/natives run dev:native

# Compilare varianti x64 esplicite
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# Generare il manifesto degli addon embedded dai file nativi compilati
bun --cwd=packages/natives run embed:native

# Ripristinare il manifesto embedded a uno stub nullo
bun --cwd=packages/natives run embed:native -- --reset
```
