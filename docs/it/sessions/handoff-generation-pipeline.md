---
title: Handoff Generation Pipeline
description: >-
  Handoff generation pipeline for creating portable session summaries for team
  collaboration.
sidebar:
  order: 8
  label: Handoff pipeline
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# Pipeline di generazione `/handoff`

Questo documento descrive come il coding-agent implementa `/handoff` attualmente: percorso di attivazione, prompt di generazione, cattura del completamento, cambio di sessione e reiniezione del contesto.

## Ambito

Copre:

- Dispatch del comando interattivo `/handoff`
- Ciclo di vita e transizioni di stato di `AgentSession.handoff()`
- Come l'output dell'handoff viene catturato dall'output dell'assistente
- Come le sessioni vecchie/nuove persistono i dati dell'handoff in modo diverso
- Comportamento dell'UI per successo, annullamento e fallimento

Non copre:

- Internals generici della navigazione ad albero/branch
- Comandi di sessione non-handoff (`/new`, `/fork`, `/resume`)

## File di implementazione

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## Percorso di attivazione

1. `/handoff` è dichiarato nei metadati dei comandi slash built-in (`slash-commands.ts`) con un suggerimento inline opzionale: `[focus instructions]`.
2. Nella gestione dell'input interattivo (`InputController`), il testo inviato che corrisponde a `/handoff` o `/handoff ...` viene intercettato prima dell'invio normale del prompt.
3. L'editor viene svuotato e viene chiamato `handleHandoffCommand(customInstructions?)`.
4. `CommandController.handleHandoffCommand` esegue un controllo preliminare utilizzando le voci correnti:
   - Conta le voci con `type === "message"`.
   - Se `< 2`, mostra un avviso: `Nothing to hand off (no messages yet)` e ritorna.

Lo stesso controllo di contenuto minimo esiste nuovamente all'interno di `AgentSession.handoff()` e lancia un errore se violato. Questo duplica la sicurezza sia a livello di UI che di sessione.

## Ciclo di vita end-to-end

### 1) Avvio della generazione dell'handoff

`AgentSession.handoff(customInstructions?)`:

- Legge le voci del branch corrente (`sessionManager.getBranch()`)
- Valida il conteggio minimo di messaggi (`>= 2`)
- Crea `#handoffAbortController`
- Costruisce un prompt fisso e inline che richiede un documento di handoff strutturato (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- Aggiunge `Additional focus: ...` se vengono fornite istruzioni personalizzate

Il prompt viene inviato tramite:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` impedisce l'espansione di slash/prompt-template di questo payload di istruzioni interno.

### 2) Cattura del completamento

Prima di inviare il prompt, `handoff()` si sottoscrive agli eventi di sessione e attende `agent_end`.

Al verificarsi di `agent_end`, estrae il testo dell'handoff dallo stato dell'agente scansionando all'indietro per trovare il messaggio `assistant` più recente, quindi concatena tutti i blocchi `content` dove `type === "text"` con `\n`.

Assunzioni importanti sull'estrazione:

- Vengono utilizzati solo i blocchi di testo; i contenuti non testuali vengono ignorati.
- Si assume che l'ultimo messaggio dell'assistente corrisponda alla generazione dell'handoff.
- Non effettua il parsing delle sezioni markdown né valida la conformità del formato.
- Se l'output dell'assistente non ha blocchi di testo, l'handoff viene trattato come mancante.

### 3) Controlli di annullamento

`handoff()` restituisce `undefined` quando una delle seguenti condizioni è vera:

- nessun testo di handoff catturato, oppure
- `#handoffAbortController.signal.aborted` è true

Svuota sempre `#handoffAbortController` nel blocco `finally`.

### 4) Creazione della nuova sessione

Se il testo è stato catturato e non è stato abortito:

1. Flush del writer della sessione corrente (`sessionManager.flush()`)
2. Avvio di una sessione completamente nuova (`sessionManager.newSession()`)
3. Reset dello stato dell'agente in memoria (`agent.reset()`)
4. Riassegnazione di `agent.sessionId` al nuovo id di sessione
5. Svuotamento degli array di contesto in coda (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. Reset del contatore di promemoria todo

`newSession()` crea un header nuovo e una lista di voci vuota (leaf resettato a `null`). Nel percorso dell'handoff, non viene passata alcuna `parentSession`.

### 5) Iniezione del contesto di handoff

Il documento di handoff generato viene incapsulato e aggiunto alla nuova sessione come voce `custom_message`:

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

1. `sessionManager.buildSessionContext()` risolve la lista dei messaggi per il leaf corrente
2. `agent.replaceMessages(sessionContext.messages)` rende il messaggio di handoff iniettato il contesto attivo
3. Il metodo restituisce `{ document: handoffText }`

A questo punto, il contesto LLM attivo nella nuova sessione contiene il messaggio di handoff iniettato, non la trascrizione precedente.

## Modello di persistenza: sessione vecchia vs nuova sessione

### Sessione vecchia

Durante la generazione, la persistenza normale dei messaggi rimane attiva. La risposta dell'assistente per l'handoff viene persistita come una normale voce `message` al verificarsi di `message_end`.

Risultato: la sessione originale contiene l'handoff generato visibile come parte della trascrizione storica.

### Nuova sessione

Dopo il reset della sessione, l'handoff viene persistito come `custom_message` con `customType: "handoff"`.

`buildSessionContext()` converte questa voce in un messaggio runtime di contesto custom/utente tramite `createCustomMessage(...)`, in modo che venga incluso nei prompt futuri dalla nuova sessione.

## Comportamento del Controller/UI

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
- Richiede il render alla fine

## Semantica dell'annullamento (comportamento attuale)

### Primitiva di annullamento a livello di sessione

`AgentSession` espone:

- `abortHandoff()` → aborta `#handoffAbortController`
- `isGeneratingHandoff` → true mentre il controller esiste

Quando questo percorso di abort viene utilizzato, il subscriber dell'handoff rifiuta con `Error("Handoff cancelled")`, e il command controller lo mappa nell'UI di annullamento.

### Limitazione del percorso interattivo `/handoff`

Nell'attuale cablaggio del controller interattivo, `/handoff` non installa un handler Escape dedicato che chiama `abortHandoff()` (a differenza dei percorsi di compattazione/riepilogo branch che sovrascrivono temporaneamente `editor.onEscape`).

Impatto pratico:

- Esiste il supporto per l'annullamento a livello di sessione, ma nessun hook di keybinding specifico per l'handoff nel percorso del comando `/handoff`.
- L'interruzione da parte dell'utente può comunque avvenire attraverso percorsi di abort dell'agente più ampi, ma questo non è lo stesso canale di annullamento esplicito utilizzato da `abortHandoff()`.

## Handoff abortito vs fallito

Classificazione UI attuale:

- **Abortito/annullato**
  - Il percorso `abortHandoff()` attiva `"Handoff cancelled"`, oppure
  - viene lanciato un `AbortError`
  - L'UI mostra `Handoff cancelled`

- **Fallito**
  - qualsiasi altro errore lanciato da `handoff()` / pipeline del prompt (errori di validazione del modello/API, eccezioni runtime, ecc.)
  - L'UI mostra `Handoff failed: ...`

Sfumatura aggiuntiva: se la generazione viene completata ma non viene estratto alcun testo, `handoff()` restituisce `undefined` e il controller attualmente riporta **annullato**, non **fallito**.

## Guardrail per sessioni brevi e contenuto minimo

Due controlli impediscono handoff con segnale basso:

- Livello UI (`handleHandoffCommand`): avvisa e ritorna anticipatamente per `< 2` voci di messaggio
- Livello sessione (`handoff()`): lancia la stessa condizione come errore

Questo evita la creazione di una nuova sessione con contesto di handoff vuoto/quasi vuoto.

## Riepilogo delle transizioni di stato

Flusso di stato ad alto livello:

1. Comando slash interattivo intercettato
2. Controllo preliminare del conteggio messaggi
3. `#handoffAbortController` creato (`isGeneratingHandoff = true`)
4. Prompt di handoff interno inviato (visibile nella chat come generazione normale dell'assistente)
5. Al verificarsi di `agent_end`, viene estratto l'ultimo testo dell'assistente
6. Se mancante/abortito → restituisce `undefined` o percorso di errore di annullamento
7. Se presente:
   - flush della sessione vecchia
   - creazione di una nuova sessione vuota
   - reset delle code/contatori runtime
   - append di `custom_message(handoff)`
   - ricostruzione e sostituzione dei messaggi attivi dell'agente
8. Il controller ricostruisce l'UI della chat e annuncia il successo
9. `#handoffAbortController` svuotato (`isGeneratingHandoff = false`)

## Assunzioni e limitazioni note

- L'estrazione dell'handoff è euristica: "ultimi blocchi di testo dell'assistente"; nessuna validazione strutturale.
- Nessun controllo rigido che il markdown generato segua il formato delle sezioni richieste.
- Il testo estratto mancante viene riportato come annullamento nell'UX del controller.
- Il flusso interattivo di `/handoff` attualmente manca di un binding dedicato Escape→`abortHandoff()`.
- I metadati di lineage della nuova sessione (`parentSession`) non vengono impostati da questo percorso.
