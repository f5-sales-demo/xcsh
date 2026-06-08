---
title: Contextes F5 XC
description: >-
  Connectez xcsh aux tenants F5 Distributed Cloud -- créez, basculez et gérez
  les contextes d'authentification.
sidebar:
  order: 1
  label: Contextes F5 XC
i18n:
  sourceHash: bdaf0fb8837c
  translator: machine
---

# Contextes F5 XC

xcsh se connecte à F5 Distributed Cloud via des **contextes** -- des jeux d'identifiants nommés qui associent une URL de tenant, un jeton API et un namespace. Si vous avez déjà utilisé `kubectl config use-context` ou `kubectx`, le flux de travail est identique : créez un contexte, basculez entre eux par nom, et utilisez `-` pour revenir au précédent.

## Pour commencer

### 1. Créez votre premier contexte

Vous avez besoin de trois éléments depuis votre console F5 XC : l'URL du tenant, un jeton API, et optionnellement un namespace.

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

Ou utilisez l'assistant guidé si vous préférez des invites étape par étape :

```
/context wizard
```

### 2. Activez-le

```
/context production
```

```
╭─ production ─────────────────────────────────────────────────╮
│ F5XC_TENANT     acme                                         │
│ F5XC_API_URL    https://acme.console.ves.volterra.io         │
│ F5XC_API_TOKEN  ...oken                                      │
│ Status          Connected (312ms)                            │
├─ Environment ────────────────────────────────────────────────┤
│ F5XC_NAMESPACE  default                                      │
╰──────────────────────────────────────────────────────────────╯
```

Une fois activé, xcsh injecte les identifiants du tenant dans votre session. L'agent peut désormais effectuer des appels à l'API F5 XC, et la barre d'état affiche le contexte actif.

### 3. Ajoutez d'autres contextes et basculez entre eux

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

Basculez par nom -- aucun verbe de sous-commande nécessaire :

```
/context staging
```

Revenez au contexte précédent (style `cd -`) :

```
/context -
```

Appeler `/context -` deux fois vous ramène à votre point de départ.

### 4. Voyez ce que vous avez

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

Le `*` marque le contexte actif.

## Commandes courantes

| Commande | Ce qu'elle fait |
|---|---|
| `/context` | Lister tous les contextes |
| `/context <name>` | Basculer vers un contexte |
| `/context -` | Basculer vers le contexte précédent |
| `/context show` | Afficher les détails du contexte actif (jetons masqués) |
| `/context status` | Afficher l'état actuel de l'authentification |

## Cycle de vie des contextes

| Commande | Ce qu'elle fait |
|---|---|
| `/context create <name> <url> <token> [namespace]` | Créer un contexte |
| `/context delete <name> --confirm` | Supprimer un contexte (nécessite `--confirm`) |
| `/context rename <old> <new>` | Renommer un contexte |
| `/context validate <name>` | Tester les identifiants sans basculer |
| `/context export [name] [--include-token]` | Exporter en JSON (jetons masqués par défaut) |
| `/context import <path-or-json> [--overwrite]` | Importer depuis un fichier ou du JSON en ligne |
| `/context wizard` | Configuration interactive guidée |

## Changer de namespace

Chaque contexte possède un namespace par défaut. Changez-le sans modifier le contexte :

```
/context namespace system
```

L'autocomplétion par tabulation propose les noms de namespace du tenant actif.

## Variables d'environnement sur les contextes

Les contextes peuvent contenir des variables d'environnement supplémentaires qui sont injectées dans votre session lors de l'activation. Utile pour une configuration propre à chaque tenant qui ne fait pas partie du jeu d'identifiants.

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

Alias : `add` = `set`, `remove`/`clear` = `unset`.

## Autocomplétion par tabulation

Tapez `/context ` et appuyez sur Tab. Le menu déroulant affiche :

1. **Noms de contextes** -- avec des indications d'URL de tenant, pour distinguer les tenants
2. **`-`** -- apparaît lorsque vous avez déjà basculé, indique vers quel contexte vous reviendriez
3. **Sous-commandes** -- `list`, `create`, `delete`, etc.

Les noms de contextes apparaissent en premier car le basculement est l'action la plus courante.

Les complétions au niveau des sous-commandes fonctionnent également : `/context activate <Tab>` complète les noms de contextes, `/context namespace <Tab>` complète les namespaces, `/context unset <Tab>` complète les clés de variables d'environnement connues.

## Règles de nommage

Les noms de contextes doivent comporter entre 1 et 64 caractères : lettres, chiffres, tirets, underscores.

Les noms qui entrent en conflit avec les sous-commandes sont rejetés :

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

L'ensemble complet des noms réservés : `list`, `show`, `status`, `create`, `delete`, `rename`, `namespace`, `env`, `set`, `unset`, `add`, `remove`, `clear`, `activate`, `validate`, `export`, `import`, `wizard`, `help`. La comparaison est insensible à la casse.

## Substitution par variables d'environnement

Si `F5XC_API_URL` et `F5XC_API_TOKEN` sont définies dans votre environnement shell avant de lancer xcsh, elles prennent le pas sur tout contexte. Ceci est utile pour les pipelines CI/CD ou les sessions ponctuelles où vous ne souhaitez pas créer un contexte persistant.

Dans ce mode, `/context` affiche les identifiants issus de l'environnement avec l'étiquette `(via env vars)`.

## Comportement du contexte précédent

- **Portée de session** : le contexte précédent est réinitialisé au redémarrage de xcsh. Il n'est pas persisté sur disque.
- **Ping-pong** : `/context -` deux fois vous ramène à votre point de départ.
- **Sûr face aux mutations** : si vous supprimez le contexte précédent, le pointeur est effacé. Si vous le renommez, le pointeur suit le nouveau nom.
- **La réactivation est un no-op** : `/context production` lorsque vous êtes déjà sur `production` ne réinitialise pas le pointeur précédent.

## Conventions de conception

L'expérience utilisateur de `/context` s'inspire de :

- **kubectx** : `kubectx <name>` pour basculer, `kubectx -` pour le précédent, `kubectx` seul pour lister
- **kubectl** : `kubectl config use-context` pour la forme explicite
- **Shell** : `cd -` / `OLDPWD` pour le suivi du répertoire précédent
