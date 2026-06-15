---
title: 'Opérations de session : Exporter, Vider, Partager, Dupliquer, Reprendre'
description: >-
  Opérations de session pour exporter, partager, dupliquer et reprendre des
  conversations.
sidebar:
  order: 3
  label: Opérations
i18n:
  sourceHash: e3c210b29c3e
  translator: machine
---

# Opérations de session : export, dump, share, fork, resume/continue

Ce document décrit le comportement visible par l'opérateur pour les opérations d'exportation, de partage, de duplication et de reprise de session telles qu'elles sont actuellement implémentées.

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
| `--export <session.jsonl> [outputPath]` | Chemin rapide au démarrage CLI | Pas de mutation de session active | Pas de session active ; lit le fichier cible | Fichier HTML |
| `/share` | Commande slash interactive | Non | Non | HTML temporaire + URL de partage/gist |
| `/fork` | Commande slash interactive | Oui (l'identité de la session active change) | Crée un nouveau fichier de session et bascule la session courante vers celui-ci (mode persistant uniquement) | Copie le répertoire d'artefacts vers le nouveau espace de noms de session si présent |
| `/resume` | Commande slash interactive | Oui (l'état en mémoire actif est remplacé) | Bascule vers le fichier de session existant sélectionné | Aucun |
| `--resume` | Démarrage CLI (sélecteur) | Oui après création de session | Ouvre le fichier de session existant sélectionné | Aucun |
| `--resume <id\|path>` | Démarrage CLI | Oui après création de session | Ouvre une session existante ; le cas multi-projet peut créer une duplication dans le projet courant | Aucun |
| `--continue` | Démarrage CLI | Oui après création de session | Ouvre le fil de progression du terminal ou la session la plus récente ; en crée une nouvelle si aucune n'existe | Aucun |

## Exportation et vidage

### `/export [outputPath]` (interactif)

Flux :

1. `InputController` route `/export...` vers `CommandController.handleExportCommand`.
2. La commande divise sur les espaces blancs et n'utilise que le premier argument après `/export` comme `outputPath`.
3. `AgentSession.exportToHtml()` appelle `exportSessionToHtml(sessionManager, state, { outputPath, themeName })`.
4. En cas de succès, l'interface affiche le chemin et ouvre le fichier dans le navigateur.

Détails de comportement :

- Les arguments `--copy`, `clipboard` et `copy` sont explicitement rejetés avec un avertissement invitant à utiliser `/dump`.
- L'exportation intègre l'en-tête de session, les entrées, la feuille ainsi que le `systemPrompt` courant et les descriptions d'outils issues de l'état de l'agent.
- Aucune entrée de session n'est ajoutée pendant l'exportation.

Mise en garde :

- L'analyse des arguments est basée sur les espaces (`text.split(/\s+/)`), donc les chemins entre guillemets contenant des espaces ne sont pas préservés comme un seul chemin par ce chemin de commande.

### `--export <inputSessionFile> [outputPath]` (CLI)

Flux dans `main.ts` :

1. Traité en amont (avant le démarrage interactif/de session).
2. Appelle `exportFromFile(inputPath, outputPath?)`.
3. `SessionManager.open(inputPath)` charge les entrées, puis le HTML est généré et écrit.
4. Le processus affiche `Exported to: ...` et se termine.

Détails de comportement :

- Un fichier d'entrée manquant génère `File not found: <path>`.
- Ce chemin ne crée pas d'`AgentSession` et ne mute aucune session en cours d'exécution.

### `/dump` (exportation interactive vers le presse-papiers)

Flux :

1. `CommandController.handleDumpCommand()` appelle `session.formatSessionAsText()`.
2. Si la chaîne est vide, signale `No messages to dump yet.`
3. Sinon, copie dans le presse-papiers via le `copyToClipboard` natif.

Le contenu du vidage inclut :

- Le prompt système
- Le modèle actif et le niveau de réflexion
- Les définitions d'outils et leurs paramètres
- Les messages utilisateur/assistant
- Les blocs de réflexion et les appels d'outils
- Les résultats d'outils et les blocs d'exécution (sauf les entrées bash/python `excludeFromContext`)
- Les entrées de type personnalisé, hook, mention de fichier, résumé de branche et résumé de compaction

Aucun changement de persistance de session n'est effectué par le vidage.

## Partage

`/share` est uniquement interactif et commence toujours par exporter la session courante vers un fichier HTML temporaire.

### Phase 1 : export temporaire

- Chemin du fichier temporaire : `${os.tmpdir()}/${Snowflake.next()}.html`
- Utilise `session.exportToHtml(tmpFile)`
- Si l'exportation échoue (notamment pour les sessions en mémoire), le partage se termine avec une erreur.

### Phase 2 : gestionnaire de partage personnalisé (si présent)

`loadCustomShare()` vérifie `~/.xcsh/agent` pour le premier candidat existant :

- `share.ts`
- `share.js`
- `share.mjs`

Prérequis :

- Le module doit exporter par défaut une fonction `(htmlPath) => Promise<CustomShareResult | string | undefined>`.

Si présent et valide :

- L'interface passe à l'état de chargement `Sharing...`.
- Interprétation du résultat du gestionnaire :
  - chaîne => traitée comme URL, affichée et ouverte
  - objet => `url` et/ou `message` affichés ; `url` ouverte
  - `undefined`/falsy => `Session shared` générique
- Le fichier temporaire est supprimé après l'exécution.

Comportement de repli critique :

- Si le gestionnaire personnalisé existe mais que son chargement échoue, la commande génère une erreur et retourne.
- Si le gestionnaire personnalisé s'exécute et lève une exception, la commande génère une erreur et retourne.
- Dans les deux cas d'échec, il **ne se rabat pas** sur le gist GitHub.
- Le repli sur le gist n'intervient que lorsqu'aucun script de partage personnalisé n'est trouvé.

### Phase 3 : repli par défaut sur le gist

Uniquement lorsqu'aucun gestionnaire de partage personnalisé n'est trouvé :

1. Valide `gh auth status`.
2. Affiche le chargement `Creating gist...`.
3. Exécute `gh gist create --public=false <tmpFile>`.
4. Analyse l'URL du gist, en dérive l'identifiant, construit l'URL de prévisualisation `https://gistpreview.github.io/?<id>`.
5. Affiche à la fois les URLs de prévisualisation et du gist ; ouvre la prévisualisation.

Sémantique d'annulation/abandon dans le partage :

- Le chargeur dispose d'un hook `onAbort` qui restaure l'interface de l'éditeur et signale `Share cancelled`.
- La commande `gh gist create` sous-jacente ne reçoit pas de signal d'abandon dans ce chemin de code ; l'annulation est au niveau de l'interface et est vérifiée après le retour de la commande.

## Duplication (Fork)

`/fork` crée une nouvelle session à partir de la session courante et change l'identité de la session active.

### Préconditions et vérifications immédiates

- Si l'agent est en train de diffuser, `/fork` est rejeté avec un avertissement.
- Les indicateurs d'état/chargement de l'interface sont effacés avant l'opération.

### Flux au niveau de la session

`AgentSession.fork()` :

1. Émet `session_before_switch` avec `reason: "fork"` (annulable).
2. Vide les écritures en attente.
3. Appelle `SessionManager.fork()`.
4. Copie le répertoire d'artefacts de l'ancien espace de noms de session vers le nouveau (au mieux ; les échecs de copie autres que ENOENT sont journalisés, pas fatals).
5. Met à jour `agent.sessionId`.
6. Émet `session_switch` avec `reason: "fork"`.

Comportement de `SessionManager.fork()` :

- Requiert le mode persistant et un fichier de session existant.
- Crée un nouvel identifiant de session et un nouveau chemin de fichier JSONL.
- Réécrit l'en-tête avec :
  - nouveau `id`
  - nouvel horodatage
  - `cwd` inchangé
  - `parentSession` défini sur l'identifiant de la session précédente
- Conserve toutes les entrées non-en-tête inchangées dans le nouveau fichier.

### Comportement non persistant

- Le gestionnaire de session en mémoire retourne `undefined` depuis `fork()`.
- `AgentSession.fork()` retourne `false`.
- L'interface signale `Fork failed (session not persisted or cancelled)`.

## Reprise et continuation

## `/resume` interactif

Flux :

1. Ouvre le sélecteur de session alimenté via `SessionManager.list(currentCwd, currentSessionDir)`.
2. Lors de la sélection, `SelectorController.handleResumeSession(sessionPath)` appelle `session.switchSession(sessionPath)`.
3. L'interface efface/reconstruit le chat et les tâches, puis signale `Resumed session`.

Notes :

- Ce sélecteur ne liste que les sessions dans la portée du répertoire de session courant.
- Il n'utilise pas la recherche globale multi-projet.

## CLI `--resume`

### `--resume` (sans valeur)

- `main.ts` liste les sessions pour le répertoire de travail/session courant et ouvre le sélecteur.
- Le chemin sélectionné est ouvert avec `SessionManager.open(selectedPath)` avant la création de session.

### `--resume <value>`

Ordre de résolution dans `createSessionManager()` :

1. Si la valeur ressemble à un chemin (`/`, `\`, ou `.jsonl`), ouvrir directement.
2. Sinon, traiter comme préfixe d'identifiant :
   - recherche dans la portée courante (`SessionManager.list(cwd, sessionDir)`)
   - si non trouvé et sans `sessionDir` explicite, recherche globale (`SessionManager.listAll()`)

Comportement de correspondance d'identifiant multi-projet :

- Si le répertoire de travail de la session trouvée diffère du répertoire de travail courant, la CLI demande :
  - `Session found in different project ... Fork into current directory? [y/N]`
- En cas de oui : `SessionManager.forkFrom(match.path, cwd, sessionDir)` crée un nouveau fichier dupliqué local.
- En cas de non/sans TTY par défaut : la commande génère une erreur.

## CLI `--continue`

`SessionManager.continueRecent(cwd, sessionDir)` :

1. Résout le répertoire de session pour le répertoire de travail courant.
2. Lit d'abord le fil de progression étendu au terminal.
3. Se rabat sur le fichier de session modifié le plus récemment.
4. Ouvre la session trouvée ; si aucune n'existe, crée une nouvelle session.

Il s'agit d'un comportement au démarrage uniquement ; il n'existe pas de commande slash interactive `/continue`.

## Comment le changement de session mute réellement l'état d'exécution

`AgentSession.switchSession(sessionPath)` effectue la transition d'exécution utilisée par les opérations de type reprise :

1. Émet `session_before_switch` avec `reason: "resume"` et `targetSessionFile` (annulable).
2. Déconnecte l'abonnement aux événements de l'agent et abandonne le travail en cours.
3. Efface les messages de pilotage, de suivi et de tour suivant en file d'attente.
4. Vide les écritures du gestionnaire de session courant.
5. `sessionManager.setSessionFile(sessionPath)` et met à jour `agent.sessionId`.
6. Construit le contexte de session à partir des entrées chargées.
7. Émet `session_switch` avec `reason: "resume"`.
8. Remplace les messages de l'agent à partir du contexte.
9. Restaure le modèle (s'il est disponible dans le registre courant).
10. Restaure ou initialise le niveau de réflexion.
11. Reconnecte l'abonnement aux événements de l'agent.

Aucun nouveau fichier de session n'est créé par `switchSession()` lui-même.

## Émissions d'événements et points d'annulation

### Hooks du cycle de vie de changement/duplication

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

Ces callbacks sont observationnels ; ils n'annulent pas le changement/la duplication.

### Autres surfaces d'annulation pertinentes pour ce document

- `/fork` est bloqué pendant la diffusion (l'utilisateur doit attendre ou abandonner la réponse courante en premier).
- Le sélecteur `/resume` peut être annulé par l'utilisateur en fermant le sélecteur.
- `--resume <id>` multi-projet peut être annulé en refusant l'invite de duplication.
- `/share` dispose d'un chemin d'abandon dans l'interface (`Share cancelled`) pour le flux gist ; il ne câble pas la sémantique de fin de processus pour `gh gist create` dans ce chemin de code.

## Comportement des sessions non persistantes (en mémoire)

Lorsque le gestionnaire de session est créé avec `SessionManager.inMemory()` (`--no-session`) :

- Le chemin du fichier de session est absent.
- `/export` et `/share` échouent avec `Cannot export in-memory session to HTML` (propagé vers l'interface d'erreur de commande).
- `/fork` échoue car `SessionManager.fork()` requiert la persistance.
- `/dump` fonctionne toujours car il sérialise l'état de l'agent en mémoire.
- Les sémantiques de reprise/continuation CLI sont contournées si `--no-session` est défini, car la création du gestionnaire retourne immédiatement une instance en mémoire.

## Mises en garde d'implémentation connues (selon le code actuel)

- `SelectorController.handleResumeSession()` ne vérifie pas le résultat booléen de `session.switchSession(...)` ; un changement annulé par un hook peut tout de même progresser vers le chemin de repeint/statut de l'interface « Resumed session ».
- Les échecs de partage personnalisé dans `/share` ne se dégradent pas vers le repli par défaut sur le gist ; ils terminent la commande avec une erreur.
- La tokenisation des arguments de `/export` est simpliste et ne préserve pas les chemins entre guillemets contenant des espaces.
