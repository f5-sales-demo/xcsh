---
title: Politique de nouvelle tentative automatique hors compaction
description: >-
  Politique de nouvelle tentative automatique pour les échecs d'API transitoires
  hors du chemin de compaction.
sidebar:
  order: 6
  label: Politique de nouvelle tentative
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# Politique de nouvelle tentative automatique hors compaction

Ce document décrit le chemin standard de nouvelle tentative en cas d'erreur API dans `AgentSession`.

Il exclut explicitement la récupération en cas de dépassement de contexte via la compaction automatique. Le dépassement est géré par la logique de compaction et est documenté séparément dans [`compaction.md`](./compaction.md).

## Fichiers d'implémentation

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## Délimitation du périmètre par rapport à la compaction

La nouvelle tentative et la compaction sont vérifiées depuis le même chemin `agent_end`, mais sont intentionnellement séparées :

1. `agent_end` inspecte le dernier message de l'assistant.
2. `#isRetryableError(...)` s'exécute en premier.
3. Si une nouvelle tentative est initiée, les vérifications de compaction sont ignorées pour ce tour.
4. Les erreurs de dépassement de contexte sont strictement exclues de la classification de nouvelle tentative (`isContextOverflow(...)` court-circuite la nouvelle tentative).
5. Le dépassement tombe donc dans `#checkCompaction(...)` au lieu de la nouvelle tentative standard.

En résumé : les échecs de type surcharge, limitation de débit, serveur ou réseau utilisent cette politique de nouvelle tentative ; le dépassement de fenêtre de contexte utilise la récupération par compaction.

## Classification des nouvelles tentatives

`#isRetryableError(...)` exige que toutes les conditions suivantes soient réunies :

- le `stopReason` de l'assistant est `"error"`
- `errorMessage` existe
- le message **n'est pas** un dépassement de contexte
- `errorMessage` correspond à `#isRetryableErrorMessage(...)`

Ensemble de motifs éligibles actuels (basés sur des expressions régulières) :

- overloaded
- rate limit / usage limit / too many requests
- classes de serveurs de type HTTP : 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- formulation `retry delay`

Il s'agit d'une classification par motifs de chaînes de caractères, et non de codes d'erreur typés spécifiques au fournisseur.

## Cycle de vie de la nouvelle tentative et transitions d'état

État de session utilisé par la nouvelle tentative :

- `#retryAttempt: number` (`0` signifie inactif)
- `#retryPromise: Promise<void> | undefined` (suit le cycle de vie de la nouvelle tentative en cours)
- `#retryResolve: (() => void) | undefined` (résout `#retryPromise`)
- `#retryAbortController: AbortController | undefined` (annule la pause du délai d'attente exponentiel)

Flux (`#handleRetryableError`) :

1. Lire le groupe de paramètres `retry`.
2. Si `retry.enabled === false`, s'arrêter immédiatement (`false`, aucune nouvelle tentative démarrée).
3. Incrémenter `#retryAttempt`.
4. Créer `#retryPromise` une seule fois (première tentative d'une chaîne).
5. Si la tentative dépasse `retry.maxRetries`, émettre l'événement d'échec final et s'arrêter.
6. Calculer le délai : `retry.baseDelayMs * 2^(tentative-1)`.
7. Pour les erreurs de limite d'utilisation, analyser les indications de nouvelle tentative et appeler le stockage d'authentification (`markUsageLimitReached(...)`) ; si le changement de fournisseur/modèle réussit, forcer le délai à `0`.
8. Émettre `auto_retry_start`.
9. Supprimer le message d'erreur de l'assistant en fin de liste de l'état d'exécution de l'agent (conservé dans l'historique de session persisté).
10. Mettre en pause avec prise en charge de l'abandon.
11. Au réveil, planifier `agent.continue()` via `setTimeout(..., 0)`.

### Ce qui réinitialise les compteurs de nouvelles tentatives

`#retryAttempt` est réinitialisé à `0` dans ces cas :

- premier message d'assistant réussi sans erreur ni abandon après le démarrage des nouvelles tentatives (émet `auto_retry_end { success: true }`)
- annulation de la nouvelle tentative pendant la pause du délai d'attente exponentiel
- chemin de dépassement du nombre maximum de tentatives

`#retryPromise` se résout et s'efface lorsque la chaîne de nouvelles tentatives se termine (succès, annulation ou dépassement du maximum), via `#resolveRetry()`.

## Délai d'attente exponentiel et sémantique du nombre maximum de tentatives

Paramètres :

- `retry.enabled` (valeur par défaut : `true`)
- `retry.maxRetries` (valeur par défaut : `3`)
- `retry.baseDelayMs` (valeur par défaut : `2000`)

Numérotation des tentatives :

- le compteur de tentatives est incrémenté avant la vérification du maximum
- les événements de démarrage utilisent la tentative courante (base 1)
- l'événement de fin pour dépassement du maximum rapporte `attempt: this.#retryAttempt - 1` (dernier nombre de nouvelles tentatives effectuées)

Séquence de délai d'attente avec les paramètres par défaut :

- tentative 1 : 2000 ms
- tentative 2 : 4000 ms
- tentative 3 : 8000 ms

Les entrées de remplacement du délai ne sont utilisées que dans le chemin de gestion des limites d'utilisation, et uniquement pour influencer la décision de changement de modèle/compte dans le stockage d'authentification. Dans le chemin principal de nouvelle tentative hors compaction, le délai d'attente reste un délai exponentiel local, sauf si un changement réussit (`delayMs = 0`).

## Mécanismes d'abandon

### Abandon explicite de la nouvelle tentative

`abortRetry()` :

- abandonne `#retryAbortController` (si présent)
- résout la promesse de nouvelle tentative (`#resolveRetry()`) afin de débloquer les entités en attente

Si l'abandon survient pendant la pause, le chemin de capture émet :

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- réinitialise la tentative et le contrôleur

### Interaction avec l'abandon global d'opération

`abort()` appelle `abortRetry()` avant d'abandonner le flux d'agent actif. Cela garantit l'annulation du délai d'attente de nouvelle tentative lorsque l'utilisateur émet un abandon général.

### Interaction avec l'interface TUI

Sur `auto_retry_start`, EventController :

- remplace le gestionnaire de la touche `Esc` par `session.abortRetry()`
- affiche le texte de chargement : `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

Sur `auto_retry_end`, il restaure le gestionnaire `Esc` précédent et efface l'état du chargeur.

## Comportement du streaming et de la complétion des invites

`prompt()` attend finalement `#waitForRetry()` après le retour de `agent.prompt(...)`.

Effet :

- un appel de prompt ne se résout pas complètement tant que toute chaîne de nouvelles tentatives démarrée n'est pas terminée (succès/échec/annulation)
- le cycle de vie de la nouvelle tentative fait partie d'une limite d'exécution logique d'une invite

Cela empêche les appelants de considérer un tour en cours de nouvelle tentative comme terminé prématurément.

## Contrôles : paramètres et RPC

### Boutons de configuration

Définis dans le schéma de paramètres sous le groupe retry :

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

Assistants client :

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

Les deux commandes retournent des réponses de succès ; les détails de progression ou d'échec de la nouvelle tentative proviennent des événements de session diffusés en continu, et non des charges utiles de réponse aux commandes.

## Émission d'événements et remontée des échecs

Événements de nouvelle tentative au niveau de la session :

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

Propagation :

- émis via `AgentSession.subscribe(...)`
- transmis au lanceur d'extension en tant qu'événements d'extension
- en mode RPC, transmis directement en tant qu'objets d'événements JSON (`session.subscribe(event => output(event))`)
- en mode TUI, consommés par `EventController` pour l'interface utilisateur de chargement/erreur

Remontée des échecs finaux :

- En cas de dépassement du maximum ou d'annulation, `auto_retry_end.success === false`
- L'interface TUI affiche : `Retry failed after N attempts: <finalError>`
- Les extensions et hooks reçoivent `auto_retry_end` avec les mêmes champs
- Les consommateurs RPC reçoivent le même objet d'événement sur le flux stdout

## Conditions d'arrêt permanent

La nouvelle tentative s'arrête et ne continuera pas automatiquement lorsque l'une des conditions suivantes se produit :

- `retry.enabled` est false
- l'erreur n'est pas classifiée comme eligible à une nouvelle tentative
- l'erreur est un dépassement de contexte (délégué au chemin de compaction)
- le nombre maximum de nouvelles tentatives est dépassé
- l'utilisateur annule la nouvelle tentative (`abort_retry` ou `Esc` pendant le chargeur de nouvelle tentative)
- un abandon global (`abort`) annule d'abord la nouvelle tentative

Une nouvelle chaîne de nouvelles tentatives peut encore démarrer ultérieurement lors d'une future erreur éligible, une fois les compteurs réinitialisés.

## Mises en garde opérationnelles

- La classification repose sur la correspondance de texte par expressions régulières ; les erreurs structurées spécifiques au fournisseur ne sont pas utilisées ici.
- La nouvelle tentative supprime l'erreur de l'assistant en échec du **contexte d'exécution** avant de reprendre, mais l'historique de session conserve tout de même cette entrée d'erreur.
- `RpcSessionState` expose actuellement `autoCompactionEnabled` mais pas de champ `autoRetryEnabled` ; les appelants RPC doivent gérer leur propre état de bascule ou interroger les paramètres via d'autres API.
