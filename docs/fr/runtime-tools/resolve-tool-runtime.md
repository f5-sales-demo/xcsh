---
title: Resolve Tool Runtime Internals
description: >-
  Resolve tool runtime for file path resolution, content fetching, and URL-based
  resource access.
sidebar:
  order: 3
  label: Outil resolve
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# Fonctionnement interne du runtime de l'outil resolve

Ce document explique comment les workflows de prévisualisation/application sont modélisés dans coding-agent et comment les outils personnalisés peuvent y participer via `pushPendingAction`.

## Portée et fichiers clés

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## Ce que fait `resolve`

`resolve` est un outil caché qui finalise une action en attente de prévisualisation.

- `action: "apply"` exécute `apply(reason)` sur l'action en attente et persiste les modifications.
- `action: "discard"` invoque `reject(reason)` si fourni ; sinon abandonne l'action avec un message par défaut "Discarded".

Si aucune action en attente n'existe, `resolve` échoue avec :

- `No pending action to resolve. Nothing to apply or discard.`

## Les actions en attente sont une pile (LIFO)

Les actions en attente sont stockées dans `PendingActionStore` sous forme de pile push/pop :

- `push(action)` ajoute une nouvelle action en attente au sommet.
- `peek()` inspecte l'action actuellement au sommet.
- `pop()` retire et retourne l'action au sommet.
- `hasPending` indique si la pile est non vide.

`resolve` consomme toujours l'action en attente **la plus haute** en premier (`pop()`), de sorte que plusieurs outils produisant des prévisualisations se résolvent dans l'ordre inverse de leur enregistrement.

## Exemple de producteur intégré (`ast_edit`)

`ast_edit` prévisualise d'abord les remplacements structurels. Lorsque la prévisualisation contient des remplacements et n'est pas encore appliquée, il pousse une action en attente qui contient :

- label (résumé lisible par un humain)
- `sourceToolName` (`ast_edit`)
- callback `apply(reason: string)` qui relance l'édition AST avec `dryRun: false`

`resolve(action="apply", reason="...")` passe `reason` dans ce callback.

## Outils personnalisés : `pushPendingAction`

Les outils personnalisés peuvent enregistrer des actions en attente compatibles avec resolve via `CustomToolAPI.pushPendingAction(...)`.

`CustomToolPendingAction` :

- `label: string` (requis)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (requis) — invoqué lors de l'application ; `reason` est la chaîne passée à `resolve`
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (optionnel) — invoqué lors de l'abandon ; la valeur de retour remplace le message par défaut "Discarded" si fournie
- `details?: unknown` (optionnel)
- `sourceToolName?: string` (optionnel, par défaut `"custom_tool"`)

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

## Disponibilité à l'exécution et erreurs

`pushPendingAction` est connecté par le chargeur d'outils personnalisés en utilisant le `PendingActionStore` de la session active.

Si le runtime ne dispose pas de magasin d'actions en attente, `pushPendingAction` lève une exception :

- `Pending action store unavailable for custom tools in this runtime.`

## Comportement du choix d'outil

Lorsque `PendingActionStore.hasPending` est vrai, le runtime de l'agent oriente le choix d'outil vers `resolve` afin que les prévisualisations en attente soient explicitement finalisées avant que le flux normal des outils ne reprenne.

## Recommandations pour les développeurs

- Utilisez les actions en attente uniquement pour les opérations destructives ou à fort impact qui doivent supporter une application/un abandon explicite.
- Gardez le `label` concis et spécifique ; il est affiché dans la sortie du rendu de resolve.
- Assurez-vous que `apply(reason)` est déterministe et suffisamment idempotent pour une exécution unique ; `reason` est informatif et ne doit pas modifier le comportement.
- Implémentez `reject(reason)` lorsque l'abandon nécessite un nettoyage (état temporaire, verrous, notifications) ; omettez-le pour les prévisualisations sans état où le message par défaut suffit.
- Si votre outil peut empiler plusieurs prévisualisations, souvenez-vous de la sémantique LIFO : la dernière action poussée est résolue en premier.
