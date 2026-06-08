---
title: Référence de la commande Tree
description: >-
  /tree command reference for visualizing session history and conversation
  branches.
sidebar:
  order: 4
  label: Commande /tree
i18n:
  sourceHash: ee0e412fe993
  translator: machine
---

# Référence de la commande `/tree`

`/tree` ouvre le navigateur interactif **Session Tree**. Il vous permet de naviguer vers n'importe quelle entrée du fichier de session en cours et de continuer à partir de ce point.

Il s'agit d'un déplacement de feuille au sein du fichier, pas d'un export vers une nouvelle session.

## Ce que fait `/tree`

- Construit un arbre à partir des entrées de la session en cours (`SessionManager.getTree()`)
- Ouvre `TreeSelectorComponent` avec navigation au clavier, filtres et recherche
- Lors de la sélection, appelle `AgentSession.navigateTree(targetId, { summarize, customInstructions })`
- Reconstruit le chat visible à partir du nouveau chemin de feuille
- Pré-remplit optionnellement le texte de l'éditeur lors de la sélection d'un message utilisateur/personnalisé

Implémentation principale :

- `src/modes/controllers/input-controller.ts` (`/tree`, liaison des raccourcis clavier, comportement du double-escape)
- `src/modes/controllers/selector-controller.ts` (lancement de l'UI arborescente + flux de demande de résumé)
- `src/modes/components/tree-selector.ts` (navigation, filtres, recherche, étiquettes, rendu)
- `src/session/agent-session.ts` (`navigateTree` changement de feuille + résumé optionnel)
- `src/session/session-manager.ts` (`getTree`, `branch`, `branchWithSummary`, `resetLeaf`, persistance des étiquettes)

## Comment l'ouvrir

Chacune des actions suivantes ouvre le même sélecteur :

- `/tree`
- action de raccourci clavier configurée `tree`
- double-escape sur un éditeur vide lorsque `doubleEscapeAction = "tree"` (par défaut)
- `/branch` lorsque `doubleEscapeAction = "tree"` (redirige vers le sélecteur d'arbre au lieu du sélecteur de branche utilisateur uniquement)

## Modèle d'interface de l'arbre

L'arbre est rendu à partir des pointeurs de parenté des entrées de session (`id` / `parentId`).

- Les enfants sont triés par horodatage croissant (les plus anciens en premier, les plus récents en bas)
- La branche active (chemin de la racine à la feuille courante) est marquée d'une puce
- Les étiquettes (si présentes) s'affichent sous la forme `[label]` avant le texte du nœud
- Si plusieurs racines existent (chaînes de parenté orphelines/cassées), elles sont affichées sous une racine de branchement virtuelle

```text
Example tree view (active path marked with •):

├─ user: "Start task"
│  └─ assistant: "Plan"
│     ├─ • user: "Try approach A"
│     │  └─ • assistant: "A result"
│     │     └─ • [milestone] user: "Continue A"
│     └─ user: "Try approach B"
│        └─ assistant: "B result"
```

Le sélecteur se recentre autour de la sélection courante et affiche jusqu'à :

- `max(5, floor(terminalHeight / 2))` lignes

## Raccourcis clavier dans le sélecteur d'arbre

- `Up` / `Down` : déplacer la sélection (boucle)
- `Left` / `Right` : page précédente / page suivante
- `Enter` : sélectionner le nœud
- `Esc` : effacer la recherche si active ; sinon fermer le sélecteur
- `Ctrl+C` : fermer le sélecteur
- `Type` : ajouter à la requête de recherche
- `Backspace` : supprimer un caractère de recherche
- `Shift+L` : modifier/effacer l'étiquette de l'entrée sélectionnée
- `Ctrl+O` : cycler le filtre vers l'avant
- `Shift+Ctrl+O` : cycler le filtre vers l'arrière
- `Alt+D/T/U/L/A` : accéder directement à un mode de filtre spécifique

## Sémantique des filtres et de la recherche

Modes de filtre (`TreeList`) :

1. `default`
2. `no-tools`
3. `user-only`
4. `labeled-only`
5. `all`

### `default`

Affiche la plupart des nœuds conversationnels, mais masque les types d'entrées de gestion interne :

- `label`
- `custom`
- `model_change`
- `thinking_level_change`

### `no-tools`

Identique à `default`, mais masque en plus les messages `toolResult`.

### `user-only`

Uniquement les entrées `message` dont le rôle est `user`.

### `labeled-only`

Uniquement les entrées qui sont actuellement associées à une étiquette.

### `all`

Tout dans l'arbre de session, y compris les entrées de gestion interne/personnalisées.

### Comportement des nœuds assistant contenant uniquement des outils

Les messages assistant qui contiennent **uniquement des appels d'outils** (pas de texte) sont masqués par défaut dans toutes les vues filtrées sauf si :

- le message est en erreur/interrompu (`stopReason` différent de `stop`/`toolUse`), ou
- c'est la feuille courante (toujours gardée visible)

### Comportement de la recherche

- La requête est tokenisée par espaces
- La correspondance est insensible à la casse
- Tous les tokens doivent correspondre (sémantique ET)
- Le texte recherché inclut l'étiquette, le rôle et le contenu spécifique au type (texte du message, texte de résumé de branche, type personnalisé, extraits de commandes d'outils, etc.)

## Résultats de la sélection (important)

`navigateTree` calcule le nouveau comportement de feuille à partir du type d'entrée sélectionné :

### Sélection d'un message `user`

- La nouvelle feuille devient le `parentId` de l'entrée sélectionnée
- Si le parent est `null` (message utilisateur racine), la feuille est réinitialisée à la racine (`resetLeaf()`)
- Le texte du message sélectionné est copié dans l'éditeur pour modification/renvoi

### Sélection d'un `custom_message`

- Même règle de feuille que pour les messages utilisateur (`parentId`)
- Le contenu textuel est extrait et copié dans l'éditeur

### Sélection d'un nœud non-utilisateur (assistant/outil/résumé/compaction/gestion interne personnalisée/etc.)

- La nouvelle feuille devient l'identifiant du nœud sélectionné
- L'éditeur n'est pas pré-rempli

### Sélection de la feuille courante

- Aucune action ; le sélecteur se ferme avec « Already at this point »

```text
Selection decision (simplified):

selected node
   │
   ├─ is current leaf? ── yes ──> close selector (no-op)
   │
   ├─ is user/custom_message? ── yes ──> leaf := parentId (or resetLeaf for root)
   │                                     + prefill editor text
   │
   └─ otherwise ──> leaf := selected node id
                    + no editor prefill
```

## Flux de résumé lors du changement

L'invite de résumé est contrôlée par `branchSummary.enabled` (par défaut : `false`).

Lorsqu'activé, après avoir sélectionné un nœud, l'interface demande :

- `No summary`
- `Summarize`
- `Summarize with custom prompt`

Détails du flux :

- Escape dans l'invite de résumé rouvre le sélecteur d'arbre
- L'annulation de l'invite personnalisée retourne à la boucle de choix de résumé
- Pendant la synthèse, l'interface affiche un indicateur de chargement et lie `Esc` à `abortBranchSummary()`
- Si la synthèse est interrompue, le sélecteur d'arbre se rouvre et aucun déplacement n'est appliqué

Fonctionnement interne de `navigateTree` :

- Collecte les entrées de la branche abandonnée depuis l'ancienne feuille jusqu'à l'ancêtre commun
- Émet `session_before_tree` (les extensions peuvent annuler ou injecter un résumé)
- Utilise le synthétiseur par défaut uniquement si demandé et nécessaire
- Applique le déplacement avec :
  - `branchWithSummary(...)` lorsqu'un résumé existe
  - `branch(newLeafId)` pour un déplacement non-racine sans résumé
  - `resetLeaf()` pour un déplacement vers la racine sans résumé
- Remplace la conversation de l'agent par le contexte de session reconstruit
- Émet `session_tree`

Note : si l'utilisateur demande un résumé mais qu'il n'y a rien à résumer, la navigation se poursuit sans créer d'entrée de résumé.

## Étiquettes

Les modifications d'étiquettes dans l'interface d'arbre appellent `appendLabelChange(targetId, label)`.

- une étiquette non vide définit/met à jour l'étiquette résolue
- une étiquette vide la supprime
- les étiquettes sont stockées sous forme d'entrées `label` en ajout uniquement
- les nœuds de l'arbre affichent l'état résolu de l'étiquette, pas l'historique brut des entrées d'étiquettes

## `/tree` vs opérations adjacentes

| Opération | Portée | Résultat |
|---|---|---|
| `/tree` | Fichier de session en cours | Déplace la feuille vers le point sélectionné (même fichier) |
| `/branch` | Généralement fichier de session en cours -> nouveau fichier de session | Par défaut, crée une branche à partir du message **utilisateur** sélectionné dans un nouveau fichier de session ; si `doubleEscapeAction = "tree"`, `/branch` ouvre plutôt l'interface de navigation en arbre |
| `/fork` | Session en cours complète | Duplique la session dans un nouveau fichier de session persisté |
| `/resume` | Liste des sessions | Bascule vers un autre fichier de session |

Distinction clé : `/tree` est un outil de navigation/repositionnement au sein d'un seul fichier de session. `/branch`, `/fork` et `/resume` changent tous le contexte de fichier de session.

## Flux de travail opérateur

### Relancer depuis une invite utilisateur antérieure sans perdre la branche courante

1. `/tree`
2. rechercher/sélectionner le message utilisateur antérieur
3. choisir `No summary` (ou résumer si nécessaire)
4. modifier le texte pré-rempli dans l'éditeur
5. soumettre

Effet : une nouvelle branche se développe à partir du point sélectionné au sein du même fichier de session.

### Quitter la branche courante avec un fil d'Ariane contextuel

1. activer `branchSummary.enabled`
2. `/tree` et sélectionner le nœud cible
3. choisir `Summarize` (ou invite personnalisée)

Effet : une entrée `branch_summary` est ajoutée à la position cible avant de continuer.

### Inspecter les entrées de gestion interne masquées

1. `/tree`
2. appuyer sur `Alt+A` (all)
3. rechercher `model`, `thinking`, `custom`, ou des étiquettes

Effet : inspecter la chronologie interne complète, pas seulement les nœuds conversationnels.

### Marquer des points pivots pour des sauts ultérieurs

1. `/tree`
2. naviguer vers l'entrée
3. `Shift+L` et définir une étiquette
4. utiliser ultérieurement `Alt+L` (`labeled-only`) pour naviguer rapidement

Effet : navigation rapide entre les points de repère durables des branches.
