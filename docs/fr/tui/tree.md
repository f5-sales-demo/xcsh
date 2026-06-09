---
title: Référence de la commande Tree
description: >-
  Référence de la commande /tree pour visualiser l'historique de session et les
  branches de conversation.
sidebar:
  order: 4
  label: Commande /tree
i18n:
  sourceHash: ee0e412fe993
  translator: machine
---

# Référence de la commande `/tree`

`/tree` ouvre le navigateur interactif **Arbre de session**. Il vous permet d'accéder à n'importe quelle entrée dans le fichier de session actuel et de continuer à partir de ce point.

Il s'agit d'un déplacement de feuille dans le fichier, et non d'un export vers une nouvelle session.

## Ce que fait `/tree`

- Construit un arbre à partir des entrées de la session actuelle (`SessionManager.getTree()`)
- Ouvre `TreeSelectorComponent` avec navigation clavier, filtres et recherche
- À la sélection, appelle `AgentSession.navigateTree(targetId, { summarize, customInstructions })`
- Reconstruit le chat visible à partir du nouveau chemin de feuille
- Pré-remplit éventuellement le texte de l'éditeur lors de la sélection d'un message utilisateur/personnalisé

Implémentation principale :

- `src/modes/controllers/input-controller.ts` (`/tree`, liaison des raccourcis clavier, comportement du double échap)
- `src/modes/controllers/selector-controller.ts` (lancement de l'interface arbre + flux d'invite de résumé)
- `src/modes/components/tree-selector.ts` (navigation, filtres, recherche, étiquettes, rendu)
- `src/session/agent-session.ts` (`navigateTree` changement de feuille + résumé optionnel)
- `src/session/session-manager.ts` (`getTree`, `branch`, `branchWithSummary`, `resetLeaf`, persistance des étiquettes)

## Comment l'ouvrir

L'une des méthodes suivantes ouvre le même sélecteur :

- `/tree`
- action de raccourci clavier configurée `tree`
- double échap sur un éditeur vide lorsque `doubleEscapeAction = "tree"` (par défaut)
- `/branch` lorsque `doubleEscapeAction = "tree"` (redirige vers le sélecteur d'arbre au lieu du sélecteur de branche utilisateur uniquement)

## Modèle d'interface de l'arbre

L'arbre est rendu à partir des pointeurs parents des entrées de session (`id` / `parentId`).

- Les enfants sont triés par horodatage croissant (les plus anciens en premier, les plus récents en bas)
- La branche active (chemin de la racine à la feuille actuelle) est marquée d'un point
- Les étiquettes (si présentes) s'affichent sous la forme `[étiquette]` avant le texte du nœud
- Si plusieurs racines existent (chaînes de parents orphelines/brisées), elles sont affichées sous une racine de branchement virtuelle

```text
Exemple de vue arbre (chemin actif marqué avec •) :

├─ user: "Start task"
│  └─ assistant: "Plan"
│     ├─ • user: "Try approach A"
│     │  └─ • assistant: "A result"
│     │     └─ • [milestone] user: "Continue A"
│     └─ user: "Try approach B"
│        └─ assistant: "B result"
```

Le sélecteur se recentre autour de la sélection actuelle et affiche jusqu'à :

- `max(5, floor(terminalHeight / 2))` lignes

## Raccourcis clavier dans le sélecteur d'arbre

- `Haut` / `Bas` : déplacer la sélection (avec bouclage)
- `Gauche` / `Droite` : page précédente / page suivante
- `Entrée` : sélectionner le nœud
- `Échap` : effacer la recherche si active ; sinon fermer le sélecteur
- `Ctrl+C` : fermer le sélecteur
- `Saisie` : ajouter à la requête de recherche
- `Retour arrière` : supprimer un caractère de recherche
- `Shift+L` : modifier/effacer l'étiquette de l'entrée sélectionnée
- `Ctrl+O` : parcourir les filtres vers l'avant
- `Shift+Ctrl+O` : parcourir les filtres vers l'arrière
- `Alt+D/T/U/L/A` : accéder directement à un mode de filtre spécifique

## Filtres et sémantique de recherche

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

Uniquement les entrées qui résolvent actuellement vers une étiquette.

### `all`

Tout ce qui se trouve dans l'arbre de session, y compris les entrées de gestion interne/personnalisées.

### Comportement des nœuds assistant contenant uniquement des outils

Les messages assistant qui ne contiennent **que des appels d'outils** (pas de texte) sont masqués par défaut dans toutes les vues filtrées sauf si :

- le message est en erreur/interrompu (`stopReason` différent de `stop`/`toolUse`), ou
- c'est la feuille actuelle (toujours maintenue visible)

### Comportement de la recherche

- La requête est tokenisée par espaces
- La correspondance est insensible à la casse
- Tous les tokens doivent correspondre (sémantique ET)
- Le texte recherchable inclut l'étiquette, le rôle et le contenu spécifique au type (texte du message, texte du résumé de branche, type personnalisé, extraits de commandes d'outils, etc.)

## Résultats de la sélection (important)

`navigateTree` calcule le nouveau comportement de la feuille à partir du type d'entrée sélectionné :

### Sélection d'un message `user`

- La nouvelle feuille devient le `parentId` de l'entrée sélectionnée
- Si le parent est `null` (message utilisateur racine), la feuille se réinitialise à la racine (`resetLeaf()`)
- Le texte du message sélectionné est copié dans l'éditeur pour modification/renvoi

### Sélection d'un `custom_message`

- Même règle de feuille que les messages utilisateur (`parentId`)
- Le contenu textuel est extrait et copié dans l'éditeur

### Sélection d'un nœud non-utilisateur (assistant/outil/résumé/compaction/gestion interne personnalisée/etc.)

- La nouvelle feuille devient l'identifiant du nœud sélectionné
- L'éditeur n'est pas pré-rempli

### Sélection de la feuille actuelle

- Sans effet ; le sélecteur se ferme avec « Déjà à ce point »

```text
Décision de sélection (simplifiée) :

nœud sélectionné
   │
   ├─ est la feuille actuelle ? ── oui ──> fermer le sélecteur (sans effet)
   │
   ├─ est user/custom_message ? ── oui ──> feuille := parentId (ou resetLeaf pour la racine)
   │                                       + pré-remplir le texte de l'éditeur
   │
   └─ sinon ──> feuille := identifiant du nœud sélectionné
                + pas de pré-remplissage de l'éditeur
```

## Flux de résumé lors du changement

L'invite de résumé est contrôlée par `branchSummary.enabled` (par défaut : `false`).

Lorsqu'il est activé, après avoir choisi un nœud, l'interface demande :

- `Pas de résumé`
- `Résumer`
- `Résumer avec une invite personnalisée`

Détails du flux :

- Échap dans l'invite de résumé rouvre le sélecteur d'arbre
- L'annulation de l'invite personnalisée renvoie à la boucle de choix de résumé
- Pendant la synthèse, l'interface affiche un indicateur de chargement et lie `Échap` à `abortBranchSummary()`
- Si la synthèse est interrompue, le sélecteur d'arbre se rouvre et aucun déplacement n'est appliqué

Fonctionnement interne de `navigateTree` :

- Collecte les entrées de branche abandonnée de l'ancienne feuille à l'ancêtre commun
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

Les modifications d'étiquettes dans l'interface arbre appellent `appendLabelChange(targetId, label)`.

- une étiquette non vide définit/met à jour l'étiquette résolue
- une étiquette vide l'efface
- les étiquettes sont stockées comme des entrées `label` en ajout uniquement
- les nœuds de l'arbre affichent l'état résolu de l'étiquette, et non l'historique brut des entrées d'étiquettes

## `/tree` vs opérations adjacentes

| Opération | Portée | Résultat |
|---|---|---|
| `/tree` | Fichier de session actuel | Déplace la feuille vers le point sélectionné (même fichier) |
| `/branch` | Généralement fichier de session actuel -> nouveau fichier de session | Par défaut, crée une branche à partir du message **utilisateur** sélectionné dans un nouveau fichier de session ; si `doubleEscapeAction = "tree"`, `/branch` ouvre l'interface de navigation arbre à la place |
| `/fork` | Session actuelle entière | Duplique la session dans un nouveau fichier de session persisté |
| `/resume` | Liste des sessions | Bascule vers un autre fichier de session |

Distinction clé : `/tree` est un outil de navigation/repositionnement à l'intérieur d'un seul fichier de session. `/branch`, `/fork` et `/resume` changent tous le contexte du fichier de session.

## Flux de travail opérateur

### Relancer à partir d'une invite utilisateur antérieure sans perdre la branche actuelle

1. `/tree`
2. rechercher/sélectionner un message utilisateur antérieur
3. choisir `Pas de résumé` (ou résumer si nécessaire)
4. modifier le texte pré-rempli dans l'éditeur
5. soumettre

Effet : une nouvelle branche se développe à partir du point sélectionné dans le même fichier de session.

### Quitter la branche actuelle avec un repère de contexte

1. activer `branchSummary.enabled`
2. `/tree` et sélectionner le nœud cible
3. choisir `Résumer` (ou invite personnalisée)

Effet : une entrée `branch_summary` est ajoutée à la position cible avant de continuer.

### Inspecter les entrées de gestion interne masquées

1. `/tree`
2. appuyer sur `Alt+A` (tout)
3. rechercher `model`, `thinking`, `custom` ou des étiquettes

Effet : inspecter la chronologie interne complète, pas seulement les nœuds conversationnels.

### Marquer des points de pivot pour des sauts ultérieurs

1. `/tree`
2. se déplacer vers l'entrée
3. `Shift+L` et définir une étiquette
4. utiliser ultérieurement `Alt+L` (`labeled-only`) pour naviguer rapidement

Effet : navigation rapide entre des repères de branche durables.
