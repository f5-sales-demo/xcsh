---
title: SDK
description: >-
  SDK for building custom agents and integrations on top of the xcsh coding
  agent runtime.
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

Le SDK est la surface d'intégration en processus pour `@f5xc-salesdemos/xcsh`.
Utilisez-le lorsque vous souhaitez un accès direct à l'état de l'agent, au streaming d'événements, au câblage des outils et au contrôle de session depuis votre propre processus Bun/Node.

Si vous avez besoin d'isolation inter-langage/inter-processus, utilisez plutôt le mode RPC.

## Installation

```bash
bun add @f5xc-salesdemos/xcsh
```

## Points d'entrée

`@f5xc-salesdemos/xcsh` exporte les API du SDK depuis la racine du package (et également via `@f5xc-salesdemos/xcsh/sdk`).

Exports principaux pour les intégrateurs :

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- Helpers de découverte (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- Surface de fabrique d'outils (`createTools`, `BUILTIN_TOOLS`, classes d'outils)

## Démarrage rapide (valeurs par défaut avec auto-découverte)

```ts
import { createAgentSession } from "@f5xc-salesdemos/xcsh";

const { session, modelFallbackMessage } = await createAgentSession();

if (modelFallbackMessage) {
 process.stderr.write(`${modelFallbackMessage}\n`);
}

const unsubscribe = session.subscribe(event => {
 if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
  process.stdout.write(event.assistantMessageEvent.delta);
 }
});

await session.prompt("Summarize this repository in 3 bullets.");
unsubscribe();
await session.dispose();
```

## Ce que `createAgentSession()` découvre par défaut

`createAgentSession()` suit le principe « fournir pour surcharger, omettre pour découvrir ».

En cas d'omission, il résout :

- `cwd` : `getProjectDir()`
- `agentDir` : `~/.xcsh/agent` (via `getAgentDir()`)
- `authStorage` : `discoverAuthStorage(agentDir)`
- `modelRegistry` : `new ModelRegistry(authStorage)` + `await refresh()`
- `settings` : `await Settings.init({ cwd, agentDir })`
- `sessionManager` : `SessionManager.create(cwd)` (sauvegardé sur fichier)
- skills/fichiers de contexte/modèles de prompt/commandes slash/extensions/commandes TS personnalisées
- outils intégrés via `createTools(...)`
- outils MCP (activés par défaut)
- intégration LSP (activée par défaut)

### Entrées requises vs optionnelles

En général, vous ne devez fournir que ce que vous souhaitez contrôler :

- **À fournir obligatoirement** : rien pour une session minimale
- **Généralement fourni explicitement** dans les intégrateurs :
    - `sessionManager` (si vous avez besoin d'un stockage en mémoire ou d'un emplacement personnalisé)
    - `authStorage` + `modelRegistry` (si vous gérez le cycle de vie des identifiants/modèles)
    - `model` ou `modelPattern` (si la sélection déterministe du modèle est importante)
    - `settings` (si vous avez besoin d'une configuration isolée/de test)

## Comportement du gestionnaire de session (persistant vs en mémoire)

`AgentSession` utilise toujours un `SessionManager` ; le comportement dépend de la fabrique utilisée.

### Sauvegardé sur fichier (par défaut)

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // absolute .jsonl path
```

- Persiste les conversations/messages/deltas d'état dans des fichiers de session.
- Prend en charge les workflows de reprise/ouverture/liste/fork.
- `session.sessionFile` est défini.

### En mémoire

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- Aucune persistance sur le système de fichiers.
- Utile pour les tests, les workers éphémères, les agents à portée de requête.
- Les méthodes de session fonctionnent toujours, mais les comportements spécifiques à la persistance (reprise de fichier/chemins de fork) sont naturellement limités.

### Helpers de reprise/ouverture/liste

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## Câblage du modèle et de l'authentification

`createAgentSession()` utilise `ModelRegistry` + `AuthStorage` pour la sélection du modèle et la résolution des clés API.

### Câblage explicite

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
} from "@f5xc-salesdemos/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const available = modelRegistry.getAvailable();
if (available.length === 0) throw new Error("No authenticated models available");

const { session } = await createAgentSession({
 authStorage,
 modelRegistry,
 model: available[0],
 thinkingLevel: "medium",
 sessionManager: SessionManager.inMemory(),
});
```

### Ordre de sélection lorsque `model` est omis

Lorsqu'aucun `model`/`modelPattern` explicite n'est fourni :

1. restaurer le modèle depuis la session existante (si restaurable + clé disponible)
2. rôle de modèle par défaut dans les paramètres (`default`)
3. premier modèle disponible avec une authentification valide

Si la restauration échoue, `modelFallbackMessage` explique le repli.

### Priorité de l'authentification

`AuthStorage.getApiKey(...)` résout dans cet ordre :

1. surcharge à l'exécution (`setRuntimeApiKey`)
2. identifiants stockés dans `agent.db`
3. variables d'environnement du fournisseur
4. repli sur le résolveur de fournisseur personnalisé (si configuré)

## Modèle d'abonnement aux événements

Abonnez-vous avec `session.subscribe(listener)` ; cela retourne une fonction de désabonnement.

```ts
const unsubscribe = session.subscribe(event => {
 switch (event.type) {
  case "agent_start":
  case "turn_start":
  case "tool_execution_start":
   break;
  case "message_update":
   if (event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
   }
   break;
 }
});
```

`AgentSessionEvent` inclut les événements `AgentEvent` de base plus les événements au niveau de la session :

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## Cycle de vie du prompt

`session.prompt(text, options?)` est le point d'entrée principal.

Comportement :

1. expansion optionnelle de commande/modèle (commandes `/`, commandes personnalisées, commandes slash de fichier, modèles de prompt)
2. si un streaming est en cours :
    - nécessite `streamingBehavior: "steer" | "followUp"`
    - met en file d'attente au lieu de rejeter le travail
3. si inactif :
    - valide le modèle + la clé API
    - ajoute le message utilisateur
    - démarre le tour de l'agent

API associées :

- `sendUserMessage(content, { deliverAs? })`
- `steer(text, images?)`
- `followUp(text, images?)`
- `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`
- `abort()`

## Outils et intégration des extensions

### Outils intégrés et filtrage

- Les outils intégrés proviennent de `createTools(...)` et `BUILTIN_TOOLS`.
- `toolNames` agit comme une liste d'autorisation pour les outils intégrés.
- `customTools` et les outils enregistrés par les extensions sont toujours inclus.
- Les outils masqués (par exemple `submit_result`) sont optionnels sauf si requis par les options.

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### Extensions

- `extensions` : `ExtensionFactory[]` en ligne
- `additionalExtensionPaths` : charger des fichiers d'extension supplémentaires
- `disableExtensionDiscovery` : désactiver l'analyse automatique des extensions
- `preloadedExtensions` : réutiliser un ensemble d'extensions déjà chargé

### Modifications de l'ensemble d'outils à l'exécution

`AgentSession` prend en charge les mises à jour d'activation à l'exécution :

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

Le prompt système est reconstruit pour refléter les changements d'outils actifs.

## Helpers de découverte

Utilisez-les lorsque vous souhaitez un contrôle partiel sans recréer la logique de découverte interne :

- `discoverAuthStorage(agentDir?)`
- `discoverExtensions(cwd?)`
- `discoverSkills(cwd?, _agentDir?, settings?)`
- `discoverContextFiles(cwd?, _agentDir?)`
- `discoverPromptTemplates(cwd?, agentDir?)`
- `discoverSlashCommands(cwd?)`
- `discoverCustomTSCommands(cwd?, agentDir?)`
- `discoverMCPServers(cwd?)`
- `buildSystemPrompt(options?)`

## Options orientées sous-agent

Pour les consommateurs du SDK construisant des orchestrateurs (similaires au flux d'exécution de tâches) :

- `outputSchema` : transmet l'attente de sortie structurée dans le contexte de l'outil
- `requireSubmitResultTool` : force l'inclusion de l'outil `submit_result`
- `taskDepth` : contexte de profondeur de récursion pour les sessions de tâches imbriquées
- `parentTaskPrefix` : préfixe de nommage des artefacts pour les sorties de tâches imbriquées

Ces options sont facultatives pour une intégration normale à agent unique.

## Valeur de retour de `createAgentSession()`

```ts
type CreateAgentSessionResult = {
 session: AgentSession;
 extensionsResult: LoadExtensionsResult;
 setToolUIContext: (uiContext: ExtensionUIContext, hasUI: boolean) => void;
 mcpManager?: MCPManager;
 modelFallbackMessage?: string;
 lspServers?: Array<{ name: string; status: "ready" | "error"; fileTypes: string[]; error?: string }>;
};
```

Utilisez `setToolUIContext(...)` uniquement si votre intégrateur fournit des capacités d'interface utilisateur que les outils/extensions doivent appeler.

## Exemple d'intégration minimale contrôlée

```ts
import {
 createAgentSession,
 discoverAuthStorage,
 ModelRegistry,
 SessionManager,
 Settings,
} from "@f5xc-salesdemos/xcsh";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const settings = Settings.isolated({
 "compaction.enabled": true,
 "retry.enabled": true,
});

const { session } = await createAgentSession({
 authStorage,
 modelRegistry,
 settings,
 sessionManager: SessionManager.inMemory(),
 toolNames: ["read", "grep", "find", "edit", "write"],
 enableMCP: false,
 enableLsp: true,
});

session.subscribe(event => {
 if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
  process.stdout.write(event.assistantMessageEvent.delta);
 }
});

await session.prompt("Find all TODO comments in this repo and propose fixes.");
await session.dispose();
```
