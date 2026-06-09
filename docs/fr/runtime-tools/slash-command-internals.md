---
title: Fonctionnement interne des commandes slash
description: >-
  Fonctionnement interne du système de commandes slash avec l'enregistrement,
  l'analyse des arguments et le dispatch d'exécution.
sidebar:
  order: 5
  label: Commandes slash
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# Fonctionnement interne des commandes slash

Ce document décrit comment les commandes slash sont découvertes, dédupliquées, exposées en mode interactif et développées au moment du prompt dans `coding-agent`.

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

Le registre de capacités charge tous les fournisseurs enregistrés, triés par priorité de fournisseur décroissante, et déduplique par clé avec une sémantique **le premier l'emporte**.

### Précédence des fournisseurs

Fournisseurs actuels de commandes slash et leurs priorités :

1. `native` (OMP) — priorité `100`
2. `claude` — priorité `80`
3. `claude-plugins` — priorité `70`
4. `codex` — priorité `70`

Comportement en cas d'égalité : les fournisseurs de priorité égale conservent l'ordre d'enregistrement. L'ordre d'import actuel enregistre `claude-plugins` avant `codex`, donc les commandes de plugins l'emportent sur les commandes codex en cas de collision de noms.

### Comportement en cas de collision de noms

Pour `slash-commands`, les collisions sont résolues strictement par la déduplication de capacité :

- l'élément de plus haute précédence est conservé dans `result.items`
- les doublons de moindre précédence restent uniquement dans `result.all` et sont marqués `_shadowed = true`

Cela s'applique entre fournisseurs et également au sein d'un fournisseur s'il retourne des noms en double.

### Comportement de l'analyse de fichiers

Les fournisseurs utilisent principalement `loadFilesFromDir(...)`, qui actuellement :

- utilise par défaut une correspondance non récursive (`*.md`)
- utilise le glob natif avec `gitignore: true`, `hidden: false`
- lit chaque fichier correspondant et le transforme en `SlashCommand`

Les fichiers/répertoires cachés ne sont donc pas chargés, et les chemins ignorés sont sautés.

## 2) Chemins sources spécifiques aux fournisseurs et précédence locale

## Fournisseur `native` (`builtin.ts`)

Les racines de recherche proviennent des répertoires `.xcsh` :

- projet : `<cwd>/.xcsh/commands/*.md`
- utilisateur : `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` retourne le projet en premier, puis l'utilisateur, donc **les commandes natives du projet l'emportent sur les commandes natives de l'utilisateur** en cas de collision de noms.

## Fournisseur `claude` (`claude.ts`)

Charge :

- utilisateur : `~/.claude/commands/*.md`
- projet : `<cwd>/.claude/commands/*.md`

Le fournisseur ajoute les éléments utilisateur avant les éléments projet, donc **les commandes Claude utilisateur l'emportent sur les commandes Claude projet** en cas de collision de noms au sein de ce fournisseur.

## Fournisseur `codex` (`codex.ts`)

Charge :

- utilisateur : `~/.codex/commands/*.md`
- projet : `<cwd>/.codex/commands/*.md`

Les deux côtés sont chargés puis aplatis dans l'ordre utilisateur en premier, donc **les commandes Codex utilisateur l'emportent sur les commandes Codex projet** en cas de collision.

Le contenu des commandes Codex est analysé avec suppression du frontmatter (`parseFrontmatter`), et le nom de la commande peut être remplacé par le `name` du frontmatter ; sinon le nom de fichier est utilisé.

## Fournisseur `claude-plugins` (`claude-plugins.ts`)

Charge les racines de commandes de plugins depuis `~/.claude/plugins/installed_plugins.json`, puis analyse `<pluginRoot>/commands/*.md`.

L'ordre suit l'ordre d'itération du registre et l'ordre par entrée de plugin à partir de ces données JSON. Il n'y a pas d'étape de tri supplémentaire.

## 3) Matérialisation en `FileSlashCommand` à l'exécution

`loadSlashCommands()` dans `src/extensibility/slash-commands.ts` convertit les éléments de capacité en objets `FileSlashCommand` utilisés au moment du prompt.

Pour chaque commande :

1. analyse du frontmatter/corps (`parseFrontmatter`)
2. source de la description :
   - `frontmatter.description` si présent
   - sinon la première ligne non vide du corps (nettoyée, max 60 caractères avec `...`)
3. conservation du corps analysé comme contenu de template exécutable
4. calcul d'une chaîne de source d'affichage comme `via Claude Code Project`

La sévérité de l'analyse du frontmatter dépend de la source :

- niveau `native` -> les erreurs d'analyse sont `fatal`
- niveaux `user`/`project` -> les erreurs d'analyse sont `warn` avec analyse de secours

### Commandes de secours intégrées

Après les commandes de fournisseurs/système de fichiers, les templates de commandes embarqués sont ajoutés (`EMBEDDED_COMMAND_TEMPLATES`) si leurs noms ne sont pas déjà présents.

L'ensemble embarqué actuel provient de `src/task/commands.ts` et est utilisé comme secours (`source: "bundled"`).

## 4) Mode interactif : d'où viennent les listes de commandes

Le mode interactif combine plusieurs sources de commandes pour l'autocomplétion et le routage des commandes.

Au moment de la construction, il crée une liste de commandes en attente à partir de :

- commandes intégrées (`BUILTIN_SLASH_COMMANDS`, incluant la complétion d'arguments et les indications en ligne pour certaines commandes sélectionnées)
- commandes slash enregistrées par les extensions (`extensionRunner.getRegisteredCommands(...)`)
- commandes personnalisées TypeScript (`session.customCommands`), mappées vers des labels de commandes slash
- commandes de compétences optionnelles (`/skill:<name>`) quand `skills.enableSkillCommands` est activé

Ensuite `init()` appelle `refreshSlashCommandState(...)` pour charger les commandes basées sur les fichiers et installer un `CombinedAutocompleteProvider` contenant :

- les commandes en attente ci-dessus
- les commandes découvertes basées sur les fichiers

`refreshSlashCommandState(...)` met également à jour `session.setSlashCommands(...)` pour que l'expansion du prompt utilise le même ensemble de commandes de fichiers découvertes.

### Cycle de vie du rafraîchissement

L'état des commandes slash est rafraîchi :

- pendant l'initialisation interactive
- après que `/move` change le répertoire de travail (`handleMoveCommand` appelle `resetCapabilities()` puis `refreshSlashCommandState(newCwd)`)

Il n'y a pas de surveillance continue des fichiers pour les répertoires de commandes.

### Autre exposition

Le tableau de bord des Extensions charge également la capacité `slash-commands` et affiche les entrées de commandes actives/masquées, y compris les doublons `_shadowed`.

## 5) Placement dans le pipeline de prompt

Ordre de traitement des commandes slash dans `AgentSession.prompt(...)` (quand `expandPromptTemplates !== false`) :

1. **Commandes d'extension** (`#tryExecuteExtensionCommand`)  
   Si `/name` correspond à une commande enregistrée par une extension, le gestionnaire s'exécute immédiatement et le prompt retourne.
2. **Commandes personnalisées TypeScript** (`#tryExecuteCustomCommand`)  
   Limite uniquement : si correspondance, elle s'exécute et peut retourner :
   - `string` -> remplace le texte du prompt par cette chaîne
   - `void/undefined` -> traité comme géré ; pas de prompt LLM
3. **Commandes slash basées sur les fichiers** (`expandSlashCommand`)  
   Si le texte commence toujours par `/`, tentative d'expansion de commande markdown.
4. **Templates de prompt** (`expandPromptTemplate`)  
   Appliqués après le traitement slash/personnalisé.
5. **Envoi**
   - inactif : le prompt est envoyé immédiatement à l'agent
   - en streaming : le prompt est mis en file d'attente comme steer/follow-up selon `streamingBehavior`

C'est pourquoi l'expansion des commandes slash se situe avant l'expansion des templates de prompt, et pourquoi les commandes personnalisées peuvent transformer le slash initial avant la correspondance des commandes de fichiers.

## 6) Sémantique d'expansion pour les commandes slash basées sur les fichiers

Comportement de `expandSlashCommand(text, fileCommands)` :

- s'exécute uniquement quand le texte commence par `/`
- analyse le nom de la commande à partir du premier token après `/`
- analyse les arguments du texte restant via `parseCommandArgs`
- trouve une correspondance exacte de nom dans les `fileCommands` chargées
- si correspondance, applique :
  - remplacement positionnel : `$1`, `$2`, ...
  - remplacement agrégé : `$ARGUMENTS` et `$@`
  - puis rendu du template via `prompt.render` avec `{ args, ARGUMENTS, arguments }`
- si pas de correspondance, retourne le texte original inchangé

### Particularités de `parseCommandArgs`

L'analyseur est un découpage simple tenant compte des guillemets :

- supporte les guillemets `'simples'` et `"doubles"` pour conserver les espaces
- supprime les délimiteurs de guillemets
- n'implémente pas les règles d'échappement par antislash
- un guillemet non fermé n'est pas une erreur ; l'analyseur consomme jusqu'à la fin

## 7) Comportement des `/...` inconnus

Les entrées slash inconnues ne sont **pas rejetées** par la logique slash principale.

Si la commande n'est pas gérée par les couches extension/personnalisée/fichier, `expandSlashCommand` retourne le texte original, et le prompt littéral `/...` passe par l'expansion normale des templates de prompt et l'envoi au LLM.

Le mode interactif gère séparément en dur de nombreuses commandes intégrées dans `InputController` (par exemple `/settings`, `/model`, `/mcp`, `/move`, `/exit`). Celles-ci sont consommées avant `session.prompt(...)` et n'atteignent donc jamais l'expansion des commandes de fichiers dans ce chemin.

## 8) Différences en streaming vs inactif

## Chemin inactif

- `session.prompt("/x ...")` exécute le pipeline de commandes et soit exécute la commande immédiatement, soit envoie le texte développé directement.

## Chemin en streaming (`session.isStreaming === true`)

- `prompt(...)` exécute toujours les transformations extension/personnalisée/fichier/template en premier
- puis nécessite `streamingBehavior` :
  - `"steer"` -> met en file d'attente un message d'interruption (`agent.steer`)
  - `"followUp"` -> met en file d'attente un message post-tour (`agent.followUp`)
- si `streamingBehavior` est omis, le prompt lève une erreur

### Comportement important en streaming spécifique aux commandes

- Les commandes d'extension sont exécutées immédiatement même pendant le streaming (pas mises en file d'attente comme texte).
- Les méthodes d'aide `steer(...)`/`followUp(...)` rejettent les commandes d'extension (`#throwIfExtensionCommand`) pour éviter de mettre en file d'attente du texte de commande pour des gestionnaires qui doivent s'exécuter de manière synchrone.
- Le rejeu de la file d'attente de compaction utilise `isKnownSlashCommand(...)` pour décider si les entrées en file d'attente doivent être rejouées via `session.prompt(...)` (pour les commandes slash connues) ou via les méthodes brutes steer/follow-up.

## 9) Gestion des erreurs et surfaces de défaillance

- Les échecs de chargement des fournisseurs sont isolés ; le registre collecte les avertissements et continue avec les autres fournisseurs.
- Les éléments de commande slash invalides (nom/chemin/contenu manquant ou niveau invalide) sont rejetés par la validation de capacité.
- Échecs d'analyse du frontmatter :
  - commandes natives : l'erreur d'analyse fatale remonte
  - commandes non natives : avertissement + analyse clé/valeur de secours
- Les exceptions des gestionnaires de commandes d'extension/personnalisées sont capturées et signalées via le canal d'erreur d'extension (ou le logger en secours pour les commandes personnalisées sans exécuteur d'extension), et traitées comme gérées (pas d'exécution de secours non intentionnelle).
