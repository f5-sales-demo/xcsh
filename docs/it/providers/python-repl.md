---
title: Python Tool e Runtime IPython
description: >-
  Python REPL tool runtime with IPython kernel management, execution, and output
  capture.
sidebar:
  order: 3
  label: Python & IPython
i18n:
  sourceHash: 70f0a034ecef
  translator: machine
---

# Python Tool e Runtime IPython

Questo documento descrive lo stack di esecuzione Python attuale in `packages/coding-agent`.
Copre il comportamento del tool, il ciclo di vita del kernel/gateway, la gestione dell'ambiente, la semantica di esecuzione, il rendering dell'output e le modalità di errore operative.

## Ambito e File Principali

- Superficie del tool: `src/tools/python.ts`
- Orchestrazione kernel per sessione/per chiamata: `src/ipy/executor.ts`
- Protocollo kernel + integrazione gateway: `src/ipy/kernel.ts`
- Coordinatore gateway locale condiviso: `src/ipy/gateway-coordinator.ts`
- Renderer in modalità interattiva per esecuzioni Python attivate dall'utente: `src/modes/components/python-execution.ts`
- Filtraggio runtime/ambiente e risoluzione Python: `src/ipy/runtime.ts`

## Cos'è il tool Python

Il tool `python` esegue una o più celle Python attraverso un kernel supportato da Jupyter Kernel Gateway (non generando `python -c` direttamente per ogni cella).

Parametri del tool:

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // secondi, limitato a 1..600, default 30
  cwd?: string;
  reset?: boolean; // resetta il kernel solo prima della prima cella
}
```

Il tool ha `concurrency = "exclusive"` per una sessione, quindi le chiamate non si sovrappongono.

## Ciclo di vita del Gateway

### Modalità

Esistono due percorsi gateway:

1. **Gateway esterno** (`PI_PYTHON_GATEWAY_URL` impostato)
   - Utilizza direttamente l'URL configurato.
   - Autenticazione opzionale con `PI_PYTHON_GATEWAY_TOKEN`.
   - Nessun processo gateway locale viene generato o gestito.

2. **Gateway locale condiviso** (percorso predefinito)
   - Utilizza un singolo processo condiviso coordinato sotto `~/.xcsh/agent/python-gateway`.
   - File di metadati: `gateway.json`
   - File di lock: `gateway.lock`
   - Comando di avvio:
     - `python -m kernel_gateway`
     - associato a `127.0.0.1:<porta-allocata>`
     - controllo di salute all'avvio: `GET /api/kernelspecs`

### Coordinamento del gateway locale condiviso

`acquireSharedGateway()`:

- Acquisisce un file lock (`gateway.lock`) con heartbeat.
- Riutilizza `gateway.json` se il PID è attivo e il controllo di salute ha esito positivo.
- Pulisce informazioni/PID obsoleti quando necessario.
- Avvia un nuovo gateway quando non ne esiste uno in salute.

`releaseSharedGateway()` è attualmente un no-op (lo shutdown del kernel non chiude il gateway condiviso).

`shutdownSharedGateway()` termina esplicitamente il processo condiviso e cancella i metadati del gateway.

### Vincolo importante

`python.sharedGateway=false` viene rifiutato all'avvio del kernel:

- Errore: `Shared Python gateway required; local gateways are disabled`
- Non esiste una modalità gateway locale non condiviso per processo.

## Ciclo di vita del Kernel

Ogni esecuzione utilizza un kernel creato tramite `POST /api/kernels` sul gateway selezionato.

Sequenza di avvio del kernel:

1. Controllo di disponibilità (`checkPythonKernelAvailability`)
2. Creazione kernel (`/api/kernels`)
3. Apertura websocket (`/api/kernels/:id/channels`)
4. Inizializzazione ambiente kernel (`cwd`, variabili d'ambiente, `sys.path`)
5. Esecuzione di `PYTHON_PRELUDE`
6. Caricamento moduli di estensione da:
   - utente: `~/.xcsh/agent/modules/*.py`
   - progetto: `<cwd>/.xcsh/modules/*.py` (sovrascrive moduli utente con lo stesso nome)

Shutdown del kernel:

- Elimina il kernel remoto tramite `DELETE /api/kernels/:id`
- Chiude il websocket
- Richiama l'hook di rilascio del gateway condiviso (no-op ad oggi)

## Semantica di persistenza della sessione

`python.kernelMode` controlla il riutilizzo del kernel:

- `session` (predefinito)
  - Riutilizza le sessioni kernel identificate dall'identità di sessione + cwd.
  - L'esecuzione è serializzata per sessione tramite una coda.
  - Le sessioni inattive vengono rimosse dopo 5 minuti.
  - Al massimo 4 sessioni; la più vecchia viene rimossa in caso di overflow.
  - I controlli heartbeat rilevano kernel non funzionanti.
  - Il riavvio automatico è consentito una volta; crash ripetuti => errore definitivo.

- `per-call`
  - Crea un kernel nuovo per ogni richiesta di esecuzione.
  - Chiude il kernel dopo la richiesta.
  - Nessuna persistenza di stato tra le chiamate.

### Comportamento multi-cella in una singola chiamata del tool

Le celle vengono eseguite sequenzialmente nella stessa istanza di kernel per quella chiamata del tool.

Se una cella intermedia fallisce:

- Lo stato delle celle precedenti rimane in memoria.
- Il tool restituisce un errore mirato indicando quale cella ha fallito.
- Le celle successive non vengono eseguite.

`reset=true` si applica solo all'esecuzione della prima cella in quella chiamata.

## Filtraggio dell'ambiente e risoluzione del runtime

L'ambiente viene filtrato prima di avviare il runtime gateway/kernel:

- L'allowlist include variabili core come `PATH`, `HOME`, variabili di localizzazione, `VIRTUAL_ENV`, `PYTHONPATH`, ecc.
- Prefissi consentiti: `LC_`, `XDG_`, `PI_`
- La denylist rimuove le chiavi API comuni (OpenAI/Anthropic/Gemini/ecc.)

Ordine di selezione del runtime:

1. Venv attivo/localizzato (`VIRTUAL_ENV`, poi `<cwd>/.venv`, `<cwd>/venv`)
2. Venv gestito in `~/.xcsh/python-env`
3. `python` o `python3` nel PATH

Quando viene selezionato un venv, il suo percorso bin/Scripts viene anteposto a `PATH`.

L'inizializzazione dell'ambiente kernel all'interno di Python inoltre:

- `os.chdir(cwd)`
- inietta la mappa di variabili d'ambiente fornita in `os.environ`
- assicura che cwd sia in `sys.path`

## Disponibilità del tool e selezione della modalità

`python.toolMode` (predefinito `both`) + override opzionale `PI_PY` controlla l'esposizione:

- `ipy-only`
- `bash-only`
- `both`

Valori accettati per `PI_PY`:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

Se il preflight Python fallisce, la creazione del tool degrada a bash-only per quella sessione.

## Flusso di esecuzione e cancellazione/timeout

### Timeout a livello di tool

Il timeout del tool `python` è in secondi, predefinito 30, limitato a `1..600`.

Il tool combina:

- segnale di abort del chiamante
- segnale di abort per timeout

con `AbortSignal.any(...)`.

### Cancellazione dell'esecuzione del kernel

In caso di abort/timeout:

- L'esecuzione viene contrassegnata come cancellata.
- Viene tentato l'interrupt del kernel tramite REST (`POST /interrupt`) e `interrupt_request` sul canale di controllo.
- Il risultato include `cancelled=true`.
- Il percorso di timeout annota l'output come `Command timed out after <n> seconds`.

### Comportamento dello stdin

Lo stdin interattivo non è supportato.

Se il kernel emette `input_request`:

- Il tool registra `stdinRequested=true`
- Emette testo esplicativo
- Invia un `input_reply` vuoto
- L'esecuzione viene trattata come fallimento a livello di executor

## Cattura e rendering dell'output

### Classi di output catturate

Dai messaggi del kernel:

- `stream` -> frammenti di testo semplice
- `display_data`/`execute_result` -> gestione display ricco
- `error` -> testo del traceback
- MIME personalizzato `application/x-xcsh-status` -> eventi di stato strutturati

Precedenza MIME per il display:

1. `text/markdown`
2. `text/plain`
3. `text/html` (convertito in markdown base)

Inoltre catturati come output strutturati:

- `application/json` -> dati ad albero JSON
- `image/png` -> payload di immagini
- `application/x-xcsh-status` -> eventi di stato

### Archiviazione e troncamento

L'output viene trasmesso in streaming attraverso `OutputSink` e può essere persistito nell'archivio degli artefatti.

I risultati del tool possono includere metadati di troncamento e `artifact://<id>` per il recupero dell'output completo.

### Comportamento del renderer

- Renderer del tool (`python.ts`):
  - mostra blocchi di codice-cella con stato per cella
  - l'anteprima compressa ha un valore predefinito di 10 righe
  - supporta la modalità espansa per output completo e dettagli di stato più ricchi
- Renderer interattivo (`python-execution.ts`):
  - utilizzato per l'esecuzione Python attivata dall'utente nella TUI
  - l'anteprima compressa ha un valore predefinito di 20 righe
  - limita le singole righe molto lunghe a 4000 caratteri per sicurezza di visualizzazione
  - mostra avvisi di cancellazione/errore/troncamento

## Supporto gateway esterno

Impostare:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# Opzionale:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

Differenze di comportamento rispetto al gateway locale condiviso:

- Nessun file di lock/info del gateway locale
- Nessuna generazione/terminazione di processo locale
- I controlli di salute e le operazioni CRUD del kernel vengono eseguiti contro l'endpoint esterno
- Gli errori di autenticazione vengono segnalati con indicazioni esplicite sul token

## Risoluzione dei problemi operativi (modalità di errore attuali)

- **Tool Python non disponibile**
  - Verificare `python.toolMode` / `PI_PY`.
  - Se il preflight fallisce, il runtime degrada a bash-only.

- **Errori di disponibilità del kernel**
  - La modalità locale richiede che sia `kernel_gateway` che `ipykernel` siano importabili nel runtime Python risolto.
  - Installare con:

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` causa errore all'avvio**
  - Questo è il comportamento atteso con l'implementazione attuale.

- **Errori di autenticazione/raggiungibilità del gateway esterno**
  - 401/403 -> impostare `PI_PYTHON_GATEWAY_TOKEN`.
  - timeout/irraggiungibile -> verificare URL/rete e salute del gateway.

- **L'esecuzione si blocca e poi va in timeout**
  - Aumentare il `timeout` del tool (max 600s) se il carico di lavoro è legittimo.
  - Per codice bloccato, la cancellazione attiva l'interrupt del kernel ma il codice utente potrebbe comunque necessitare di refactoring.

- **Prompt stdin/input nel codice Python**
  - `input()` non è supportato interattivamente in questo percorso di runtime; passare i dati in modo programmatico.

- **Esaurimento risorse (`EMFILE` / troppi file aperti)**
  - Il gestore delle sessioni attiva il recupero del gateway condiviso (teardown della sessione + riavvio del gateway condiviso).

- **Errori sulla directory di lavoro**
  - Il tool valida che `cwd` esista e sia una directory prima dell'esecuzione.

## Variabili d'ambiente rilevanti

- `PI_PY` — override dell'esposizione del tool (mappatura `bash-only`/`ipy-only`/`both` sopra indicata)
- `PI_PYTHON_GATEWAY_URL` — utilizza gateway esterno
- `PI_PYTHON_GATEWAY_TOKEN` — token di autenticazione opzionale per gateway esterno
- `PI_PYTHON_SKIP_CHECK=1` — salta i controlli preflight/warm di Python
- `PI_PYTHON_IPC_TRACE=1` — registra le tracce di invio/ricezione IPC del kernel
- `PI_DEBUG_STARTUP=1` — emette marcatori di debug per le fasi di avvio
