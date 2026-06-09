---
title: Portare su pi-natives (N-API) — Note operative
description: >-
  Note operative per la migrazione di codice Node.js child_process e shell al
  livello nativo Rust N-API.
sidebar:
  order: 9
  label: Portare su pi-natives
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# Portare su pi-natives (N-API) — Note operative

Questa è una guida pratica per spostare i percorsi critici in `crates/pi-natives` e collegarli attraverso i binding JS. Esiste per evitare di ripetere gli stessi errori.

## Quando effettuare il porting

Effettuate il porting quando una qualsiasi di queste condizioni è vera:

- Il percorso critico viene eseguito nei cicli di rendering, aggiornamenti UI frequenti o batch di grandi dimensioni.
- Le allocazioni JS dominano (rotazione di stringhe, backtracking di regex, array di grandi dimensioni).
- Avete già una baseline JS e potete fare benchmark di entrambe le versioni affiancate.
- Il lavoro è CPU-bound o I/O bloccante che può essere eseguito sul thread pool di libuv.
- Il lavoro è I/O asincrono che può essere eseguito sul runtime di Tokio (es. esecuzione shell).

Evitate i porting che dipendono da stato esclusivamente JS o import dinamici. Gli export N-API dovrebbero essere puri, dati-in/dati-out. Il lavoro di lunga durata dovrebbe passare attraverso `task::blocking` (CPU-bound/I/O bloccante) o `task::future` (I/O asincrono) con cancellazione.

## Anatomia di un export nativo

**Lato Rust:**

- L'implementazione risiede in `crates/pi-natives/src/<module>.rs`. Se aggiungete un nuovo modulo, registratelo in `crates/pi-natives/src/lib.rs`.
- Esportate con `#[napi]`; gli export in snake_case vengono convertiti automaticamente in camelCase. Usate `js_name` esplicito solo per veri alias/nomi non predefiniti. Usate `#[napi(object)]` per le struct.
- Usate `task::blocking(tag, cancel_token, work)` (vedi `crates/pi-natives/src/task.rs`) per lavoro CPU-bound o bloccante. Usate `task::future(env, tag, work)` per lavoro asincrono che necessita di Tokio (es. sessioni shell). Passate un `CancelToken` quando esponete `timeoutMs` o `AbortSignal`.

**Lato JS:**

- `packages/natives/src/bindings.ts` contiene l'interfaccia base `NativeBindings`.
- `packages/natives/src/<module>/types.ts` definisce i tipi TS e estende `NativeBindings` tramite declaration merging.
- `packages/natives/src/native.ts` importa ogni file `<module>/types.ts` per attivare le dichiarazioni.
- `packages/natives/src/<module>/index.ts` avvolge il binding `native` da `packages/natives/src/native.ts`.
- `packages/natives/src/native.ts` carica l'addon e `validateNative` applica gli export richiesti.
- `packages/natives/src/index.ts` ri-esporta il wrapper per i chiamanti in `packages/*`.

## Checklist per il porting

1. **Aggiungere l'implementazione Rust**

- Inserite la logica principale in una funzione Rust semplice.
- Se è un nuovo modulo, aggiungetelo a `crates/pi-natives/src/lib.rs`.
- Esponetelo con `#[napi]` in modo che la mappatura predefinita snake_case -> camelCase rimanga coerente.
- Mantenete le firme owned e semplici: `String`, `Vec<String>`, `Uint8Array`, oppure `Either<JsString, Uint8Array>` per input di stringhe/byte di grandi dimensioni.
- Per lavoro CPU-bound o bloccante, usate `task::blocking`; per lavoro asincrono, usate `task::future`. Passate un `CancelToken` e chiamate `heartbeat()` all'interno di loop lunghi.

2. **Collegare i binding JS**

- Aggiungete i tipi e l'estensione di `NativeBindings` in `packages/natives/src/<module>/types.ts`.
- Importate `./<module>/types` in `packages/natives/src/native.ts` per attivare il declaration merging.
- Aggiungete un wrapper in `packages/natives/src/<module>/index.ts` che chiama `native`.
- Ri-esportate da `packages/natives/src/index.ts`.

3. **Aggiornare la validazione nativa**

- Aggiungete `checkFn("newExport")` in `validateNative` (`packages/natives/src/native.ts`).

4. **Aggiungere i benchmark**

- Posizionate i benchmark accanto al pacchetto proprietario (`packages/tui/bench`, `packages/natives/bench`, o `packages/coding-agent/bench`).
- Includete una baseline JS e la versione nativa nella stessa esecuzione.
- Usate `Bun.nanoseconds()` e un conteggio di iterazioni fisso.
- Mantenete gli input del benchmark piccoli e realistici (dati reali osservati nel percorso critico).

5. **Compilare il binario nativo**

- `bun --cwd=packages/natives run build`
- Usate `bun --cwd=packages/natives run build` e impostate `PI_DEV=1` se volete la diagnostica del loader durante i test.

6. **Eseguire il benchmark**

- `bun run packages/<pkg>/bench/<bench>.ts` (oppure `bun --cwd=packages/natives run bench`)

7. **Decidere sull'utilizzo**

- Se il nativo è più lento, **mantenete JS** e lasciate l'export nativo inutilizzato.
- Se il nativo è più veloce, cambiate i punti di chiamata al wrapper nativo.

## Punti critici e come evitarli

### 1) `pi_natives.node` obsoleto impedisce nuovi export

Il loader preferisce il binario con tag piattaforma in `packages/natives/native` (`pi_natives.<platform>-<arch>.node`). `PI_DEV=1` ora abilita solo la diagnostica del loader; non passa più a un nome file addon separato per lo sviluppo. Esiste anche un fallback `pi_natives.node`. I binari compilati vengono estratti in `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node`. Se uno qualsiasi di questi è obsoleto, gli export non si aggiorneranno.

**Soluzione:** rimuovete il file obsoleto prima di ricompilare.

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

Se state eseguendo un binario compilato, eliminate la directory dell'addon in cache:

```bash
rm -rf ~/.xcsh/natives/<version>
```

Poi verificate che l'export esista nel binario:

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) Errori "Missing exports" da `validateNative`

Questo è **positivo** — previene disallineamenti silenziosi. Quando vedete questo:

```
Native addon missing exports ... Missing: visibleWidth
```

significa che il vostro binario è obsoleto, il nome dell'export Rust (o l'alias esplicito quando usato) non corrisponde al nome JS, oppure l'export non è mai stato compilato. Correggete la build e il disallineamento dei nomi, non indebolite la validazione.

### 3) Disallineamento della firma Rust

Mantenetela semplice e owned. `String`, `Vec<String>` e `Uint8Array` funzionano. Evitate riferimenti come `&str` negli export pubblici. Se avete bisogno di dati strutturati, avvolgeteli in struct `#[napi(object)]`.

### 4) Errori nel benchmarking

- Non confrontate input o allocazioni diverse.
- Mantenete JS e nativo con array di input identici.
- Eseguite entrambi nello stesso file di benchmark per evitare distorsioni.

## Template per benchmark

```ts
const ITERATIONS = 2000;

function bench(name: string, fn: () => void): number {
 const start = Bun.nanoseconds();
 for (let i = 0; i < ITERATIONS; i++) fn();
 const elapsed = (Bun.nanoseconds() - start) / 1e6;
 console.log(`${name}: ${elapsed.toFixed(2)}ms total (${(elapsed / ITERATIONS).toFixed(6)}ms/op)`);
 return elapsed;
}

bench("feature/js", () => {
 jsImpl(sample);
});

bench("feature/native", () => {
 nativeImpl(sample);
});
```

## Checklist di verifica

- `validateNative` passa (nessun export mancante).
- `NativeBindings` è esteso in `packages/natives/src/<module>/types.ts` e il wrapper è ri-esportato in `packages/natives/src/index.ts`.
- `Object.keys(require(...))` include il vostro nuovo export.
- I numeri del benchmark sono registrati nella PR/note.
- Il punto di chiamata è aggiornato **solo se** il nativo è più veloce o equivalente.

## Regola generale

- Se il nativo è più lento, **non cambiate**. Mantenete l'export per lavoro futuro, ma la TUI dovrebbe restare sul percorso più veloce.
- Se il nativo è più veloce, cambiate il punto di chiamata e mantenete il benchmark attivo per individuare regressioni.
