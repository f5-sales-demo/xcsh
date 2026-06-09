---
title: Componenti interni del runtime dello strumento Resolve
description: >-
  Runtime dello strumento Resolve per la risoluzione dei percorsi dei file, il
  recupero dei contenuti e l'accesso alle risorse basato su URL.
sidebar:
  order: 3
  label: Strumento Resolve
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# Componenti interni del runtime dello strumento Resolve

Questo documento spiega come i flussi di lavoro preview/apply sono modellati in coding-agent e come gli strumenti personalizzati possono partecipare tramite `pushPendingAction`.

## Ambito e file chiave

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## Cosa fa `resolve`

`resolve` è uno strumento nascosto che finalizza un'azione di anteprima in sospeso.

- `action: "apply"` esegue `apply(reason)` sull'azione in sospeso e persiste le modifiche.
- `action: "discard"` invoca `reject(reason)` se fornito; altrimenti scarta l'azione con un messaggio predefinito "Discarded".

Se non esiste alcuna azione in sospeso, `resolve` fallisce con:

- `No pending action to resolve. Nothing to apply or discard.`

## Le azioni in sospeso sono uno stack (LIFO)

Le azioni in sospeso sono memorizzate in `PendingActionStore` come uno stack push/pop:

- `push(action)` aggiunge una nuova azione in sospeso in cima.
- `peek()` ispeziona l'azione corrente in cima.
- `pop()` rimuove e restituisce l'azione in cima.
- `hasPending` indica se lo stack non è vuoto.

`resolve` consuma sempre prima l'azione in sospeso **più in alto** (`pop()`), quindi più strumenti che producono anteprime vengono risolti in ordine inverso rispetto alla registrazione.

## Esempio di produttore integrato (`ast_edit`)

`ast_edit` esegue prima l'anteprima delle sostituzioni strutturali. Quando l'anteprima contiene sostituzioni e non è ancora stata applicata, inserisce un'azione in sospeso che contiene:

- label (riepilogo leggibile dall'utente)
- `sourceToolName` (`ast_edit`)
- callback `apply(reason: string)` che riesegue l'AST edit con `dryRun: false`

`resolve(action="apply", reason="...")` passa `reason` in questo callback.

## Strumenti personalizzati: `pushPendingAction`

Gli strumenti personalizzati possono registrare azioni in sospeso compatibili con resolve tramite `CustomToolAPI.pushPendingAction(...)`.

`CustomToolPendingAction`:

- `label: string` (obbligatorio)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (obbligatorio) — invocato all'applicazione; `reason` è la stringa passata a `resolve`
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (opzionale) — invocato allo scarto; il valore restituito sostituisce il messaggio predefinito "Discarded" se fornito
- `details?: unknown` (opzionale)
- `sourceToolName?: string` (opzionale, predefinito `"custom_tool"`)

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

`pushPendingAction` è collegato dal loader degli strumenti personalizzati utilizzando il `PendingActionStore` della sessione attiva.

Se il runtime non dispone di un pending-action store, `pushPendingAction` lancia:

- `Pending action store unavailable for custom tools in this runtime.`

## Comportamento della scelta dello strumento

Quando `PendingActionStore.hasPending` è true, il runtime dell'agente orienta la scelta dello strumento verso `resolve` in modo che le anteprime in sospeso vengano esplicitamente finalizzate prima che il flusso normale degli strumenti continui.

## Indicazioni per gli sviluppatori

- Utilizzate le azioni in sospeso solo per operazioni distruttive o ad alto impatto che dovrebbero supportare l'applicazione/scarto esplicito.
- Mantenete `label` conciso e specifico; viene mostrato nell'output del renderer di resolve.
- Assicuratevi che `apply(reason)` sia deterministico e sufficientemente idempotente per un'esecuzione singola; `reason` è informativo e non dovrebbe modificare il comportamento.
- Implementate `reject(reason)` quando lo scarto richiede operazioni di pulizia (stato temporaneo, lock, notifiche); omettetelo per anteprime senza stato dove il messaggio predefinito è sufficiente.
- Se il vostro strumento può preparare più anteprime, ricordate la semantica LIFO: l'ultima azione inserita viene risolta per prima.
