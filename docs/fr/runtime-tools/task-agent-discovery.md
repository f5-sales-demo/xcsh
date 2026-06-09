---
title: Découverte et sélection des agents de tâches
description: >-
  Logique de découverte et de sélection des agents de tâches pour le routage du
  travail vers des types de sous-agents spécialisés.
sidebar:
  order: 6
  label: Découverte des agents de tâches
i18n:
  sourceHash: 8cf42457c672
  translator: machine
---

# Découverte et sélection des agents de tâches

Ce document décrit comment le sous-système de tâches découvre les définitions d'agents, fusionne plusieurs sources et résout un agent demandé au moment de l'exécution.

Il couvre le comportement à l'exécution tel qu'implémenté aujourd'hui, y compris la précédence, la gestion des définitions invalides et les contraintes de création/profondeur qui peuvent rendre un agent effectivement indisponible.

## Fichiers d'implémentation

- [`src/task/discovery.ts`](../../packages/coding-agent/src/task/discovery.ts)
- [`src/task/agents.ts`](../../packages/coding-agent/src/task/agents.ts)
- [`src/task/types.ts`](../../packages/coding-agent/src/task/types.ts)
- [`src/task/index.ts`](../../packages/coding-agent/src/task/index.ts)
- [`src/task/commands.ts`](../../packages/coding-agent/src/task/commands.ts)
- [`src/prompts/agents/task.md`](../../packages/coding-agent/src/prompts/agents/task.md)
- [`src/prompts/tools/task.md`](../../packages/coding-agent/src/prompts/tools/task.md)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/config.ts`](../../packages/coding-agent/src/config.ts)
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts)

---

## Structure de la définition d'agent

Les agents de tâches se normalisent en `AgentDefinition` (`src/task/types.ts`) :

- `name`, `description`, `systemPrompt` (requis pour un agent chargé valide)
- optionnels : `tools`, `spawns`, `model`, `thinkingLevel`, `output`
- `source` : `"bundled" | "user" | "project"`
- optionnel : `filePath`

L'analyse provient du frontmatter via `parseAgentFields()` (`src/discovery/helpers.ts`) :

- `name` ou `description` manquant => invalide (`null`), l'appelant traite comme un échec d'analyse
- `tools` accepte CSV ou tableau ; si fourni, `submit_result` est automatiquement ajouté
- `spawns` accepte `*`, CSV ou tableau
- comportement de rétrocompatibilité : si `spawns` est absent mais que `tools` inclut `task`, `spawns` devient `*`
- `output` est transmis tel quel comme données de schéma opaques

## Agents intégrés

Les agents intégrés sont embarqués au moment de la compilation (`src/task/agents.ts`) via des imports de texte.

`EMBEDDED_AGENT_DEFS` définit :

- `explore`, `plan`, `designer`, `reviewer` à partir de fichiers de prompts
- `task` et `quick_task` à partir du corps partagé `task.md` plus un frontmatter injecté

Chemin de chargement :

1. `loadBundledAgents()` analyse le markdown embarqué avec `parseAgent(..., "bundled", "fatal")`
2. les résultats sont mis en cache en mémoire (`bundledAgentsCache`)
3. `clearBundledAgentsCache()` est une réinitialisation du cache réservée aux tests

Comme l'analyse des agents intégrés utilise `level: "fatal"`, un frontmatter malformé d'agent intégré lève une exception et peut faire échouer entièrement la découverte.

## Découverte par système de fichiers et plugins

`discoverAgents(cwd, home)` (`src/task/discovery.ts`) fusionne les agents de plusieurs emplacements avant d'ajouter les définitions intégrées.

### Entrées de découverte

1. Répertoires d'agents de la configuration utilisateur depuis `getConfigDirs("agents", { project: false })`
2. Répertoires d'agents de projet les plus proches depuis `findAllNearestProjectConfigDirs("agents", cwd)`
3. Racines de plugins Claude (`listClaudePluginRoots(home)`) avec les sous-répertoires `agents/`
4. Agents intégrés (`loadBundledAgents()`)

### Ordre réel des sources

L'ordre des familles de sources provient de `getConfigDirs("", { project: false })`, qui est dérivé de `priorityList` dans `src/config.ts` :

1. `.xcsh`
2. `.claude`
3. `.codex`
4. `.gemini`

Pour chaque famille de sources, l'ordre de découverte est :

1. répertoire de projet le plus proche pour cette source (si trouvé)
2. répertoire utilisateur pour cette source

Après tous les répertoires de familles de sources, les répertoires `agents/` des plugins sont ajoutés (plugins de portée projet d'abord, puis de portée utilisateur).

Les agents intégrés sont ajoutés en dernier.

### Avertissement important : commentaires obsolètes vs code actuel

Les commentaires d'en-tête de `discovery.ts` mentionnent encore `.pi` et ne mentionnent pas `.codex`/`.gemini`. L'ordre réel à l'exécution est piloté par `src/config.ts` et utilise actuellement `.xcsh`, `.claude`, `.codex`, `.gemini`.

## Règles de fusion et de collision

La découverte utilise une déduplication premier-arrivé-gagnant par `agent.name` exact :

- Un `Set<string>` suit les noms déjà vus.
- Les agents chargés sont aplatis dans l'ordre des répertoires et conservés uniquement si le nom n'a pas été vu.
- Les agents intégrés sont filtrés par rapport au même ensemble et ajoutés uniquement s'ils n'ont pas encore été vus.

Implications :

- Le projet remplace l'utilisateur pour la même famille de sources.
- La famille de sources de priorité supérieure remplace la priorité inférieure (`.xcsh` avant `.claude`, etc.).
- Les agents non intégrés remplacent les agents intégrés portant le même nom.
- La correspondance des noms est sensible à la casse (`Task` et `task` sont distincts).
- Au sein d'un même répertoire, les fichiers markdown sont lus dans l'ordre lexicographique des noms de fichiers avant la déduplication.

## Comportement en cas de fichier d'agent invalide/manquant

Par répertoire (`loadAgentsFromDir`) :

- répertoire illisible/manquant : traité comme vide (`readdir(...).catch(() => [])`)
- échec de lecture ou d'analyse de fichier : avertissement journalisé, fichier ignoré
- le chemin d'analyse utilise `parseAgent(..., level: "warn")`

Le comportement en cas d'échec du frontmatter provient de `parseFrontmatter` :

- une erreur d'analyse au niveau `warn` journalise un avertissement
- l'analyseur se rabat sur un analyseur ligne par ligne simple `key: value`
- si les champs requis sont toujours manquants, `parseAgentFields` échoue, puis `AgentParsingError` est levée et interceptée par l'appelant (fichier ignoré)

Effet net : un seul fichier d'agent personnalisé défectueux n'interrompt pas la découverte des autres fichiers.

## Recherche et sélection d'agent

La recherche est une recherche linéaire par nom exact :

- `getAgent(agents, name)` => `agents.find(a => a.name === name)`

Dans l'exécution de tâche (`TaskTool.execute`) :

1. les agents sont redécouverts au moment de l'appel (`discoverAgents(this.session.cwd)`)
2. le `params.agent` demandé est résolu via `getAgent`
3. un agent manquant retourne une réponse d'outil immédiate :
   - `Unknown agent "...". Available: ...`
   - aucun sous-processus n'est lancé

### Description vs découverte au moment de l'exécution

`TaskTool.create()` construit la description de l'outil à partir des résultats de découverte au moment de l'initialisation (`buildDescription`).

`execute()` redécouvre les agents à nouveau. Ainsi, l'ensemble à l'exécution peut différer de ce qui était listé dans la description d'outil précédente si les fichiers d'agents ont changé en cours de session.

## Garde-fous de sortie structurée et précédence des schémas

Précédence du schéma de sortie à l'exécution dans `TaskTool.execute` :

1. `output` du frontmatter de l'agent
2. `params.schema` de l'appel de tâche
3. `outputSchema` de la session parente

(`effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema`)

Le texte de garde-fou au niveau des prompts dans `src/prompts/tools/task.md` avertit du comportement en cas de non-concordance pour les agents à sortie structurée (`explore`, `reviewer`) : les instructions de format de sortie dans la prose peuvent entrer en conflit avec le schéma intégré et produire des sorties `null`.

Ceci est un guide, pas une logique de validation stricte à l'exécution dans `discoverAgents`.

## Interaction avec la découverte de commandes

`src/task/commands.ts` est une infrastructure parallèle pour les commandes de workflow (pas les définitions d'agents), mais elle suit le même schéma général :

- découvrir à partir des fournisseurs de capacités en premier
- dédupliquer par nom avec premier-arrivé-gagnant
- ajouter les commandes intégrées si elles n'ont pas encore été vues
- recherche par nom exact via `getCommand`

Dans `src/task/index.ts`, les helpers de commandes sont réexportés avec les helpers de découverte d'agents. La découverte d'agents elle-même ne dépend pas de la découverte de commandes à l'exécution.

## Contraintes de disponibilité au-delà de la découverte

Un agent peut être découvrable mais toujours indisponible à l'exécution en raison des garde-fous d'exécution.

### Politique de création du parent

`TaskTool.execute` vérifie `session.getSessionSpawns()` :

- `"*"` => autoriser tout
- `""` => tout refuser
- liste CSV => autoriser uniquement les noms listés

Si refusé : réponse immédiate `Cannot spawn '...'. Allowed: ...`.

### Protection environnementale contre l'auto-récursion bloquée

`PI_BLOCKED_AGENT` est lu lors de la construction de l'outil. Si la requête correspond, l'exécution est rejetée avec un message de prévention de récursion.

### Contrôle de la profondeur de récursion (disponibilité de l'outil task dans les sessions enfants)

Dans `runSubprocess` (`src/task/executor.ts`) :

- la profondeur est calculée à partir de `taskDepth`
- `task.maxRecursionDepth` contrôle le seuil
- lorsqu'on atteint la profondeur maximale :
  - l'outil `task` est supprimé de la liste d'outils enfant
  - le `spawns` env de l'enfant est défini comme vide

Ainsi, les niveaux plus profonds ne peuvent pas créer d'autres tâches même si la définition de l'agent inclut `spawns`.

## Avertissement concernant le mode plan (implémentation actuelle)

`TaskTool.execute` calcule un `effectiveAgent` pour le mode plan (préfixe le prompt du mode plan, force un sous-ensemble d'outils en lecture seule, supprime les spawns), mais `runSubprocess` est appelé avec `agent` plutôt qu'`effectiveAgent`.

Effet actuel :

- le remplacement de modèle / niveau de réflexion / schéma de sortie sont dérivés de `effectiveAgent`
- le prompt système et les restrictions d'outils/spawns de `effectiveAgent` ne sont pas transmis dans ce chemin d'appel

C'est un avertissement d'implémentation qu'il est bon de connaître lors de la lecture des attentes de comportement en mode plan.
