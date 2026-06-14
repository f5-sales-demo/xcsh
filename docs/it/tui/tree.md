---
title: Riferimento al comando Tree
description: >-
  Riferimento al comando /tree per visualizzare la cronologia delle sessioni e i
  rami delle conversazioni.
sidebar:
  order: 4
  label: Comando /tree
i18n:
  sourceHash: ee0e412fe993
  translator: machine
---

# Riferimento al comando `/tree`

`/tree` apre il navigatore interattivo **Session Tree**. Consente di passare a qualsiasi voce nel file di sessione corrente e di continuare da quel punto.

Si tratta di uno spostamento a foglia nel file, non di un'esportazione in una nuova sessione.

## Cosa fa `/tree`

- Costruisce un albero dalle voci della sessione corrente (`SessionManager.getTree()`)
- Apre `TreeSelectorComponent` con navigazione da tastiera, filtri e ricerca
- Alla selezione, chiama `AgentSession.navigateTree(targetId, { summarize, customInstructions })`
- Ricostruisce la chat visibile dal nuovo percorso foglia
- Opzionalmente precompila il testo dell'editor quando si seleziona un messaggio utente/personalizzato

Implementazione principale:

- `src/modes/controllers/input-controller.ts` (cablaggio di `/tree`, tasti di scelta rapida, comportamento doppio escape)
- `src/modes/controllers/selector-controller.ts` (avvio dell'interfaccia ad albero + flusso di richiesta sommario)
- `src/modes/components/tree-selector.ts` (navigazione, filtri, ricerca, etichette, rendering)
- `src/session/agent-session.ts` (commutazione di foglia con `navigateTree` + sommario opzionale)
- `src/session/session-manager.ts` (`getTree`, `branch`, `branchWithSummary`, `resetLeaf`, persistenza etichette)

## Come aprirlo

Ognuno dei seguenti comandi apre lo stesso selettore:

- `/tree`
- azione tasto di scelta rapida configurata `tree`
- doppio escape su editor vuoto quando `doubleEscapeAction = "tree"` (predefinito)
- `/branch` quando `doubleEscapeAction = "tree"` (reindirizza al selettore ad albero invece che al selettore di rami solo-utente)

## Modello di interfaccia utente ad albero

L'albero viene renderizzato dai puntatori ai genitori delle voci di sessione (`id` / `parentId`).

- I figli sono ordinati per timestamp in modo crescente (i più vecchi prima, i più recenti in basso)
- Il ramo attivo (percorso dalla radice alla foglia corrente) è contrassegnato con un punto elenco
- Le etichette (se presenti) vengono visualizzate come `[etichetta]` prima del testo del nodo
- Se esistono più radici (catene di genitori orfane/interrotte), vengono mostrate sotto una radice ramificata virtuale

```text
Example tree view (active path marked with •):

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

- `Su` / `Giù`: sposta la selezione (con avvolgimento)
- `Sinistra` / `Destra`: pagina su / pagina giù
- `Invio`: seleziona nodo
- `Esc`: cancella la ricerca se attiva; altrimenti chiude il selettore
- `Ctrl+C`: chiude il selettore
- `Digita`: aggiunge alla query di ricerca
- `Backspace`: elimina un carattere dalla ricerca
- `Shift+L`: modifica/cancella l'etichetta sulla voce selezionata
- `Ctrl+O`: cicla il filtro in avanti
- `Shift+Ctrl+O`: cicla il filtro all'indietro
- `Alt+D/T/U/L/A`: passa direttamente a una specifica modalità filtro

## Filtri e semantica della ricerca

Modalità filtro (`TreeList`):

1. `default`
2. `no-tools`
3. `user-only`
4. `labeled-only`
5. `all`

### `default`

Mostra la maggior parte dei nodi conversazionali, ma nasconde i tipi di voci di contabilità:

- `label`
- `custom`
- `model_change`
- `thinking_level_change`

### `no-tools`

Uguale a `default`, ma nasconde anche i messaggi `toolResult`.

### `user-only`

Solo voci `message` con ruolo `user`.

### `labeled-only`

Solo voci che attualmente risolvono a un'etichetta.

### `all`

Tutto nell'albero della sessione, incluse le voci di contabilità/personalizzate.

### Comportamento dei nodi assistente solo-strumenti

I messaggi dell'assistente che contengono **solo chiamate agli strumenti** (nessun testo) sono nascosti per impostazione predefinita in tutte le viste filtrate a meno che:

- il messaggio sia in errore/interrotto (`stopReason` diverso da `stop`/`toolUse`), oppure
- sia la foglia corrente (sempre mantenuta visibile)

### Comportamento della ricerca

- La query viene tokenizzata per spazi
- La corrispondenza non distingue maiuscole/minuscole
- Tutti i token devono corrispondere (semantica AND)
- Il testo ricercabile include etichetta, ruolo e contenuto specifico per tipo (testo del messaggio, testo del sommario del ramo, tipo personalizzato, frammenti di comandi degli strumenti, ecc.)

## Esiti della selezione (importante)

`navigateTree` calcola il nuovo comportamento della foglia dal tipo di voce selezionata:

### Selezione di un messaggio `user`

- La nuova foglia diventa il `parentId` della voce selezionata
- Se il genitore è `null` (messaggio utente radice), la foglia viene reimpostata alla radice (`resetLeaf()`)
- Il testo del messaggio selezionato viene copiato nell'editor per la modifica/reinvio

### Selezione di un `custom_message`

- Stessa regola di foglia dei messaggi utente (`parentId`)
- Il contenuto testuale viene estratto e copiato nell'editor

### Selezione di un nodo non-utente (assistente/strumento/sommario/compattazione/contabilità personalizzata/ecc.)

- La nuova foglia diventa l'id del nodo selezionato
- L'editor non viene precompilato

### Selezione della foglia corrente

- Nessuna operazione; il selettore si chiude con "Already at this point"

```text
Selection decision (simplified):

selected node
   │
   ├─ is current leaf? ── yes ──> close selector (no-op)
   │
   ├─ is user/custom_message? ── yes ──> leaf := parentId (or resetLeaf for root)
   │                                     + prefill editor text
   │
   └─ otherwise ──> leaf := selected node id
                    + no editor prefill
```

## Flusso sommario alla commutazione

Il prompt del sommario è controllato da `branchSummary.enabled` (predefinito: `false`).

Quando abilitato, dopo aver selezionato un nodo l'interfaccia chiede:

- `No summary`
- `Summarize`
- `Summarize with custom prompt`

Dettagli del flusso:

- Escape nel prompt del sommario riapre il selettore ad albero
- La cancellazione del prompt personalizzato ritorna al ciclo di scelta del sommario
- Durante la riepilogazione, l'interfaccia mostra un indicatore di caricamento e associa `Esc` a `abortBranchSummary()`
- Se la riepilogazione viene interrotta, il selettore ad albero si riapre e nessuno spostamento viene applicato

Funzionamento interno di `navigateTree`:

- Raccoglie le voci del ramo abbandonato dalla vecchia foglia all'antenato comune
- Emette `session_before_tree` (le estensioni possono annullare o iniettare un sommario)
- Usa il riepilogatore predefinito solo se richiesto e necessario
- Applica lo spostamento con:
  - `branchWithSummary(...)` quando esiste un sommario
  - `branch(newLeafId)` per uno spostamento non-radice senza sommario
  - `resetLeaf()` per uno spostamento radice senza sommario
- Sostituisce la conversazione dell'agente con il contesto della sessione ricostruito
- Emette `session_tree`

Nota: se l'utente richiede un sommario ma non c'è nulla da riepilogare, la navigazione procede senza creare una voce di sommario.

## Etichette

Le modifiche alle etichette nell'interfaccia ad albero chiamano `appendLabelChange(targetId, label)`.

- un'etichetta non vuota imposta/aggiorna l'etichetta risolta
- un'etichetta vuota la cancella
- le etichette sono archiviate come voci `label` in sola aggiunta
- i nodi dell'albero mostrano lo stato dell'etichetta risolta, non la cronologia grezza delle voci di etichetta

## `/tree` vs operazioni adiacenti

| Operazione | Ambito | Risultato |
|---|---|---|
| `/tree` | File di sessione corrente | Sposta la foglia al punto selezionato (stesso file) |
| `/branch` | Di solito file di sessione corrente -> nuovo file di sessione | Per impostazione predefinita crea un ramo dal messaggio **utente** selezionato in un nuovo file di sessione; se `doubleEscapeAction = "tree"`, `/branch` apre l'interfaccia di navigazione ad albero |
| `/fork` | Intera sessione corrente | Duplica la sessione in un nuovo file di sessione persistente |
| `/resume` | Elenco sessioni | Passa a un altro file di sessione |

Distinzione fondamentale: `/tree` è uno strumento di navigazione/riposizionamento all'interno di un file di sessione. `/branch`, `/fork` e `/resume` cambiano tutti il contesto del file di sessione.

## Flussi di lavoro operatore

### Rieseguire da un prompt utente precedente senza perdere il ramo corrente

1. `/tree`
2. cerca/seleziona il messaggio utente precedente
3. scegli `No summary` (o riepilogare se necessario)
4. modifica il testo precompilato nell'editor
5. invia

Effetto: un nuovo ramo cresce dal punto selezionato all'interno dello stesso file di sessione.

### Lasciare il ramo corrente con un riferimento contestuale

1. abilita `branchSummary.enabled`
2. `/tree` e seleziona il nodo di destinazione
3. scegli `Summarize` (o un prompt personalizzato)

Effetto: una voce `branch_summary` viene aggiunta alla posizione di destinazione prima di continuare.

### Ispezionare le voci di contabilità nascoste

1. `/tree`
2. premi `Alt+A` (all)
3. cerca `model`, `thinking`, `custom`, o le etichette

Effetto: ispeziona la cronologia interna completa, non solo i nodi conversazionali.

### Aggiungere segnalibri ai punti cardine per salti successivi

1. `/tree`
2. spostati sulla voce
3. `Shift+L` e imposta l'etichetta
4. in seguito usa `Alt+L` (`labeled-only`) per navigare rapidamente

Effetto: navigazione rapida tra punti di riferimento duraturi del ramo.
