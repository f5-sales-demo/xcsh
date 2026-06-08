---
title: Architettura di Natives
description: >-
  Rust N-API native addon architecture bridging TypeScript and platform-specific
  operations.
sidebar:
  order: 1
  label: Architettura
i18n:
  sourceHash: ff6d5d83a9a7
  translator: machine
---

# Architettura di Natives

`@f5xc-salesdemos/pi-natives` è uno stack a tre livelli:

1. **Livello wrapper/API TypeScript** espone entrypoint JS/TS stabili.
2. **Livello di caricamento/validazione dell'addon** risolve e valida il binario `.node` per il runtime corrente.
3. **Livello modulo Rust N-API** implementa le primitive a prestazioni critiche esportate verso JS.

Questo documento è la base per la documentazione più approfondita a livello di modulo.

## File di implementazione

- `packages/natives/src/index.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `crates/pi-natives/src/lib.rs`

## Livello 1: Livello wrapper/API TypeScript

`packages/natives/src/index.ts` è il barrel pubblico. Raggruppa le esportazioni per dominio di funzionalità e ri-esporta wrapper tipizzati anziché esporre direttamente i binding N-API grezzi.

Gruppi di primo livello attuali:

- **Primitive di ricerca/testo**: `grep`, `glob`, `text`, `highlight`
- **Primitive di esecuzione/processo/terminale**: `shell`, `pty`, `ps`, `keys`
- **Primitive di sistema/media/conversione**: `image`, `html`, `clipboard`, `system-info`, `work`

`packages/natives/src/bindings.ts` definisce il contratto di interfaccia base:

- `NativeBindings` inizia con i membri condivisi (`cancelWork(id: number)`)
- I binding specifici del modulo vengono aggiunti tramite declaration merging dal file `types.ts` di ciascun modulo
- `Cancellable` standardizza le opzioni di timeout e abort-signal per i wrapper che espongono la cancellazione

**Contratto garantito (lato API):** i consumer importano da `@f5xc-salesdemos/pi-natives` e utilizzano wrapper tipizzati.

**Dettaglio implementativo (soggetto a modifiche):** declaration merging e layout interno dei wrapper (`src/<module>/index.ts`, `src/<module>/types.ts`).

## Livello 2: Caricamento e validazione dell'addon

`packages/natives/src/native.ts` gestisce la selezione dell'addon a runtime, l'estrazione opzionale e la validazione delle esportazioni.

### Modello di risoluzione dei candidati

- Il tag di piattaforma è `"${process.platform}-${process.arch}"`.
- I tag attualmente supportati sono:
  - `linux-x64`
  - `linux-arm64`
  - `darwin-x64`
  - `darwin-arm64`
  - `win32-x64`
- x64 può utilizzare varianti CPU:
  - `modern` (compatibile AVX2)
  - `baseline` (fallback)
- Le architetture non-x64 utilizzano il nome file predefinito (senza suffisso di variante).

Strategia dei nomi file:

- Release: `pi_natives.<platform>-<arch>.node`
- Release con variante x64: `pi_natives.<platform>-<arch>-modern.node` e/o `...-baseline.node`
- `PI_DEV` abilita la diagnostica del loader ma non modifica i nomi file dell'addon

### Rilevamento della variante specifico per piattaforma

Per x64, la selezione della variante utilizza:

- **Linux**: `/proc/cpuinfo`
- **macOS**: `sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows**: controllo PowerShell per `System.Runtime.Intrinsics.X86.Avx2`

`PI_NATIVE_VARIANT` può forzare esplicitamente `modern` o `baseline`.

### Modello di distribuzione ed estrazione dei binari

`packages/natives/package.json` include sia `src` che `native` nei file pubblicati. La directory `native/` memorizza gli artefatti precompilati per piattaforma.

Per i binari compilati (marcatori di runtime `PI_COMPILED` o Bun embedded), il comportamento del loader è:

1. Controllare il percorso cache utente con versione: `<getNativesDir()>/<packageVersion>/...`
2. Controllare la posizione legacy dei binari compilati:
   - Windows: `%LOCALAPPDATA%/xcsh` (fallback `%USERPROFILE%/AppData/Local/xcsh`)
   - non-Windows: `~/.local/bin`
3. Ricorrere alla directory `native/` del pacchetto e ai candidati nella directory dell'eseguibile

Se è presente un manifesto di addon embedded (`embedded-addon.ts` generato da `scripts/embed-native.ts`), `native.ts` può materializzare il binario embedded corrispondente nella directory cache con versione prima del caricamento.

### Validazione e modalità di errore

Dopo `require(candidate)`, `validateNative(...)` verifica le esportazioni richieste (ad esempio `grep`, `glob`, `highlightCode`, `PtySession`, `Shell`, `getSystemInfo`, `getWorkProfile`, `invalidateFsScanCache`).

I percorsi di errore sono espliciti:

- **Tag di piattaforma non supportato**: genera un'eccezione con la lista delle piattaforme supportate
- **Nessun candidato caricabile**: genera un'eccezione con tutti i percorsi tentati e suggerimenti di rimedio
- **Esportazioni mancanti**: genera un'eccezione con i nomi esatti mancanti e il comando di ricompilazione
- **Errori di estrazione embedded**: registra i fallimenti di directory/scrittura e li include nella diagnostica finale di caricamento

**Contratto garantito (lato API):** il caricamento dell'addon ha successo con un set di binding validato oppure fallisce immediatamente con un testo di errore azionabile.

**Dettaglio implementativo (soggetto a modifiche):** ordine esatto di ricerca dei candidati e ordinamento del percorso di fallback dei binari compilati.

## Livello 3: Livello modulo Rust N-API

`crates/pi-natives/src/lib.rs` è il modulo Rust di ingresso che dichiara la proprietà dei moduli esportati:

- `clipboard`
- `fd`
- `fs_cache`
- `glob`
- `glob_util`
- `grep`
- `highlight`
- `html`
- `image`
- `keys`
- `prof`
- `ps`
- `pty`
- `shell`
- `system_info`
- `task`
- `text`

Questi moduli implementano i simboli N-API consumati e validati da `native.ts`. I nomi a livello JS vengono esposti attraverso i wrapper TS in `packages/natives/src`.

**Contratto garantito (lato API):** le esportazioni dei moduli Rust devono corrispondere ai nomi dei binding attesi da `validateNative` e dai moduli wrapper.

**Dettaglio implementativo (soggetto a modifiche):** decomposizione interna dei moduli Rust e confini dei moduli helper (`glob_util`, `task`, ecc.).

## Confini di responsabilità

A livello di architettura, la responsabilità è suddivisa come segue:

- **Responsabilità del wrapper/API TS (`packages/natives/src`)**
  - raggruppamento dell'API pubblica, tipizzazione delle opzioni ed ergonomia JS stabile
  - superficie di cancellazione (`timeoutMs`, `AbortSignal`) esposta ai chiamanti
- **Responsabilità del loader (`packages/natives/src/native.ts`)**
  - selezione del binario a runtime
  - selezione della variante CPU e gestione degli override
  - estrazione dei binari compilati e probing dei candidati
  - validazione rigorosa delle esportazioni native richieste
- **Responsabilità di Rust (`crates/pi-natives/src`)**
  - implementazione algoritmica e a livello di sistema
  - comportamento nativo della piattaforma e logica sensibile alle prestazioni
  - implementazione dei simboli N-API consumati dai wrapper TS

## Flusso a runtime (alto livello)

1. Il consumer importa da `@f5xc-salesdemos/pi-natives`.
2. Il modulo wrapper invoca il binding singleton `native`.
3. `native.ts` seleziona il binario candidato per piattaforma/architettura/variante.
4. Avviene l'estrazione opzionale del binario embedded per le distribuzioni compilate.
5. L'addon viene caricato e il set di esportazioni viene validato.
6. Il wrapper restituisce risultati tipizzati al chiamante.

## Glossario

- **Native addon**: Un binario `.node` caricato tramite Node-API (N-API).
- **Tag di piattaforma**: Tupla a runtime `platform-arch` (ad esempio `darwin-arm64`).
- **Variante**: Flavor di build specifico per CPU x64 (`modern` AVX2, `baseline` fallback).
- **Wrapper**: Funzione/classe TS che fornisce un'API tipizzata sopra le esportazioni native grezze.
- **Declaration merging**: Tecnica TS utilizzata dai file `types.ts` dei moduli per estendere `NativeBindings`.
- **Modalità binario compilato**: Modalità a runtime in cui la CLI è impacchettata e gli addon nativi vengono risolti da percorsi estratti/cache anziché solo da percorsi locali al pacchetto.
- **Embedded addon**: Metadati degli artefatti di build e riferimenti ai file generati in `embedded-addon.ts` affinché i binari compilati possano estrarre i payload `.node` corrispondenti.
- **Gate di validazione**: Controllo `validateNative(...)` che rifiuta i binari obsoleti/non corrispondenti a cui mancano le esportazioni richieste.
