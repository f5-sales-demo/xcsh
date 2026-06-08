---
title: Session Tree Architecture
description: >-
  Session tree architecture with branching, navigation, and parent-child
  conversation relationships.
sidebar:
  order: 2
  label: Tree architecture
i18n:
  sourceHash: bd8b78d6c33a
  translator: machine
---

# Architettura ad albero delle sessioni (attuale)

Riferimento: [session.md](./session.md)

Questo documento descrive come funziona oggi la navigazione dell'albero delle sessioni: modello ad albero in memoria, regole di movimento del nodo foglia, comportamento di ramificazione e integrazione con estensioni/eventi.

## Cos'è questo sottosistema

La sessione è memorizzata come un log di voci append-only, ma il comportamento a runtime è basato su albero:

- Ogni voce non-header ha `id` e `parentId`.
- La posizione attiva è `leafId` in `SessionManager`.
- L'aggiunta di una voce crea sempre un figlio del nodo foglia corrente.
- La ramificazione **non** riscrive la cronologia; cambia solo dove punta il nodo foglia prima della prossima aggiunta.

File principali:

- `src/session/session-manager.ts` — modello dati dell'albero, attraversamento, movimento del nodo foglia, estrazione di rami/sessioni
- `src/session/agent-session.ts` — flusso di navigazione `/tree`, riassunto, emissione di hook/eventi
- `src/modes/components/tree-selector.ts` — comportamento interattivo dell'interfaccia ad albero e filtraggio
- `src/modes/controllers/selector-controller.ts` — orchestrazione del selettore per `/tree` e `/branch`
- `src/modes/controllers/input-controller.ts` — instradamento dei comandi (`/tree`, `/branch`, comportamento del doppio Escape)
- `src/session/messages.ts` — conversione delle voci `branch_summary`, `compaction` e `custom_message` in messaggi di contesto per l'LLM

## Modello dati dell'albero in `SessionManager`

Indici a runtime:

- `#byId: Map<string, SessionEntry>` — ricerca rapida per qualsiasi voce
- `#leafId: string | null` — posizione corrente nell'albero
- `#labelsById: Map<string, string>` — etichette risolte per id della voce di destinazione

API dell'albero:

- `getBranch(fromId?)` percorre i collegamenti al genitore fino alla radice e restituisce il percorso radice→nodo
- `getTree()` restituisce `SessionTreeNode[]` (`entry`, `children`, `label`)
  - i collegamenti al genitore diventano array di figli
  - le voci con genitori mancanti sono trattate come radici
  - i figli sono ordinati dal più vecchio al più recente per timestamp
- `getChildren(parentId)` restituisce i figli diretti
- `getLabel(id)` risolve l'etichetta corrente da `labelsById`

`getTree()` è una proiezione a runtime; la persistenza rimane sotto forma di voci JSONL append-only.

## Semantica del movimento del nodo foglia

Esistono tre primitive di movimento del nodo foglia:

1. `branch(entryId)`
   - Valida che la voce esista
   - Imposta `leafId = entryId`
   - Non viene scritta nessuna nuova voce

2. `resetLeaf()`
   - Imposta `leafId = null`
   - La prossima aggiunta crea una nuova voce radice (`parentId = null`)

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - Accetta `branchFromId: string | null`
   - Imposta `leafId = branchFromId`
   - Aggiunge una voce `branch_summary` come figlio di quel nodo foglia
   - Quando `branchFromId` è `null`, `fromId` viene persistito come `"root"`

## Comportamento della navigazione `/tree` (stesso file di sessione)

`AgentSession.navigateTree()` è navigazione, non fork di file.

Flusso:

1. Validare il target e calcolare il percorso abbandonato (`collectEntriesForBranchSummary`)
2. Emettere `session_before_tree` con `TreePreparation`
3. Opzionalmente riassumere le voci abbandonate (riassunto fornito dall'hook o riassuntore integrato)
4. Calcolare il nuovo target del nodo foglia:
   - selezionando un messaggio **user**: il nodo foglia si sposta al suo genitore e il testo del messaggio viene restituito per il precompilamento dell'editor
   - selezionando un **custom_message**: stessa regola del messaggio utente (foglia = genitore, il testo precompila l'editor)
   - selezionando qualsiasi altra voce: foglia = id della voce selezionata
5. Applicare lo spostamento del nodo foglia:
   - con riassunto: `branchWithSummary(newLeafId, ...)`
   - senza riassunto e `newLeafId === null`: `resetLeaf()`
   - altrimenti: `branch(newLeafId)`
6. Ricostruire il contesto dell'agente dal nuovo nodo foglia ed emettere `session_tree`

Importante: le voci di riassunto vengono collegate alla **nuova posizione di navigazione**, non alla coda del ramo abbandonato.

## Comportamento di `/branch` (nuovo file di sessione)

`/branch` e `/tree` sono intenzionalmente diversi:

- `/tree` naviga all'interno del file di sessione corrente.
- `/branch` crea un nuovo file di ramo della sessione (o sostituzione in memoria per la modalità non persistente).

Flusso `/branch` lato utente (`SelectorController.showUserMessageSelector` → `AgentSession.branch`):

- La sorgente del ramo deve essere un **messaggio utente**.
- Il testo dell'utente selezionato viene estratto per il precompilamento dell'editor.
- Se il messaggio utente selezionato è radice (`parentId === null`): avviare una nuova sessione tramite `newSession({ parentSession: previousSessionFile })`.
- Altrimenti: `createBranchedSession(selectedEntry.parentId)` per fare il fork della cronologia fino al confine del prompt selezionato.

Specifiche di `SessionManager.createBranchedSession(leafId)`:

- Costruisce il percorso radice→foglia tramite `getBranch(leafId)`; lancia un errore se mancante.
- Esclude le voci `label` esistenti dal percorso copiato.
- Ricostruisce voci di etichetta fresche dalle `labelsById` risolte per le voci che rimangono nel percorso.
- Modalità persistente: scrive un nuovo file JSONL e commuta il manager su di esso; restituisce il nuovo percorso del file.
- Modalità in memoria: sostituisce le voci in memoria; restituisce `undefined`.

## Ricostruzione del contesto e integrazione di riassunti/custom

`buildSessionContext()` (in `session-manager.ts`) risolve il percorso attivo radice→foglia e costruisce lo stato effettivo del contesto LLM:

- Tiene traccia dell'ultimo stato di thinking/model/mode/ttsr sul percorso.
- Gestisce l'ultima compattazione sul percorso:
  - emette prima il riassunto della compattazione
  - riproduce i messaggi mantenuti da `firstKeptEntryId` fino al punto di compattazione
  - poi riproduce i messaggi post-compattazione
- Include le voci `branch_summary` e `custom_message` come oggetti `AgentMessage`.

`session/messages.ts` poi mappa questi tipi di messaggio per l'input del modello:

- `branchSummary` e `compactionSummary` diventano messaggi di contesto con template con ruolo utente
- `custom`/`hookMessage` diventano messaggi di contenuto con ruolo utente

Quindi il movimento nell'albero cambia il contesto modificando il percorso del nodo foglia attivo, non mutando le vecchie voci.

## Etichette e comportamento dell'interfaccia ad albero

Persistenza delle etichette:

- `appendLabelChange(targetId, label?)` scrive voci `label` sulla catena del nodo foglia corrente.
- `labelsById` viene aggiornato immediatamente (impostazione o cancellazione).
- `getTree()` risolve l'etichetta corrente su ogni nodo restituito.

Comportamento del selettore ad albero (`tree-selector.ts`):

- Appiattisce l'albero per la navigazione, mantiene l'evidenziazione del percorso attivo e dà priorità alla visualizzazione del ramo attivo per primo.
- Supporta modalità di filtro: `default`, `no-tools`, `user-only`, `labeled-only`, `all`.
- Supporta la ricerca a testo libero sul contenuto semantico renderizzato.
- `Shift+L` apre la modifica inline delle etichette e scrive tramite `appendLabelChange`.

Instradamento dei comandi:

- `/tree` apre sempre il selettore ad albero.
- `/branch` apre il selettore dei messaggi utente a meno che `doubleEscapeAction=tree`, nel qual caso utilizza anche l'interfaccia del selettore ad albero.

## Punti di contatto per estensioni e hook nelle operazioni sull'albero

API per estensioni al momento del comando (`ExtensionCommandContext`):

- `branch(entryId)` — creare un file di sessione ramificato
- `navigateTree(targetId, { summarize? })` — spostarsi all'interno dell'albero/file corrente

Eventi relativi alla navigazione dell'albero:

- `session_before_tree`
  - riceve `TreePreparation`:
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - può annullare la navigazione
  - può fornire un payload di riassunto utilizzato al posto del riassuntore integrato
  - riceve un `signal` di interruzione (percorso di cancellazione tramite Escape)
- `session_tree`
  - emette `newLeafId`, `oldLeafId`
  - include `summaryEntry` quando è stato creato un riassunto
  - `fromExtension` indica l'origine del riassunto

Hook del ciclo di vita adiacenti ma correlati:

- `session_before_branch` / `session_branch` per il flusso `/branch`
- `session_before_compact`, `session.compacting`, `session_compact` per le voci di compattazione che successivamente influenzano la ricostruzione del contesto dell'albero

## Vincoli reali e condizioni limite

- `branch()` non può puntare a `null`; usare `resetLeaf()` per lo stato radice-prima-della-prima-voce.
- `branchWithSummary()` supporta target `null` e registra `fromId: "root"`.
- Selezionare il nodo foglia corrente nel selettore ad albero è un no-op.
- Il riassunto richiede un modello attivo; se assente, la navigazione con riassunto fallisce immediatamente.
- Se il riassunto viene interrotto, la navigazione viene annullata e il nodo foglia rimane invariato.
- Le sessioni in memoria non restituiscono mai un percorso di file di ramo da `createBranchedSession`.

## Compatibilità legacy ancora presente

Le migrazioni delle sessioni vengono ancora eseguite al caricamento:

- v1→v2 aggiunge `id`/`parentId` e converte l'ancoraggio dell'indice di compattazione in ancoraggio per id
- v2→v3 migra il ruolo legacy `hookMessage` in `custom`

Il comportamento a runtime corrente segue la semantica dell'albero versione 3 dopo la migrazione.
