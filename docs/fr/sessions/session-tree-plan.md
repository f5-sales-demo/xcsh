---
title: Architecture arborescente des sessions
description: >-
  Architecture arborescente des sessions avec ramification, navigation et
  relations de conversation parent-enfant.
sidebar:
  order: 2
  label: Architecture arborescente
i18n:
  sourceHash: bd8b78d6c33a
  translator: machine
---

# Architecture arborescente des sessions (actuelle)

Référence : [session.md](./session.md)

Ce document décrit le fonctionnement actuel de la navigation arborescente des sessions : modèle arborescent en mémoire, règles de déplacement des feuilles, comportement de ramification et intégration des extensions/événements.

## Ce qu'est ce sous-système

La session est stockée comme un journal d'entrées en ajout uniquement, mais le comportement à l'exécution est basé sur un arbre :

- Chaque entrée non-en-tête possède un `id` et un `parentId`.
- La position active est `leafId` dans `SessionManager`.
- L'ajout d'une entrée crée toujours un enfant de la feuille courante.
- La ramification ne **réécrit pas** l'historique ; elle change uniquement l'endroit où la feuille pointe avant le prochain ajout.

Fichiers clés :

- `src/session/session-manager.ts` — modèle de données arborescent, traversée, déplacement de feuille, extraction de branche/session
- `src/session/agent-session.ts` — flux de navigation `/tree`, résumé, émission de hooks/événements
- `src/modes/components/tree-selector.ts` — comportement de l'interface arborescente interactive et filtrage
- `src/modes/controllers/selector-controller.ts` — orchestration du sélecteur pour `/tree` et `/branch`
- `src/modes/controllers/input-controller.ts` — routage des commandes (`/tree`, `/branch`, comportement double-échappement)
- `src/session/messages.ts` — conversion des entrées `branch_summary`, `compaction` et `custom_message` en messages de contexte LLM

## Modèle de données arborescent dans `SessionManager`

Index à l'exécution :

- `#byId: Map<string, SessionEntry>` — recherche rapide pour toute entrée
- `#leafId: string | null` — position courante dans l'arbre
- `#labelsById: Map<string, string>` — étiquettes résolues par identifiant d'entrée cible

API arborescentes :

- `getBranch(fromId?)` remonte les liens parents jusqu'à la racine et retourne le chemin racine→nœud
- `getTree()` retourne `SessionTreeNode[]` (`entry`, `children`, `label`)
  - les liens parents deviennent des tableaux d'enfants
  - les entrées avec des parents manquants sont traitées comme des racines
  - les enfants sont triés du plus ancien au plus récent par horodatage
- `getChildren(parentId)` retourne les enfants directs
- `getLabel(id)` résout l'étiquette courante depuis `labelsById`

`getTree()` est une projection à l'exécution ; la persistance reste des entrées JSONL en ajout uniquement.

## Sémantique du déplacement de feuille

Il existe trois primitives de déplacement de feuille :

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

`AgentSession.navigateTree()` est de la navigation, pas une bifurcation de fichier.

Flux :

1. Valider la cible et calculer le chemin abandonné (`collectEntriesForBranchSummary`)
2. Émettre `session_before_tree` avec `TreePreparation`
3. Optionnellement résumer les entrées abandonnées (résumé fourni par un hook ou résumeur intégré)
4. Calculer la nouvelle cible de feuille :
   - sélection d'un message **utilisateur** : la feuille se déplace vers son parent, et le texte du message est retourné pour le pré-remplissage de l'éditeur
   - sélection d'un **custom_message** : même règle que pour un message utilisateur (feuille = parent, le texte pré-remplit l'éditeur)
   - sélection de toute autre entrée : feuille = identifiant de l'entrée sélectionnée
5. Appliquer le déplacement de feuille :
   - avec résumé : `branchWithSummary(newLeafId, ...)`
   - sans résumé et `newLeafId === null` : `resetLeaf()`
   - sinon : `branch(newLeafId)`
6. Reconstruire le contexte de l'agent depuis la nouvelle feuille et émettre `session_tree`

Important : les entrées de résumé sont attachées à la **nouvelle position de navigation**, pas à la fin de la branche abandonnée.

## Comportement de `/branch` (nouveau fichier de session)

`/branch` et `/tree` sont intentionnellement différents :

- `/tree` navigue au sein du fichier de session courant.
- `/branch` crée un nouveau fichier de branche de session (ou un remplacement en mémoire pour le mode non-persistant).

Flux `/branch` côté utilisateur (`SelectorController.showUserMessageSelector` → `AgentSession.branch`) :

- La source de branche doit être un **message utilisateur**.
- Le texte utilisateur sélectionné est extrait pour le pré-remplissage de l'éditeur.
- Si le message utilisateur sélectionné est la racine (`parentId === null`) : démarrer une nouvelle session via `newSession({ parentSession: previousSessionFile })`.
- Sinon : `createBranchedSession(selectedEntry.parentId)` pour bifurquer l'historique jusqu'à la frontière du prompt sélectionné.

Spécificités de `SessionManager.createBranchedSession(leafId)` :

- Construit le chemin racine→feuille via `getBranch(leafId)` ; lève une exception si absent.
- Exclut les entrées `label` existantes du chemin copié.
- Reconstruit des entrées d'étiquettes fraîches depuis les `labelsById` résolus pour les entrées qui restent dans le chemin.
- Mode persistant : écrit un nouveau fichier JSONL et bascule le gestionnaire dessus ; retourne le nouveau chemin de fichier.
- Mode en mémoire : remplace les entrées en mémoire ; retourne `undefined`.

## Reconstruction du contexte et intégration des résumés/messages personnalisés

`buildSessionContext()` (dans `session-manager.ts`) résout le chemin actif racine→feuille et construit l'état de contexte LLM effectif :

- Suit le dernier état thinking/model/mode/ttsr sur le chemin.
- Gère la dernière compaction sur le chemin :
  - émet d'abord le résumé de compaction
  - rejoue les messages conservés depuis `firstKeptEntryId` jusqu'au point de compaction
  - puis rejoue les messages post-compaction
- Inclut les entrées `branch_summary` et `custom_message` comme objets `AgentMessage`.

`session/messages.ts` mappe ensuite ces types de messages pour l'entrée du modèle :

- `branchSummary` et `compactionSummary` deviennent des messages de contexte modélisés avec le rôle utilisateur
- `custom`/`hookMessage` deviennent des messages de contenu avec le rôle utilisateur

Ainsi, le déplacement dans l'arbre change le contexte en modifiant le chemin de feuille actif, pas en mutant les anciennes entrées.

## Étiquettes et comportement de l'interface arborescente

Persistance des étiquettes :

- `appendLabelChange(targetId, label?)` écrit des entrées `label` sur la chaîne de feuilles courante.
- `labelsById` est mis à jour immédiatement (ajout ou suppression).
- `getTree()` résout l'étiquette courante sur chaque nœud retourné.

Comportement du sélecteur arborescent (`tree-selector.ts`) :

- Aplatit l'arbre pour la navigation, conserve la mise en surbrillance du chemin actif et priorise l'affichage de la branche active en premier.
- Supporte les modes de filtrage : `default`, `no-tools`, `user-only`, `labeled-only`, `all`.
- Supporte la recherche en texte libre sur le contenu sémantique rendu.
- `Shift+L` ouvre l'édition d'étiquette en ligne et écrit via `appendLabelChange`.

Routage des commandes :

- `/tree` ouvre toujours le sélecteur arborescent.
- `/branch` ouvre le sélecteur de messages utilisateur sauf si `doubleEscapeAction=tree`, auquel cas il utilise également l'interface du sélecteur arborescent.

## Points de contact des extensions et hooks pour les opérations arborescentes

API d'extension au moment de la commande (`ExtensionCommandContext`) :

- `branch(entryId)` — créer un fichier de session branché
- `navigateTree(targetId, { summarize? })` — se déplacer au sein de l'arbre/fichier courant

Événements autour de la navigation arborescente :

- `session_before_tree`
  - reçoit `TreePreparation` :
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - peut annuler la navigation
  - peut fournir un contenu de résumé utilisé à la place du résumeur intégré
  - reçoit un `signal` d'abandon (chemin d'annulation par Échap)
- `session_tree`
  - émet `newLeafId`, `oldLeafId`
  - inclut `summaryEntry` quand un résumé a été créé
  - `fromExtension` indique l'origine du résumé

Hooks de cycle de vie adjacents mais liés :

- `session_before_branch` / `session_branch` pour le flux `/branch`
- `session_before_compact`, `session.compacting`, `session_compact` pour les entrées de compaction qui affectent ultérieurement la reconstruction du contexte arborescent

## Contraintes réelles et conditions limites

- `branch()` ne peut pas cibler `null` ; utilisez `resetLeaf()` pour l'état racine-avant-première-entrée.
- `branchWithSummary()` supporte une cible `null` et enregistre `fromId: "root"`.
- Sélectionner la feuille courante dans le sélecteur arborescent est une opération sans effet.
- Le résumé nécessite un modèle actif ; s'il est absent, la navigation avec résumé échoue rapidement.
- Si le résumé est abandonné, la navigation est annulée et la feuille reste inchangée.
- Les sessions en mémoire ne retournent jamais de chemin de fichier de branche depuis `createBranchedSession`.

## Compatibilité héritée encore présente

Les migrations de session s'exécutent toujours au chargement :

- v1→v2 ajoute `id`/`parentId` et convertit l'ancre d'index de compaction en ancre par identifiant
- v2→v3 migre le rôle hérité `hookMessage` vers `custom`

Le comportement à l'exécution actuel correspond à la sémantique arborescente version 3 après migration.
