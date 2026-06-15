---
title: Pipeline de génération de transfert
description: >-
  Pipeline de génération de transfert pour créer des résumés de session
  portables pour la collaboration en équipe.
sidebar:
  order: 8
  label: Pipeline de transfert
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# Pipeline de génération `/handoff`

Ce document décrit comment l'agent de codage implémente `/handoff` aujourd'hui : chemin de déclenchement, invite de génération, capture de la complétion, changement de session et réinjection du contexte.

## Périmètre

Couvre :

- La distribution de la commande interactive `/handoff`
- Le cycle de vie et les transitions d'état de `AgentSession.handoff()`
- La façon dont la sortie du transfert est capturée depuis la sortie de l'assistant
- La façon dont les anciennes et nouvelles sessions persistent les données de transfert différemment
- Le comportement de l'interface utilisateur en cas de succès, d'annulation et d'échec

Ne couvre pas :

- La navigation générique dans l'arbre / les mécanismes internes des branches
- Les commandes de session autres que le transfert (`/new`, `/fork`, `/resume`)

## Fichiers d'implémentation

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## Chemin de déclenchement

1. `/handoff` est déclaré dans les métadonnées des commandes slash intégrées (`slash-commands.ts`) avec une indication en ligne optionnelle : `[focus instructions]`.
2. Dans la gestion des entrées interactives (`InputController`), le texte de soumission correspondant à `/handoff` ou `/handoff ...` est intercepté avant la soumission normale de l'invite.
3. L'éditeur est effacé et `handleHandoffCommand(customInstructions?)` est appelé.
4. `CommandController.handleHandoffCommand` effectue une vérification préalable en utilisant les entrées courantes :
   - Compte les entrées `type === "message"`.
   - Si `< 2`, un avertissement est émis : `Nothing to hand off (no messages yet)` et la fonction retourne.

La même vérification de contenu minimal existe à nouveau dans `AgentSession.handoff()` et lève une exception si la condition n'est pas satisfaite. Cette mesure de sécurité est dupliquée à la fois au niveau de l'interface utilisateur et au niveau de la session.

## Cycle de vie de bout en bout

### 1) Démarrage de la génération du transfert

`AgentSession.handoff(customInstructions?)` :

- Lit les entrées de la branche courante (`sessionManager.getBranch()`)
- Valide le nombre minimal de messages (`>= 2`)
- Crée `#handoffAbortController`
- Construit une invite fixe et intégrée demandant un document de transfert structuré (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- Ajoute `Additional focus: ...` si des instructions personnalisées sont fournies

L'invite est envoyée via :

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` empêche l'expansion des modèles de slash/invite de cette charge utile d'instruction interne.

### 2) Capture de la complétion

Avant l'envoi de l'invite, `handoff()` s'abonne aux événements de session et attend `agent_end`.

À la réception de `agent_end`, il extrait le texte du transfert depuis l'état de l'agent en parcourant à rebours pour trouver le message `assistant` le plus récent, puis en concaténant tous les blocs `content` où `type === "text"` avec `\n`.

Hypothèses importantes concernant l'extraction :

- Seuls les blocs de texte sont utilisés ; le contenu non textuel est ignoré.
- On suppose que le dernier message de l'assistant correspond à la génération du transfert.
- Il n'analyse pas les sections markdown ni ne valide la conformité au format.
- Si la sortie de l'assistant ne contient pas de blocs de texte, le transfert est considéré comme manquant.

### 3) Vérifications d'annulation

`handoff()` retourne `undefined` lorsque l'une ou l'autre des conditions suivantes est vérifiée :

- aucun texte de transfert capturé, ou
- `#handoffAbortController.signal.aborted` est vrai

Il efface toujours `#handoffAbortController` dans `finally`.

### 4) Création d'une nouvelle session

Si du texte a été capturé et que l'opération n'a pas été abandonnée :

1. Vider l'enregistreur de la session courante (`sessionManager.flush()`)
2. Démarrer une toute nouvelle session (`sessionManager.newSession()`)
3. Réinitialiser l'état de l'agent en mémoire (`agent.reset()`)
4. Relier `agent.sessionId` au nouvel identifiant de session
5. Vider les tableaux de contexte en attente (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. Réinitialiser le compteur de rappel des tâches

`newSession()` crée un nouvel en-tête et une liste d'entrées vide (la feuille est réinitialisée à `null`). Dans le chemin de transfert, aucun `parentSession` n'est passé.

### 5) Injection du contexte de transfert

Le document de transfert généré est encapsulé et ajouté à la nouvelle session en tant qu'entrée `custom_message` :

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
- `display` : `true` (visible lors de la reconstruction TUI)
- Type d'entrée : `custom_message` (participe au contexte LLM)

### 6) Reconstruction du contexte actif de l'agent

Après l'injection :

1. `sessionManager.buildSessionContext()` résout la liste des messages pour la feuille courante
2. `agent.replaceMessages(sessionContext.messages)` rend le message de transfert injecté actif dans le contexte
3. La méthode retourne `{ document: handoffText }`

À ce stade, le contexte LLM actif dans la nouvelle session contient le message de transfert injecté, et non l'ancienne transcription.

## Modèle de persistance : ancienne session vs nouvelle session

### Ancienne session

Durant la génération, la persistance normale des messages reste active. La réponse de transfert de l'assistant est persistée en tant qu'entrée `message` ordinaire lors de `message_end`.

Résultat : la session d'origine contient le transfert généré visible dans la transcription historique.

### Nouvelle session

Après la réinitialisation de la session, le transfert est persisté en tant que `custom_message` avec `customType: "handoff"`.

`buildSessionContext()` convertit cette entrée en un message de contexte personnalisé/utilisateur à l'exécution via `createCustomMessage(...)`, afin qu'il soit inclus dans les futures invites de la nouvelle session.

## Comportement du contrôleur / interface utilisateur

Comportement de `CommandController.handleHandoffCommand` :

- Appelle `await session.handoff(customInstructions)`
- Si le résultat est `undefined` : `showError("Handoff cancelled")`
- En cas de succès :
  - `rebuildChatFromMessages()` (charge le nouveau contexte de session, incluant le transfert injecté)
  - invalide la barre de statut et la bordure supérieure de l'éditeur
  - recharge les tâches
  - ajoute une ligne de chat de succès : `New session started with handoff context`
- En cas d'exception :
  - si le message est `"Handoff cancelled"` ou si le nom de l'erreur est `AbortError` : `showError("Handoff cancelled")`
  - sinon : `showError("Handoff failed: <message>")`
- Demande un rendu à la fin

## Sémantique d'annulation (comportement actuel)

### Primitive d'annulation au niveau de la session

`AgentSession` expose :

- `abortHandoff()` → abandonne `#handoffAbortController`
- `isGeneratingHandoff` → vrai tant que le contrôleur existe

Lorsque ce chemin d'abandon est utilisé, l'abonné au transfert rejette avec `Error("Handoff cancelled")`, et le contrôleur de commande le mappe vers l'interface utilisateur d'annulation.

### Limitation du chemin interactif `/handoff`

Dans le câblage actuel du contrôleur interactif, `/handoff` n'installe pas de gestionnaire Escape dédié qui appelle `abortHandoff()` (contrairement aux chemins de compactage/résumé de branche qui remplacent temporairement `editor.onEscape`).

Impact pratique :

- Il existe une prise en charge de l'annulation au niveau de la session, mais aucun raccourci clavier spécifique au transfert dans le chemin de la commande `/handoff`.
- L'interruption par l'utilisateur peut toujours se produire via des chemins d'abandon d'agent plus larges, mais ce n'est pas le même canal d'annulation explicite utilisé par `abortHandoff()`.

## Transfert abandonné vs transfert échoué

Classification actuelle dans l'interface utilisateur :

- **Abandonné/annulé**
  - Le chemin `abortHandoff()` déclenche `"Handoff cancelled"`, ou
  - une `AbortError` est levée
  - L'interface utilisateur affiche `Handoff cancelled`

- **Échoué**
  - toute autre erreur levée par `handoff()` / le pipeline d'invite (erreurs de validation de modèle/API, exceptions à l'exécution, etc.)
  - L'interface utilisateur affiche `Handoff failed: ...`

Nuance supplémentaire : si la génération se termine mais qu'aucun texte n'est extrait, `handoff()` retourne `undefined` et le contrôleur signale actuellement **annulé**, et non **échoué**.

## Protections pour les sessions courtes et le contenu minimal

Deux protections empêchent les transferts à faible signal :

- Couche interface utilisateur (`handleHandoffCommand`) : avertit et retourne prématurément si `< 2` entrées de message
- Couche session (`handoff()`) : lève la même condition en tant qu'erreur

Cela évite de créer une nouvelle session avec un contexte de transfert vide ou quasi-vide.

## Résumé des transitions d'état

Flux d'état de haut niveau :

1. Commande slash interactive interceptée
2. Vérification préalable du nombre de messages
3. `#handoffAbortController` créé (`isGeneratingHandoff = true`)
4. Invite de transfert interne soumise (visible dans le chat comme une génération normale de l'assistant)
5. À la réception de `agent_end`, le dernier texte de l'assistant est extrait
6. Si manquant/abandonné → retourner `undefined` ou chemin d'erreur d'annulation
7. Si présent :
   - vider l'ancienne session
   - créer une nouvelle session vide
   - réinitialiser les files d'attente/compteurs à l'exécution
   - ajouter `custom_message(handoff)`
   - reconstruire et remplacer les messages actifs de l'agent
8. Le contrôleur reconstruit l'interface de chat et annonce le succès
9. `#handoffAbortController` effacé (`isGeneratingHandoff = false`)

## Hypothèses et limitations connues

- L'extraction du transfert est heuristique : « derniers blocs de texte de l'assistant » ; aucune validation structurelle.
- Aucune vérification stricte que le markdown généré suit le format de section demandé.
- Le texte extrait manquant est signalé comme une annulation dans l'expérience utilisateur du contrôleur.
- Le flux interactif `/handoff` manque actuellement d'une liaison Escape→`abortHandoff()` dédiée.
- Les métadonnées de lignée de la nouvelle session (`parentSession`) ne sont pas définies par ce chemin.
