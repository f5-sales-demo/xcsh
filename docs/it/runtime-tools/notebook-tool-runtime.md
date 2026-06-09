---
title: Internals del Runtime dello Strumento Notebook
description: >-
  Runtime dello strumento notebook Jupyter con esecuzione delle celle, ciclo di
  vita del kernel e rendering dell'output.
sidebar:
  order: 2
  label: Strumento notebook
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# Internals del runtime dello strumento notebook

Questo documento descrive l'attuale implementazione dello strumento `notebook` e la sua relazione con il runtime Python supportato dal kernel.

La distinzione critica: **`notebook` è un editor JSON per notebook, non un esecutore di notebook**. Modifica i sorgenti delle celle `.ipynb` direttamente; non avvia né comunica con un kernel Python.

## File di implementazione

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) Confine del runtime: modifica vs esecuzione

## Strumento `notebook` (`src/tools/notebook.ts`)

- Supporta `action: edit | insert | delete` su un file `.ipynb`.
- Risolve il percorso relativo alla CWD della sessione (`resolveToCwd`).
- Carica il JSON del notebook, valida l'array `cells`, valida i limiti di `cell_index`.
- Applica le modifiche al sorgente in memoria e riscrive l'intero JSON del notebook con `JSON.stringify(notebook, null, 1)`.
- Restituisce un riepilogo testuale + `details` strutturati (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`).

Non esiste alcun ciclo di vita del kernel in questo strumento:

- nessuna acquisizione del gateway
- nessun ID di sessione del kernel
- nessun `execute_request`
- nessun chunk di stream dai canali del kernel
- nessuna cattura di display ricchi (`image/png`, display JSON, MIME di stato)

## Percorso di esecuzione stile notebook (`src/tools/python.ts` + `src/ipy/*`)

Quando l'agente deve eseguire codice Python in stile celle (celle sequenziali, stato persistente, display ricchi), ciò passa attraverso lo strumento **`python`**, non `notebook`.

Quel percorso è dove risiedono le modalità del kernel, il comportamento di riavvio/annullamento, lo streaming dei chunk e il troncamento degli artefatti di output.

## 2) Semantica di gestione delle celle del notebook (strumento `notebook`)

## Normalizzazione del sorgente

`content` viene diviso in `source: string[]` con preservazione dei newline:

- ogni riga non finale mantiene il `\n` finale
- la riga finale non ha un newline finale forzato

Questo rispecchia le convenzioni JSON dei notebook e evita la concatenazione accidentale delle righe nelle modifiche successive.

## Comportamento delle azioni

- `edit`
  - sostituisce `cells[cell_index].source`
  - preserva il `cell_type` esistente
- `insert`
  - inserisce nella posizione `[0..cellCount]`
  - `cell_type` predefinito a `code`
  - le celle di codice inizializzano `execution_count: null` e `outputs: []`
  - le celle markdown inizializzano solo `metadata` + `source`
- `delete`
  - rimuove `cells[cell_index]`
  - restituisce il `source` rimosso nei dettagli per l'anteprima del renderer

## Superfici di errore

Vengono lanciati errori hard per:

- file notebook mancante
- JSON non valido
- `cells` mancante o non-array
- indice fuori range (insert e non-insert hanno range validi diversi)
- `content` mancante per `edit`/`insert`

Questi diventano risposte dello strumento `Error:` a monte; il renderer usa il percorso del notebook + testo di errore formattato.

## 3) Semantica della sessione kernel (dove effettivamente esistono)

La semantica del kernel è implementata in `executePython` / `PythonKernel` e si applica allo strumento `python`.

## Modalità

`PythonKernelMode`:

- `session` (predefinita)
  - kernel memorizzati nella cache nella mappa `kernelSessions`
  - massimo 4 sessioni; la più vecchia viene sfrattata al superamento
  - pulizia idle/dead ogni 30s, timeout dopo 5 minuti
  - la coda per sessione serializza l'esecuzione (`session.queue`)
- `per-call`
  - crea il kernel per la richiesta
  - esegue
  - spegne sempre il kernel nel `finally`

## Comportamento di reset

Lo strumento `python` passa `reset` solo per la prima cella in una chiamata multi-cella; le celle successive vengono sempre eseguite con `reset: false`.

## Morte del kernel / riavvio / retry

In modalità sessione (`withKernelSession`):

- il kernel morto viene rilevato dall'heartbeat (controllo `kernel.isAlive()` ogni 5s) o dal fallimento dell'esecuzione.
- lo stato morto pre-esecuzione attiva `restartKernelSession`.
- il percorso di crash in fase di esecuzione riprova una volta: riavvia il kernel, riesegue l'handler.
- `restartCount > 1` nella stessa sessione lancia `Python kernel restarted too many times in this session`.

Comportamento di retry all'avvio:

- la creazione del kernel con gateway condiviso riprova una volta su `SharedGatewayCreateError` con HTTP 5xx.

Recupero dall'esaurimento delle risorse:

- rileva errori di tipo `EMFILE`/`ENFILE`/"Too many open files"
- cancella le sessioni tracciate
- chiama `shutdownSharedGateway()`
- riprova la creazione della sessione kernel una volta

## 4) Iniezione di variabili ambiente/sessione

L'avvio del kernel riceve una mappa env opzionale dall'executor:

- `PI_SESSION_FILE` (percorso del file di stato della sessione)
- `ARTIFACTS` (directory degli artefatti)

`PythonKernel.#initializeKernelEnvironment(...)` esegue poi uno script di inizializzazione all'interno del kernel per:

- `os.chdir(cwd)`
- iniettare le voci env in `os.environ`
- anteporre cwd a `sys.path` se mancante

Implicazione:

- gli helper del prelude che leggono il contesto della sessione o degli artefatti dipendono da queste variabili d'ambiente nello stato del processo Python.

## 5) Gestione streaming/chunk e display (percorso supportato dal kernel)

Il client del kernel elabora i messaggi del protocollo Jupyter per ogni esecuzione:

- `stream` -> chunk di testo a `onChunk`
- `execute_result` / `display_data` ->
  - testo di visualizzazione scelto per precedenza MIME: `text/markdown` > `text/plain` > `text/html` convertito
  - output strutturati catturati separatamente:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (nessuna emissione di testo)
- `error` -> testo del traceback inviato allo stream dei chunk + metadati di errore strutturati
- `input_request` -> emette testo di avviso stdin, invia `input_reply` vuoto, segna stdin come richiesto
- il completamento attende sia `execute_reply` che `status=idle` del kernel

Annullamento/timeout:

- il segnale di abort attiva `interrupt()` (REST `/interrupt` + `interrupt_request` sul canale di controllo)
- il risultato segna `cancelled=true`
- il percorso di timeout annota l'output con `Command timed out after <n> seconds`

## 6) Comportamento di troncamento e artefatti

`OutputSink` in `src/session/streaming-output.ts` è utilizzato dai percorsi di esecuzione del kernel (`executeWithKernel`):

- sanitizza ogni chunk (`sanitizeText`)
- traccia righe e byte totali/di output
- file di spill opzionale per artefatti (`artifactPath`, `artifactId`)
- quando il buffer in memoria supera la soglia (`DEFAULT_MAX_BYTES` se non sovrascritto):
  - segna come troncato
  - mantiene i byte di coda in memoria (confine UTF-8 sicuro)
  - può riversare lo stream completo nel sink degli artefatti

`dump()` restituisce:

- testo di output visibile (possibilmente troncato in coda)
- flag di troncamento + conteggi
- ID artefatto (per riferimenti `artifact://<id>`)

Lo strumento `python` converte questi metadati in notifiche di troncamento del risultato e avvisi TUI.

Lo strumento `notebook` **non** utilizza `OutputSink`; non ha pipeline di troncamento stream/artefatti perché non esegue codice.

## 7) Assunzioni del renderer e formattazione

## Renderer del notebook (`notebookToolRenderer`)

- vista della chiamata: riga di stato con azione + percorso del notebook + metadati cella/tipo
- vista del risultato:
  - riepilogo di successo derivato da `details`
  - `cellSource` renderizzato tramite `renderCodeCell`
  - le celle markdown impostano l'hint di linguaggio `markdown`; le altre celle non hanno override esplicito del linguaggio
  - il limite di anteprima del codice compresso è `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - supporta la modalità espansa tramite opzioni di rendering condivise
  - usa cache di rendering indicizzata per larghezza + stato espanso

Assunzione del rendering degli errori:

- se il primo contenuto testuale inizia con `Error:`, il renderer formatta come blocco di errore del notebook.

## Renderer Python (per l'output di esecuzione effettivo)

Il rendering dell'esecuzione supportata dal kernel si aspetta:

- transizioni di stato per cella (`pending/running/complete/error`)
- sezione opzionale di eventi di stato strutturati
- alberi di output JSON opzionali
- avvisi di troncamento + puntatore opzionale `artifact://<id>`

Questo comportamento del renderer non è correlato ai risultati di modifica JSON del `notebook` eccetto che entrambi riutilizzano primitive TUI condivise.

## 8) Divergenza dal comportamento dello strumento Python semplice

Se per "strumento Python semplice" si intende il percorso di esecuzione `python`:

- `python` esegue codice in un kernel, persiste lo stato per modalità, effettua lo streaming dei chunk, cattura display ricchi, gestisce interrupt/timeout, e supporta troncamento dell'output/artefatti.
- `notebook` esegue solo mutazioni deterministiche del JSON del notebook; nessuna esecuzione, nessuno stato del kernel, nessuno stream di chunk, nessun output di display, nessuna pipeline di artefatti.

Se un workflow necessita di entrambi:

1. modificare il sorgente del notebook con `notebook`
2. eseguire le celle di codice tramite `python` (passando manualmente il codice), non attraverso `notebook`

L'implementazione attuale non fornisce un singolo strumento che sia muta il `.ipynb` sia esegue le celle del notebook attraverso il contesto del kernel.
