---
title: Pipeline di generazione handoff
description: >-
  Pipeline di generazione handoff per la creazione di riepiloghi di sessione
  portabili per la collaborazione tra team.
sidebar:
  order: 8
  label: Pipeline handoff
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# Pipeline di generazione `/handoff`

Questo documento descrive come l'agente di codifica implementa `/handoff` attualmente: percorso di attivazione, prompt di generazione, acquisizione del completamento, cambio di sessione e reiniezione del contesto.

## Ambito

Copre:

- Dispatch interattivo del comando `/handoff`
- Ciclo di vita e transizioni di stato di `AgentSession.handoff()`
- Come l'output handoff viene acquisito dall'output dell'assistente
- Come le sessioni vecchie/nuove persistono i dati handoff in modo diverso
- Comportamento dell'interfaccia utente per successo, annullamento e fallimento

Non copre:

- Navigazione generica dell'albero/internals dei rami
- Comandi di sessione non-handoff (`/new`, `/fork`, `/resume`)

## File di implementazione

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## Percorso di attivazione

1. `/handoff` è dichiarato nei metadati dei comandi slash predefiniti (`slash-commands.ts`) con un suggerimento inline opzionale: `[focus instructions]`.
2. Nella gestione dell'input interattivo (`InputController`), il testo inviato corrispondente a `/handoff` o `/handoff ...` viene intercettato prima della normale sottomissione del prompt.
3. L'editor viene svuotato e viene chiamato `handleHandoffCommand(customInstructions?)`.
4. `CommandController.handleHandoffCommand` esegue un controllo preliminare usando le voci correnti:
   - Conta le voci con `type === "message"`.
   - Se `< 2`, visualizza l'avviso: `Nothing to hand off (no messages yet)` e ritorna.

La stessa protezione sul contenuto minimo esiste anche all'interno di `AgentSession.handoff()` e genera un'eccezione se violata. Questo duplica la sicurezza sia a livello di interfaccia utente che a livello di sessione.

## Ciclo di vita end-to-end

### 1) Avvio della generazione handoff

`AgentSession.handoff(customInstructions?)`:

- Legge le voci del ramo corrente (`sessionManager.getBranch()`)
- Valida il conteggio minimo dei messaggi (`>= 2`)
- Crea `#handoffAbortController`
- Costruisce un prompt fisso e inline richiedendo un documento handoff strutturato (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- Aggiunge `Additional focus: ...` se vengono fornite istruzioni personalizzate

Il prompt viene inviato tramite:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` impedisce l'espansione di slash/prompt-template di questo payload di istruzioni interno.

### 2) Acquisizione del completamento

Prima di inviare il prompt, `handoff()` si iscrive agli eventi di sessione e attende `agent_end`.

Su `agent_end`, estrae il testo handoff dallo stato dell'agente scansionando all'indietro per trovare il messaggio `assistant` più recente, quindi concatena tutti i blocchi `content` dove `type === "text"` con `\n`.

Assunzioni importanti sull'estrazione:

- Vengono usati solo i blocchi di testo; i contenuti non testuali vengono ignorati.
- Si presume che l'ultimo messaggio dell'assistente corrisponda alla generazione handoff.
- Non analizza le sezioni markdown né valida la conformità al formato.
- Se l'output dell'assistente non contiene blocchi di testo, l'handoff viene considerato assente.

### 3) Controlli di annullamento

`handoff()` restituisce `undefined` quando si verifica una delle seguenti condizioni:

- nessun testo handoff acquisito, oppure
- `#handoffAbortController.signal.aborted` è true

Cancella sempre `#handoffAbortController` nel blocco `finally`.

### 4) Creazione della nuova sessione

Se il testo è stato acquisito e non è stato interrotto:

1. Svuota il writer della sessione corrente (`sessionManager.flush()`)
2. Avvia una nuova sessione (`sessionManager.newSession()`)
3. Ripristina lo stato dell'agente in memoria (`agent.reset()`)
4. Riassegna `agent.sessionId` al nuovo id di sessione
5. Svuota gli array di contesto in coda (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. Ripristina il contatore promemoria todo

`newSession()` crea un nuovo header e una lista di voci vuota (il leaf viene ripristinato a `null`). Nel percorso handoff, non viene passato nessun `parentSession`.

### 5) Iniezione del contesto handoff

Il documento handoff generato viene racchiuso e aggiunto alla nuova sessione come voce `custom_message`:

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
- `display`: `true` (visibile nel rebuild della TUI)
- Tipo di voce: `custom_message` (partecipa al contesto LLM)

### 6) Ricostruzione del contesto dell'agente attivo

Dopo l'iniezione:

1. `sessionManager.buildSessionContext()` risolve la lista dei messaggi per il leaf corrente
2. `agent.replaceMessages(sessionContext.messages)` rende attivo nel contesto il messaggio handoff iniettato
3. Il metodo restituisce `{ document: handoffText }`

A questo punto, il contesto LLM attivo nella nuova sessione contiene il messaggio handoff iniettato, non la vecchia trascrizione.

## Modello di persistenza: sessione vecchia vs sessione nuova

### Sessione vecchia

Durante la generazione, la normale persistenza dei messaggi rimane attiva. La risposta handoff dell'assistente viene persistita come voce `message` regolare su `message_end`.

Risultato: la sessione originale contiene l'handoff generato visibile come parte della trascrizione storica.

### Sessione nuova

Dopo il reset della sessione, l'handoff viene persistito come `custom_message` con `customType: "handoff"`.

`buildSessionContext()` converte questa voce in un messaggio di contesto custom/utente a runtime tramite `createCustomMessage(...)`, in modo che venga incluso nei prompt futuri della nuova sessione.

## Comportamento del controller/interfaccia utente

Comportamento di `CommandController.handleHandoffCommand`:

- Chiama `await session.handoff(customInstructions)`
- Se il risultato è `undefined`: `showError("Handoff cancelled")`
- In caso di successo:
  - `rebuildChatFromMessages()` (carica il contesto della nuova sessione, incluso l'handoff iniettato)
  - invalida la barra di stato e il bordo superiore dell'editor
  - ricarica i todo
  - aggiunge la riga di chat di successo: `New session started with handoff context`
- In caso di eccezione:
  - se il messaggio è `"Handoff cancelled"` o il nome dell'errore è `AbortError`: `showError("Handoff cancelled")`
  - altrimenti: `showError("Handoff failed: <message>")`
- Richiede il rendering alla fine

## Semantica di annullamento (comportamento attuale)

### Primitiva di annullamento a livello di sessione

`AgentSession` espone:

- `abortHandoff()` → interrompe `#handoffAbortController`
- `isGeneratingHandoff` → true mentre il controller esiste

Quando viene utilizzato questo percorso di interruzione, il sottoscrittore handoff rifiuta con `Error("Handoff cancelled")`, e il controller dei comandi lo mappa all'interfaccia utente di annullamento.

### Limitazione del percorso `/handoff` interattivo

Nel cablaggio attuale del controller interattivo, `/handoff` non installa un gestore Escape dedicato che chiami `abortHandoff()` (a differenza dei percorsi di compattazione/riepilogo-ramo che sovrascrivono temporaneamente `editor.onEscape`).

Impatto pratico:

- Esiste il supporto all'annullamento a livello di sessione, ma nessun hook di associazione tasti specifico per handoff nel percorso del comando `/handoff`.
- L'interruzione da parte dell'utente può comunque avvenire attraverso percorsi di interruzione dell'agente più ampi, ma non è lo stesso canale di annullamento esplicito usato da `abortHandoff()`.

## Handoff interrotto vs handoff fallito

Classificazione attuale dell'interfaccia utente:

- **Interrotto/annullato**
  - Il percorso `abortHandoff()` genera `"Handoff cancelled"`, oppure
  - `AbortError` generato
  - L'interfaccia utente mostra `Handoff cancelled`

- **Fallito**
  - qualsiasi altro errore generato da `handoff()` / pipeline dei prompt (errori di validazione modello/API, eccezioni di runtime, ecc.)
  - L'interfaccia utente mostra `Handoff failed: ...`

Sfumatura aggiuntiva: se la generazione si completa ma non viene estratto alcun testo, `handoff()` restituisce `undefined` e il controller attualmente segnala **annullato**, non **fallito**.

## Protezioni per sessioni brevi e contenuto minimo

Due protezioni impediscono handoff con scarso segnale:

- Livello UI (`handleHandoffCommand`): avvisa e ritorna anticipatamente per voci con `< 2` messaggi
- Livello sessione (`handoff()`): genera la stessa condizione come errore

Questo evita la creazione di una nuova sessione con contesto handoff vuoto o quasi vuoto.

## Riepilogo delle transizioni di stato

Flusso di stato ad alto livello:

1. Comando slash interattivo intercettato
2. Controllo preliminare sul conteggio dei messaggi
3. `#handoffAbortController` creato (`isGeneratingHandoff = true`)
4. Prompt handoff interno sottomesso (visibile nella chat come normale generazione dell'assistente)
5. Su `agent_end`, viene estratto l'ultimo testo dell'assistente
6. Se assente/interrotto → restituisce `undefined` o percorso di errore di annullamento
7. Se presente:
   - svuota la vecchia sessione
   - crea una nuova sessione vuota
   - ripristina le code/contatori di runtime
   - aggiunge `custom_message(handoff)`
   - ricostruisce e sostituisce i messaggi attivi dell'agente
8. Il controller ricostruisce l'interfaccia chat e annuncia il successo
9. `#handoffAbortController` cancellato (`isGeneratingHandoff = false`)

## Assunzioni e limitazioni note

- L'estrazione handoff è euristica: "ultimi blocchi di testo dell'assistente"; nessuna validazione strutturale.
- Nessun controllo rigido che il markdown generato segua il formato delle sezioni richiesto.
- Il testo estratto mancante viene segnalato come annullamento nell'esperienza utente del controller.
- Il flusso interattivo `/handoff` attualmente non dispone di un'associazione Escape→`abortHandoff()` dedicata.
- I metadati di derivazione della nuova sessione (`parentSession`) non vengono impostati da questo percorso.
