---
title: Gestion des plugins et mécanique d'installation
description: >-
  Fonctionnement interne du gestionnaire de plugins couvrant l'installation, la
  validation, la résolution des dépendances et la gestion du cycle de vie.
sidebar:
  order: 5
  label: Gestionnaire de plugins
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# Gestion des plugins et mécanique d'installation

Ce document décrit comment les opérations `xcsh plugin` modifient l'état des plugins sur le disque et comment les plugins installés deviennent des capacités d'exécution (des outils aujourd'hui, avec une résolution de chemin pour les hooks/commandes disponible).

## Périmètre et architecture

Il existe deux implémentations de gestion des plugins dans le code source :

1. **Chemin actif utilisé par les commandes CLI** : `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **Module d'aide hérité** : fonctions d'installation (`src/extensibility/plugins/installer.ts`)

L'exécution des commandes `xcsh plugin ...` passe par `PluginManager`.

`installer.ts` documente toujours des vérifications de sécurité importantes et des comportements liés au système de fichiers, mais ce n'est pas le chemin utilisé par `src/commands/plugin.ts` + `src/cli/plugin-cli.ts`.

## Cycle de vie : de l'invocation CLI à la disponibilité en exécution

```text
xcsh plugin <action> ...
  -> src/commands/plugin.ts
  -> runPluginCommand(...) in src/cli/plugin-cli.ts
  -> PluginManager method (install/list/uninstall/link/...) 
  -> mutate ~/.xcsh/plugins/{package.json,node_modules,xcsh-plugins.lock.json}
  -> runtime discovery: discoverAndLoadCustomTools(...)
  -> getAllPluginToolPaths(cwd)
  -> custom tool loader imports tool modules
```

### Points d'entrée des commandes

- `src/commands/plugin.ts` définit les commandes/indicateurs et les transmet à `runPluginCommand`.
- `src/cli/plugin-cli.ts` mappe les sous-commandes aux méthodes de `PluginManager` :
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- Aucune action `update` explicite n'existe ; la mise à jour s'effectue en réexécutant `install` avec une nouvelle spécification de paquet/version.

## Modèle sur disque

L'état global des plugins réside dans `~/.xcsh/plugins` :

- `package.json` — manifeste des dépendances utilisé par `bun install`/`bun uninstall`
- `node_modules/` — paquets de plugins installés ou liens symboliques
- `xcsh-plugins.lock.json` — état d'exécution :
  - activé/désactivé par plugin
  - ensemble de fonctionnalités sélectionné par plugin
  - paramètres de plugin persistés

Les remplacements locaux au projet résident dans :

- `<cwd>/.xcsh/plugin-overrides.json`

Les remplacements sont en lecture seule du point de vue du gestionnaire/chargeur (aucun chemin d'écriture ici) et peuvent désactiver des plugins ou remplacer des fonctionnalités/paramètres pour ce projet.

## Analyse des spécifications de plugin et interprétation des métadonnées

## Grammaire des spécifications d'installation

`parsePluginSpec` (`parser.ts`) prend en charge :

- `pkg` -> `features: null` (comportement par défaut)
- `pkg[*]` -> activer toutes les fonctionnalités du manifeste
- `pkg[]` -> n'activer aucune fonctionnalité optionnelle
- `pkg[a,b]` -> activer les fonctionnalités nommées
- `@scope/pkg@1.2.3[feat]` -> paquet scopé + versionné avec sélection explicite de fonctionnalités

`extractPackageName` supprime le suffixe de version pour la recherche de chemin sur disque après l'installation.

## Source du manifeste et champs requis

Le manifeste est résolu comme suit :

1. `package.json.xcsh`
2. repli sur `package.json.pi`
3. repli sur `{ version: package.version }`

Implications :

- Il n'existe pas de validation de schéma stricte dans le gestionnaire/chargeur.
- Un paquet sans manifeste `xcsh`/`pi` est toujours installable et listable.
- Le chargement des plugins à l'exécution (`getEnabledPlugins`) ignore les paquets sans manifeste `xcsh`/`pi`.
- `manifest.version` est toujours écrasé par la `version` du paquet.

Un JSON `package.json` malformé constitue un échec immédiat lors de la lecture ; une forme de manifeste malformée peut échouer plus tard uniquement lorsque des champs spécifiques sont consommés.

## Flux d'installation/mise à jour (`PluginManager.install`)

1. Analyser la syntaxe des crochets de fonctionnalités à partir de la spécification d'installation.
2. Valider le nom du paquet par rapport à une expression régulière + liste de refus des métacaractères shell.
3. S'assurer que le `package.json` du plugin existe (mappage `xcsh-plugins`, dépendances privées).
4. Exécuter `bun install <packageSpec>` dans `~/.xcsh/plugins`.
5. Lire le `package.json` du paquet installé dans `node_modules/<name>/package.json`.
6. Résoudre le manifeste et calculer `enabledFeatures` :
   - `[*]` : toutes les fonctionnalités déclarées (ou `null` si aucune carte de fonctionnalités)
   - `[a,b]` : valide que chaque fonctionnalité existe dans la carte de fonctionnalités du manifeste
   - `[]` : liste de fonctionnalités vide
   - spécification simple : `null` (utiliser la politique de valeurs par défaut ultérieurement dans le chargeur)
7. Mettre à jour l'état d'exécution dans le fichier de verrouillage : `{ version, enabledFeatures, enabled: true }`.

### Sémantique de mise à jour

Étant donné que la mise à jour est pilotée par l'installation :

- `xcsh plugin install pkg@newVersion` met à jour la dépendance et la version dans le fichier de verrouillage.
- Les paramètres existants sont préservés ; l'entrée d'état est écrasée pour la version, les fonctionnalités et l'activation.
- Aucune logique de « vérification des mises à jour » ou de migration transactionnelle n'existe.

## Flux de suppression (`PluginManager.uninstall`)

1. Valider le nom du paquet.
2. Exécuter `bun uninstall <name>` dans le répertoire des plugins.
3. Supprimer l'état d'exécution du plugin du fichier de verrouillage :
   - `config.plugins[name]`
   - `config.settings[name]`

Si la commande de désinstallation échoue, l'état d'exécution n'est pas modifié.

## Flux de listage (`PluginManager.list`)

1. Lire la carte des dépendances des plugins depuis `~/.xcsh/plugins/package.json`.
2. Charger la configuration d'exécution du fichier de verrouillage (fichier manquant -> valeurs par défaut vides).
3. Charger les remplacements du projet (`<cwd>/.xcsh/plugin-overrides.json`, erreurs d'analyse/lecture -> objet vide avec avertissement).
4. Pour chaque dépendance avec un `package.json` résolvable :
   - construire un enregistrement `InstalledPlugin`
   - fusionner l'état des fonctionnalités/activation :
     - base depuis le fichier de verrouillage (ou valeurs par défaut)
     - les remplacements du projet peuvent remplacer la sélection des fonctionnalités
     - la liste `disabled` du projet masque le plugin comme désactivé

Il s'agit de l'état effectif utilisé par la sortie de statut de la CLI et les opérations de paramètres/fonctionnalités.

## Flux de liaison (`PluginManager.link`)

`link` prend en charge le développement local de plugins en créant un lien symbolique d'un paquet local dans `~/.xcsh/plugins/node_modules/<pkg.name>`.

Comportement :

1. Résoudre `localPath` par rapport au répertoire de travail du gestionnaire.
2. Exiger un `package.json` local et un champ `name`.
3. S'assurer que les répertoires des plugins existent.
4. Pour les noms scopés, créer le répertoire de portée.
5. Supprimer le chemin existant à l'emplacement du lien cible.
6. Créer le lien symbolique.
7. Ajouter une entrée dans le fichier de verrouillage d'exécution avec les fonctionnalités par défaut activées (`null`).

Mise en garde : l'implémentation actuelle de `PluginManager.link` n'applique pas la vérification de limite de chemin `cwd` présente dans le fichier `installer.ts` hérité (`normalizedPath.startsWith(normalizedCwd)`), la confiance relève donc de la responsabilité de l'appelant.

## Chargement à l'exécution : du plugin installé aux capacités appelables

## Porte de découverte

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) lit :

- le manifeste des dépendances des plugins (`package.json`)
- l'état d'exécution du fichier de verrouillage
- les remplacements du projet via `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

Filtrage :

- ignorer si aucun `package.json` de plugin
- ignorer si le manifeste (`xcsh`/`pi`) est absent
- ignorer si désactivé globalement dans le fichier de verrouillage
- ignorer si désactivé par le projet

## Résolution des chemins de capacités

Pour chaque plugin activé :

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

Chaque résolveur inclut des entrées de base plus des entrées de fonctionnalités :

- liste de fonctionnalités explicite -> uniquement les fonctionnalités sélectionnées
- `enabledFeatures === null` -> activer les fonctionnalités marquées `default: true`

Les fichiers manquants sont silencieusement ignorés (garde `existsSync`).

## Différences actuelles de câblage à l'exécution

- **Les outils sont câblés dans l'exécution aujourd'hui** via `discoverAndLoadCustomTools` (`custom-tools/loader.ts`), qui appelle `getAllPluginToolPaths(cwd)`.
- Les chemins sont dédupliqués par chemin absolu résolu dans la découverte d'outils personnalisés (ensemble `seen`, le premier chemin l'emporte).
- **Les résolveurs de hooks/commandes existent** et sont exportés, mais ce chemin de code ne les câble pas actuellement dans un registre d'exécution de la même façon que les outils sont câblés.

## Détails de gestion du verrou/état

`PluginManager` met en cache la configuration d'exécution en mémoire par instance (`#runtimeConfig`) et la charge paresseusement une seule fois.

Comportement de chargement :

- fichier de verrouillage manquant -> `{ plugins: {}, settings: {} }`
- échec de lecture/analyse du fichier de verrouillage -> avertissement + mêmes valeurs par défaut vides

Comportement de sauvegarde :

- écrit le JSON complet du fichier de verrouillage avec indentation à chaque mutation

Aucun verrouillage inter-processus ni stratégie de fusion n'existe ; des écrivains concurrents peuvent s'écraser mutuellement.

## Vérifications de sécurité et limites de confiance

## Validation des entrées/paquets

Le chemin du gestionnaire actif applique la validation du nom de paquet :

- expression régulière pour les spécifications de paquets scopés/non-scopés (optionnellement avec version)
- liste de refus explicite des métacaractères shell (`[;&|`$(){}[]<>\\]`)

Cela limite le risque d'injection de commandes lors de l'invocation de `bun install/uninstall`.

## Limite de confiance du système de fichiers

- Le code des plugins s'exécute en cours de processus lorsque les modules d'outils personnalisés sont importés ; aucun bac à sable.
- Les chemins relatifs du manifeste sont joints au répertoire du paquet du plugin et uniquement vérifiés quant à leur existence.
- Le paquet du plugin lui-même est du code de confiance une fois installé.

## Vérifications exclusives au programme d'installation hérité

`installer.ts` inclut des vérifications supplémentaires au moment de la liaison non reflétées dans `PluginManager.link` :

- le chemin local doit se résoudre à l'intérieur du répertoire de travail du projet
- des gardes supplémentaires sur le nom de paquet/traversée de chemin pour la dénomination de la cible du lien symbolique

Étant donné que la CLI utilise `PluginManager`, ces gardes de liaison plus strictes ne se trouvent pas actuellement sur le chemin principal.

## Comportement en cas d'échec, de succès partiel et de restauration

Le gestionnaire de plugins n'est pas transactionnel.

| Étape de l'opération | Comportement en cas d'échec | Restauration |
| --- | --- | --- |
| `bun install` échoue | l'installation s'arrête avec stderr | N/A (aucune écriture d'état encore) |
| L'installation réussit, puis la validation du manifeste/des fonctionnalités échoue | la commande échoue | Aucune restauration par désinstallation ; la dépendance peut rester dans `node_modules`/`package.json` |
| L'installation réussit, puis l'écriture du fichier de verrouillage échoue | la commande échoue | Aucune restauration du paquet installé |
| `bun uninstall` réussit, l'écriture du fichier de verrouillage échoue | la commande échoue | Le paquet est supprimé, un état d'exécution obsolète peut subsister |
| `link` supprime l'ancienne cible, puis la création du lien symbolique échoue | la commande échoue | Aucune restauration du lien/répertoire précédent |

En pratique, `doctor --fix` peut corriger certaines dérives (`bun install`, nettoyage de configuration orpheline, nettoyage de fonctionnalités invalides), mais il s'agit d'une opération au mieux.

## Résumé du comportement en cas de manifeste malformé/manquant

- Champ `xcsh`/`pi` manquant :
  - installation/listage : toléré (manifeste minimal)
  - découverte des plugins activés à l'exécution : ignoré en tant que non-plugin
- Fonctionnalité manquante référencée par la spécification d'installation ou `features --set/--enable` : erreur grave avec liste des fonctionnalités disponibles
- `plugin-overrides.json` invalide : ignoré avec repli sur `{}` dans les chemins du gestionnaire et du chargeur
- Chemins de fichiers d'outils/hooks/commandes manquants référencés par le manifeste : ignorés silencieusement lors de l'expansion du résolveur ; signalés comme erreurs uniquement par `doctor`

## Différences de mode et précédence

- `--dry-run` (installation) : renvoie un résultat d'installation synthétique, aucune écriture sur le système de fichiers/réseau/état.
- `--json` : formatage de la sortie uniquement, aucun changement de comportement.
- Les remplacements du projet prennent toujours la précédence sur le fichier de verrouillage global pour la vue des fonctionnalités/paramètres.
- L'activation effective est `runtimeEnabled && !projectDisabled`.

## Fichiers d'implémentation

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — déclaration des commandes CLI et mappage des indicateurs
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — dispatch des actions, gestionnaires de commandes côté utilisateur
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — implémentation active de l'installation/suppression/listage/liaison/état/doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — aides d'installation héritées et vérifications de sécurité supplémentaires pour la liaison
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — découverte des plugins activés et résolution des chemins d'outils/hooks/commandes
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — aides d'analyse des spécifications d'installation et des noms de paquets
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — contrats de types pour les manifestes/l'exécution/les remplacements
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — câblage à l'exécution pour les modules d'outils fournis par les plugins
