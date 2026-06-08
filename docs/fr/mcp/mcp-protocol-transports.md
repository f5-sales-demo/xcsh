---
title: MCP Protocol and Transport Internals
description: >-
  MCP protocol implementation with stdio, SSE, and streamable HTTP transport
  layers.
sidebar:
  order: 2
  label: Protocole & transports
i18n:
  sourceHash: 48632064dd00
  translator: machine
---

# Fonctionnement interne du protocole MCP et des transports

Ce document décrit comment coding-agent implémente la messagerie JSON-RPC MCP et comment les préoccupations protocolaires sont séparées des préoccupations de transport.

## Périmètre

Couvre :

- Le flux de requêtes/réponses et de notifications JSON-RPC
- La corrélation des requêtes et leur cycle de vie pour les transports stdio et HTTP/SSE
- Le comportement des timeouts et de l'annulation
- La propagation des erreurs et le traitement des payloads malformés
- Les limites de sélection des transports (`stdio` vs `http`/`sse`)
- Les responsabilités de reconnexion/retry qui relèvent du transport vs celles qui relèvent du gestionnaire

Ne couvre pas la création d'extensions (UX) ni l'interface utilisateur des commandes.

## Fichiers d'implémentation

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/transports/stdio.ts`](../../packages/coding-agent/src/mcp/transports/stdio.ts)
- [`src/mcp/transports/http.ts`](../../packages/coding-agent/src/mcp/transports/http.ts)
- [`src/mcp/transports/index.ts`](../../packages/coding-agent/src/mcp/transports/index.ts)
- [`src/mcp/json-rpc.ts`](../../packages/coding-agent/src/mcp/json-rpc.ts)
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)

## Limites entre couches

### Couche protocole (JSON-RPC + méthodes MCP)

- Les formes de messages sont définies dans `types.ts` (`JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcResponse`, `JsonRpcMessage`).
- La logique du client MCP (`client.ts`) détermine l'ordre des méthodes et le handshake de session :
  1. Requête `initialize`
  2. Notification `notifications/initialized`
  3. Appels de méthodes comme `tools/list`, `tools/call`

### Couche transport (`MCPTransport`)

`MCPTransport` abstrait la livraison et le cycle de vie :

- `request(method, params, options?) -> Promise<T>`
- `notify(method, params?) -> Promise<void>`
- `close()`
- `connected`
- Callbacks optionnels : `onClose`, `onError`, `onNotification`

Les implémentations de transport gèrent le cadrage et les détails d'E/S :

- `StdioTransport` : JSON délimité par des retours à la ligne via stdio de sous-processus
- `HttpTransport` : JSON-RPC via HTTP POST, avec réponses/écoute SSE optionnelles

### Avertissement important actuel

Les callbacks de transport (`onClose`, `onError`, `onNotification`) sont implémentés, mais les flux actuels de `MCPClient`/`MCPManager` ne connectent pas la logique de reconnexion à ces callbacks. Les notifications ne sont consommées que si l'appelant enregistre des gestionnaires.

## Sélection du transport

`client.ts:createTransport()` choisit le transport à partir de la configuration :

- `type` omis ou `"stdio"` -> `createStdioTransport`
- `"http"` ou `"sse"` -> `createHttpTransport`

`"sse"` est traité comme une variante du transport HTTP (même classe), et non comme une implémentation de transport distincte.

## Flux de messages JSON-RPC et corrélation

## Identifiants de requête

Chaque transport génère des identifiants par requête (chaîne `Math.random` + timestamp). Les identifiants sont des jetons de corrélation locaux au transport.

## Chemin de corrélation stdio

- La requête sortante est sérialisée en un objet JSON unique + `\n`.
- `#pendingRequests: Map<id, {resolve,reject}>` stocke les requêtes en cours.
- La boucle de lecture analyse le JSONL depuis stdout et appelle `#handleMessage`.
- Si le message entrant a un `id` correspondant, la requête est résolue/rejetée.
- Si le message entrant a une `method` et pas d'`id`, il est traité comme une notification et envoyé à `onNotification`.

Les identifiants inconnus sont ignorés (pas de rejet, pas de callback d'erreur).

## Chemin de corrélation HTTP

- La requête sortante est un `POST` HTTP avec un corps JSON et un `id` généré.
- Chemin de réponse non-SSE : analyse d'une seule réponse JSON-RPC et retourne `result`/lance une exception sur `error`.
- Chemin de réponse SSE (`Content-Type: text/event-stream`) : flux d'événements, retourne le premier message dont l'`id` correspond à l'identifiant de requête attendu et qui a un `result` ou une `error`.
- Les messages SSE avec `method` et sans `id` sont traités comme des notifications.

Si le flux SSE se termine avant la réponse correspondante, la requête échoue avec `No response received for request ID ...`.

## Notifications

Le client émet des notifications JSON-RPC via `transport.notify(...)`.

- Stdio : écrit la trame de notification sur stdin (`jsonrpc`, `method`, `params` optionnel) suivi d'un retour à la ligne.
- HTTP : envoie un corps POST sans `id` ; le succès accepte `2xx` ou `202 Accepted`.

Les notifications initiées par le serveur ne sont exposées que via le `onNotification` du transport ; il n'y a pas d'abonné global par défaut dans le gestionnaire/client.

## Fonctionnement interne du transport stdio

## Cycle de vie et transitions d'état

- Initial : `connected=false`, `process=null`, map des requêtes en attente vide
- `connect()` :
  - lance le sous-processus avec la commande/les arguments/l'environnement/le répertoire de travail configurés
  - marque comme connecté
  - démarre la boucle de lecture stdout (`readJsonl`)
  - démarre la boucle stderr (lecture/rejet ; actuellement silencieuse)
- `close()` :
  - marque comme déconnecté
  - rejette toutes les requêtes en attente (`Transport closed`)
  - tue le sous-processus
  - attend l'arrêt de la boucle de lecture
  - émet `onClose`

Si la boucle de lecture se termine de manière inattendue, le `finally` déclenche `#handleClose()` qui effectue le même rejet des requêtes en attente et le callback de fermeture.

## Timeout et annulation

Par requête :

- le timeout par défaut est `config.timeout ?? 30000`
- `AbortSignal` optionnel de l'appelant
- l'interruption et le timeout rejettent tous deux la promesse en attente et nettoient l'entrée de la map

L'annulation est uniquement locale : le transport n'envoie pas de notification d'annulation au niveau protocole vers le serveur.

## Traitement des payloads malformés

Dans la boucle de lecture :

- chaque ligne JSONL analysée est passée à `#handleMessage` dans un `try/catch`
- les exceptions de traitement de messages malformés/invalides sont ignorées (commentaire `Skip malformed lines`)
- la boucle continue, ainsi un message erroné ne tue pas la connexion

Si le parseur de flux sous-jacent lance une exception, `onError` est invoqué (quand toujours connecté), puis la connexion se ferme.

## Comportement en cas de déconnexion/défaillance

Quand le processus se termine ou que le flux se ferme :

- toutes les requêtes en cours sont rejetées avec `Transport closed`
- pas de redémarrage ou reconnexion automatique
- les couches supérieures doivent se reconnecter en créant un nouveau transport

## Notes sur la contre-pression/le streaming

- Les écritures sortantes utilisent `stdin.write()` + `flush()` sans attendre la sémantique de drain.
- Il n'y a pas de file d'attente explicite ni de gestion de high-watermark dans le transport.
- Le traitement entrant est piloté par le flux (`for await` sur `readJsonl`), un message analysé à la fois.

## Fonctionnement interne du transport HTTP/SSE

## Cycle de vie et sémantique de connexion

Le transport HTTP a un état de connexion logique, mais le chemin de requête est sans état par appel HTTP :

- `connect()` définit `connected=true` (pas de handshake socket/session)
- suivi optionnel de session serveur via l'en-tête `Mcp-Session-Id`
- `close()` envoie optionnellement un `DELETE` avec `Mcp-Session-Id`, interrompt l'écouteur SSE, émet `onClose`

Ainsi, `connected` signifie « transport utilisable », et non « flux persistant établi ».

## Comportement de l'en-tête de session

- Sur la réponse POST, si l'en-tête `Mcp-Session-Id` est présent, le transport le stocke.
- Les requêtes/notifications suivantes incluent `Mcp-Session-Id`.
- `close()` tente de terminer la session serveur avec un HTTP DELETE ; les échecs de terminaison sont ignorés.

## Timeout et annulation

Pour `request()` et `notify()` :

- le timeout utilise `AbortController` (`config.timeout ?? 30000`)
- le signal externe, s'il est fourni, est fusionné via `AbortSignal.any([...])`
- le traitement d'AbortError distingue l'interruption de l'appelant du timeout

Erreurs lancées :

- timeout : `Request timeout after ...ms` (ou `SSE response timeout ...`, `Notify timeout ...`)
- interruption de l'appelant : l'AbortError original est relancé quand le signal externe est déjà interrompu

## Propagation des erreurs HTTP

Sur une réponse non-OK :

- le texte de la réponse est inclus dans l'erreur lancée (`HTTP <status>: <text>`)
- si présents, les indices d'authentification de `WWW-Authenticate` et `Mcp-Auth-Server` sont ajoutés

Sur un objet d'erreur JSON-RPC :

- lance `MCP error <code>: <message>`

Un corps JSON malformé (échec de `response.json()`) se propage comme exception d'analyse.

## Comportement SSE et modes

Deux chemins SSE existent :

1. **Réponse SSE par requête** (`#parseSSEResponse`)
   - utilisé quand le type de contenu de la réponse POST est `text/event-stream`
   - consomme le flux jusqu'à trouver l'identifiant de réponse correspondant
   - peut traiter les notifications entrelacées pendant le même flux

2. **Écouteur SSE en arrière-plan** (`startSSEListener()`)
   - écouteur GET optionnel pour les notifications initiées par le serveur
   - actuellement non démarré automatiquement par le gestionnaire/client MCP
   - si le GET retourne `405`, l'écouteur se désactive silencieusement (le serveur ne supporte pas ce mode)

## Traitement des payloads malformés et gestion de la déconnexion

Les erreurs d'analyse JSON SSE remontent depuis `readSseJson` et rejettent la requête/l'écouteur.

- Les erreurs d'analyse SSE de requête rejettent la requête active.
- Les erreurs de l'écouteur en arrière-plan déclenchent `onError` (sauf AbortError).
- Pas de reconnexion automatique pour l'écouteur en arrière-plan.

## Utilitaire `json-rpc.ts` vs abstraction de transport

`src/mcp/json-rpc.ts` fournit les helpers `callMCP()` et `parseSSE()` pour les appels HTTP MCP directs (utilisés par l'intégration Exa), et non l'abstraction `MCPTransport` utilisée par `MCPClient`/`MCPManager`.

Différences notables par rapport à `HttpTransport` :

- analyse d'abord le texte de réponse complet, puis extrait la première ligne `data:` (`parseSSE`), avec fallback JSON
- pas de gestion de timeout de requête, pas d'API d'interruption, pas de gestion de session-id, pas de cycle de vie de transport
- retourne l'enveloppe JSON-RPC brute

Ce chemin est léger mais moins robuste que l'implémentation complète du transport.

## Responsabilités de retry/reconnexion

## Niveau transport

Les implémentations de transport actuelles ne font **pas** :

- de retry des requêtes échouées
- de reconnexion après la fin du processus stdio
- de reconnexion des écouteurs SSE
- de renvoi des requêtes en cours après une déconnexion

Elles échouent rapidement et propagent les erreurs.

## Niveau gestionnaire/client

`MCPManager` gère l'orchestration de la découverte/connexion initiale et ne peut se reconnecter qu'en relançant les flux de connexion (chemins `connectToServer`/`discoverAndConnect`). Il ne répare pas automatiquement un transport déjà connecté en cas de défaillance via les callbacks d'erreur à l'exécution.

`MCPManager` possède un comportement de secours au démarrage pour les serveurs lents (outils différés depuis le cache), mais il s'agit d'un secours pour la disponibilité des outils, pas d'un retry de transport.

## Résumé des scénarios de défaillance

- **Ligne de message stdio malformée** : ignorée ; le flux continue.
- **Fin du flux/processus stdio** : le transport se ferme ; les requêtes en attente sont rejetées avec `Transport closed`.
- **HTTP non-2xx** : la requête/notification lance une erreur HTTP.
- **Réponse JSON invalide** : exception d'analyse propagée.
- **SSE se termine sans identifiant correspondant** : la requête échoue avec `No response received for request ID ...`.
- **Timeout** : erreur de timeout spécifique au transport.
- **Interruption de l'appelant** : AbortError/raison propagé depuis le signal de l'appelant.

## Règle pratique de délimitation

Si la préoccupation concerne la forme des messages, la corrélation des identifiants ou l'ordonnancement des méthodes MCP, elle relève de la logique protocole/client.

Si la préoccupation concerne le cadrage (JSONL vs HTTP/SSE), l'analyse de flux, le cycle de vie fetch/spawn, les horloges de timeout ou le démontage de connexion, elle relève de l'implémentation du transport.
