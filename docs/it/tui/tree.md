---
title: Riferimento del comando Tree
description: >-
  /tree command reference for visualizing session history and conversation
  branches.
sidebar:
  order: 4
  label: /tree command
i18n:
  sourceHash: ee0e412fe993
  translator: machine
---

# Riferimento del comando `/tree`

`/tree` apre il navigatore interattivo **Session Tree**. Permette di saltare a qualsiasi voce nel file di sessione corrente e continuare da quel punto.

Si tratta di uno spostamento di leaf all'interno del file, non di un'esportazione in una nuova sessione.

## Cosa fa `/tree`

- Costruisce un albero dalle voci della sessione corrente (`SessionManager.getTree()`)
- Apre `TreeSelectorComponent` con navigazione da tastiera, filtri e ricerca
- Alla selezione, chiama `AgentSession.navigateTree(targetId, { summarize, customInstructions })`
- Ricostruisce la chat visibile dal nuovo percorso leaf
- Opzionalmente precompila il testo dell'editor quando si seleziona un messaggio user/custom

Implementazione principale:

- `src/modes/controllers/input-controller.ts` (`/tree`, associazione tasti, comportamento double-escape)
- `src/modes/controllers/selector-controller.ts` (avvio UI dell'albero + flusso prompt di riepilogo)
- `src/modes/components/tree-selector.ts` (navigazione, filtri, ricerca, etichette, rendering)
- `src/session/agent-session.ts` (`navigateTree` cambio leaf + riepilogo opzionale)
- `src/session/session-manager.ts` (`getTree`, `branch`, `branchWithSummary`, `resetLeaf`, persistenza delle etichette)

## Come aprirlo

Ognuna delle seguenti azioni apre lo stesso selettore:

- `/tree`
- azione di keybinding configurata `tree`
- double-escape sull'editor vuoto quando `doubleEscapeAction = "tree"` (predefinito)
- `/branch` quando `doubleEscapeAction = "tree"` (viene indirizzato al selettore dell'albero invece che al selettore di branch solo utente)

## Modello UI dell'albero

L'albero è renderizzato dai puntatori parent delle voci di sessione (`id` / `parentId`).

- I nodi figlio sono ordinati per timestamp crescente (più vecchi prima, più recenti sotto)
- Il branch attivo (percorso dalla radice al leaf corrente) è contrassegnato con un punto
- Le etichette (se presenti) vengono renderizzate come `[label]` prima del testo del nodo
- Se esistono radici multiple (catene parent orfane/interrotte), vengono mostrate sotto una radice di branching virtuale

```text
Esempio di vista ad albero (percorso attivo contrassegnato con •):

├─ user: "Start task"
│  └─ assistant: "Plan"
│     ├─ • user: "Try approach A"
│     │  └─ • assistant: "A result"
│     │     └─ • [milestone] user: "Continue A"
│     └─ user: "Try approach B"
│        └─ assistant: "B result"
```

Il selettore si ricentra intorno alla selezione corrente e mostra fino a:

- `max(5, floor(terminalHeight / 2))` righe

## Associazioni tasti all'interno del selettore dell'albero

- `Up` / `Down`: sposta la selezione (ciclico)
- `Left` / `Right`: pagina su / pagina giù
- `Enter`: seleziona il nodo
- `Esc`: cancella la ricerca se attiva; altrimenti chiude il selettore
- `Ctrl+C`: chiude il selettore
- `Type`: aggiunge alla query di ricerca
- `Backspace`: cancella un carattere di ricerca
- `Shift+L`: modifica/cancella l'etichetta sulla voce selezionata
- `Ctrl+O`: cicla il filtro in avanti
- `Shift+Ctrl+O`: cicla il filtro all'indietro
- `Alt+D/T/U/L/A`: salta direttamente a una modalità di filtro specifica

## Filtri e semantica di ricerca

Modalità di filtro (`TreeList`):

1. `default`
2. `no-tools`
3. `user-only`
4. `labeled-only`
5. `all`

### `default`

Mostra la maggior parte dei nodi conversazionali, ma nasconde i tipi di voce di gestione interna:

- `label`
- `custom`
- `model_change`
- `thinking_level_change`

### `no-tools`

Come `default`, ma nasconde anche i messaggi `toolResult`.

### `user-only`

Solo voci `message` dove il ruolo è `user`.

### `labeled-only`

Solo voci che attualmente risolvono a un'etichetta.

### `all`

Tutto nell'albero della sessione, incluse le voci di gestione interna/custom.

### Comportamento dei nodi assistant con soli tool

I messaggi assistant che contengono **solo chiamate tool** (nessun testo) sono nascosti per impostazione predefinita in tutte le viste filtrate a meno che:

- il messaggio sia in errore/interrotto (`stopReason` diverso da `stop`/`toolUse`), oppure
- sia il leaf corrente (sempre mantenuto visibile)

### Comportamento della ricerca

- La query viene tokenizzata per spazi
- La corrispondenza è case-insensitive
- Tutti i token devono corrispondere (semantica AND)
- Il testo ricercabile include etichetta, ruolo e contenuto specifico del tipo (testo del messaggio, testo di riepilogo del branch, tipo custom, frammenti di comandi tool, ecc.)

## Esiti della selezione (importante)

`navigateTree` calcola il nuovo comportamento del leaf in base al tipo di voce selezionata:

### Selezione di un messaggio `user`

- Il nuovo leaf diventa il `parentId` della voce selezionata
- Se il parent è `null` (messaggio user radice), il leaf viene reimpostato alla radice (`resetLeaf()`)
- Il testo del messaggio selezionato viene copiato nell'editor per modifica/reinvio

### Selezione di `custom_message`

- Stessa regola del leaf dei messaggi user (`parentId`)
- Il contenuto testuale viene estratto e copiato nell'editor

### Selezione di un nodo non-user (assistant/tool/summary/compaction/gestione interna custom/ecc.)

- Il nuovo leaf diventa l'id del nodo selezionato
- L'editor non viene precompilato

### Selezione del leaf corrente

- Nessuna operazione; il selettore si chiude con "Already at this point"

```text
Decisione di selezione (semplificata):

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

## Flusso di riepilogo al cambio

Il prompt di riepilogo è controllato da `branchSummary.enabled` (predefinito: `false`).

Quando abilitato, dopo aver scelto un nodo l'interfaccia chiede:

- `No summary`
- `Summarize`
- `Summarize with custom prompt`

Dettagli del flusso:

- Escape nel prompt di riepilogo riapre il selettore dell'albero
- L'annullamento del prompt personalizzato ritorna al ciclo di scelta del riepilogo
- Durante la generazione del riepilogo, l'interfaccia mostra un loader e associa `Esc` a `abortBranchSummary()`
- Se il riepilogo viene interrotto, il selettore dell'albero si riapre e nessuno spostamento viene applicato

Dettagli interni di `navigateTree`:

- Raccoglie le voci del branch abbandonato dal vecchio leaf all'antenato comune
- Emette `session_before_tree` (le estensioni possono annullare o iniettare un riepilogo)
- Utilizza il riepilogatore predefinito solo se richiesto e necessario
- Applica lo spostamento con:
  - `branchWithSummary(...)` quando esiste un riepilogo
  - `branch(newLeafId)` per spostamenti non alla radice senza riepilogo
  - `resetLeaf()` per spostamenti alla radice senza riepilogo
- Sostituisce la conversazione dell'agente con il contesto di sessione ricostruito
- Emette `session_tree`

Nota: se l'utente richiede un riepilogo ma non c'è nulla da riepilogare, la navigazione procede senza creare una voce di riepilogo.

## Etichette

Le modifiche alle etichette nell'interfaccia dell'albero chiamano `appendLabelChange(targetId, label)`.

- un'etichetta non vuota imposta/aggiorna l'etichetta risolta
- un'etichetta vuota la cancella
- le etichette sono memorizzate come voci `label` in modalità append-only
- i nodi dell'albero mostrano lo stato dell'etichetta risolta, non la cronologia grezza delle voci etichetta

## `/tree` vs operazioni correlate

| Operazione | Ambito | Risultato |
|---|---|---|
| `/tree` | File di sessione corrente | Sposta il leaf al punto selezionato (stesso file) |
| `/branch` | Solitamente file di sessione corrente -> nuovo file di sessione | Per impostazione predefinita crea un branch dal messaggio **user** selezionato in un nuovo file di sessione; se `doubleEscapeAction = "tree"`, `/branch` apre invece l'interfaccia di navigazione dell'albero |
| `/fork` | Intera sessione corrente | Duplica la sessione in un nuovo file di sessione persistito |
| `/resume` | Lista delle sessioni | Passa a un altro file di sessione |

Distinzione fondamentale: `/tree` è uno strumento di navigazione/riposizionamento all'interno di un singolo file di sessione. `/branch`, `/fork` e `/resume` cambiano tutti il contesto del file di sessione.

## Flussi di lavoro operativi

### Rieseguire da un prompt utente precedente senza perdere il branch corrente

1. `/tree`
2. cercare/selezionare un messaggio utente precedente
3. scegliere `No summary` (o riepilogare se necessario)
4. modificare il testo precompilato nell'editor
5. inviare

Effetto: un nuovo branch cresce dal punto selezionato all'interno dello stesso file di sessione.

### Lasciare il branch corrente con un riferimento di contesto

1. abilitare `branchSummary.enabled`
2. `/tree` e selezionare il nodo di destinazione
3. scegliere `Summarize` (o prompt personalizzato)

Effetto: una voce `branch_summary` viene aggiunta nella posizione di destinazione prima di continuare.

### Esaminare le voci di gestione interna nascoste

1. `/tree`
2. premere `Alt+A` (all)
3. cercare `model`, `thinking`, `custom`, o etichette

Effetto: ispezionare la timeline interna completa, non solo i nodi conversazionali.

### Contrassegnare punti di snodo per salti futuri

1. `/tree`
2. spostarsi sulla voce
3. `Shift+L` e impostare l'etichetta
4. successivamente usare `Alt+L` (`labeled-only`) per saltare rapidamente

Effetto: navigazione rapida tra punti di riferimento duraturi del branch.
