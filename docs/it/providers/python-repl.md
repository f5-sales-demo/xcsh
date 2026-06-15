---
title: Strumento Python e Runtime IPython
description: >-
  Runtime dello strumento Python REPL con gestione del kernel IPython,
  esecuzione e acquisizione dell'output.
sidebar:
  order: 3
  label: Python e IPython
i18n:
  sourceHash: 70f0a034ecef
  translator: machine
---

# Strumento Python e Runtime IPython

Questo documento descrive l'attuale stack di esecuzione Python in `packages/coding-agent`.
Copre il comportamento degli strumenti, il ciclo di vita del kernel/gateway, la gestione dell'ambiente, la semantica di esecuzione, il rendering dell'output e le modalità di errore operative.

## Ambito e file principali

- Superficie dello strumento: `src/tools/python.ts`
- Orchestrazione del kernel per sessione/chiamata: `src/ipy/executor.ts`
- Protocollo kernel + integrazione gateway: `src/ipy/kernel.ts`
- Coordinatore gateway locale condiviso: `src/ipy/gateway-coordinator.ts`
- Renderer in modalità interattiva per esecuzioni Python avviate dall'utente: `src/modes/components/python-execution.ts`
- Filtraggio del runtime/ambiente e risoluzione di Python: `src/ipy/runtime.ts`

## Cos'è lo strumento Python

Lo strumento `python` esegue una o più celle Python tramite un kernel supportato da Jupyter Kernel Gateway (e non avviando `python -c` direttamente per ogni cella).

Parametri dello strumento:

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // secondi, limitato a 1..600, predefinito 30
  cwd?: string;
  reset?: boolean; // reimposta il kernel prima della prima cella soltanto
}
```

Lo strumento è `concurrency = "exclusive"` per una sessione, quindi le chiamate non si sovrappongono.

## Ciclo di vita del gateway

### Modalità

Esistono due percorsi di gateway:

1. **Gateway esterno** (`PI_PYTHON_GATEWAY_URL` impostato)
   - Utilizza direttamente l'URL configurato.
   - Autenticazione opzionale con `PI_PYTHON_GATEWAY_TOKEN`.
   - Nessun processo gateway locale viene avviato o gestito.

2. **Gateway locale condiviso** (percorso predefinito)
   - Utilizza un singolo processo condiviso coordinato sotto `~/.xcsh/agent/python-gateway`.
   - File di metadati: `gateway.json`
   - File di blocco: `gateway.lock`
   - Comando di avvio:
     - `python -m kernel_gateway`
     - associato a `127.0.0.1:<porta-allocata>`
     - controllo di integrità all'avvio: `GET /api/kernelspecs`

### Coordinamento del gateway locale condiviso

`acquireSharedGateway()`:

- Acquisisce un blocco file (`gateway.lock`) con heartbeat.
- Riutilizza `gateway.json` se il PID è attivo e il controllo di integrità viene superato.
- Pulisce le informazioni/PID non aggiornati quando necessario.
- Avvia un nuovo gateway quando non ne esiste uno integro.

`releaseSharedGateway()` è attualmente un'operazione vuota (l'arresto del kernel non smonta il gateway condiviso).

`shutdownSharedGateway()` termina esplicitamente il processo condiviso e cancella i metadati del gateway.

### Vincolo importante

`python.sharedGateway=false` viene rifiutato all'avvio del kernel:

- Errore: `Shared Python gateway required; local gateways are disabled`
- Non esiste una modalità gateway locale non condivisa per processo.

## Ciclo di vita del kernel

Ogni esecuzione utilizza un kernel creato tramite `POST /api/kernels` sul gateway selezionato.

Sequenza di avvio del kernel:

1. Controllo di disponibilità (`checkPythonKernelAvailability`)
2. Creazione del kernel (`/api/kernels`)
3. Apertura del websocket (`/api/kernels/:id/channels`)
4. Inizializzazione dell'ambiente del kernel (`cwd`, variabili d'ambiente, `sys.path`)
5. Esecuzione di `PYTHON_PRELUDE`
6. Caricamento dei moduli di estensione da:
   - utente: `~/.xcsh/agent/modules/*.py`
   - progetto: `<cwd>/.xcsh/modules/*.py` (sovrascrive i moduli utente con lo stesso nome)

Arresto del kernel:

- Elimina il kernel remoto tramite `DELETE /api/kernels/:id`
- Chiude il websocket
- Richiama l'hook di rilascio del gateway condiviso (oggi un'operazione vuota)

## Semantica di persistenza della sessione

`python.kernelMode` controlla il riutilizzo del kernel:

- `session` (predefinito)
  - Riutilizza le sessioni del kernel identificate da identità di sessione + cwd.
  - L'esecuzione è serializzata per sessione tramite una coda.
  - Le sessioni inattive vengono eliminate dopo 5 minuti.
  - Al massimo 4 sessioni; la più vecchia viene eliminata in caso di overflow.
  - I controlli heartbeat rilevano i kernel non più attivi.
  - Il riavvio automatico è consentito una volta; crash ripetuti => errore definitivo.

- `per-call`
  - Crea un kernel nuovo per ogni richiesta di esecuzione.
  - Arresta il kernel al termine della richiesta.
  - Nessuna persistenza dello stato tra chiamate diverse.

### Comportamento multi-cella in una singola chiamata allo strumento

Le celle vengono eseguite sequenzialmente nella stessa istanza del kernel per quella chiamata allo strumento.

Se una cella intermedia fallisce:

- Lo stato delle celle precedenti rimane in memoria.
- Lo strumento restituisce un errore mirato che indica quale cella ha avuto esito negativo.
- Le celle successive non vengono eseguite.

`reset=true` si applica solo alla prima esecuzione di cella in quella chiamata.

## Filtraggio dell'ambiente e risoluzione del runtime

L'ambiente viene filtrato prima di avviare il runtime gateway/kernel:

- La lista di permessi include variabili fondamentali come `PATH`, `HOME`, variabili di localizzazione, `VIRTUAL_ENV`, `PYTHONPATH`, ecc.
- Prefissi consentiti: `LC_`, `XDG_`, `PI_`
- La lista di negazione rimuove le chiavi API comuni (OpenAI/Anthropic/Gemini/ecc.)

Ordine di selezione del runtime:

1. Venv attivo/localizzato (`VIRTUAL_ENV`, poi `<cwd>/.venv`, `<cwd>/venv`)
2. Venv gestito in `~/.xcsh/python-env`
3. `python` o `python3` nel PATH

Quando viene selezionato un venv, il suo percorso bin/Scripts viene preposto a `PATH`.

L'inizializzazione dell'ambiente del kernel in Python esegue anche:

- `os.chdir(cwd)`
- inietta la mappa di ambiente fornita in `os.environ`
- garantisce che cwd sia in `sys.path`

## Disponibilità dello strumento e selezione della modalità

`python.toolMode` (predefinito `both`) + eventuale override `PI_PY` controlla l'esposizione:

- `ipy-only`
- `bash-only`
- `both`

Valori accettati da `PI_PY`:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

Se il preflight di Python fallisce, la creazione dello strumento si degrada a bash-only per quella sessione.

## Flusso di esecuzione e cancellazione/timeout

### Timeout a livello di strumento

Il timeout dello strumento `python` è in secondi, predefinito 30, limitato a `1..600`.

Lo strumento combina:

- segnale di interruzione del chiamante
- segnale di interruzione per timeout

con `AbortSignal.any(...)`.

### Cancellazione dell'esecuzione del kernel

In caso di interruzione/timeout:

- L'esecuzione viene contrassegnata come annullata.
- L'interruzione del kernel viene tentata tramite REST (`POST /interrupt`) e il canale di controllo `interrupt_request`.
- Il risultato include `cancelled=true`.
- Il percorso di timeout annota l'output come `Command timed out after <n> seconds`.

### Comportamento di stdin

Lo stdin interattivo non è supportato.

Se il kernel emette `input_request`:

- Lo strumento registra `stdinRequested=true`
- Emette un testo esplicativo
- Invia una `input_reply` vuota
- L'esecuzione viene trattata come un errore a livello di executor

## Acquisizione e rendering dell'output

### Classi di output acquisite

Dai messaggi del kernel:

- `stream` -> porzioni di testo semplice
- `display_data`/`execute_result` -> gestione della visualizzazione ricca
- `error` -> testo del traceback
- MIME personalizzato `application/x-xcsh-status` -> eventi di stato strutturati

Precedenza MIME per la visualizzazione:

1. `text/markdown`
2. `text/plain`
3. `text/html` (convertito in markdown di base)

Acquisiti inoltre come output strutturati:

- `application/json` -> dati ad albero JSON
- `image/png` -> payload di immagini
- `application/x-xcsh-status` -> eventi di stato

### Archiviazione e troncamento

L'output viene trasmesso in streaming tramite `OutputSink` e può essere salvato nell'archiviazione degli artefatti.

I risultati degli strumenti possono includere metadati di troncamento e `artifact://<id>` per il recupero dell'output completo.

### Comportamento del renderer

- Renderer dello strumento (`python.ts`):
  - mostra blocchi di celle di codice con stato per cella
  - l'anteprima compressa mostra per impostazione predefinita 10 righe
  - supporta la modalità espansa per l'output completo e dettagli di stato più ricchi
- Renderer interattivo (`python-execution.ts`):
  - utilizzato per l'esecuzione Python avviata dall'utente nell'interfaccia TUI
  - l'anteprima compressa mostra per impostazione predefinita 20 righe
  - limita le singole righe molto lunghe a 4000 caratteri per la sicurezza della visualizzazione
  - mostra avvisi di cancellazione/errore/troncamento

## Supporto gateway esterno

Impostare:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# Opzionale:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

Differenze di comportamento rispetto al gateway locale condiviso:

- Nessun file di blocco/informazioni gateway locale
- Nessun avvio/terminazione di processi locali
- I controlli di integrità e le operazioni CRUD del kernel vengono eseguiti sull'endpoint esterno
- Gli errori di autenticazione vengono visualizzati con una guida esplicita sul token

## Risoluzione dei problemi operativi (modalità di errore attuali)

- **Strumento Python non disponibile**
  - Verificare `python.toolMode` / `PI_PY`.
  - Se il preflight fallisce, il runtime torna a bash-only.

- **Errori di disponibilità del kernel**
  - La modalità locale richiede che sia `kernel_gateway` che `ipykernel` siano importabili nel runtime Python risolto.
  - Installare con:

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` causa un errore di avvio**
  - Questo è il comportamento previsto con l'implementazione attuale.

- **Errori di autenticazione/raggiungibilità del gateway esterno**
  - 401/403 -> impostare `PI_PYTHON_GATEWAY_TOKEN`.
  - timeout/non raggiungibile -> verificare URL/rete e integrità del gateway.

- **L'esecuzione si blocca e va in timeout**
  - Aumentare il `timeout` dello strumento (max 600s) se il carico di lavoro è legittimo.
  - Per il codice bloccato, la cancellazione attiva l'interruzione del kernel, ma il codice utente potrebbe comunque richiedere un refactoring.

- **Prompt stdin/input nel codice Python**
  - `input()` non è supportato in modo interattivo in questo percorso di runtime; passare i dati in modo programmatico.

- **Esaurimento delle risorse (`EMFILE` / troppi file aperti)**
  - Il gestore delle sessioni avvia il ripristino del gateway condiviso (smontaggio della sessione + riavvio del gateway condiviso).

- **Errori della directory di lavoro**
  - Lo strumento verifica che `cwd` esista e sia una directory prima dell'esecuzione.

## Variabili d'ambiente pertinenti

- `PI_PY` — override dell'esposizione dello strumento (mappatura `bash-only`/`ipy-only`/`both` descritta sopra)
- `PI_PYTHON_GATEWAY_URL` — utilizza un gateway esterno
- `PI_PYTHON_GATEWAY_TOKEN` — token di autenticazione opzionale per il gateway esterno
- `PI_PYTHON_SKIP_CHECK=1` — ignora i controlli di preflight/riscaldamento di Python
- `PI_PYTHON_IPC_TRACE=1` — registra le tracce di invio/ricezione IPC del kernel
- `PI_DEBUG_STARTUP=1` — emette marcatori di debug della fase di avvio
