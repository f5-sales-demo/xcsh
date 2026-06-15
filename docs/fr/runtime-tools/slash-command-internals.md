---
title: Fonctionnement interne des commandes slash
description: >-
  Fonctionnement interne du système de commandes slash avec l'enregistrement,
  l'analyse des arguments et la répartition de l'exécution.
sidebar:
  order: 5
  label: Commandes slash
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# Fonctionnement interne des commandes slash

Ce document décrit comment les commandes slash sont découvertes, dédupliquées, présentées en mode interactif, et développées au moment de l'invite dans `coding-agent`.

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

Les commandes slash constituent une capacité (`id: "slash-commands"`) indexée par nom de commande (`key: cmd => cmd.name`).

Le registre des capacités charge tous les fournisseurs enregistrés, triés par priorité décroissante, et déduplique par clé selon la sémantique **premier arrivé, premier servi**.

### Ordre de priorité des fournisseurs

Fournisseurs de commandes slash actuels et leurs priorités :

1. `native` (OMP) — priorité `100`
2. `claude` — priorité `80`
3. `claude-plugins` — priorité `70`
4. `codex` — priorité `70`

Comportement en cas d'égalité : les fournisseurs de même priorité conservent l'ordre d'enregistrement. L'ordre d'importation actuel enregistre `claude-plugins` avant `codex`, ainsi les commandes de plugin l'emportent sur les commandes codex en cas de collision de noms.

### Comportement en cas de collision de noms

Pour `slash-commands`, les collisions sont résolues strictement par déduplication de capacité :

- l'élément de plus haute priorité est conservé dans `result.items`
- les doublons de priorité inférieure ne figurent que dans `result.all` et sont marqués `_shadowed = true`

Cela s'applique entre les fournisseurs, mais aussi au sein d'un même fournisseur s'il retourne des noms en double.

### Comportement d'analyse des fichiers

Les fournisseurs utilisent majoritairement `loadFilesFromDir(...)`, qui actuellement :

- utilise par défaut une correspondance non récursive (`*.md`)
- emploie le glob natif avec `gitignore: true`, `hidden: false`
- lit chaque fichier correspondant et le transforme en `SlashCommand`

Ainsi, les fichiers et répertoires cachés ne sont pas chargés, et les chemins ignorés sont exclus.

## 2) Chemins source spécifiques aux fournisseurs et priorité locale

## Fournisseur `native` (`builtin.ts`)

Les racines de recherche proviennent des répertoires `.xcsh` :

- projet : `<cwd>/.xcsh/commands/*.md`
- utilisateur : `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` retourne d'abord le projet, puis l'utilisateur ; ainsi **les commandes natives du projet l'emportent sur les commandes natives de l'utilisateur** en cas de collision de noms.

## Fournisseur `claude` (`claude.ts`)

Charge :

- utilisateur : `~/.claude/commands/*.md`
- projet : `<cwd>/.claude/commands/*.md`

Le fournisseur place les éléments utilisateur avant les éléments projet, de sorte que **les commandes Claude de l'utilisateur l'emportent sur les commandes Claude du projet** en cas de collision de noms dans ce fournisseur.

## Fournisseur `codex` (`codex.ts`)

Charge :

- utilisateur : `~/.codex/commands/*.md`
- projet : `<cwd>/.codex/commands/*.md`

Les deux côtés sont chargés puis aplatis dans l'ordre utilisateur en premier, ainsi **les commandes Codex de l'utilisateur l'emportent sur les commandes Codex du projet** en cas de collision.

Le contenu des commandes Codex est analysé avec suppression du frontmatter (`parseFrontmatter`), et le nom de la commande peut être remplacé par le frontmatter `name` ; sinon le nom du fichier est utilisé.

## Fournisseur `claude-plugins` (`claude-plugins.ts`)

Charge les racines de commandes des plugins depuis `~/.claude/plugins/installed_plugins.json`, puis analyse `<pluginRoot>/commands/*.md`.

L'ordonnancement suit l'ordre d'itération du registre et l'ordre des entrées par plugin dans ces données JSON. Il n'y a pas d'étape de tri supplémentaire.

## 3) Matérialisation vers le `FileSlashCommand` d'exécution

`loadSlashCommands()` dans `src/extensibility/slash-commands.ts` convertit les éléments de capacité en objets `FileSlashCommand` utilisés au moment de l'invite.

Pour chaque commande :

1. analyser le frontmatter et le corps (`parseFrontmatter`)
2. source de la description :
   - `frontmatter.description` si présent
   - sinon la première ligne de corps non vide (rognée, 60 caractères max avec `...`)
3. conserver le corps analysé comme contenu de gabarit exécutable
4. calculer une chaîne d'affichage de la source, par exemple `via Claude Code Project`

La sévérité de l'analyse du frontmatter dépend de la source :

- niveau `native` -> les erreurs d'analyse sont `fatal`
- niveaux `user`/`project` -> les erreurs d'analyse sont `warn` avec analyse de secours

### Commandes de repli intégrées

Après les commandes provenant du système de fichiers et des fournisseurs, des gabarits de commandes intégrés sont ajoutés (`EMBEDDED_COMMAND_TEMPLATES`) si leurs noms ne sont pas déjà présents.

L'ensemble intégré actuel provient de `src/task/commands.ts` et est utilisé comme repli (`source: "bundled"`).

## 4) Mode interactif : origine des listes de commandes

Le mode interactif combine plusieurs sources de commandes pour la complétion automatique et le routage des commandes.

À la construction, il constitue une liste de commandes en attente à partir de :

- les commandes intégrées (`BUILTIN_SLASH_COMMANDS`, incluant la complétion des arguments et les indications en ligne pour certaines commandes)
- les commandes slash enregistrées par les extensions (`extensionRunner.getRegisteredCommands(...)`)
- les commandes personnalisées TypeScript (`session.customCommands`), mappées vers des libellés de commandes slash
- les commandes de compétences optionnelles (`/skill:<name>`) lorsque `skills.enableSkillCommands` est activé

Puis `init()` appelle `refreshSlashCommandState(...)` pour charger les commandes basées sur des fichiers et installer un `CombinedAutocompleteProvider` contenant :

- les commandes en attente mentionnées ci-dessus
- les commandes basées sur des fichiers découvertes

`refreshSlashCommandState(...)` met également à jour `session.setSlashCommands(...)` afin que l'expansion des invites utilise le même ensemble de commandes de fichiers découvertes.

### Cycle de vie du rafraîchissement

L'état des commandes slash est rafraîchi :

- lors de l'initialisation interactive
- après qu'une commande `/move` change le répertoire de travail (`handleMoveCommand` appelle `resetCapabilities()` puis `refreshSlashCommandState(newCwd)`)

Il n'y a pas de surveillance continue des répertoires de commandes par observateur de fichiers.

### Autres points d'exposition

Le tableau de bord des extensions charge également la capacité `slash-commands` et affiche les entrées de commandes actives et occultées, y compris les doublons `_shadowed`.

## 5) Placement dans le pipeline d'invites

Ordre de traitement des commandes slash par `AgentSession.prompt(...)` (lorsque `expandPromptTemplates !== false`) :

1. **Commandes d'extension** (`#tryExecuteExtensionCommand`)  
   Si `/name` correspond à une commande enregistrée par une extension, le gestionnaire s'exécute immédiatement et l'invite retourne.
2. **Commandes personnalisées TypeScript** (`#tryExecuteCustomCommand`)  
   Frontière uniquement : si une correspondance est trouvée, elle s'exécute et peut retourner :
   - `string` -> remplace le texte de l'invite par cette chaîne
   - `void/undefined` -> traité comme géré ; aucune invite LLM
3. **Commandes slash basées sur des fichiers** (`expandSlashCommand`)  
   Si le texte commence toujours par `/`, tentative d'expansion de la commande markdown.
4. **Gabarits d'invite** (`expandPromptTemplate`)  
   Appliqués après le traitement slash/personnalisé.
5. **Livraison**
   - inactif : l'invite est envoyée immédiatement à l'agent
   - en streaming : l'invite est mise en file d'attente comme steer/follow-up selon `streamingBehavior`

C'est pourquoi l'expansion des commandes slash se situe avant l'expansion des gabarits d'invite, et pourquoi les commandes personnalisées peuvent transformer le slash initial avant la correspondance avec les commandes de fichiers.

## 6) Sémantique d'expansion pour les commandes slash basées sur des fichiers

Comportement de `expandSlashCommand(text, fileCommands)` :

- ne s'exécute que lorsque le texte commence par `/`
- extrait le nom de la commande du premier jeton après `/`
- extrait les arguments du reste du texte via `parseCommandArgs`
- recherche une correspondance exacte de nom dans les `fileCommands` chargées
- en cas de correspondance, applique :
  - remplacement positionnel : `$1`, `$2`, ...
  - remplacement agrégé : `$ARGUMENTS` et `$@`
  - puis rendu du gabarit via `prompt.render` avec `{ args, ARGUMENTS, arguments }`
- en l'absence de correspondance, retourne le texte original inchangé

### Mises en garde concernant `parseCommandArgs`

L'analyseur est un découpage simple tenant compte des guillemets :

- prend en charge les guillemets `'simples'` et `"doubles"` pour conserver les espaces
- supprime les délimiteurs de guillemets
- n'implémente pas les règles d'échappement par barre oblique inverse
- un guillemet non fermé n'est pas une erreur ; l'analyseur consomme jusqu'à la fin

## 7) Comportement pour les entrées `/...` inconnues

Les entrées slash inconnues **ne sont pas rejetées** par la logique slash centrale.

Si la commande n'est pas gérée par les couches extension/personnalisée/fichier, `expandSlashCommand` retourne le texte original, et l'invite littérale `/...` poursuit normalement l'expansion du gabarit et la livraison au LLM.

Le mode interactif gère séparément de nombreuses commandes intégrées dans `InputController` (par exemple `/settings`, `/model`, `/mcp`, `/move`, `/exit`). Celles-ci sont consommées avant `session.prompt(...)` et n'atteignent donc jamais l'expansion des commandes de fichiers dans ce chemin.

## 8) Différences en mode streaming par rapport au mode inactif

## Chemin inactif

- `session.prompt("/x ...")` exécute le pipeline de commandes et soit exécute la commande immédiatement, soit envoie le texte développé directement.

## Chemin streaming (`session.isStreaming === true`)

- `prompt(...)` exécute quand même les transformations extension/personnalisée/fichier/gabarit en premier
- puis requiert `streamingBehavior` :
  - `"steer"` -> met en file d'attente un message d'interruption (`agent.steer`)
  - `"followUp"` -> met en file d'attente un message post-tour (`agent.followUp`)
- si `streamingBehavior` est omis, l'invite lève une erreur

### Comportement de streaming spécifique aux commandes

- Les commandes d'extension sont exécutées immédiatement, même pendant le streaming (non mises en file d'attente sous forme de texte).
- Les méthodes d'aide `steer(...)`/`followUp(...)` rejettent les commandes d'extension (`#throwIfExtensionCommand`) pour éviter de mettre en file d'attente le texte de commande pour des gestionnaires devant s'exécuter de manière synchrone.
- La relecture de la file d'attente de compaction utilise `isKnownSlashCommand(...)` pour décider si les entrées mises en file d'attente doivent être relues via `session.prompt(...)` (pour les commandes slash connues) ou via les méthodes brutes steer/follow-up.

## 9) Gestion des erreurs et surfaces d'échec

- Les échecs de chargement des fournisseurs sont isolés ; le registre collecte les avertissements et continue avec les autres fournisseurs.
- Les éléments de commandes slash invalides (nom, chemin ou contenu manquant, ou niveau invalide) sont rejetés par la validation des capacités.
- Échecs d'analyse du frontmatter :
  - commandes natives : l'erreur d'analyse fatale remonte
  - commandes non natives : avertissement + analyse de secours clé/valeur
- Les exceptions des gestionnaires de commandes extension/personnalisées sont interceptées et signalées via le canal d'erreur des extensions (ou via le logger de repli pour les commandes personnalisées sans exécuteur d'extension), et traitées comme gérées (aucune exécution de secours non souhaitée).
