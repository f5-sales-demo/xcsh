---
title: Natives Binding Contract (TypeScript Side)
description: >-
  Contratto di binding lato TypeScript per la chiamata alle funzioni native Rust
  tramite N-API.
sidebar:
  order: 2
  label: Binding contract
i18n:
  sourceHash: f5b74267cdd5
  translator: machine
---

# Natives Binding Contract (lato TypeScript)

Questo documento definisce il contratto lato TypeScript che si interpone tra i chiamanti di `@f5xc-salesdemos/pi-natives` e l'addon N-API caricato.

Si concentra su tre elementi:

1. forma del contratto (`NativeBindings` + module augmentation),
2. comportamento dei wrapper (`src/<module>/index.ts`),
3. superficie di esportazione pubblica (`src/index.ts`).

## File di implementazione

- `packages/natives/src/bindings.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/grep/index.ts`
- `packages/natives/src/highlight/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/system-info/types.ts`
- `packages/natives/src/system-info/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/work/types.ts`
- `packages/natives/src/work/index.ts`

## Modello del contratto

`packages/natives/src/bindings.ts` definisce il contratto di base:

- `NativeBindings` (interfaccia base, attualmente include `cancelWork(id: number): void`)
- `Cancellable` (`timeoutMs?: number`, `signal?: AbortSignal`)
- `TsFunc<T>` forma della callback utilizzata dalle callback threadsafe di N-API

Ogni modulo aggiunge i propri campi tramite declaration merging:

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

Questo mantiene un'unica interfaccia di binding aggregata senza un file di tipo monolitico centralizzato.

## Ciclo di vita del declaration-merging e transizioni di stato

### 1) Assemblaggio dei tipi a compile-time

- `bindings.ts` fornisce il simbolo base `NativeBindings`.
- Ogni `src/<module>/types.ts` estende `NativeBindings`.
- `src/native.ts` importa tutti i file `./<module>/types` per side effect, in modo che il contratto unificato sia nello scope dove viene utilizzato `NativeBindings`.

Transizione di stato: **Contratto base** → **Contratto unificato**.

### 2) Caricamento dell'addon a runtime e gate di validazione

- `src/native.ts` carica i binari candidati `.node`.
- L'oggetto caricato viene trattato come `NativeBindings` e immediatamente passato attraverso `validateNative(...)`.
- `validateNative` verifica le chiavi di export richieste tramite `typeof bindings[name] === "function"`.

Transizione di stato: **Oggetto addon non affidabile** → **Oggetto di binding nativo validato** (o fallimento definitivo).

### 3) Invocazione dei wrapper

- I wrapper dei moduli in `src/<module>/index.ts` chiamano `native.<export>`.
- I wrapper adattano i valori predefiniti e la forma delle callback (da `(err, value)` a pattern callback solo-valore nelle API JS).
- `src/index.ts` ri-esporta i wrapper/tipi dei moduli come API pubblica del pacchetto.

Transizione di stato: **Binding grezzi validati** → **API pubblica ergonomica**.

## Responsabilità dei wrapper

I wrapper sono intenzionalmente sottili; non re-implementano la logica nativa.

Responsabilità principali:

- **Normalizzazione/impostazione predefinita degli argomenti**
  - `glob()` risolve `options.path` in percorso assoluto e imposta i valori predefiniti per `hidden`, `gitignore`, `recursive`.
  - `hasMatch()` popola i flag predefiniti (`ignoreCase`, `multiline`) prima della chiamata nativa.
- **Adattamento delle callback**
  - `grep()`, `glob()`, `executeShell()` convertono `TsFunc<T>` (`error, value`) in callback utente che ricevono solo i valori di successo.
- **Comportamento di ambiente o policy attorno alle chiamate native**
  - Il wrapper clipboard aggiunge la gestione OSC52/Termux/headless e tratta la copia come best effort.
- **Naming pubblico e cura delle ri-esportazioni**
  - `searchContent()` mappa all'export nativo `search`.

## Organizzazione della superficie di esportazione pubblica

`packages/natives/src/index.ts` è il barrel pubblico canonico. Raggruppa le esportazioni per dominio di funzionalità:

- Ricerca/testo: `grep`, `glob`, `text`, `highlight`
- Esecuzione/processo/terminale: `shell`, `pty`, `ps`, `keys`
- Sistema/media/conversione: `image`, `html`, `clipboard`, `system-info`, `work`

Regola per i maintainer: se un wrapper non è ri-esportato da `src/index.ts`, non fa parte della superficie pubblica prevista del pacchetto.

## Mappatura API JS ↔ export nativi (rappresentativa)

Il lato Rust utilizza nomi di export N-API (tipicamente dalla conversione `#[napi]` snake_case -> camelCase, con occasionali alias espliciti) che devono corrispondere a queste chiavi di binding.

| Categoria | API JS pubblica (wrapper) | Chiave di binding nativa | Tipo di ritorno | Asincrono? |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | Sì |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | No |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | No |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | Sì |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | Sì |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | No |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | Sì |
| Shell | `Shell` | `Shell` | costruttore di classe | N/D |
| PTY | `PtySession` | `PtySession` | costruttore di classe | N/D |
| Text | `truncateToWidth(...)` | `truncateToWidth` | `string` | No |
| Text | `sliceWithWidth(...)` | `sliceWithWidth` | `SliceWithWidthResult` | No |
| Text | `visibleWidth(text)` | `visibleWidth` | `number` | No |
| Highlight | `highlightCode(code, lang, colors)` | `highlightCode` | `string` | No |
| HTML | `htmlToMarkdown(html, options?)` | `htmlToMarkdown` | `Promise<string>` | Sì |
| System | `getSystemInfo()` | `getSystemInfo` | `SystemInfo` | No |
| Work | `getWorkProfile(lastSeconds)` | `getWorkProfile` | `WorkProfile` | No |
| Process | `killTree(pid, signal)` | `killTree` | `number` | No |
| Process | `listDescendants(pid)` | `listDescendants` | `number[]` | No |
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>` (comportamento best effort del wrapper) | Sì |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | Sì |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | No |

## Differenze tra contratti sincroni e asincroni

Il contratto mescola API sincrone e asincrone; i wrapper preservano lo stile di chiamata nativo anziché forzare un unico modello:

- **Export asincroni basati su Promise** per I/O o lavori di lunga durata (`grep`, `glob`, `htmlToMarkdown`, `executeShell`, clipboard, operazioni sulle immagini).
- **Export sincroni** per trasformazioni/parser deterministici in memoria (`search`, `hasMatch`, highlighting, larghezza/slicing del testo, parsing dei tasti, query sui processi).
- **Export costruttore** per oggetti runtime con stato (`Shell`, `PtySession`, `PhotonImage`).

Implicazione per i maintainer: modificare la natura sincrona ↔ asincrona di un export esistente è un cambiamento breaking dell'API e del contratto su wrapper e chiamanti.

## Pattern di tipizzazione per oggetti e enum

### Pattern oggetto (oggetti JS in stile `#[napi(object)]`)

TS modella i valori nativi a forma di oggetto come interfacce, ad esempio:

- `GrepResult`, `SearchResult`, `GlobResult`
- `SystemInfo`, `WorkProfile`
- `ClipboardImage`, `ParsedKittyResult`

Questi sono contratti strutturali a compile-time; la correttezza della forma a runtime è responsabilità dell'implementazione nativa.

### Pattern enum

Gli enum numerici nativi sono rappresentati come valori `const enum` in TS:

- `FileType` (`1=file`, `2=dir`, `3=symlink`)
- `ImageFormat` (`0=PNG`, `1=JPEG`, `2=WEBP`, `3=GIF`)
- `SamplingFilter`, `Ellipsis`, `KeyEventType`

I chiamanti vedono membri enum nominati; il confine di binding trasmette numeri.

## Come vengono rilevate le discrepanze

Il rilevamento delle discrepanze avviene su due livelli:

1. **Controlli del contratto TypeScript a compile-time**
   - I wrapper chiamano `native.<name>` rispetto al `NativeBindings` unificato.
   - Chiavi di binding mancanti/rinominate interrompono il type-checking TS nei wrapper.

2. **Validazione a runtime in `validateNative`**
   - Dopo il caricamento, `native.ts` verifica gli export richiesti e lancia un errore se qualcuno manca.
   - Il messaggio di errore include le chiavi mancanti e le istruzioni per la ricompilazione.

Questo intercetta il comune disallineamento da binario obsoleto: il wrapper/tipo esiste ma il `.node` caricato non ha l'export.

## Comportamento in caso di errore e avvertenze

### Errori di caricamento/validazione (errori definitivi)

- Il fallimento del caricamento dell'addon o una piattaforma non supportata lancia un errore durante l'inizializzazione del modulo in `native.ts`.
- Export richiesti mancanti lanciano un errore prima che i wrapper siano utilizzabili.

Effetto: il pacchetto fallisce immediatamente anziché rinviare il fallimento alla prima chiamata.

### Differenze di comportamento a livello di wrapper

- Alcuni wrapper attenuano intenzionalmente i fallimenti (`copyToClipboard` è best effort e sopprime il fallimento nativo).
- Le callback di streaming ignorano i payload di errore della callback e inoltrano solo gli eventi con valore di successo.

### Avvertenze a livello di tipo (il runtime è più rigoroso di TS)

- I campi opzionali TS non garantiscono la validità semantica; il livello nativo può comunque rifiutare valori malformati.
- La tipizzazione `const enum` non impedisce che valori numerici fuori range vengano passati da chiamanti non tipizzati a runtime.
- `validateNative` controlla solo la presenza e la natura di funzione degli export richiesti, non la compatibilità profonda della forma degli argomenti/valori di ritorno.
- `bindings.ts` include `cancelWork(id)` nell'interfaccia base, ma l'attuale lista di validazione a runtime non impone quella chiave.

## Checklist per i maintainer per le modifiche ai binding

Quando si aggiunge/modifica un export, aggiornare tutti i seguenti:

1. `src/<module>/types.ts` (augmentation + tipi del contratto)
2. `src/<module>/index.ts` (comportamento del wrapper)
3. Import in `src/native.ts` per i tipi del modulo (se nuovo modulo)
4. Controlli degli export richiesti in `validateNative`
5. Ri-esportazioni pubbliche in `src/index.ts`

Saltare qualsiasi passaggio crea disallineamento a compile-time o fallimento a runtime durante il caricamento.
