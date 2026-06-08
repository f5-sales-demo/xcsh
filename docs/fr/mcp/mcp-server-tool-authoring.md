---
title: Création de serveurs et d'outils MCP
description: >-
  Guide pour construire des serveurs MCP personnalisés et enregistrer des outils
  pour l'agent de codage.
sidebar:
  order: 4
  label: Création de serveurs et d'outils
i18n:
  sourceHash: 160e7560ef1f
  translator: machine
---

# Création de serveurs et d'outils MCP

Ce document explique comment les définitions de serveurs MCP deviennent des outils `mcp_*` appelables dans coding-agent, et ce à quoi les opérateurs doivent s'attendre lorsque les configurations sont invalides, dupliquées, désactivées ou protégées par authentification.

## Architecture en un coup d'œil

```text
Config sources (.xcsh/.claude/.cursor/.vscode/mcp.json, mcp.json, etc.)
  -> discovery providers normalize to canonical MCPServer
  -> capability loader dedupes by server name (higher provider priority wins)
  -> loadAllMCPConfigs converts to MCPServerConfig + skips enabled:false
  -> MCPManager connects/listTools (with auth/header/env resolution)
  -> MCPTool/DeferredMCPTool bridge exposes tools as mcp_<server>_<tool>
  -> AgentSession.refreshMCPTools replaces live MCP tools immediately
```

## 1) Modèle de configuration serveur et validation

`src/mcp/types.ts` définit la forme de création utilisée par les auteurs de configuration MCP et le runtime :

- `stdio` (par défaut lorsque `type` est absent) : nécessite `command`, optionnellement `args`, `env`, `cwd`
- `http` : nécessite `url`, optionnellement `headers`
- `sse` : nécessite `url`, optionnellement `headers` (conservé pour la compatibilité)
- champs partagés : `enabled`, `timeout`, `auth`

`validateServerConfig()` (`src/mcp/config.ts`) applique les règles de base du transport :

- rejette les configurations qui définissent à la fois `command` et `url`
- exige `command` pour stdio
- exige `url` pour http/sse
- rejette les `type` inconnus

`config-writer.ts` applique cette validation pour les opérations d'ajout/mise à jour et valide également les noms de serveurs :

- non vide
- maximum 100 caractères
- uniquement `[a-zA-Z0-9_.-]`

### Pièges liés au transport

- `type` omis signifie stdio. Si vous aviez l'intention d'utiliser HTTP/SSE mais avez omis `type`, `command` devient obligatoire.
- `sse` est toujours accepté mais traité comme un transport HTTP en interne (`createHttpTransport`).
- La validation est structurelle, pas de vérification d'accessibilité : une URL syntaxiquement valide peut toujours échouer au moment de la connexion.

## 2) Découverte, normalisation et priorité

### Découverte basée sur les capacités

`loadAllMCPConfigs()` (`src/mcp/config.ts`) charge les éléments canoniques `MCPServer` via `loadCapability(mcpCapability.id)`.

La couche de capacités (`src/capability/index.ts`) effectue ensuite :

1. le chargement des fournisseurs par ordre de priorité
2. la déduplication par `server.name` (premier arrivé = priorité la plus haute)
3. la validation des éléments dédupliqués

Résultat : les noms de serveurs dupliqués entre les sources ne sont pas fusionnés. Une seule définition l'emporte ; les doublons de priorité inférieure sont masqués.

### `.mcp.json` et fichiers associés

Le fournisseur de secours dédié dans `src/discovery/mcp-json.ts` lit les fichiers `mcp.json` et `.mcp.json` à la racine du projet (priorité basse).

En pratique, les serveurs MCP proviennent également de fournisseurs de priorité supérieure (par exemple les répertoires natifs `.xcsh/...` et les répertoires de configuration spécifiques aux outils). Conseils de création :

- Préférez `.xcsh/mcp.json` (projet) ou `~/.xcsh/mcp.json` (utilisateur) pour un contrôle explicite.
- Utilisez `mcp.json` / `.mcp.json` à la racine lorsque vous avez besoin d'une compatibilité de secours.
- Réutiliser le même nom de serveur dans plusieurs sources provoque un masquage par priorité, pas une fusion.

### Comportement de normalisation

`convertToLegacyConfig()` (`src/mcp/config.ts`) fait correspondre le `MCPServer` canonique au `MCPServerConfig` du runtime.

Comportement clé :

- transport déduit comme `server.transport ?? (command ? "stdio" : url ? "http" : "stdio")`
- les serveurs désactivés (`enabled === false`) sont supprimés avant la connexion
- les champs optionnels sont préservés lorsqu'ils sont présents

### Expansion des variables d'environnement lors de la découverte

`mcp-json.ts` développe les espaces réservés d'environnement dans les champs de type chaîne avec `expandEnvVarsDeep()` :

- prend en charge `${VAR}` et `${VAR:-default}`
- les valeurs non résolues restent des chaînes littérales `${VAR}`

`mcp-json.ts` effectue également des vérifications de type au runtime pour le JSON utilisateur et journalise des avertissements pour les valeurs `enabled`/`timeout` invalides au lieu de faire échouer l'ensemble du fichier.

## 3) Authentification et résolution des valeurs au runtime

`MCPManager.prepareConfig()`/`#resolveAuthConfig()` (`src/mcp/manager.ts`) constitue la passe finale avant la connexion.

### Injection des identifiants OAuth

Si la configuration contient :

```ts
auth: { type: "oauth", credentialId: "..." }
```

et que l'identifiant existe dans le stockage d'authentification :

- `http`/`sse` : injecte l'en-tête `Authorization: Bearer <access_token>`
- `stdio` : injecte la variable d'environnement `OAUTH_ACCESS_TOKEN`

Si la recherche de l'identifiant échoue, le gestionnaire journalise un avertissement et continue avec l'authentification non résolue.

### Résolution des valeurs d'en-têtes et de variables d'environnement

Avant la connexion, le gestionnaire résout chaque valeur d'en-tête/variable d'environnement via `resolveConfigValue()` (`src/config/resolve-config-value.ts`) :

- une valeur commençant par `!` => exécute une commande shell, utilise la sortie standard nettoyée (mise en cache)
- sinon, traite la valeur comme un nom de variable d'environnement d'abord (`process.env[name]`), repli sur la valeur littérale
- les valeurs de commande/variable d'environnement non résolues sont omises de la carte finale des en-têtes/variables d'environnement

Mise en garde opérationnelle : cela signifie qu'une clé de commande/variable d'environnement secrète mal saisie peut supprimer silencieusement cette entrée d'en-tête/variable d'environnement, produisant des erreurs 401/403 ou des échecs de démarrage du serveur en aval.

## 4) Pont d'outils : MCP -> outils appelables par l'agent

`src/mcp/tool-bridge.ts` convertit les définitions d'outils MCP en `CustomTool`s.

### Nommage et domaine de collision

Les noms d'outils sont générés comme suit :

```text
mcp_<sanitized_server_name>_<sanitized_tool_name>
```

Règles :

- mise en minuscules
- les caractères non `[a-z_]` deviennent `_`
- les underscores répétés sont réduits
- le préfixe `<server>_` redondant dans le nom de l'outil est supprimé une fois

Cela évite de nombreuses collisions, mais pas toutes. Des noms bruts différents peuvent toujours être nettoyés vers le même identifiant (par exemple `my-server` et `my.server` sont nettoyés de manière similaire), et l'insertion dans le registre fonctionne en dernier-écrit-gagne.

### Correspondance de schéma

`convertSchema()` conserve le JSON Schema MCP essentiellement tel quel mais corrige les schémas d'objets auxquels il manque `properties` avec `{}` pour la compatibilité avec les fournisseurs.

### Correspondance d'exécution

`MCPTool.execute()` / `DeferredMCPTool.execute()` :

- appelle MCP `tools/call`
- aplatit le contenu MCP en texte affichable
- retourne des détails structurés (`serverName`, `mcpToolName`, métadonnées du fournisseur)
- fait correspondre `isError` signalé par le serveur à un résultat textuel `Error: ...`
- fait correspondre les échecs de transport/runtime lancés à `MCP error: ...`
- préserve la sémantique d'annulation en traduisant AbortError en `ToolAbortError`

## 5) Cycle de vie opérateur : ajout/modification/suppression et mises à jour en direct

Le mode interactif expose `/mcp` dans `src/modes/controllers/mcp-command-controller.ts`.

Opérations prises en charge :

- `add` (assistant ou ajout rapide)
- `remove` / `rm`
- `enable` / `disable`
- `test`
- `reauth` / `unauth`
- `reload`

Les écritures de configuration sont atomiques (`writeMCPConfigFile` : fichier temporaire + renommage).

Après les modifications, le contrôleur appelle `#reloadMCP()` :

1. `mcpManager.disconnectAll()`
2. `mcpManager.discoverAndConnect()`
3. `session.refreshMCPTools(mcpManager.getTools())`

`refreshMCPTools()` remplace toutes les entrées du registre `mcp_` et réactive immédiatement le dernier ensemble d'outils MCP, de sorte que les modifications prennent effet sans redémarrer la session.

### Différences selon les modes

- **Mode interactif/TUI** : `/mcp` offre une expérience utilisateur dans l'application (assistant, flux OAuth, texte de statut de connexion, réassociation immédiate au runtime).
- **Intégration SDK/headless** : `discoverAndLoadMCPTools()` (`src/mcp/loader.ts`) retourne les outils chargés + les erreurs par serveur ; pas d'expérience utilisateur de commande `/mcp`.

## 6) Surfaces d'erreur visibles par l'utilisateur

Chaînes d'erreur courantes que les utilisateurs/opérateurs rencontrent :

- échecs de validation à l'ajout/mise à jour :
  - `Invalid server config: ...`
  - `Server "<name>" already exists in <path>`
- problèmes d'arguments pour l'ajout rapide :
  - `Use either --url or -- <command...>, not both.`
  - `--token requires --url (HTTP/SSE transport).`
- échecs de connexion/test :
  - `Failed to connect to "<name>": <message>`
  - texte d'aide sur le timeout suggérant d'augmenter le délai d'attente
  - texte d'aide sur l'authentification pour `401/403`
- flux d'authentification/OAuth :
  - `Authentication required ... OAuth endpoints could not be discovered`
  - `OAuth flow timed out. Please try again.`
  - `OAuth authentication failed: ...`
- utilisation d'un serveur désactivé :
  - `Server "<name>" is disabled. Run /mcp enable <name> first.`

Un JSON source invalide lors de la découverte est généralement traité comme des avertissements/journaux ; les chemins de config-writer lèvent des erreurs explicites.

## 7) Conseils pratiques de création

Pour une création MCP robuste dans cette base de code :

1. Gardez les noms de serveurs globalement uniques à travers toutes les sources de configuration compatibles MCP.
2. Préférez les noms alphanumériques/underscore pour éviter les collisions de noms nettoyés dans les noms d'outils `mcp_*` générés.
3. Utilisez un `type` explicite pour éviter les défauts stdio accidentels.
4. Traitez `enabled: false` comme un arrêt définitif : le serveur est omis de l'ensemble de connexion au runtime.
5. Pour les configurations OAuth, stockez un `credentialId` valide ; sinon l'injection d'authentification est ignorée.
6. Si vous utilisez la résolution de secrets basée sur les commandes (`!cmd`), vérifiez que la sortie de la commande est stable et non vide.

## Fichiers d'implémentation

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts)
- [`src/mcp/config-writer.ts`](../../packages/coding-agent/src/mcp/config-writer.ts)
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts)
- [`src/discovery/mcp-json.ts`](../../packages/coding-agent/src/discovery/mcp-json.ts)
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/config/resolve-config-value.ts`](../../packages/coding-agent/src/config/resolve-config-value.ts)
- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts)
