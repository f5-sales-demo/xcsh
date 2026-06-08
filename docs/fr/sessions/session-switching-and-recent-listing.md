---
title: Changement de session et liste des sessions récentes
description: >-
  Mécanismes de changement de session et liste des sessions récentes avec
  recherche et filtrage.
sidebar:
  order: 4
  label: Changement & récentes
i18n:
  sourceHash: aae56130b508
  translator: machine
---

# Changement de session et liste des sessions récentes

Ce document décrit comment coding-agent découvre les sessions récentes, résout les cibles `--resume`, présente les sélecteurs de session et change la session active en cours d'exécution.

Il se concentre sur le comportement de l'implémentation actuelle, y compris les chemins de repli et les mises en garde.

## Fichiers d'implémentation

- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/cli/session-picker.ts`](../../packages/coding-agent/src/cli/session-picker.ts)
- [`../src/modes/components/session-selector.ts`](../../packages/coding-agent/src/modes/components/session-selector.ts)
- [`../src/modes/controllers/selector-controller.ts`](../../packages/coding-agent/src/modes/controllers/selector-controller.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)

## Découverte des sessions récentes

### Portée du répertoire

`SessionManager` stocke les sessions dans un répertoire scopé au cwd par défaut :

- `~/.xcsh/agent/sessions/--<cwd-encoded>--/*.jsonl`

`SessionManager.list(cwd, sessionDir?)` ne lit que ce répertoire sauf si un `sessionDir` explicite est fourni.

### Deux chemins de listage avec des charges utiles différentes

Il existe deux pipelines de listage différents :

1. `getRecentSessions(sessionDir, limit)` (vue d'accueil/résumé)
   - Ne lit qu'un préfixe de 4 Ko (`readTextPrefix(..., 4096)`) de chaque fichier.
   - Parse l'en-tête + l'aperçu du premier texte utilisateur.
   - Retourne des `RecentSessionInfo` légers avec des getters paresseux `name` et `timeAgo`.
   - Trie par `mtime` du fichier en ordre décroissant.

2. `SessionManager.list(...)` / `SessionManager.listAll()` (sélecteurs de reprise et correspondance par ID)
   - Lit les fichiers de session complets.
   - Construit des objets `SessionInfo` (`id`, `cwd`, `title`, `messageCount`, `firstMessage`, `allMessagesText`, horodatages).
   - Exclut les sessions avec zéro entrées `message`.
   - Trie par `modified` en ordre décroissant.

### Comportement de repli des métadonnées

Pour les résumés récents (`RecentSessionInfo`) :

- préférence du nom d'affichage : `header.title` -> premier prompt utilisateur -> `header.id` -> nom de fichier
- le nom est tronqué à 40 caractères pour les affichages compacts
- les caractères de contrôle/retours à la ligne sont supprimés/assainis des noms dérivés du titre

Pour les entrées de liste `SessionInfo` :

- `title` est `header.title` ou le dernier `shortSummary` de compaction
- `firstMessage` est le texte du premier message utilisateur ou `"(no messages)"`

## Résolution de `--continue` et préférence du breadcrumb terminal

`SessionManager.continueRecent(cwd, sessionDir?)` résout la cible dans cet ordre :

1. Lire le breadcrumb scopé au terminal (`~/.xcsh/agent/terminal-sessions/<terminal-id>`)
2. Valider le breadcrumb :
   - le terminal courant peut être identifié
   - le cwd du breadcrumb correspond au cwd courant (comparaison de chemin résolu)
   - le fichier référencé existe toujours
3. Si le breadcrumb est invalide/manquant, se replier sur le fichier le plus récent par mtime dans le répertoire de session (`findMostRecentSession`)
4. Si aucun trouvé, créer une nouvelle session

La dérivation de l'ID terminal préfère le chemin TTY et se replie sur des identifiants basés sur l'environnement (`KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION`).

Les écritures de breadcrumb sont en best-effort et non fatales.

## Résolution de la cible de reprise au démarrage (`main.ts`)

### `--resume <value>`

`createSessionManager(...)` gère les `--resume` à valeur chaîne dans deux modes :

1. Valeur de type chemin (contient `/`, `\\`, ou se termine par `.jsonl`)
   - `SessionManager.open(sessionArg, parsed.sessionDir)` direct

2. Valeur de préfixe d'ID
   - trouver une correspondance dans `SessionManager.list(cwd, sessionDir)` par `id.startsWith(sessionArg)`
   - si pas de correspondance locale et que `sessionDir` n'est pas forcé, essayer `SessionManager.listAll()`
   - la première correspondance est utilisée (pas d'invite d'ambiguïté)

Comportement de correspondance inter-projets :

- si le cwd de la session correspondante diffère du cwd courant, le CLI demande s'il faut forker dans le projet courant
- oui -> `SessionManager.forkFrom(...)`
- non -> lance une erreur (`Session "..." is in another project (...)`)

Aucune correspondance -> lance une erreur (`Session "..." not found.`).

### `--resume` (sans valeur)

Géré après la construction initiale du session-manager :

1. lister les sessions locales avec `SessionManager.list(cwd, parsed.sessionDir)`
2. si vide : afficher `No sessions found` et sortir prématurément
3. ouvrir le sélecteur TUI (`selectSession`)
4. si annulé : afficher `No session selected` et sortir prématurément
5. si sélectionné : `SessionManager.open(selectedPath)`

### `--continue`

Utilise `SessionManager.continueRecent(...)` directement (comportement breadcrumb-first ci-dessus).

## Mécanismes internes de la sélection par sélecteur

## Sélecteur CLI (`src/cli/session-picker.ts`)

`selectSession(sessions)` crée une TUI autonome avec `SessionSelectorComponent` et se résout exactement une fois :

- sélection -> résout le chemin sélectionné
- annulation (Esc) -> résout `null`
- sortie forcée (chemin Ctrl+C) -> arrête la TUI et `process.exit(0)`

## Sélecteur interactif en session (`SelectorController.showSessionSelector`)

Flux :

1. récupérer les sessions depuis le répertoire de session courant via `SessionManager.list(currentCwd, currentSessionDir)`
2. monter `SessionSelectorComponent` dans la zone éditeur en utilisant `showSelector(...)`
3. callbacks :
   - sélection -> fermer le sélecteur et appeler `handleResumeSession(sessionPath)`
   - annulation -> restaurer l'éditeur et re-rendre
   - sortie -> `ctx.shutdown()`

## Comportement du composant sélecteur de session

`SessionList` supporte :

- navigation par flèches/page
- Entrée pour sélectionner
- Échap pour annuler
- Ctrl+C pour quitter
- recherche floue à travers l'id/titre/cwd/premier message/tous les messages/chemin de la session

Comportement de rendu avec liste vide :

- affiche un message au lieu de planter
- Entrée sur une liste vide ne fait rien (pas de callback)
- Échap/Ctrl+C fonctionnent toujours

Mise en garde : le texte de l'interface indique `Press Tab to view all`, mais ce composant n'a actuellement pas de gestionnaire Tab et le câblage actuel ne liste que les sessions du scope courant.

## Exécution du changement en cours d'exécution (`AgentSession.switchSession`)

`switchSession(sessionPath)` est le chemin principal de changement en cours de processus.

Cycle de vie/transition d'état :

1. capturer `previousSessionFile`
2. émettre l'événement hook `session_before_switch` (`reason: "resume"`, annulable)
3. si annulé -> retourner `false` sans changement
4. se déconnecter du flux d'événements de l'agent courant
5. abandonner la génération/le flux d'outils actifs
6. vider les tampons de messages en file d'attente (steering/follow-up/next-turn)
7. vider l'écrivain de session (`sessionManager.flush()`) pour persister les écritures en attente
8. `sessionManager.setSessionFile(sessionPath)`
   - met à jour le pointeur de fichier de session
   - écrit le breadcrumb terminal
   - charge les entrées / migre / résout les blobs / réindexe
   - si données de fichier manquantes/invalides : initialise une nouvelle session à ce chemin et réécrit l'en-tête
9. mettre à jour `agent.sessionId`
10. reconstruire le contexte via `buildSessionContext()`
11. émettre l'événement hook `session_switch` (`reason: "resume"`, `previousSessionFile`)
12. remplacer les messages de l'agent avec le contexte reconstruit
13. restaurer le modèle par défaut depuis `sessionContext.models.default` s'il est disponible et présent dans le registre de modèles
14. restaurer le niveau de réflexion :
    - si la branche a déjà un `thinking_level_change`, appliquer le niveau de session sauvegardé
    - sinon dériver le niveau de réflexion par défaut depuis les paramètres, limiter aux capacités du modèle, le définir, et ajouter une nouvelle entrée `thinking_level_change`
15. reconnecter les écouteurs de l'agent et retourner `true`

## Reconstruction de l'état de l'interface après un changement interactif

`SelectorController.handleResumeSession` effectue une réinitialisation de l'interface autour de `switchSession` :

- arrêter l'animation de chargement
- vider le conteneur de statut
- vider l'interface des messages en attente et la map des outils en attente
- réinitialiser les références du composant de streaming/message
- appeler `session.switchSession(...)`
- vider le conteneur de chat et re-rendre depuis le contexte de session (`renderInitialMessages`)
- recharger les todos depuis les artefacts de la nouvelle session
- afficher `Resumed session`

Ainsi l'état visible de la conversation/todos est reconstruit depuis le nouveau fichier de session.

## Reprise au démarrage vs changement en session

### Reprise au démarrage (`--continue`, `--resume`, ouverture directe)

- Le fichier de session est choisi avant `createAgentSession(...)`.
- `sdk.ts` construit `existingSession = sessionManager.buildSessionContext()`.
- Les messages de l'agent sont restaurés une seule fois lors de la création de la session.
- Le modèle/la réflexion sont sélectionnés lors de la création (y compris la logique de restauration/repli).
- Le mode interactif exécute ensuite `#restoreModeFromSession()` pour ré-entrer dans l'état de mode persisté (actuellement plan/plan_paused).

### Changement en session (chemin sélecteur de type `/resume`)

- Utilise `AgentSession.switchSession(...)` sur un `AgentSession` déjà en cours d'exécution.
- Les messages/modèle/réflexion sont reconstruits immédiatement en place.
- Les événements hook `session_before_switch`/`session_switch` sont émis.
- Le chat/les todos de l'interface sont rafraîchis.
- Aucun appel dédié de restauration de mode post-changement n'est fait dans le flux du sélecteur ; le comportement de ré-entrée de mode n'est pas symétrique avec le `#restoreModeFromSession()` du démarrage.

## Comportement en cas d'échec et cas limites

### Chemins d'annulation

- Annulation du sélecteur CLI -> retourne `null`, l'appelant affiche `No session selected`, le processus sort prématurément.
- Annulation du sélecteur interactif -> l'éditeur est restauré, pas de changement de session.
- Annulation par hook (`session_before_switch`) -> `switchSession()` retourne `false`.

### Chemins avec liste vide

- CLI `--resume` (sans valeur) : liste vide affiche `No sessions found` et sort.
- Sélecteur interactif : liste vide affiche un message et reste annulable.

### Fichier de session cible manquant/invalide

Lors de l'ouverture/du changement vers un chemin spécifique (`setSessionFile`) :

- ENOENT -> traité comme vide -> nouvelle session initialisée à ce chemin exact et persistée.
- en-tête malformé/invalide (ou entrées parsées effectivement illisibles) -> traité comme vide -> nouvelle session initialisée et persistée.

C'est un comportement de récupération, pas un échec dur.

### Échecs durs

Le changement/l'ouverture peut toujours lever une exception en cas de véritables échecs d'E/S (erreurs de permission, échecs de réécriture, etc.), qui sont propagés aux appelants.

### Mises en garde sur la correspondance par préfixe d'ID

- La correspondance d'ID utilise `startsWith` et prend la première correspondance dans la liste triée.
- Pas d'interface d'ambiguïté si plusieurs sessions partagent le même préfixe.
- `SessionManager.list(...)` exclut les sessions avec zéro message, donc ces sessions ne sont pas reprenables via la correspondance d'ID/le sélecteur de liste.
