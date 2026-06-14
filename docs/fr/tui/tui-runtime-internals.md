---
title: Rouages internes du runtime TUI
description: >-
  Rouages internes du runtime de l'interface terminal couvrant le pipeline de
  rendu, la gestion des entrées et la gestion d'état.
sidebar:
  order: 2
  label: Rouages internes du runtime
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# Rouages internes du runtime TUI

Ce document décrit le chemin d'exécution non thématique, de l'entrée terminal jusqu'à la sortie rendue en mode interactif. Il se concentre sur le comportement de `packages/tui` et son intégration depuis les contrôleurs de `packages/coding-agent`.

## Couches du runtime et responsabilités

- **Moteur `packages/tui`** : cycle de vie du terminal, normalisation de stdin, routage du focus, planification du rendu, peinture différentielle, composition des overlays, positionnement matériel du curseur.
- **Mode interactif de `packages/coding-agent`** : construit l'arbre de Composants, lie les callbacks de l'éditeur et les raccourcis clavier, réagit aux événements agent/session, et traduit l'état du domaine (streaming, exécution d'outils, relances, mode plan) en Composants UI.

Règle de délimitation : le moteur TUI est indépendant des messages. Il ne connaît que `Component.render(width)`, `handleInput(data)`, le focus et les overlays. La sémantique agent reste dans les contrôleurs interactifs.

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

## Démarrage et assemblage de l'arbre de Composants

`InteractiveMode` construit `TUI(new ProcessTerminal(), showHardwareCursor)` et crée des conteneurs persistants :

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (contient `CustomEditor`)

`init()` câble l'arbre dans cet ordre, donne le focus à l'éditeur, enregistre les gestionnaires d'entrées via `InputController`, démarre le TUI et demande un rendu forcé.

Un rendu forcé (`requestRender(true)`) réinitialise les caches de lignes précédentes et la gestion du curseur avant de repeindre.

## Cycle de vie du terminal et normalisation de stdin

`ProcessTerminal.start()` :

1. Active le mode raw et le collage entre crochets (bracketed paste).
2. Attache le gestionnaire de redimensionnement.
3. Crée un `StdinBuffer` pour découper les fragments d'échappement partiels en séquences complètes.
4. Interroge la prise en charge du protocole clavier Kitty (`CSI ? u`), puis active les indicateurs de protocole si pris en charge.
5. Sous Windows, tente l'activation de l'entrée VT via les indicateurs de mode `kernel32`.

Comportement de `StdinBuffer` :

- Met en mémoire tampon les séquences d'échappement fragmentées (CSI/OSC/DCS/APC/SS3).
- Émet `data` uniquement lorsqu'une séquence est complète ou vidée après expiration du délai.
- Détecte le collage entre crochets et émet un événement `paste` avec le texte collé brut.

Cela évite que des fragments d'échappement partiels soient mal interprétés comme des frappes de touches normales.

## Routage des entrées et modèle de focus

Chemin d'entrée :

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Détails du routage :

1. Le TUI exécute d'abord les écouteurs d'entrée enregistrés (`addInputListener`), ce qui permet un comportement de consommation/transformation.
2. Le TUI gère le raccourci de débogage global (`shift+ctrl+d`) avant la distribution aux Composants.
3. Si le Composant focalisé appartient à un overlay désormais caché/invisible, le TUI réassigne le focus au prochain overlay visible ou au focus pré-overlay sauvegardé.
4. Les événements de relâchement de touche sont filtrés, sauf si le Composant focalisé définit `wantsKeyRelease = true`.
5. Après la distribution, le TUI planifie un rendu.

`setFocus()` bascule également `Focusable.focused`, ce qui contrôle si les Composants émettent `CURSOR_MARKER` pour le positionnement matériel du curseur.

## Répartition de la gestion des touches : éditeur vs contrôleur

`CustomEditor` intercepte en priorité les combinaisons de haute priorité (échap, ctrl-c/d/z, ctrl-v, variantes ctrl-p, ctrl-t, alt-haut, touches personnalisées d'extension) et délègue le reste au comportement de base de `Editor` (édition de texte, historique, autocomplétion, déplacement du curseur).

`InputController.setupKeyHandlers()` lie ensuite les callbacks de l'éditeur aux actions du mode :

- annulation / sorties de mode sur `Escape`
- arrêt sur double `Ctrl+C` ou `Ctrl+D` avec éditeur vide
- suspension/reprise sur `Ctrl+Z`
- raccourcis de commande slash et de sélecteur
- bascules de suivi/défilement et bascules d'expansion

Cela maintient l'analyse des touches et les mécanismes de l'éditeur dans `packages/tui`, tandis que la sémantique du mode reste dans les contrôleurs coding-agent.

## Boucle de rendu et stratégie de différentiel

`TUI.requestRender()` est dé-rebondi à un rendu par tick via `process.nextTick`. Les modifications d'état multiples dans le même tour sont fusionnées.

Pipeline de `#doRender()` :

1. Rend l'arbre de Composants racine dans `newLines`.
2. Compose les overlays visibles (le cas échéant).
3. Extrait et supprime `CURSOR_MARKER` des lignes de la fenêtre visible.
4. Ajoute les suffixes de réinitialisation de segment pour les lignes sans image.
5. Choisit entre une repeinture complète et un patch différentiel :
   - première image
   - changement de largeur
   - rétrécissement avec `clearOnShrink` activé et sans overlay
   - modifications au-dessus de la fenêtre précédente
6. Pour les mises à jour différentielles, ne patche que la plage de lignes modifiées et efface les lignes traînantes obsolètes si nécessaire.
7. Repositionne le curseur matériel pour la prise en charge de l'IME.

Les écritures de rendu utilisent le mode de sortie synchronisée (`CSI ? 2026 h/l`) pour réduire le scintillement et le déchirement.

## Contraintes de sécurité du rendu

Vérifications de Sécurité critiques dans `TUI` :

- Les lignes rendues sans image ne doivent pas dépasser la largeur du terminal ; un dépassement génère une exception et écrit des diagnostics d'incident.
- La composition des overlays inclut une troncature défensive et une vérification de la largeur après composition.
- Les changements de largeur forcent un redessin complet car la sémantique du retour à la ligne change.
- La position du curseur est limitée avant le déplacement.

Ces contraintes sont une application à l'exécution, pas de simples conventions.

## Gestion du redimensionnement

Les événements de redimensionnement sont pilotés par les événements, de `ProcessTerminal` vers `TUI.requestRender()`.

Effets :

- Tout changement de largeur déclenche un redessin complet.
- Le suivi de la fenêtre/position haute (`#previousViewportTop`, `#maxLinesRendered`) évite les calculs de curseur relatif invalides lorsque le contenu ou la taille du terminal change.
- La visibilité des overlays peut dépendre des dimensions du terminal (`OverlayOptions.visible`) ; le focus est corrigé lorsque les overlays deviennent non visibles après redimensionnement.

## Streaming et mises à jour UI incrémentales

`EventController` s'abonne à `AgentSessionEvent` et met à jour l'UI de manière incrémentale :

- `agent_start` : démarre le chargeur dans `statusContainer`.
- `message_start` assistant : crée `streamingComponent` et le monte.
- `message_update` : met à jour le contenu assistant en streaming ; crée/met à jour les Composants d'exécution d'outils à mesure que les appels d'outils apparaissent.
- `tool_execution_update/end` : met à jour les Composants de résultat d'outil et l'état de complétion.
- `message_end` : finalise le flux assistant, gère les annotations d'abandon/d'erreur, marque les arguments d'outil en attente comme complets à l'arrêt normal.
- `agent_end` : arrête les chargeurs, efface l'état de flux transitoire, vide le changement de modèle différé, émet une notification de complétion si en arrière-plan.

Le regroupement des outils de lecture est intentionnellement avec état (`#lastReadGroup`) pour fusionner les appels d'outils de lecture consécutifs en un seul bloc visuel jusqu'à ce qu'une interruption non-lecture se produise.

## Orchestration de l'état et des chargeurs

Propriété de la voie d'état :

- `statusContainer` contient les chargeurs transitoires (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` rend les indicateurs d'état/hooks/plan persistants et pilote les mises à jour de la bordure supérieure de l'éditeur.

Comportement des chargeurs :

- `Loader` se met à jour toutes les 80 ms via un intervalle et demande un rendu à chaque image.
- Les gestionnaires d'échappement sont temporairement surchargés pendant la compaction automatique et la relance automatique pour annuler ces opérations.
- Sur les chemins de fin/annulation, les contrôleurs restaurent les gestionnaires d'échappement précédents et arrêtent/effacent les Composants chargeur.

## Transitions de mode et mise en arrière-plan

### Modes d'entrée Bash/Python

Les préfixes de texte d'entrée basculent les indicateurs de mode de bordure de l'éditeur :

- `!` -> mode bash
- `$` (préfixe non littéral de gabarit) -> mode python

L'échappement quitte le mode inactif en effaçant le texte de l'éditeur et en restaurant la couleur de la bordure ; lorsque l'exécution est active, l'échappement abandonne la tâche en cours à la place.

### Mode plan

`InteractiveMode` suit les indicateurs de mode plan, l'état de la ligne d'état, les Outils actifs et la commutation de modèle. L'entrée/sortie met à jour les entrées de mode de session et l'état état/UI, y compris le changement de modèle différé si le streaming est actif.

### Suspension/reprise (`Ctrl+Z`)

`InputController.handleCtrlZ()` :

1. Enregistre un gestionnaire `SIGCONT` à usage unique pour redémarrer le TUI et forcer le rendu.
2. Arrête le TUI avant la suspension.
3. Envoie `SIGTSTP` au groupe de processus.

### Mode arrière-plan (`/background` ou `/bg`)

`handleBackgroundCommand()` :

- Rejette lorsqu'inactif.
- Bascule le contexte UI des Outils vers non-interactif (`hasUI=false`) afin que les Outils UI interactifs échouent rapidement.
- Arrête les chargeurs/la ligne d'état et se désabonne du gestionnaire d'événements de premier plan.
- S'abonne au gestionnaire d'événements d'arrière-plan (attend principalement `agent_end`).
- Arrête le TUI et envoie `SIGTSTP` (chemin de contrôle de tâche POSIX).

À `agent_end` en arrière-plan sans travail en file d'attente, le contrôleur envoie une notification de complétion et s'arrête.

## Chemins d'annulation

Entrées d'annulation principales :

- `Escape` pendant le chargeur de flux actif : restaure les messages en file d'attente dans l'éditeur et abandonne l'agent.
- `Escape` pendant l'exécution bash/python : abandonne la commande en cours.
- `Escape` pendant la compaction automatique/relance : invoque des méthodes d'abandon dédiées via des gestionnaires d'échappement temporaires.
- `Ctrl+C` pression unique : effacer l'éditeur ; double pression dans les 500 ms : arrêt.

L'annulation est conditionnelle à l'état ; la même touche peut signifier abandon, sortie de mode, déclenchement de sélecteur ou aucune action selon l'état du runtime.

## Comportement piloté par les événements vs comportement avec seuil

Mises à jour pilotées par les événements :

- Événements de session agent (`EventController`)
- Callbacks d'entrée clavier (`InputController`)
- Callback de redimensionnement du terminal
- Observateurs de thème/branche dans `InteractiveMode`

Chemins avec seuil/dé-rebondi :

- Le rendu TUI est dé-rebondi par tick (fusion `requestRender`).
- L'animation du chargeur est à intervalle fixe (80 ms), chaque image demandant un rendu.
- Les mises à jour d'autocomplétion de l'éditeur (à l'intérieur d'`Editor`) utilisent des minuteurs de dé-rebond, réduisant la charge de recalcul lors de la frappe.

Le runtime mélange donc des transitions d'état pilotées par les événements avec une cadence de rendu bornée pour maintenir une interactivité réactive sans tempêtes de repeinture.
