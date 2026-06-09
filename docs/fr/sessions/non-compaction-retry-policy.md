---
title: Politique de réessai automatique hors compaction
description: >-
  Politique de réessai automatique pour les échecs transitoires d'API en dehors
  du chemin de compaction.
sidebar:
  order: 6
  label: Politique de réessai
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# Politique de réessai automatique hors compaction

Ce document décrit le chemin standard de réessai en cas d'erreur API dans `AgentSession`.

Il exclut explicitement la récupération de dépassement de contexte via la compaction automatique. Le dépassement est géré par la logique de compaction et est documenté séparément dans [`compaction.md`](./compaction.md).

## Fichiers d'implémentation

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## Frontière de périmètre vs compaction

Le réessai et la compaction sont vérifiés depuis le même chemin `agent_end`, mais ils sont intentionnellement séparés :

1. `agent_end` inspecte le dernier message de l'assistant.
2. `#isRetryableError(...)` s'exécute en premier.
3. Si un réessai est initié, les vérifications de compaction sont ignorées pour ce tour.
4. Les erreurs de dépassement de contexte sont exclues de manière stricte de la classification de réessai (`isContextOverflow(...)` court-circuite le réessai).
5. Le dépassement est donc transmis à `#checkCompaction(...)` au lieu du réessai standard.

Ainsi : les échecs de type surcharge/limite de débit/serveur/réseau utilisent cette politique de réessai ; le dépassement de fenêtre de contexte utilise la récupération par compaction.

## Classification des réessais

`#isRetryableError(...)` requiert toutes les conditions suivantes :

- `stopReason === "error"` pour l'assistant
- `errorMessage` existe
- le message n'est **pas** un dépassement de contexte
- `errorMessage` correspond à `#isRetryableErrorMessage(...)`

Ensemble actuel de motifs réessayables (basé sur les expressions régulières) :

- overloaded
- rate limit / usage limit / too many requests
- classes serveur de type HTTP : 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- formulation `retry delay`

Il s'agit d'une classification par correspondance de motifs textuels, et non de codes d'erreur typés par fournisseur.

## Cycle de vie du réessai et transitions d'état

État de session utilisé par le réessai :

- `#retryAttempt: number` (`0` signifie inactif)
- `#retryPromise: Promise<void> | undefined` (suit le cycle de vie du réessai en cours)
- `#retryResolve: (() => void) | undefined` (résout `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (annule le délai d'attente du backoff)

Flux (`#handleRetryableError`) :

1. Lire le groupe de paramètres `retry`.
2. Si `retry.enabled === false`, arrêter immédiatement (`false`, aucun réessai initié).
3. Incrémenter `#retryAttempt`.
4. Créer `#retryPromise` une seule fois (première tentative d'une chaîne).
5. Si la tentative dépasse `retry.maxRetries`, émettre l'événement d'échec final et arrêter.
6. Calculer le délai : `retry.baseDelayMs * 2^(attempt-1)`.
7. Pour les erreurs de limite d'utilisation, analyser les indications de réessai et appeler le stockage d'authentification (`markUsageLimitReached(...)`) ; si le changement de fournisseur/modèle réussit, forcer le délai à `0`.
8. Émettre `auto_retry_start`.
9. Retirer le message d'erreur de l'assistant en fin de file de l'état d'exécution de l'agent (conservé dans l'historique de session persisté).
10. Mettre en veille avec support d'annulation.
11. Au réveil, planifier `agent.continue()` via `setTimeout(..., 0)`.

### Ce qui réinitialise les compteurs de réessai

`#retryAttempt` est réinitialisé à `0` dans les cas suivants :

- premier message réussi de l'assistant (ni erreur, ni annulé) après le début des réessais (émet `auto_retry_end { success: true }`)
- annulation du réessai pendant le délai d'attente du backoff
- chemin de dépassement du nombre maximal de réessais

`#retryPromise` est résolu/effacé lorsque la chaîne de réessais se termine (succès, annulation ou dépassement du maximum), via `#resolveRetry()`.

## Sémantique du backoff et du nombre maximal de tentatives

Paramètres :

- `retry.enabled` (par défaut `true`)
- `retry.maxRetries` (par défaut `3`)
- `retry.baseDelayMs` (par défaut `2000`)

Numérotation des tentatives :

- le compteur de tentatives est incrémenté avant la vérification du maximum
- les événements de démarrage utilisent la tentative courante (indexée à 1)
- l'événement de fin en cas de dépassement du maximum rapporte `attempt: this.#retryAttempt - 1` (nombre de la dernière tentative de réessai)

Séquence de backoff avec les paramètres par défaut :

- tentative 1 : 2000 ms
- tentative 2 : 4000 ms
- tentative 3 : 8000 ms

Les entrées de remplacement de délai ne sont utilisées que dans le chemin de gestion des limites d'utilisation, et uniquement pour influencer la décision de changement de modèle/compte du stockage d'authentification. Dans le chemin principal de réessai hors compaction, le backoff reste un délai exponentiel local, sauf si le changement réussit (`delayMs = 0`).

## Mécanismes d'annulation

### Annulation explicite du réessai

`abortRetry()` :

- annule `#retryAbortController` (si présent)
- résout la promesse de réessai (`#resolveRetry()`) pour débloquer les appelants en attente

Si l'annulation intervient pendant le délai d'attente, le chemin de capture émet :

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- réinitialise la tentative/le contrôleur

### Interaction avec l'annulation globale d'opération

`abort()` appelle `abortRetry()` avant d'annuler le flux actif de l'agent. Cela garantit que le backoff de réessai est annulé lorsque l'utilisateur effectue une annulation générale.

### Interaction avec le TUI

À `auto_retry_start`, EventController :

- remplace le gestionnaire `Esc` par `session.abortRetry()`
- affiche le texte du chargeur : `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

À `auto_retry_end`, il restaure le gestionnaire `Esc` précédent et efface l'état du chargeur.

## Comportement du streaming et de l'achèvement des prompts

`prompt()` attend finalement `#waitForRetry()` après le retour de `agent.prompt(...)`.

Effet :

- un appel de prompt ne se résout pas complètement tant qu'une chaîne de réessais en cours n'est pas terminée (succès/échec/annulation)
- le cycle de vie du réessai fait partie d'une frontière logique d'exécution de prompt

Cela empêche les appelants de considérer un tour en cours de réessai comme terminé prématurément.

## Contrôles : paramètres et RPC

### Options de configuration

Définies dans le schéma de paramètres sous le groupe retry :

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

Bascules programmatiques dans la session :

- `setAutoRetryEnabled(enabled)` écrit `retry.enabled`
- `autoRetryEnabled` lit `retry.enabled`
- `isRetrying` indique si la promesse du cycle de vie de réessai est active

### Contrôles RPC

Surface de commandes RPC :

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

Méthodes utilitaires du client :

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

Les deux commandes retournent des réponses de succès ; les détails de progression/échec du réessai proviennent des événements de session diffusés en continu, et non des charges utiles de réponse aux commandes.

## Émission d'événements et remontée des échecs

Événements de réessai au niveau de la session :

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Propagation :

- émis via `AgentSession.subscribe(...)`
- transmis au runner d'extension en tant qu'événements d'extension
- en mode RPC, transmis directement en tant qu'objets d'événement JSON (`session.subscribe(event => output(event))`)
- dans le TUI, consommés par `EventController` pour l'interface chargeur/erreur

Remontée de l'échec final :

- En cas de dépassement du maximum ou d'annulation, `auto_retry_end.success === false`
- Le TUI affiche : `Retry failed after N attempts: <finalError>`
- Les extensions/hooks reçoivent `auto_retry_end` avec les mêmes champs
- Les consommateurs RPC reçoivent le même objet d'événement sur le flux stdout

## Conditions d'arrêt permanent

Le réessai s'arrête et ne reprendra pas automatiquement lorsque l'une de ces conditions survient :

- `retry.enabled` est false
- l'erreur n'est pas classifiée comme réessayable
- l'erreur est un dépassement de contexte (délégué au chemin de compaction)
- nombre maximal de réessais dépassé
- l'utilisateur annule le réessai (`abort_retry` ou `Esc` pendant le chargeur de réessai)
- l'annulation globale (`abort`) annule d'abord le réessai

Une nouvelle chaîne de réessais peut tout de même démarrer ultérieurement lors d'une future erreur réessayable après la réinitialisation des compteurs.

## Avertissements opérationnels

- La classification repose sur la correspondance textuelle par expressions régulières ; les erreurs structurées spécifiques aux fournisseurs ne sont pas utilisées ici.
- Le réessai supprime l'erreur de l'assistant en échec du **contexte d'exécution** avant de relancer, mais l'historique de session conserve toujours cette entrée d'erreur.
- `RpcSessionState` expose actuellement `autoCompactionEnabled` mais pas de champ `autoRetryEnabled` ; les appelants RPC doivent suivre leur propre état de bascule ou interroger les paramètres via d'autres API.
