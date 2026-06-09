---
title: Pipeline di generazione Handoff
description: >-
  Pipeline di generazione handoff per la creazione di riepiloghi di sessione
  portatili per la collaborazione di team.
sidebar:
  order: 8
  label: Pipeline handoff
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
- Comportamento dell'interfaccia utente per successo, annullamento e fallimento

Non copre:

- Interni generici della navigazione/diramazione ad albero
- Comandi di sessione non-handoff (`/new`, `/fork`, `/resume`)

## File di implementazione

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## Percorso di attivazione

1. `/handoff` è dichiarato nei metadati dei comandi slash integrati (`slash-commands.ts`) con suggerimento inline opzionale: `[focus instructions]`.
2. Nella gestione dell'input interattivo (`InputController`), il testo inviato corrispondente a `/handoff` o `/handoff ...` viene intercettato prima dell'invio normale del prompt.
3. L'editor viene svuotato e viene chiamato `handleHandoffCommand(customInstructions?)`.
4. `CommandController.handleHandoffCommand` esegue un controllo preliminare utilizzando le voci correnti:
   - Conta le voci con `type === "message"`.
   - Se `< 2`, mostra un avviso: `Nothing to hand off (no messages yet)` e ritorna.

Lo stesso controllo di contenuto minimo esiste anche all'interno di `AgentSession.handoff()` e lancia un errore se violato. Questo duplica la sicurezza sia a livello di interfaccia utente che di sessione.

## Ciclo di vita end-to-end

### 1) Avvio della generazione dell'handoff

`AgentSession.handoff(customInstructions?)`:

- Legge le voci del ramo corrente (`sessionManager.getBranch()`)
- Valida il conteggio minimo dei messaggi (`>= 2`)
- Crea `#handoffAbortController`
- Costruisce un prompt inline fisso che richiede un documento di handoff strutturato (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- Aggiunge `Additional focus: ...` se sono fornite istruzioni personalizzate

Il prompt viene inviato tramite:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` impedisce l'espansione slash/prompt-template di questo payload di istruzioni interno.

### 2) Cattura del completamento

Prima di inviare il prompt, `handoff()` si iscrive agli eventi della sessione e attende `agent_end`.

Su `agent_end`, estrae il testo dell'handoff dallo stato dell'agente scansionando all'indietro per trovare il messaggio `assistant` più recente, poi concatenando tutti i blocchi `content` dove `type === "text"` con `\n`.

Assunzioni importanti sull'estrazione:

- Vengono utilizzati solo i blocchi di testo; il contenuto non testuale viene ignorato.
- Si assume che l'ultimo messaggio dell'assistente corrisponda alla generazione dell'handoff.
- Non analizza le sezioni markdown né valida la conformità del formato.
- Se l'output dell'assistente non ha blocchi di testo, l'handoff è trattato come mancante.

### 3) Controlli di annullamento

`handoff()` restituisce `undefined` quando si verifica una delle seguenti condizioni:

- nessun testo di handoff catturato, oppure
- `#handoffAbortController.signal.aborted` è true

Pulisce sempre `#handoffAbortController` nel blocco `finally`.

### 4) Creazione della nuova sessione

Se il testo è stato catturato e non è stato annullato:

1. Scarica il writer della sessione corrente (`sessionManager.flush()`)
2. Avvia una sessione completamente nuova (`sessionManager.newSession()`)
3. Resetta lo stato in memoria dell'agente (`agent.reset()`)
4. Riassegna `agent.sessionId` all'id della nuova sessione
5. Svuota gli array di contesto accodati (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. Resetta il contatore dei promemoria todo

`newSession()` crea un nuovo header e una lista di voci vuota (leaf resettata a `null`). Nel percorso di handoff, non viene passato alcun `parentSession`.

### 5) Iniezione del contesto dell'handoff

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

1. `sessionManager.buildSessionContext()` risolve la lista dei messaggi per la leaf corrente
2. `agent.replaceMessages(sessionContext.messages)` rende il messaggio di handoff iniettato il contesto attivo
3. Il metodo restituisce `{ document: handoffText }`

A questo punto, il contesto LLM attivo nella nuova sessione contiene il messaggio di handoff iniettato, non la trascrizione precedente.

## Modello di persistenza: sessione vecchia vs nuova sessione

### Sessione vecchia

Durante la generazione, la persistenza normale dei messaggi rimane attiva. La risposta dell'assistente per l'handoff viene persistita come una normale voce `message` su `message_end`.

Risultato: la sessione originale contiene l'handoff generato visibile come parte della trascrizione storica.

### Nuova sessione

Dopo il reset della sessione, l'handoff viene persistito come `custom_message` con `customType: "handoff"`.

`buildSessionContext()` converte questa voce in un messaggio runtime custom/user-context tramite `createCustomMessage(...)`, quindi viene incluso nei prompt futuri dalla nuova sessione.

## Comportamento controller/interfaccia utente

Comportamento di `CommandController.handleHandoffCommand`:

- Chiama `await session.handoff(customInstructions)`
- Se il risultato è `undefined`: `showError("Handoff cancelled")`
- In caso di successo:
  - `rebuildChatFromMessages()` (carica il contesto della nuova sessione, incluso l'handoff iniettato)
  - invalida la riga di stato e il bordo superiore dell'editor
  - ricarica i todo
  - aggiunge una riga di chat di successo: `New session started with handoff context`
- In caso di eccezione:
  - se il messaggio è `"Handoff cancelled"` o il nome dell'errore è `AbortError`: `showError("Handoff cancelled")`
  - altrimenti: `showError("Handoff failed: <message>")`
- Richiede il render alla fine

## Semantica di annullamento (comportamento attuale)

### Primitiva di annullamento a livello di sessione

`AgentSession` espone:

- `abortHandoff()` → annulla `#handoffAbortController`
- `isGeneratingHandoff` → true mentre il controller esiste

Quando questo percorso di abort viene utilizzato, il subscriber dell'handoff rigetta con `Error("Handoff cancelled")`, e il command controller lo mappa nell'interfaccia di annullamento.

### Limitazione del percorso interattivo `/handoff`

Nel cablaggio corrente del controller interattivo, `/handoff` non installa un gestore Escape dedicato che chiami `abortHandoff()` (a differenza dei percorsi di compattazione/riepilogo dei rami che sovrascrivono temporaneamente `editor.onEscape`).

Impatto pratico:

- Esiste supporto per l'annullamento a livello di sessione, ma nessun hook di keybinding specifico per l'handoff nel percorso del comando `/handoff`.
- L'interruzione da parte dell'utente può comunque avvenire attraverso percorsi più ampi di abort dell'agente, ma questo non è lo stesso canale esplicito di annullamento utilizzato da `abortHandoff()`.

## Handoff annullato vs fallito

Classificazione attuale dell'interfaccia utente:

- **Annullato/cancellato**
  - Il percorso `abortHandoff()` attiva `"Handoff cancelled"`, oppure
  - viene lanciato un `AbortError`
  - L'interfaccia mostra `Handoff cancelled`

- **Fallito**
  - qualsiasi altro errore lanciato da `handoff()` / pipeline del prompt (errori di validazione del modello/API, eccezioni runtime, ecc.)
  - L'interfaccia mostra `Handoff failed: ...`

Sfumatura aggiuntiva: se la generazione si completa ma nessun testo viene estratto, `handoff()` restituisce `undefined` e il controller attualmente riporta **annullato**, non **fallito**.

## Protezioni per sessioni brevi e contenuto minimo

Due protezioni prevengono handoff con segnale insufficiente:

- Livello interfaccia utente (`handleHandoffCommand`): avvisa e ritorna anticipatamente per `< 2` voci di messaggio
- Livello sessione (`handoff()`): lancia la stessa condizione come errore

Questo evita di creare una nuova sessione con contesto di handoff vuoto/quasi vuoto.

## Riepilogo delle transizioni di stato

Flusso di stato ad alto livello:

1. Comando slash interattivo intercettato
2. Controllo preliminare del conteggio messaggi
3. `#handoffAbortController` creato (`isGeneratingHandoff = true`)
4. Prompt interno di handoff inviato (visibile nella chat come normale generazione dell'assistente)
5. Su `agent_end`, ultimo testo dell'assistente estratto
6. Se mancante/annullato → restituisce `undefined` o percorso di errore di annullamento
7. Se presente:
   - scarica la sessione vecchia
   - crea una nuova sessione vuota
   - resetta code/contatori runtime
   - aggiunge `custom_message(handoff)`
   - ricostruisce e sostituisce i messaggi attivi dell'agente
8. Il controller ricostruisce l'interfaccia chat e annuncia il successo
9. `#handoffAbortController` pulito (`isGeneratingHandoff = false`)

## Assunzioni e limitazioni note

- L'estrazione dell'handoff è euristica: "ultimi blocchi di testo dell'assistente"; nessuna validazione strutturale.
- Nessun controllo rigido che il markdown generato segua il formato delle sezioni richiesto.
- Il testo estratto mancante viene riportato come annullamento nell'esperienza utente del controller.
- Il flusso interattivo `/handoff` attualmente non dispone di un binding dedicato Escape→`abortHandoff()`.
- I metadati di discendenza della nuova sessione (`parentSession`) non vengono impostati da questo percorso.
