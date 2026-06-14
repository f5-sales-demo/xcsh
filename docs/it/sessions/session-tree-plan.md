---
title: Architettura ad albero delle sessioni
description: >-
  Architettura ad albero delle sessioni con diramazione, navigazione e relazioni
  di conversazione padre-figlio.
sidebar:
  order: 2
  label: Architettura ad albero
i18n:
  sourceHash: bd8b78d6c33a
  translator: machine
---

# Architettura ad albero delle sessioni (corrente)

Riferimento: [session.md](./session.md)

Questo documento descrive il funzionamento attuale della navigazione ad albero delle sessioni: modello ad albero in memoria, regole di movimento delle foglie, comportamento di diramazione e integrazione con estensioni/eventi.

## Cosa rappresenta questo sottosistema

La sessione è memorizzata come un log di voci append-only, ma il comportamento a runtime è basato su albero:

- Ogni voce non di intestazione ha `id` e `parentId`.
- La posizione attiva è `leafId` in `SessionManager`.
- L'aggiunta di una voce crea sempre un figlio della foglia corrente.
- La diramazione **non** riscrive la cronologia; modifica solo il punto a cui la foglia punta prima del successivo inserimento.

File chiave:

- `src/session/session-manager.ts` — modello dati ad albero, attraversamento, movimento delle foglie, estrazione di rami/sessioni
- `src/session/agent-session.ts` — flusso di navigazione `/tree`, riepilogo, emissione di hook/eventi
- `src/modes/components/tree-selector.ts` — comportamento dell'interfaccia ad albero interattiva e filtraggio
- `src/modes/controllers/selector-controller.ts` — orchestrazione del selettore per `/tree` e `/branch`
- `src/modes/controllers/input-controller.ts` — instradamento dei comandi (`/tree`, `/branch`, comportamento del doppio Escape)
- `src/session/messages.ts` — conversione delle voci `branch_summary`, `compaction` e `custom_message` in messaggi di contesto per il modello LLM

## Modello dati ad albero in `SessionManager`

Indici a runtime:

- `#byId: Map<string, SessionEntry>` — ricerca rapida per qualsiasi voce
- `#leafId: string | null` — posizione corrente nell'albero
- `#labelsById: Map<string, string>` — etichette risolte per id della voce di destinazione

API dell'albero:

- `getBranch(fromId?)` percorre i collegamenti al nodo padre fino alla radice e restituisce il percorso radice→nodo
- `getTree()` restituisce `SessionTreeNode[]` (`entry`, `children`, `label`)
  - i collegamenti al nodo padre diventano array di figli
  - le voci con nodi padre mancanti sono trattate come radici
  - i figli sono ordinati dal più vecchio al più recente per timestamp
- `getChildren(parentId)` restituisce i figli diretti
- `getLabel(id)` risolve l'etichetta corrente da `labelsById`

`getTree()` è una proiezione a runtime; la persistenza rimane come voci JSONL append-only.

## Semantica del movimento delle foglie

Esistono tre primitive di movimento delle foglie:

1. `branch(entryId)`
   - Valida l'esistenza della voce
   - Imposta `leafId = entryId`
   - Non viene scritta alcuna nuova voce

2. `resetLeaf()`
   - Imposta `leafId = null`
   - Il successivo inserimento crea una nuova voce radice (`parentId = null`)

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - Accetta `branchFromId: string | null`
   - Imposta `leafId = branchFromId`
   - Aggiunge una voce `branch_summary` come figlio di quella foglia
   - Quando `branchFromId` è `null`, `fromId` viene persistito come `"root"`

## Comportamento della navigazione `/tree` (stesso file di sessione)

`AgentSession.navigateTree()` è navigazione, non biforcazione di file.

Flusso:

1. Validare la destinazione e calcolare il percorso abbandonato (`collectEntriesForBranchSummary`)
2. Emettere `session_before_tree` con `TreePreparation`
3. Riepilogare facoltativamente le voci abbandonate (riepilogo fornito dall'hook o riepilogatore integrato)
4. Calcolare la nuova destinazione della foglia:
   - selezionando un messaggio **utente**: la foglia si sposta al suo nodo padre e il testo del messaggio viene restituito per la precompilazione dell'editor
   - selezionando un **custom_message**: stessa regola del messaggio utente (foglia = nodo padre, il testo precompila l'editor)
   - selezionando qualsiasi altra voce: foglia = id della voce selezionata
5. Applicare lo spostamento della foglia:
   - con riepilogo: `branchWithSummary(newLeafId, ...)`
   - senza riepilogo e `newLeafId === null`: `resetLeaf()`
   - altrimenti: `branch(newLeafId)`
6. Ricostruire il contesto dell'agente dalla nuova foglia ed emettere `session_tree`

Importante: le voci di riepilogo sono collegate alla **nuova posizione di navigazione**, non alla coda del ramo abbandonato.

## Comportamento di `/branch` (nuovo file di sessione)

`/branch` e `/tree` sono intenzionalmente diversi:

- `/tree` naviga all'interno del file di sessione corrente.
- `/branch` crea un nuovo file di ramo di sessione (o una sostituzione in memoria per la modalità non persistente).

Flusso `/branch` rivolto all'utente (`SelectorController.showUserMessageSelector` → `AgentSession.branch`):

- L'origine del ramo deve essere un **messaggio utente**.
- Il testo utente selezionato viene estratto per la precompilazione dell'editor.
- Se il messaggio utente selezionato è la radice (`parentId === null`): avviare una nuova sessione tramite `newSession({ parentSession: previousSessionFile })`.
- Altrimenti: `createBranchedSession(selectedEntry.parentId)` per biforcre la cronologia fino al limite del prompt selezionato.

Specifiche di `SessionManager.createBranchedSession(leafId)`:

- Costruisce il percorso radice→foglia tramite `getBranch(leafId)`; genera un errore se mancante.
- Esclude le voci `label` esistenti dal percorso copiato.
- Ricostruisce nuove voci etichetta dagli `labelsById` risolti per le voci che rimangono nel percorso.
- Modalità persistente: scrive un nuovo file JSONL e trasferisce il manager su di esso; restituisce il nuovo percorso del file.
- Modalità in memoria: sostituisce le voci in memoria; restituisce `undefined`.

## Ricostruzione del contesto e integrazione di riepilogo/custom

`buildSessionContext()` (in `session-manager.ts`) risolve il percorso radice→foglia attivo e costruisce lo stato di contesto LLM effettivo:

- Traccia l'ultimo stato di thinking/model/mode/ttsr sul percorso.
- Gestisce l'ultima compattazione sul percorso:
  - emette prima il riepilogo della compattazione
  - riproduce i messaggi mantenuti da `firstKeptEntryId` al punto di compattazione
  - poi riproduce i messaggi successivi alla compattazione
- Include le voci `branch_summary` e `custom_message` come oggetti `AgentMessage`.

`session/messages.ts` mappa poi questi tipi di messaggi per l'input del modello:

- `branchSummary` e `compactionSummary` diventano messaggi di contesto con template ruolo-utente
- `custom`/`hookMessage` diventano messaggi di contenuto ruolo-utente

Pertanto, lo spostamento nell'albero modifica il contesto cambiando il percorso della foglia attiva, senza mutare le voci precedenti.

## Etichette e comportamento dell'interfaccia ad albero

Persistenza delle etichette:

- `appendLabelChange(targetId, label?)` scrive voci `label` sulla catena della foglia corrente.
- `labelsById` viene aggiornato immediatamente (impostazione o eliminazione).
- `getTree()` risolve l'etichetta corrente su ciascun nodo restituito.

Comportamento del selettore ad albero (`tree-selector.ts`):

- Appiattisce l'albero per la navigazione, mantiene l'evidenziazione del percorso attivo e dà priorità alla visualizzazione del ramo attivo.
- Supporta modalità di filtro: `default`, `no-tools`, `user-only`, `labeled-only`, `all`.
- Supporta la ricerca di testo libero sul contenuto semantico visualizzato.
- `Shift+L` apre la modifica inline delle etichette e scrive tramite `appendLabelChange`.

Instradamento dei comandi:

- `/tree` apre sempre il selettore ad albero.
- `/branch` apre il selettore di messaggi utente a meno che `doubleEscapeAction=tree`, nel qual caso usa anche l'interfaccia del selettore ad albero.

## Punti di integrazione con estensioni e hook per le operazioni ad albero

API delle estensioni per i comandi (`ExtensionCommandContext`):

- `branch(entryId)` — crea un file di sessione ramificato
- `navigateTree(targetId, { summarize? })` — sposta all'interno dell'albero/file corrente

Eventi relativi alla navigazione ad albero:

- `session_before_tree`
  - riceve `TreePreparation`:
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - può annullare la navigazione
  - può fornire il payload di riepilogo usato al posto del riepilogatore integrato
  - riceve il segnale di interruzione `signal` (percorso di annullamento tramite Escape)
- `session_tree`
  - emette `newLeafId`, `oldLeafId`
  - include `summaryEntry` quando è stato creato un riepilogo
  - `fromExtension` indica l'origine del riepilogo

Hook del ciclo di vita adiacenti ma correlati:

- `session_before_branch` / `session_branch` per il flusso `/branch`
- `session_before_compact`, `session.compacting`, `session_compact` per le voci di compattazione che influenzano successivamente la ricostruzione del contesto ad albero

## Vincoli reali e condizioni limite

- `branch()` non può avere `null` come destinazione; usare `resetLeaf()` per lo stato precedente alla prima voce radice.
- `branchWithSummary()` supporta la destinazione `null` e registra `fromId: "root"`.
- La selezione della foglia corrente nel selettore ad albero è un'operazione nulla.
- Il riepilogo richiede un modello attivo; in sua assenza, la navigazione con riepilogo fallisce immediatamente.
- Se il riepilogo viene interrotto, la navigazione viene annullata e la foglia rimane invariata.
- Le sessioni in memoria non restituiscono mai un percorso del file di ramo da `createBranchedSession`.

## Compatibilità con le versioni precedenti ancora presente

Le migrazioni di sessione vengono ancora eseguite al caricamento:

- v1→v2 aggiunge `id`/`parentId` e converte l'ancora dell'indice di compattazione in ancora id
- v2→v3 migra il ruolo legacy `hookMessage` a `custom`

Il comportamento a runtime corrente è basato sulla semantica ad albero versione 3 dopo la migrazione.
