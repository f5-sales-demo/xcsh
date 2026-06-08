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

# Dettagli interni del runtime del tool Resolve

Questo documento spiega come i flussi di lavoro preview/apply sono modellati in coding-agent e come i tool personalizzati possono partecipare tramite `pushPendingAction`.

## Ambito e file principali

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## Cosa fa `resolve`

`resolve` è un tool nascosto che finalizza un'azione in sospeso di anteprima.

- `action: "apply"` esegue `apply(reason)` sull'azione in sospeso e persiste le modifiche.
- `action: "discard"` invoca `reject(reason)` se fornita; altrimenti scarta l'azione con un messaggio predefinito "Discarded".

Se non esiste alcuna azione in sospeso, `resolve` fallisce con:

- `No pending action to resolve. Nothing to apply or discard.`

## Le azioni in sospeso sono uno stack (LIFO)

Le azioni in sospeso sono memorizzate in `PendingActionStore` come uno stack push/pop:

- `push(action)` aggiunge una nuova azione in sospeso in cima.
- `peek()` ispeziona l'azione attualmente in cima.
- `pop()` rimuove e restituisce l'azione in cima.
- `hasPending` indica se lo stack è non vuoto.

`resolve` consuma sempre prima l'azione in sospeso **più in alto** (`pop()`), quindi più tool che producono anteprime vengono risolti in ordine inverso rispetto alla registrazione.

## Esempio di produttore built-in (`ast_edit`)

`ast_edit` esegue prima l'anteprima delle sostituzioni strutturali. Quando l'anteprima ha sostituzioni e non è ancora stata applicata, inserisce un'azione in sospeso che contiene:

- label (riepilogo leggibile dall'utente)
- `sourceToolName` (`ast_edit`)
- callback `apply(reason: string)` che riesegue l'AST edit con `dryRun: false`

`resolve(action="apply", reason="...")` passa `reason` a questa callback.

## Tool personalizzati: `pushPendingAction`

I tool personalizzati possono registrare azioni in sospeso compatibili con resolve tramite `CustomToolAPI.pushPendingAction(...)`.

`CustomToolPendingAction`:

- `label: string` (obbligatorio)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (obbligatorio) — invocata all'applicazione; `reason` è la stringa passata a `resolve`
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (opzionale) — invocata allo scarto; il valore di ritorno sostituisce il messaggio predefinito "Discarded" se fornito
- `details?: unknown` (opzionale)
- `sourceToolName?: string` (opzionale, il valore predefinito è `"custom_tool"`)

### Esempio di utilizzo minimo

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

`pushPendingAction` è collegato dal loader dei tool personalizzati utilizzando il `PendingActionStore` della sessione attiva.

Se il runtime non dispone di un pending-action store, `pushPendingAction` genera l'errore:

- `Pending action store unavailable for custom tools in this runtime.`

## Comportamento della scelta del tool

Quando `PendingActionStore.hasPending` è true, il runtime dell'agente orienta la scelta del tool verso `resolve` in modo che le anteprime in sospeso vengano esplicitamente finalizzate prima che il flusso normale dei tool continui.

## Indicazioni per gli sviluppatori

- Utilizzate le azioni in sospeso solo per operazioni distruttive o ad alto impatto che dovrebbero supportare l'applicazione/scarto espliciti.
- Mantenete `label` conciso e specifico; viene mostrato nell'output del renderer di resolve.
- Assicuratevi che `apply(reason)` sia deterministica e sufficientemente idempotente per un'esecuzione singola; `reason` è informativo e non dovrebbe modificare il comportamento.
- Implementate `reject(reason)` quando lo scarto necessita di pulizia (stato temporaneo, lock, notifiche); omettetela per le anteprime stateless dove il messaggio predefinito è sufficiente.
- Se il vostro tool può mettere in coda più anteprime, ricordate la semantica LIFO: l'ultima azione inserita viene risolta per prima.
