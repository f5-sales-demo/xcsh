---
title: Provider Streaming Internals
description: >-
  Implémentation du streaming des fournisseurs avec analyse SSE, comptage de
  tokens et gestion de la contre-pression.
sidebar:
  order: 2
  label: Mécanismes internes du streaming
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# Mécanismes internes du streaming des fournisseurs

Ce document explique comment le streaming de tokens/outils est normalisé dans `@f5xc-salesdemos/pi-ai`, puis propagé à travers `@f5xc-salesdemos/pi-agent-core` et les événements de session de `coding-agent`.

## Flux de bout en bout

1. `streamSimple()` (`packages/ai/src/stream.ts`) mappe les options génériques et les dispatche vers une fonction de stream spécifique au fournisseur.
2. Les fonctions de stream des fournisseurs (`anthropic.ts`, `openai-responses.ts`, `google.ts`) traduisent les événements natifs du stream du fournisseur en la séquence unifiée `AssistantMessageEvent`.
3. Chaque fournisseur pousse les événements dans `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`), qui régule les événements delta et expose :
   - une itération asynchrone pour les mises à jour incrémentales
   - `result()` pour le `AssistantMessage` final
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) consomme ces événements, modifie l'état de l'assistant en cours et émet des événements `message_update` contenant le `assistantMessageEvent` brut.
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) s'abonne aux événements de l'agent, persiste les messages, pilote les hooks d'extension et applique les comportements de session (réessai, compaction, TTSR, vérifications d'abandon d'édition en streaming).

## Contrat de stream unifié dans `@f5xc-salesdemos/pi-ai`

Tous les fournisseurs émettent la même forme (`AssistantMessageEvent` dans `packages/ai/src/types.ts`) :

- `start`
- triplets de cycle de vie des blocs de contenu :
  - texte : `text_start` → `text_delta`* → `text_end`
  - réflexion : `thinking_start` → `thinking_delta`* → `thinking_end`
  - appel d'outil : `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- événement terminal :
  - `done` avec `reason: "stop" | "length" | "toolUse"`
  - ou `error` avec `reason: "aborted" | "error"`

`AssistantMessageEventStream` garantit :

- le résultat final est résolu par l'événement terminal (`done` ou `error`)
- les deltas sont regroupés/régulés (~50ms)
- les deltas mis en tampon sont vidés avant les événements non-delta et avant la complétion

## Comportement de régulation et d'harmonisation des deltas

`AssistantMessageEventStream` traite `text_delta`, `thinking_delta` et `toolcall_delta` comme des événements fusionnables :

- les deltas mis en tampon ne sont fusionnés que lorsque **type + contentIndex** correspondent
- la fusion conserve le dernier instantané `partial`
- les événements non-delta forcent un vidage immédiat

Cela lisse les streams haute fréquence des fournisseurs pour les consommateurs TUI/événements, mais ne constitue pas de la contre-pression fournisseur : les fournisseurs continuent de produire à pleine vitesse, tandis que le stream local met en tampon.

## Détails de normalisation par fournisseur

## Anthropic (`anthropic-messages`)

Source : `packages/ai/src/providers/anthropic.ts`

Points de normalisation :

- `message_start` initialise l'utilisation (tokens d'entrée/sortie/cache)
- `content_block_start` est mappé vers les démarrages text/thinking/toolcall
- `content_block_delta` mappe :
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` met à jour uniquement `thinkingSignature` (pas d'événement)
- `content_block_stop` émet le `*_end` correspondant
- `message_delta.stop_reason` est mappé via `mapStopReason()`

Streaming des arguments d'appel d'outil :

- chaque bloc d'outil porte un `partialJson` interne
- chaque delta JSON est ajouté à `partialJson`
- les `arguments` sont re-parsés à chaque delta via `parseStreamingJson()`
- `toolcall_end` re-parse une dernière fois, puis supprime `partialJson`

## OpenAI Responses (`openai-responses`)

Source : `packages/ai/src/providers/openai-responses.ts`

Points de normalisation :

- `response.output_item.added` démarre les blocs de raisonnement/texte/appel de fonction
- les événements de résumé de raisonnement (`response.reasoning_summary_text.delta`) deviennent `thinking_delta`
- les deltas de sortie/refus deviennent `text_delta`
- `response.function_call_arguments.delta` devient `toolcall_delta`
- `response.output_item.done` émet `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` mappe le statut vers la raison d'arrêt et l'utilisation

Streaming des arguments d'appel d'outil :

- même schéma d'accumulation `partialJson` qu'Anthropic
- les fournisseurs qui n'envoient que `response.function_call_arguments.done` remplissent quand même les arguments finaux
- les identifiants d'appel d'outil sont normalisés sous la forme `"<call_id>|<item_id>"`

## Google Generative AI (`google-generative-ai`)

Source : `packages/ai/src/providers/google.ts`

Points de normalisation :

- itère sur `candidate.content.parts`
- les parties texte sont séparées en réflexion vs texte par `isThinkingPart(part)`
- les transitions de bloc ferment le bloc précédent avant d'en démarrer un nouveau
- `part.functionCall` est traité comme un appel d'outil complet (start/delta/end émis immédiatement)
- la raison de fin est mappée par `mapStopReason()` depuis `google-shared.ts`

Streaming des arguments d'appel d'outil :

- les arguments d'appel de fonction arrivent sous forme d'objet structuré, pas de texte JSON incrémental
- l'implémentation émet un `toolcall_delta` synthétique contenant `JSON.stringify(arguments)`
- pas besoin de parseur JSON partiel pour Google dans ce chemin

## Accumulation et récupération de JSON partiel pour les appels d'outil

Le comportement partagé pour Anthropic/OpenAI Responses utilise `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`) :

1. essai de `JSON.parse`
2. repli sur le parseur `partial-json` pour les fragments incomplets
3. si les deux échouent, retourne `{}`

Implications :

- les deltas d'arguments malformés ou tronqués ne font pas planter le traitement du stream immédiatement
- les `arguments` en cours peuvent temporairement être `{}`
- les deltas valides ultérieurs peuvent récupérer les arguments structurés car le parsing est réessayé à chaque ajout
- le `toolcall_end` final effectue une dernière tentative de parsing avant l'émission

## Raisons d'arrêt vs erreurs de transport/runtime

Les raisons d'arrêt des fournisseurs sont mappées vers un `stopReason` normalisé :

- Anthropic : `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, cas de sécurité/refus→`error`
- OpenAI Responses : `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google : `STOP`→`stop`, `MAX_TOKENS`→`length`, classes sécurité/interdit/appel-de-fonction-malformé→`error`

La sémantique des erreurs est divisée en deux étapes :

1. **Sémantique de complétion du modèle** (raison de fin/statut rapporté par le fournisseur)
2. **Échec de transport/runtime** (exceptions réseau/client/parseur/abandon)

Si le stream du fournisseur lève une exception ou signale un échec, chaque wrapper de fournisseur capture et émet un événement terminal `error` avec :

- `stopReason = "aborted"` lorsque le signal d'abandon est défini
- sinon `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## Comportement en cas de chunk malformé / échec de parsing SSE

Pour ces chemins de fournisseur, le cadrage chunk/SSE est géré par les streams des SDK fournisseurs (SDK Anthropic, SDK OpenAI, SDK Google). Ce code n'implémente pas de décodeur SSE personnalisé ici.

Comportement observé dans l'implémentation actuelle :

- le parsing malformé de chunk/SSE au niveau du SDK se manifeste comme une exception ou un événement `error` du stream
- le wrapper du fournisseur le convertit en événement terminal `error` unifié
- pas de reprise/réessai spécifique au fournisseur à l'intérieur de la fonction de stream elle-même
- les réessais de niveau supérieur sont gérés dans la logique de réessai automatique d'`AgentSession` (réessai au niveau du message, pas de rejeu de chunk de stream)

## Limites d'annulation

L'annulation est organisée en couches :

- Requête du fournisseur IA : `options.signal` est passé dans l'appel de stream du client fournisseur.
- Wrapper du fournisseur : après la boucle de stream, un signal abandonné force le chemin d'erreur (`"Request was aborted"`).
- Boucle de l'agent : vérifie `signal.aborted` avant de traiter chaque événement du fournisseur et peut synthétiser un message d'assistant abandonné à partir du dernier partiel.
- Contrôles session/agent : `AgentSession.abort()` -> `agent.abort()` -> annulation du contrôleur d'abandon partagé.

L'annulation d'exécution d'outil est séparée de l'annulation du stream du modèle :

- les exécuteurs d'outils utilisent `AbortSignal.any([agentSignal, steeringAbortSignal])`
- les interruptions de pilotage peuvent abandonner l'exécution des outils restants tout en préservant les résultats d'outils déjà produits

## Limites de la contre-pression

Il n'y a pas de mécanisme de contre-pression strict entre le stream du SDK fournisseur et les consommateurs en aval :

- `EventStream` utilise des files d'attente en mémoire sans taille maximale
- la régulation réduit le taux de mise à jour de l'UI mais ne ralentit pas l'ingestion du fournisseur
- si les consommateurs prennent un retard significatif, les événements en file d'attente peuvent croître jusqu'à la complétion

La conception actuelle favorise la réactivité et un ordonnancement simple plutôt qu'un contrôle de flux à tampon borné.

## Comment les événements de stream apparaissent comme événements agent/session

`agentLoop.streamAssistantResponse()` fait le pont entre `AssistantMessageEvent` et `AgentEvent` :

- sur `start` : pousse un message d'assistant temporaire et émet `message_start`
- sur les événements de bloc (`text_*`, `thinking_*`, `toolcall_*`) : met à jour le dernier message d'assistant, émet `message_update` avec le `assistantMessageEvent` brut
- sur terminal (`done`/`error`) : résout le message final depuis `response.result()`, émet `message_end`

`AgentSession` consomme ensuite ces événements pour les comportements au niveau session :

- TTSR surveille `message_update.assistantMessageEvent` pour `text_delta` et `toolcall_delta`
- la garde d'édition en streaming inspecte `toolcall_delta`/`toolcall_end` sur les appels `edit` et peut abandonner prématurément
- la persistance écrit les messages finalisés à `message_end`
- le réessai automatique examine `stopReason === "error"` de l'assistant plus les heuristiques `errorMessage`

## Responsabilités unifiées vs spécifiques au fournisseur

Unifiées (contrat commun) :

- forme des événements (`AssistantMessageEvent`)
- extraction du résultat final (`done`/`error`)
- règles de régulation + fusion des deltas
- modèle de propagation des événements agent/session

Spécifiques au fournisseur (pas complètement abstraites) :

- taxonomies des événements en amont et logique de mapping
- tables de traduction des raisons d'arrêt
- conventions d'identifiants d'appels d'outil
- sémantique des blocs de raisonnement/réflexion et signatures
- sémantique des tokens d'utilisation et disponibilité temporelle
- contraintes de conversion des messages par API

## Fichiers d'implémentation

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — dispatch fournisseur, mapping des options, plomberie clé API/session.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — file d'attente de stream générique + régulation des deltas d'assistant.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — parsing JSON partiel pour les arguments d'outils en streaming.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — traduction des événements Anthropic et accumulation de deltas JSON d'outils.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — traduction des événements OpenAI Responses et mapping de statut.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — traduction chunk-vers-bloc du stream Gemini.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — mapping des raisons de fin Gemini et règles de conversion partagées.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — consommation du stream fournisseur et pont `message_update`.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — gestion au niveau session des mises à jour en streaming, abandon, réessai et persistance.
