---
title: Handoff Generation Pipeline
description: >-
  Handoff generation pipeline for creating portable session summaries for team
  collaboration.
sidebar:
  order: 8
  label: Pipeline de handoff
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# Pipeline de génération `/handoff`

Ce document décrit comment le coding-agent implémente `/handoff` aujourd'hui : chemin de déclenchement, prompt de génération, capture de la complétion, changement de session et réinjection du contexte.

## Périmètre

Couvre :

- Le dispatch de la commande interactive `/handoff`
- Le cycle de vie et les transitions d'état de `AgentSession.handoff()`
- Comment la sortie du handoff est capturée depuis la sortie de l'assistant
- Comment les anciennes/nouvelles sessions persistent les données de handoff différemment
- Le comportement de l'interface utilisateur en cas de succès, annulation et échec

Ne couvre pas :

- Les mécanismes internes de navigation/branchement de l'arbre générique
- Les commandes de session non liées au handoff (`/new`, `/fork`, `/resume`)

## Fichiers d'implémentation

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## Chemin de déclenchement

1. `/handoff` est déclaré dans les métadonnées des commandes slash intégrées (`slash-commands.ts`) avec un indicateur en ligne optionnel : `[focus instructions]`.
2. Dans la gestion des entrées interactives (`InputController`), le texte soumis correspondant à `/handoff` ou `/handoff ...` est intercepté avant la soumission normale du prompt.
3. L'éditeur est vidé et `handleHandoffCommand(customInstructions?)` est appelé.
4. `CommandController.handleHandoffCommand` effectue une vérification préalable en utilisant les entrées courantes :
   - Compte les entrées de `type === "message"`.
   - Si `< 2`, il avertit : `Nothing to hand off (no messages yet)` et retourne.

La même vérification de contenu minimal existe également dans `AgentSession.handoff()` et lève une exception si elle est violée. Cela duplique la sécurité aux couches UI et session.

## Cycle de vie de bout en bout

### 1) Démarrage de la génération du handoff

`AgentSession.handoff(customInstructions?)` :

- Lit les entrées de la branche courante (`sessionManager.getBranch()`)
- Valide le nombre minimum de messages (`>= 2`)
- Crée `#handoffAbortController`
- Construit un prompt fixe en ligne demandant un document de handoff structuré (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- Ajoute `Additional focus: ...` si des instructions personnalisées sont fournies

Le prompt est envoyé via :

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` empêche l'expansion des slash/prompt-templates de cette charge utile d'instruction interne.

### 2) Capture de la complétion

Avant l'envoi du prompt, `handoff()` s'abonne aux événements de session et attend `agent_end`.

À l'événement `agent_end`, il extrait le texte du handoff depuis l'état de l'agent en parcourant à rebours le message `assistant` le plus récent, puis en concaténant tous les blocs `content` où `type === "text"` avec `\n`.

Hypothèses importantes de l'extraction :

- Seuls les blocs de texte sont utilisés ; le contenu non textuel est ignoré.
- Il suppose que le dernier message de l'assistant correspond à la génération du handoff.
- Il ne parse pas les sections markdown et ne valide pas la conformité au format.
- Si la sortie de l'assistant n'a pas de blocs de texte, le handoff est traité comme manquant.

### 3) Vérifications d'annulation

`handoff()` retourne `undefined` lorsque l'une des conditions suivantes est vraie :

- pas de texte de handoff capturé, ou
- `#handoffAbortController.signal.aborted` est vrai

Il efface toujours `#handoffAbortController` dans le bloc `finally`.

### 4) Création de la nouvelle session

Si le texte a été capturé et non annulé :

1. Purge l'écrivain de la session courante (`sessionManager.flush()`)
2. Démarre une toute nouvelle session (`sessionManager.newSession()`)
3. Réinitialise l'état de l'agent en mémoire (`agent.reset()`)
4. Réaffecte `agent.sessionId` au nouvel identifiant de session
5. Vide les tableaux de contexte en file d'attente (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. Réinitialise le compteur de rappels todo

`newSession()` crée un en-tête vierge et une liste d'entrées vide (feuille réinitialisée à `null`). Dans le chemin du handoff, aucun `parentSession` n'est passé.

### 5) Injection du contexte de handoff

Le document de handoff généré est encapsulé et ajouté à la nouvelle session en tant qu'entrée `custom_message` :

```text
<handoff-context>
...handoff text...
</handoff-context>

The above is a handoff document from a previous session. Use this context to continue the work seamlessly.
```

Appel d'insertion :

```ts
this.sessionManager.appendCustomMessageEntry("handoff", handoffContent, true);
```

Sémantique :

- `customType` : `"handoff"`
- `display` : `true` (visible lors de la reconstruction de l'interface TUI)
- Type d'entrée : `custom_message` (participe au contexte LLM)

### 6) Reconstruction du contexte actif de l'agent

Après l'injection :

1. `sessionManager.buildSessionContext()` résout la liste de messages pour la feuille courante
2. `agent.replaceMessages(sessionContext.messages)` rend le message de handoff injecté comme contexte actif
3. La méthode retourne `{ document: handoffText }`

À ce stade, le contexte LLM actif dans la nouvelle session contient le message de handoff injecté, et non l'ancien transcript.

## Modèle de persistance : ancienne session vs nouvelle session

### Ancienne session

Pendant la génération, la persistance normale des messages reste active. La réponse de handoff de l'assistant est persistée comme une entrée `message` régulière lors de `message_end`.

Résultat : la session originale contient le handoff généré visible comme partie du transcript historique.

### Nouvelle session

Après la réinitialisation de la session, le handoff est persisté en tant que `custom_message` avec `customType: "handoff"`.

`buildSessionContext()` convertit cette entrée en un message de contexte personnalisé/utilisateur à l'exécution via `createCustomMessage(...)`, de sorte qu'il est inclus dans les futurs prompts de la nouvelle session.

## Comportement du contrôleur/de l'interface utilisateur

Comportement de `CommandController.handleHandoffCommand` :

- Appelle `await session.handoff(customInstructions)`
- Si le résultat est `undefined` : `showError("Handoff cancelled")`
- En cas de succès :
  - `rebuildChatFromMessages()` (charge le contexte de la nouvelle session, incluant le handoff injecté)
  - Invalide la ligne de statut et la bordure supérieure de l'éditeur
  - Recharge les todos
  - Ajoute une ligne de chat de succès : `New session started with handoff context`
- En cas d'exception :
  - si le message est `"Handoff cancelled"` ou le nom de l'erreur est `AbortError` : `showError("Handoff cancelled")`
  - sinon : `showError("Handoff failed: <message>")`
- Demande un rendu à la fin

## Sémantique d'annulation (comportement actuel)

### Primitive d'annulation au niveau de la session

`AgentSession` expose :

- `abortHandoff()` → annule `#handoffAbortController`
- `isGeneratingHandoff` → vrai tant que le contrôleur existe

Lorsque ce chemin d'annulation est utilisé, l'abonné au handoff rejette avec `Error("Handoff cancelled")`, et le contrôleur de commande mappe cela vers l'interface utilisateur d'annulation.

### Limitation du chemin interactif `/handoff`

Dans le câblage actuel du contrôleur interactif, `/handoff` n'installe pas de gestionnaire Escape dédié qui appelle `abortHandoff()` (contrairement aux chemins de compaction/résumé de branche qui surchargent temporairement `editor.onEscape`).

Impact pratique :

- Il y a un support d'annulation au niveau de la session, mais pas de liaison de touche spécifique au handoff dans le chemin de la commande `/handoff`.
- L'interruption par l'utilisateur peut toujours se produire via les chemins d'annulation plus larges de l'agent, mais ce n'est pas le même canal d'annulation explicite utilisé par `abortHandoff()`.

## Handoff annulé vs échoué

Classification actuelle de l'interface utilisateur :

- **Annulé**
  - Le chemin `abortHandoff()` déclenche `"Handoff cancelled"`, ou
  - `AbortError` levé
  - L'interface affiche `Handoff cancelled`

- **Échoué**
  - Toute autre erreur levée depuis `handoff()` / le pipeline de prompts (erreurs de validation modèle/API, exceptions à l'exécution, etc.)
  - L'interface affiche `Handoff failed: ...`

Nuance supplémentaire : si la génération se termine mais qu'aucun texte n'est extrait, `handoff()` retourne `undefined` et le contrôleur signale actuellement **annulé**, et non **échoué**.

## Garde-fous de session courte et de contenu minimal

Deux gardes empêchent les handoffs à faible signal :

- Couche UI (`handleHandoffCommand`) : avertit et retourne tôt pour `< 2` entrées de messages
- Couche session (`handoff()`) : lève la même condition en tant qu'erreur

Cela évite de créer une nouvelle session avec un contexte de handoff vide ou quasi-vide.

## Résumé des transitions d'état

Flux d'état de haut niveau :

1. Commande slash interactive interceptée
2. Vérification préalable du nombre de messages
3. `#handoffAbortController` créé (`isGeneratingHandoff = true`)
4. Prompt de handoff interne soumis (visible dans le chat comme une génération normale de l'assistant)
5. À l'événement `agent_end`, les derniers blocs de texte de l'assistant sont extraits
6. Si manquant/annulé → retourne `undefined` ou chemin d'erreur d'annulation
7. Si présent :
   - purge l'ancienne session
   - crée une nouvelle session vide
   - réinitialise les files d'attente/compteurs à l'exécution
   - ajoute `custom_message(handoff)`
   - reconstruit et remplace les messages actifs de l'agent
8. Le contrôleur reconstruit l'interface de chat et annonce le succès
9. `#handoffAbortController` effacé (`isGeneratingHandoff = false`)

## Hypothèses et limitations connues

- L'extraction du handoff est heuristique : « derniers blocs de texte de l'assistant » ; aucune validation structurelle.
- Pas de vérification stricte que le markdown généré suit le format de section demandé.
- Un texte extrait manquant est signalé comme annulation dans l'expérience utilisateur du contrôleur.
- Le flux interactif `/handoff` manque actuellement d'une liaison dédiée Escape→`abortHandoff()`.
- Les métadonnées de lignée de la nouvelle session (`parentSession`) ne sont pas définies par ce chemin.
