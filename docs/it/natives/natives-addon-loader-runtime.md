---
title: Runtime del Loader dei Natives Addon
description: >-
  N-API addon loader runtime with platform detection, fallback strategies, and
  module resolution.
sidebar:
  order: 3
  label: Loader degli addon
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# Runtime del Loader dei Natives Addon

Questo documento approfondisce il livello di caricamento/validazione degli addon in `@f5xc-salesdemos/pi-natives`: come `native.ts` decide quale file `.node` caricare, quando viene eseguita l'estrazione del payload incorporato e come vengono segnalati gli errori all'avvio.

## File di implementazione

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## Ambito e responsabilità

Le responsabilità del loader/runtime sono intenzionalmente limitate:

- Costruire un elenco di candidati per nomi di file e directory degli addon, basato su piattaforma e CPU.
- Opzionalmente materializzare un addon incorporato in una directory cache versionata per utente.
- Tentare i candidati in ordine deterministico.
- Rifiutare addon obsoleti o incompatibili tramite `validateNative` prima di esporre i binding.

Fuori dall'ambito di questo documento: comportamento specifico dei moduli per grep/text/highlight.

## Input di runtime e stato derivato

All'inizializzazione del modulo (`export const native = loadNative();`), `native.ts` calcola il contesto statico:

- **Tag piattaforma**: ``${process.platform}-${process.arch}`` (ad esempio `darwin-arm64`).
- **Versione del pacchetto**: da `packages/natives/package.json` (campo `version`).
- **Directory principali**:
  - `nativeDir`: locale al pacchetto `packages/natives/native`.
  - `execDir`: directory contenente `process.execPath`.
  - `versionedDir`: `<getNativesDir()>/<packageVersion>`.
  - Fallback `userDataDir`:
    - Windows: `%LOCALAPPDATA%/xcsh` (oppure `%USERPROFILE%/AppData/Local/xcsh`).
    - Non-Windows: `~/.local/bin`.
- **Modalità binario compilato** (`isCompiledBinary`): true se una qualsiasi delle seguenti condizioni è vera:
  - La variabile d'ambiente `PI_COMPILED` è impostata, oppure
  - `import.meta.url` contiene marcatori incorporati di Bun (`$bunfs`, `~BUN`, `%7EBUN`).
- **Override della variante**: `PI_NATIVE_VARIANT` (solo `modern`/`baseline`; valori non validi vengono ignorati).
- **Variante selezionata**: override esplicito, altrimenti rilevamento AVX2 a runtime su x64 (`modern` se AVX2 disponibile, altrimenti `baseline`).

## Supporto piattaforme e risoluzione dei tag

`SUPPORTED_PLATFORMS` è fissato a:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

Dettagli di comportamento:

- Le piattaforme non supportate non vengono rifiutate anticipatamente.
- Il loader tenta comunque prima tutti i candidati calcolati.
- Se nulla viene caricato, viene lanciato un errore esplicito di piattaforma non supportata con l'elenco dei tag supportati.

Questo preserva diagnostiche utili per i casi quasi corrispondenti, continuando comunque a fallire in modo definitivo per i target realmente non supportati.

## Selezione della variante (`modern` / `baseline` / default)

### Comportamento su x64

1. Se `PI_NATIVE_VARIANT` è `modern` o `baseline`, quel valore ha la precedenza.
2. Altrimenti rileva il supporto AVX2:
   - Linux: scansiona `/proc/cpuinfo` cercando `avx2`.
   - macOS: interroga `sysctl` (`machdep.cpu.leaf7_features`, fallback `machdep.cpu.features`).
   - Windows: esegue PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported`.
3. Risultato:
   - AVX2 disponibile -> `modern`
   - AVX2 non disponibile/non rilevabile -> `baseline`

### Comportamento su non-x64

- Non viene utilizzata alcuna variante; il loader usa il nome file predefinito (`pi_natives.<platform>-<arch>.node`).

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

### Candidati per il rilascio

Costruiti dall'elenco dei nomi file risolti per variante e cercati in questo ordine:

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

1. Il candidato di estrazione incorporato opzionale (se prodotto) viene inserito in testa.
2. I candidati deduplicati rimanenti vengono provati in ordine.
3. Il primo candidato che supera sia `require(...)` che `validateNative(...)` vince.

## Ciclo di vita dell'estrazione dell'addon incorporato

`embedded-addon.ts` definisce una struttura del manifesto generato:

- `platformTag`
- `version`
- `files[]` dove ogni voce ha `variant`, `filename`, `filePath`

Il valore predefinito attualmente registrato è `embeddedAddon: null`; gli artefatti compilati possono sostituirlo con metadati reali.

### Macchina a stati dell'estrazione

L'estrazione (`maybeExtractEmbeddedAddon`) viene eseguita solo quando tutti i gate sono superati:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. Un file incorporato appropriato per la variante viene trovato

La selezione del file per variante rispecchia l'intento di variante a runtime:

- Non-x64: preferisce `default`, poi il primo file disponibile.
- x64 + `modern`: preferisce `modern`, fallback a `baseline`.
- x64 + `baseline`: richiede `baseline`.

Comportamento della materializzazione:

1. Assicura che `<versionedDir>` esista (`mkdirSync(..., { recursive: true })`).
2. Se `<versionedDir>/<selected filename>` esiste già, lo riutilizza (nessuna riscrittura).
3. Altrimenti legge il `filePath` sorgente incorporato e scrive il file di destinazione.
4. Restituisce il percorso di destinazione per il tentativo di caricamento a priorità più alta.

In caso di fallimento, l'estrazione non provoca un crash immediato; aggiunge una voce di errore (fallimento nella creazione della directory o nella scrittura) e il loader procede con il probing normale dei candidati.

## Ciclo di vita e transizioni di stato

```text
Init
  -> Calcola piattaforma/versione/variante/elenchi candidati
  -> (Compilato + manifesto incorporato corrisponde?)
       sì -> Tenta estrazione incorporata in versionedDir (registra errori, continua)
       no  -> Salta estrazione
  -> Per ogni candidato runtime in ordine:
       require(candidato)
       -> successo: validateNative
            -> superato: restituisci binding (PRONTO)
            -> fallito: registra errore, continua
       -> fallimento: registra errore, continua
  -> nessuno caricato:
       se tag piattaforma non supportato -> lancia Piattaforma non supportata
       altrimenti -> lancia Caricamento fallito (diagnostiche complete dei percorsi tentati + suggerimenti)
```

## Controlli contrattuali di `validateNative`

`validateNative(bindings, source)` applica un contratto basato esclusivamente su funzioni su `NativeBindings` all'avvio.

Meccanismo:

- Per ogni nome di export richiesto, verifica `typeof bindings[name] === "function"`.
- I nomi mancanti vengono aggregati.
- Se qualcuno è mancante, il loader lancia:
  - percorso dell'addon sorgente,
  - elenco degli export mancanti,
  - suggerimento del comando di rebuild.

Questo è un gate di compatibilità rigido contro binari obsoleti, build parziali e derive di simboli/nomi.

### Mappatura API JS ↔ export nativi (gate di validazione)

| Nome binding JS verificato in `validateNative` | Nome export nativo atteso |
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

Nota: `bindings.ts` dichiara solo il membro base `cancelWork(id)`; i file `types.ts` dei moduli effettuano declaration-merge di simboli aggiuntivi che `validateNative` impone.

## Comportamento in caso di errore e diagnostiche

## Piattaforma non supportata

Se tutti i candidati falliscono e `platformTag` non è in `SUPPORTED_PLATFORMS`, il loader lancia:

- `Unsupported platform: <tag>`
- Elenco completo delle piattaforme supportate
- Guida esplicita per la segnalazione del problema

## Sintomi di binario obsoleto / mismatch

Segnale tipico di mismatch obsoleto:

- `Native addon missing exports (<candidate>). Missing: ...`

Cause comuni:

- Vecchio binario `.node` da una versione/forma API precedente del pacchetto.
- Artefatto della variante errata selezionato (per x64).
- Nuovo export Rust non presente nell'artefatto caricato.

Comportamento del loader:

- Registra i fallimenti di export mancanti per ogni candidato.
- Continua a provare i candidati rimanenti.
- Se nessun candidato supera la validazione, l'errore finale include ogni percorso tentato con il relativo messaggio di errore.

## Errori all'avvio in modalità binario compilato

In modalità compilata le diagnostiche finali includono:

- percorsi attesi della cache versionata (`<versionedDir>/<filename>`),
- rimedio per eliminare il `<versionedDir>` obsoleto e rieseguire,
- comandi `curl` per il download diretto dalla release per ogni nome file atteso.

## Errori all'avvio in modalità non compilata

In modalità normale pacchetto/runtime le diagnostiche finali includono:

- suggerimento di reinstallazione (`bun install @f5xc-salesdemos/pi-natives`),
- comando di rebuild locale (`bun --cwd=packages/natives run build`),
- suggerimento opzionale di build della variante x64 (`TARGET_VARIANT=baseline|modern ...`).

## Comportamento a runtime

- Il loader utilizza sempre la catena di candidati per il rilascio.
- L'impostazione di `PI_DEV` abilita solo le diagnostiche per candidato nella console (`Loaded native addon...` e errori di caricamento).
