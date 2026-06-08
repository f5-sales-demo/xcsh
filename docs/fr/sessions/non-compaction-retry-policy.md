---
title: Non-Compaction Auto-Retry Policy
description: >-
  Politique de nouvelle tentative automatique pour les défaillances transitoires
  de l'API en dehors du chemin de compaction.
sidebar:
  order: 6
  label: Retry policy
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# Politique de nouvelle tentative automatique hors compaction

Ce document décrit le chemin standard de nouvelle tentative en cas d'erreur API dans `AgentSession`.

Il exclut explicitement la récupération de dépassement de contexte via l'auto-compaction. Le dépassement est géré par la logique de compaction et est documenté séparément dans [`compaction.md`](./compaction.md).

## Fichiers d'implémentation

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## Frontière de périmètre vs compaction

La nouvelle tentative et la compaction sont vérifiées depuis le même chemin `agent_end`, mais elles sont intentionnellement séparées :

1. `agent_end` inspecte le dernier message de l'assistant.
2. `#isRetryableError(...)` s'exécute en premier.
3. Si une nouvelle tentative est initiée, les vérifications de compaction sont ignorées pour ce tour.
4. Les erreurs de dépassement de contexte sont explicitement exclues de la classification de nouvelle tentative (`isContextOverflow(...)` court-circuite la nouvelle tentative).
5. Le dépassement passe donc à `#checkCompaction(...)` au lieu de la nouvelle tentative standard.

En résumé : les défaillances de type surcharge/limitation de débit/serveur/réseau utilisent cette politique de nouvelle tentative ; le dépassement de fenêtre de contexte utilise la récupération par compaction.

## Classification des nouvelles tentatives

`#isRetryableError(...)` requiert toutes les conditions suivantes :

- `stopReason === "error"` pour l'assistant
- `errorMessage` existe
- le message n'est **pas** un dépassement de contexte
- `errorMessage` correspond à `#isRetryableErrorMessage(...)`

Ensemble actuel de motifs éligibles à la nouvelle tentative (basé sur les regex) :

- overloaded
- rate limit / usage limit / too many requests
- classes serveur de type HTTP : 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- formulation `retry delay`

Il s'agit d'une classification par correspondance de chaînes de caractères, pas de codes d'erreur typés par fournisseur.

## Cycle de vie des nouvelles tentatives et transitions d'état

État de session utilisé par la nouvelle tentative :

- `#retryAttempt: number` (`0` signifie inactif)
- `#retryPromise: Promise<void> | undefined` (suit le cycle de vie de la nouvelle tentative en cours)
- `#retryResolve: (() => void) | undefined` (résout `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (annule le délai d'attente avec backoff)

Flux (`#handleRetryableError`) :

1. Lire le groupe de paramètres `retry`.
2. Si `retry.enabled === false`, arrêter immédiatement (`false`, aucune nouvelle tentative démarrée).
3. Incrémenter `#retryAttempt`.
4. Créer `#retryPromise` une seule fois (première tentative dans une chaîne).
5. Si la tentative dépasse `retry.maxRetries`, émettre l'événement d'échec final et arrêter.
6. Calculer le délai : `retry.baseDelayMs * 2^(attempt-1)`.
7. Pour les erreurs de limite d'utilisation, analyser les indications de nouvelle tentative et appeler le stockage d'authentification (`markUsageLimitReached(...)`) ; si le changement de fournisseur/modèle réussit, forcer le délai à `0`.
8. Émettre `auto_retry_start`.
9. Supprimer le message d'erreur de l'assistant en fin de file de l'état d'exécution de l'agent (conservé dans l'historique de session persisté).
10. Mise en veille avec support d'annulation.
11. Au réveil, planifier `agent.continue()` via `setTimeout(..., 0)`.

### Ce qui réinitialise les compteurs de nouvelles tentatives

`#retryAttempt` est réinitialisé à `0` dans les cas suivants :

- premier message réussi de l'assistant sans erreur et non annulé après le début des nouvelles tentatives (émet `auto_retry_end { success: true }`)
- annulation de la nouvelle tentative pendant le délai d'attente avec backoff
- chemin de dépassement du nombre maximal de tentatives

`#retryPromise` est résolu/effacé lorsque la chaîne de nouvelles tentatives se termine (succès, annulation ou dépassement du maximum), via `#resolveRetry()`.

## Sémantique du backoff et du nombre maximal de tentatives

Paramètres :

- `retry.enabled` (par défaut `true`)
- `retry.maxRetries` (par défaut `3`)
- `retry.baseDelayMs` (par défaut `2000`)

Numérotation des tentatives :

- le compteur de tentatives est incrémenté avant la vérification du maximum
- les événements de démarrage utilisent la tentative courante (indexée à partir de 1)
- l'événement de fin pour dépassement du maximum rapporte `attempt: this.#retryAttempt - 1` (nombre de la dernière tentative effectuée)

Séquence de backoff avec les paramètres par défaut :

- tentative 1 : 2000 ms
- tentative 2 : 4000 ms
- tentative 3 : 8000 ms

Les entrées de substitution de délai ne sont utilisées que dans le chemin de gestion des limites d'utilisation, et uniquement pour influencer la décision de changement de modèle/compte du stockage d'authentification. Dans le chemin principal de nouvelle tentative hors compaction, le backoff reste un délai exponentiel local sauf si le changement réussit (`delayMs = 0`).

## Mécanismes d'annulation

### Annulation explicite de la nouvelle tentative

`abortRetry()` :

- annule `#retryAbortController` (s'il est présent)
- résout la promesse de nouvelle tentative (`#resolveRetry()`) afin que les consommateurs en attente soient débloqués

Si l'annulation intervient pendant le délai d'attente, le chemin de capture émet :

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- réinitialise la tentative/le contrôleur

### Interaction avec l'annulation globale de l'opération

`abort()` appelle `abortRetry()` avant d'annuler le flux actif de l'agent. Cela garantit que le backoff de nouvelle tentative est annulé lorsque l'utilisateur émet une annulation générale.

### Interaction avec le TUI

Sur `auto_retry_start`, EventController :

- remplace le gestionnaire `Esc` par `session.abortRetry()`
- affiche le texte du loader : `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

Sur `auto_retry_end`, il restaure le gestionnaire `Esc` précédent et efface l'état du loader.

## Comportement du streaming et de l'achèvement du prompt

`prompt()` attend finalement `#waitForRetry()` après le retour de `agent.prompt(...)`.

Effet :

- un appel prompt ne se résout pas complètement tant qu'une chaîne de nouvelles tentatives démarrée n'est pas terminée (succès/échec/annulation)
- le cycle de vie de la nouvelle tentative fait partie d'une frontière logique d'exécution d'un prompt unique

Cela empêche les appelants de considérer un tour en cours de nouvelle tentative comme terminé prématurément.

## Contrôles : paramètres et RPC

### Options de configuration

Définies dans le schéma de paramètres sous le groupe retry :

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

Bascules programmatiques dans la session :

- `setAutoRetryEnabled(enabled)` écrit `retry.enabled`
- `autoRetryEnabled` lit `retry.enabled`
- `isRetrying` indique si la promesse du cycle de vie de nouvelle tentative est active

### Contrôles RPC

Surface de commandes RPC :

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

Helpers client :

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

Les deux commandes retournent des réponses de succès ; les détails de progression/échec des nouvelles tentatives proviennent des événements de session en flux continu, pas des payloads de réponse aux commandes.

## Émission d'événements et remontée des échecs

Événements de nouvelle tentative au niveau de la session :

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Propagation :

- émis via `AgentSession.subscribe(...)`
- transférés au runner d'extension en tant qu'événements d'extension
- en mode RPC, transférés directement en tant qu'objets JSON d'événements (`session.subscribe(event => output(event))`)
- dans le TUI, consommés par `EventController` pour l'interface loader/erreur

Remontée de l'échec final :

- En cas de dépassement du maximum ou d'annulation, `auto_retry_end.success === false`
- Le TUI affiche : `Retry failed after N attempts: <finalError>`
- Les extensions/hooks reçoivent `auto_retry_end` avec les mêmes champs
- Les consommateurs RPC reçoivent le même objet d'événement sur le flux stdout

## Conditions d'arrêt permanent

La nouvelle tentative s'arrête et ne reprendra pas automatiquement lorsque l'une de ces conditions se produit :

- `retry.enabled` est à false
- l'erreur n'est pas classifiée comme éligible à la nouvelle tentative
- l'erreur est un dépassement de contexte (délégué au chemin de compaction)
- nombre maximal de tentatives dépassé
- l'utilisateur annule la nouvelle tentative (`abort_retry` ou `Esc` pendant le loader de nouvelle tentative)
- l'annulation globale (`abort`) annule d'abord la nouvelle tentative

Une nouvelle chaîne de nouvelles tentatives peut toujours démarrer ultérieurement sur une future erreur éligible après la réinitialisation des compteurs.

## Mises en garde opérationnelles

- La classification repose sur la correspondance de texte par regex ; les erreurs structurées spécifiques aux fournisseurs ne sont pas utilisées ici.
- La nouvelle tentative supprime l'erreur de l'assistant défaillant du **contexte d'exécution** avant de relancer, mais l'historique de session conserve toujours cette entrée d'erreur.
- `RpcSessionState` expose actuellement `autoCompactionEnabled` mais pas de champ `autoRetryEnabled` ; les appelants RPC doivent suivre leur propre état de bascule ou interroger les paramètres via d'autres API.
