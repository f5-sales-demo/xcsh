---
title: Mécanismes internes du runtime de l'outil Resolve
description: >-
  Runtime de l'outil Resolve pour la résolution de chemins de fichiers, la
  récupération de contenu et l'accès aux ressources par URL.
sidebar:
  order: 3
  label: Outil Resolve
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# Mécanismes internes du runtime de l'outil Resolve

Ce document explique comment les workflows de prévisualisation et d'application sont modélisés dans coding-agent et comment les outils personnalisés peuvent y participer via `pushPendingAction`.

## Périmètre et fichiers clés

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## Rôle de `resolve`

`resolve` est un outil masqué qui finalise une action de prévisualisation en attente.

- `action: "apply"` exécute `apply(reason)` sur l'action en attente et persiste les modifications.
- `action: "discard"` invoque `reject(reason)` si cette fonction est fournie ; sinon, l'action est abandonnée avec un message par défaut « Discarded ».

Si aucune action en attente n'existe, `resolve` échoue avec le message :

- `No pending action to resolve. Nothing to apply or discard.`

## Les actions en attente forment une pile (LIFO)

Les actions en attente sont stockées dans `PendingActionStore` sous forme de pile avec opérations push/pop :

- `push(action)` ajoute une nouvelle action en attente au sommet de la pile.
- `peek()` inspecte l'action en cours au sommet de la pile.
- `pop()` retire et retourne l'action au sommet de la pile.
- `hasPending` indique si la pile est non vide.

`resolve` consomme toujours l'action **la plus récente** en premier (`pop()`), de sorte que plusieurs outils produisant des prévisualisations sont résolus dans l'ordre inverse de leur enregistrement.

## Exemple de producteur intégré (`ast_edit`)

`ast_edit` prévisualise d'abord les remplacements structurels. Lorsque la prévisualisation contient des remplacements et n'a pas encore été appliquée, il enregistre une action en attente qui contient :

- un libellé (résumé lisible par l'humain)
- `sourceToolName` (`ast_edit`)
- un callback `apply(reason: string)` qui relance l'édition AST avec `dryRun: false`

`resolve(action="apply", reason="...")` transmet `reason` à ce callback.

## Outils personnalisés : `pushPendingAction`

Les outils personnalisés peuvent enregistrer des actions en attente compatibles avec resolve via `CustomToolAPI.pushPendingAction(...)`.

`CustomToolPendingAction` :

- `label: string` (obligatoire)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (obligatoire) — invoqué lors de l'application ; `reason` est la chaîne passée à `resolve`
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (facultatif) — invoqué lors de l'abandon ; la valeur retournée remplace le message « Discarded » par défaut si elle est fournie
- `details?: unknown` (facultatif)
- `sourceToolName?: string` (facultatif, par défaut `"custom_tool"`)

### Exemple d'utilisation minimal

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

## Disponibilité et erreurs du runtime

`pushPendingAction` est connecté par le chargeur d'outils personnalisés en utilisant le `PendingActionStore` de la session active.

Si le runtime ne dispose pas de store d'actions en attente, `pushPendingAction` lève une exception :

- `Pending action store unavailable for custom tools in this runtime.`

## Comportement de sélection d'outil

Lorsque `PendingActionStore.hasPending` est à `true`, le runtime de l'agent oriente le choix d'outil vers `resolve` afin que les prévisualisations en attente soient explicitement finalisées avant que le flux normal d'outils ne reprenne.

## Recommandations pour les développeurs

- Utilisez les actions en attente uniquement pour les opérations destructrices ou à fort impact qui doivent prendre en charge une application ou un abandon explicite.
- Gardez le `label` concis et précis ; il est affiché dans la sortie du renderer de resolve.
- Veillez à ce que `apply(reason)` soit suffisamment déterministe et idempotent pour une exécution unique ; `reason` est informatif et ne doit pas modifier le comportement.
- Implémentez `reject(reason)` lorsque l'abandon nécessite un nettoyage (état temporaire, verrous, notifications) ; omettez-le pour les prévisualisations sans état où le message par défaut suffit.
- Si votre outil peut mettre en attente plusieurs prévisualisations, gardez à l'esprit la sémantique LIFO : l'action enregistrée en dernier est résolue en premier.
