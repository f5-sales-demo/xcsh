---
title: Architettura ad albero delle sessioni
description: >-
  Architettura ad albero delle sessioni con ramificazione, navigazione e
  relazioni di conversazione genitore-figlio.
sidebar:
  order: 2
  label: Architettura ad albero
i18n:
  sourceHash: bd8b78d6c33a
  translator: machine
---

# Architettura ad albero delle sessioni (attuale)

Riferimento: [session.md](./session.md)

Questo documento descrive come funziona oggi la navigazione dell'albero delle sessioni: modello ad albero in memoria, regole di spostamento delle foglie, comportamento delle ramificazioni e integrazione con estensioni/eventi.

## Cos'è questo sottosistema

La sessione è memorizzata come un log di voci in sola aggiunta (append-only), ma il comportamento a runtime è basato su albero:

- Ogni voce non-header ha `id` e `parentId`.
- La posizione attiva è `leafId` in `SessionManager`.
- L'aggiunta di una voce crea sempre un figlio della foglia corrente.
- La ramificazione **non** riscrive la cronologia; cambia solo dove punta la foglia prima della prossima aggiunta.

File principali:

- `src/session/session-manager.ts` — modello dati ad albero, attraversamento, spostamento foglie, estrazione branch/sessione
- `src/session/agent-session.ts` — flusso di navigazione `/tree`, riassunto, emissione hook/eventi
- `src/modes/components/tree-selector.ts` — comportamento UI interattiva dell'albero e filtraggio
- `src/modes/controllers/selector-controller.ts` — orchestrazione del selettore per `/tree` e `/branch`
- `src/modes/controllers/input-controller.ts` — routing dei comandi (`/tree`, `/branch`, comportamento doppio-escape)
- `src/session/messages.ts` — conversione delle voci `branch_summary`, `compaction` e `custom_message` in messaggi di contesto LLM

## Modello dati ad albero in `SessionManager`

Indici a runtime:

- `#byId: Map<string, SessionEntry>` — ricerca rapida per qualsiasi voce
- `#leafId: string | null` — posizione corrente nell'albero
- `#labelsById: Map<string, string>` — etichette risolte per id della voce di destinazione

API dell'albero:

- `getBranch(fromId?)` percorre i link genitore fino alla radice e restituisce il percorso radice→nodo
- `getTree()` restituisce `SessionTreeNode[]` (`entry`, `children`, `label`)
  - i link genitore diventano array di figli
  - le voci con genitori mancanti sono trattate come radici
  - i figli sono ordinati dal più vecchio al più recente per timestamp
- `getChildren(parentId)` restituisce i figli diretti
- `getLabel(id)` risolve l'etichetta corrente da `labelsById`

`getTree()` è una proiezione a runtime; la persistenza rimane basata su voci JSONL in sola aggiunta.

## Semantica dello spostamento delle foglie

Esistono tre primitive di spostamento delle foglie:

1. `branch(entryId)`
   - Verifica che la voce esista
   - Imposta `leafId = entryId`
   - Nessuna nuova voce viene scritta

2. `resetLeaf()`
   - Imposta `leafId = null`
   - La prossima aggiunta crea una nuova voce radice (`parentId = null`)

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - Accetta `branchFromId: string | null`
   - Imposta `leafId = branchFromId`
   - Aggiunge una voce `branch_summary` come figlia di quella foglia
   - Quando `branchFromId` è `null`, `fromId` viene persistito come `"root"`

## Comportamento della navigazione `/tree` (stesso file di sessione)

`AgentSession.navigateTree()` è navigazione, non fork del file.

Flusso:

1. Validare il target e calcolare il percorso abbandonato (`collectEntriesForBranchSummary`)
2. Emettere `session_before_tree` con `TreePreparation`
3. Opzionalmente riassumere le voci abbandonate (riassunto fornito dall'hook o riassuntore integrato)
4. Calcolare il nuovo target della foglia:
   - selezionando un messaggio **user**: la foglia si sposta al suo genitore, e il testo del messaggio viene restituito per il precompilamento dell'editor
   - selezionando un **custom_message**: stessa regola del messaggio user (foglia = genitore, il testo precompila l'editor)
   - selezionando qualsiasi altra voce: foglia = id della voce selezionata
5. Applicare lo spostamento della foglia:
   - con riassunto: `branchWithSummary(newLeafId, ...)`
   - senza riassunto e `newLeafId === null`: `resetLeaf()`
   - altrimenti: `branch(newLeafId)`
6. Ricostruire il contesto dell'agente dalla nuova foglia ed emettere `session_tree`

Importante: le voci di riassunto sono collegate alla **nuova posizione di navigazione**, non alla coda del branch abbandonato.

## Comportamento di `/branch` (nuovo file di sessione)

`/branch` e `/tree` sono intenzionalmente diversi:

- `/tree` naviga all'interno del file di sessione corrente.
- `/branch` crea un nuovo file di branch della sessione (o una sostituzione in memoria per la modalità non persistente).

Flusso `/branch` lato utente (`SelectorController.showUserMessageSelector` → `AgentSession.branch`):

- La sorgente del branch deve essere un **messaggio user**.
- Il testo utente selezionato viene estratto per il precompilamento dell'editor.
- Se il messaggio utente selezionato è radice (`parentId === null`): avvia una nuova sessione tramite `newSession({ parentSession: previousSessionFile })`.
- Altrimenti: `createBranchedSession(selectedEntry.parentId)` per fare il fork della cronologia fino al confine del prompt selezionato.

Specifiche di `SessionManager.createBranchedSession(leafId)`:

- Costruisce il percorso radice→foglia tramite `getBranch(leafId)`; lancia errore se mancante.
- Esclude le voci `label` esistenti dal percorso copiato.
- Ricostruisce voci label fresche dalle `labelsById` risolte per le voci che rimangono nel percorso.
- Modalità persistente: scrive un nuovo file JSONL e cambia il manager su di esso; restituisce il nuovo percorso del file.
- Modalità in memoria: sostituisce le voci in memoria; restituisce `undefined`.

## Ricostruzione del contesto e integrazione riassunto/custom

`buildSessionContext()` (in `session-manager.ts`) risolve il percorso attivo radice→foglia e costruisce lo stato effettivo del contesto LLM:

- Traccia lo stato più recente di thinking/model/mode/ttsr sul percorso.
- Gestisce l'ultima compaction sul percorso:
  - emette prima il riassunto della compaction
  - riproduce i messaggi mantenuti da `firstKeptEntryId` fino al punto di compaction
  - poi riproduce i messaggi post-compaction
- Include le voci `branch_summary` e `custom_message` come oggetti `AgentMessage`.

`session/messages.ts` mappa poi questi tipi di messaggio per l'input del modello:

- `branchSummary` e `compactionSummary` diventano messaggi di contesto con template e ruolo user
- `custom`/`hookMessage` diventano messaggi di contenuto con ruolo user

Quindi lo spostamento nell'albero cambia il contesto modificando il percorso attivo della foglia, non mutando le vecchie voci.

## Etichette e comportamento della UI dell'albero

Persistenza delle etichette:

- `appendLabelChange(targetId, label?)` scrive voci `label` sulla catena della foglia corrente.
- `labelsById` viene aggiornato immediatamente (impostazione o cancellazione).
- `getTree()` risolve l'etichetta corrente su ogni nodo restituito.

Comportamento del selettore dell'albero (`tree-selector.ts`):

- Appiattisce l'albero per la navigazione, mantiene l'evidenziazione del percorso attivo e dà priorità alla visualizzazione del branch attivo per primo.
- Supporta modalità di filtro: `default`, `no-tools`, `user-only`, `labeled-only`, `all`.
- Supporta la ricerca testuale libera sul contenuto semantico renderizzato.
- `Shift+L` apre la modifica inline delle etichette e scrive tramite `appendLabelChange`.

Routing dei comandi:

- `/tree` apre sempre il selettore dell'albero.
- `/branch` apre il selettore dei messaggi utente a meno che `doubleEscapeAction=tree`, nel qual caso utilizza anch'esso la UX del selettore dell'albero.

## Punti di contatto con estensioni e hook per le operazioni sull'albero

API delle estensioni a tempo di comando (`ExtensionCommandContext`):

- `branch(entryId)` — crea un file di sessione ramificato
- `navigateTree(targetId, { summarize? })` — si sposta all'interno dell'albero/file corrente

Eventi relativi alla navigazione dell'albero:

- `session_before_tree`
  - riceve `TreePreparation`:
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - può annullare la navigazione
  - può fornire un payload di riassunto usato al posto del riassuntore integrato
  - riceve un `signal` di abort (percorso di cancellazione tramite Escape)
- `session_tree`
  - emette `newLeafId`, `oldLeafId`
  - include `summaryEntry` quando è stato creato un riassunto
  - `fromExtension` indica l'origine del riassunto

Hook del ciclo di vita adiacenti ma correlati:

- `session_before_branch` / `session_branch` per il flusso `/branch`
- `session_before_compact`, `session.compacting`, `session_compact` per le voci di compaction che successivamente influenzano la ricostruzione del contesto dell'albero

## Vincoli reali e condizioni limite

- `branch()` non può avere come target `null`; usare `resetLeaf()` per lo stato radice-prima-della-prima-voce.
- `branchWithSummary()` supporta target `null` e registra `fromId: "root"`.
- Selezionare la foglia corrente nel selettore dell'albero è un no-op.
- Il riassunto richiede un modello attivo; se assente, la navigazione con riassunto fallisce immediatamente.
- Se il riassunto viene interrotto, la navigazione viene annullata e la foglia rimane invariata.
- Le sessioni in memoria non restituiscono mai un percorso di file branch da `createBranchedSession`.

## Compatibilità legacy ancora presente

Le migrazioni di sessione vengono ancora eseguite al caricamento:

- v1→v2 aggiunge `id`/`parentId` e converte l'ancora dell'indice di compaction in ancora basata su id
- v2→v3 migra il ruolo legacy `hookMessage` a `custom`

Il comportamento a runtime corrente segue la semantica dell'albero versione 3 dopo la migrazione.
