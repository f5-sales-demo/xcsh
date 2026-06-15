---
title: Pipeline di generazione handoff
description: >-
  Pipeline di generazione handoff per la creazione di riepiloghi di sessione
  portabili per la collaborazione in team.
sidebar:
  order: 8
  label: Pipeline handoff
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# Pipeline di generazione `/handoff`

Questo documento descrive come l'agente di codifica implementa `/handoff` oggi: percorso di attivazione, prompt di generazione, acquisizione del completamento, cambio di sessione e reiniezione del contesto.

## Ambito

Copre:

- Invio del comando interattivo `/handoff`
- Ciclo di vita e transizioni di stato di `AgentSession.handoff()`
- Come l'output dell'handoff viene acquisito dall'output dell'assistente
- Come le sessioni vecchie/nuove persistono i dati di handoff in modo diverso
- Comportamento dell'interfaccia utente per successo, annullamento e fallimento

Non copre:

- Navigazione generica dell'albero/internals dei rami
- Comandi di sessione non correlati all'handoff (`/new`, `/fork`, `/resume`)

## File di implementazione

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## Percorso di attivazione

1. `/handoff` è dichiarato nei metadati dei comandi slash integrati (`slash-commands.ts`) con un suggerimento inline opzionale: `[focus instructions]`.
2. Nella gestione dell'input interattivo (`InputController`), il testo inviato corrispondente a `/handoff` o `/handoff ...` viene intercettato prima della normale invio del prompt.
3. L'editor viene svuotato e viene chiamato `handleHandoffCommand(customInstructions?)`.
4. `CommandController.handleHandoffCommand` esegue un controllo preliminare utilizzando le voci correnti:
   - Conta le voci `type === "message"`.
   - Se `< 2`, avvisa: `Nothing to hand off (no messages yet)` e ritorna.

Lo stesso controllo sul contenuto minimo esiste anche all'interno di `AgentSession.handoff()` e genera un errore se violato. Questo duplica la sicurezza sia a livello di interfaccia utente che a livello di sessione.

## Ciclo di vita end-to-end

### 1) Avvio della generazione dell'handoff

`AgentSession.handoff(customInstructions?)`:

- Legge le voci del ramo corrente (`sessionManager.getBranch()`)
- Valida il numero minimo di messaggi (`>= 2`)
- Crea `#handoffAbortController`
- Costruisce un prompt fisso e inline che richiede un documento di handoff strutturato (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- Aggiunge `Additional focus: ...` se vengono fornite istruzioni personalizzate

Il prompt viene inviato tramite:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` impedisce l'espansione di slash/template di prompt su questo payload di istruzioni interne.

### 2) Acquisizione del completamento

Prima di inviare il prompt, `handoff()` si iscrive agli eventi di sessione e attende `agent_end`.

All'evento `agent_end`, estrae il testo dell'handoff dallo stato dell'agente scansionando all'indietro per trovare il messaggio `assistant` più recente, quindi concatena tutti i blocchi `content` in cui `type === "text"` con `\n`.

Assunzioni importanti sull'estrazione:

- Vengono utilizzati solo i blocchi di testo; il contenuto non testuale viene ignorato.
- Si presuppone che l'ultimo messaggio dell'assistente corrisponda alla generazione dell'handoff.
- Non analizza le sezioni markdown né convalida la conformità al formato.
- Se l'output dell'assistente non contiene blocchi di testo, l'handoff viene considerato mancante.

### 3) Controlli di annullamento

`handoff()` restituisce `undefined` quando si verifica una delle seguenti condizioni:

- nessun testo di handoff acquisito, oppure
- `#handoffAbortController.signal.aborted` è true

In ogni caso, il metodo svuota `#handoffAbortController` nel blocco `finally`.

### 4) Creazione di una nuova sessione

Se il testo è stato acquisito e non è stato interrotto:

1. Svuota il writer della sessione corrente (`sessionManager.flush()`)
2. Avvia una sessione completamente nuova (`sessionManager.newSession()`)
3. Reimposta lo stato dell'agente in memoria (`agent.reset()`)
4. Riassocia `agent.sessionId` al nuovo ID di sessione
5. Svuota gli array di contesto in coda (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. Reimposta il contatore del promemoria todo

`newSession()` crea un nuovo header e un elenco di voci vuoto (il leaf viene reimpostato a `null`). Nel percorso di handoff, non viene passato alcun `parentSession`.

### 5) Iniezione del contesto di handoff

Il documento di handoff generato viene racchiuso e aggiunto alla nuova sessione come voce `custom_message`:

```text
<handoff-context>
...handoff text...
</handoff-context>

The above is a handoff document from a previous session. Use this context to continue the work seamlessly.
```

Chiamata di inserimento:

```ts
this.sessionManager.appendCustomMessageEntry("handoff", handoffContent, true);
```

Semantica:

- `customType`: `"handoff"`
- `display`: `true` (visibile nella ricostruzione TUI)
- Tipo di voce: `custom_message` (partecipa al contesto LLM)

### 6) Ricostruzione del contesto attivo dell'agente

Dopo l'iniezione:

1. `sessionManager.buildSessionContext()` risolve l'elenco dei messaggi per il leaf corrente
2. `agent.replaceMessages(sessionContext.messages)` rende il messaggio di handoff iniettato il contesto attivo
3. Il metodo restituisce `{ document: handoffText }`

A questo punto, il contesto LLM attivo nella nuova sessione contiene il messaggio di handoff iniettato, non la trascrizione precedente.

## Modello di persistenza: sessione vecchia vs sessione nuova

### Sessione vecchia

Durante la generazione, la persistenza normale dei messaggi rimane attiva. La risposta di handoff dell'assistente viene persistita come voce `message` regolare all'evento `message_end`.

Risultato: la sessione originale contiene l'handoff generato visibile come parte della trascrizione storica.

### Sessione nuova

Dopo il reset della sessione, l'handoff viene persistito come `custom_message` con `customType: "handoff"`.

`buildSessionContext()` converte questa voce in un messaggio di contesto personalizzato/utente a runtime tramite `createCustomMessage(...)`, in modo che venga incluso nei prompt futuri della nuova sessione.

## Comportamento del controller/interfaccia utente

Comportamento di `CommandController.handleHandoffCommand`:

- Chiama `await session.handoff(customInstructions)`
- Se il risultato è `undefined`: `showError("Handoff cancelled")`
- In caso di successo:
  - `rebuildChatFromMessages()` (carica il contesto della nuova sessione, incluso l'handoff iniettato)
  - invalida la barra di stato e il bordo superiore dell'editor
  - ricarica i todo
  - aggiunge una riga di chat di successo: `New session started with handoff context`
- In caso di eccezione:
  - se il messaggio è `"Handoff cancelled"` o il nome dell'errore è `AbortError`: `showError("Handoff cancelled")`
  - altrimenti: `showError("Handoff failed: <message>")`
- Richiede il rendering al termine

## Semantica di annullamento (comportamento attuale)

### Primitiva di annullamento a livello di sessione

`AgentSession` espone:

- `abortHandoff()` → interrompe `#handoffAbortController`
- `isGeneratingHandoff` → true mentre il controller esiste

Quando viene utilizzato questo percorso di interruzione, il sottoscrittore dell'handoff rifiuta con `Error("Handoff cancelled")` e il controller dei comandi lo mappa all'interfaccia utente di annullamento.

### Limitazione del percorso `/handoff` interattivo

Nell'attuale cablaggio del controller interattivo, `/handoff` non installa un gestore Escape dedicato che chiami `abortHandoff()` (a differenza dei percorsi di compattazione/riepilogo-ramo che sovrascrivono temporaneamente `editor.onEscape`).

Impatto pratico:

- Esiste il supporto all'annullamento a livello di sessione, ma nessun hook di keybinding specifico per l'handoff nel percorso del comando `/handoff`.
- L'interruzione dell'utente può comunque avvenire tramite percorsi di interruzione più ampi dell'agente, ma non si tratta dello stesso canale di annullamento esplicito utilizzato da `abortHandoff()`.

## Handoff interrotto vs handoff fallito

Classificazione attuale dell'interfaccia utente:

- **Interrotto/annullato**
  - Il percorso `abortHandoff()` genera `"Handoff cancelled"`, oppure
  - viene generato un `AbortError`
  - L'interfaccia utente mostra `Handoff cancelled`

- **Fallito**
  - qualsiasi altro errore generato da `handoff()` / dalla pipeline dei prompt (errori di validazione del modello/API, eccezioni di runtime, ecc.)
  - L'interfaccia utente mostra `Handoff failed: ...`

Sfumatura aggiuntiva: se la generazione viene completata ma non viene estratto alcun testo, `handoff()` restituisce `undefined` e il controller attualmente segnala **annullato**, non **fallito**.

## Salvaguardie per sessioni brevi e contenuto minimo

Due controlli prevengono handoff a basso segnale:

- Livello interfaccia utente (`handleHandoffCommand`): avvisa e ritorna anticipatamente per voci di messaggio `< 2`
- Livello sessione (`handoff()`): genera la stessa condizione come errore

Questo evita la creazione di una nuova sessione con contesto di handoff vuoto o quasi vuoto.

## Riepilogo delle transizioni di stato

Flusso di stato ad alto livello:

1. Comando slash interattivo intercettato
2. Controllo preliminare sul numero di messaggi
3. `#handoffAbortController` creato (`isGeneratingHandoff = true`)
4. Prompt di handoff interno inviato (visibile nella chat come normale generazione dell'assistente)
5. All'evento `agent_end`, viene estratto l'ultimo testo dell'assistente
6. Se mancante/interrotto → restituisce `undefined` o percorso di errore di annullamento
7. Se presente:
   - svuota la sessione vecchia
   - crea una nuova sessione vuota
   - reimposta le code/i contatori di runtime
   - aggiunge `custom_message(handoff)`
   - ricostruisce e sostituisce i messaggi attivi dell'agente
8. Il controller ricostruisce l'interfaccia utente della chat e annuncia il successo
9. `#handoffAbortController` svuotato (`isGeneratingHandoff = false`)

## Assunzioni e limitazioni note

- L'estrazione dell'handoff è euristica: "ultimi blocchi di testo dell'assistente"; nessuna validazione strutturale.
- Nessun controllo rigido che il markdown generato segua il formato delle sezioni richiesto.
- Il testo estratto mancante viene segnalato come annullamento nell'esperienza utente del controller.
- Il flusso interattivo di `/handoff` attualmente non dispone di un binding Escape→`abortHandoff()` dedicato.
- I metadati di lignaggio della nuova sessione (`parentSession`) non vengono impostati da questo percorso.
