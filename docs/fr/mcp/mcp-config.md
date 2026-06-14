---
title: Configuration MCP
description: >-
  Configuration, validation et gestion du serveur MCP pour le runtime de l'agent
  de codage.
sidebar:
  order: 1
  label: Configuration
i18n:
  sourceHash: e4f56e8becc6
  translator: machine
---

# Configuration MCP dans OMP

Ce guide explique comment ajouter, modifier et valider des serveurs MCP pour l'agent de codage OMP.

Source de référence dans le code :

- Types de configuration du runtime : `packages/coding-agent/src/mcp/types.ts`
- Écrivain de configuration : `packages/coding-agent/src/mcp/config-writer.ts`
- Chargeur + validation : `packages/coding-agent/src/mcp/config.ts`
- Découverte `mcp.json` autonome : `packages/coding-agent/src/discovery/mcp-json.ts`
- Schéma : `packages/coding-agent/src/config/mcp-schema.json`

## Emplacements de configuration recommandés

OMP peut découvrir des serveurs MCP depuis plusieurs outils (`.claude/`, `.cursor/`, `.vscode/`, `opencode.json`, et d'autres), mais pour une configuration native OMP, vous devriez généralement utiliser l'un de ces fichiers :

- Projet : `.xcsh/mcp.json`
- Utilisateur : `~/.xcsh/mcp.json`

OMP accepte également des fichiers autonomes de repli à la racine du projet :

- `mcp.json`
- `.mcp.json`

Utilisez `.xcsh/mcp.json` lorsque vous souhaitez qu'OMP gère la configuration. Utilisez `mcp.json` / `.mcp.json` à la racine uniquement lorsque vous souhaitez un fichier de repli portable que d'autres clients MCP pourront également lire.

## Ajouter une référence de schéma

Ajoutez cette ligne en haut du fichier pour l'autocomplétion et la validation dans l'éditeur :

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {}
}
```

OMP écrit désormais ceci automatiquement lorsque `/mcp add`, `/mcp enable`, `/mcp disable`, `/mcp reauth`, ou d'autres flux d'écriture de configuration créent ou mettent à jour un fichier MCP géré par OMP.

## Structure du fichier

OMP prend en charge cette structure de niveau supérieur :

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-server"]
    }
  },
  "disabledServers": ["server-name"]
}
```

Clés de niveau supérieur :

- `$schema` — URL de schéma JSON optionnelle pour les outils
- `mcpServers` — correspondance entre le nom du serveur et sa configuration
- `disabledServers` — liste de refus au niveau utilisateur permettant de désactiver les serveurs découverts par nom

Les noms de serveurs doivent correspondre à `^[a-zA-Z0-9_.-]{1,100}$`.

## Champs de serveur pris en charge

Champs partagés pour chaque transport :

- `enabled?: boolean` — ignore ce serveur si `false`
- `timeout?: number` — délai d'expiration de connexion en millisecondes
- `auth?: { ... }` — métadonnées d'authentification utilisées par OMP pour les flux OAuth/clé API
- `oauth?: { ... }` — paramètres client OAuth explicites utilisés lors de l'authentification/réauthentification

### Transport `stdio`

`stdio` est la valeur par défaut lorsque `type` est omis.

Obligatoire :

- `command: string`

Optionnel :

- `type?: "stdio"`
- `args?: string[]`
- `env?: Record<string, string>`
- `cwd?: string`

Exemple :

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/alice/projects",
        "/Users/alice/Documents"
      ]
    }
  }
}
```

Cela suit le package officiel du serveur MCP Filesystem (`@modelcontextprotocol/server-filesystem`).

### Transport `http`

Obligatoire :

- `type: "http"`
- `url: string`

Optionnel :

- `headers?: Record<string, string>`

Exemple :

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

Cela correspond au point de terminaison hébergé du serveur MCP GitHub.

### Transport `sse`

Obligatoire :

- `type: "sse"`
- `url: string`

Optionnel :

- `headers?: Record<string, string>`

Exemple :

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "legacy-remote": {
      "type": "sse",
      "url": "https://example.com/mcp/sse"
    }
  }
}
```

`sse` est toujours pris en charge pour la compatibilité, mais la spécification MCP préconise désormais le HTTP Streamable (`type: "http"`) pour les nouveaux serveurs.

## Champs d'authentification

OMP comprend deux objets liés à l'authentification.

### `auth`

```json
{
  "type": "oauth" | "apikey",
  "credentialId": "optional-stored-credential-id",
  "tokenUrl": "optional-token-endpoint",
  "clientId": "optional-client-id",
  "clientSecret": "optional-client-secret"
}
```

Utilisez ceci lorsqu'OMP doit mémoriser comment réhydrater les identifiants d'un serveur.

### `oauth`

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "redirectUri": "...",
  "callbackPort": 3334,
  "callbackPath": "/oauth/callback"
}
```

Utilisez ceci lorsque le serveur MCP nécessite des paramètres client OAuth explicites.

Slack est l'exemple le plus clair à ce jour. Le serveur MCP de Slack est hébergé sur `https://mcp.slack.com/mcp`, utilise le HTTP Streamable et nécessite un OAuth confidentiel avec les identifiants client de votre application Slack.

Exemple :

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

Points de terminaison Slack pertinents issus de la documentation Slack :

- Point de terminaison MCP : `https://mcp.slack.com/mcp`
- Point de terminaison d'autorisation : `https://slack.com/oauth/v2_user/authorize`
- Point de terminaison de jeton : `https://slack.com/api/oauth.v2.user.access`

## Exemples courants à copier-coller

### Serveur Filesystem via stdio

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/absolute/path/one",
        "/absolute/path/two"
      ]
    }
  }
}
```

### Serveur hébergé GitHub via HTTP

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

### Serveur local GitHub via Docker

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
      }
    }
  }
}
```

Cela correspond à l'image Docker locale officielle de GitHub `ghcr.io/github/github-mcp-server`.

### Serveur hébergé Slack via OAuth

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "slack": {
      "type": "http",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      },
      "auth": {
        "type": "oauth",
        "tokenUrl": "https://slack.com/api/oauth.v2.user.access",
        "clientId": "YOUR_SLACK_CLIENT_ID",
        "clientSecret": "YOUR_SLACK_CLIENT_SECRET"
      }
    }
  }
}
```

## Secrets et résolution de variables

C'est la partie qui pose généralement problème.

### Dans `.xcsh/mcp.json` et `~/.xcsh/mcp.json`

Avant qu'OMP lance un serveur ou effectue une requête HTTP, il résout les valeurs `env` et `headers` de la manière suivante :

1. Si une valeur commence par `!`, OMP l'exécute comme une commande shell et utilise la sortie standard nettoyée.
2. Sinon, OMP vérifie d'abord si la valeur correspond au nom d'une variable d'environnement.
3. Si cette variable d'environnement n'est pas définie, OMP utilise la chaîne littéralement.

Exemples :

```json
{
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"
  },
  "headers": {
    "X-MCP-Insiders": "true"
  }
}
```

Cela signifie que les formulations suivantes sont valides et pratiques pour les secrets locaux :

- `"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"` → copie depuis l'environnement shell courant
- `"Authorization": "Bearer hardcoded-token"` → utilise la valeur littérale
- `"Authorization": "!printf 'Bearer %s' \"$GITHUB_TOKEN\""` → construit l'en-tête à partir d'une commande

### Dans `mcp.json` et `.mcp.json` à la racine

Le chargeur de repli autonome développe également `${VAR}` et `${VAR:-default}` dans les chaînes lors de la découverte.

Exemple :

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    }
  }
}
```

Si vous souhaitez le comportement OMP le moins surprenant, préférez `.xcsh/mcp.json` et utilisez des valeurs explicites pour les variables d'environnement et les en-têtes.

## `disabledServers`

`disabledServers` est principalement utile dans le fichier de configuration utilisateur (`~/.xcsh/mcp.json`) lorsqu'un serveur est découvert depuis une autre source et que vous souhaitez qu'OMP l'ignore sans modifier la configuration de cet autre outil.

Exemple :

```json
{
  "$schema": "https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/mcp-schema.json",
  "disabledServers": ["github", "slack"]
}
```

## `/mcp add` vs modification directe du JSON

Utilisez `/mcp add` lorsque vous souhaitez une configuration guidée.

Utilisez la modification directe du JSON lorsque :

- vous avez besoin d'un transport ou d'une option d'authentification que l'assistant ne propose pas encore
- vous souhaitez coller une définition de serveur depuis un autre client MCP
- vous souhaitez une validation basée sur le schéma dans votre éditeur

Après modification, utilisez :

- `/mcp reload` pour redécouvrir et reconnecter les serveurs dans la session courante
- `/mcp list` pour voir de quel fichier de configuration provient un serveur
- `/mcp test <name>` pour tester un serveur individuel

## Règles de validation appliquées par OMP

Depuis `validateServerConfig()` dans `packages/coding-agent/src/mcp/config.ts` :

- `stdio` nécessite `command`
- `http` et `sse` nécessitent `url`
- un serveur ne peut pas définir à la fois `command` et `url`
- les valeurs `type` inconnues sont rejetées

Implications pratiques :

- Omettre `type` signifie `stdio`
- Si vous collez une configuration de serveur distant et oubliez `"type": "http"`, OMP le traitera comme `stdio` et se plaindra que `command` est manquant
- `sse` reste valide pour la compatibilité, mais les nouveaux serveurs hébergés devraient généralement être configurés en `http`

## Découverte et priorité

OMP ne fusionne pas les définitions de serveurs en double entre les fichiers. Les fournisseurs de découverte sont classés par priorité, et la définition de priorité supérieure l'emporte.

En pratique :

- préférez `.xcsh/mcp.json` ou `~/.xcsh/mcp.json` lorsque vous souhaitez une surcharge spécifique à OMP
- gardez les noms de serveurs uniques entre les outils si possible
- utilisez `disabledServers` dans la configuration utilisateur lorsqu'une configuration tierce réintroduit continuellement un serveur que vous ne souhaitez pas

## Résolution des problèmes

### `Server "name": stdio server requires "command" field`

Vous avez probablement omis `type: "http"` sur un serveur distant.

### `Server "name": both "command" and "url" are set`

Choisissez un transport. OMP traite `command` comme stdio et `url` comme http/sse.

### `/mcp add` a fonctionné mais le serveur ne se connecte toujours pas

Le JSON est valide, mais le serveur peut ne pas être accessible. Utilisez `/mcp test <name>` et vérifiez si :

- le binaire ou l'image Docker existe
- les variables d'environnement requises sont définies
- l'URL distante est accessible
- le jeton OAuth ou API est valide

### Le serveur existe dans la configuration d'un autre outil mais pas dans OMP

Exécutez `/mcp list`. OMP découvre de nombreux fichiers MCP tiers, mais le chargement au niveau du projet peut également être désactivé via le paramètre `mcp.enableProjectConfig`.

## Références

- Spécification du transport MCP : <https://modelcontextprotocol.io/specification/2025-03-26/basic/transports>
- Package du serveur Filesystem : <https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem>
- Serveur MCP GitHub : <https://github.com/github/github-mcp-server>
- Documentation du serveur MCP Slack : <https://docs.slack.dev/ai/slack-mcp-server/>
