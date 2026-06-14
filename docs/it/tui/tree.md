---
title: Riferimento al comando Tree
description: >-
  Riferimento al comando /tree per la visualizzazione della cronologia delle
  sessioni e dei rami di conversazione.
sidebar:
  order: 4
  label: Comando /tree
i18n:
  sourceHash: ee0e412fe993
  translator: machine
---

# Riferimento al comando `/tree`

`/tree` apre il navigatore interattivo **Session Tree**. Consente di passare a qualsiasi voce nel file di sessione corrente e continuare da quel punto.

Si tratta di uno spostamento di foglia all'interno del file, non di un nuovo esportazione di sessione.

## Cosa fa `/tree`

- Costruisce un albero dalle voci di sessione correnti (`SessionManager.getTree()`)
- Apre `TreeSelectorComponent` con navigazione da tastiera, filtri e ricerca
- Alla selezione, chiama `AgentSession.navigateTree(targetId, { summarize, customInstructions })`
- Ricostruisce la chat visibile dal nuovo percorso della foglia
- Facoltativamente precompila il testo dell'editor quando si seleziona un messaggio utente/personalizzato

Implementazione principale:

- `src/modes/controllers/input-controller.ts` (`/tree`, collegamento tasti, comportamento doppio-escape)
- `src/modes/controllers/selector-controller.ts` (avvio dell'interfaccia ad albero + flusso del prompt di riepilogo)
- `src/modes/components/tree-selector.ts` (navigazione, filtri, ricerca, etichette, rendering)
- `src/session/agent-session.ts` (cambio foglia con `navigateTree` + riepilogo opzionale)
- `src/session/session-manager.ts` (`getTree`, `branch`, `branchWithSummary`, `resetLeaf`, persistenza delle etichette)

## Come aprirlo

Ognuna delle seguenti opzioni apre lo stesso selettore:

- `/tree`
- azione di collegamento tasti configurata `tree`
- doppio-escape su editor vuoto quando `doubleEscapeAction = "tree"` (predefinito)
- `/branch` quando `doubleEscapeAction = "tree"` (instrada al selettore ad albero invece del selettore di rami solo utente)

## Modello dell'interfaccia ad albero

L'albero viene renderizzato dai puntatori padre delle voci di sessione (`id` / `parentId`).

- I figli sono ordinati per timestamp in ordine crescente (più vecchi prima, più nuovi in basso)
- Il ramo attivo (percorso dalla radice alla foglia corrente) è contrassegnato con un punto elenco
- Le etichette (se presenti) vengono renderizzate come `[etichetta]` prima del testo del nodo
- Se esistono più radici (catene padre orfane/interrotte), vengono mostrate sotto una radice di ramificazione virtuale

```text
Esempio di visualizzazione ad albero (percorso attivo contrassegnato con •):

├─ user: "Start task"
│  └─ assistant: "Plan"
│     ├─ • user: "Try approach A"
│     │  └─ • assistant: "A result"
│     │     └─ • [milestone] user: "Continue A"
│     └─ user: "Try approach B"
│        └─ assistant: "B result"
```

Il selettore si ricentra attorno alla selezione corrente e mostra fino a:

- `max(5, floor(terminalHeight / 2))` righe

## Tasti di scelta rapida nel selettore ad albero

- `Su` / `Giù`: sposta la selezione (a capo automatico)
- `Sinistra` / `Destra`: pagina su / pagina giù
- `Invio`: seleziona il nodo
- `Esc`: cancella la ricerca se attiva; altrimenti chiude il selettore
- `Ctrl+C`: chiude il selettore
- Digitare: aggiunge alla query di ricerca
- `Backspace`: elimina un carattere di ricerca
- `Shift+L`: modifica/cancella l'etichetta sulla voce selezionata
- `Ctrl+O`: cicla il filtro in avanti
- `Shift+Ctrl+O`: cicla il filtro all'indietro
- `Alt+D/T/U/L/A`: passa direttamente a una specifica modalità di filtro

## Filtri e semantica della ricerca

Modalità di filtro (`TreeList`):

1. `default`
2. `no-tools`
3. `user-only`
4. `labeled-only`
5. `all`

### `default`

Mostra la maggior parte dei nodi conversazionali, ma nasconde i tipi di voci di contabilità interna:

- `label`
- `custom`
- `model_change`
- `thinking_level_change`

### `no-tools`

Come `default`, ma nasconde anche i messaggi `toolResult`.

### `user-only`

Solo voci `message` con ruolo `user`.

### `labeled-only`

Solo voci che attualmente si risolvono in un'etichetta.

### `all`

Tutto nell'albero di sessione, incluse le voci di contabilità interna/personalizzate.

### Comportamento dei nodi assistente solo con strumenti

I messaggi dell'assistente che contengono **solo chiamate a strumenti** (nessun testo) sono nascosti per impostazione predefinita in tutte le visualizzazioni filtrate a meno che:

- il messaggio sia in errore/interrotto (`stopReason` non è `stop`/`toolUse`), oppure
- sia la foglia corrente (sempre visibile)

### Comportamento della ricerca

- La query viene tokenizzata per spazi
- La corrispondenza è insensibile alle maiuscole
- Tutti i token devono corrispondere (semantica AND)
- Il testo ricercabile include etichetta, ruolo e contenuto specifico per tipo (testo del messaggio, testo del riepilogo del ramo, tipo personalizzato, frammenti di comando degli strumenti, ecc.)

## Risultati della selezione (importante)

`navigateTree` calcola il comportamento della nuova foglia dal tipo di voce selezionata:

### Selezione di un messaggio `user`

- La nuova foglia diventa il `parentId` della voce selezionata
- Se il padre è `null` (messaggio utente radice), la foglia viene reimpostata alla radice (`resetLeaf()`)
- Il testo del messaggio selezionato viene copiato nell'editor per la modifica/reinvio

### Selezione di un `custom_message`

- Stessa regola per la foglia dei messaggi utente (`parentId`)
- Il contenuto testuale viene estratto e copiato nell'editor

### Selezione di un nodo non utente (assistente/strumento/riepilogo/compattazione/contabilità interna personalizzata/ecc.)

- La nuova foglia diventa l'id del nodo selezionato
- L'editor non viene precompilato

### Selezione della foglia corrente

- Nessuna operazione; il selettore si chiude con "Already at this point"

```text
Decisione di selezione (semplificata):

nodo selezionato
   │
   ├─ è la foglia corrente? ── sì ──> chiude il selettore (nessuna operazione)
   │
   ├─ è user/custom_message? ── sì ──> foglia := parentId (o resetLeaf per radice)
   │                                     + precompila testo dell'editor
   │
   └─ altrimenti ──> foglia := id del nodo selezionato
                    + nessuna precompilazione dell'editor
```

## Flusso del riepilogo al cambio

Il prompt di riepilogo è controllato da `branchSummary.enabled` (predefinito: `false`).

Quando abilitato, dopo aver selezionato un nodo l'interfaccia chiede:

- `No summary`
- `Summarize`
- `Summarize with custom prompt`

Dettagli del flusso:

- Escape nel prompt di riepilogo riapre il selettore ad albero
- L'annullamento del prompt personalizzato ritorna al ciclo di scelta del riepilogo
- Durante la creazione del riepilogo, l'interfaccia mostra un caricatore e associa `Esc` a `abortBranchSummary()`
- Se la creazione del riepilogo viene interrotta, il selettore ad albero si riapre e nessuno spostamento viene applicato

Elementi interni di `navigateTree`:

- Raccoglie le voci del ramo abbandonato dalla vecchia foglia all'antenato comune
- Emette `session_before_tree` (le estensioni possono annullare o iniettare un riepilogo)
- Utilizza il riepilogatore predefinito solo se richiesto e necessario
- Applica lo spostamento con:
  - `branchWithSummary(...)` quando il riepilogo esiste
  - `branch(newLeafId)` per lo spostamento non radice senza riepilogo
  - `resetLeaf()` per lo spostamento radice senza riepilogo
- Sostituisce la conversazione dell'agente con il contesto di sessione ricostruito
- Emette `session_tree`

Nota: se l'utente richiede un riepilogo ma non c'è nulla da riepilogare, la navigazione procede senza creare una voce di riepilogo.

## Etichette

Le modifiche alle etichette nell'interfaccia ad albero chiamano `appendLabelChange(targetId, label)`.

- un'etichetta non vuota imposta/aggiorna l'etichetta risolta
- un'etichetta vuota la cancella
- le etichette sono memorizzate come voci `label` di sola aggiunta
- i nodi dell'albero visualizzano lo stato dell'etichetta risolta, non la cronologia delle voci di etichetta non elaborate

## `/tree` rispetto alle operazioni adiacenti

| Operazione | Ambito | Risultato |
|---|---|---|
| `/tree` | File di sessione corrente | Sposta la foglia al punto selezionato (stesso file) |
| `/branch` | Di solito file di sessione corrente -> nuovo file di sessione | Per impostazione predefinita crea un ramo dal messaggio **user** selezionato in un nuovo file di sessione; se `doubleEscapeAction = "tree"`, `/branch` apre invece l'interfaccia di navigazione ad albero |
| `/fork` | Intera sessione corrente | Duplica la sessione in un nuovo file di sessione persistente |
| `/resume` | Elenco sessioni | Passa a un altro file di sessione |

Distinzione chiave: `/tree` è uno strumento di navigazione/riposizionamento all'interno di un singolo file di sessione. `/branch`, `/fork` e `/resume` cambiano tutti il contesto del file di sessione.

## Flussi di lavoro degli operatori

### Rieseguire da un prompt utente precedente senza perdere il ramo corrente

1. `/tree`
2. cercare/selezionare un messaggio utente precedente
3. scegliere `No summary` (o creare un riepilogo se necessario)
4. modificare il testo precompilato nell'editor
5. inviare

Effetto: un nuovo ramo cresce dal punto selezionato all'interno dello stesso file di sessione.

### Lasciare il ramo corrente con un'indicazione del contesto

1. abilitare `branchSummary.enabled`
2. `/tree` e selezionare il nodo di destinazione
3. scegliere `Summarize` (o prompt personalizzato)

Effetto: una voce `branch_summary` viene aggiunta alla posizione di destinazione prima di continuare.

### Esaminare le voci di contabilità interna nascoste

1. `/tree`
2. premere `Alt+A` (all)
3. cercare `model`, `thinking`, `custom` o etichette

Effetto: ispeziona la cronologia interna completa, non solo i nodi conversazionali.

### Contrassegnare i punti pivot per i salti successivi

1. `/tree`
2. spostarsi sulla voce
3. `Shift+L` e impostare un'etichetta
4. in seguito usare `Alt+L` (`labeled-only`) per saltare rapidamente

Effetto: navigazione rapida tra punti di riferimento duraturi del ramo.
