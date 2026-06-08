---
title: Compattazione e riepiloghi dei rami
description: >-
  Compattazione della finestra di contesto e generazione di riepiloghi dei rami
  per sessioni di lunga durata.
sidebar:
  order: 5
  label: Compattazione
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# Compattazione e riepiloghi dei rami

La compattazione e i riepiloghi dei rami sono i due meccanismi che mantengono utilizzabili le sessioni prolungate senza perdere il contesto del lavoro precedente.

- **Compattazione**: riscrive la cronologia precedente in un riepilogo sul ramo corrente.
- **Riepilogo del ramo**: cattura il contesto dei rami abbandonati durante la navigazione con `/tree`.

Entrambi vengono persistiti come voci di sessione e riconvertiti in messaggi di contesto utente quando si ricostruisce l'input per il LLM.

## File di implementazione principali

- `src/session/compaction/compaction.ts`
- `src/session/compaction/branch-summarization.ts`
- `src/session/compaction/pruning.ts`
- `src/session/compaction/utils.ts`
- `src/session/session-manager.ts`
- `src/session/agent-session.ts`
- `src/session/messages.ts`
- `src/extensibility/hooks/types.ts`
- `src/config/settings-schema.ts`

## Modello delle voci di sessione

La compattazione e i riepiloghi dei rami sono voci di sessione di prima classe, non semplici messaggi assistant/user.

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`, opzionale `shortSummary`
  - `firstKeptEntryId` (confine di compattazione)
  - `tokensBefore`
  - opzionali `details`, `preserveData`, `fromExtension`
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`, `summary`
  - opzionali `details`, `fromExtension`

Quando il contesto viene ricostruito (`buildSessionContext`):

1. L'ultima compattazione sul percorso attivo viene convertita in un messaggio `compactionSummary`.
2. Le voci mantenute da `firstKeptEntryId` fino al punto di compattazione vengono re-incluse.
3. Le voci successive sul percorso vengono aggiunte in coda.
4. Le voci `branch_summary` vengono convertite in messaggi `branchSummary`.
5. Le voci `custom_message` vengono convertite in messaggi `custom`.

Questi ruoli personalizzati vengono poi trasformati in messaggi utente destinati al LLM in `convertToLlm()` utilizzando i template statici:

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## Pipeline di compattazione

### Attivazione

La compattazione può essere eseguita in tre modi:

1. **Manuale**: `/compact [istruzioni]` chiama `AgentSession.compact(...)`.
2. **Recupero automatico da overflow**: dopo un errore dell'assistente che corrisponde a un overflow del contesto.
3. **Compattazione automatica a soglia**: dopo un turno riuscito quando il contesto supera la soglia.

### Forma della compattazione (visuale)

```text
Prima della compattazione:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

Dopo la compattazione (nuova voce aggiunta):

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 non inviato al LLM                 inviato al LLM
                                                         ↑
                                              inizia da firstKeptEntryId

Ciò che il LLM vede:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   da cmp          messaggi da firstKeptEntryId
```

### Compattazione da overflow-retry vs compattazione a soglia

I due percorsi automatici sono intenzionalmente diversi:

- **Compattazione da overflow-retry**
  - Attivazione: l'errore dell'assistente del modello corrente viene rilevato come overflow del contesto.
  - Il messaggio di errore dell'assistente che ha fallito viene rimosso dallo stato attivo dell'agente prima del tentativo.
  - La compattazione automatica viene eseguita con `reason: "overflow"` e `willRetry: true`.
  - In caso di successo, l'agente prosegue automaticamente (`agent.continue()`) dopo la compattazione.

- **Compattazione a soglia**
  - Attivazione: `contextTokens > contextWindow - compaction.reserveTokens`.
  - Viene eseguita con `reason: "threshold"` e `willRetry: false`.
  - In caso di successo, se `compaction.autoContinue !== false`, viene iniettato un prompt sintetico:
    - `"Continue if you have next steps."`

### Pruning pre-compattazione

Prima dei controlli di compattazione, potrebbe essere eseguito il pruning dei risultati degli strumenti (`pruneToolOutputs`).

Politica di pruning predefinita:

- Proteggere i `40_000` token più recenti degli output degli strumenti.
- Richiedere almeno `20_000` token di risparmio stimato totale.
- Non potare mai i risultati degli strumenti provenienti da `skill` o `read`.

I risultati degli strumenti potati vengono sostituiti con:

- `[Output truncated - N tokens]`

Se il pruning modifica le voci, lo storage della sessione viene riscritto e lo stato dei messaggi dell'agente viene aggiornato prima delle decisioni sulla compattazione.

### Logica di confine e punto di taglio

`prepareCompaction()` considera solo le voci successive all'ultima voce di compattazione (se presente).

1. Trovare l'indice della compattazione precedente.
2. Calcolare `boundaryStart = prevCompactionIndex + 1`.
3. Adattare `keepRecentTokens` utilizzando il rapporto di utilizzo misurato quando disponibile.
4. Eseguire `findCutPoint()` sulla finestra di confine.

I punti di taglio validi includono:

- Voci di messaggio con ruoli: `user`, `assistant`, `bashExecution`, `hookMessage`, `branchSummary`, `compactionSummary`
- Voci `custom_message`
- Voci `branch_summary`

Regola rigida: non tagliare mai su `toolResult`.

Se ci sono voci di metadati non-messaggio immediatamente prima del punto di taglio (`model_change`, `thinking_level_change`, etichette, ecc.), queste vengono incluse nella regione mantenuta spostando indietro l'indice di taglio fino a raggiungere un messaggio o il confine di compattazione.

### Gestione dei turni divisi

Se il punto di taglio non si trova all'inizio di un turno utente, la compattazione lo tratta come un turno diviso.

Il rilevamento dell'inizio di turno tratta i seguenti come confini di turno utente:

- `message.role === "user"`
- `message.role === "bashExecution"`
- Voce `custom_message`
- Voce `branch_summary`

La compattazione con turno diviso genera due riepiloghi:

1. Riepilogo della cronologia (`messagesToSummarize`)
2. Riepilogo del prefisso del turno (`turnPrefixMessages`)

Il riepilogo finale memorizzato viene unito come:

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### Generazione del riepilogo

`compact(...)` costruisce i riepiloghi dal testo della conversazione serializzato:

1. Convertire i messaggi tramite `convertToLlm()`.
2. Serializzare con `serializeConversation()`.
3. Racchiudere in `<conversation>...</conversation>`.
4. Opzionalmente includere `<previous-summary>...</previous-summary>`.
5. Opzionalmente iniettare contesto dall'hook come lista `<additional-context>`.
6. Eseguire il prompt di riassunto con `SUMMARIZATION_SYSTEM_PROMPT`.

Selezione del prompt:

- prima compattazione: `compaction-summary.md`
- compattazione iterativa con riepilogo precedente: `compaction-update-summary.md`
- secondo passaggio per turno diviso: `compaction-turn-prefix.md`
- riepilogo breve per l'interfaccia: `compaction-short-summary.md`

Modalità di riassunto remoto:

- Se `compaction.remoteEndpoint` è impostato, la compattazione effettua un POST con:
  - `{ systemPrompt, prompt }`
- Si aspetta un JSON contenente almeno `{ summary }`.

### Contesto delle operazioni su file nei riepiloghi

La compattazione traccia l'attività cumulativa sui file utilizzando le chiamate agli strumenti dell'assistente:

- `read(path)` → insieme dei file letti
- `write(path)` → insieme dei file modificati
- `edit(path)` → insieme dei file modificati

Comportamento cumulativo:

- Include i dettagli della compattazione precedente solo quando la voce precedente è generata internamente (`fromExtension !== true`).
- Nei turni divisi, include anche le operazioni su file del prefisso del turno.
- `readFiles` esclude i file che sono stati anche modificati.

Al testo del riepilogo vengono aggiunti tag per i file tramite template del prompt:

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### Persistenza e ricaricamento

Dopo la generazione del riepilogo (o il riepilogo fornito dall'hook), la sessione dell'agente:

1. Aggiunge una `CompactionEntry` con `appendCompaction(...)`.
2. Ricostruisce il contesto tramite `buildSessionContext()`.
3. Sostituisce i messaggi attivi dell'agente con il contesto ricostruito.
4. Emette l'evento hook `session_compact`.

## Pipeline di riepilogo dei rami

Il riepilogo dei rami è legato alla navigazione dell'albero, non all'overflow dei token.

### Attivazione

Durante `navigateTree(...)`:

1. Calcolare le voci abbandonate dalla vecchia foglia all'antenato comune utilizzando `collectEntriesForBranchSummary(...)`.
2. Se il chiamante ha richiesto un riepilogo (`options.summarize`), generare il riepilogo prima di cambiare foglia.
3. Se il riepilogo esiste, allegarlo al target di navigazione utilizzando `branchWithSummary(...)`.

Operativamente questo viene comunemente guidato dal flusso `/tree` quando `branchSummary.enabled` è abilitato.

### Forma del cambio di ramo (visuale)

```text
Albero prima della navigazione:

         ┌─ B ─ C ─ D (vecchia foglia, in fase di abbandono)
    A ───┤
         └─ E ─ F (target)

Antenato comune: A
Voci da riassumere: B, C, D

Dopo la navigazione con riepilogo:

         ┌─ B ─ C ─ D ─ [riepilogo di B,C,D]
    A ───┤
         └─ E ─ F (nuova foglia)
```

### Preparazione e budget di token

`generateBranchSummary(...)` calcola il budget come:

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` poi:

1. Primo passaggio: raccogliere le operazioni cumulative sui file da tutte le voci riassunte, inclusi i dettagli dei `branch_summary` precedenti generati internamente.
2. Secondo passaggio: scorrere dal più recente al più vecchio, aggiungendo messaggi fino al raggiungimento del budget di token.
3. Preferire la conservazione del contesto recente.
4. Potrebbe comunque includere voci di riepilogo grandi vicine al limite del budget per continuità.

Le voci di compattazione vengono incluse come messaggi (`compactionSummary`) durante l'input del riepilogo del ramo.

### Generazione del riepilogo e persistenza

Il riepilogo del ramo:

1. Converte e serializza i messaggi selezionati.
2. Li racchiude in `<conversation>`.
3. Utilizza istruzioni personalizzate se fornite, altrimenti `branch-summary.md`.
4. Chiama il modello di riassunto con `SUMMARIZATION_SYSTEM_PROMPT`.
5. Antepone `branch-summary-preamble.md`.
6. Aggiunge tag per le operazioni su file.

Il risultato viene memorizzato come `BranchSummaryEntry` con dettagli opzionali (`readFiles`, `modifiedFiles`).

## Punti di contatto per estensioni e hook

### `session_before_compact`

Hook pre-compattazione.

Può:

- annullare la compattazione (`{ cancel: true }`)
- fornire un payload di compattazione personalizzato completo (`{ compaction: CompactionResult }`)

### `session.compacting`

Hook di personalizzazione del prompt/contesto per la compattazione predefinita.

Può restituire:

- `prompt` (sovrascrive il prompt di riepilogo di base)
- `context` (righe di contesto aggiuntive iniettate in `<additional-context>`)
- `preserveData` (memorizzato nella voce di compattazione)

### `session_compact`

Notifica post-compattazione con la `compactionEntry` salvata e il flag `fromExtension`.

### `session_before_tree`

Viene eseguito durante la navigazione dell'albero prima della generazione predefinita del riepilogo del ramo.

Può:

- annullare la navigazione
- fornire un `{ summary: { summary, details } }` personalizzato utilizzato quando l'utente ha richiesto il riepilogo

### `session_tree`

Evento post-navigazione che espone la nuova/vecchia foglia e la voce di riepilogo opzionale.

## Comportamento a runtime e semantica dei fallimenti

- La compattazione manuale interrompe prima l'operazione corrente dell'agente.
- `abortCompaction()` annulla sia i controller di compattazione manuale che automatica.
- La compattazione automatica emette eventi di sessione di inizio/fine per gli aggiornamenti dell'interfaccia/stato.
- La compattazione automatica può provare più modelli candidati e ritentare in caso di fallimenti transitori.
- Gli errori di overflow sono esclusi dal percorso di retry generico perché vengono gestiti dalla compattazione.
- Se la compattazione automatica fallisce:
  - il percorso di overflow emette `Context overflow recovery failed: ...`
  - il percorso a soglia emette `Auto-compaction failed: ...`
- Il riepilogo del ramo può essere annullato tramite segnale di abort (es. Escape), restituendo un risultato di navigazione cancelled/aborted.

## Impostazioni e valori predefiniti

Da `settings-schema.ts`:

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

Questi valori vengono consumati a runtime da `AgentSession` e dai moduli di compattazione/riepilogo dei rami.
