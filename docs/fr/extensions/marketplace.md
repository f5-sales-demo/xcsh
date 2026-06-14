---
title: Système de plugins Place de marché
description: >-
  Système de plugins Place de marché pour découvrir, installer et gérer des
  collections de plugins organisées.
sidebar:
  order: 4
  label: Place de marché
i18n:
  sourceHash: 8ff4a59bbcd5
  translator: machine
---

# Système de plugins Place de marché

Le système de place de marché vous permet de découvrir, d'installer et de gérer des plugins issus de catalogues hébergés sur Git. Il est compatible avec le format de registre de plugins Claude Code.

## Démarrage rapide

```
/marketplace add anthropics/f5xc-salesdemos-marketplace
/marketplace install wordpress.com@f5xc-salesdemos-marketplace
```

Ou saisissez simplement `/marketplace` sans argument pour ouvrir le navigateur de plugins interactif.

## Concepts

Une **place de marché** est un dépôt Git (ou un répertoire local) contenant un fichier de catalogue à l'emplacement `.xcsh-plugin/marketplace.json`. Le catalogue répertorie les plugins disponibles avec leurs sources, descriptions et métadonnées.

Un **plugin** est un répertoire contenant des compétences, des commandes, des hooks, des serveurs MCP ou des serveurs LSP. Les plugins sont identifiés par `name@marketplace` (ex. : `code-review@f5xc-salesdemos-marketplace`).

**Portées** : les plugins peuvent être installés à deux portées :

- **user** (par défaut) -- disponible dans tous les projets, stocké dans `~/.xcsh/plugins/installed_plugins.json`
- **project** -- disponible uniquement dans le projet courant, stocké dans `.xcsh/installed_plugins.json`

Les installations à portée projet remplacent les installations à portée utilisateur du même plugin.

## Commandes

### Mode interactif

| Commande | Effet |
|---|---|
| `/marketplace` | Ouvrir le navigateur de plugins interactif (installation) |

### Gestion de la place de marché

| Commande | Effet |
|---|---|
| `/marketplace add <source>` | Ajouter une source de place de marché |
| `/marketplace remove <name>` | Supprimer une place de marché |
| `/marketplace update [name]` | Récupérer à nouveau le(s) catalogue(s) ; omettre le nom pour tout mettre à jour |
| `/marketplace list` | Lister les places de marché configurées |

### Opérations sur les plugins

| Commande | Effet |
|---|---|
| `/marketplace discover [marketplace]` | Parcourir les plugins disponibles |
| `/marketplace install [--force] [--scope user\|project] name@marketplace` | Installer un plugin |
| `/marketplace uninstall [--scope user\|project] name@marketplace` | Désinstaller un plugin |
| `/marketplace installed` | Lister les plugins de la place de marché installés |
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

## Sources de la place de marché

Lorsque vous exécutez `/marketplace add <source>`, le système classe la source :

| Format de la source | Type | Exemple |
|---|---|---|
| `owner/repo` | Raccourci GitHub | `anthropics/f5xc-salesdemos-marketplace` |
| `https://...*.json` | URL directe du catalogue | `https://example.com/marketplace.json` |
| `https://...*.git` ou `git@...` | Dépôt Git | `https://github.com/org/repo.git` |
| `./path` ou `~/path` ou `/path` | Répertoire local | `./my-marketplace` |

Le système clone le dépôt (ou lit le répertoire local), localise `.xcsh-plugin/marketplace.json`, le valide et met en cache le catalogue localement.

## Format du catalogue (marketplace.json)

Un catalogue de place de marché réside dans `.xcsh-plugin/marketplace.json` à la racine du dépôt :

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
| `name` | Nom de la place de marché. Alphanumérique en minuscules, tirets et points. Doit commencer et se terminer par un caractère alphanumérique. 64 caractères maximum. |
| `owner.name` | Nom du propriétaire de la place de marché |
| `plugins` | Tableau d'entrées de plugins |

### Champs d'une entrée de plugin

| Champ | Obligatoire | Description |
|---|---|---|
| `name` | oui | Nom du plugin (mêmes règles que pour le nom de la place de marché) |
| `source` | oui | Emplacement du plugin (voir ci-dessous) |
| `description` | non | Courte description |
| `version` | non | Chaîne de version |
| `author` | non | `{ name, email? }` |
| `homepage` | non | URL |
| `category` | non | Chaîne de catégorie (ex. : `development`, `productivity`, `security`) |
| `tags` | non | Tableau de balises de type chaîne |
| `strict` | non | Booléen |
| `commands` | non | Commandes slash fournies |
| `agents` | non | Agents fournis |
| `hooks` | non | Définitions de hooks |
| `mcpServers` | non | Définitions de serveurs MCP |
| `lspServers` | non | Définitions de serveurs LSP |

### Formats de la source d'un plugin

Le champ `source` prend en charge plusieurs formats :

**Chemin relatif** (au sein du dépôt de la place de marché) :

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

**Raccourci GitHub** :

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

**Paquet npm** :

```json
"source": {
  "source": "npm",
  "package": "@scope/my-plugin",
  "version": "1.0.0"
}
```

## Structure sur disque

```
~/.xcsh/
  config/
    marketplaces.json          # Registre des places de marché ajoutées
  plugins/
    installed_plugins.json     # Plugins installés à portée utilisateur
    cache/
      marketplaces/            # Catalogues de places de marché mis en cache
      plugins/                 # Répertoires de plugins mis en cache

<project>/.xcsh/
  installed_plugins.json       # Plugins installés à portée projet
```

## Règles de nommage

Les noms de place de marché et de plugin doivent :

- Commencer et se terminer par une lettre minuscule ou un chiffre
- Ne contenir que des lettres minuscules, des chiffres, des tirets et des points
- Ne pas dépasser 64 caractères

Les identifiants de plugin (`name@marketplace`) ne doivent pas dépasser 128 caractères au total.

Exemples valides : `my-plugin`, `code-review`, `wordpress.com`, `ai-firstify`
Exemples invalides : `-bad`, `bad-`, `.bad`, `Bad`, `under_score`
