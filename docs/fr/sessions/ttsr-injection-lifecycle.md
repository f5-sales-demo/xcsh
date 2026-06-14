---
title: Cycle de vie de l'injection TTSR
description: >-
  Cycle de vie de l'injection TTSR (tool-use, tool-result, system-reminder) pour
  la gestion du contexte.
sidebar:
  order: 9
  label: Injection TTSR
i18n:
  sourceHash: d6179a286584
  translator: machine
---

# Cycle de vie de l'injection TTSR

Ce document décrit le chemin d'exécution actuel des Time Traveling Stream Rules (TTSR), depuis la découverte des règles jusqu'à l'interruption du flux, l'injection de nouvelle tentative, les notifications d'extension et la gestion de l'état de session.

## Fichiers d'implémentation

- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/export/ttsr.ts`](../../packages/coding-agent/src/export/ttsr.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/prompts/system/ttsr-interrupt.md`](../../packages/coding-agent/src/prompts/system/ttsr-interrupt.md)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/types.ts`](../../packages/coding-agent/src/extensibility/extensions/types.ts)
- [`../src/extensibility/hooks/types.ts`](../../packages/coding-agent/src/extensibility/hooks/types.ts)
- [`../src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)

## 1. Flux de découverte et enregistrement des règles

Lors de la création de la session, `createAgentSession()` charge toutes les règles découvertes et construit un `TtsrManager` :

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### Comportement de déduplication avant enregistrement

`loadCapability("rules")` déduplique les règles par `rule.name` selon la sémantique « premier arrivé, premier servi » (priorité de fournisseur la plus élevée en premier). Les doublons masqués sont supprimés avant l'enregistrement TTSR.

### Comportement de `TtsrManager.addRule()`

L'enregistrement est ignoré dans les cas suivants :

- `rule.ttsrTrigger` est absent
- une règle portant le même `rule.name` a déjà été enregistrée dans ce gestionnaire
- la compilation de l'expression régulière échoue (`new RegExp(rule.ttsrTrigger)` lève une exception)

Les déclencheurs d'expression régulière invalides sont consignés comme avertissements et ignorés ; le démarrage de la session se poursuit.

### Mise en garde concernant les paramètres

`TtsrSettings.enabled` est chargé dans le gestionnaire mais n'est pas actuellement vérifié lors du contrôle d'exécution. Si des règles existent, la correspondance s'exécute quand même.

## 2. Cycle de vie du moniteur de flux

La détection TTSR s'exécute dans `AgentSession.#handleAgentEvent`.

### Début de tour

Sur `turn_start`, le tampon de flux est réinitialisé :

- `ttsrManager.resetBuffer()`

### Pendant le flux (`message_update`)

Lorsque des mises à jour de l'assistant arrivent et que des règles existent :

- surveille `text_delta` et `toolcall_delta`
- ajoute le delta dans le tampon du gestionnaire
- appelle `check(buffer)`

`check()` parcourt les règles enregistrées et retourne toutes les règles correspondantes qui satisfont la politique de répétition (`#canTrigger`).

## 3. Décision de déclenchement et chemin d'abandon immédiat

Lorsqu'une ou plusieurs règles correspondent :

1. `markInjected(matches)` enregistre les noms de règles dans l'état d'injection du gestionnaire.
2. les règles correspondantes sont mises en file d'attente dans `#pendingTtsrInjections`.
3. `#ttsrAbortPending = true`.
4. `agent.abort()` est appelé immédiatement.
5. l'événement `ttsr_triggered` est émis de manière asynchrone (fire-and-forget).
6. le travail de nouvelle tentative est planifié via `setTimeout(..., 50)`.

L'abandon n'est pas bloqué sur les rappels d'extension.

## 4. Planification des nouvelles tentatives, mode de contexte et injection de rappel

Après le délai de 50ms :

1. `#ttsrAbortPending = false`
2. lecture de `ttsrManager.getSettings().contextMode`
3. si `contextMode === "discard"`, suppression de la sortie partielle de l'assistant avec `agent.popMessage()`
4. construction du contenu d'injection à partir des règles en attente en utilisant le modèle `ttsr-interrupt.md`
5. ajout d'un message utilisateur synthétique contenant un bloc `<system-interrupt ...>` par règle
6. appel de `agent.continue()` pour relancer la génération

Le contenu du modèle est :

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

Les injections en attente sont effacées après la génération du contenu.

### Comportement de `contextMode` sur la sortie partielle

- `discard` : le message partiel/abandonné de l'assistant est supprimé avant la nouvelle tentative.
- `keep` : la sortie partielle de l'assistant reste dans l'état de conversation ; le rappel est ajouté après.

## 5. Politique de répétition et logique d'intervalle

`TtsrManager` suit `#messageCount` et `lastInjectedAt` par règle.

### `repeatMode: "once"`

Une règle ne peut se déclencher qu'une seule fois après avoir un enregistrement d'injection.

### `repeatMode: "after-gap"`

Une règle peut se redéclencher uniquement lorsque :

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` s'incrémente sur `turn_end`, donc l'intervalle est mesuré en tours complétés, et non en fragments de flux.

## 6. Émission d'événements et surfaces d'extension/hook

### Événement de session

`AgentSessionEvent` inclut :

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### Exécuteur d'extensions

`#emitSessionEvent()` route l'événement vers :

- les écouteurs d'extensions (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- les abonnés locaux de la session

### Typage des hooks et outils personnalisés

- l'API d'extension expose `on("ttsr_triggered", ...)`
- l'API de hook expose `on("ttsr_triggered", ...)`
- les outils personnalisés reçoivent `onSession({ reason: "ttsr_triggered", rules })`

### Différence de rendu en mode interactif

Le mode interactif utilise `session.isTtsrAbortPending` pour éviter d'afficher la raison d'arrêt de l'assistant abandonné comme un échec visible lors d'une interruption TTSR, et affiche un `TtsrNotificationComponent` lorsque l'événement arrive.

## 7. Persistance et état de reprise (implémentation actuelle)

`SessionManager` dispose d'une prise en charge complète du schéma pour la persistance des règles injectées :

- type d'entrée : `ttsr_injection`
- API d'ajout : `appendTtsrInjection(ruleNames)`
- API de requête : `getInjectedTtsrRules()`
- la reconstruction du contexte inclut `SessionContext.injectedTtsrRules`

`TtsrManager` prend également en charge la restauration via `restoreInjected(ruleNames)`.

### État du câblage actuel

Dans le chemin d'exécution actuel :

- `AgentSession` n'ajoute pas d'entrées `ttsr_injection` lorsque TTSR se déclenche.
- `createAgentSession()` ne restaure pas `existingSession.injectedTtsrRules` dans `ttsrManager`.

Effet net : la suppression des règles injectées est appliquée en mémoire pour le processus en cours, mais n'est pas actuellement persistée/restaurée lors d'un rechargement/reprise de session par ce chemin.

## 8. Limites de concurrence et garanties d'ordre

### Abandon vs rappel de nouvelle tentative

- l'abandon est synchrone du point de vue du gestionnaire TTSR (`agent.abort()` est appelé immédiatement)
- la nouvelle tentative est différée par minuterie (`50ms`)
- la notification d'extension est asynchrone et délibérément non attendue avant la planification de l'abandon/nouvelle tentative

### Correspondances multiples dans la même fenêtre de flux

`check()` retourne toutes les règles éligibles actuellement correspondantes. Elles sont injectées en lot lors du prochain message de nouvelle tentative.

### Entre l'abandon et la continuation

Pendant la fenêtre de minuterie, l'état peut changer (interruption utilisateur, actions de mode, événements supplémentaires). L'appel de nouvelle tentative est au mieux-effort : `agent.continue().catch(() => {})` supprime les erreurs de suivi.

## 9. Résumé des cas limites

- Expression régulière `ttsr_trigger` invalide : ignorée avec avertissement ; les autres règles continuent.
- Noms de règles en double au niveau de la couche de capacité : les doublons de priorité inférieure sont masqués avant l'enregistrement.
- Noms en double au niveau du gestionnaire : le second enregistrement est ignoré.
- `contextMode: "keep"` : la sortie partielle en violation peut rester dans le contexte avant la nouvelle tentative avec rappel.
- La répétition après intervalle dépend des incréments du compteur de tours sur `turn_end` ; les fragments en cours de tour ne font pas avancer les compteurs d'intervalle.
