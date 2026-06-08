---
title: Protocole MCP et mécanismes internes de transport
description: >-
  Implémentation du protocole MCP avec les couches de transport stdio, SSE et
  HTTP streamable.
sidebar:
  order: 2
  label: Protocole & transports
i18n:
  sourceHash: 48632064dd00
  translator: machine
---

# Protocole MCP et mécanismes internes de transport

Ce document décrit comment coding-agent implémente la messagerie MCP JSON-RPC et comment les préoccupations protocolaires sont séparées des préoccupations de transport.

## Périmètre

Couvre :

- Le flux requête/réponse et notification JSON-RPC
- La corrélation des requêtes et le cycle de vie pour les transports stdio et HTTP/SSE
- Le comportement du timeout et de l'annulation
- La propagation des erreurs et la gestion des payloads malformés
- Les frontières de sélection du transport (`stdio` vs `http`/`sse`)
- Quelles responsabilités de reconnexion/réessai relèvent du niveau transport vs du niveau manager

Ne couvre pas l'expérience utilisateur d'écriture d'extensions ni l'interface de commande.

## Fichiers d'implémentation

- [`src/mcp/types.ts`](../../packages/coding-agent/src/mcp/types.ts)
- [`src/mcp/transports/stdio.ts`](../../packages/coding-agent/src/mcp/transports/stdio.ts)
- [`src/mcp/transports/http.ts`](../../packages/coding-agent/src/mcp/transports/http.ts)
- [`src/mcp/transports/index.ts`](../../packages/coding-agent/src/mcp/transports/index.ts)
- [`src/mcp/json-rpc.ts`](../../packages/coding-agent/src/mcp/json-rpc.ts)
- [`src/mcp/client.ts`](../../packages/coding-agent/src/mcp/client.ts)
- [`src/mcp/manager.ts`](../../packages/coding-agent/src/mcp/manager.ts)

## Frontières des couches

### Couche protocole (JSON-RPC + méthodes MCP)

- Les formes de messages sont définies dans `types.ts` (`JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcResponse`, `JsonRpcMessage`).
- La logique client MCP (`client.ts`) détermine l'ordre des méthodes et le handshake de session :
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

- `StdioTransport` : JSON délimité par des sauts de ligne via stdio de sous-processus
- `HttpTransport` : JSON-RPC via HTTP POST, avec réponses/écoute SSE optionnelles

### Avertissement important actuel

Les callbacks de transport (`onClose`, `onError`, `onNotification`) sont implémentés, mais les flux actuels de `MCPClient`/`MCPManager` ne connectent pas de logique de reconnexion à ces callbacks. Les notifications ne sont consommées que si l'appelant enregistre des gestionnaires.

## Sélection du transport

`client.ts:createTransport()` choisit le transport à partir de la configuration :

- `type` omis ou `"stdio"` -> `createStdioTransport`
- `"http"` ou `"sse"` -> `createHttpTransport`

`"sse"` est traité comme une variante du transport HTTP (même classe), pas comme une implémentation de transport séparée.

## Flux de messages JSON-RPC et corrélation

## Identifiants de requête

Chaque transport génère des identifiants par requête (chaîne `Math.random` + timestamp). Les identifiants sont des jetons de corrélation locaux au transport.

## Chemin de corrélation stdio

- La requête sortante est sérialisée en un objet JSON + `\n`.
- `#pendingRequests: Map<id, {resolve,reject}>` stocke les requêtes en cours.
- La boucle de lecture parse le JSONL depuis stdout et appelle `#handleMessage`.
- Si le message entrant a un `id` correspondant, la requête est résolue/rejetée.
- Si le message entrant a une `method` et pas d'`id`, il est traité comme une notification et envoyé à `onNotification`.

Les identifiants inconnus sont ignorés (pas de rejet, pas de callback d'erreur).

## Chemin de corrélation HTTP

- La requête sortante est un `POST` HTTP avec un corps JSON et un `id` généré.
- Chemin de réponse non-SSE : parse une réponse JSON-RPC unique et retourne `result`/lance une exception sur `error`.
- Chemin de réponse SSE (`Content-Type: text/event-stream`) : diffuse les événements en streaming, retourne le premier message dont l'`id` correspond à l'identifiant de requête attendu et contient `result` ou `error`.
- Les messages SSE avec `method` et sans `id` sont traités comme des notifications.

Si le flux SSE se termine avant la réponse correspondante, la requête échoue avec `No response received for request ID ...`.

## Notifications

Le client émet des notifications JSON-RPC via `transport.notify(...)`.

- Stdio : écrit la trame de notification sur stdin (`jsonrpc`, `method`, `params` optionnel) plus un saut de ligne.
- HTTP : envoie un corps POST sans `id` ; le succès accepte `2xx` ou `202 Accepted`.

Les notifications initiées par le serveur ne sont exposées que via le `onNotification` du transport ; il n'y a pas d'abonné global par défaut dans le manager/client.

## Mécanismes internes du transport stdio

## Cycle de vie et transitions d'état

- Initial : `connected=false`, `process=null`, map des requêtes en attente vide
- `connect()` :
  - lance le sous-processus avec la commande/les arguments/l'environnement/le répertoire de travail configurés
  - marque comme connecté
  - démarre la boucle de lecture stdout (`readJsonl`)
  - démarre la boucle stderr (lecture/suppression ; actuellement silencieuse)
- `close()` :
  - marque comme déconnecté
  - rejette toutes les requêtes en attente (`Transport closed`)
  - tue le sous-processus
  - attend l'arrêt de la boucle de lecture
  - émet `onClose`

Si la boucle de lecture se termine de manière inattendue, `finally` déclenche `#handleClose()` qui effectue le même rejet des requêtes en attente et le callback de fermeture.

## Timeout et annulation

Par requête :

- le timeout par défaut est `config.timeout ?? 30000`
- `AbortSignal` optionnel de l'appelant
- l'abandon et le timeout rejettent tous deux la promesse en attente et nettoient l'entrée de la map

L'annulation est uniquement locale : le transport n'envoie pas de notification d'annulation au niveau protocole au serveur.

## Gestion des payloads malformés

Dans la boucle de lecture :

- chaque ligne JSONL parsée est passée à `#handleMessage` dans un `try/catch`
- les exceptions de gestion de messages malformés/invalides sont ignorées (commentaire `Skip malformed lines`)
- la boucle continue, donc un message défectueux ne tue pas la connexion

Si le parseur du flux sous-jacent lance une exception, `onError` est invoqué (quand encore connecté), puis la connexion se ferme.

## Comportement de déconnexion/échec

Quand le processus se termine ou que le flux se ferme :

- toutes les requêtes en cours sont rejetées avec `Transport closed`
- pas de redémarrage ou reconnexion automatique
- les couches supérieures doivent se reconnecter en créant un nouveau transport

## Notes sur la contrepression/le streaming

- Les écritures sortantes utilisent `stdin.write()` + `flush()` sans attendre la sémantique de vidange.
- Il n'y a pas de gestion explicite de file d'attente ou de seuil haut dans le transport.
- Le traitement entrant est piloté par le flux (`for await` sur `readJsonl`), un message parsé à la fois.

## Mécanismes internes du transport HTTP/SSE

## Cycle de vie et sémantique de connexion

Le transport HTTP a un état de connexion logique, mais le chemin de requête est sans état par appel HTTP :

- `connect()` met `connected=true` (pas de handshake socket/session)
- suivi optionnel de session serveur via l'en-tête `Mcp-Session-Id`
- `close()` envoie optionnellement un `DELETE` avec `Mcp-Session-Id`, abandonne l'écouteur SSE, émet `onClose`

Donc `connected` signifie « transport utilisable », pas « flux persistant établi ».

## Comportement de l'en-tête de session

- À la réponse POST, si l'en-tête `Mcp-Session-Id` est présent, le transport le stocke.
- Les requêtes/notifications suivantes incluent `Mcp-Session-Id`.
- `close()` tente de terminer la session serveur avec un HTTP DELETE ; les échecs de terminaison sont ignorés.

## Timeout et annulation

Pour `request()` et `notify()` :

- le timeout utilise `AbortController` (`config.timeout ?? 30000`)
- le signal externe, s'il est fourni, est fusionné via `AbortSignal.any([...])`
- la gestion de l'AbortError distingue l'abandon par l'appelant du timeout

Erreurs lancées :

- timeout : `Request timeout after ...ms` (ou `SSE response timeout ...`, `Notify timeout ...`)
- abandon par l'appelant : l'AbortError original est relancée quand le signal externe est déjà abandonné

## Propagation des erreurs HTTP

Sur une réponse non-OK :

- le texte de la réponse est inclus dans l'erreur lancée (`HTTP <status>: <text>`)
- si présents, les indices d'authentification de `WWW-Authenticate` et `Mcp-Auth-Server` sont ajoutés

Sur un objet erreur JSON-RPC :

- lance `MCP error <code>: <message>`

L'échec de parsing du corps JSON (`response.json()`) se propage comme une exception de parsing.

## Comportement SSE et modes

Deux chemins SSE existent :

1. **Réponse SSE par requête** (`#parseSSEResponse`)
   - utilisé quand le type de contenu de la réponse POST est `text/event-stream`
   - consomme le flux jusqu'à ce que l'identifiant de réponse correspondant soit trouvé
   - peut traiter des notifications entrelacées pendant le même flux

2. **Écouteur SSE en arrière-plan** (`startSSEListener()`)
   - écouteur GET optionnel pour les notifications initiées par le serveur
   - actuellement non démarré automatiquement par le manager/client MCP
   - si le GET retourne `405`, l'écouteur se désactive silencieusement (le serveur ne supporte pas ce mode)

## Gestion des payloads malformés et des déconnexions

Les erreurs de parsing JSON SSE remontent depuis `readSseJson` et rejettent la requête/l'écouteur.

- Les erreurs de parsing SSE de requête rejettent la requête active.
- Les erreurs de l'écouteur en arrière-plan déclenchent `onError` (sauf AbortError).
- Pas de reconnexion automatique pour l'écouteur en arrière-plan.

## Utilitaire `json-rpc.ts` vs abstraction de transport

`src/mcp/json-rpc.ts` fournit les helpers `callMCP()` et `parseSSE()` pour les appels MCP HTTP directs (utilisés par l'intégration Exa), pas l'abstraction `MCPTransport` utilisée par `MCPClient`/`MCPManager`.

Différences notables par rapport à `HttpTransport` :

- parse d'abord le texte complet de la réponse, puis extrait la première ligne `data:` (`parseSSE`), avec fallback JSON
- pas de gestion de timeout de requête, pas d'API d'abandon, pas de gestion de session-id, pas de cycle de vie de transport
- retourne l'objet enveloppe JSON-RPC brut

Ce chemin est léger mais moins robuste que l'implémentation complète du transport.

## Responsabilités de réessai/reconnexion

## Niveau transport

Les implémentations de transport actuelles ne font **pas** :

- réessayer les requêtes échouées
- se reconnecter après la fin du processus stdio
- reconnecter les écouteurs SSE
- renvoyer les requêtes en cours après une déconnexion

Elles échouent rapidement et propagent les erreurs.

## Niveau manager/client

`MCPManager` gère l'orchestration de découverte/connexion initiale et ne peut se reconnecter qu'en relançant les flux de connexion (chemins `connectToServer`/`discoverAndConnect`). Il ne répare pas automatiquement un transport déjà connecté lors de callbacks d'échec à l'exécution.

`MCPManager` dispose d'un comportement de repli au démarrage pour les serveurs lents (outils différés depuis le cache), mais il s'agit d'un repli de disponibilité d'outils, pas d'un réessai de transport.

## Résumé des scénarios d'échec

- **Ligne de message stdio malformée** : ignorée ; le flux continue.
- **Fin du flux/processus stdio** : le transport se ferme ; les requêtes en attente sont rejetées avec `Transport closed`.
- **HTTP non-2xx** : la requête/notification lance une erreur HTTP.
- **Réponse JSON invalide** : exception de parsing propagée.
- **SSE se termine sans identifiant correspondant** : la requête échoue avec `No response received for request ID ...`.
- **Timeout** : erreur de timeout spécifique au transport.
- **Abandon par l'appelant** : AbortError/raison propagée depuis le signal de l'appelant.

## Règle pratique de frontière

Si la préoccupation concerne la forme du message, la corrélation d'identifiants ou l'ordonnancement des méthodes MCP, elle appartient à la logique protocole/client.

Si la préoccupation concerne le cadrage (JSONL vs HTTP/SSE), le parsing de flux, le cycle de vie fetch/spawn, les horloges de timeout ou le démontage de connexion, elle appartient à l'implémentation du transport.
