---
title: Custom Tools
description: >-
  Enregistrement d'outils personnalisés, définition de schémas et pipeline
  d'exécution pour étendre l'agent.
sidebar:
  order: 4
  label: Custom tools
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# Outils personnalisés

Les outils personnalisés sont des fonctions appelables par le modèle qui s'intègrent dans le même pipeline d'exécution d'outils que les outils intégrés.

Un outil personnalisé est un module TypeScript/JavaScript qui exporte une factory. La factory reçoit une API hôte (`CustomToolAPI`) et retourne un outil ou un tableau d'outils.

## Ce que c'est (et ce que ce n'est pas)

- **Outil personnalisé** : appelable par le modèle pendant un tour (`execute` + schéma TypeBox).
- **Extension** : framework de cycle de vie/événements qui peut enregistrer des outils et intercepter/modifier des événements.
- **Hook** : scripts de commande externes pré/post exécution.
- **Skill** : package statique de guidance/contexte, pas du code d'outil exécutable.

Si vous avez besoin que le modèle appelle directement du code, utilisez un outil personnalisé.

## Chemins d'intégration dans le code actuel

Il existe deux styles d'intégration actifs :

1. **Outils personnalisés fournis par le SDK** (`options.customTools`)
   - Encapsulés dans des outils d'agent via `CustomToolAdapter` ou des wrappers d'extension.
   - Toujours inclus dans l'ensemble d'outils actifs initial lors du bootstrap du SDK.

2. **Modules découverts par le système de fichiers via l'API de chargement** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - Exposés en tant qu'API de bibliothèque dans `src/extensibility/custom-tools/loader.ts`.
   - Le code hôte peut les appeler pour découvrir et charger des modules d'outils depuis les chemins de configuration/fournisseur/plugin.

```text
Model tool call flow

LLM tool call
   │
   ▼
Tool registry (built-ins + custom tool adapters)
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> streamed partial result
   └─ return result  -> final tool content/details
```

## Emplacements de découverte (API de chargement)

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` fusionne :

1. Les fournisseurs de capacités (`toolCapability`), incluant :
   - Configuration OMP native (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Configuration Claude (`~/.claude/tools`, `.claude/tools`)
   - Configuration Codex (`~/.codex/tools`, `.codex/tools`)
   - Fournisseur de cache des plugins Claude marketplace
2. Les manifestes de plugins installés (`~/.xcsh/plugins/node_modules/*` via le chargeur de plugins)
3. Les chemins configurés explicitement passés au chargeur

### Comportement important

- Les chemins résolus en double sont dédupliqués.
- Les conflits de noms d'outils sont rejetés par rapport aux outils intégrés et aux outils personnalisés déjà chargés.
- Les fichiers `.md` et `.json` sont découverts comme métadonnées d'outils par certains fournisseurs, mais le chargeur de modules exécutables les rejette en tant qu'outils exécutables.
- Les chemins configurés relatifs sont résolus depuis `cwd` ; `~` est développé.

## Contrat du module

Un module d'outil personnalisé doit exporter une fonction (export par défaut de préférence) :

```ts
import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh";

const factory: CustomToolFactory = (pi) => ({
 name: "repo_stats",
 label: "Repo Stats",
 description: "Counts tracked TypeScript files",
 parameters: pi.typebox.Type.Object({
  glob: pi.typebox.Type.Optional(pi.typebox.Type.String({ default: "**/*.ts" })),
 }),

 async execute(toolCallId, params, onUpdate, ctx, signal) {
  onUpdate?.({
   content: [{ type: "text", text: "Scanning files..." }],
   details: { phase: "scan" },
  });

  const result = await pi.exec("git", ["ls-files", params.glob ?? "**/*.ts"], { signal, cwd: pi.cwd });
  if (result.killed) {
   throw new Error("Scan was cancelled");
  }
  if (result.code !== 0) {
   throw new Error(result.stderr || "git ls-files failed");
  }

  const files = result.stdout.split("\n").filter(Boolean);
  return {
   content: [{ type: "text", text: `Found ${files.length} files` }],
   details: { count: files.length, sample: files.slice(0, 10) },
  };
 },

 onSession(event) {
  if (event.reason === "shutdown") {
   // cleanup resources if needed
  }
 },
});

export default factory;
```

Type de retour de la factory :

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## Surface d'API passée aux factories (`CustomToolAPI`)

Depuis `types.ts` et `loader.ts` :

- `cwd` : répertoire de travail de l'hôte
- `exec(command, args, options?)` : assistant d'exécution de processus
- `ui` : contexte UI (peut être no-op en modes headless)
- `hasUI` : `false` dans les flux non interactifs
- `logger` : logger de fichier partagé
- `typebox` : `@sinclair/typebox` injecté
- `pi` : exports `@f5xc-salesdemos/xcsh` injectés
- `pushPendingAction(action)` : enregistrer une action de prévisualisation pour l'outil `resolve` caché (`docs/resolve-tool-runtime.md`)

Le chargeur démarre avec un contexte UI no-op et nécessite que le code hôte appelle `setUIContext(...)` lorsque l'UI réelle est prête.

## Contrat d'exécution et typage

Signature de `CustomTool.execute` :

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` est typé statiquement depuis votre schéma TypeBox via `Static<TParams>`.
- La validation des arguments à l'exécution se produit avant l'exécution dans la boucle de l'agent.
- `onUpdate` émet des résultats partiels pour le streaming UI.
- `ctx` inclut l'état de la session/du modèle et un assistant `abort()`.
- `signal` transporte l'annulation.

`CustomToolAdapter` fait le pont vers l'interface d'outil de l'agent et transmet les appels dans l'ordre correct des arguments.

## Comment les outils sont exposés au modèle

- Les outils sont encapsulés dans des instances `AgentTool` (`CustomToolAdapter` ou wrappers d'extension).
- Ils sont insérés dans le registre d'outils de la session par nom.
- Lors du bootstrap du SDK, les outils personnalisés et ceux enregistrés par extension sont forcément inclus dans l'ensemble actif initial.
- `--tools` en CLI ne valide actuellement que les noms d'outils intégrés ; l'inclusion des outils personnalisés est gérée par les chemins de découverte/enregistrement et les options du SDK.

## Hooks de rendu

Hooks de rendu optionnels :

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

Comportement à l'exécution dans le TUI :

- Si les hooks existent, la sortie de l'outil est rendue à l'intérieur d'un conteneur `Box`.
- `renderResult` reçoit `{ expanded, isPartial, spinnerFrame? }`.
- Les erreurs du renderer sont capturées et journalisées ; l'UI se rabat sur le rendu de texte par défaut.

## Gestion de la session/état

Le callback optionnel `onSession(event, ctx)` reçoit les événements du cycle de vie de la session, incluant :

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

Utilisez `ctx.sessionManager` pour reconstruire l'état à partir de l'historique lorsque le contexte de branche/session change.

## Sémantiques d'échec et d'annulation

### Échecs synchrones/asynchrones

- Lancer une exception (ou des promesses rejetées) dans `execute` est traité comme un échec de l'outil.
- Le runtime de l'agent convertit les échecs en messages de résultat d'outil avec `isError: true` et un contenu texte d'erreur.
- Avec les wrappers d'extension, les handlers `tool_result` peuvent réécrire davantage le contenu/les détails et même remplacer le statut d'erreur.

### Annulation

- L'abandon de l'agent se propage via `AbortSignal` jusqu'à `execute`.
- Transmettez `signal` aux travaux de sous-processus (`pi.exec(..., { signal })`) pour une annulation coopérative.
- `ctx.abort()` permet à un outil de demander l'abandon de l'opération en cours de l'agent.

### Erreurs onSession

- Les erreurs de `onSession` sont capturées et journalisées comme avertissements ; elles ne font pas planter la session.

## Contraintes réelles à prendre en compte dans la conception

- Les noms d'outils doivent être globalement uniques dans le registre actif.
- Préférez des sorties déterministes et conformes au schéma dans `details` pour la reconstruction du renderer/état.
- Protégez l'utilisation de l'UI avec `pi.hasUI`.
- Traitez les fichiers `.md`/`.json` dans les répertoires d'outils comme des métadonnées, pas comme des modules exécutables.
