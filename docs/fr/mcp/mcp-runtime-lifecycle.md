---
title: Cycle de vie du runtime MCP
description: >-
  Cycle de vie des processus serveur MCP, de l'initialisation à l'enregistrement
  des outils, la surveillance de l'état de santé et l'arrêt.
sidebar:
  order: 3
  label: Cycle de vie du runtime
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# Cycle de vie du runtime MCP

Ce document décrit comment les serveurs MCP sont découverts, connectés, exposés en tant qu'outils, rafraîchis et arrêtés dans le runtime du coding-agent.

## Cycle de vie en un coup d'œil

1. **Le démarrage du SDK** appelle `discoverAndLoadMCPTools()` (sauf si MCP est désactivé).
2. **La découverte** (`loadAllMCPConfigs`) résout les configurations de serveurs MCP à partir des sources de capacités, filtre les entrées désactivées/projet/Exa, et préserve les métadonnées de source.
3. **La phase de connexion du manager** (`MCPManager.connectServers`) démarre la connexion par serveur + `tools/list` en parallèle.
4. **Le seuil de démarrage rapide** attend jusqu'à 250ms, puis peut retourner :
   - des `MCPTool`s entièrement chargés,
   - des échecs par serveur,
   - ou des `DeferredMCPTool`s en cache pour les serveurs encore en attente.
5. **Le câblage du SDK** fusionne les outils MCP dans le registre d'outils du runtime pour la session.
6. **La session active** peut rafraîchir les outils MCP via les flux `/mcp` (`disconnectAll` + redécouverte + `session.refreshMCPTools`).
7. **L'arrêt** survient lorsque les appelants invoquent `disconnectServer`/`disconnectAll` ; le manager efface également les enregistrements d'outils MCP pour les serveurs déconnectés.

## Phase de découverte et de chargement

### Chemin d'entrée depuis le SDK

`createAgentSession()` dans `src/sdk.ts` effectue le démarrage MCP quand `enableMCP` est vrai (par défaut) :

- appelle `discoverAndLoadMCPTools(cwd, { ... })`,
- transmet `authStorage`, le stockage de cache et le paramètre `mcp.enableProjectConfig`,
- définit toujours `filterExa: true`,
- journalise les erreurs de chargement/connexion par serveur,
- stocke le manager retourné dans `toolSession.mcpManager` et le résultat de session.

Si `enableMCP` est faux, la découverte MCP est entièrement ignorée.

### Découverte et filtrage de la configuration

`loadAllMCPConfigs()` (`src/mcp/config.ts`) charge les éléments canoniques de serveurs MCP via la découverte de capacités, puis les convertit en `MCPServerConfig` legacy.

Comportement de filtrage :

- `enableProjectConfig: false` supprime les entrées au niveau projet (`_source.level === "project"`).
- Les serveurs avec `enabled: false` sont ignorés avant les tentatives de connexion.
- Les serveurs Exa sont filtrés par défaut et les clés API sont extraites pour l'intégration native de l'outil Exa.

Le résultat inclut à la fois `configs` et `sources` (métadonnées utilisées ultérieurement pour l'étiquetage du fournisseur).

### Comportement en cas d'échec au niveau de la découverte

`discoverAndLoadMCPTools()` distingue deux classes d'échec :

- **Échec critique de la découverte** (exception de `manager.discoverAndConnect`, typiquement issue de la découverte de configuration) : retourne un ensemble d'outils vide et une erreur synthétique `{ path: ".mcp.json", error }`.
- **Échec runtime/connexion par serveur** : le manager retourne un succès partiel avec une map `errors` ; les autres serveurs continuent.

Ainsi, le démarrage ne fait pas échouer l'ensemble de la session de l'agent lorsque des serveurs MCP individuels échouent.

## Modèle d'état du manager

`MCPManager` suit le cycle de vie du runtime avec des registres séparés :

- `#connections: Map<string, MCPServerConnection>` — serveurs entièrement connectés.
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — négociation en cours.
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — connectés mais outils encore en chargement.
- `#tools: CustomTool[]` — vue actuelle des outils MCP exposée aux appelants.
- `#sources: Map<string, SourceMeta>` — métadonnées fournisseur/source même avant la fin de la connexion.

`getConnectionStatus(name)` dérive le statut à partir de ces maps :

- `connected` si dans `#connections`,
- `connecting` si connexion en attente ou chargement d'outils en attente,
- `disconnected` sinon.

## Établissement de connexion et timing de démarrage

## Pipeline de connexion par serveur

Pour chaque serveur découvert dans `connectServers()` :

1. stocker/mettre à jour les métadonnées de source,
2. ignorer si déjà connecté/en attente,
3. valider les champs de transport (`validateServerConfig`),
4. résoudre les substitutions d'authentification/shell (`#resolveAuthConfig`),
5. appeler `connectToServer(name, resolvedConfig)`,
6. appeler `listTools(connection)`,
7. mettre en cache les définitions d'outils (`MCPToolCache.set`) au mieux.

Comportement de `connectToServer()` (`src/mcp/client.ts`) :

- crée un transport stdio ou HTTP/SSE,
- effectue le `initialize` MCP + `notifications/initialized`,
- utilise un timeout (`config.timeout` ou 30s par défaut),
- ferme le transport en cas d'échec de l'initialisation.

### Seuil de démarrage rapide + repli différé

`connectServers()` attend une course entre :

- toutes les tâches de connexion/chargement d'outils résolues, et
- `STARTUP_TIMEOUT_MS = 250`.

Après 250ms :

- les tâches réussies deviennent des `MCPTool`s actifs,
- les tâches échouées produisent des erreurs par serveur,
- les tâches encore en attente :
  - utilisent les définitions d'outils en cache si disponibles (`MCPToolCache.get`) pour créer des `DeferredMCPTool`s,
  - sinon bloquent jusqu'à la résolution de ces tâches en attente.

C'est un modèle de démarrage hybride : retour rapide quand le cache est disponible, attente de correction quand il ne l'est pas.

### Comportement de complétion en arrière-plan

Chaque `toolsPromise` en attente a également une continuation en arrière-plan qui finalement :

- remplace la tranche d'outils de ce serveur dans l'état du manager via `#replaceServerTools`,
- écrit le cache,
- journalise les échecs tardifs uniquement après le démarrage (`allowBackgroundLogging`).

## Exposition des outils et disponibilité en session active

### Enregistrement au démarrage

`discoverAndLoadMCPTools()` convertit les outils du manager en `LoadedCustomTool[]` et décore les chemins (`mcp:<server> via <providerName>` quand connu).

`createAgentSession()` pousse ensuite ces outils dans `customTools`, qui sont encapsulés et ajoutés au registre d'outils du runtime avec des noms comme `mcp_<server>_<tool>`.

### Appels d'outils

- `MCPTool` appelle les outils via une `MCPServerConnection` déjà connectée.
- `DeferredMCPTool` attend `waitForConnection(server)` avant d'appeler ; cela permet aux outils en cache d'exister avant que la connexion ne soit prête.

Les deux retournent une sortie d'outil structurée et convertissent les erreurs de transport/outil en contenu d'outil `MCP error: ...` (l'abandon reste un abandon).

## Chemins de rafraîchissement/rechargement (démarrage vs rechargement en direct)

### Chemin de démarrage initial

- découverte/chargement unique dans `sdk.ts`,
- les outils sont enregistrés dans le registre d'outils de la session initiale.

### Chemin de rechargement interactif

Le chemin `/mcp reload` (`src/modes/controllers/mcp-command-controller.ts`) effectue :

1. `mcpManager.disconnectAll()`,
2. `mcpManager.discoverAndConnect()`,
3. `session.refreshMCPTools(mcpManager.getTools())`.

`session.refreshMCPTools()` (`src/session/agent-session.ts`) supprime tous les outils `mcp_`, ré-encapsule les derniers outils MCP et réactive l'ensemble d'outils pour que les changements MCP s'appliquent sans redémarrer la session.

Il y a également un chemin de suivi pour les connexions tardives : après l'attente d'un serveur spécifique, si le statut devient `connected`, il réexécute `session.refreshMCPTools(...)` pour que les outils nouvellement disponibles soient reliés en session.

## Santé, reconnexion et comportement en cas d'échec partiel

Le comportement actuel du runtime est intentionnellement minimal :

- **Pas de moniteur de santé autonome** dans le manager/client.
- **Pas de boucle de reconnexion automatique** lorsqu'un transport tombe.
- Le manager ne s'abonne pas aux événements `onClose`/`onError` du transport ; le statut est piloté par le registre.
- La reconnexion est explicite : flux de rechargement ou invocation directe de `connectServers()`.

Opérationnellement :

- l'échec d'un serveur ne supprime pas les outils des serveurs sains,
- les échecs de connexion/listage sont isolés par serveur,
- le cache d'outils et les mises à jour en arrière-plan sont au mieux (avertissements/erreurs journalisés, pas d'arrêt brutal).

## Sémantique de l'arrêt

### Arrêt au niveau du serveur

`disconnectServer(name)` :

- supprime les entrées en attente/métadonnées de source,
- ferme le transport si connecté,
- supprime les outils `mcp_` de ce serveur de l'état du manager.

### Arrêt global

`disconnectAll()` :

- ferme tous les transports actifs avec `Promise.allSettled`,
- vide les maps en attente, les sources, les connexions et la liste d'outils du manager.

Dans le câblage actuel, l'arrêt explicite est utilisé dans les flux de commandes MCP (pour le rechargement/suppression/désactivation). Il n'y a pas de hook de disposition automatique du manager séparé dans le chemin de démarrage lui-même ; les appelants sont responsables d'invoquer les méthodes de déconnexion du manager lorsqu'ils ont besoin d'un arrêt MCP déterministe.

## Modes d'échec et garanties

| Scénario | Comportement | Échec critique vs au mieux |
| --- | --- | --- |
| La découverte lève une exception (chemin de chargement capacité/config) | Le chargeur retourne des outils vides + erreur synthétique `.mcp.json` | Démarrage de session au mieux |
| Configuration de serveur invalide | Serveur ignoré avec entrée d'erreur de validation | Au mieux par serveur |
| Timeout de connexion/échec d'initialisation | Erreur serveur enregistrée ; les autres continuent | Au mieux par serveur |
| `tools/list` encore en attente au démarrage avec cache disponible | Outils différés retournés immédiatement | Démarrage rapide au mieux |
| `tools/list` encore en attente au démarrage sans cache | Le démarrage attend la résolution des tâches en attente | Attente stricte pour la correction |
| Échec tardif du chargement d'outils en arrière-plan | Journalisé après le seuil de démarrage | Journalisation au mieux |
| Transport interrompu en runtime | Pas de reconnexion automatique ; les appels futurs échouent jusqu'à reconnexion/rechargement | Récupération au mieux via action manuelle |

## Surface d'API publique

`src/mcp/index.ts` réexporte les APIs du chargeur/manager/client pour les appelants externes. `src/sdk.ts` expose `discoverMCPServers()` comme un wrapper de commodité retournant la même forme de résultat du chargeur.

## Fichiers d'implémentation

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — façade du chargeur, normalisation des erreurs de découverte, conversion en `LoadedCustomTool`.
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — registres d'état du cycle de vie, flux parallèle de connexion/listage, rafraîchissement/déconnexion.
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — configuration du transport, négociation d'initialisation, listage/appel/déconnexion.
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — exports de l'API du module MCP.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — câblage de démarrage dans la session/le registre d'outils.
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — découverte/filtrage/validation de la configuration utilisée par le manager.
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — comportement runtime de `MCPTool` et `DeferredMCPTool`.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — reliaison en direct `refreshMCPTools`.
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — flux interactifs de rechargement/reconnexion.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — proxy MCP de sous-agent via les connexions du manager parent.
