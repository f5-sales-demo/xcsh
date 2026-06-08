---
title: Portare a pi-natives (N-API) — Note sul campo
description: >-
  Note sul campo per la migrazione del codice Node.js child_process e shell al
  layer nativo Rust N-API.
sidebar:
  order: 9
  label: Portare a pi-natives
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# Portare a pi-natives (N-API) — Note sul campo

Questa è una guida pratica per spostare i percorsi critici in `crates/pi-natives` e collegarli attraverso i binding JS. Esiste per evitare che gli stessi errori si ripetano.

## Quando effettuare il porting

Effettuare il porting quando una qualsiasi di queste condizioni è vera:

- Il percorso critico viene eseguito nei cicli di rendering, negli aggiornamenti rapidi dell'UI o in elaborazioni batch di grandi dimensioni.
- Le allocazioni JS dominano (creazione continua di stringhe, backtracking delle regex, array di grandi dimensioni).
- Si dispone già di un baseline JS e si possono confrontare entrambe le versioni fianco a fianco.
- Il lavoro è CPU-bound o I/O bloccante che può essere eseguito sul thread pool di libuv.
- Il lavoro è I/O asincrono che può essere eseguito sul runtime di Tokio (ad esempio, esecuzione shell).

Evitare i porting che dipendono da stato esclusivamente JS o da import dinamici. Le esportazioni N-API dovrebbero essere pure, con dati in ingresso e dati in uscita. Il lavoro di lunga durata dovrebbe passare attraverso `task::blocking` (CPU-bound/I/O bloccante) o `task::future` (I/O asincrono) con cancellazione.

## Anatomia di un'esportazione nativa

**Lato Rust:**

- L'implementazione risiede in `crates/pi-natives/src/<module>.rs`. Se si aggiunge un nuovo modulo, registrarlo in `crates/pi-natives/src/lib.rs`.
- Esportare con `#[napi]`; le esportazioni in snake_case vengono convertite automaticamente in camelCase. Usare `js_name` esplicito solo per veri alias/nomi non predefiniti. Usare `#[napi(object)]` per le struct.
- Usare `task::blocking(tag, cancel_token, work)` (vedere `crates/pi-natives/src/task.rs`) per lavoro CPU-bound o bloccante. Usare `task::future(env, tag, work)` per lavoro asincrono che necessita di Tokio (ad esempio, sessioni shell). Passare un `CancelToken` quando si espone `timeoutMs` o `AbortSignal`.

**Lato JS:**

- `packages/natives/src/bindings.ts` contiene l'interfaccia base `NativeBindings`.
- `packages/natives/src/<module>/types.ts` definisce i tipi TS e augmenta `NativeBindings` tramite declaration merging.
- `packages/natives/src/native.ts` importa ciascun file `<module>/types.ts` per attivare le dichiarazioni.
- `packages/natives/src/<module>/index.ts` wrappa il binding `native` da `packages/natives/src/native.ts`.
- `packages/natives/src/native.ts` carica l'addon e `validateNative` verifica le esportazioni richieste.
- `packages/natives/src/index.ts` ri-esporta il wrapper per i chiamanti in `packages/*`.

## Checklist per il porting

1. **Aggiungere l'implementazione Rust**

- Inserire la logica principale in una funzione Rust pura.
- Se è un nuovo modulo, aggiungerlo a `crates/pi-natives/src/lib.rs`.
- Esporlo con `#[napi]` in modo che la mappatura predefinita snake_case -> camelCase rimanga consistente.
- Mantenere le firme owned e semplici: `String`, `Vec<String>`, `Uint8Array` o `Either<JsString, Uint8Array>` per input di stringhe/byte di grandi dimensioni.
- Per lavoro CPU-bound o bloccante, usare `task::blocking`; per lavoro asincrono, usare `task::future`. Passare un `CancelToken` e chiamare `heartbeat()` all'interno dei cicli lunghi.

2. **Collegare i binding JS**

- Aggiungere i tipi e l'augmentation di `NativeBindings` in `packages/natives/src/<module>/types.ts`.
- Importare `./<module>/types` in `packages/natives/src/native.ts` per attivare il declaration merging.
- Aggiungere un wrapper in `packages/natives/src/<module>/index.ts` che chiama `native`.
- Ri-esportare da `packages/natives/src/index.ts`.

3. **Aggiornare la validazione nativa**

- Aggiungere `checkFn("newExport")` in `validateNative` (`packages/natives/src/native.ts`).

4. **Aggiungere benchmark**

- Posizionare i benchmark accanto al pacchetto proprietario (`packages/tui/bench`, `packages/natives/bench` o `packages/coding-agent/bench`).
- Includere una versione baseline JS e una versione nativa nella stessa esecuzione.
- Usare `Bun.nanoseconds()` e un conteggio di iterazioni fisso.
- Mantenere gli input del benchmark piccoli e realistici (dati effettivi osservati nel percorso critico).

5. **Compilare il binario nativo**

- `bun --cwd=packages/natives run build`
- Usare `bun --cwd=packages/natives run build` e impostare `PI_DEV=1` se si desiderano diagnostiche del loader durante i test.

6. **Eseguire il benchmark**

- `bun run packages/<pkg>/bench/<bench>.ts` (oppure `bun --cwd=packages/natives run bench`)

7. **Decidere sull'utilizzo**

- Se il nativo è più lento, **mantenere JS** e lasciare l'esportazione nativa inutilizzata.
- Se il nativo è più veloce, passare i punti di chiamata al wrapper nativo.

## Punti critici e come evitarli

### 1) `pi_natives.node` obsoleto impedisce le nuove esportazioni

Il loader preferisce il binario con tag della piattaforma in `packages/natives/native` (`pi_natives.<platform>-<arch>.node`). `PI_DEV=1` ora abilita solo le diagnostiche del loader; non passa più a un nome file addon di sviluppo separato. Esiste anche un fallback `pi_natives.node`. I binari compilati vengono estratti in `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node`. Se uno qualsiasi di questi è obsoleto, le esportazioni non si aggiorneranno.

**Soluzione:** rimuovere il file obsoleto prima di ricompilare.

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

Se si sta eseguendo un binario compilato, eliminare la directory dell'addon in cache:

```bash
rm -rf ~/.xcsh/natives/<version>
```

Quindi verificare che l'esportazione esista nel binario:

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) Errori "Missing exports" da `validateNative`

Questo è **positivo** — previene disallineamenti silenti. Quando si vede questo:

```
Native addon missing exports ... Missing: visibleWidth
```

significa che il binario è obsoleto, il nome dell'esportazione Rust (o l'alias esplicito quando usato) non corrisponde al nome JS, oppure l'esportazione non è mai stata compilata. Correggere la build e il disallineamento dei nomi, non indebolire la validazione.

### 3) Mismatch della firma Rust

Mantenerla semplice e owned. `String`, `Vec<String>` e `Uint8Array` funzionano. Evitare riferimenti come `&str` nelle esportazioni pubbliche. Se si necessita di dati strutturati, avvolgerli in struct `#[napi(object)]`.

### 4) Errori nei benchmark

- Non confrontare input o allocazioni diverse.
- Mantenere JS e nativo con array di input identici.
- Eseguire entrambi nello stesso file di benchmark per evitare scostamenti.

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

- `validateNative` passa (nessuna esportazione mancante).
- `NativeBindings` è augmentato in `packages/natives/src/<module>/types.ts` e il wrapper è ri-esportato in `packages/natives/src/index.ts`.
- `Object.keys(require(...))` include la nuova esportazione.
- Numeri dei benchmark registrati nella PR/note.
- Punto di chiamata aggiornato **solo se** il nativo è più veloce o equivalente.

## Regola generale

- Se il nativo è più lento, **non effettuare il passaggio**. Mantenere l'esportazione per lavoro futuro, ma la TUI dovrebbe rimanere sul percorso più veloce.
- Se il nativo è più veloce, passare al punto di chiamata nativo e mantenere il benchmark attivo per intercettare regressioni.
