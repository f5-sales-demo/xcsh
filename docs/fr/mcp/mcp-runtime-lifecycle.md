---
title: Cycle de vie MCP à l'exécution
description: >-
  Cycle de vie des processus de serveur MCP, de l'initialisation à
  l'enregistrement des outils, la surveillance de l'état de santé et l'arrêt.
sidebar:
  order: 3
  label: Cycle de vie à l'exécution
i18n:
  sourceHash: d04cefaf38f8
  translator: machine
---

# Cycle de vie MCP à l'exécution

Ce document décrit comment les serveurs MCP sont découverts, connectés, exposés en tant qu'outils, rafraîchis et arrêtés dans le runtime de l'agent de codage.

## Cycle de vie en un coup d'œil

1. **Le démarrage du SDK** appelle `discoverAndLoadMCPTools()` (sauf si MCP est désactivé).
2. **La découverte** (`loadAllMCPConfigs`) résout les configurations de serveurs MCP à partir des sources de capacités, filtre les entrées désactivées/projet/Exa, et préserve les métadonnées de source.
3. **La phase de connexion du gestionnaire** (`MCPManager.connectServers`) lance la connexion par serveur + `tools/list` en parallèle.
4. **La porte de démarrage rapide** attend jusqu'à 250 ms, puis peut retourner :
   - des `MCPTool` entièrement chargés,
   - des échecs par serveur,
   - ou des `DeferredMCPTool` mis en cache pour les serveurs encore en attente.
5. **Le câblage du SDK** fusionne les outils MCP dans le registre d'outils du runtime pour la session.
6. **La session active** peut rafraîchir les outils MCP via les flux `/mcp` (`disconnectAll` + redécouverte + `session.refreshMCPTools`).
7. **L'arrêt** se produit lorsque les appelants invoquent `disconnectServer`/`disconnectAll` ; le gestionnaire supprime également les enregistrements d'outils MCP pour les serveurs déconnectés.

## Phase de découverte et de chargement

### Chemin d'entrée depuis le SDK

`createAgentSession()` dans `src/sdk.ts` effectue le démarrage MCP lorsque `enableMCP` est vrai (par défaut) :

- appelle `discoverAndLoadMCPTools(cwd, { ... })`,
- transmet `authStorage`, le stockage de cache et le paramètre `mcp.enableProjectConfig`,
- définit toujours `filterExa: true`,
- journalise les erreurs de chargement/connexion par serveur,
- stocke le gestionnaire retourné dans `toolSession.mcpManager` et le résultat de session.

Si `enableMCP` est faux, la découverte MCP est entièrement ignorée.

### Découverte et filtrage de la configuration

`loadAllMCPConfigs()` (`src/mcp/config.ts`) charge les éléments canoniques de serveurs MCP via la découverte de capacités, puis les convertit en `MCPServerConfig` legacy.

Comportement de filtrage :

- `enableProjectConfig: false` supprime les entrées au niveau projet (`_source.level === "project"`).
- Les serveurs avec `enabled: false` sont ignorés avant les tentatives de connexion.
- Les serveurs Exa sont filtrés par défaut et les clés API sont extraites pour l'intégration native de l'outil Exa.

Le résultat inclut à la fois `configs` et `sources` (métadonnées utilisées ultérieurement pour l'étiquetage des fournisseurs).

### Comportement en cas d'échec au niveau de la découverte

`discoverAndLoadMCPTools()` distingue deux classes d'échec :

- **Échec critique de la découverte** (exception provenant de `manager.discoverAndConnect`, typiquement de la découverte de configuration) : retourne un ensemble d'outils vide et une erreur synthétique `{ path: ".mcp.json", error }`.
- **Échec d'exécution/connexion par serveur** : le gestionnaire retourne un succès partiel avec une map `errors` ; les autres serveurs continuent.

Ainsi, le démarrage ne fait pas échouer l'ensemble de la session de l'agent lorsque des serveurs MCP individuels échouent.

## Modèle d'état du gestionnaire

`MCPManager` suit le cycle de vie à l'exécution avec des registres séparés :

- `#connections: Map<string, MCPServerConnection>` — serveurs entièrement connectés.
- `#pendingConnections: Map<string, Promise<MCPServerConnection>>` — négociation en cours.
- `#pendingToolLoads: Map<string, Promise<{ connection, serverTools }>>` — connectés mais outils encore en chargement.
- `#tools: CustomTool[]` — vue actuelle des outils MCP exposée aux appelants.
- `#sources: Map<string, SourceMeta>` — métadonnées fournisseur/source même avant que la connexion ne soit terminée.

`getConnectionStatus(name)` dérive le statut à partir de ces maps :

- `connected` si présent dans `#connections`,
- `connecting` si en attente de connexion ou de chargement d'outils,
- `disconnected` sinon.

## Établissement de la connexion et chronologie du démarrage

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
- effectue `initialize` MCP + `notifications/initialized`,
- utilise un délai d'expiration (`config.timeout` ou 30 s par défaut),
- ferme le transport en cas d'échec de l'initialisation.

### Porte de démarrage rapide + solution de repli différée

`connectServers()` attend une course entre :

- la résolution de toutes les tâches de connexion/chargement d'outils, et
- `STARTUP_TIMEOUT_MS = 250`.

Après 250 ms :

- les tâches réussies deviennent des `MCPTool` actifs,
- les tâches rejetées produisent des erreurs par serveur,
- les tâches encore en attente :
  - utilisent les définitions d'outils mises en cache si disponibles (`MCPToolCache.get`) pour créer des `DeferredMCPTool`,
  - sinon bloquent jusqu'à ce que ces tâches en attente soient résolues.

Il s'agit d'un modèle de démarrage hybride : retour rapide lorsque le cache est disponible, attente de correction lorsque le cache ne l'est pas.

### Comportement de complétion en arrière-plan

Chaque `toolsPromise` en attente a également une continuation en arrière-plan qui finit par :

- remplacer la tranche d'outils de ce serveur dans l'état du gestionnaire via `#replaceServerTools`,
- écrire le cache,
- journaliser les échecs tardifs uniquement après le démarrage (`allowBackgroundLogging`).

## Exposition des outils et disponibilité en session active

### Enregistrement au démarrage

`discoverAndLoadMCPTools()` convertit les outils du gestionnaire en `LoadedCustomTool[]` et décore les chemins (`mcp:<server> via <providerName>` lorsque connu).

`createAgentSession()` pousse ensuite ces outils dans `customTools`, qui sont encapsulés et ajoutés au registre d'outils du runtime avec des noms comme `mcp_<server>_<tool>`.

### Appels d'outils

- `MCPTool` appelle les outils via une `MCPServerConnection` déjà connectée.
- `DeferredMCPTool` attend `waitForConnection(server)` avant d'appeler ; cela permet aux outils mis en cache d'exister avant que la connexion ne soit prête.

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

`session.refreshMCPTools()` (`src/session/agent-session.ts`) supprime tous les outils `mcp_`, ré-encapsule les derniers outils MCP et réactive l'ensemble d'outils afin que les modifications MCP s'appliquent sans redémarrer la session.

Il existe également un chemin de suivi pour les connexions tardives : après avoir attendu un serveur spécifique, si le statut devient `connected`, il ré-exécute `session.refreshMCPTools(...)` afin que les outils nouvellement disponibles soient reliés dans la session.

## Santé, reconnexion et comportement en cas d'échec partiel

Le comportement actuel du runtime est intentionnellement minimal :

- **Pas de moniteur de santé autonome** dans le gestionnaire/client.
- **Pas de boucle de reconnexion automatique** lorsqu'un transport se déconnecte.
- Le gestionnaire ne s'abonne pas aux événements `onClose`/`onError` du transport ; le statut est piloté par le registre.
- La reconnexion est explicite : flux de rechargement ou invocation directe de `connectServers()`.

En pratique :

- l'échec d'un serveur ne supprime pas les outils des serveurs sains,
- les échecs de connexion/listing sont isolés par serveur,
- le cache d'outils et les mises à jour en arrière-plan fonctionnent au mieux (avertissements/erreurs journalisés, pas d'arrêt brutal).

## Sémantique de l'arrêt

### Arrêt au niveau du serveur

`disconnectServer(name)` :

- supprime les entrées en attente/métadonnées de source,
- ferme le transport si connecté,
- supprime les outils `mcp_` de ce serveur de l'état du gestionnaire.

### Arrêt global

`disconnectAll()` :

- ferme tous les transports actifs avec `Promise.allSettled`,
- vide les maps en attente, les sources, les connexions et la liste d'outils du gestionnaire.

Dans le câblage actuel, l'arrêt explicite est utilisé dans les flux de commandes MCP (pour rechargement/suppression/désactivation). Il n'y a pas de hook de disposition automatique du gestionnaire séparé dans le chemin de démarrage lui-même ; les appelants sont responsables d'invoquer les méthodes de déconnexion du gestionnaire lorsqu'ils ont besoin d'un arrêt MCP déterministe.

## Modes d'échec et garanties

| Scénario | Comportement | Échec critique vs au mieux |
| --- | --- | --- |
| La découverte lève une exception (chemin de chargement capacité/config) | Le chargeur retourne des outils vides + erreur synthétique `.mcp.json` | Démarrage de session au mieux |
| Configuration de serveur invalide | Serveur ignoré avec entrée d'erreur de validation | Au mieux par serveur |
| Délai de connexion dépassé/échec d'initialisation | Erreur du serveur enregistrée ; les autres continuent | Au mieux par serveur |
| `tools/list` encore en attente au démarrage avec cache disponible | Outils différés retournés immédiatement | Démarrage rapide au mieux |
| `tools/list` encore en attente au démarrage sans cache | Le démarrage attend la résolution des tâches en attente | Attente stricte pour la correction |
| Échec tardif du chargement d'outils en arrière-plan | Journalisé après la porte de démarrage | Journalisation au mieux |
| Transport interrompu à l'exécution | Pas de reconnexion automatique ; les appels futurs échouent jusqu'à reconnexion/rechargement | Récupération au mieux via action manuelle |

## Surface d'API publique

`src/mcp/index.ts` ré-exporte les API du chargeur/gestionnaire/client pour les appelants externes. `src/sdk.ts` expose `discoverMCPServers()` comme un wrapper de commodité retournant la même forme de résultat du chargeur.

## Fichiers d'implémentation

- [`src/mcp/loader.ts`](../../packages/coding-agent/src/mcp/loader.ts) — façade du chargeur, normalisation des erreurs de découverte, conversion en `LoadedCustomTool`.
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts) — registres d'état du cycle de vie, flux parallèle de connexion/listing, rafraîchissement/déconnexion.
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts) — configuration du transport, négociation d'initialisation, listing/appel/déconnexion.
- [`src/mcp/index.ts`](../../packages/coding-agent/src/mcp/index.ts) — exports de l'API du module MCP.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — câblage de démarrage dans la session/le registre d'outils.
- [`src/mcp/config.ts`](../../packages/coding-agent/src/mcp/config.ts) — découverte/filtrage/validation de la configuration utilisée par le gestionnaire.
- [`src/mcp/tool-bridge.ts`](../../packages/coding-agent/src/mcp/tool-bridge.ts) — comportement à l'exécution de `MCPTool` et `DeferredMCPTool`.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — reliage en direct `refreshMCPTools`.
- [`src/modes/controllers/mcp-command-controller.ts`](../../packages/coding-agent/src/modes/controllers/mcp-command-controller.ts) — flux interactifs de rechargement/reconnexion.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — proxy MCP de sous-agent via les connexions du gestionnaire parent.
