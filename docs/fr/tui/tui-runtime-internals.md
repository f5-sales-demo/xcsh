---
title: Composants internes du runtime TUI
description: >-
  Composants internes du runtime de l'interface utilisateur en terminal couvrant
  le pipeline de rendu, la gestion des entrées et la gestion d'état.
sidebar:
  order: 2
  label: Composants internes du runtime
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# Composants internes du runtime TUI

Ce document décrit le chemin d'exécution non-thème depuis l'entrée terminal jusqu'à la sortie rendue en mode interactif. Il se concentre sur le comportement dans `packages/tui` et son intégration depuis les contrôleurs de `packages/coding-agent`.

## Couches du runtime et propriété

- **Moteur `packages/tui`** : cycle de vie du terminal, normalisation de stdin, routage du focus, planification du rendu, peinture différentielle, composition des superpositions, positionnement matériel du curseur.
- **Mode interactif de `packages/coding-agent`** : construit l'arbre des composants, lie les rappels de l'éditeur et les mappages de touches, réagit aux événements agent/session, et traduit l'état du domaine (streaming, exécution d'outils, nouvelles tentatives, mode plan) en composants UI.

Règle de délimitation : le moteur TUI est indépendant des messages. Il ne connaît que `Component.render(width)`, `handleInput(data)`, le focus et les superpositions. La sémantique de l'agent reste dans les contrôleurs interactifs.

## Fichiers d'implémentation

- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/components/custom-editor.ts`](../../packages/coding-agent/src/modes/components/custom-editor.ts)
- [`../../tui/src/tui.ts`](../../packages/tui/src/tui.ts)
- [`../../tui/src/terminal.ts`](../../packages/tui/src/terminal.ts)
- [`../../tui/src/editor-component.ts`](../../packages/tui/src/editor-component.ts)
- [`../../tui/src/stdin-buffer.ts`](../../packages/tui/src/stdin-buffer.ts)
- [`../../tui/src/components/loader.ts`](../../packages/tui/src/components/loader.ts)

## Démarrage et assemblage de l'arbre de composants

`InteractiveMode` construit `TUI(new ProcessTerminal(), showHardwareCursor)` et crée des conteneurs persistants :

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (contient `CustomEditor`)

`init()` câble l'arbre dans cet ordre, donne le focus à l'éditeur, enregistre les gestionnaires d'entrée via `InputController`, démarre le TUI et demande un rendu forcé.

Un rendu forcé (`requestRender(true)`) réinitialise les caches de lignes précédentes et la gestion du curseur avant le repeint.

## Cycle de vie du terminal et normalisation de stdin

`ProcessTerminal.start()` :

1. Active le mode brut et le collage entre crochets.
2. Attache le gestionnaire de redimensionnement.
3. Crée un `StdinBuffer` pour découper les fragments d'échappement partiels en séquences complètes.
4. Interroge la prise en charge du protocole clavier Kitty (`CSI ? u`), puis active les indicateurs de protocole si pris en charge.
5. Sous Windows, tente l'activation de l'entrée VT via les indicateurs de mode `kernel32`.

Comportement de `StdinBuffer` :

- Tamponne les séquences d'échappement fragmentées (CSI/OSC/DCS/APC/SS3).
- Émet `data` uniquement lorsqu'une séquence est complète ou vidée par délai d'expiration.
- Détecte le collage entre crochets et émet un événement `paste` avec le texte collé brut.

Cela empêche les fragments d'échappement partiels d'être mal interprétés comme des touches normales.

## Routage des entrées et modèle de focus

Chemin d'entrée :

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Détails du routage :

1. Le TUI exécute d'abord les écouteurs d'entrée enregistrés (`addInputListener`), permettant un comportement de consommation/transformation.
2. Le TUI gère le raccourci de débogage global (`shift+ctrl+d`) avant la distribution aux composants.
3. Si le composant en focus appartient à une superposition désormais masquée/invisible, le TUI réassigne le focus à la prochaine superposition visible ou au focus pré-superposition sauvegardé.
4. Les événements de relâchement de touche sont filtrés, sauf si le composant en focus définit `wantsKeyRelease = true`.
5. Après la distribution, le TUI planifie le rendu.

`setFocus()` active/désactive également `Focusable.focused`, ce qui contrôle si les composants émettent `CURSOR_MARKER` pour le positionnement matériel du curseur.

## Répartition de la gestion des touches : éditeur vs contrôleur

`CustomEditor` intercepte d'abord les combinaisons à haute priorité (échappement, ctrl-c/d/z, ctrl-v, variantes ctrl-p, ctrl-t, alt-haut, touches personnalisées d'extension) et délègue le reste au comportement de base de `Editor` (édition de texte, historique, autocomplétion, déplacement du curseur).

`InputController.setupKeyHandlers()` lie ensuite les rappels de l'éditeur aux actions du mode :

- annulation / sorties de mode sur `Escape`
- arrêt sur double `Ctrl+C` ou `Ctrl+D` avec éditeur vide
- suspension/reprise sur `Ctrl+Z`
- raccourcis de commande slash et sélecteur
- bascules de suivi/défilement et bascules d'expansion

Cela maintient l'analyse des touches et la mécanique de l'éditeur dans `packages/tui` et la sémantique du mode dans les contrôleurs de coding-agent.

## Boucle de rendu et stratégie de diff

`TUI.requestRender()` est soumis à un anti-rebond pour limiter à un rendu par tick en utilisant `process.nextTick`. Plusieurs changements d'état dans le même tour sont fusionnés.

Pipeline de `#doRender()` :

1. Rendu de l'arbre de composants racine vers `newLines`.
2. Composition des superpositions visibles (le cas échéant).
3. Extraction et suppression de `CURSOR_MARKER` des lignes visibles de la fenêtre d'affichage.
4. Ajout de suffixes de réinitialisation de segment pour les lignes sans image.
5. Choix entre repeint complet ou correction différentielle :
   - première image
   - changement de largeur
   - rétrécissement avec `clearOnShrink` activé et sans superpositions
   - modifications au-dessus de la fenêtre d'affichage précédente
6. Pour les mises à jour différentielles, correction uniquement de la plage de lignes modifiées et effacement des lignes finales obsolètes si nécessaire.
7. Repositionnement du curseur matériel pour la prise en charge de l'IME.

Les écritures de rendu utilisent le mode de sortie synchronisée (`CSI ? 2026 h/l`) pour réduire le scintillement/déchirement.

## Contraintes de sûreté du rendu

Vérifications de sûreté critiques dans `TUI` :

- Les lignes rendues sans image ne doivent pas dépasser la largeur du terminal ; un dépassement lève une exception et écrit des diagnostics d'incident.
- La composition des superpositions inclut une troncature défensive et une vérification de largeur post-composition.
- Les changements de largeur forcent un redessin complet car la sémantique du retour à la ligne change.
- La position du curseur est contrainte avant le déplacement.

Ces contraintes constituent une application à l'exécution, et non de simples conventions.

## Gestion du redimensionnement

Les événements de redimensionnement sont pilotés par événements depuis `ProcessTerminal` vers `TUI.requestRender()`.

Effets :

- Tout changement de largeur déclenche un redessin complet.
- Le suivi de la fenêtre d'affichage/du haut (`#previousViewportTop`, `#maxLinesRendered`) évite les calculs de curseur relatifs invalides lors de changements de contenu ou de taille du terminal.
- La visibilité des superpositions peut dépendre des dimensions du terminal (`OverlayOptions.visible`) ; le focus est corrigé lorsque les superpositions deviennent non visibles après redimensionnement.

## Streaming et mises à jour UI incrémentales

`EventController` s'abonne aux `AgentSessionEvent` et met à jour l'UI de manière incrémentale :

- `agent_start` : démarre le chargeur dans `statusContainer`.
- `message_start` assistant : crée `streamingComponent` et le monte.
- `message_update` : met à jour le contenu assistant en streaming ; crée/met à jour les composants d'exécution d'outils au fur et à mesure que les appels d'outils apparaissent.
- `tool_execution_update/end` : met à jour les composants de résultat d'outil et l'état de complétion.
- `message_end` : finalise le flux assistant, gère les annotations abandonnées/erreur, marque les arguments d'outil en attente comme complets lors d'un arrêt normal.
- `agent_end` : arrête les chargeurs, efface l'état du flux transitoire, vide le changement de modèle différé, émet une notification de complétion si mis en arrière-plan.

Le regroupement des outils de lecture est intentionnellement avec état (`#lastReadGroup`) pour fusionner les appels d'outils de lecture consécutifs en un seul bloc visuel jusqu'à ce qu'une interruption non-lecture se produise.

## Orchestration du statut et du chargeur

Propriété de la voie de statut :

- `statusContainer` contient les chargeurs transitoires (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` affiche les indicateurs de statut/hooks/plan persistants et pilote les mises à jour de bordure supérieure de l'éditeur.

Comportement du chargeur :

- `Loader` se met à jour toutes les 80 ms via un intervalle et demande un rendu à chaque image.
- Les gestionnaires d'échappement sont temporairement remplacés pendant la compaction automatique et la nouvelle tentative automatique pour annuler ces opérations.
- Sur les chemins de fin/annulation, les contrôleurs restaurent les gestionnaires d'échappement précédents et arrêtent/effacent les composants du chargeur.

## Transitions de mode et mise en arrière-plan

### Modes d'entrée Bash/Python

Les préfixes de texte d'entrée basculent les indicateurs de mode de bordure de l'éditeur :

- `!` -> mode bash
- `$` (préfixe non-littéral de template) -> mode python

L'échappement quitte le mode inactif en effaçant le texte de l'éditeur et en restaurant la couleur de la bordure ; lorsque l'exécution est active, l'échappement abandonne la tâche en cours à la place.

### Mode plan

`InteractiveMode` suit les indicateurs de mode plan, l'état de la ligne de statut, les outils actifs et le changement de modèle. L'entrée/sortie met à jour les entrées de mode de session et l'état du statut/UI, y compris le changement de modèle différé si le streaming est actif.

### Suspension/reprise (`Ctrl+Z`)

`InputController.handleCtrlZ()` :

1. Enregistre un gestionnaire `SIGCONT` à usage unique pour redémarrer le TUI et forcer le rendu.
2. Arrête le TUI avant la suspension.
3. Envoie `SIGTSTP` au groupe de processus.

### Mode arrière-plan (`/background` ou `/bg`)

`handleBackgroundCommand()` :

- Rejette lorsqu'inactif.
- Bascule le contexte UI des outils vers non-interactif (`hasUI=false`) afin que les outils UI interactifs échouent rapidement.
- Arrête les chargeurs/la ligne de statut et se désabonne du gestionnaire d'événements au premier plan.
- S'abonne au gestionnaire d'événements en arrière-plan (attend principalement `agent_end`).
- Arrête le TUI et envoie `SIGTSTP` (chemin de contrôle de tâche POSIX).

Sur `agent_end` en arrière-plan sans travail en file d'attente, le contrôleur envoie une notification de complétion et s'arrête.

## Chemins d'annulation

Entrées d'annulation principales :

- `Escape` pendant le chargeur de flux actif : restaure les messages en file d'attente dans l'éditeur et abandonne l'agent.
- `Escape` pendant l'exécution bash/python : abandonne la commande en cours.
- `Escape` pendant la compaction automatique/nouvelle tentative : invoque des méthodes d'abandon dédiées via des gestionnaires d'échappement temporaires.
- `Ctrl+C` pression unique : effacer l'éditeur ; double pression dans les 500 ms : arrêt.

L'annulation est conditionnelle à l'état ; la même touche peut signifier abandon, sortie de mode, déclencheur de sélecteur ou aucune action selon l'état du runtime.

## Comportement piloté par événements vs comportement à débit limité

Mises à jour pilotées par événements :

- Événements de session agent (`EventController`)
- Rappels d'entrée de touches (`InputController`)
- Rappel de redimensionnement du terminal
- Observateurs de thème/branche dans `InteractiveMode`

Chemins à débit limité/anti-rebond :

- Le rendu TUI est soumis à un anti-rebond par tick (fusion de `requestRender`).
- L'animation du chargeur est à intervalle fixe (80 ms), chaque image demandant un rendu.
- Les mises à jour d'autocomplétion de l'éditeur (dans `Editor`) utilisent des minuteries anti-rebond, réduisant le recalcul excessif lors de la frappe.

Le runtime combine donc des transitions d'état pilotées par événements avec une cadence de rendu bornée pour maintenir l'interactivité réactive sans tempêtes de repeint.
