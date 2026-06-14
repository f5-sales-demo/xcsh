---
title: Architettura ad albero della sessione
description: >-
  Architettura ad albero della sessione con ramificazione, navigazione e
  relazioni di conversazione genitore-figlio.
sidebar:
  order: 2
  label: Architettura ad albero
i18n:
  sourceHash: bd8b78d6c33a
  translator: machine
---

# Architettura ad albero della sessione (corrente)

Riferimento: [session.md](./session.md)

Questo documento descrive il funzionamento attuale della navigazione ad albero della sessione: modello ad albero in memoria, regole di movimento delle foglie, comportamento di ramificazione e integrazione con estensioni/eventi.

## Cos'è questo sottosistema

La sessione è memorizzata come un log di voci append-only, ma il comportamento a runtime è basato su albero:

- Ogni voce non di intestazione ha `id` e `parentId`.
- La posizione attiva è `leafId` in `SessionManager`.
- L'aggiunta di una voce crea sempre un figlio della foglia corrente.
- La ramificazione **non** riscrive la cronologia; modifica solo il punto a cui punta la foglia prima della successiva aggiunta.

File principali:

- `src/session/session-manager.ts` — modello dati ad albero, attraversamento, movimento delle foglie, estrazione di branch/sessione
- `src/session/agent-session.ts` — flusso di navigazione `/tree`, riepilogo, emissione di hook/eventi
- `src/modes/components/tree-selector.ts` — comportamento dell'interfaccia utente ad albero interattiva e filtri
- `src/modes/controllers/selector-controller.ts` — orchestrazione del selettore per `/tree` e `/branch`
- `src/modes/controllers/input-controller.ts` — instradamento dei comandi (`/tree`, `/branch`, comportamento del doppio escape)
- `src/session/messages.ts` — conversione delle voci `branch_summary`, `compaction` e `custom_message` in messaggi di contesto LLM

## Modello dati ad albero in `SessionManager`

Indici a runtime:

- `#byId: Map<string, SessionEntry>` — ricerca rapida per qualsiasi voce
- `#leafId: string | null` — posizione corrente nell'albero
- `#labelsById: Map<string, string>` — etichette risolte per id della voce di destinazione

API dell'albero:

- `getBranch(fromId?)` percorre i link genitoriali fino alla radice e restituisce il percorso radice→nodo
- `getTree()` restituisce `SessionTreeNode[]` (`entry`, `children`, `label`)
  - i link genitoriali diventano array di figli
  - le voci con genitori mancanti sono trattate come radici
  - i figli sono ordinati dal più vecchio al più recente per timestamp
- `getChildren(parentId)` restituisce i figli diretti
- `getLabel(id)` risolve l'etichetta corrente da `labelsById`

`getTree()` è una proiezione a runtime; la persistenza rimane come voci JSONL append-only.

## Semantica del movimento delle foglie

Esistono tre primitive di movimento delle foglie:

1. `branch(entryId)`
   - Verifica l'esistenza della voce
   - Imposta `leafId = entryId`
   - Non viene scritta nessuna nuova voce

2. `resetLeaf()`
   - Imposta `leafId = null`
   - La successiva aggiunta crea una nuova voce radice (`parentId = null`)

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - Accetta `branchFromId: string | null`
   - Imposta `leafId = branchFromId`
   - Aggiunge una voce `branch_summary` come figlio di quella foglia
   - Quando `branchFromId` è `null`, `fromId` viene persistito come `"root"`

## Comportamento della navigazione `/tree` (stesso file di sessione)

`AgentSession.navigateTree()` è navigazione, non fork del file.

Flusso:

1. Valida la destinazione e calcola il percorso abbandonato (`collectEntriesForBranchSummary`)
2. Emette `session_before_tree` con `TreePreparation`
3. Riepiloga facoltativamente le voci abbandonate (riepilogo fornito dall'hook o riepilogatore integrato)
4. Calcola il nuovo target della foglia:
   - selezionando un messaggio **user**: la foglia si sposta al suo genitore e il testo del messaggio viene restituito per il prefill dell'editor
   - selezionando un **custom_message**: stessa regola del messaggio utente (foglia = genitore, testo prefill dell'editor)
   - selezionando qualsiasi altra voce: foglia = id della voce selezionata
5. Applica il movimento della foglia:
   - con riepilogo: `branchWithSummary(newLeafId, ...)`
   - senza riepilogo e `newLeafId === null`: `resetLeaf()`
   - altrimenti: `branch(newLeafId)`
6. Ricostruisce il contesto dell'agente dalla nuova foglia ed emette `session_tree`

Importante: le voci di riepilogo sono collegate alla **nuova posizione di navigazione**, non alla coda del branch abbandonato.

## Comportamento di `/branch` (nuovo file di sessione)

`/branch` e `/tree` sono intenzionalmente diversi:

- `/tree` naviga all'interno del file di sessione corrente.
- `/branch` crea un nuovo file di branch della sessione (o un sostituto in memoria per la modalità non persistente).

Flusso `/branch` lato utente (`SelectorController.showUserMessageSelector` → `AgentSession.branch`):

- La sorgente del branch deve essere un **messaggio utente**.
- Il testo utente selezionato viene estratto per il prefill dell'editor.
- Se il messaggio utente selezionato è radice (`parentId === null`): avvia una nuova sessione tramite `newSession({ parentSession: previousSessionFile })`.
- Altrimenti: `createBranchedSession(selectedEntry.parentId)` per forkare la cronologia fino al confine del prompt selezionato.

Dettagli di `SessionManager.createBranchedSession(leafId)`:

- Costruisce il percorso radice→foglia tramite `getBranch(leafId)`; genera un errore se mancante.
- Esclude le voci `label` esistenti dal percorso copiato.
- Ricostruisce nuove voci di etichetta dalle `labelsById` risolte per le voci che rimangono nel percorso.
- Modalità persistente: scrive un nuovo file JSONL e cambia il manager su di esso; restituisce il nuovo percorso del file.
- Modalità in memoria: sostituisce le voci in memoria; restituisce `undefined`.

## Ricostruzione del contesto e integrazione di riepilogo/personalizzato

`buildSessionContext()` (in `session-manager.ts`) risolve il percorso radice→foglia attivo e costruisce lo stato effettivo del contesto LLM:

- Traccia lo stato più recente di thinking/model/mode/ttsr nel percorso.
- Gestisce la compattazione più recente nel percorso:
  - emette prima il riepilogo della compattazione
  - riproduce i messaggi conservati da `firstKeptEntryId` fino al punto di compattazione
  - quindi riproduce i messaggi successivi alla compattazione
- Include voci `branch_summary` e `custom_message` come oggetti `AgentMessage`.

`session/messages.ts` mappa quindi questi tipi di messaggi per l'input del modello:

- `branchSummary` e `compactionSummary` diventano messaggi di contesto basati su template con ruolo utente
- `custom`/`hookMessage` diventano messaggi di contenuto con ruolo utente

Pertanto il movimento nell'albero modifica il contesto cambiando il percorso della foglia attiva, non mutando le voci precedenti.

## Etichette e comportamento dell'interfaccia utente ad albero

Persistenza delle etichette:

- `appendLabelChange(targetId, label?)` scrive voci `label` sulla catena della foglia corrente.
- `labelsById` viene aggiornato immediatamente (impostato o eliminato).
- `getTree()` risolve l'etichetta corrente su ciascun nodo restituito.

Comportamento del selettore ad albero (`tree-selector.ts`):

- Appiattisce l'albero per la navigazione, mantiene l'evidenziazione del percorso attivo e dà priorità alla visualizzazione prima del branch attivo.
- Supporta le modalità di filtro: `default`, `no-tools`, `user-only`, `labeled-only`, `all`.
- Supporta la ricerca di testo libero sul contenuto semantico visualizzato.
- `Shift+L` apre la modifica inline delle etichette e scrive tramite `appendLabelChange`.

Instradamento dei comandi:

- `/tree` apre sempre il selettore ad albero.
- `/branch` apre il selettore dei messaggi utente a meno che `doubleEscapeAction=tree`, nel qual caso utilizza anch'esso l'interfaccia utente del selettore ad albero.

## Punti di contatto di estensioni e hook per le operazioni ad albero

API di estensione al momento del comando (`ExtensionCommandContext`):

- `branch(entryId)` — crea un file di sessione ramificato
- `navigateTree(targetId, { summarize? })` — si sposta all'interno dell'albero/file corrente

Eventi attorno alla navigazione ad albero:

- `session_before_tree`
  - riceve `TreePreparation`:
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - può annullare la navigazione
  - può fornire un payload di riepilogo utilizzato al posto del riepilogatore integrato
  - riceve il `signal` di abort (percorso di annullamento tramite Escape)
- `session_tree`
  - emette `newLeafId`, `oldLeafId`
  - include `summaryEntry` quando è stato creato un riepilogo
  - `fromExtension` indica l'origine del riepilogo

Hook del ciclo di vita adiacenti ma correlati:

- `session_before_branch` / `session_branch` per il flusso `/branch`
- `session_before_compact`, `session.compacting`, `session_compact` per le voci di compattazione che influenzano successivamente la ricostruzione del contesto ad albero

## Vincoli reali e condizioni limite

- `branch()` non può avere come target `null`; usare `resetLeaf()` per lo stato radice-prima-della-prima-voce.
- `branchWithSummary()` supporta il target `null` e registra `fromId: "root"`.
- La selezione della foglia corrente nel selettore ad albero non produce alcun effetto.
- La riepilogazione richiede un modello attivo; in assenza di esso, la navigazione con riepilogo fallisce immediatamente.
- Se la riepilogazione viene interrotta, la navigazione viene annullata e la foglia rimane invariata.
- Le sessioni in memoria non restituiscono mai un percorso del file di branch da `createBranchedSession`.

## Compatibilità retroattiva ancora presente

Le migrazioni della sessione vengono eseguite al caricamento:

- v1→v2 aggiunge `id`/`parentId` e converte l'ancora dell'indice di compattazione in un'ancora di id
- v2→v3 migra il ruolo legacy `hookMessage` in `custom`

Il comportamento a runtime corrente è la semantica ad albero versione 3 dopo la migrazione.
