---
title: SDK
description: >-
  SDK pour la création d'agents personnalisés et d'intégrations au-dessus du
  runtime de l'agent de codage xcsh.
sidebar:
  order: 6
  label: SDK
i18n:
  sourceHash: 75fd3418b49d
  translator: machine
---

# SDK

Le SDK est la surface d'intégration en cours de processus pour `@f5xc-salesdemos/xcsh`.
Utilisez-le lorsque vous souhaitez un accès direct à l'état de l'agent, la diffusion d'événements, le câblage des outils et le contrôle de session depuis votre propre processus Bun/Node.

Si vous avez besoin d'une isolation inter-langages/processus, utilisez plutôt le mode RPC.

## Installation

```bash
bun add @f5xc-salesdemos/xcsh
```

## Points d'entrée

`@f5xc-salesdemos/xcsh` exporte les API du SDK depuis la racine du paquet (ainsi que via `@f5xc-salesdemos/xcsh/sdk`).

Exports principaux pour les intégrateurs :

- `createAgentSession`
- `SessionManager`
- `Settings`
- `AuthStorage`
- `ModelRegistry`
- `discoverAuthStorage`
- Assistants de découverte (`discoverExtensions`, `discoverSkills`, `discoverContextFiles`, `discoverPromptTemplates`, `discoverSlashCommands`, `discoverCustomTSCommands`, `discoverMCPServers`)
- Surface de fabrique d'outils (`createTools`, `BUILTIN_TOOLS`, classes d'outils)

## Démarrage rapide (valeurs par défaut avec découverte automatique)

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

`createAgentSession()` suit le principe « fournir pour remplacer, omettre pour découvrir ».

En cas d'omission, il résout :

- `cwd` : `getProjectDir()`
- `agentDir` : `~/.xcsh/agent` (via `getAgentDir()`)
- `authStorage` : `discoverAuthStorage(agentDir)`
- `modelRegistry` : `new ModelRegistry(authStorage)` + `await refresh()`
- `settings` : `await Settings.init({ cwd, agentDir })`
- `sessionManager` : `SessionManager.create(cwd)` (sauvegardé sur fichier)
- compétences/fichiers de contexte/modèles de prompts/commandes slash/extensions/commandes TS personnalisées
- outils intégrés via `createTools(...)`
- outils MCP (activés par défaut)
- intégration LSP (activée par défaut)

### Entrées requises et optionnelles

En général, vous ne devez fournir que ce que vous souhaitez contrôler :

- **À fournir obligatoirement** : rien pour une session minimale
- **Généralement fournis explicitement** dans les intégrateurs :
    - `sessionManager` (si vous avez besoin d'un emplacement en mémoire ou personnalisé)
    - `authStorage` + `modelRegistry` (si vous gérez le cycle de vie des identifiants/modèles)
    - `model` ou `modelPattern` (si la sélection déterministe du modèle est importante)
    - `settings` (si vous avez besoin d'une configuration isolée/de test)

## Comportement du gestionnaire de session (persistant ou en mémoire)

`AgentSession` utilise toujours un `SessionManager` ; le comportement dépend de la fabrique utilisée.

### Sauvegardé sur fichier (par défaut)

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.create(process.cwd()),
});

console.log(session.sessionFile); // chemin absolu .jsonl
```

- Persiste la conversation, les messages et les deltas d'état dans des fichiers de session.
- Prend en charge les flux de travail de reprise/ouverture/liste/dérivation.
- `session.sessionFile` est défini.

### En mémoire

```ts
import { createAgentSession, SessionManager } from "@f5xc-salesdemos/xcsh";

const { session } = await createAgentSession({
 sessionManager: SessionManager.inMemory(),
});

console.log(session.sessionFile); // undefined
```

- Pas de persistance sur le système de fichiers.
- Utile pour les tests, les workers éphémères, les agents à portée de requête.
- Les méthodes de session fonctionnent toujours, mais les comportements spécifiques à la persistance (reprise de fichier/chemins de dérivation) sont naturellement limités.

### Assistants de reprise/ouverture/liste

```ts
import { SessionManager } from "@f5xc-salesdemos/xcsh";

const recent = await SessionManager.continueRecent(process.cwd());
const listed = await SessionManager.list(process.cwd());
const opened = listed[0] ? await SessionManager.open(listed[0].path) : null;
```

## Câblage du modèle et de l'authentification

`createAgentSession()` utilise `ModelRegistry` + `AuthStorage` pour la sélection du modèle et la résolution de la clé API.

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

1. restauration du modèle depuis la session existante (si restaurable + clé disponible)
2. rôle de modèle par défaut des paramètres (`default`)
3. premier modèle disponible avec une authentification valide

En cas d'échec de la restauration, `modelFallbackMessage` explique le repli.

### Priorité d'authentification

`AuthStorage.getApiKey(...)` résout dans cet ordre :

1. remplacement à l'exécution (`setRuntimeApiKey`)
2. identifiants stockés dans `agent.db`
3. variables d'environnement du fournisseur
4. repli sur le résolveur de fournisseur personnalisé (si configuré)

## Modèle d'abonnement aux événements

Abonnez-vous avec `session.subscribe(listener)` ; cela renvoie une fonction de désabonnement.

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

`AgentSessionEvent` inclut les `AgentEvent` principaux ainsi que les événements au niveau de la session :

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

## Cycle de vie des prompts

`session.prompt(text, options?)` est le point d'entrée principal.

Comportement :

1. expansion optionnelle des commandes/modèles (commandes `/`, commandes personnalisées, commandes slash sur fichiers, modèles de prompts)
2. si actuellement en cours de diffusion :
    - nécessite `streamingBehavior: "steer" | "followUp"`
    - met en file d'attente au lieu d'abandonner le travail
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

### Intégrés et filtrage

- Les outils intégrés proviennent de `createTools(...)` et `BUILTIN_TOOLS`.
- `toolNames` agit comme une liste d'autorisation pour les outils intégrés.
- Les outils `customTools` et ceux enregistrés par les extensions sont toujours inclus.
- Les outils masqués (par exemple `submit_result`) sont optionnels, sauf s'ils sont requis par les options.

```ts
const { session } = await createAgentSession({
 toolNames: ["read", "grep", "find", "write"],
 requireSubmitResultTool: true,
});
```

### Extensions

- `extensions` : `ExtensionFactory[]` en ligne
- `additionalExtensionPaths` : charge des fichiers d'extension supplémentaires
- `disableExtensionDiscovery` : désactive la recherche automatique d'extensions
- `preloadedExtensions` : réutilise un ensemble d'extensions déjà chargées

### Modifications de l'ensemble d'outils à l'exécution

`AgentSession` prend en charge les mises à jour d'activation à l'exécution :

- `getActiveToolNames()`
- `getAllToolNames()`
- `setActiveToolsByName(names)`
- `refreshMCPTools(mcpTools)`

Le prompt système est reconstruit pour refléter les changements d'outils actifs.

## Assistants de découverte

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

## Options orientées sous-agents

Pour les consommateurs du SDK qui construisent des orchestrateurs (similaire au flux d'exécution de tâches) :

- `outputSchema` : transmet l'attente de sortie structurée dans le contexte de l'outil
- `requireSubmitResultTool` : force l'inclusion de l'outil `submit_result`
- `taskDepth` : contexte de profondeur de récursion pour les sessions de tâches imbriquées
- `parentTaskPrefix` : préfixe de nommage des artefacts pour les sorties de tâches imbriquées

Ces options sont facultatives pour l'intégration normale d'un agent unique.

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

## Exemple d'intégration contrôlée minimale

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
