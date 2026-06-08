---
title: 'Opérations de session : Export, Dump, Share, Fork, Resume'
description: >-
  Opérations de session pour l'exportation, le partage, le fork et la reprise de
  conversations.
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

| Opération | Point d'entrée | Mutation de session | Création/changement de fichier de session | Artéfact de sortie |
|---|---|---|---|---|
| `/dump` | Commande slash interactive | Non | Non | Texte dans le presse-papiers |
| `/export [path]` | Commande slash interactive | Non | Non | Fichier HTML |
| `--export <session.jsonl> [outputPath]` | Chemin rapide au démarrage CLI | Pas de mutation de session à l'exécution | Pas de session active ; lit le fichier cible | Fichier HTML |
| `/share` | Commande slash interactive | Non | Non | HTML temporaire + URL de partage/gist |
| `/fork` | Commande slash interactive | Oui (l'identité de la session active change) | Crée un nouveau fichier de session et bascule la session courante vers celui-ci (mode persistant uniquement) | Copie le répertoire d'artéfacts vers le nouvel espace de noms de session si présent |
| `/resume` | Commande slash interactive | Oui (l'état en mémoire actif est remplacé) | Bascule vers un fichier de session existant sélectionné | Aucun |
| `--resume` | Démarrage CLI (sélecteur) | Oui après la création de session | Ouvre le fichier de session existant sélectionné | Aucun |
| `--resume <id\|path>` | Démarrage CLI | Oui après la création de session | Ouvre une session existante ; le cas inter-projets peut forker dans le projet courant | Aucun |
| `--continue` | Démarrage CLI | Oui après la création de session | Ouvre le fil d'Ariane du terminal ou la session la plus récente ; en crée une nouvelle si aucune n'existe | Aucun |

## Export et dump

### `/export [outputPath]` (interactif)

Flux :

1. `InputController` route `/export...` vers `CommandController.handleExportCommand`.
2. La commande divise sur les espaces et utilise uniquement le premier argument après `/export` comme `outputPath`.
3. `AgentSession.exportToHtml()` appelle `exportSessionToHtml(sessionManager, state, { outputPath, themeName })`.
4. En cas de succès, l'interface affiche le chemin et ouvre le fichier dans le navigateur.

Détails du comportement :

- Les arguments `--copy`, `clipboard` et `copy` sont explicitement rejetés avec un avertissement d'utiliser `/dump`.
- L'export intègre l'en-tête/les entrées/la feuille de session ainsi que le `systemPrompt` courant et les descriptions d'outils depuis l'état de l'agent.
- Aucune entrée de session n'est ajoutée pendant l'export.

Mise en garde :

- L'analyse des arguments est basée sur les espaces (`text.split(/\s+/)`), donc les chemins entre guillemets contenant des espaces ne sont pas préservés comme un chemin unique par ce chemin de commande.

### `--export <inputSessionFile> [outputPath]` (CLI)

Flux dans `main.ts` :

1. Géré tôt (avant le démarrage interactif/session).
2. Appelle `exportFromFile(inputPath, outputPath?)`.
3. `SessionManager.open(inputPath)` charge les entrées, puis le HTML est généré et écrit.
4. Le processus affiche `Exported to: ...` et se termine.

Détails du comportement :

- Un fichier d'entrée manquant se manifeste par `File not found: <path>`.
- Ce chemin ne crée pas d'`AgentSession` et ne mute aucune session en cours d'exécution.

### `/dump` (export interactif vers le presse-papiers)

Flux :

1. `CommandController.handleDumpCommand()` appelle `session.formatSessionAsText()`.
2. Si la chaîne est vide, signale `No messages to dump yet.`
3. Sinon, copie dans le presse-papiers via `copyToClipboard` natif.

Le contenu du dump inclut :

- Le prompt système
- Le modèle actif/niveau de réflexion
- Les définitions d'outils + paramètres
- Les messages utilisateur/assistant
- Les blocs de réflexion et appels d'outils
- Les résultats d'outils et blocs d'exécution (sauf les entrées bash/python `excludeFromContext`)
- Les entrées personnalisées/hooks/mentions de fichiers/résumés de branches/résumés de compaction

Aucune modification de la persistance de session n'est effectuée lors du dump.

## Partage (Share)

`/share` est uniquement interactif et commence toujours par exporter la session courante vers un fichier HTML temporaire.

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

- L'interface entre dans l'état de chargement `Sharing...`.
- Interprétation du résultat du gestionnaire :
  - string => traité comme une URL, affiché et ouvert
  - object => `url` et/ou `message` affichés ; `url` ouvert
  - `undefined`/falsy => `Session shared` générique
- Le fichier temporaire est supprimé après achèvement.

Comportement de repli critique :

- Si le gestionnaire personnalisé existe mais que le chargement échoue, la commande produit une erreur et retourne.
- Si le gestionnaire personnalisé s'exécute et lève une exception, la commande produit une erreur et retourne.
- Dans les deux cas d'échec, il **ne** se rabat **pas** sur le gist GitHub.
- Le repli vers le gist ne se produit que lorsqu'aucun script de partage personnalisé n'existe.

### Phase 3 : repli par défaut vers le gist

Uniquement lorsqu'aucun gestionnaire de partage personnalisé n'est trouvé :

1. Valide `gh auth status`.
2. Affiche le chargement `Creating gist...`.
3. Exécute `gh gist create --public=false <tmpFile>`.
4. Analyse l'URL du gist, dérive l'id du gist, construit l'URL de prévisualisation `https://gistpreview.github.io/?<id>`.
5. Affiche les URLs de prévisualisation et du gist ; ouvre la prévisualisation.

Sémantique d'annulation/abandon pour le partage :

- Le chargeur dispose d'un hook `onAbort` qui restaure l'interface de l'éditeur et signale `Share cancelled`.
- La commande sous-jacente `gh gist create` ne reçoit pas de signal d'abandon dans ce chemin de code ; l'annulation est au niveau de l'interface et vérifiée après le retour de la commande.

## Fork

`/fork` crée une nouvelle session à partir de la session courante et change l'identité de la session active.

### Préconditions et gardes immédiates

- Si l'agent est en streaming, `/fork` est rejeté avec un avertissement.
- Les indicateurs d'état/chargement de l'interface sont effacés avant l'opération.

### Flux au niveau de la session

`AgentSession.fork()` :

1. Émet `session_before_switch` avec `reason: "fork"` (annulable).
2. Vide les écritures en attente.
3. Appelle `SessionManager.fork()`.
4. Copie le répertoire d'artéfacts de l'ancien espace de noms de session vers le nouveau (meilleur effort ; les échecs de copie non-ENOENT sont journalisés, pas fatals).
5. Met à jour `agent.sessionId`.
6. Émet `session_switch` avec `reason: "fork"`.

Comportement de `SessionManager.fork()` :

- Nécessite le mode persistant et un fichier de session existant.
- Crée un nouvel id de session et un nouveau chemin de fichier JSONL.
- Réécrit l'en-tête avec :
  - nouvel `id`
  - nouveau timestamp
  - `cwd` inchangé
  - `parentSession` défini à l'id de session précédent
- Conserve toutes les entrées non-en-tête inchangées dans le nouveau fichier.

### Comportement non persistant

- Le gestionnaire de session en mémoire retourne `undefined` depuis `fork()`.
- `AgentSession.fork()` retourne `false`.
- L'interface signale `Fork failed (session not persisted or cancelled)`.

## Resume et continue

## `/resume` interactif

Flux :

1. Ouvre le sélecteur de session alimenté via `SessionManager.list(currentCwd, currentSessionDir)`.
2. À la sélection, `SelectorController.handleResumeSession(sessionPath)` appelle `session.switchSession(sessionPath)`.
3. L'interface efface/reconstruit le chat et les todos, puis signale `Resumed session`.

Notes :

- Ce sélecteur ne liste que les sessions dans le périmètre du répertoire de session courant.
- Il n'utilise pas la recherche globale inter-projets.

## CLI `--resume`

### `--resume` (sans valeur)

- `main.ts` liste les sessions pour le cwd/sessionDir courant et ouvre le sélecteur.
- Le chemin sélectionné est ouvert avec `SessionManager.open(selectedPath)` avant la création de session.

### `--resume <value>`

Ordre de résolution de `createSessionManager()` :

1. Si la valeur ressemble à un chemin (`/`, `\`, ou `.jsonl`), ouvrir directement.
2. Sinon, traiter comme préfixe d'id :
   - rechercher dans le périmètre courant (`SessionManager.list(cwd, sessionDir)`)
   - si non trouvé et pas de `sessionDir` explicite, rechercher globalement (`SessionManager.listAll()`)

Comportement de correspondance d'id inter-projets :

- Si le cwd de la session correspondante diffère du cwd courant, le CLI demande :
  - `Session found in different project ... Fork into current directory? [y/N]`
- En cas de oui : `SessionManager.forkFrom(match.path, cwd, sessionDir)` crée un nouveau fichier forké local.
- En cas de non/défaut non-TTY : la commande produit une erreur.

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)` :

1. Résout le répertoire de session pour le cwd courant.
2. Lit d'abord le fil d'Ariane à portée du terminal.
3. Se rabat sur le fichier de session le plus récemment modifié.
4. Ouvre la session trouvée ; si aucune n'existe, crée une nouvelle session.

C'est un comportement uniquement au démarrage ; il n'existe pas de commande slash interactive `/continue`.

## Comment le changement de session mute réellement l'état d'exécution

`AgentSession.switchSession(sessionPath)` effectue la transition d'exécution utilisée par les opérations de type resume :

1. Émet `session_before_switch` avec `reason: "resume"` et `targetSessionFile` (annulable).
2. Déconnecte l'abonnement aux événements de l'agent et annule le travail en cours.
3. Vide les messages de pilotage/suivi/tour suivant en file d'attente.
4. Vide les écritures du gestionnaire de session courant.
5. `sessionManager.setSessionFile(sessionPath)` et met à jour `agent.sessionId`.
6. Construit le contexte de session à partir des entrées chargées.
7. Émet `session_switch` avec `reason: "resume"`.
8. Remplace les messages de l'agent depuis le contexte.
9. Restaure le modèle (si disponible dans le registre courant).
10. Restaure ou initialise le niveau de réflexion.
11. Reconnecte l'abonnement aux événements de l'agent.

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

`ExtensionRunner.emit()` retourne dès le premier résultat d'événement avant annulant.

### Comportement `onSession` des outils personnalisés

Le pont SDK transmet les événements de session d'extension aux callbacks `onSession` des outils personnalisés :

- `session_switch` -> `onSession({ reason: "switch", previousSessionFile })`
- `session_branch` -> `reason: "branch"`
- `session_start` -> `reason: "start"`
- `session_tree` -> `reason: "tree"`
- `session_shutdown` -> `reason: "shutdown"`

Ces callbacks sont observationnels ; ils n'annulent pas le switch/fork.

### Autres surfaces d'annulation pertinentes pour ce document

- `/fork` est bloqué pendant le streaming (l'utilisateur doit attendre/annuler la réponse en cours d'abord).
- Le sélecteur `/resume` peut être annulé par l'utilisateur en fermant le sélecteur.
- `--resume <id>` inter-projets peut être annulé en refusant l'invite de fork.
- `/share` dispose d'un chemin d'abandon via l'interface (`Share cancelled`) pour le flux gist ; il ne connecte pas de sémantique de kill de processus pour `gh gist create` dans ce chemin de code.

## Comportement de session non persistante (en mémoire)

Lorsque le gestionnaire de session est créé avec `SessionManager.inMemory()` (`--no-session`) :

- Le chemin du fichier de session est absent.
- `/export` et `/share` échouent avec `Cannot export in-memory session to HTML` (propagé vers l'interface d'erreur de commande).
- `/fork` échoue car `SessionManager.fork()` nécessite la persistance.
- `/dump` fonctionne toujours car il sérialise l'état de l'agent en mémoire.
- Les sémantiques de resume/continue du CLI sont contournées si `--no-session` est défini, car la création du gestionnaire retourne immédiatement en mémoire.

## Mises en garde d'implémentation connues (à la date du code actuel)

- `SelectorController.handleResumeSession()` ne vérifie pas le résultat booléen de `session.switchSession(...)` ; un switch annulé par un hook peut tout de même passer par le chemin de redessin/statut de l'interface « Resumed session ».
- Les échecs de partage personnalisé de `/share` ne se dégradent pas vers le repli gist par défaut ; ils terminent la commande avec une erreur.
- La tokenisation des arguments de `/export` est simpliste et ne préserve pas les chemins entre guillemets contenant des espaces.
