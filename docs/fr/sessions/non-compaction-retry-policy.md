---
title: Politique de nouvelle tentative automatique hors compaction
description: >-
  Politique de nouvelle tentative automatique pour les échecs d'API transitoires
  en dehors du chemin de compaction.
sidebar:
  order: 6
  label: Politique de nouvelle tentative
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# Politique de nouvelle tentative automatique hors compaction

Ce document décrit le chemin standard de nouvelle tentative en cas d'erreur d'API dans `AgentSession`.

Il exclut explicitement la récupération en cas de dépassement de contexte via la compaction automatique. Le dépassement est géré par la logique de compaction et est documenté séparément dans [`compaction.md`](./compaction.md).

## Fichiers d'implémentation

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## Délimitation du périmètre par rapport à la compaction

La nouvelle tentative et la compaction sont vérifiées depuis le même chemin `agent_end`, mais elles sont intentionnellement séparées :

1. `agent_end` inspecte le dernier message de l'assistant.
2. `#isRetryableError(...)` s'exécute en premier.
3. Si une nouvelle tentative est initiée, les vérifications de compaction sont ignorées pour ce tour.
4. Les erreurs de dépassement de contexte sont strictement exclues de la classification des nouvelles tentatives (`isContextOverflow(...)` court-circuite la nouvelle tentative).
5. Le dépassement passe donc à `#checkCompaction(...)` plutôt qu'à la nouvelle tentative standard.

Ainsi : les pannes de type surcharge/limite de débit/serveur/réseau utilisent cette politique de nouvelle tentative ; le dépassement de la fenêtre de contexte utilise la récupération par compaction.

## Classification des nouvelles tentatives

`#isRetryableError(...)` exige que toutes les conditions suivantes soient réunies :

- `stopReason === "error"` côté assistant
- `errorMessage` existe
- le message n'est **pas** un dépassement de contexte
- `errorMessage` correspond à `#isRetryableErrorMessage(...)`

Ensemble de motifs actuellement sujets à nouvelle tentative (basé sur des expressions régulières) :

- overloaded
- rate limit / usage limit / too many requests
- classes de serveur similaires à HTTP : 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- formulation `retry delay`

Il s'agit d'une classification par motifs de chaînes, non par codes d'erreur structurés du fournisseur.

## Cycle de vie de la nouvelle tentative et transitions d'état

État de session utilisé par la nouvelle tentative :

- `#retryAttempt: number` (`0` signifie inactif)
- `#retryPromise: Promise<void> | undefined` (suit le cycle de vie de la nouvelle tentative en cours)
- `#retryResolve: (() => void) | undefined` (résout `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (annule la mise en veille du délai exponentiel)

Flux (`#handleRetryableError`) :

1. Lire le groupe de paramètres `retry`.
2. Si `retry.enabled === false`, arrêter immédiatement (`false`, aucune nouvelle tentative démarrée).
3. Incrémenter `#retryAttempt`.
4. Créer `#retryPromise` une seule fois (première tentative d'une chaîne).
5. Si la tentative dépasse `retry.maxRetries`, émettre l'événement d'échec final et s'arrêter.
6. Calculer le délai : `retry.baseDelayMs * 2^(attempt-1)`.
7. Pour les erreurs de limite d'utilisation, analyser les indications de nouvelle tentative et appeler le stockage d'authentification (`markUsageLimitReached(...)`) ; si le changement de fournisseur/modèle réussit, forcer le délai à `0`.
8. Émettre `auto_retry_start`.
9. Supprimer le message d'erreur de l'assistant en fin de liste de l'état d'exécution de l'agent (conservé dans l'historique de session persisté).
10. Mettre en veille avec prise en charge de l'annulation.
11. Au réveil, planifier `agent.continue()` via `setTimeout(..., 0)`.

### Ce qui réinitialise les compteurs de nouvelles tentatives

`#retryAttempt` est réinitialisé à `0` dans les cas suivants :

- premier message assistant réussi, sans erreur et sans annulation, après le début des nouvelles tentatives (émet `auto_retry_end { success: true }`)
- annulation de la nouvelle tentative pendant la mise en veille du délai exponentiel
- chemin de dépassement du nombre maximal de tentatives

`#retryPromise` se résout et est effacé lorsque la chaîne de nouvelles tentatives se termine (succès, annulation ou dépassement du maximum), via `#resolveRetry()`.

## Sémantique du délai exponentiel et du nombre maximal de tentatives

Paramètres :

- `retry.enabled` (valeur par défaut : `true`)
- `retry.maxRetries` (valeur par défaut : `3`)
- `retry.baseDelayMs` (valeur par défaut : `2000`)

Numérotation des tentatives :

- le compteur de tentatives est incrémenté avant la vérification du maximum
- les événements de démarrage utilisent la tentative courante (base 1)
- l'événement de fin de dépassement du maximum rapporte `attempt: this.#retryAttempt - 1` (dernier nombre de tentatives effectuées)

Séquence de délai exponentiel avec les paramètres par défaut :

- tentative 1 : 2 000 ms
- tentative 2 : 4 000 ms
- tentative 3 : 8 000 ms

Les entrées de remplacement du délai ne sont utilisées que dans le chemin de gestion des limites d'utilisation, et uniquement pour influencer la décision de changement de modèle/compte dans le stockage d'authentification. Dans le chemin principal de nouvelle tentative hors compaction, le délai exponentiel reste local, sauf si le changement réussit (`delayMs = 0`).

## Mécanique d'annulation

### Annulation explicite de la nouvelle tentative

`abortRetry()` :

- annule `#retryAbortController` (s'il est présent)
- résout la promesse de nouvelle tentative (`#resolveRetry()`) afin de débloquer les attentes

Si l'annulation intervient pendant la mise en veille, le chemin de capture émet :

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- réinitialise la tentative et le contrôleur

### Interaction avec l'annulation globale de l'opération

`abort()` appelle `abortRetry()` avant d'annuler le flux actif de l'agent. Cela garantit que le délai exponentiel de nouvelle tentative est annulé lorsque l'utilisateur émet une annulation globale.

### Interaction avec l'interface TUI

Sur `auto_retry_start`, EventController :

- remplace le gestionnaire `Esc` par `session.abortRetry()`
- affiche le texte de chargement : `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

Sur `auto_retry_end`, il restaure le gestionnaire `Esc` précédent et efface l'état de chargement.

## Comportement du streaming et de la complétion de prompt

`prompt()` attend finalement `#waitForRetry()` après le retour de `agent.prompt(...)`.

Effet :

- un appel de prompt ne se résout pas complètement tant qu'une chaîne de nouvelles tentatives démarrée n'est pas terminée (succès/échec/annulation)
- le cycle de vie de la nouvelle tentative fait partie d'une limite logique d'exécution de prompt

Cela empêche les appelants de traiter un tour en cours de nouvelle tentative comme terminé prématurément.

## Contrôles : paramètres et RPC

### Paramètres de configuration

Définis dans le schéma des paramètres sous le groupe retry :

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

Bascules programmatiques dans la session :

- `setAutoRetryEnabled(enabled)` écrit `retry.enabled`
- `autoRetryEnabled` lit `retry.enabled`
- `isRetrying` indique si la promesse de cycle de vie de nouvelle tentative est active

### Contrôles RPC

Surface de commandes RPC :

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

Assistants côté client :

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

Les deux commandes renvoient des réponses de succès ; les détails de progression/d'échec de la nouvelle tentative proviennent des événements de session diffusés en continu, et non des charges utiles de réponse aux commandes.

## Émission d'événements et signalement des échecs

Événements de nouvelle tentative au niveau de la session :

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Propagation :

- émis via `AgentSession.subscribe(...)`
- transmis au lanceur d'extension en tant qu'événements d'extension
- en mode RPC, transmis directement en tant qu'objets JSON d'événement (`session.subscribe(event => output(event))`)
- en mode TUI, consommés par `EventController` pour l'interface de chargement/erreur

Signalement des échecs finaux :

- En cas de dépassement du maximum ou d'annulation, `auto_retry_end.success === false`
- L'interface TUI affiche : `Retry failed after N attempts: <finalError>`
- Les extensions/hooks reçoivent `auto_retry_end` avec les mêmes champs
- Les consommateurs RPC reçoivent le même objet d'événement sur le flux stdout

## Conditions d'arrêt permanent

La nouvelle tentative s'arrête et ne continuera pas automatiquement dans l'un des cas suivants :

- `retry.enabled` est false
- l'erreur n'est pas classifiée comme sujette à nouvelle tentative
- l'erreur est un dépassement de contexte (délégué au chemin de compaction)
- le nombre maximal de tentatives est dépassé
- l'utilisateur annule la nouvelle tentative (`abort_retry` ou `Esc` pendant le chargement de la nouvelle tentative)
- l'annulation globale (`abort`) annule d'abord la nouvelle tentative

Une nouvelle chaîne de nouvelles tentatives peut tout de même démarrer ultérieurement lors d'une future erreur sujette à nouvelle tentative, après réinitialisation des compteurs.

## Mises en garde opérationnelles

- La classification est une correspondance textuelle par expressions régulières ; les erreurs structurées propres aux fournisseurs ne sont pas utilisées ici.
- La nouvelle tentative supprime l'erreur de l'assistant en échec du **contexte d'exécution** avant de reprendre, mais l'historique de session conserve tout de même cette entrée d'erreur.
- `RpcSessionState` expose actuellement `autoCompactionEnabled` mais pas de champ `autoRetryEnabled` ; les appelants RPC doivent suivre leur propre état de bascule ou interroger les paramètres via d'autres API.
