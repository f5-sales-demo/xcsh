---
title: Runtime del Loader per Addon Nativi
description: >-
  N-API addon loader runtime with platform detection, fallback strategies, and
  module resolution.
sidebar:
  order: 3
  label: Addon loader
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# Runtime del Loader per Addon Nativi

Questo documento approfondisce il livello di caricamento/validazione degli addon in `@f5xc-salesdemos/pi-natives`: come `native.ts` decide quale file `.node` caricare, quando viene eseguita l'estrazione del payload incorporato e come vengono segnalati gli errori all'avvio.

## File di implementazione

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## Ambito e responsabilità

Le responsabilità del loader/runtime sono intenzionalmente circoscritte:

- Costruire un elenco di candidati per nomi di file e directory degli addon, consapevole della piattaforma e della CPU.
- Materializzare opzionalmente un addon incorporato in una directory cache versionata per utente.
- Tentare i candidati in ordine deterministico.
- Rifiutare addon obsoleti o incompatibili tramite `validateNative` prima di esporre i binding.

Fuori ambito in questa sede: il comportamento specifico dei moduli per grep/text/highlight.

## Input del runtime e stato derivato

All'inizializzazione del modulo (`export const native = loadNative();`), `native.ts` calcola il contesto statico:

- **Tag piattaforma**: ``${process.platform}-${process.arch}`` (ad esempio `darwin-arm64`).
- **Versione del pacchetto**: da `packages/natives/package.json` (campo `version`).
- **Directory principali**:
  - `nativeDir`: `packages/natives/native` locale al pacchetto.
  - `execDir`: directory contenente `process.execPath`.
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`.
  - Fallback `userDataDir`:
    - Windows: `%LOCALAPPDATA%/xcsh` (oppure `%USERPROFILE%/AppData/Local/xcsh`).
    - Non-Windows: `~/.local/bin`.
- **Modalità binario compilato** (`isCompiledBinary`): true se una qualsiasi delle seguenti condizioni è verificata:
  - La variabile d'ambiente `PI_COMPILED` è impostata, oppure
  - `import.meta.url` contiene marcatori incorporati di Bun (`$bunfs`, `~BUN`, `%7EBUN`).
- **Override della variante**: `PI_NATIVE_VARIANT` (solo `modern`/`baseline`; valori non validi vengono ignorati).
- **Variante selezionata**: override esplicito, altrimenti rilevamento AVX2 a runtime su x64 (`modern` se AVX2 è presente, altrimenti `baseline`).

## Supporto piattaforme e risoluzione dei tag

`SUPPORTED_PLATFORMS` è fissato a:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

Dettagli del comportamento:

- Le piattaforme non supportate non vengono rifiutate anticipatamente.
- Il loader tenta comunque prima tutti i candidati calcolati.
- Se nessuno viene caricato, viene lanciato un errore esplicito di piattaforma non supportata con l'elenco dei tag supportati.

Questo preserva diagnostiche utili per i casi quasi corrispondenti, pur fallendo in modo definitivo per target realmente non supportati.

## Selezione della variante (`modern` / `baseline` / default)

### Comportamento x64

1. Se `PI_NATIVE_VARIANT` è `modern` o `baseline`, quel valore ha la precedenza.
2. Altrimenti viene rilevato il supporto AVX2:
   - Linux: scansione di `/proc/cpuinfo` per `avx2`.
   - macOS: interrogazione di `sysctl` (`machdep.cpu.leaf7_features`, fallback `machdep.cpu.features`).
   - Windows: esecuzione PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported`.
3. Risultato:
   - AVX2 disponibile -> `modern`
   - AVX2 non disponibile/non rilevabile -> `baseline`

### Comportamento non-x64

- Nessuna variante viene utilizzata; il loader resta sul nome file predefinito (`pi_natives.<platform>-<arch>.node`).

### Costruzione del nome file

Dato `tag = <platform>-<arch>`:

- Non-x64 o nessuna variante: `pi_natives.<tag>.node`
- x64 + `modern`: prova in ordine
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (fallback intenzionale)
- x64 + `baseline`: solo `pi_natives.<tag>-baseline.node`

L'`addonLabel` utilizzato nei messaggi di errore finali è `<tag>` oppure `<tag> (<variant>)`.

## Costruzione dei percorsi candidati e ordine di fallback

`native.ts` costruisce i pool di candidati prima di qualsiasi chiamata `require(...)`.

### Candidati di rilascio

Costruiti dalla lista di nomi file risolta per variante e cercati in questo ordine:

- **Runtime non compilato**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **Runtime compilato** (`PI_COMPILED` o marcatori incorporati di Bun):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` rimuove i duplicati preservando l'ordine della prima occorrenza.

### Sequenza finale a runtime

Al momento del caricamento:

1. Il candidato opzionale dell'estrazione incorporata (se prodotto) viene inserito in testa.
2. I candidati deduplicati rimanenti vengono provati in ordine.
3. Il primo candidato che sia eseguito con successo da `require(...)` sia superato da `validateNative(...)` vince.

## Ciclo di vita dell'estrazione dell'addon incorporato

`embedded-addon.ts` definisce una struttura di manifesto generato:

- `platformTag`
- `version`
- `files[]` dove ogni voce ha `variant`, `filename`, `filePath`

Il valore predefinito corrente nel repository è `embeddedAddon: null`; gli artefatti compilati possono sostituirlo con metadati reali.

### Macchina a stati dell'estrazione

L'estrazione (`maybeExtractEmbeddedAddon`) viene eseguita solo quando tutte le condizioni sono soddisfatte:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. Viene trovato un file incorporato appropriato per la variante

La selezione del file per variante rispecchia l'intento della variante a runtime:

- Non-x64: preferisce `default`, poi il primo file disponibile.
- x64 + `modern`: preferisce `modern`, fallback a `baseline`.
- x64 + `baseline`: richiede `baseline`.

Comportamento della materializzazione:

1. Assicura che `<versionedDir>` esista (`mkdirSync(..., { recursive: true })`).
2. Se `<versionedDir>/<selected filename>` esiste già, lo riutilizza (nessuna riscrittura).
3. Altrimenti legge il `filePath` sorgente incorporato e scrive il file di destinazione.
4. Restituisce il percorso di destinazione per il tentativo di caricamento a priorità più alta.

In caso di errore, l'estrazione non provoca un crash immediato; aggiunge una voce di errore (errore di creazione directory o scrittura) e il loader procede al probing normale dei candidati.

## Ciclo di vita e transizioni di stato

```text
Init
  -> Compute platform/version/variant/candidate lists
  -> (Compiled + embedded manifest matches?)
       yes -> Try extract embedded to versionedDir (record errors, continue)
       no  -> Skip extraction
  -> For each runtime candidate in order:
       require(candidate)
       -> success: validateNative
            -> pass: return bindings (READY)
            -> fail: record error, continue
       -> failure: record error, continue
  -> none loaded:
       if unsupported platform tag -> throw Unsupported platform
       else -> throw Failed to load (full tried-path diagnostics + hints)
```

## Controlli contrattuali di `validateNative`

`validateNative(bindings, source)` impone un contratto basato esclusivamente su funzioni su `NativeBindings` all'avvio.

Meccanica:

- Per ogni nome di export richiesto, verifica `typeof bindings[name] === "function"`.
- I nomi mancanti vengono aggregati.
- Se ne manca qualcuno, il loader lancia un errore con:
  - il percorso dell'addon sorgente,
  - l'elenco degli export mancanti,
  - un suggerimento per il comando di rebuild.

Questo è un gate di compatibilità rigido contro binari obsoleti, build parziali e derive di simboli/nomi.

### Mapping API JS ↔ export nativi (gate di validazione)

| Nome del binding JS verificato in `validateNative` | Nome dell'export nativo atteso |
| --- | --- |
| `grep` | `grep` |
| `glob` | `glob` |
| `highlightCode` | `highlightCode` |
| `executeShell` | `executeShell` |
| `PtySession` | `PtySession` |
| `Shell` | `Shell` |
| `visibleWidth` | `visibleWidth` |
| `getSystemInfo` | `getSystemInfo` |
| `getWorkProfile` | `getWorkProfile` |
| `invalidateFsScanCache` | `invalidateFsScanCache` |

Nota: `bindings.ts` dichiara solo il membro base `cancelWork(id)`; i file `types.ts` dei moduli effettuano il declaration-merge di simboli aggiuntivi che `validateNative` impone.

## Comportamento in caso di errore e diagnostica

## Piattaforma non supportata

Se tutti i candidati falliscono e `platformTag` non è in `SUPPORTED_PLATFORMS`, il loader lancia:

- `Unsupported platform: <tag>`
- Elenco completo delle piattaforme supportate
- Indicazioni esplicite per la segnalazione del problema

## Sintomi di binario obsoleto / mismatch

Segnale tipico di mismatch con binario obsoleto:

- `Native addon missing exports (<candidate>). Missing: ...`

Cause comuni:

- Vecchio binario `.node` da una versione/forma API precedente del pacchetto.
- Artefatto di variante errato selezionato (per x64).
- Nuovo export Rust non presente nell'artefatto caricato.

Comportamento del loader:

- Registra gli errori di export mancanti per ogni candidato.
- Continua il probing dei candidati rimanenti.
- Se nessun candidato viene validato, l'errore finale include ogni percorso tentato con il relativo messaggio di errore.

## Errori all'avvio in modalità binario compilato

In modalità compilata la diagnostica finale include:

- i percorsi target attesi nella cache versionata (`<versionedDir>/<filename>`),
- le istruzioni per la correzione: eliminare la `<versionedDir>` obsoleta e rieseguire,
- comandi `curl` per il download diretto dal rilascio per ogni nome file atteso.

## Errori all'avvio in modalità non compilata

In modalità pacchetto/runtime normale la diagnostica finale include:

- suggerimento di reinstallazione (`bun install @f5xc-salesdemos/pi-natives`),
- comando di rebuild locale (`bun --cwd=packages/natives run build`),
- suggerimento opzionale di build per variante x64 (`TARGET_VARIANT=baseline|modern ...`).

## Comportamento a runtime

- Il loader utilizza sempre la catena dei candidati di rilascio.
- L'impostazione di `PI_DEV` abilita solo la diagnostica per singolo candidato nella console (`Loaded native addon...` e errori di caricamento).
