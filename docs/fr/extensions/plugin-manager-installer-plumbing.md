---
title: Gestionnaire de plugins et mécanismes d'installation
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

# Gestionnaire de plugins et mécanismes d'installation

Ce document décrit comment les opérations `xcsh plugin` modifient l'état des plugins sur le disque et comment les plugins installés deviennent des capacités à l'exécution (outils aujourd'hui, résolution des chemins pour les hooks/commandes disponible).

## Périmètre et architecture

Il existe deux implémentations de gestion des plugins dans la base de code :

1. **Chemin actif utilisé par les commandes CLI** : `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **Module utilitaire historique** : fonctions d'installation (`src/extensibility/plugins/installer.ts`)

L'exécution des commandes `xcsh plugin ...` passe par `PluginManager`.

`installer.ts` documente encore des vérifications de sécurité et des comportements de système de fichiers importants, mais ce n'est pas le chemin utilisé par `src/commands/plugin.ts` + `src/cli/plugin-cli.ts`.

## Cycle de vie : de l'invocation CLI à la disponibilité à l'exécution

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

- `src/commands/plugin.ts` définit la commande/les options et transmet à `runPluginCommand`.
- `src/cli/plugin-cli.ts` mappe les sous-commandes aux méthodes de `PluginManager` :
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- Aucune action `update` explicite n'existe ; la mise à jour se fait en relançant `install` avec un nouveau paquet/spécification de version.

## Modèle sur disque

L'état global des plugins réside sous `~/.xcsh/plugins` :

- `package.json` — manifeste de dépendances utilisé par `bun install`/`bun uninstall`
- `node_modules/` — paquets de plugins installés ou liens symboliques
- `xcsh-plugins.lock.json` — état à l'exécution :
  - activé/désactivé par plugin
  - ensemble de fonctionnalités sélectionnées par plugin
  - paramètres de plugin persistés

Les surcharges locales au projet résident à :

- `<cwd>/.xcsh/plugin-overrides.json`

Les surcharges sont en lecture seule du point de vue du gestionnaire/chargeur (pas de chemin d'écriture ici) et peuvent désactiver des plugins ou remplacer les fonctionnalités/paramètres pour ce projet.

## Analyse des spécifications de plugin et interprétation des métadonnées

## Grammaire des spécifications d'installation

`parsePluginSpec` (`parser.ts`) prend en charge :

- `pkg` -> `features: null` (comportement par défaut)
- `pkg[*]` -> activer toutes les fonctionnalités du manifeste
- `pkg[]` -> n'activer aucune fonctionnalité optionnelle
- `pkg[a,b]` -> activer les fonctionnalités nommées
- `@scope/pkg@1.2.3[feat]` -> paquet scopé + versionné avec sélection explicite de fonctionnalités

`extractPackageName` supprime le suffixe de version pour la recherche du chemin sur disque après l'installation.

## Source du manifeste et champs requis

Le manifeste est résolu comme suit :

1. `package.json.xcsh`
2. solution de repli `package.json.pi`
3. solution de repli `{ version: package.version }`

Implications :

- Il n'y a pas de validation stricte de schéma dans le gestionnaire/chargeur.
- Un paquet sans `xcsh`/`pi` est toujours installable et listable.
- Le chargement des plugins à l'exécution (`getEnabledPlugins`) ignore les paquets sans manifeste `xcsh`/`pi`.
- `manifest.version` est toujours écrasé par la `version` du paquet.

Un JSON `package.json` malformé est une erreur fatale à la lecture ; une forme de manifeste malformée peut échouer plus tard uniquement lorsque des champs spécifiques sont consommés.

## Flux d'installation/mise à jour (`PluginManager.install`)

1. Analyser la syntaxe entre crochets des fonctionnalités depuis la spécification d'installation.
2. Valider le nom du paquet contre une regex + liste de refus de métacaractères shell.
3. S'assurer que le `package.json` du plugin existe (`xcsh-plugins`, carte de dépendances privées).
4. Exécuter `bun install <packageSpec>` dans `~/.xcsh/plugins`.
5. Lire le `node_modules/<name>/package.json` du paquet installé.
6. Résoudre le manifeste et calculer `enabledFeatures` :
   - `[*]` : toutes les fonctionnalités déclarées (ou `null` si pas de carte de fonctionnalités)
   - `[a,b]` : valide que chaque fonctionnalité existe dans la carte de fonctionnalités du manifeste
   - `[]` : liste de fonctionnalités vide
   - spécification simple : `null` (utiliser la politique par défaut plus tard dans le chargeur)
7. Insérer ou mettre à jour l'état d'exécution dans le fichier de verrouillage : `{ version, enabledFeatures, enabled: true }`.

### Sémantique de mise à jour

Puisque la mise à jour est pilotée par l'installation :

- `xcsh plugin install pkg@newVersion` met à jour la dépendance et la version dans le fichier de verrouillage.
- Les paramètres existants sont préservés ; l'entrée d'état est écrasée pour la version/fonctionnalités/activation.
- Aucune logique séparée de « vérification des mises à jour » ou de migration transactionnelle n'existe.

## Flux de suppression (`PluginManager.uninstall`)

1. Valider le nom du paquet.
2. Exécuter `bun uninstall <name>` dans le répertoire des plugins.
3. Supprimer l'état d'exécution du plugin du fichier de verrouillage :
   - `config.plugins[name]`
   - `config.settings[name]`

Si la commande de désinstallation échoue, l'état d'exécution n'est pas modifié.

## Flux de listage (`PluginManager.list`)

1. Lire la carte des dépendances de plugins depuis `~/.xcsh/plugins/package.json`.
2. Charger la configuration d'exécution du fichier de verrouillage (fichier manquant -> valeurs par défaut vides).
3. Charger les surcharges du projet (`<cwd>/.xcsh/plugin-overrides.json`, erreurs de lecture/analyse -> objet vide avec avertissement).
4. Pour chaque dépendance ayant un package.json résolvable :
   - construire un enregistrement `InstalledPlugin`
   - fusionner l'état des fonctionnalités/activation :
     - base depuis le fichier de verrouillage (ou valeurs par défaut)
     - les surcharges du projet peuvent remplacer la sélection de fonctionnalités
     - la liste `disabled` du projet masque le plugin comme désactivé

C'est l'état effectif utilisé par la sortie de statut CLI et les opérations de paramètres/fonctionnalités.

## Flux de lien (`PluginManager.link`)

`link` prend en charge le développement local de plugins en créant un lien symbolique d'un paquet local vers `~/.xcsh/plugins/node_modules/<pkg.name>`.

Comportement :

1. Résoudre `localPath` par rapport au cwd du gestionnaire.
2. Exiger un `package.json` local et un champ `name`.
3. S'assurer que les répertoires de plugins existent.
4. Pour les noms scopés, créer le répertoire de scope.
5. Supprimer le chemin existant à l'emplacement cible du lien.
6. Créer le lien symbolique.
7. Ajouter une entrée dans le fichier de verrouillage d'exécution activée avec les fonctionnalités par défaut (`null`).

Mise en garde : le `PluginManager.link` actuel n'applique pas la vérification de limite de chemin du `cwd` présente dans l'ancien `installer.ts` (`normalizedPath.startsWith(normalizedCwd)`), donc la confiance est sous la responsabilité de l'appelant.

## Chargement à l'exécution : du plugin installé aux capacités appelables

## Porte de découverte

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) lit :

- le manifeste des dépendances de plugins (`package.json`)
- l'état d'exécution du fichier de verrouillage
- les surcharges du projet via `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

Filtrage :

- ignorer si pas de package.json du plugin
- ignorer si le manifeste (`xcsh`/`pi`) est absent
- ignorer si globalement désactivé dans le fichier de verrouillage
- ignorer si désactivé au niveau du projet

## Résolution des chemins de capacités

Pour chaque plugin activé :

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

Chaque résolveur inclut les entrées de base plus les entrées de fonctionnalités :

- liste de fonctionnalités explicite -> uniquement les fonctionnalités sélectionnées
- `enabledFeatures === null` -> activer les fonctionnalités marquées `default: true`

Les fichiers manquants sont silencieusement ignorés (garde `existsSync`).

## Différences actuelles de câblage à l'exécution

- **Les outils sont câblés dans l'exécution aujourd'hui** via `discoverAndLoadCustomTools` (`custom-tools/loader.ts`), qui appelle `getAllPluginToolPaths(cwd)`.
- Les chemins sont dédupliqués par chemin absolu résolu dans la découverte d'outils personnalisés (ensemble `seen`, le premier chemin l'emporte).
- **Les résolveurs de hooks/commandes existent** et sont exportés, mais ce chemin de code ne les câble pas actuellement dans un registre d'exécution de la même manière que les outils sont câblés.

## Détails de gestion du verrouillage/état

`PluginManager` met en cache la configuration d'exécution en mémoire par instance (`#runtimeConfig`) et charge de manière paresseuse une seule fois.

Comportement de chargement :

- fichier de verrouillage manquant -> `{ plugins: {}, settings: {} }`
- échec de lecture/analyse du fichier de verrouillage -> avertissement + mêmes valeurs par défaut vides

Comportement de sauvegarde :

- écrit le JSON complet du fichier de verrouillage avec indentation à chaque mutation

Aucun verrouillage inter-processus ni stratégie de fusion n'existe ; les écrivains concurrents peuvent s'écraser mutuellement.

## Vérifications de sécurité et limites de confiance

## Validation des entrées/paquets

Le chemin actif du gestionnaire applique la validation du nom de paquet :

- regex pour les spécifications de paquets scopés/non scopés (optionnellement avec version)
- liste de refus explicite de métacaractères shell (`[;&|`$(){}[]<>\\]`)

Cela limite le risque d'injection de commandes lors de l'invocation de `bun install/uninstall`.

## Limite de confiance du système de fichiers

- Le code du plugin s'exécute dans le même processus lorsque les modules d'outils personnalisés sont importés ; aucun bac à sable.
- Les chemins relatifs du manifeste sont joints au répertoire du paquet du plugin et ne font l'objet que d'une vérification d'existence.
- Le paquet du plugin lui-même est du code de confiance une fois installé.

## Vérifications uniquement présentes dans l'installateur historique

`installer.ts` inclut des vérifications supplémentaires au moment du lien non reproduites dans `PluginManager.link` :

- le chemin local doit se résoudre à l'intérieur du cwd du projet
- gardes supplémentaires contre la traversée de nom de paquet/chemin pour le nommage de la cible du lien symbolique

Parce que la CLI utilise `PluginManager`, ces gardes de lien plus strictes ne sont pas actuellement sur le chemin principal.

## Comportement en cas d'échec, de succès partiel et de restauration

Le gestionnaire de plugins n'est pas transactionnel.

| Étape de l'opération | Comportement en cas d'échec | Restauration |
| --- | --- | --- |
| `bun install` échoue | l'installation s'interrompt avec stderr | N/A (pas encore d'écriture d'état) |
| L'installation réussit, puis la validation du manifeste/fonctionnalités échoue | la commande échoue | Pas de restauration par désinstallation ; la dépendance peut rester dans `node_modules`/`package.json` |
| L'installation réussit, puis l'écriture du fichier de verrouillage échoue | la commande échoue | Pas de restauration du paquet installé |
| `bun uninstall` réussit, l'écriture du fichier de verrouillage échoue | la commande échoue | Paquet supprimé, un état d'exécution obsolète peut subsister |
| `link` supprime l'ancienne cible puis la création du lien symbolique échoue | la commande échoue | Pas de restauration du lien/répertoire précédent |

En pratique, `doctor --fix` peut réparer certaines dérives (`bun install`, nettoyage de configuration orpheline, nettoyage de fonctionnalités invalides), mais c'est au mieux un effort raisonnable.

## Résumé du comportement avec manifeste malformé/manquant

- Champ `xcsh`/`pi` manquant :
  - installation/listage : toléré (manifeste minimal)
  - découverte des plugins activés à l'exécution : ignoré en tant que non-plugin
- Fonctionnalité manquante référencée par la spécification d'installation ou `features --set/--enable` : erreur fatale avec liste des fonctionnalités disponibles
- `plugin-overrides.json` invalide : ignoré avec repli sur `{}` dans les chemins du gestionnaire et du chargeur
- Chemins de fichiers d'outils/hooks/commandes manquants référencés par le manifeste : silencieusement ignorés lors de l'expansion du résolveur ; signalés comme erreurs uniquement par `doctor`

## Différences de mode et priorité

- `--dry-run` (installation) : retourne un résultat d'installation synthétique, pas d'écritures sur le système de fichiers/réseau/état.
- `--json` : formatage de sortie uniquement, pas de changement de comportement.
- Les surcharges du projet ont toujours la priorité sur le fichier de verrouillage global pour la vue des fonctionnalités/paramètres.
- L'activation effective est `runtimeEnabled && !projectDisabled`.

## Fichiers d'implémentation

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — Déclaration de commande CLI et mapping des options
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — Dispatch des actions, gestionnaires de commandes côté utilisateur
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — Implémentation active de l'installation/suppression/listage/lien/état/doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — Utilitaires d'installation historiques et vérifications de sécurité supplémentaires pour les liens
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — Découverte des plugins activés et résolution des chemins outils/hooks/commandes
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — Utilitaires d'analyse des spécifications d'installation et des noms de paquets
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — Contrats de types manifeste/exécution/surcharge
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — Câblage à l'exécution pour les modules d'outils fournis par les plugins
