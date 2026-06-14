---
title: Componenti interni del runtime dello strumento Notebook
description: >-
  Runtime dello strumento Jupyter notebook con esecuzione delle celle, ciclo di
  vita del kernel e rendering dell'output.
sidebar:
  order: 2
  label: Strumento Notebook
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# Componenti interni del runtime dello strumento Notebook

Questo documento descrive l'implementazione corrente dello strumento `notebook` e la sua relazione con il runtime Python supportato dal kernel.

La distinzione fondamentale: **`notebook` è un editor JSON di notebook, non un esecutore di notebook**. Modifica direttamente i sorgenti delle celle `.ipynb`; non avvia né comunica con un kernel Python.

## File di implementazione

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) Confine di runtime: modifica vs esecuzione

## Strumento `notebook` (`src/tools/notebook.ts`)

- Supporta `action: edit | insert | delete` su un file `.ipynb`.
- Risolve il percorso relativo alla CWD della sessione (`resolveToCwd`).
- Carica il JSON del notebook, valida l'array `cells`, valida i limiti di `cell_index`.
- Applica le modifiche ai sorgenti in memoria e riscrive il JSON completo del notebook con `JSON.stringify(notebook, null, 1)`.
- Restituisce un riepilogo testuale e `details` strutturati (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`).

In questo strumento non esiste alcun ciclo di vita del kernel:

- nessuna acquisizione del gateway
- nessun ID di sessione del kernel
- nessun `execute_request`
- nessun chunk di stream dai canali del kernel
- nessuna cattura di display rich (`image/png`, display JSON, status MIME)

## Percorso di esecuzione simile a notebook (`src/tools/python.ts` + `src/ipy/*`)

Quando l'agente deve eseguire codice Python in stile celle (celle sequenziali, stato persistente, display rich), ciò avviene attraverso lo strumento **`python`**, non `notebook`.

È in quel percorso che risiedono le modalità del kernel, il comportamento di restart/cancel, lo streaming dei chunk e il troncamento degli artefatti di output.

## 2) Semantica di gestione delle celle del notebook (strumento `notebook`)

## Normalizzazione dei sorgenti

`content` viene suddiviso in `source: string[]` con preservazione delle interruzioni di riga:

- ogni riga non finale mantiene il `\n` finale
- l'ultima riga non ha una newline finale forzata

Questo rispecchia le convenzioni JSON dei notebook ed evita la concatenazione accidentale di righe nelle modifiche successive.

## Comportamento delle azioni

- `edit`
  - sostituisce `cells[cell_index].source`
  - preserva il `cell_type` esistente
- `insert`
  - inserisce in `[0..cellCount]`
  - `cell_type` predefinito è `code`
  - le celle di codice inizializzano `execution_count: null` e `outputs: []`
  - le celle markdown inizializzano solo `metadata` + `source`
- `delete`
  - rimuove `cells[cell_index]`
  - restituisce il `source` rimosso in details per l'anteprima del renderer

## Superfici di errore

Vengono sollevati errori critici per:

- file notebook mancante
- JSON non valido
- `cells` mancante o non array
- indice fuori intervallo (inserimento e non inserimento hanno intervalli validi diversi)
- `content` mancante per `edit`/`insert`

Questi diventano risposte di strumento `Error:` a monte; il renderer utilizza il percorso del notebook e il testo dell'errore formattato.

## 3) Semantica delle sessioni del kernel (dove esistono effettivamente)

La semantica del kernel è implementata in `executePython` / `PythonKernel` e si applica allo strumento `python`.

## Modalità

`PythonKernelMode`:

- `session` (predefinita)
  - kernel memorizzati nella mappa `kernelSessions`
  - massimo 4 sessioni; quella più vecchia viene eliminata in caso di overflow
  - pulizia idle/dead ogni 30 secondi, timeout dopo 5 minuti
  - la coda per sessione serializza l'esecuzione (`session.queue`)
- `per-call`
  - crea il kernel per la richiesta
  - esegue
  - arresta sempre il kernel in `finally`

## Comportamento di reset

Lo strumento `python` passa `reset` solo per la prima cella in una chiamata multi-cella; le celle successive vengono sempre eseguite con `reset: false`.

## Morte del kernel / restart / retry

In modalità sessione (`withKernelSession`):

- il kernel morto viene rilevato tramite heartbeat (controllo `kernel.isAlive()` ogni 5 secondi) o da un errore di esecuzione.
- lo stato morto pre-esecuzione attiva `restartKernelSession`.
- il percorso di crash durante l'esecuzione riprova una volta: riavvia il kernel, riesegue l'handler.
- `restartCount > 1` nella stessa sessione genera `Python kernel restarted too many times in this session`.

Comportamento di retry all'avvio:

- la creazione del kernel sul gateway condiviso riprova una volta su `SharedGatewayCreateError` con HTTP 5xx.

Recupero da esaurimento delle risorse:

- rileva errori di tipo `EMFILE`/`ENFILE`/"Too many open files"
- cancella le sessioni tracciate
- chiama `shutdownSharedGateway()`
- riprova la creazione della sessione del kernel una volta

## 4) Iniezione di variabili di ambiente/sessione

All'avvio del kernel viene passata una mappa env opzionale dall'esecutore:

- `PI_SESSION_FILE` (percorso del file di stato della sessione)
- `ARTIFACTS` (directory degli artefatti)

`PythonKernel.#initializeKernelEnvironment(...)` esegue quindi uno script di inizializzazione all'interno del kernel per:

- `os.chdir(cwd)`
- iniettare le voci env in `os.environ`
- anteporre cwd a `sys.path` se mancante

Implicazione:

- gli helper di preludio che leggono il contesto di sessione o artefatto si basano su queste variabili env nello stato del processo Python.

## 5) Gestione dello streaming/chunk e dei display (percorso supportato dal kernel)

Il client del kernel elabora i messaggi del protocollo Jupyter per ogni esecuzione:

- `stream` -> chunk di testo verso `onChunk`
- `execute_result` / `display_data` ->
  - testo del display scelto per precedenza MIME: `text/markdown` > `text/plain` > `text/html` convertito
  - output strutturati catturati separatamente:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (nessuna emissione di testo)
- `error` -> testo del traceback inviato allo stream di chunk + metadati di errore strutturati
- `input_request` -> emette testo di avviso stdin, invia `input_reply` vuoto, contrassegna stdin come richiesto
- il completamento attende sia `execute_reply` che `status=idle` del kernel

Cancellazione/timeout:

- il segnale di interruzione attiva `interrupt()` (REST `/interrupt` + `interrupt_request` sul canale di controllo)
- il risultato è contrassegnato con `cancelled=true`
- il percorso di timeout annota l'output con `Command timed out after <n> seconds`

## 6) Comportamento di troncamento e artefatti

`OutputSink` in `src/session/streaming-output.ts` è utilizzato dai percorsi di esecuzione del kernel (`executeWithKernel`):

- sanifica ogni chunk (`sanitizeText`)
- tiene traccia del totale di righe, righe di output e byte
- file di spill opzionale per artefatti (`artifactPath`, `artifactId`)
- quando il buffer in memoria supera la soglia (`DEFAULT_MAX_BYTES` a meno che non sia sovrascritto):
  - contrassegna come troncato
  - mantiene in memoria i byte finali (confine UTF-8 sicuro)
  - può riversare lo stream completo nel sink degli artefatti

`dump()` restituisce:

- testo dell'output visibile (possibilmente troncato dalla coda)
- flag di troncamento + conteggi
- ID artefatto (per riferimenti `artifact://<id>`)

Lo strumento `python` converte questi metadati in avvisi di troncamento del risultato e avvisi TUI.

Lo strumento `notebook` **non** utilizza `OutputSink`; non dispone di pipeline di troncamento stream/artefatto perché non esegue codice.

## 7) Assunzioni del renderer e formattazione

## Renderer del notebook (`notebookToolRenderer`)

- vista della chiamata: riga di stato con azione + percorso del notebook + metadati cella/tipo
- vista del risultato:
  - riepilogo del successo derivato da `details`
  - `cellSource` reso tramite `renderCodeCell`
  - le celle markdown impostano il suggerimento di linguaggio `markdown`; le altre celle non hanno override di linguaggio esplicito
  - il limite di anteprima del codice compresso è `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - supporta la modalità espansa tramite opzioni di rendering condivise
  - utilizza la cache di rendering con chiave per larghezza + stato espanso

Assunzione del rendering degli errori:

- se il primo contenuto testuale inizia con `Error:`, il renderer lo formatta come blocco di errore del notebook.

## Renderer Python (per l'output dell'esecuzione effettiva)

Il rendering dell'esecuzione supportata dal kernel prevede:

- transizioni di stato per cella (`pending/running/complete/error`)
- sezione opzionale di eventi di stato strutturati
- alberi di output JSON opzionali
- avvisi di troncamento + puntatore `artifact://<id>` opzionale

Il comportamento di questo renderer non è correlato ai risultati delle modifiche JSON di `notebook`, tranne per il fatto che entrambi riutilizzano primitive TUI condivise.

## 8) Divergenza dal comportamento dello strumento Python semplice

Se per "strumento Python semplice" si intende il percorso di esecuzione `python`:

- `python` esegue il codice in un kernel, persiste lo stato in base alla modalità, effettua lo streaming dei chunk, cattura i display rich, gestisce interrupt/timeout e supporta il troncamento dell'output/artefatti.
- `notebook` esegue solo mutazioni deterministiche del JSON del notebook; nessuna esecuzione, nessuno stato del kernel, nessun stream di chunk, nessun output di display, nessuna pipeline di artefatti.

Se un flusso di lavoro richiede entrambi:

1. modificare i sorgenti del notebook con `notebook`
2. eseguire le celle di codice tramite `python` (passando manualmente il codice), non attraverso `notebook`

L'implementazione attuale non fornisce un singolo strumento che sia in grado di mutare `.ipynb` ed eseguire celle del notebook attraverso il contesto del kernel.
