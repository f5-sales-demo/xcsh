---
title: Extensions
description: >-
  Aperçu du runtime d'extensions couvrant les types, le cycle de vie du runner,
  l'enregistrement et la découverte.
sidebar:
  order: 1
  label: Aperçu
i18n:
  sourceHash: 2985ce406fa2
  translator: machine
---

# Extensions

Guide principal pour la création d'extensions runtime dans `packages/coding-agent`.

Ce document couvre le runtime d'extensions actuel dans :

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

Pour les chemins de découverte et les règles de chargement du système de fichiers, consultez `docs/extension-loading.md`.

## Qu'est-ce qu'une extension

Une extension est un module TS/JS exportant une factory par défaut :

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

Les extensions peuvent combiner tous les éléments suivants dans un seul module :

- gestionnaires d'événements (`pi.on(...)`)
- outils appelables par LLM (`pi.registerTool(...)`)
- commandes slash (`pi.registerCommand(...)`)
- raccourcis clavier et indicateurs
- rendu personnalisé des messages
- API d'injection de session/message (`sendMessage`, `sendUserMessage`, `appendEntry`)

## Modèle runtime

1. Les extensions sont importées et leurs fonctions factory sont exécutées.
2. Durant cette phase de chargement, les méthodes d'enregistrement sont valides ; les méthodes d'action runtime ne sont pas encore initialisées.
3. `ExtensionRunner.initialize(...)` câble les actions/contextes actifs pour le mode actif.
4. Les événements de cycle de vie de session/agent/outil sont émis vers les gestionnaires.
5. Chaque exécution d'outil est enveloppée avec l'interception d'extension (`tool_call` / `tool_result`).

```text
Extension lifecycle (simplified)

load paths
   │
   ▼
import module + run factory (registration only)
   │
   ▼
ExtensionRunner.initialize(mode/session/tool registry)
   │
   ├─ emit session/agent events to handlers
   ├─ wrap tool execution (tool_call/tool_result)
   └─ expose runtime actions (sendMessage, setActiveTools, ...)
```

Contrainte importante de `loader.ts` :

- l'appel de méthodes d'action comme `pi.sendMessage()` durant le chargement de l'extension lève `ExtensionRuntimeNotInitializedError`
- enregistrez d'abord ; effectuez le comportement runtime depuis les événements/commandes/outils

## Démarrage rapide

```ts
import type { ExtensionAPI } from "@f5xc-salesdemos/xcsh";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
 pi.setLabel("Safety + Utilities");

 pi.on("session_start", async (_event, ctx) => {
  ctx.ui.notify(`Extension loaded in ${ctx.cwd}`, "info");
 });

 pi.on("tool_call", async (event) => {
  if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
   return { block: true, reason: "Blocked by extension policy" };
  }
 });

 pi.registerTool({
  name: "hello_extension",
  label: "Hello Extension",
  description: "Return a greeting",
  parameters: Type.Object({ name: Type.String() }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
   return {
    content: [{ type: "text", text: `Hello, ${params.name}` }],
    details: { greeted: params.name },
   };
  },
 });

 pi.registerCommand("hello-ext", {
  description: "Show queue state",
  handler: async (_args, ctx) => {
   ctx.ui.notify(`pending=${ctx.hasPendingMessages()}`, "info");
  },
 });
}
```

## Surfaces de l'API d'extension

## 1) Enregistrement et actions (`ExtensionAPI`)

Méthodes principales :

- `on(event, handler)`
- `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`
- `registerMessageRenderer`
- `sendMessage`, `sendUserMessage`, `appendEntry`
- `getActiveTools`, `getAllTools`, `setActiveTools`
- `getSessionName`, `setSessionName`
- `setModel`, `getThinkingLevel`, `setThinkingLevel`
- `registerProvider`
- `events` (bus d'événements partagé)

En mode interactif, les gestionnaires `input` s'exécutent avant la vérification de titre automatique intégrée au premier message. Les extensions qui appellent `await pi.setSessionName(...)` depuis `input` peuvent définir le nom de session persisté et empêcher le titre auto-généré par défaut de s'exécuter pour cette session.

Également exposés :

- `pi.logger`
- `pi.typebox`
- `pi.pi` (exports du package)

### Sémantique de livraison des messages

`pi.sendMessage(message, options)` prend en charge :

- `deliverAs: "steer"` (par défaut) — interrompt l'exécution en cours
- `deliverAs: "followUp"` — mis en file d'attente pour s'exécuter après l'exécution en cours
- `deliverAs: "nextTurn"` — stocké et injecté au prochain prompt utilisateur
- `triggerTurn: true` — démarre un tour lorsqu'inactif (`nextTurn` ignore ceci)

`pi.sendUserMessage(content, { deliverAs })` passe toujours par le flux de prompt ; en cours de streaming, il est mis en file d'attente comme steer/follow-up.

## 2) Contexte des gestionnaires (`ExtensionContext`)

Les gestionnaires et l'`execute` des outils reçoivent `ctx` avec :

- `ui`
- `hasUI`
- `cwd`
- `sessionManager` (lecture seule)
- `modelRegistry`, `model`
- `getContextUsage()`
- `compact(...)`
- `isIdle()`, `hasPendingMessages()`, `abort()`
- `shutdown()`
- `getSystemPrompt()`

## 3) Contexte des commandes (`ExtensionCommandContext`)

Les gestionnaires de commandes obtiennent en plus :

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

Utilisez le contexte de commande pour les flux de contrôle de session ; ces méthodes sont intentionnellement séparées des gestionnaires d'événements généraux.

## Surface d'événements (noms et comportements actuels)

Les unions d'événements canoniques et les types de charge utile sont dans `types.ts`.

### Cycle de vie de session

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

Pré-événements annulables :

- `session_before_switch` → `{ cancel?: boolean }`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`

### Cycle de vie des prompts et des tours

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### Cycle de vie des outils

- `tool_call` (pré-exécution, peut bloquer)
- `tool_result` (post-exécution, peut modifier content/details/isError)
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` (observabilité)

`tool_result` fonctionne comme un middleware : les gestionnaires s'exécutent dans l'ordre des extensions et chacun voit les modifications précédentes.

### Signaux de fiabilité/runtime

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### Interception des commandes utilisateur

- `user_bash` (remplacer avec `{ result }`)
- `user_python` (remplacer avec `{ result }`)

### `resources_discover`

`resources_discover` existe dans les types d'extension et dans `ExtensionRunner`.
Note sur le runtime actuel : `ExtensionRunner.emitResourcesDiscover(...)` est implémenté, mais il n'existe pas de points d'appel `AgentSession` l'invoquant dans la base de code actuelle.

## Détails de création d'outils

`registerTool` utilise `ToolDefinition` depuis `types.ts`.

Signature actuelle de `execute` :

```ts
execute(
 toolCallId,
 params,
 signal,
 onUpdate,
 ctx,
): Promise<AgentToolResult>
```

Modèle :

```ts
pi.registerTool({
 name: "my_tool",
 label: "My Tool",
 description: "...",
 parameters: Type.Object({}),
 async execute(_id, _params, signal, onUpdate, ctx) {
  if (signal?.aborted) {
   return { content: [{ type: "text", text: "Cancelled" }] };
  }
  onUpdate?.({ content: [{ type: "text", text: "Working..." }] });
  return { content: [{ type: "text", text: "Done" }], details: {} };
 },
 onSession(event, ctx) {
  // reason: start|switch|branch|tree|shutdown
 },
 renderCall(args, theme) {
  // optional TUI render
 },
 renderResult(result, options, theme, args) {
  // optional TUI render
 },
});
```

`tool_call`/`tool_result` intercepte tous les outils une fois que le registre est enveloppé dans `sdk.ts`, y compris les outils intégrés et les outils d'extension/personnalisés.

## Points d'intégration de l'interface utilisateur

`ctx.ui` implémente l'interface `ExtensionUIContext`. La prise en charge diffère selon le mode.

### Mode interactif (`extension-ui-controller.ts`)

Pris en charge :

- dialogues : `select`, `confirm`, `input`, `editor`
- notifications/statut/texte de l'éditeur/entrée terminal/superpositions personnalisées
- liste/chargement de thèmes par nom (`setTheme` prend en charge les noms sous forme de chaîne)
- bascule d'expansion des outils

Méthodes actuellement sans effet dans ce contrôleur :

- `setFooter`
- `setHeader`
- `setEditorComponent`

À noter également : `setWidget` route actuellement vers le texte de la barre de statut via `setHookWidget(...)`.

### Mode RPC (`rpc-mode.ts`)

`ctx.ui` est soutenu par des événements RPC `extension_ui_request` :

- les méthodes de dialogue (`select`, `confirm`, `input`, `editor`) effectuent un aller-retour vers les réponses client
- les méthodes fire-and-forget émettent des requêtes (`notify`, `setStatus`, `setWidget` pour les tableaux de chaînes, `setTitle`, `setEditorText`)

Non pris en charge/sans effet dans l'implémentation RPC :

- `onTerminalInput`
- `custom`
- `setFooter`, `setHeader`, `setEditorComponent`
- `setWorkingMessage`
- changement/chargement de thème (`setTheme` retourne un échec)
- les contrôles d'expansion des outils sont inactifs

### Chemins d'impression/headless/sous-agent

Lorsqu'aucun contexte UI n'est fourni lors de l'initialisation du runner, `ctx.hasUI` est `false` et les méthodes sont sans effet/retournent des valeurs par défaut.

### Mode interactif en arrière-plan

Le mode arrière-plan installe un objet de contexte UI non interactif. Dans l'implémentation actuelle, `ctx.hasUI` peut toujours être `true` tandis que les dialogues interactifs retournent des valeurs par défaut/comportement sans effet.

## Modèles de session et d'état

Pour un état d'extension durable :

1. Persistez avec `pi.appendEntry(customType, data)`.
2. Reconstruisez l'état depuis `ctx.sessionManager.getBranch()` lors de `session_start`, `session_branch`, `session_tree`.
3. Conservez les `details` des résultats d'outils structurés lorsque l'état doit être visible/reconstructible depuis l'historique des résultats d'outils.

Exemple de modèle de reconstruction :

```ts
pi.on("session_start", async (_event, ctx) => {
 let latest;
 for (const entry of ctx.sessionManager.getBranch()) {
  if (entry.type === "custom" && entry.customType === "my-state") {
   latest = entry.data;
  }
 }
 // restore from latest
});
```

## Points d'extension du rendu

## Renderer de messages personnalisé

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

Utilisé par le rendu interactif lorsque des messages personnalisés sont affichés.

## Renderer d'appel/résultat d'outil

Fournissez `renderCall` / `renderResult` dans les définitions `registerTool` pour une visualisation personnalisée des outils dans le TUI.

## Contraintes et pièges

- Les actions runtime sont indisponibles durant le chargement de l'extension.
- Les erreurs de `tool_call` bloquent l'exécution (échec fermé).
- Les conflits de noms de commandes avec les commandes intégrées sont ignorés avec des diagnostics.
- Les raccourcis réservés sont ignorés (`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`).
- Traitez `ctx.reload()` comme terminal pour le frame du gestionnaire de commande actuel.

## Extensions vs hooks vs outils personnalisés

Utilisez la surface appropriée :

- **Extensions** (`src/extensibility/extensions/*`) : système unifié (événements + outils + commandes + renderers + enregistrement de fournisseur).
- **Hooks** (`src/extensibility/hooks/*`) : API d'événements legacy séparée.
- **Outils personnalisés** (`src/extensibility/custom-tools/*`) : modules axés sur les outils ; lorsqu'ils sont chargés aux côtés des extensions, ils sont adaptés et passent toujours par les wrappers d'interception d'extension.

Si vous avez besoin d'un seul package qui gère la politique, les outils, l'expérience utilisateur des commandes et le rendu ensemble, utilisez les extensions.
