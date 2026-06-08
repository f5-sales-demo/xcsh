---
title: Système de plugins Marketplace
description: >-
  Système de plugins marketplace pour découvrir, installer et gérer des
  collections de plugins curatées.
sidebar:
  order: 4
  label: Marketplace
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# Système de plugins marketplace

Le système marketplace vous permet de découvrir, installer et gérer des plugins à partir de catalogues hébergés sur Git. Il est compatible avec le format de registre de plugins de Claude Code.

## Démarrage rapide

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

Ou tapez simplement `/marketplace` sans argument pour ouvrir le navigateur interactif de plugins.

## Concepts

Un **marketplace** est un dépôt Git (ou un répertoire local) contenant un fichier de catalogue à l'emplacement `.xcsh-plugin/marketplace.json`. Le catalogue répertorie les plugins disponibles avec leurs sources, descriptions et métadonnées.

Un **plugin** est un répertoire contenant des compétences, des commandes, des hooks, des serveurs MCP ou des serveurs LSP. Les plugins sont identifiés par `name@marketplace` (par exemple `code-review@f5xc-salesdemos-marketplace`).

**Portées** : les plugins peuvent être installés à deux niveaux de portée :

- **user** (par défaut) -- disponible dans tous les projets, stocké dans `~/.xcsh/plugins/installed_plugins.json`
- **project** -- disponible uniquement dans le projet courant, stocké dans `.xcsh/installed_plugins.json`

Les installations au niveau projet masquent les installations au niveau utilisateur du même plugin.

## Commandes

### Mode interactif

| Commande | Effet |
|---|---|
| `/marketplace` | Ouvrir le navigateur interactif de plugins (installation) |

### Gestion du marketplace

| Commande | Effet |
|---|---|
| `/marketplace add <source>` | Ajouter une source marketplace |
| `/marketplace remove <name>` | Supprimer un marketplace |
| `/marketplace update [name]` | Re-récupérer le(s) catalogue(s) ; omettre le nom pour tout mettre à jour |
| `/marketplace list` | Lister les marketplaces configurés |

### Opérations sur les plugins

| Commande | Effet |
|---|---|
| `/marketplace discover [marketplace]` | Parcourir les plugins disponibles |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | Installer un plugin |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | Désinstaller un plugin |
| `/marketplace installed` | Lister les plugins marketplace installés |
| `/marketplace upgrade [--scope user\|project] [name@marketplace]` | Mettre à jour un ou tous les plugins |

### Équivalents en ligne de commande

Les mêmes opérations sont disponibles depuis la ligne de commande :

```
xcsh plugin marketplace add <source>
xcsh plugin marketplace remove <name>
xcsh plugin marketplace update [name]
xcsh plugin marketplace list
xcsh plugin discover [marketplace]
xcsh plugin install --scope project name@marketplace
```

## Sources marketplace

Lorsque vous exécutez `/marketplace add <source>`, le système classifie la source :

| Format de la source | Type | Exemple |
|---|---|---|
| `owner/repo` | Abréviation GitHub | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | URL directe du catalogue | `https://example.com/marketplace.json` |
| `https://...*.git` ou `git@...` | Dépôt Git | `https://github.com/org/repo.git` |
| `./path` ou `~/path` ou `/path` | Répertoire local | `./my-marketplace` |

Le système clone le dépôt (ou lit le répertoire local), localise `.xcsh-plugin/marketplace.json`, le valide et met en cache le catalogue localement.

## Format du catalogue (marketplace.json)

Un catalogue marketplace se trouve à l'emplacement `.xcsh-plugin/marketplace.json` à la racine du dépôt :

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "my-marketplace",
  "owner": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "description": "A collection of plugins",
  "plugins": [
    {
      "name": "my-plugin",
      "description": "What this plugin does",
      "source": "./plugins/my-plugin",
      "category": "development",
      "homepage": "https://github.com/you/my-plugin"
    }
  ]
}
```

### Champs obligatoires

| Champ | Description |
|---|---|
| `name` | Nom du marketplace. Alphanumérique minuscule, tirets et points. Doit commencer et se terminer par un caractère alphanumérique. 64 caractères maximum. |
| `owner.name` | Nom du propriétaire du marketplace |
| `plugins` | Tableau d'entrées de plugins |

### Champs d'une entrée plugin

| Champ | Obligatoire | Description |
|---|---|---|
| `name` | oui | Nom du plugin (mêmes règles que le nom du marketplace) |
| `source` | oui | Où trouver le plugin (voir ci-dessous) |
| `description` | non | Description courte |
| `version` | non | Chaîne de version |
| `author` | non | `{ name, email? }` |
| `homepage` | non | URL |
| `category` | non | Chaîne de catégorie (par exemple `development`, `productivity`, `security`) |
| `tags` | non | Tableau de tags sous forme de chaînes |
| `strict` | non | Booléen |
| `commands` | non | Commandes slash fournies |
| `agents` | non | Agents fournis |
| `hooks` | non | Définitions de hooks |
| `mcpServers` | non | Définitions de serveurs MCP |
| `lspServers` | non | Définitions de serveurs LSP |

### Formats de source de plugin

Le champ `source` prend en charge plusieurs formats :

**Chemin relatif** (au sein du dépôt marketplace) :

```json
"source": "./plugins/my-plugin"
```

**URL de dépôt Git** :

```json
"source": {
  "source": "url",
  "url": "https://github.com/org/repo.git",
  "sha": "abc123..."
}
```

**Abréviation GitHub** :

```json
"source": {
  "source": "github",
  "repo": "org/repo",
  "ref": "main",
  "sha": "abc123..."
}
```

**Sous-répertoire Git** (monorepo) :

```json
"source": {
  "source": "git-subdir",
  "url": "https://github.com/org/monorepo.git",
  "path": "plugins/my-plugin",
  "ref": "main",
  "sha": "abc123..."
}
```

**Package npm** :

```json
"source": {
  "source": "npm",
  "package": "@scope/my-plugin",
  "version": "1.0.0"
}
```

## Organisation sur le disque

```
~/.xcsh/
  config/
    marketplaces.json          # Registre des marketplaces ajoutés
  plugins/
    installed_plugins.json     # Plugins installés au niveau utilisateur
    cache/
      marketplaces/            # Catalogues marketplace mis en cache
      plugins/                 # Répertoires de plugins mis en cache

<project>/.xcsh/
  installed_plugins.json       # Plugins installés au niveau projet
```

## Règles de nommage

Les noms de marketplace et de plugin doivent :

- Commencer et se terminer par une lettre minuscule ou un chiffre
- Contenir uniquement des lettres minuscules, des chiffres, des tirets et des points
- Faire au maximum 64 caractères

Les identifiants de plugin (`name@marketplace`) doivent faire au maximum 128 caractères au total.

Exemples valides : `my-plugin`, `code-review`, `wordpress.com`, `ai-firstify`
Exemples invalides : `-bad`, `bad-`, `.bad`, `Bad`, `under_score`
