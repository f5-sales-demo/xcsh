---
title: Fonctionnement interne des commandes slash
description: >-
  Fonctionnement interne du système de commandes slash avec enregistrement,
  analyse des arguments et dispatch d'exécution.
sidebar:
  order: 5
  label: Commandes slash
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# Fonctionnement interne des commandes slash

Ce document décrit comment les commandes slash sont découvertes, dédupliquées, exposées en mode interactif et développées au moment de la saisie dans `coding-agent`.

## Fichiers d'implémentation

- [`src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)
- [`src/capability/slash-command.ts`](../../packages/coding-agent/src/capability/slash-command.ts)
- [`src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`src/discovery/claude.ts`](../../packages/coding-agent/src/discovery/claude.ts)
- [`src/discovery/codex.ts`](../../packages/coding-agent/src/discovery/codex.ts)
- [`src/discovery/claude-plugins.ts`](../../packages/coding-agent/src/discovery/claude-plugins.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)

## 1) Modèle de découverte

Les commandes slash sont une capacité (`id: "slash-commands"`) indexée par nom de commande (`key: cmd => cmd.name`).

Le registre de capacités charge tous les fournisseurs enregistrés, triés par priorité décroissante, et déduplique par clé selon la sémantique **premier arrivé, premier servi**.

### Priorité des fournisseurs

Fournisseurs de commandes slash actuels et leurs priorités :

1. `native` (OMP) — priorité `100`
2. `claude` — priorité `80`
3. `claude-plugins` — priorité `70`
4. `codex` — priorité `70`

Comportement en cas d'égalité : les fournisseurs de même priorité conservent l'ordre d'enregistrement. L'ordre d'importation actuel enregistre `claude-plugins` avant `codex`, donc les commandes de plugin l'emportent sur les commandes codex en cas de collision de noms.

### Comportement en cas de collision de noms

Pour `slash-commands`, les collisions sont résolues strictement par déduplication de capacité :

- l'élément de plus haute priorité est conservé dans `result.items`
- les doublons de priorité inférieure ne figurent que dans `result.all` et sont marqués `_shadowed = true`

Cela s'applique entre fournisseurs et également au sein d'un même fournisseur s'il retourne des noms en double.

### Comportement d'analyse des fichiers

Les fournisseurs utilisent principalement `loadFilesFromDir(...)`, qui actuellement :

- utilise par défaut une correspondance non récursive (`*.md`)
- utilise le glob natif avec `gitignore: true`, `hidden: false`
- lit chaque fichier correspondant et le transforme en `SlashCommand`

Ainsi, les fichiers/répertoires cachés ne sont pas chargés, et les chemins ignorés sont exclus.

## 2) Chemins source spécifiques aux fournisseurs et précédence locale

## Fournisseur `native` (`builtin.ts`)

Les racines de recherche proviennent des répertoires `.xcsh` :

- projet : `<cwd>/.xcsh/commands/*.md`
- utilisateur : `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` retourne le projet en premier, puis l'utilisateur, donc **les commandes natives du projet l'emportent sur les commandes natives de l'utilisateur** en cas de collision de noms.

## Fournisseur `claude` (`claude.ts`)

Charge :

- utilisateur : `~/.claude/commands/*.md`
- projet : `<cwd>/.claude/commands/*.md`

Le fournisseur pousse les éléments utilisateur avant les éléments projet, donc **les commandes Claude de l'utilisateur l'emportent sur les commandes Claude du projet** en cas de collision de même nom au sein de ce fournisseur.

## Fournisseur `codex` (`codex.ts`)

Charge :

- utilisateur : `~/.codex/commands/*.md`
- projet : `<cwd>/.codex/commands/*.md`

Les deux côtés sont chargés puis aplatis dans l'ordre utilisateur en premier, donc **les commandes Codex de l'utilisateur l'emportent sur les commandes Codex du projet** en cas de collision.

Le contenu des commandes Codex est analysé avec suppression du frontmatter (`parseFrontmatter`), et le nom de la commande peut être remplacé par le champ `name` du frontmatter ; sinon, le nom du fichier est utilisé.

## Fournisseur `claude-plugins` (`claude-plugins.ts`)

Charge les racines de commandes de plugins depuis `~/.claude/plugins/installed_plugins.json`, puis analyse `<pluginRoot>/commands/*.md`.

L'ordre suit l'ordre d'itération du registre et l'ordre d'entrée par plugin dans ce fichier JSON. Il n'y a pas d'étape de tri supplémentaire.

## 3) Matérialisation en `FileSlashCommand` à l'exécution

`loadSlashCommands()` dans `src/extensibility/slash-commands.ts` convertit les éléments de capacité en objets `FileSlashCommand` utilisés au moment de la saisie.

Pour chaque commande :

1. analyser le frontmatter/corps (`parseFrontmatter`)
2. source de la description :
   - `frontmatter.description` si présent
   - sinon la première ligne non vide du corps (tronquée, max 60 caractères avec `...`)
3. conserver le corps analysé comme contenu de modèle exécutable
4. calculer une chaîne de source d'affichage comme `via Claude Code Project`

La sévérité d'analyse du frontmatter dépend de la source :

- niveau `native` -> les erreurs d'analyse sont `fatal`
- niveaux `user`/`project` -> les erreurs d'analyse sont `warn` avec analyse de repli

### Commandes de repli intégrées

Après les commandes du système de fichiers/fournisseur, des modèles de commandes intégrés sont ajoutés (`EMBEDDED_COMMAND_TEMPLATES`) si leurs noms ne sont pas déjà présents.

L'ensemble intégré actuel provient de `src/task/commands.ts` et est utilisé comme repli (`source: "bundled"`).

## 4) Mode interactif : origine des listes de commandes

Le mode interactif combine plusieurs sources de commandes pour l'autocomplétion et le routage des commandes.

Au moment de la construction, il constitue une liste de commandes en attente à partir de :

- commandes intégrées (`BUILTIN_SLASH_COMMANDS`, inclut la complétion des arguments et les suggestions en ligne pour les commandes sélectionnées)
- commandes slash enregistrées par extension (`extensionRunner.getRegisteredCommands(...)`)
- commandes personnalisées TypeScript (`session.customCommands`), mappées aux libellés de commandes slash
- commandes de compétence optionnelles (`/skill:<name>`) lorsque `skills.enableSkillCommands` est activé

Ensuite, `init()` appelle `refreshSlashCommandState(...)` pour charger les commandes basées sur les fichiers et installer un `CombinedAutocompleteProvider` contenant :

- les commandes en attente ci-dessus
- les commandes découvertes basées sur les fichiers

`refreshSlashCommandState(...)` met également à jour `session.setSlashCommands(...)` afin que l'expansion des invites utilise le même ensemble de commandes fichiers découvertes.

### Cycle de vie des actualisations

L'état des commandes slash est actualisé :

- lors de l'initialisation interactive
- après qu'un `/move` change le répertoire de travail (`handleMoveCommand` appelle `resetCapabilities()` puis `refreshSlashCommandState(newCwd)`)

Il n'existe pas de surveillance continue des répertoires de commandes.

### Autres surfaces d'exposition

Le tableau de bord Extensions charge également la capacité `slash-commands` et affiche les entrées de commandes actives/masquées, y compris les doublons `_shadowed`.

## 5) Positionnement dans le pipeline d'invite

Ordre de traitement slash dans `AgentSession.prompt(...)` (lorsque `expandPromptTemplates !== false`) :

1. **Commandes d'extension** (`#tryExecuteExtensionCommand`)  
   Si `/name` correspond à une commande enregistrée par extension, le gestionnaire s'exécute immédiatement et l'invite retourne.
2. **Commandes personnalisées TypeScript** (`#tryExecuteCustomCommand`)  
   Limite uniquement : si correspondance, elle s'exécute et peut retourner :
   - `string` -> remplace le texte de l'invite par cette chaîne
   - `void/undefined` -> traité comme géré ; pas d'invite LLM
3. **Commandes slash basées sur des fichiers** (`expandSlashCommand`)  
   Si le texte commence toujours par `/`, tentative d'expansion de commande markdown.
4. **Modèles d'invite** (`expandPromptTemplate`)  
   Appliqués après le traitement slash/personnalisé.
5. **Livraison**
   - inactif : l'invite est envoyée immédiatement à l'agent
   - en streaming : l'invite est mise en file d'attente en tant que steer/follow-up selon `streamingBehavior`

C'est pourquoi l'expansion des commandes slash se situe avant l'expansion des modèles d'invite, et pourquoi les commandes personnalisées peuvent transformer le slash initial avant la correspondance des commandes fichiers.

## 6) Sémantique d'expansion pour les commandes slash basées sur des fichiers

Comportement de `expandSlashCommand(text, fileCommands)` :

- ne s'exécute que lorsque le texte commence par `/`
- analyse le nom de la commande à partir du premier jeton après `/`
- analyse les arguments du texte restant via `parseCommandArgs`
- recherche une correspondance exacte de nom dans les `fileCommands` chargées
- si correspondance, applique :
  - remplacement positionnel : `$1`, `$2`, ...
  - remplacement agrégé : `$ARGUMENTS` et `$@`
  - puis rendu du modèle via `prompt.render` avec `{ args, ARGUMENTS, arguments }`
- si aucune correspondance, retourne le texte original inchangé

### Mises en garde sur `parseCommandArgs`

L'analyseur est un découpage simple avec prise en charge des guillemets :

- prend en charge les guillemets `'simples'` et `"doubles"` pour conserver les espaces
- supprime les délimiteurs de guillemets
- n'implémente pas les règles d'échappement par barre oblique inverse
- un guillemet non fermé n'est pas une erreur ; l'analyseur consomme jusqu'à la fin

## 7) Comportement pour les entrées `/...` inconnues

Les entrées slash inconnues ne sont **pas rejetées** par la logique slash principale.

Si la commande n'est pas gérée par les couches extension/personnalisée/fichier, `expandSlashCommand` retourne le texte original, et l'invite littérale `/...` progresse normalement à travers l'expansion des modèles d'invite et la livraison au LLM.

Le mode interactif gère séparément et de manière stricte de nombreuses commandes intégrées dans `InputController` (par exemple `/settings`, `/model`, `/mcp`, `/move`, `/exit`). Celles-ci sont consommées avant `session.prompt(...)` et n'atteignent donc jamais l'expansion des commandes fichiers dans ce chemin.

## 8) Différences en mode streaming par rapport au mode inactif

## Chemin inactif

- `session.prompt("/x ...")` exécute le pipeline de commandes et soit exécute la commande immédiatement, soit envoie le texte développé directement.

## Chemin streaming (`session.isStreaming === true`)

- `prompt(...)` exécute toujours en premier les transformations extension/personnalisée/fichier/modèle
- puis requiert `streamingBehavior` :
  - `"steer"` -> mettre en file d'attente un message d'interruption (`agent.steer`)
  - `"followUp"` -> mettre en file d'attente un message post-tour (`agent.followUp`)
- si `streamingBehavior` est omis, l'invite génère une erreur

### Comportement de streaming spécifique aux commandes important

- Les commandes d'extension sont exécutées immédiatement même pendant le streaming (non mises en file d'attente sous forme de texte).
- Les méthodes d'assistance `steer(...)`/`followUp(...)` rejettent les commandes d'extension (`#throwIfExtensionCommand`) pour éviter de mettre en file d'attente du texte de commande pour des gestionnaires qui doivent s'exécuter de manière synchrone.
- La relecture de la file d'attente de compaction utilise `isKnownSlashCommand(...)` pour décider si les entrées mises en file d'attente doivent être relues via `session.prompt(...)` (pour les commandes slash connues) ou via les méthodes brutes steer/follow-up.

## 9) Gestion des erreurs et surfaces d'échec

- Les échecs de chargement des fournisseurs sont isolés ; le registre collecte les avertissements et continue avec les autres fournisseurs.
- Les éléments de commandes slash invalides (nom/chemin/contenu manquant ou niveau invalide) sont supprimés par la validation de capacité.
- Échecs d'analyse du frontmatter :
  - commandes natives : l'erreur d'analyse fatale remonte
  - commandes non natives : avertissement + analyse de repli clé/valeur
- Les exceptions des gestionnaires de commandes extension/personnalisées sont capturées et signalées via le canal d'erreurs d'extension (ou le repli logger pour les commandes personnalisées sans runner d'extension), et traitées comme gérées (pas d'exécution de repli involontaire).
