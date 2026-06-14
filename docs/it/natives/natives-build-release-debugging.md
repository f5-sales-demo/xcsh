---
title: 'Runbook di build, release e debugging per i Nativi'
description: >-
  Runbook di build, release e debugging per il componente nativo Rust su tutte
  le piattaforme.
sidebar:
  order: 8
  label: 'Build, release e debugging'
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# Runbook di build, release e debugging per i Nativi

Questo runbook descrive come la pipeline di build di `@f5xc-salesdemos/pi-natives` produce i componenti aggiuntivi `.node`, come le distribuzioni compilate li caricano e come eseguire il debug degli errori del loader/build.

Segue i termini architetturali di `docs/natives-architecture.md`:

- **produzione degli artefatti in fase di build** (`scripts/build-native.ts`)
- **generazione del manifest del componente aggiuntivo incorporato** (`scripts/embed-native.ts`)
- **caricamento del componente aggiuntivo a runtime + gate di validazione** (`src/native.ts`)

## File di implementazione

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## Panoramica della pipeline di build

### 1) Entrypoint di build

Script in `packages/natives/package.json`:

- `bun scripts/build-native.ts` (`build`) → build di rilascio
- `bun scripts/build-native.ts --dev` (`dev:native`) → build con profilo debug/dev (stessa denominazione dell'output)
- `bun scripts/embed-native.ts` (`embed:native`) → genera `src/embedded-addon.ts` dai file compilati

### 2) Build dell'artefatto Rust

`build-native.ts` esegue Cargo in `crates/pi-natives`:

- comando base: `cargo build`
- la modalità release aggiunge `--release` a meno che non venga passato `--dev`
- il target cross aggiunge `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` dichiara `crate-type = ["cdylib"]`, quindi Cargo emette una libreria condivisa (`.so`/`.dylib`/`.dll`) che viene poi copiata/rinominata con il nome file di un componente aggiuntivo `.node`.

### 3) Rilevamento e installazione degli artefatti

Dopo il completamento di Cargo, `build-native.ts` analizza le directory di output candidate nell'ordine seguente:

1. `${CARGO_TARGET_DIR}` (se impostata)
2. `<repo>/target`
3. `crates/pi-natives/target`

Per ciascuna radice, verifica le directory del profilo:

- build cross: `<root>/<crossTarget>/<profile>` poi `<root>/<profile>`
- build nativa: `<root>/<profile>`

Quindi cerca uno dei seguenti file:

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

Una volta trovato, esegue l'installazione atomica in `packages/natives/native/` con semantica di file temporaneo + rinomina (il fallback per Windows gestisce esplicitamente i fallimenti di sostituzione di DLL bloccate).

## Modello target/variante e convenzioni di denominazione

## Tag di piattaforma

Sia la build che il runtime utilizzano il tag di piattaforma:

`<platform>-<arch>` (esempio: `darwin-arm64`, `linux-x64`)

## Modello di variante (solo x64)

x64 supporta varianti CPU:

- `modern` (percorso abilitato AVX2)
- `baseline` (fallback)

Le architetture diverse da x64 utilizzano un singolo artefatto predefinito (nessun suffisso di variante).

### Nomi dei file di output

Build di rilascio:

- x64: `pi_natives.<platform>-<arch>-modern.node` oppure `...-baseline.node`
- non-x64: `pi_natives.<platform>-<arch>.node`

Build dev (`--dev`):

- Utilizza i flag del profilo debug ma mantiene la denominazione dell'output standard con tag di piattaforma

Ordine dei candidati del loader a runtime in `native.ts`:

- candidati di rilascio
- la modalità compilata antepone i candidati estratti/dalla cache prima dei file locali al pacchetto

## Flag di ambiente e opzioni di build

## Flag a runtime

- `PI_DEV` (comportamento del loader): abilita i diagnostici del loader
- `PI_NATIVE_VARIANT` (comportamento del loader, solo x64): forza la selezione di `modern` o `baseline` a runtime
- `PI_COMPILED` (comportamento del loader): abilita il comportamento di candidato/estrazione per i binari compilati

## Flag/opzioni in fase di build

- `--dev` (argomento dello script): build del profilo debug
- `CROSS_TARGET`: passato a Cargo con `--target`
- `TARGET_PLATFORM`: sovrascrive la denominazione del tag di piattaforma nell'output
- `TARGET_ARCH`: sovrascrive la denominazione dell'architettura nell'output
- `TARGET_VARIANT` (solo x64): forza `modern` o `baseline` per il nome del file di output e la policy RUSTFLAGS
- `CARGO_TARGET_DIR`: radice aggiuntiva nella ricerca degli output di Cargo
- `RUSTFLAGS`:
  - se non impostato e non si sta eseguendo una cross-compilazione, lo script imposta:
    - modern: `-C target-cpu=x86-64-v3`
    - baseline: `-C target-cpu=x86-64-v2`
    - non-x64 / nessuna variante: `-C target-cpu=native`
  - se già impostato, lo script non sovrascrive

## Transizioni di stato/ciclo di vita della build

### Ciclo di vita della build (`build-native.ts`)

1. **Init**: analisi degli argomenti/env (`--dev`, override dei target, flag di cross)
2. **Risoluzione della variante**:
   - non-x64 → nessuna variante
   - x64 + `TARGET_VARIANT` → variante esplicita
   - x64 cross-build senza `TARGET_VARIANT` → errore critico
   - x64 build locale senza override → rilevamento AVX2 sull'host
3. **Compilazione**: esecuzione di Cargo con profilo/target risolti
4. **Localizzazione dell'artefatto**: analisi delle radici target/directory del profilo/nomi delle librerie
5. **Installazione**: copia + rinomina atomica in `packages/natives/native`
6. **Completamento**: componente aggiuntivo pronto per i candidati del loader

Gli errori causano l'uscita in qualsiasi fase con testo di errore esplicito (variante non valida, build Cargo fallita, libreria di output mancante, errore di installazione/rinomina).

### Ciclo di vita dell'embed (`embed-native.ts`)

1. **Init**: calcolo del tag di piattaforma da `TARGET_PLATFORM`/`TARGET_ARCH` o dai valori dell'host
2. **Set di candidati**:
   - x64 si aspetta sia `modern` che `baseline`
   - non-x64 si aspetta un singolo file predefinito
3. **Validazione della disponibilità** in `packages/natives/native`
4. **Generazione del manifest** (`src/embedded-addon.ts`) con import `file` di Bun e versione del pacchetto
5. **Estrazione a runtime pronta** per la modalità compilata

`--reset` bypassa la validazione e scrive uno stub manifest nullo (`embeddedAddon = null`).

## Workflow di sviluppo locale vs comportamento distribuito/compilato

## Workflow di sviluppo locale

Ciclo locale tipico:

1. Build del componente aggiuntivo:
   - rilascio: `bun --cwd=packages/natives run build`
   - profilo debug: `bun --cwd=packages/natives run dev:native`
2. Impostare `PI_DEV=1` durante il test dei diagnostici del loader
3. Il loader in `native.ts` risolve i candidati `native/` locali al pacchetto (e il fallback nella directory dell'eseguibile)
4. `validateNative` applica la compatibilità degli export prima che i wrapper utilizzino il binding

## Workflow per binari distribuiti/compilati

In modalità compilata (`PI_COMPILED` o marker incorporati di Bun):

1. Il loader calcola la directory di cache con versione: `<getNativesDir()>/<packageVersion>` (operativamente `~/.xcsh/natives/<version>`)
2. Se il manifest incorporato corrisponde alla piattaforma+versione corrente, il loader può estrarre il file incorporato selezionato in quella directory con versione
3. L'ordine dei candidati a runtime include:
   - directory di cache con versione
   - directory legacy per binari compilati (`%LOCALAPPDATA%/xcsh` su Windows, `~/.local/bin` altrove)
   - directory del pacchetto/eseguibile
4. Il primo componente aggiuntivo caricato correttamente deve comunque superare `validateNative`

Ecco perché il packaging e le aspettative del loader a runtime devono essere allineati: i nomi dei file, i tag di piattaforma e i simboli esportati devono corrispondere a quanto `native.ts` verifica e valida.

## Mappatura tra API JS ed export Rust (sottoinsieme del gate di validazione)

`native.ts` richiede che questi export visibili in JS esistano nel componente aggiuntivo caricato. Corrispondono agli export N-API di Rust in `crates/pi-natives/src`:

| Nome JS richiesto da `validateNative` | Dichiarazione export Rust | File sorgente Rust |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (export in camelCase) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

Se un simbolo richiesto è assente, il loader termina immediatamente con un suggerimento di ricompilazione.

## Comportamento in caso di errore e diagnostica

## Errori in fase di build

- Configurazione della variante non valida:
  - `TARGET_VARIANT` impostato su non-x64 → errore immediato
  - x64 cross-build senza `TARGET_VARIANT` esplicito → errore immediato
- Errore nella build di Cargo:
  - lo script espone l'uscita non-zero e lo stderr
- Artefatto non trovato:
  - lo script stampa tutte le directory del profilo verificate
- Errore di installazione:
  - messaggio esplicito; su Windows include un suggerimento per i file bloccati

## Errori del loader a runtime (`native.ts`)

- Tag di piattaforma non supportato:
  - genera un'eccezione con l'elenco delle piattaforme supportate
- Nessun candidato caricabile:
  - genera un'eccezione con l'elenco completo degli errori dei candidati e suggerimenti di risoluzione specifici per la modalità
- Export mancanti:
  - genera un'eccezione con i nomi esatti dei simboli mancanti e il comando di ricompilazione
- Problemi di estrazione incorporata:
  - gli errori di mkdir/write nell'estrazione vengono registrati e inclusi nella diagnostica finale

## Matrice di risoluzione dei problemi

| Sintomo | Causa probabile | Verifica | Soluzione |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | Binario `.node` obsoleto, mancata corrispondenza del nome dell'export Rust, o binario errato caricato | Eseguire con `PI_DEV=1` per vedere il percorso caricato; ispezionare l'elenco degli export per quel file | Ricompilare con `build`; assicurarsi che il nome dell'export Rust `#[napi]` (o l'alias esplicito se necessario) corrisponda alla chiave JS; rimuovere i file obsoleti dalla cache/con versione |
| La macchina x64 carica baseline quando ci si aspetta modern | `PI_NATIVE_VARIANT=baseline`, nessun AVX2 rilevato, o solo il file baseline presente | Verificare `PI_NATIVE_VARIANT`; ispezionare `native/` per il file `-modern` | Compilare la variante modern (`TARGET_VARIANT=modern ... build`) e assicurarsi che il file venga distribuito |
| La cross-build produce un binario non utilizzabile o con etichetta errata | Mancata corrispondenza tra `CROSS_TARGET` e `TARGET_PLATFORM`/`TARGET_ARCH`, o `TARGET_VARIANT` mancante per x64 | Verificare la tupla env e il nome del file di output | Rieseguire con valori env coerenti e `TARGET_VARIANT` esplicito per x64 |
| Il binario compilato fallisce dopo un aggiornamento | Cache estratta obsoleta (`~/.xcsh/natives/<versione-vecchia-o-non-corrispondente>`) o mancata corrispondenza del manifest incorporato | Ispezionare la directory natives con versione e l'elenco degli errori del loader | Eliminare la cache natives con versione per la versione del pacchetto e rieseguire; rigenerare il manifest incorporato durante il packaging |
| Il loader verifica molti percorsi e nessuno funziona | Mancata corrispondenza della piattaforma o artefatto di rilascio mancante nel pacchetto `native/` | Verificare `platformTag` rispetto ai nomi dei file effettivi | Assicurarsi che il nome del file compilato corrisponda esattamente alla convenzione `pi_natives.<platform>-<arch>(-variante).node` e che il pacchetto includa `native/` |
| `embed:native` fallisce con "Incomplete native addons" | I file della variante richiesta non sono stati compilati prima dell'embedding | Verificare l'elenco atteso vs trovato nel testo dell'errore | Compilare prima i file richiesti (x64: sia modern che baseline; non-x64: predefinito), poi rieseguire `embed:native` |

## Comandi operativi

```bash
# Artefatto di rilascio per l'host corrente
bun --cwd=packages/natives run build

# Build dell'artefatto con profilo debug
bun --cwd=packages/natives run dev:native

# Compilazione delle varianti x64 esplicite
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# Generazione del manifest del componente aggiuntivo incorporato dai file nativi compilati
bun --cwd=packages/natives run embed:native

# Reset del manifest incorporato a stub nullo
bun --cwd=packages/natives run embed:native -- --reset
```
