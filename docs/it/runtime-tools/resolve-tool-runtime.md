---
title: Resolve Tool Runtime Internals
description: >-
  Resolve tool runtime for file path resolution, content fetching, and URL-based
  resource access.
sidebar:
  order: 3
  label: Resolve tool
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# Componenti interni del runtime dello strumento Resolve

Questo documento spiega come i flussi di lavoro preview/apply sono modellati in coding-agent e come gli strumenti personalizzati possono partecipare tramite `pushPendingAction`.

## Ambito e file principali

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## Cosa fa `resolve`

`resolve` è uno strumento nascosto che finalizza un'azione di anteprima in sospeso.

- `action: "apply"` esegue `apply(reason)` sull'azione in sospeso e persiste le modifiche.
- `action: "discard"` invoca `reject(reason)` se fornito; altrimenti elimina l'azione con un messaggio predefinito "Discarded".

Se non esiste alcuna azione in sospeso, `resolve` fallisce con:

- `No pending action to resolve. Nothing to apply or discard.`

## Le azioni in sospeso sono uno stack (LIFO)

Le azioni in sospeso sono memorizzate in `PendingActionStore` come uno stack push/pop:

- `push(action)` aggiunge una nuova azione in sospeso in cima.
- `peek()` ispeziona l'azione attualmente in cima.
- `pop()` rimuove e restituisce l'azione in cima.
- `hasPending` indica se lo stack è non vuoto.

`resolve` consuma sempre per prima l'azione in sospeso **più in alto** (`pop()`), quindi più strumenti che producono anteprime vengono risolti in ordine inverso rispetto alla registrazione.

## Esempio di produttore integrato (`ast_edit`)

`ast_edit` visualizza prima le sostituzioni strutturali in anteprima. Quando l'anteprima ha sostituzioni e non è ancora stata applicata, inserisce un'azione in sospeso che contiene:

- label (riepilogo leggibile dall'utente)
- `sourceToolName` (`ast_edit`)
- callback `apply(reason: string)` che riesegue l'edit AST con `dryRun: false`

`resolve(action="apply", reason="...")` passa `reason` in questa callback.

## Strumenti personalizzati: `pushPendingAction`

Gli strumenti personalizzati possono registrare azioni in sospeso compatibili con resolve attraverso `CustomToolAPI.pushPendingAction(...)`.

`CustomToolPendingAction`:

- `label: string` (obbligatorio)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (obbligatorio) — invocato all'applicazione; `reason` è la stringa passata a `resolve`
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (opzionale) — invocato allo scarto; il valore di ritorno sostituisce il messaggio predefinito "Discarded" se fornito
- `details?: unknown` (opzionale)
- `sourceToolName?: string` (opzionale, predefinito `"custom_tool"`)

### Esempio di utilizzo minimale

```ts
import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh";

const factory: CustomToolFactory = pi => ({
 name: "batch_rename_preview",
 label: "Batch Rename Preview",
 description: "Previews renames and defers commit to resolve",
 parameters: pi.typebox.Type.Object({
  files: pi.typebox.Type.Array(pi.typebox.Type.String()),
 }),

 async execute(_toolCallId, params) {
  const previewSummary = `Prepared rename plan for ${params.files.length} files`;

  pi.pushPendingAction({
   label: `Batch rename: ${params.files.length} files`,
   sourceToolName: "batch_rename_preview",
   apply: async (reason) => {
    // apply writes here
    return {
     content: [{ type: "text", text: `Applied batch rename. Reason: ${reason}` }],
    };
   },
   reject: async (reason) => {
    // optional: cleanup or notify on discard
    return {
     content: [{ type: "text", text: `Discarded batch rename. Reason: ${reason}` }],
    };
   },
  });

  return {
   content: [{ type: "text", text: `${previewSummary}. Call resolve to apply or discard.` }],
  };
 },
});

export default factory;
```

## Disponibilità a runtime e fallimenti

`pushPendingAction` è collegato dal loader degli strumenti personalizzati utilizzando il `PendingActionStore` della sessione attiva.

Se il runtime non dispone di un pending-action store, `pushPendingAction` lancia un errore:

- `Pending action store unavailable for custom tools in this runtime.`

## Comportamento della selezione dello strumento

Quando `PendingActionStore.hasPending` è true, il runtime dell'agente orienta la scelta dello strumento verso `resolve` in modo che le anteprime in sospeso vengano esplicitamente finalizzate prima che il flusso normale degli strumenti continui.

## Linee guida per gli sviluppatori

- Utilizzare le azioni in sospeso solo per operazioni distruttive o ad alto impatto che dovrebbero supportare un'applicazione/scarto esplicito.
- Mantenere `label` conciso e specifico; viene mostrato nell'output del renderer di resolve.
- Assicurarsi che `apply(reason)` sia deterministico e sufficientemente idempotente per un'esecuzione singola; `reason` è informativo e non dovrebbe modificare il comportamento.
- Implementare `reject(reason)` quando lo scarto richiede operazioni di pulizia (stato temporaneo, lock, notifiche); ometterlo per anteprime senza stato dove il messaggio predefinito è sufficiente.
- Se il vostro strumento può mettere in coda più anteprime, ricordare la semantica LIFO: l'ultima azione inserita viene risolta per prima.
