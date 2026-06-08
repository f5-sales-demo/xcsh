---
title: Architecture de l'arbre de session
description: >-
  Session tree architecture with branching, navigation, and parent-child
  conversation relationships.
sidebar:
  order: 2
  label: Architecture de l'arbre
i18n:
  sourceHash: bd8b78d6c33a
  translator: machine
---

# Architecture de l'arbre de session (actuelle)

Référence : [session.md](./session.md)

Ce document décrit le fonctionnement actuel de la navigation dans l'arbre de session : modèle d'arbre en mémoire, règles de déplacement des feuilles, comportement de branchement et intégration des extensions/événements.

## En quoi consiste ce sous-système

La session est stockée sous forme de journal d'entrées en ajout seul, mais le comportement à l'exécution est basé sur un arbre :

- Chaque entrée non-en-tête possède un `id` et un `parentId`.
- La position active est `leafId` dans `SessionManager`.
- L'ajout d'une entrée crée toujours un enfant de la feuille courante.
- Le branchement ne **réécrit pas** l'historique ; il change uniquement l'endroit où la feuille pointe avant le prochain ajout.

Fichiers clés :

- `src/session/session-manager.ts` — modèle de données de l'arbre, parcours, déplacement des feuilles, extraction de branche/session
- `src/session/agent-session.ts` — flux de navigation `/tree`, résumé, émission de hooks/événements
- `src/modes/components/tree-selector.ts` — comportement interactif de l'interface arborescente et filtrage
- `src/modes/controllers/selector-controller.ts` — orchestration du sélecteur pour `/tree` et `/branch`
- `src/modes/controllers/input-controller.ts` — routage des commandes (`/tree`, `/branch`, comportement du double-échap)
- `src/session/messages.ts` — conversion des entrées `branch_summary`, `compaction` et `custom_message` en messages de contexte LLM

## Modèle de données de l'arbre dans `SessionManager`

Index à l'exécution :

- `#byId: Map<string, SessionEntry>` — recherche rapide pour toute entrée
- `#leafId: string | null` — position actuelle dans l'arbre
- `#labelsById: Map<string, string>` — étiquettes résolues par identifiant d'entrée cible

API de l'arbre :

- `getBranch(fromId?)` remonte les liens parents jusqu'à la racine et renvoie le chemin racine→nœud
- `getTree()` renvoie `SessionTreeNode[]` (`entry`, `children`, `label`)
  - les liens parents deviennent des tableaux d'enfants
  - les entrées dont le parent est manquant sont traitées comme des racines
  - les enfants sont triés du plus ancien au plus récent par horodatage
- `getChildren(parentId)` renvoie les enfants directs
- `getLabel(id)` résout l'étiquette actuelle depuis `labelsById`

`getTree()` est une projection à l'exécution ; la persistance reste sous forme d'entrées JSONL en ajout seul.

## Sémantique du déplacement des feuilles

Il existe trois primitives de déplacement des feuilles :

1. `branch(entryId)`
   - Valide que l'entrée existe
   - Définit `leafId = entryId`
   - Aucune nouvelle entrée n'est écrite

2. `resetLeaf()`
   - Définit `leafId = null`
   - Le prochain ajout crée une nouvelle entrée racine (`parentId = null`)

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - Accepte `branchFromId: string | null`
   - Définit `leafId = branchFromId`
   - Ajoute une entrée `branch_summary` comme enfant de cette feuille
   - Quand `branchFromId` est `null`, `fromId` est persisté comme `"root"`

## Comportement de navigation `/tree` (même fichier de session)

`AgentSession.navigateTree()` est de la navigation, pas un fork de fichier.

Flux :

1. Valider la cible et calculer le chemin abandonné (`collectEntriesForBranchSummary`)
2. Émettre `session_before_tree` avec `TreePreparation`
3. Optionnellement résumer les entrées abandonnées (résumé fourni par un hook ou résumeur intégré)
4. Calculer la nouvelle cible de feuille :
   - sélection d'un message **utilisateur** : la feuille se déplace vers son parent, et le texte du message est renvoyé pour pré-remplir l'éditeur
   - sélection d'un **custom_message** : même règle que pour un message utilisateur (feuille = parent, le texte pré-remplit l'éditeur)
   - sélection de toute autre entrée : feuille = identifiant de l'entrée sélectionnée
5. Appliquer le déplacement de feuille :
   - avec résumé : `branchWithSummary(newLeafId, ...)`
   - sans résumé et `newLeafId === null` : `resetLeaf()`
   - sinon : `branch(newLeafId)`
6. Reconstruire le contexte de l'agent à partir de la nouvelle feuille et émettre `session_tree`

Important : les entrées de résumé sont attachées à la **nouvelle position de navigation**, pas à la fin de la branche abandonnée.

## Comportement de `/branch` (nouveau fichier de session)

`/branch` et `/tree` sont intentionnellement différents :

- `/tree` navigue à l'intérieur du fichier de session actuel.
- `/branch` crée un nouveau fichier de branche de session (ou un remplacement en mémoire pour le mode non-persistant).

Flux utilisateur de `/branch` (`SelectorController.showUserMessageSelector` → `AgentSession.branch`) :

- La source de branchement doit être un **message utilisateur**.
- Le texte utilisateur sélectionné est extrait pour pré-remplir l'éditeur.
- Si le message utilisateur sélectionné est racine (`parentId === null`) : démarrer une nouvelle session via `newSession({ parentSession: previousSessionFile })`.
- Sinon : `createBranchedSession(selectedEntry.parentId)` pour forker l'historique jusqu'à la limite du prompt sélectionné.

Spécificités de `SessionManager.createBranchedSession(leafId)` :

- Construit le chemin racine→feuille via `getBranch(leafId)` ; lève une exception si absent.
- Exclut les entrées `label` existantes du chemin copié.
- Reconstruit des entrées d'étiquettes fraîches à partir de `labelsById` résolu pour les entrées qui restent dans le chemin.
- Mode persistant : écrit un nouveau fichier JSONL et bascule le gestionnaire dessus ; renvoie le nouveau chemin de fichier.
- Mode en mémoire : remplace les entrées en mémoire ; renvoie `undefined`.

## Reconstruction du contexte et intégration résumé/personnalisé

`buildSessionContext()` (dans `session-manager.ts`) résout le chemin actif racine→feuille et construit l'état effectif du contexte LLM :

- Suit le dernier état thinking/model/mode/ttsr sur le chemin.
- Gère la dernière compaction sur le chemin :
  - émet d'abord le résumé de compaction
  - rejoue les messages conservés depuis `firstKeptEntryId` jusqu'au point de compaction
  - puis rejoue les messages post-compaction
- Inclut les entrées `branch_summary` et `custom_message` en tant qu'objets `AgentMessage`.

`session/messages.ts` mappe ensuite ces types de messages pour l'entrée du modèle :

- `branchSummary` et `compactionSummary` deviennent des messages de contexte modélisés avec le rôle utilisateur
- `custom`/`hookMessage` deviennent des messages de contenu avec le rôle utilisateur

Ainsi, le déplacement dans l'arbre modifie le contexte en changeant le chemin de la feuille active, et non en mutant les anciennes entrées.

## Étiquettes et comportement de l'interface arborescente

Persistance des étiquettes :

- `appendLabelChange(targetId, label?)` écrit des entrées `label` sur la chaîne de feuille courante.
- `labelsById` est mis à jour immédiatement (ajout ou suppression).
- `getTree()` résout l'étiquette actuelle sur chaque nœud retourné.

Comportement du sélecteur d'arbre (`tree-selector.ts`) :

- Aplatit l'arbre pour la navigation, conserve la mise en surbrillance du chemin actif et priorise l'affichage de la branche active en premier.
- Prend en charge les modes de filtrage : `default`, `no-tools`, `user-only`, `labeled-only`, `all`.
- Prend en charge la recherche en texte libre sur le contenu sémantique rendu.
- `Shift+L` ouvre l'édition d'étiquette en ligne et écrit via `appendLabelChange`.

Routage des commandes :

- `/tree` ouvre toujours le sélecteur d'arbre.
- `/branch` ouvre le sélecteur de messages utilisateur sauf si `doubleEscapeAction=tree`, auquel cas il utilise également l'interface du sélecteur d'arbre.

## Points d'extension et hooks pour les opérations sur l'arbre

API d'extension au moment de la commande (`ExtensionCommandContext`) :

- `branch(entryId)` — créer un fichier de session branché
- `navigateTree(targetId, { summarize? })` — se déplacer dans l'arbre/fichier courant

Événements autour de la navigation dans l'arbre :

- `session_before_tree`
  - reçoit `TreePreparation` :
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - peut annuler la navigation
  - peut fournir un payload de résumé utilisé à la place du résumeur intégré
  - reçoit un `signal` d'abandon (chemin d'annulation par Échap)
- `session_tree`
  - émet `newLeafId`, `oldLeafId`
  - inclut `summaryEntry` lorsqu'un résumé a été créé
  - `fromExtension` indique l'origine du résumé

Hooks de cycle de vie adjacents mais liés :

- `session_before_branch` / `session_branch` pour le flux `/branch`
- `session_before_compact`, `session.compacting`, `session_compact` pour les entrées de compaction qui affectent ensuite la reconstruction du contexte de l'arbre

## Contraintes réelles et conditions limites

- `branch()` ne peut pas cibler `null` ; utilisez `resetLeaf()` pour l'état racine-avant-première-entrée.
- `branchWithSummary()` prend en charge la cible `null` et enregistre `fromId: "root"`.
- Sélectionner la feuille courante dans le sélecteur d'arbre est une opération sans effet.
- Le résumé nécessite un modèle actif ; en son absence, la navigation avec résumé échoue immédiatement.
- Si le résumé est abandonné, la navigation est annulée et la feuille reste inchangée.
- Les sessions en mémoire ne renvoient jamais de chemin de fichier de branche depuis `createBranchedSession`.

## Compatibilité héritée encore présente

Les migrations de session s'exécutent toujours au chargement :

- v1→v2 ajoute `id`/`parentId` et convertit l'ancre d'index de compaction en ancre d'identifiant
- v2→v3 migre le rôle hérité `hookMessage` vers `custom`

Le comportement actuel à l'exécution utilise la sémantique d'arbre version 3 après migration.
