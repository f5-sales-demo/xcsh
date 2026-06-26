---
title: 'Runbook di build, rilascio e debug dei moduli nativi'
description: 'Runbook di build, rilascio e debug per l''addon nativo Rust su più piattaforme.'
sidebar:
  order: 8
  label: 'Build, rilascio e debug'
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# Runbook di build, rilascio e debug dei moduli nativi

Questo runbook descrive come la pipeline di build di `@f5-sales-demo/pi-natives` produce addon `.node`, come le distribuzioni compilate li caricano e come eseguire il debug degli errori del loader/build.

Segue i termini architetturali da `docs/natives-architecture.md`:

- **produzione di artefatti in fase di build** (`scripts/build-native.ts`)
- **generazione del manifesto addon incorporato** (`scripts/embed-native.ts`)
- **caricamento addon a runtime + gate di validazione** (`src/native.ts`)

## File di implementazione

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## Panoramica della pipeline di build

### 1) Entry point di build

Script di `packages/natives/package.json`:

- `bun scripts/build-native.ts` (`build`) → build in modalità release
- `bun scripts/build-native.ts --dev` (`dev:native`) → build con profilo debug/dev (stessa denominazione dell'output)
- `bun scripts/embed-native.ts` (`embed:native`) → genera `src/embedded-addon.ts` dai file compilati

### 2) Build dell'artefatto Rust

`build-native.ts` esegue Cargo in `crates/pi-natives`:

- comando base: `cargo build`
- la modalità release aggiunge `--release` a meno che non venga passato `--dev`
- il target cross aggiunge `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` dichiara `crate-type = ["cdylib"]`, quindi Cargo emette una libreria condivisa (`.so`/`.dylib`/`.dll`) che viene poi copiata/rinominata in un nome file addon `.node`.

### 3) Individuazione e installazione degli artefatti

Dopo il completamento di Cargo, `build-native.ts` scansiona le directory di output candidate nell'ordine seguente:

1. `${CARGO_TARGET_DIR}` (se impostato)
2. `<repo>/target`
3. `crates/pi-natives/target`

Per ogni root controlla le directory del profilo:

- build cross: `<root>/<crossTarget>/<profile>` poi `<root>/<profile>`
- build nativa: `<root>/<profile>`

Quindi cerca uno dei seguenti file:

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

Una volta trovato, viene installato atomicamente in `packages/natives/native/` con semantica temp-file + rename (il fallback Windows gestisce esplicitamente i fallimenti di sostituzione delle DLL bloccate).

## Modello target/variante e convenzioni di denominazione

## Tag di piattaforma

Sia la build che il runtime utilizzano il tag di piattaforma:

`<platform>-<arch>` (esempio: `darwin-arm64`, `linux-x64`)

## Modello di variante (solo x64)

x64 supporta varianti CPU:

- `modern` (percorso con supporto AVX2)
- `baseline` (fallback)

Le piattaforme non-x64 utilizzano un singolo artefatto predefinito (senza suffisso di variante).

### Nomi dei file di output

Build release:

- x64: `pi_natives.<platform>-<arch>-modern.node` oppure `...-baseline.node`
- non-x64: `pi_natives.<platform>-<arch>.node`

Build dev (`--dev`):

- Utilizza i flag del profilo debug ma mantiene la denominazione dell'output standard con tag di piattaforma

Ordine dei candidati nel loader a runtime in `native.ts`:

- candidati release
- la modalità compilata antepone i candidati estratti/dalla cache prima dei file locali del pacchetto

## Flag di ambiente e opzioni di build

## Flag a runtime

- `PI_DEV` (comportamento del loader): abilita la diagnostica del loader
- `PI_NATIVE_VARIANT` (comportamento del loader, solo x64): forza la selezione di `modern` o `baseline` a runtime
- `PI_COMPILED` (comportamento del loader): abilita il comportamento di candidato/estrazione per i binari compilati

## Flag/opzioni in fase di build

- `--dev` (argomento script): build con profilo debug
- `CROSS_TARGET`: passato a Cargo come `--target`
- `TARGET_PLATFORM`: sovrascrive la denominazione del tag di piattaforma nell'output
- `TARGET_ARCH`: sovrascrive la denominazione dell'arch nell'output
- `TARGET_VARIANT` (solo x64): forza `modern` o `baseline` per il nome del file di output e la policy di RUSTFLAGS
- `CARGO_TARGET_DIR`: root aggiuntiva durante la ricerca degli output di Cargo
- `RUSTFLAGS`:
  - se non impostato e non si effettua cross-compiling, lo script imposta:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - non-x64 / nessuna variante: `-C target-cpu=native`
  - se già impostato, lo script non lo sovrascrive

## Transizioni di stato/ciclo di vita della build

### Ciclo di vita della build (`build-native.ts`)

1. **Init**: analisi degli argomenti/variabili d'ambiente (`--dev`, override target, flag cross)
2. **Risoluzione variante**:
   - non-x64 → nessuna variante
   - x64 + `TARGET_VARIANT` → variante esplicita
   - x64 cross-build senza `TARGET_VARIANT` → errore hard
   - x64 build locale senza override → rilevamento AVX2 dell'host
3. **Compilazione**: esecuzione di Cargo con profilo/target risolti
4. **Individuazione artefatto**: scansione root target/directory profilo/nomi libreria
5. **Installazione**: copia + rename atomico in `packages/natives/native`
6. **Completamento**: addon pronto per i candidati del loader

In caso di errore, l'esecuzione termina in qualsiasi fase con un testo di errore esplicito (variante non valida, build cargo fallita, libreria di output mancante, errore di installazione/rename).

### Ciclo di vita dell'embedding (`embed-native.ts`)

1. **Init**: calcolo del tag di piattaforma da `TARGET_PLATFORM`/`TARGET_ARCH` o dai valori dell'host
2. **Set di candidati**:
   - x64 si aspetta sia `modern` che `baseline`
   - non-x64 si aspetta un file predefinito
3. **Validazione disponibilità** in `packages/natives/native`
4. **Generazione manifesto** (`src/embedded-addon.ts`) con import `file` di Bun e versione del pacchetto
5. **Estrazione a runtime pronta** per la modalità compilata

`--reset` bypassa la validazione e scrive uno stub manifesto null (`embeddedAddon = null`).

## Workflow di sviluppo locale vs comportamento shipped/compilato

## Workflow di sviluppo locale

Ciclo locale tipico:

1. Build dell'addon:
   - release: `bun --cwd=packages/natives run build`
   - profilo debug: `bun --cwd=packages/natives run dev:native`
2. Impostare `PI_DEV=1` durante il test della diagnostica del loader
3. Il loader in `native.ts` risolve i candidati nella directory `native/` locale del pacchetto (e il fallback nella directory dell'eseguibile)
4. `validateNative` impone la compatibilità degli export prima che i wrapper utilizzino il binding

## Workflow per binari shipped/compilati

In modalità compilata (`PI_COMPILED` o marker embedded di Bun):

1. Il loader calcola la directory cache versionata: `<getNativesDir()>/<packageVersion>` (operativamente `~/.xcsh/natives/<version>`)
2. Se il manifesto incorporato corrisponde alla piattaforma+versione corrente, il loader può estrarre il file incorporato selezionato in quella directory versionata
3. L'ordine dei candidati a runtime include:
   - directory cache versionata
   - directory legacy per binari compilati (`%LOCALAPPDATA%/xcsh` su Windows, `~/.local/bin` altrove)
   - directory del pacchetto/eseguibile
4. Il primo addon caricato con successo deve comunque superare `validateNative`

Per questo motivo il packaging e le aspettative del loader a runtime devono essere allineati: i nomi dei file, i tag di piattaforma e i simboli esportati devono corrispondere a ciò che `native.ts` sonda e valida.

## Mappatura API JS ↔ export Rust (sottoinsieme del gate di validazione)

`native.ts` richiede che questi export visibili in JS esistano sull'addon caricato. Sono mappati agli export N-API Rust in `crates/pi-natives/src`:

| Nome JS richiesto da `validateNative` | Dichiarazione export Rust | File sorgente Rust |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (export in camelCase) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

Se un simbolo richiesto è assente, il loader fallisce immediatamente con un suggerimento di rebuild.

## Comportamento in caso di errore e diagnostica

## Errori in fase di build

- Configurazione variante non valida:
  - `TARGET_VARIANT` impostato su non-x64 → errore immediato
  - x64 cross-build senza `TARGET_VARIANT` esplicito → errore immediato
- Errore di build Cargo:
  - lo script riporta il codice di uscita diverso da zero e stderr
- Artefatto non trovato:
  - lo script stampa ogni directory del profilo controllata
- Errore di installazione:
  - messaggio esplicito; su Windows include un suggerimento relativo ai file bloccati

## Errori del loader a runtime (`native.ts`)

- Tag di piattaforma non supportato:
  - lancia un'eccezione con la lista delle piattaforme supportate
- Nessun candidato è stato caricato con successo:
  - lancia un'eccezione con la lista completa degli errori dei candidati e suggerimenti di rimedio specifici per la modalità
- Export mancanti:
  - lancia un'eccezione con i nomi esatti dei simboli mancanti e il comando di rebuild
- Problemi di estrazione incorporata:
  - gli errori di mkdir/write durante l'estrazione vengono registrati e inclusi nella diagnostica finale

## Matrice di risoluzione dei problemi

| Sintomo | Causa probabile | Verifica | Soluzione |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | Binario `.node` non aggiornato, mancata corrispondenza del nome export Rust, o binario errato caricato | Eseguire con `PI_DEV=1` per vedere il percorso caricato; ispezionare la lista degli export per quel file | Ricompilare con `build`; assicurarsi che il nome dell'export Rust `#[napi]` (o l'alias esplicito se necessario) corrisponda alla chiave JS; rimuovere i file cache/versionati non aggiornati |
| La macchina x64 carica baseline quando si aspetta modern | `PI_NATIVE_VARIANT=baseline`, AVX2 non rilevato, o solo il file baseline presente | Controllare `PI_NATIVE_VARIANT`; ispezionare `native/` per il file `-modern` | Compilare la variante modern (`TARGET_VARIANT=modern ... build`) e assicurarsi che il file sia distribuito |
| La cross-build produce un binario inutilizzabile/etichettato erroneamente | Mancata corrispondenza tra `CROSS_TARGET` e `TARGET_PLATFORM`/`TARGET_ARCH`, o `TARGET_VARIANT` mancante per x64 | Verificare la tupla delle variabili d'ambiente e il nome del file di output | Rieseguire con valori di ambiente coerenti e `TARGET_VARIANT` x64 esplicito |
| Il binario compilato fallisce dopo un aggiornamento | Cache estratta non aggiornata (`~/.xcsh/natives/<versione-vecchia-o-non-corrispondente>`) o mancata corrispondenza del manifesto incorporato | Ispezionare la directory natives versionata e la lista degli errori del loader | Eliminare la cache natives versionata per la versione del pacchetto e rieseguire; rigenerare il manifesto incorporato durante il packaging |
| Il loader sonda molti percorsi e nessuno funziona | Mancata corrispondenza di piattaforma o artefatto release mancante in `native/` del pacchetto | Controllare `platformTag` rispetto ai nomi dei file effettivi | Assicurarsi che il nome del file compilato corrisponda esattamente alla convenzione `pi_natives.<platform>-<arch>(-variant).node` e che il pacchetto includa `native/` |
| `embed:native` fallisce con "Incomplete native addons" | I file di variante richiesti non sono stati compilati prima dell'embedding | Controllare la lista expected vs found nel testo dell'errore | Compilare prima i file richiesti (x64: sia modern che baseline; non-x64: predefinito), poi rieseguire `embed:native` |

## Comandi operativi

```bash
# Artefatto release per l'host corrente
bun --cwd=packages/natives run build

# Build artefatto con profilo debug
bun --cwd=packages/natives run dev:native

# Compilazione varianti x64 esplicite
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# Generazione del manifesto addon incorporato dai file nativi compilati
bun --cwd=packages/natives run embed:native

# Reset del manifesto incorporato a stub null
bun --cwd=packages/natives run embed:native -- --reset
```
