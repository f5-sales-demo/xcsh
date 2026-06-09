---
title: Runtime del caricatore di addon nativi
description: >-
  Runtime del caricatore di addon N-API con rilevamento della piattaforma,
  strategie di fallback e risoluzione dei moduli.
sidebar:
  order: 3
  label: Caricatore di addon
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# Runtime del caricatore di addon nativi

Questo documento approfondisce il livello di caricamento/validazione degli addon in `@f5xc-salesdemos/pi-natives`: come `native.ts` decide quale file `.node` caricare, quando viene eseguita l'estrazione del payload incorporato e come vengono segnalati gli errori di avvio.

## File di implementazione

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## Ambito e responsabilità

Le responsabilità del caricatore/runtime sono intenzionalmente limitate:

- Costruire un elenco di candidati per nomi di file e directory degli addon in base a piattaforma/CPU.
- Opzionalmente materializzare un addon incorporato in una directory cache versionata per utente.
- Tentare i candidati in ordine deterministico.
- Rifiutare addon obsoleti o incompatibili tramite `validateNative` prima di esporre i binding.

Fuori ambito: comportamento specifico del modulo per grep/testo/evidenziazione.

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
- **Modalità binario compilato** (`isCompiledBinary`): true se si verifica una delle seguenti condizioni:
  - La variabile d'ambiente `PI_COMPILED` è impostata, oppure
  - `import.meta.url` contiene marcatori Bun-embedded (`$bunfs`, `~BUN`, `%7EBUN`).
- **Override variante**: `PI_NATIVE_VARIANT` (solo `modern`/`baseline`; i valori non validi vengono ignorati).
- **Variante selezionata**: override esplicito, altrimenti rilevamento AVX2 a runtime su x64 (`modern` se AVX2 presente, altrimenti `baseline`).

## Supporto piattaforme e risoluzione dei tag

`SUPPORTED_PLATFORMS` è fissato a:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

Dettaglio del comportamento:

- Le piattaforme non supportate non vengono rifiutate immediatamente.
- Il caricatore tenta comunque prima tutti i candidati calcolati.
- Se nessuno viene caricato, lancia un errore esplicito di piattaforma non supportata elencando i tag supportati.

Questo preserva diagnostiche utili per casi quasi corrispondenti, pur fallendo in modo deciso per target realmente non supportati.

## Selezione variante (`modern` / `baseline` / default)

### Comportamento x64

1. Se `PI_NATIVE_VARIANT` è `modern` o `baseline`, quel valore ha la precedenza.
2. Altrimenti rileva il supporto AVX2:
   - Linux: analizza `/proc/cpuinfo` cercando `avx2`.
   - macOS: interroga `sysctl` (`machdep.cpu.leaf7_features`, fallback `machdep.cpu.features`).
   - Windows: esegue PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported`.
3. Risultato:
   - AVX2 disponibile -> `modern`
   - AVX2 non disponibile/non rilevabile -> `baseline`

### Comportamento non-x64

- Nessuna variante viene utilizzata; il caricatore rimane sul nome file predefinito (`pi_natives.<platform>-<arch>.node`).

### Costruzione del nome file

Dato `tag = <platform>-<arch>`:

- Non-x64 o nessuna variante: `pi_natives.<tag>.node`
- x64 + `modern`: tenta in ordine
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (fallback intenzionale)
- x64 + `baseline`: solo `pi_natives.<tag>-baseline.node`

L'`addonLabel` utilizzato nei messaggi di errore finali è `<tag>` oppure `<tag> (<variant>)`.

## Costruzione dei percorsi candidati e ordine di fallback

`native.ts` costruisce pool di candidati prima di qualsiasi chiamata `require(...)`.

### Candidati per il rilascio

Costruiti dalla lista di nomi file risolti per variante e ricercati in questo ordine:

- **Runtime non compilato**:
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **Runtime compilato** (`PI_COMPILED` o marcatori Bun embedded):
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` rimuove i duplicati preservando l'ordine della prima occorrenza.

### Sequenza finale a runtime

Al momento del caricamento:

1. Il candidato opzionale di estrazione incorporata (se prodotto) viene inserito in prima posizione.
2. I candidati deduplicati rimanenti vengono tentati in ordine.
3. Il primo candidato che supera sia `require(...)` che `validateNative(...)` vince.

## Ciclo di vita dell'estrazione dell'addon incorporato

`embedded-addon.ts` definisce una forma di manifesto generato:

- `platformTag`
- `version`
- `files[]` dove ogni voce ha `variant`, `filename`, `filePath`

Il valore predefinito attualmente presente nel codice è `embeddedAddon: null`; gli artefatti compilati possono sostituirlo con metadati reali.

### Macchina a stati dell'estrazione

L'estrazione (`maybeExtractEmbeddedAddon`) viene eseguita solo quando tutti i controlli passano:

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. Viene trovato un file incorporato appropriato alla variante

La selezione del file variante rispecchia l'intento della variante a runtime:

- Non-x64: preferisce `default`, poi il primo file disponibile.
- x64 + `modern`: preferisce `modern`, fallback su `baseline`.
- x64 + `baseline`: richiede `baseline`.

Comportamento della materializzazione:

1. Assicura che `<versionedDir>` esista (`mkdirSync(..., { recursive: true })`).
2. Se `<versionedDir>/<selected filename>` esiste già, lo riutilizza (nessuna riscrittura).
3. Altrimenti legge il `filePath` sorgente incorporato e scrive il file di destinazione.
4. Restituisce il percorso di destinazione per il tentativo di caricamento a massima priorità.

In caso di fallimento, l'estrazione non causa un crash immediato; aggiunge una voce di errore (fallimento nella creazione della directory o nella scrittura) e il caricatore procede con il probing normale dei candidati.

## Ciclo di vita e transizioni di stato

```text
Init
  -> Calcola piattaforma/versione/variante/liste candidati
  -> (Compilato + manifesto incorporato corrisponde?)
       sì -> Tenta estrazione incorporata in versionedDir (registra errori, continua)
       no  -> Salta estrazione
  -> Per ogni candidato runtime in ordine:
       require(candidate)
       -> successo: validateNative
            -> superato: restituisce binding (PRONTO)
            -> fallito: registra errore, continua
       -> fallimento: registra errore, continua
  -> nessuno caricato:
       se tag piattaforma non supportato -> lancia Piattaforma non supportata
       altrimenti -> lancia Caricamento fallito (diagnostica completa percorsi tentati + suggerimenti)
```

## Controlli del contratto `validateNative`

`validateNative(bindings, source)` impone un contratto basato esclusivamente su funzioni su `NativeBindings` all'avvio.

Meccanica:

- Per ogni nome di export richiesto, verifica `typeof bindings[name] === "function"`.
- I nomi mancanti vengono aggregati.
- Se ne manca qualcuno, il caricatore lancia:
  - percorso dell'addon sorgente,
  - lista degli export mancanti,
  - suggerimento del comando di rebuild.

Questo è un gate di compatibilità rigido contro binari obsoleti, build parziali e drift di simboli/nomi.

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

Nota: `bindings.ts` dichiara solo il membro base `cancelWork(id)`; i file `types.ts` dei moduli effettuano il declaration-merge di simboli aggiuntivi che `validateNative` impone.

## Comportamento in caso di errore e diagnostica

## Piattaforma non supportata

Se tutti i candidati falliscono e `platformTag` non è in `SUPPORTED_PLATFORMS`, il caricatore lancia:

- `Unsupported platform: <tag>`
- Lista completa delle piattaforme supportate
- Guida esplicita per la segnalazione del problema

## Sintomi di binario obsoleto / mismatch

Segnale tipico di mismatch obsoleto:

- `Native addon missing exports (<candidate>). Missing: ...`

Cause comuni:

- Vecchio binario `.node` da una versione precedente del pacchetto/forma API.
- Artefatto di variante errato selezionato (per x64).
- Nuovo export Rust non presente nell'artefatto caricato.

Comportamento del caricatore:

- Registra i fallimenti di export mancanti per ogni candidato.
- Continua a provare i candidati rimanenti.
- Se nessun candidato viene validato, l'errore finale include ogni percorso tentato con il relativo messaggio di errore.

## Errori di avvio in modalità binario compilato

In modalità compilata la diagnostica finale include:

- percorsi target attesi della cache versionata (`<versionedDir>/<filename>`),
- rimedio per eliminare `<versionedDir>` obsoleta e rieseguire,
- comandi `curl` per il download diretto dalla release per ogni nome file atteso.

## Errori di avvio in modalità non compilata

In modalità normale pacchetto/runtime la diagnostica finale include:

- suggerimento di reinstallazione (`bun install @f5xc-salesdemos/pi-natives`),
- comando di rebuild locale (`bun --cwd=packages/natives run build`),
- suggerimento opzionale di build variante x64 (`TARGET_VARIANT=baseline|modern ...`).

## Comportamento a runtime

- Il caricatore utilizza sempre la catena dei candidati per il rilascio.
- L'impostazione di `PI_DEV` abilita solo la diagnostica per candidato nella console (`Loaded native addon...` e errori di caricamento).
