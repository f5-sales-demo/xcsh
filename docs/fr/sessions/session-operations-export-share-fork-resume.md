---
title: 'Opérations de session : Export, Dump, Share, Fork, Resume'
description: >-
  Opérations de session pour l'exportation, le partage, le fork et la reprise
  des conversations.
sidebar:
  order: 3
  label: Opérations
i18n:
  sourceHash: e3c210b29c3e
  translator: machine
---

# Opérations de session : export, dump, share, fork, resume/continue

Ce document décrit le comportement visible par l'opérateur pour les opérations d'export/partage/fork/reprise de session telles qu'elles sont actuellement implémentées.

## Fichiers d'implémentation

- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/export/html/index.ts`](../../packages/coding-agent/src/export/html/index.ts)
- [`../src/export/custom-share.ts`](../../packages/coding-agent/src/export/custom-share.ts)
- [`../src/main.ts`](../../packages/coding-agent/src/main.ts)

## Matrice des opérations

| Opération | Chemin d'entrée | Mutation de session | Création/changement de fichier de session | Artefact de sortie |
|---|---|---|---|---|
| `/dump` | Commande slash interactive | Non | Non | Texte dans le presse-papiers |
| `/export [path]` | Commande slash interactive | Non | Non | Fichier HTML |
| `--export <session.jsonl> [outputPath]` | Démarrage CLI (chemin rapide) | Aucune mutation de session à l'exécution | Pas de session active ; lit le fichier cible | Fichier HTML |
| `/share` | Commande slash interactive | Non | Non | HTML temporaire + URL de partage/gist |
| `/fork` | Commande slash interactive | Oui (l'identité de la session active change) | Crée un nouveau fichier de session et bascule la session courante vers celui-ci (mode persistant uniquement) | Copie le répertoire d'artefacts vers le nouvel espace de noms de session si présent |
| `/resume` | Commande slash interactive | Oui (l'état en mémoire actif est remplacé) | Bascule vers un fichier de session existant sélectionné | Aucun |
| `--resume` | Démarrage CLI (sélecteur) | Oui après création de session | Ouvre un fichier de session existant sélectionné | Aucun |
| `--resume <id\|path>` | Démarrage CLI | Oui après création de session | Ouvre une session existante ; le cas inter-projet peut forker dans le projet courant | Aucun |
| `--continue` | Démarrage CLI | Oui après création de session | Ouvre le fil de navigation terminal ou la session la plus récente ; en crée une nouvelle si aucune n'existe | Aucun |

## Export et dump

### `/export [outputPath]` (interactif)

Flux :

1. `InputController` route `/export...` vers `CommandController.handleExportCommand`.
2. La commande divise sur les espaces et utilise uniquement le premier argument après `/export` comme `outputPath`.
3. `AgentSession.exportToHtml()` appelle `exportSessionToHtml(sessionManager, state, { outputPath, themeName })`.
4. En cas de succès, l'interface affiche le chemin et ouvre le fichier dans le navigateur.

Détails de comportement :

- Les arguments `--copy`, `clipboard` et `copy` sont explicitement rejetés avec un avertissement invitant à utiliser `/dump`.
- L'export intègre l'en-tête de session/les entrées/feuille ainsi que le `systemPrompt` courant et les descriptions d'outils provenant de l'état de l'agent.
- Aucune entrée de session n'est ajoutée pendant l'export.

Mise en garde :

- L'analyse des arguments est basée sur les espaces (`text.split(/\s+/)`), donc les chemins entre guillemets contenant des espaces ne sont pas préservés en tant que chemin unique par cette voie de commande.

### `--export <inputSessionFile> [outputPath]` (CLI)

Flux dans `main.ts` :

1. Traité en amont (avant le démarrage interactif/de session).
2. Appelle `exportFromFile(inputPath, outputPath?)`.
3. `SessionManager.open(inputPath)` charge les entrées, puis le HTML est généré et écrit.
4. Le processus affiche `Exported to: ...` et se termine.

Détails de comportement :

- Un fichier d'entrée manquant est signalé par `File not found: <path>`.
- Ce chemin ne crée pas d'`AgentSession` et ne mute pas une session en cours d'exécution.

### `/dump` (export interactif vers le presse-papiers)

Flux :

1. `CommandController.handleDumpCommand()` appelle `session.formatSessionAsText()`.
2. Si la chaîne est vide, rapporte `No messages to dump yet.`
3. Sinon, copie dans le presse-papiers via `copyToClipboard` natif.

Le contenu du dump inclut :

- Le prompt système
- Le modèle actif/niveau de réflexion
- Les définitions d'outils + paramètres
- Les messages utilisateur/assistant
- Les blocs de réflexion et les appels d'outils
- Les résultats d'outils et les blocs d'exécution (à l'exception des entrées bash/python `excludeFromContext`)
- Les entrées personnalisées/hook/mention de fichier/résumé de branche/résumé de compaction

Aucune modification de persistance de session n'est effectuée par le dump.

## Share

`/share` est uniquement interactif et commence toujours par l'export de la session courante vers un fichier HTML temporaire.

### Phase 1 : export temporaire

- Chemin du fichier temporaire : `${os.tmpdir()}/${Snowflake.next()}.html`
- Utilise `session.exportToHtml(tmpFile)`
- Si l'export échoue (notamment pour les sessions en mémoire), le partage se termine avec une erreur.

### Phase 2 : gestionnaire de partage personnalisé (si présent)

`loadCustomShare()` vérifie `~/.xcsh/agent` pour le premier candidat existant :

- `share.ts`
- `share.js`
- `share.mjs`

Exigences :

- Le module doit exporter par défaut une fonction `(htmlPath) => Promise<CustomShareResult | string | undefined>`.

Si présent et valide :

- L'interface entre en état de chargement `Sharing...`.
- Interprétation du résultat du gestionnaire :
  - string => traité comme URL, affichée et ouverte
  - object => `url` et/ou `message` affichés ; `url` ouverte
  - `undefined`/falsy => `Session shared` générique
- Le fichier temporaire est supprimé après la complétion.

Comportement de repli critique :

- Si le gestionnaire personnalisé existe mais que son chargement échoue, la commande produit une erreur et retourne.
- Si le gestionnaire personnalisé s'exécute et lève une exception, la commande produit une erreur et retourne.
- Dans les deux cas d'échec, il **ne bascule pas** vers le gist GitHub.
- Le repli vers le gist n'a lieu que lorsqu'aucun script de partage personnalisé n'existe.

### Phase 3 : repli par défaut vers le gist

Uniquement lorsqu'aucun gestionnaire de partage personnalisé n'est trouvé :

1. Valide `gh auth status`.
2. Affiche le chargement `Creating gist...`.
3. Exécute `gh gist create --public=false <tmpFile>`.
4. Analyse l'URL du gist, dérive l'id du gist, construit l'URL de prévisualisation `https://gistpreview.github.io/?<id>`.
5. Affiche les URLs de prévisualisation et du gist ; ouvre la prévisualisation.

Sémantique d'annulation/abandon dans le partage :

- Le chargement dispose d'un hook `onAbort` qui restaure l'interface éditeur et signale `Share cancelled`.
- La commande `gh gist create` sous-jacente ne reçoit pas de signal d'abandon dans ce chemin de code ; l'annulation est au niveau de l'interface et vérifiée après le retour de la commande.

## Fork

`/fork` crée une nouvelle session à partir de la session courante et change l'identité de la session active.

### Préconditions et garde-fous immédiats

- Si l'agent est en train de diffuser en continu, `/fork` est rejeté avec un avertissement.
- Les indicateurs d'état/chargement de l'interface sont effacés avant l'opération.

### Flux au niveau session

`AgentSession.fork()` :

1. Émet `session_before_switch` avec `reason: "fork"` (annulable).
2. Vide les écritures en attente.
3. Appelle `SessionManager.fork()`.
4. Copie le répertoire d'artefacts de l'ancien espace de noms de session vers le nouvel espace (au mieux ; les échecs de copie non-ENOENT sont journalisés, mais pas fatals).
5. Met à jour `agent.sessionId`.
6. Émet `session_switch` avec `reason: "fork"`.

Comportement de `SessionManager.fork()` :

- Requiert le mode persistant et un fichier de session existant.
- Crée un nouvel id de session et un nouveau chemin de fichier JSONL.
- Réécrit l'en-tête avec :
  - un nouvel `id`
  - un nouvel horodatage
  - `cwd` inchangé
  - `parentSession` défini sur l'id de session précédent
- Conserve toutes les entrées non-header inchangées dans le nouveau fichier.

### Comportement non persistant

- Le gestionnaire de session en mémoire retourne `undefined` depuis `fork()`.
- `AgentSession.fork()` retourne `false`.
- L'interface rapporte `Fork failed (session not persisted or cancelled)`.

## Resume et continue

## `/resume` interactif

Flux :

1. Ouvre le sélecteur de session peuplé via `SessionManager.list(currentCwd, currentSessionDir)`.
2. Lors de la sélection, `SelectorController.handleResumeSession(sessionPath)` appelle `session.switchSession(sessionPath)`.
3. L'interface efface/reconstruit le chat et les tâches, puis rapporte `Resumed session`.

Notes :

- Ce sélecteur ne liste que les sessions dans la portée du répertoire de session courant.
- Il n'utilise pas la recherche globale inter-projets.

## CLI `--resume`

### `--resume` (sans valeur)

- `main.ts` liste les sessions pour le cwd/sessionDir courant et ouvre le sélecteur.
- Le chemin sélectionné est ouvert avec `SessionManager.open(selectedPath)` avant la création de session.

### `--resume <valeur>`

Ordre de résolution de `createSessionManager()` :

1. Si la valeur ressemble à un chemin (`/`, `\`, ou `.jsonl`), ouvrir directement.
2. Sinon, traiter comme préfixe d'id :
   - rechercher dans la portée courante (`SessionManager.list(cwd, sessionDir)`)
   - si non trouvé et sans `sessionDir` explicite, rechercher globalement (`SessionManager.listAll()`)

Comportement de correspondance d'id inter-projet :

- Si le cwd de la session correspondante diffère du cwd courant, le CLI demande :
  - `Session found in different project ... Fork into current directory? [y/N]`
- En cas de réponse affirmative : `SessionManager.forkFrom(match.path, cwd, sessionDir)` crée un nouveau fichier forké local.
- En cas de refus/valeur par défaut non-TTY : la commande produit une erreur.

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)` :

1. Résout le répertoire de session pour le cwd courant.
2. Lit d'abord le fil de navigation à portée du terminal.
3. Repli vers le fichier de session le plus récemment modifié.
4. Ouvre la session trouvée ; si aucune n'existe, crée une nouvelle session.

Il s'agit d'un comportement au démarrage uniquement ; il n'existe pas de commande slash `/continue` interactive.

## Comment le changement de session mute réellement l'état d'exécution

`AgentSession.switchSession(sessionPath)` effectue la transition d'exécution utilisée par les opérations de type reprise :

1. Émettre `session_before_switch` avec `reason: "resume"` et `targetSessionFile` (annulable).
2. Déconnecter l'abonnement aux événements de l'agent et abandonner le travail en cours.
3. Vider les messages de pilotage/suivi/prochain-tour en file d'attente.
4. Vider les écritures du gestionnaire de session courant.
5. `sessionManager.setSessionFile(sessionPath)` et mettre à jour `agent.sessionId`.
6. Construire le contexte de session à partir des entrées chargées.
7. Émettre `session_switch` avec `reason: "resume"`.
8. Remplacer les messages de l'agent depuis le contexte.
9. Restaurer le modèle (si disponible dans le registre courant).
10. Restaurer ou initialiser le niveau de réflexion.
11. Reconnecter l'abonnement aux événements de l'agent.

Aucun nouveau fichier de session n'est créé par `switchSession()` lui-même.

## Émissions d'événements et points d'annulation

### Hooks de cycle de vie switch/fork

Pour `newSession`, `fork` et `switchSession` :

- Événement avant : `session_before_switch`
  - raisons : `new`, `fork`, `resume`
  - annulable en retournant `{ cancel: true }`
- Événement après : `session_switch`
  - même ensemble de raisons
  - inclut `previousSessionFile`

`ExtensionRunner.emit()` retourne tôt au premier résultat d'événement avant annulant.

### Comportement `onSession` des outils personnalisés

Le pont SDK transmet les événements de session d'extension aux callbacks `onSession` des outils personnalisés :

- `session_switch` -> `onSession({ reason: "switch", previousSessionFile })`
- `session_branch` -> `reason: "branch"`
- `session_start` -> `reason: "start"`
- `session_tree` -> `reason: "tree"`
- `session_shutdown` -> `reason: "shutdown"`

Ces callbacks sont observationnels ; ils n'annulent pas le switch/fork.

### Autres surfaces d'annulation pertinentes pour ce document

- `/fork` est bloqué pendant la diffusion en continu (l'utilisateur doit attendre/abandonner la réponse courante en premier).
- Le sélecteur `/resume` peut être annulé par l'utilisateur en fermant le sélecteur.
- Le `--resume <id>` inter-projet peut être annulé en refusant l'invite de fork.
- `/share` dispose d'un chemin d'abandon dans l'interface (`Share cancelled`) pour le flux gist ; il ne câble pas la sémantique de kill de processus pour `gh gist create` dans ce chemin de code.

## Comportement de session non persistante (en mémoire)

Lorsque le gestionnaire de session est créé avec `SessionManager.inMemory()` (`--no-session`) :

- Le chemin du fichier de session est absent.
- `/export` et `/share` échouent avec `Cannot export in-memory session to HTML` (propagé vers l'interface d'erreur de commande).
- `/fork` échoue car `SessionManager.fork()` requiert la persistance.
- `/dump` fonctionne toujours car il sérialise l'état de l'agent en mémoire.
- La sémantique de reprise/continuation CLI est contournée si `--no-session` est défini, car la création du gestionnaire retourne immédiatement en mémoire.

## Mises en garde d'implémentation connues (selon le code actuel)

- `SelectorController.handleResumeSession()` ne vérifie pas le résultat booléen de `session.switchSession(...)`; un changement annulé par un hook peut quand même progresser à travers le chemin de repaint/statut « Resumed session » de l'interface.
- Les échecs de partage personnalisé de `/share` ne se dégradent pas vers le repli par défaut vers le gist ; ils terminent la commande avec une erreur.
- La tokenisation des arguments de `/export` est simpliste et ne préserve pas les chemins entre guillemets contenant des espaces.
