---
title: Fonctionnement interne du streaming des fournisseurs
description: >-
  Implémentation du streaming des fournisseurs avec analyse SSE, comptage de
  tokens et gestion de la contre-pression.
sidebar:
  order: 2
  label: Fonctionnement interne du streaming
i18n:
  sourceHash: 8ea2715161b9
  translator: machine
---

# Fonctionnement interne du streaming des fournisseurs

Ce document explique comment le streaming de tokens/outils est normalisé dans `@f5-sales-demo/pi-ai`, puis propagé à travers les événements de session `@f5-sales-demo/pi-agent-core` et `coding-agent`.

## Flux de bout en bout

1. `streamSimple()` (`packages/ai/src/stream.ts`) mappe les options génériques et les distribue vers une fonction de flux de fournisseur.
2. Les fonctions de flux de fournisseur (`anthropic.ts`, `openai-responses.ts`, `google.ts`) traduisent les événements de flux natifs du fournisseur en séquence `AssistantMessageEvent` unifiée.
3. Chaque fournisseur pousse des événements dans `AssistantMessageEventStream` (`packages/ai/src/utils/event-stream.ts`), qui régule les événements delta et expose :
   - l'itération asynchrone pour les mises à jour incrémentielles
   - `result()` pour le `AssistantMessage` final
4. `agentLoop` (`packages/agent/src/agent-loop.ts`) consomme ces événements, fait muter l'état de l'assistant en cours et émet des événements `message_update` portant le `assistantMessageEvent` brut.
5. `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) s'abonne aux événements de l'agent, persiste les messages, pilote les hooks d'extension et applique les comportements de session (nouvelle tentative, compaction, TTSR, vérifications d'abandon de modification en streaming).

## Contrat de flux unifié dans `@f5-sales-demo/pi-ai`

Tous les fournisseurs émettent la même forme (`AssistantMessageEvent` dans `packages/ai/src/types.ts`) :

- `start`
- triplets de cycle de vie de blocs de contenu :
  - texte : `text_start` → `text_delta`* → `text_end`
  - réflexion : `thinking_start` → `thinking_delta`* → `thinking_end`
  - appel d'outil : `toolcall_start` → `toolcall_delta`* → `toolcall_end`
- événement terminal :
  - `done` avec `reason: "stop" | "length" | "toolUse"`
  - ou `error` avec `reason: "aborted" | "error"`

`AssistantMessageEventStream` garantit :

- le résultat final est résolu par l'événement terminal (`done` ou `error`)
- les deltas sont regroupés/régulés (~50 ms)
- les deltas mis en tampon sont vidés avant les événements non-delta et avant la complétion

## Comportement de régulation et d'harmonisation des deltas

`AssistantMessageEventStream` traite `text_delta`, `thinking_delta` et `toolcall_delta` comme des événements fusionnables :

- les deltas mis en tampon ne sont fusionnés que lorsque **type + contentIndex** correspondent
- la fusion conserve le dernier instantané `partial`
- les événements non-delta forcent un vidage immédiat

Cela lisse les flux de fournisseur à haute fréquence pour les consommateurs TUI/événements, mais ne constitue pas une contre-pression du fournisseur : les fournisseurs produisent toujours à pleine vitesse, tandis que le flux local met en tampon.

## Détails de normalisation par fournisseur

## Anthropic (`anthropic-messages`)

Source : `packages/ai/src/providers/anthropic.ts`

Points de normalisation :

- `message_start` initialise l'utilisation (tokens d'entrée/sortie/cache)
- `content_block_start` correspond aux débuts de texte/réflexion/appel d'outil
- `content_block_delta` mappe :
  - `text_delta` → `text_delta`
  - `thinking_delta` → `thinking_delta`
  - `input_json_delta` → `toolcall_delta`
  - `signature_delta` met à jour `thinkingSignature` uniquement (pas d'événement)
- `content_block_stop` émet le `*_end` correspondant
- `message_delta.stop_reason` est mappé via `mapStopReason()`

Streaming des arguments d'appel d'outil :

- chaque bloc d'outil porte un `partialJson` interne
- chaque delta JSON s'ajoute à `partialJson`
- les `arguments` sont réanalysés à chaque delta via `parseStreamingJson()`
- `toolcall_end` réanalyse une dernière fois, puis supprime `partialJson`

## Réponses OpenAI (`openai-responses`)

Source : `packages/ai/src/providers/openai-responses.ts`

Points de normalisation :

- `response.output_item.added` démarre les blocs de raisonnement/texte/appel de fonction
- les événements de résumé de raisonnement (`response.reasoning_summary_text.delta`) deviennent `thinking_delta`
- les deltas de sortie/refus deviennent `text_delta`
- `response.function_call_arguments.delta` devient `toolcall_delta`
- `response.output_item.done` émet `thinking_end` / `text_end` / `toolcall_end`
- `response.completed` mappe le statut en raison d'arrêt et l'utilisation

Streaming des arguments d'appel d'outil :

- même schéma d'accumulation `partialJson` qu'Anthropic
- les fournisseurs qui n'envoient que `response.function_call_arguments.done` alimentent quand même les arguments finaux
- les identifiants d'appel d'outil sont normalisés sous la forme `"<call_id>|<item_id>"`

## Google Generative AI (`google-generative-ai`)

Source : `packages/ai/src/providers/google.ts`

Points de normalisation :

- itère sur `candidate.content.parts`
- les parties texte sont réparties en réflexion ou texte par `isThinkingPart(part)`
- les transitions de bloc ferment le bloc précédent avant d'en démarrer un nouveau
- `part.functionCall` est traité comme un appel d'outil complet (start/delta/end émis immédiatement)
- la raison de fin est mappée par `mapStopReason()` depuis `google-shared.ts`

Streaming des arguments d'appel d'outil :

- les arguments d'appel de fonction arrivent sous forme d'objet structuré, et non de texte JSON incrémentiel
- l'implémentation émet un `toolcall_delta` synthétique contenant `JSON.stringify(arguments)`
- aucun analyseur JSON partiel n'est nécessaire pour Google dans ce chemin

## Accumulation et récupération du JSON partiel des appels d'outil

Le comportement partagé pour Anthropic/OpenAI Responses utilise `parseStreamingJson()` (`packages/ai/src/utils/json-parse.ts`) :

1. essayer `JSON.parse`
2. recours à l'analyseur `partial-json` pour les fragments incomplets
3. si les deux échouent, retourner `{}`

Implications :

- les deltas d'arguments mal formés ou tronqués ne font pas immédiatement planter le traitement du flux
- les `arguments` en cours peuvent temporairement être `{}`
- les deltas valides ultérieurs peuvent récupérer les arguments structurés car l'analyse est réessayée à chaque ajout
- le `toolcall_end` final effectue une dernière tentative d'analyse avant l'émission

## Raisons d'arrêt versus erreurs de transport/exécution

Les raisons d'arrêt du fournisseur sont mappées vers un `stopReason` normalisé :

- Anthropic : `end_turn`→`stop`, `max_tokens`→`length`, `tool_use`→`toolUse`, cas de sécurité/refus→`error`
- Réponses OpenAI : `completed`→`stop`, `incomplete`→`length`, `failed/cancelled`→`error`
- Google : `STOP`→`stop`, `MAX_TOKENS`→`length`, classes de sécurité/interdit/appel de fonction mal formé→`error`

La sémantique des erreurs est divisée en deux étapes :

1. **Sémantique de complétion du modèle** (raison de fin/statut rapporté par le fournisseur)
2. **Échec de transport/exécution** (exceptions réseau/client/analyseur/abandon)

Si le flux du fournisseur génère une exception ou signale un échec, chaque enveloppe de fournisseur intercepte et émet un événement `error` terminal avec :

- `stopReason = "aborted"` lorsque le signal d'abandon est activé
- sinon `stopReason = "error"`
- `errorMessage = formatErrorMessageWithRetryAfter(error)`

## Comportement en cas de chunk mal formé / échec d'analyse SSE

Pour ces chemins de fournisseur, le cadrage chunk/SSE est géré par les flux du SDK vendeur (SDK Anthropic, SDK OpenAI, SDK Google). Ce code n'implémente pas ici de décodeur SSE personnalisé.

Comportement observé dans l'implémentation actuelle :

- l'analyse de chunk/SSE mal formé au niveau du SDK se manifeste sous forme d'exception ou d'événement `error` de flux
- l'enveloppe du fournisseur convertit cela en événement `error` terminal unifié
- aucune reprise/nouvelle tentative spécifique au fournisseur à l'intérieur de la fonction de flux elle-même
- les nouvelles tentatives de niveau supérieur sont gérées dans la logique de nouvelle tentative automatique de `AgentSession` (nouvelle tentative au niveau du message, pas de rejeu de chunk de flux)

## Limites d'annulation

L'annulation est structurée en couches :

- Requête du fournisseur IA : `options.signal` est transmis à l'appel de flux du client fournisseur.
- Enveloppe du fournisseur : après la boucle de flux, un signal abandonné force le chemin d'erreur (`"Request was aborted"`).
- Boucle d'agent : vérifie `signal.aborted` avant de traiter chaque événement du fournisseur et peut synthétiser un message d'assistant abandonné à partir du dernier partiel.
- Contrôles de session/agent : `AgentSession.abort()` -> `agent.abort()` -> annulation du contrôleur d'abandon partagé.

L'annulation de l'exécution des outils est distincte de l'annulation du flux du modèle :

- les exécuteurs d'outils utilisent `AbortSignal.any([agentSignal, steeringAbortSignal])`
- les interruptions de pilotage peuvent abandonner l'exécution des outils restants tout en préservant les résultats d'outils déjà produits

## Limites de contre-pression

Il n'existe pas de mécanisme de contre-pression strict entre le flux du SDK fournisseur et les consommateurs en aval :

- `EventStream` utilise des files d'attente en mémoire sans taille maximale
- la régulation réduit le taux de mise à jour de l'interface utilisateur mais ne ralentit pas l'absorption du fournisseur
- si les consommateurs prennent du retard de manière significative, les événements mis en file d'attente peuvent croître jusqu'à la complétion

La conception actuelle privilégie la réactivité et un ordonnancement simple plutôt qu'un contrôle de flux à tampon borné.

## Comment les événements de flux remontent en tant qu'événements agent/session

`agentLoop.streamAssistantResponse()` fait le pont entre `AssistantMessageEvent` et `AgentEvent` :

- sur `start` : pousse un message d'assistant fictif et émet `message_start`
- sur les événements de bloc (`text_*`, `thinking_*`, `toolcall_*`) : met à jour le dernier message d'assistant, émet `message_update` avec le `assistantMessageEvent` brut
- sur le terminal (`done`/`error`) : résout le message final depuis `response.result()`, émet `message_end`

`AgentSession` consomme ensuite ces événements pour les comportements au niveau de la session :

- TTSR surveille `message_update.assistantMessageEvent` pour `text_delta` et `toolcall_delta`
- le garde de modification en streaming inspecte `toolcall_delta`/`toolcall_end` sur les appels `edit` et peut abandonner prématurément
- la persistance écrit les messages finalisés à `message_end`
- la nouvelle tentative automatique examine `stopReason === "error"` de l'assistant ainsi que les heuristiques de `errorMessage`

## Responsabilités unifiées versus spécifiques au fournisseur

Unifiées (contrat commun) :

- forme des événements (`AssistantMessageEvent`)
- extraction du résultat final (`done`/`error`)
- règles de régulation et de fusion des deltas
- modèle de propagation des événements agent/session

Spécifiques au fournisseur (non entièrement abstraites) :

- taxonomies d'événements en amont et logique de mappage
- tables de traduction des raisons d'arrêt
- conventions d'identifiants d'appel d'outil
- sémantique des blocs de raisonnement/réflexion et signatures
- sémantique des tokens d'utilisation et calendrier de disponibilité
- contraintes de conversion de messages par API

## Fichiers d'implémentation

- [`../../ai/src/stream.ts`](../../packages/ai/src/stream.ts) — distribution des fournisseurs, mappage des options, plomberie des clés API/sessions.
- [`../../ai/src/utils/event-stream.ts`](../../packages/ai/src/utils/event-stream.ts) — file d'attente de flux générique + régulation des deltas de l'assistant.
- [`../../ai/src/utils/json-parse.ts`](../../packages/ai/src/utils/json-parse.ts) — analyse JSON partielle pour les arguments d'outil en streaming.
- [`../../ai/src/providers/anthropic.ts`](../../packages/ai/src/providers/anthropic.ts) — traduction des événements Anthropic et accumulation des deltas JSON d'outil.
- [`../../ai/src/providers/openai-responses.ts`](../../packages/ai/src/providers/openai-responses.ts) — traduction des événements Réponses OpenAI et mappage des statuts.
- [`../../ai/src/providers/google.ts`](../../packages/ai/src/providers/google.ts) — traduction chunk-vers-bloc du flux Gemini.
- [`../../ai/src/providers/google-shared.ts`](../../packages/ai/src/providers/google-shared.ts) — mappage des raisons de fin Gemini et règles de conversion partagées.
- [`../../agent/src/agent-loop.ts`](../../packages/agent/src/agent-loop.ts) — consommation du flux du fournisseur et pont `message_update`.
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — gestion au niveau de la session des mises à jour en streaming, de l'abandon, des nouvelles tentatives et de la persistance.
