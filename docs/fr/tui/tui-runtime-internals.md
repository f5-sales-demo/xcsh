---
title: Mécanismes internes du runtime TUI
description: >-
  Mécanismes internes du runtime de l'interface utilisateur en terminal,
  couvrant le pipeline de rendu, la gestion des entrées et la gestion d'état.
sidebar:
  order: 2
  label: Mécanismes internes du runtime
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# Mécanismes internes du runtime TUI

Ce document décrit le chemin d'exécution non-thème du runtime, de l'entrée terminal à la sortie rendue en mode interactif. Il se concentre sur le comportement dans `packages/tui` et son intégration depuis les contrôleurs de `packages/coding-agent`.

## Couches du runtime et responsabilités

- **Moteur `packages/tui`** : cycle de vie du terminal, normalisation de stdin, routage du focus, planification du rendu, peinture différentielle, composition des overlays, placement du curseur matériel.
- **Mode interactif de `packages/coding-agent`** : construit l'arbre de composants, lie les callbacks et les raccourcis clavier de l'éditeur, réagit aux événements agent/session, et traduit l'état du domaine (streaming, exécution d'outils, tentatives de reprise, mode plan) en composants UI.

Règle de frontière : le moteur TUI est agnostique vis-à-vis des messages. Il ne connaît que `Component.render(width)`, `handleInput(data)`, le focus et les overlays. La sémantique de l'agent reste dans les contrôleurs interactifs.

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

`init()` lie l'arbre dans cet ordre, donne le focus à l'éditeur, enregistre les gestionnaires d'entrée via `InputController`, démarre le TUI et demande un rendu forcé.

Un rendu forcé (`requestRender(true)`) réinitialise les caches de lignes précédentes et la gestion du curseur avant de repeindre.

## Cycle de vie du terminal et normalisation de stdin

`ProcessTerminal.start()` :

1. Active le mode raw et le collage entre crochets (bracketed paste).
2. Attache un gestionnaire de redimensionnement.
3. Crée un `StdinBuffer` pour découper les fragments partiels d'échappement en séquences complètes.
4. Interroge le support du protocole clavier Kitty (`CSI ? u`), puis active les drapeaux du protocole si supporté.
5. Sous Windows, tente l'activation de l'entrée VT via les drapeaux de mode `kernel32`.

Comportement de `StdinBuffer` :

- Met en tampon les séquences d'échappement fragmentées (CSI/OSC/DCS/APC/SS3).
- Émet `data` uniquement lorsqu'une séquence est complète ou vidée par timeout.
- Détecte le collage entre crochets et émet un événement `paste` avec le texte collé brut.

Cela empêche les fragments partiels d'échappement d'être interprétés à tort comme des pressions de touches normales.

## Routage des entrées et modèle de focus

Chemin des entrées :

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Détails du routage :

1. Le TUI exécute d'abord les écouteurs d'entrée enregistrés (`addInputListener`), permettant un comportement de consommation/transformation.
2. Le TUI gère le raccourci global de débogage (`shift+ctrl+d`) avant la distribution aux composants.
3. Si le composant ayant le focus appartient à un overlay désormais masqué/invisible, le TUI réattribue le focus au prochain overlay visible ou au focus pré-overlay sauvegardé.
4. Les événements de relâchement de touche sont filtrés sauf si le composant ayant le focus définit `wantsKeyRelease = true`.
5. Après la distribution, le TUI planifie un rendu.

`setFocus()` bascule également `Focusable.focused`, qui contrôle si les composants émettent `CURSOR_MARKER` pour le placement du curseur matériel.

## Répartition de la gestion des touches : éditeur vs contrôleur

`CustomEditor` intercepte d'abord les combinaisons de haute priorité (escape, ctrl-c/d/z, ctrl-v, variantes de ctrl-p, ctrl-t, alt-haut, touches personnalisées d'extension) et délègue le reste au comportement de base `Editor` (édition de texte, historique, autocomplétion, déplacement du curseur).

`InputController.setupKeyHandlers()` lie ensuite les callbacks de l'éditeur aux actions du mode :

- annulation / sorties de mode sur `Escape`
- arrêt sur double `Ctrl+C` ou `Ctrl+D` avec éditeur vide
- suspension/reprise sur `Ctrl+Z`
- commandes slash et raccourcis de sélection
- bascules de suivi/file d'attente et bascules d'expansion

Cela conserve l'analyse des touches et la mécanique de l'éditeur dans `packages/tui` et la sémantique du mode dans les contrôleurs de coding-agent.

## Boucle de rendu et stratégie de différenciation

`TUI.requestRender()` est dé-rebondi à un rendu par tick en utilisant `process.nextTick`. Plusieurs changements d'état dans le même tour sont fusionnés.

Pipeline de `#doRender()` :

1. Rend l'arbre de composants racine en `newLines`.
2. Composite les overlays visibles (le cas échéant).
3. Extrait et supprime `CURSOR_MARKER` des lignes visibles du viewport.
4. Ajoute des suffixes de réinitialisation de segment pour les lignes non-image.
5. Choisit entre repeinture complète et correctif différentiel :
   - première image
   - changement de largeur
   - rétrécissement avec `clearOnShrink` activé et sans overlays
   - modifications au-dessus du viewport précédent
6. Pour les mises à jour différentielles, ne corrige que la plage de lignes modifiées et efface les lignes résiduelles en fin quand nécessaire.
7. Repositionne le curseur matériel pour le support IME.

Les écritures de rendu utilisent le mode de sortie synchronisée (`CSI ? 2026 h/l`) pour réduire le scintillement/déchirement.

## Contraintes de sécurité du rendu

Vérifications de sécurité critiques dans `TUI` :

- Les lignes rendues non-image ne doivent pas dépasser la largeur du terminal ; un dépassement lève une exception et écrit des diagnostics de crash.
- La composition des overlays inclut une troncature défensive et une vérification de largeur post-composition.
- Les changements de largeur forcent un redessin complet car la sémantique de retour à la ligne change.
- La position du curseur est contrainte avant le déplacement.

Ces contraintes sont une application à l'exécution, pas de simples conventions.

## Gestion du redimensionnement

Les événements de redimensionnement sont pilotés par événements depuis `ProcessTerminal` vers `TUI.requestRender()`.

Effets :

- Tout changement de largeur déclenche un redessin complet.
- Le suivi du viewport/haut (`#previousViewportTop`, `#maxLinesRendered`) évite les calculs relatifs de curseur invalides lorsque le contenu ou la taille du terminal change.
- La visibilité des overlays peut dépendre des dimensions du terminal (`OverlayOptions.visible`) ; le focus est corrigé lorsque les overlays deviennent non visibles après un redimensionnement.

## Streaming et mises à jour incrémentales de l'UI

`EventController` s'abonne aux `AgentSessionEvent` et met à jour l'UI de manière incrémentale :

- `agent_start` : démarre le loader dans `statusContainer`.
- `message_start` assistant : crée `streamingComponent` et le monte.
- `message_update` : met à jour le contenu assistant en streaming ; crée/met à jour les composants d'exécution d'outils à mesure que les appels d'outils apparaissent.
- `tool_execution_update/end` : met à jour les composants de résultat d'outils et l'état d'achèvement.
- `message_end` : finalise le flux assistant, gère les annotations d'abandon/erreur, marque les arguments d'outils en attente comme complets lors d'un arrêt normal.
- `agent_end` : arrête les loaders, efface l'état de streaming transitoire, effectue le changement de modèle différé, émet une notification de complétion si en arrière-plan.

Le regroupement des outils de lecture est intentionnellement avec état (`#lastReadGroup`) pour fusionner les appels consécutifs d'outils de lecture en un seul bloc visuel jusqu'à ce qu'une interruption non-lecture se produise.

## Orchestration du statut et des loaders

Responsabilité de la zone de statut :

- `statusContainer` contient les loaders transitoires (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` rend les indicateurs persistants de statut/hooks/plan et pilote les mises à jour de la bordure supérieure de l'éditeur.

Comportement des loaders :

- `Loader` se met à jour toutes les 80ms via un intervalle et demande un rendu à chaque image.
- Les gestionnaires d'échappement sont temporairement redéfinis pendant l'auto-compaction et l'auto-reprise pour annuler ces opérations.
- Sur les chemins de fin/annulation, les contrôleurs restaurent les gestionnaires d'échappement précédents et arrêtent/effacent les composants loader.

## Transitions de mode et mise en arrière-plan

### Modes d'entrée Bash/Python

Les préfixes de texte d'entrée basculent les drapeaux de mode de bordure de l'éditeur :

- `!` -> mode bash
- `$` (préfixe non-littéral de modèle) -> mode python

Escape quitte le mode inactif en effaçant le texte de l'éditeur et en restaurant la couleur de bordure ; lorsqu'une exécution est active, escape interrompt la tâche en cours à la place.

### Mode plan

`InteractiveMode` suit les drapeaux du mode plan, l'état de la ligne de statut, les outils actifs et le changement de modèle. L'entrée/sortie met à jour les entrées de mode de session et l'état du statut/UI, incluant le changement de modèle différé si le streaming est actif.

### Suspension/reprise (`Ctrl+Z`)

`InputController.handleCtrlZ()` :

1. Enregistre un gestionnaire `SIGCONT` à usage unique pour redémarrer le TUI et forcer un rendu.
2. Arrête le TUI avant la suspension.
3. Envoie `SIGTSTP` au groupe de processus.

### Mode arrière-plan (`/background` ou `/bg`)

`handleBackgroundCommand()` :

- Rejette lorsqu'inactif.
- Bascule le contexte UI des outils en non-interactif (`hasUI=false`) pour que les outils UI interactifs échouent rapidement.
- Arrête les loaders/ligne de statut et se désabonne du gestionnaire d'événements de premier plan.
- S'abonne au gestionnaire d'événements d'arrière-plan (attend principalement `agent_end`).
- Arrête le TUI et envoie `SIGTSTP` (chemin de contrôle de tâches POSIX).

Lors de `agent_end` en arrière-plan sans travail en file d'attente, le contrôleur envoie une notification de complétion et s'arrête.

## Chemins d'annulation

Entrées principales d'annulation :

- `Escape` pendant le loader de flux actif : restaure les messages en file d'attente dans l'éditeur et interrompt l'agent.
- `Escape` pendant l'exécution bash/python : interrompt la commande en cours.
- `Escape` pendant l'auto-compaction/reprise : invoque les méthodes d'interruption dédiées via les gestionnaires d'échappement temporaires.
- `Ctrl+C` simple pression : efface l'éditeur ; double pression dans les 500ms : arrêt.

L'annulation est conditionnelle à l'état ; la même touche peut signifier interruption, sortie de mode, déclenchement de sélecteur, ou absence d'opération selon l'état d'exécution.

## Comportement piloté par événements vs limité en débit

Mises à jour pilotées par événements :

- Événements de session agent (`EventController`)
- Callbacks d'entrée clavier (`InputController`)
- Callback de redimensionnement du terminal
- Observateurs de thème/branche dans `InteractiveMode`

Chemins limités en débit/dé-rebondis :

- Le rendu TUI est dé-rebondi par tick (fusion de `requestRender`).
- L'animation du loader est à intervalle fixe (80ms), chaque image demandant un rendu.
- Les mises à jour d'autocomplétion de l'éditeur (dans `Editor`) utilisent des temporisateurs de dé-rebond, réduisant les recalculs excessifs pendant la frappe.

Le runtime mélange donc les transitions d'état pilotées par événements avec une cadence de rendu bornée pour maintenir la réactivité de l'interactivité sans tempêtes de repeinture.
