---
title: Outils personnalisés
description: >-
  Enregistrement d'outils personnalisés, définition de schéma et pipeline
  d'exécution pour étendre l'agent.
sidebar:
  order: 4
  label: Outils personnalisés
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# Outils personnalisés

Les outils personnalisés sont des fonctions appelables par le modèle qui s'intègrent au même pipeline d'exécution d'outils que les outils natifs.

Un outil personnalisé est un module TypeScript/JavaScript qui exporte une fabrique. La fabrique reçoit une API hôte (`CustomToolAPI`) et retourne un outil ou un tableau d'outils.

## Ce que c'est (et ce que ce n'est pas)

- **Outil personnalisé** : appelable par le modèle durant un tour (`execute` + schéma TypeBox).
- **Extension** : framework de cycle de vie/événements pouvant enregistrer des outils et intercepter/modifier des événements.
- **Hook** : scripts externes de pré/post-commande.
- **Skill** : ensemble de guidance/contexte statique, pas du code d'outil exécutable.

Si vous avez besoin que le modèle appelle du code directement, utilisez un outil personnalisé.

## Chemins d'intégration dans le code actuel

Il existe deux styles d'intégration actifs :

1. **Outils personnalisés fournis par le SDK** (`options.customTools`)
   - Encapsulés dans des outils agent via `CustomToolAdapter` ou des wrappers d'extension.
   - Toujours inclus dans l'ensemble d'outils actifs initial lors du démarrage du SDK.

2. **Modules découverts via le système de fichiers par l'API de chargement** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - Exposés comme APIs de bibliothèque dans `src/extensibility/custom-tools/loader.ts`.
   - Le code hôte peut les appeler pour découvrir et charger des modules d'outils depuis les chemins de configuration/fournisseur/plugin.

```text
Flux d'appel d'outil du modèle

Appel d'outil LLM
   │
   ▼
Registre d'outils (natifs + adaptateurs d'outils personnalisés)
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> résultat partiel diffusé en streaming
   └─ return result  -> contenu/détails d'outil final
```

## Emplacements de découverte (API de chargement)

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` fusionne :

1. Les fournisseurs de capacités (`toolCapability`), notamment :
   - Configuration OMP native (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Configuration Claude (`~/.claude/tools`, `.claude/tools`)
   - Configuration Codex (`~/.codex/tools`, `.codex/tools`)
   - Fournisseur de cache de plugin de la Place de marché Claude
2. Les manifestes de plugins installés (`~/.xcsh/plugins/node_modules/*` via le chargeur de plugins)
3. Les chemins configurés explicitement passés au chargeur

### Comportement important

- Les chemins résolus en double sont dédupliqués.
- Les conflits de noms d'outils sont rejetés par rapport aux outils natifs et aux outils personnalisés déjà chargés.
- Les fichiers `.md` et `.json` sont découverts comme métadonnées d'outils par certains fournisseurs, mais le chargeur de modules exécutables les rejette en tant qu'outils exécutables.
- Les chemins configurés relatifs sont résolus depuis `cwd` ; `~` est développé.

## Contrat de module

Un module d'outil personnalisé doit exporter une fonction (export par défaut recommandé) :

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

Type de retour de la fabrique :

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## Surface d'API transmise aux fabriques (`CustomToolAPI`)

Depuis `types.ts` et `loader.ts` :

- `cwd` : répertoire de travail hôte
- `exec(command, args, options?)` : assistant d'exécution de processus
- `ui` : contexte UI (peut être sans opération dans les modes sans interface)
- `hasUI` : `false` dans les flux non interactifs
- `logger` : journaliseur de fichiers partagé
- `typebox` : `@sinclair/typebox` injecté
- `pi` : exports `@f5xc-salesdemos/xcsh` injectés
- `pushPendingAction(action)` : enregistre une action de prévisualisation pour l'outil `resolve` masqué (`docs/resolve-tool-runtime.md`)

Le chargeur démarre avec un contexte UI sans opération et nécessite que le code hôte appelle `setUIContext(...)` lorsque la vraie UI est prête.

## Contrat d'exécution et typage

Signature de `CustomTool.execute` :

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` est typé statiquement depuis votre schéma TypeBox via `Static<TParams>`.
- La validation des arguments au moment de l'exécution se produit avant l'exécution dans la boucle agent.
- `onUpdate` émet des résultats partiels pour le streaming UI.
- `ctx` inclut l'état de session/modèle et un assistant `abort()`.
- `signal` transporte l'annulation.

`CustomToolAdapter` établit un pont entre cela et l'interface d'outil agent et transfère les appels dans le bon ordre d'arguments.

## Comment les outils sont exposés au modèle

- Les outils sont encapsulés dans des instances `AgentTool` (`CustomToolAdapter` ou wrappers d'extension).
- Ils sont insérés dans le registre d'outils de session par nom.
- Lors du démarrage du SDK, les outils personnalisés et enregistrés par extension sont forcément inclus dans l'ensemble actif initial.
- La CLI `--tools` valide actuellement uniquement les noms d'outils natifs ; l'inclusion d'outils personnalisés est gérée via les chemins de découverte/enregistrement et les options du SDK.

## Hooks de rendu

Hooks de rendu optionnels :

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

Comportement au moment de l'exécution dans le TUI :

- Si les hooks existent, la sortie de l'outil est rendue dans un conteneur `Box`.
- `renderResult` reçoit `{ expanded, isPartial, spinnerFrame? }`.
- Les erreurs de rendu sont capturées et journalisées ; l'UI revient au rendu de texte par défaut.

## Gestion de session/état

L'optionnel `onSession(event, ctx)` reçoit les événements du cycle de vie de session, notamment :

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

Utilisez `ctx.sessionManager` pour reconstruire l'état depuis l'historique lorsque le contexte de branche/session change.

## Sémantique des échecs et de l'annulation

### Échecs synchrones/asynchrones

- Lever une exception (ou des promesses rejetées) dans `execute` est traité comme un échec d'outil.
- Le runtime agent convertit les échecs en messages de résultat d'outil avec `isError: true` et du contenu textuel d'erreur.
- Avec les wrappers d'extension, les gestionnaires `tool_result` peuvent en outre réécrire le contenu/les détails et même remplacer le statut d'erreur.

### Annulation

- L'abandon de l'agent se propage via `AbortSignal` vers `execute`.
- Transmettez `signal` aux travaux de sous-processus (`pi.exec(..., { signal })`) pour une annulation coopérative.
- `ctx.abort()` permet à un outil de demander l'abandon de l'opération agent en cours.

### Erreurs onSession

- Les erreurs `onSession` sont capturées et journalisées comme avertissements ; elles ne font pas planter la session.

## Contraintes réelles à prendre en compte lors de la conception

- Les noms d'outils doivent être globalement uniques dans le registre actif.
- Préférez des sorties déterministes et structurées selon le schéma dans `details` pour la reconstruction du rendu/état.
- Protégez l'utilisation de l'UI avec `pi.hasUI`.
- Traitez les fichiers `.md`/`.json` dans les répertoires d'outils comme des métadonnées, pas comme des modules exécutables.
