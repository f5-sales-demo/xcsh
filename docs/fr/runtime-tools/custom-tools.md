---
title: Custom Tools
description: >-
  Enregistrement d'outils personnalisés, définition de schéma et pipeline
  d'exécution pour étendre l'agent.
sidebar:
  order: 4
  label: Custom tools
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# Outils personnalisés

Les outils personnalisés sont des fonctions appelables par le modèle qui s'intègrent dans le même pipeline d'exécution que les outils intégrés.

Un outil personnalisé est un module TypeScript/JavaScript qui exporte une factory. La factory reçoit une API hôte (`CustomToolAPI`) et retourne un outil ou un tableau d'outils.

## Ce que c'est (et ce que ce n'est pas)

- **Outil personnalisé** : appelable par le modèle pendant un tour (`execute` + schéma TypeBox).
- **Extension** : framework de cycle de vie/événements qui peut enregistrer des outils et intercepter/modifier des événements.
- **Hook** : scripts de commande externes pré/post.
- **Skill** : package statique de guidance/contexte, pas du code d'outil exécutable.

Si vous avez besoin que le modèle appelle du code directement, utilisez un outil personnalisé.

## Chemins d'intégration dans le code actuel

Il existe deux styles d'intégration actifs :

1. **Outils personnalisés fournis par le SDK** (`options.customTools`)
   - Encapsulés dans des outils agent via `CustomToolAdapter` ou des wrappers d'extension.
   - Toujours inclus dans l'ensemble d'outils actifs initial lors du bootstrap du SDK.

2. **Modules découverts par le système de fichiers via l'API de chargement** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - Exposés comme API de bibliothèque dans `src/extensibility/custom-tools/loader.ts`.
   - Le code hôte peut appeler ces API pour découvrir et charger des modules d'outils à partir des chemins de configuration/fournisseur/plugin.

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
   - Fournisseur de cache du marketplace Claude
2. Les manifestes de plugins installés (`~/.xcsh/plugins/node_modules/*` via le chargeur de plugins)
3. Les chemins configurés explicitement passés au chargeur

### Comportement important

- Les chemins résolus en doublons sont dédupliqués.
- Les conflits de noms d'outils sont rejetés par rapport aux outils intégrés et aux outils personnalisés déjà chargés.
- Les fichiers `.md` et `.json` sont découverts comme métadonnées d'outils par certains fournisseurs, mais le chargeur de modules exécutables les rejette en tant qu'outils exécutables.
- Les chemins configurés relatifs sont résolus à partir de `cwd` ; `~` est développé.

## Contrat du module

Un module d'outil personnalisé doit exporter une fonction (export par défaut préféré) :

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
- `exec(command, args, options?)` : utilitaire d'exécution de processus
- `ui` : contexte UI (peut être no-op en modes headless)
- `hasUI` : `false` dans les flux non interactifs
- `logger` : logger de fichier partagé
- `typebox` : `@sinclair/typebox` injecté
- `pi` : exports `@f5xc-salesdemos/xcsh` injectés
- `pushPendingAction(action)` : enregistre une action de prévisualisation pour l'outil caché `resolve` (`docs/resolve-tool-runtime.md`)

Le chargeur démarre avec un contexte UI no-op et nécessite que le code hôte appelle `setUIContext(...)` lorsque l'UI réelle est prête.

## Contrat d'exécution et typage

Signature de `CustomTool.execute` :

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` est statiquement typé à partir de votre schéma TypeBox via `Static<TParams>`.
- La validation des arguments à l'exécution se produit avant l'exécution dans la boucle de l'agent.
- `onUpdate` émet des résultats partiels pour le streaming UI.
- `ctx` inclut l'état de session/modèle et un utilitaire `abort()`.
- `signal` transporte l'annulation.

`CustomToolAdapter` fait le pont vers l'interface d'outil agent et transmet les appels dans le bon ordre d'arguments.

## Comment les outils sont exposés au modèle

- Les outils sont encapsulés dans des instances `AgentTool` (`CustomToolAdapter` ou wrappers d'extension).
- Ils sont insérés dans le registre d'outils de la session par nom.
- Lors du bootstrap du SDK, les outils personnalisés et ceux enregistrés par extension sont inclus de force dans l'ensemble actif initial.
- Le CLI `--tools` ne valide actuellement que les noms d'outils intégrés ; l'inclusion des outils personnalisés est gérée via les chemins de découverte/enregistrement et les options du SDK.

## Hooks de rendu

Hooks de rendu optionnels :

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

Comportement à l'exécution dans le TUI :

- Si les hooks existent, la sortie de l'outil est rendue à l'intérieur d'un conteneur `Box`.
- `renderResult` reçoit `{ expanded, isPartial, spinnerFrame? }`.
- Les erreurs du moteur de rendu sont capturées et journalisées ; l'UI se rabat sur le rendu textuel par défaut.

## Gestion de la session/état

Le hook optionnel `onSession(event, ctx)` reçoit les événements du cycle de vie de la session, incluant :

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

Utilisez `ctx.sessionManager` pour reconstruire l'état à partir de l'historique lorsque le contexte de branche/session change.

## Sémantique des échecs et de l'annulation

### Échecs synchrones/asynchrones

- Lever une exception (ou les promesses rejetées) dans `execute` est traité comme un échec d'outil.
- Le runtime de l'agent convertit les échecs en messages de résultat d'outil avec `isError: true` et un contenu textuel d'erreur.
- Avec les wrappers d'extension, les gestionnaires `tool_result` peuvent réécrire davantage le contenu/les détails et même surcharger le statut d'erreur.

### Annulation

- L'abandon de l'agent se propage via `AbortSignal` vers `execute`.
- Transmettez `signal` au travail de sous-processus (`pi.exec(..., { signal })`) pour une annulation coopérative.
- `ctx.abort()` permet à un outil de demander l'abandon de l'opération en cours de l'agent.

### Erreurs onSession

- Les erreurs de `onSession` sont capturées et journalisées comme avertissements ; elles ne font pas planter la session.

## Contraintes réelles à prendre en compte dans la conception

- Les noms d'outils doivent être globalement uniques dans le registre actif.
- Préférez des sorties déterministes et structurées selon le schéma dans `details` pour la reconstruction du rendu/état.
- Protégez l'utilisation de l'UI avec `pi.hasUI`.
- Traitez les fichiers `.md`/`.json` dans les répertoires d'outils comme des métadonnées, pas comme des modules exécutables.
