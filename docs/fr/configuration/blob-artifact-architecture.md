---
title: Architecture du stockage de blobs et d'artefacts
description: >-
  Content-addressable blob store and artifact registry for session media,
  screenshots, and tool outputs.
sidebar:
  order: 7
  label: Stockage de blobs et d'artefacts
i18n:
  sourceHash: 70d255f48d5b
  translator: machine
---

# Architecture du stockage de blobs et d'artefacts

Ce document décrit comment coding-agent stocke les charges utiles volumineuses/binaires en dehors du JSONL de session, comment les sorties d'outils tronquées sont persistées, et comment les URLs internes (`artifact://`, `agent://`) se résolvent vers les données stockées.

## Pourquoi deux systèmes de stockage existent

Le runtime utilise deux mécanismes de persistance différents pour des formes de données différentes :

- **Blobs adressés par contenu** (`blob:sha256:<hash>`) : stockage global, orienté binaire, utilisé pour externaliser les charges utiles base64 d'images volumineuses des entrées de session persistées.
- **Artefacts à portée de session** (fichiers sous `<sessionFile-without-.jsonl>/`) : fichiers texte par session utilisés pour les sorties complètes d'outils et les sorties de sous-agents.

Ils sont intentionnellement séparés :

- le stockage de blobs optimise la déduplication et les références stables par hash de contenu,
- le stockage d'artefacts optimise l'outillage de session en ajout seul et la récupération par humain/outil via des IDs locaux.

## Limites de stockage et disposition sur disque

## Limite du magasin de blobs (global)

`SessionManager` construit `BlobStore(getBlobsDir())`, ainsi les fichiers blob résident dans un répertoire de blobs global partagé (pas dans un dossier de session).

Nommage des fichiers blob :

- chemin du fichier : `<blobsDir>/<sha256-hex>`
- pas d'extension
- chaîne de référence stockée dans les entrées : `blob:sha256:<sha256-hex>`

Implications :

- le même contenu binaire à travers les sessions se résout vers le même hash/chemin,
- les écritures sont idempotentes au niveau du contenu,
- les blobs peuvent survivre à n'importe quel fichier de session individuel.

## Limite des artefacts (local à la session)

`ArtifactManager` dérive le répertoire d'artefacts à partir du chemin du fichier de session :

- fichier de session : `.../<timestamp>_<sessionId>.jsonl`
- répertoire d'artefacts : `.../<timestamp>_<sessionId>/` (suppression de `.jsonl`)

Les types d'artefacts partagent ce répertoire :

- fichiers de sortie d'outil tronqués : `<numericId>.<toolType>.log` (pour `artifact://`)
- fichiers de sortie de sous-agent : `<outputId>.md` (pour `agent://`)

## Schémas d'allocation d'IDs et de noms

## IDs de blob : hash de contenu

`BlobStore.put()` calcule le SHA-256 sur les octets binaires bruts et retourne :

- `hash` : condensé hexadécimal,
- `path` : `<blobsDir>/<hash>`,
- `ref` : `blob:sha256:<hash>`.

Aucun compteur local à la session n'est utilisé.

## IDs d'artefact : entier monotone local à la session

`ArtifactManager` parcourt les fichiers d'artefacts `*.log` existants lors de la première utilisation pour trouver l'ID numérique maximum existant et définit `nextId = max + 1`.

Comportement d'allocation :

- format de fichier : `{id}.{toolType}.log`
- les IDs sont des chaînes séquentielles (`"0"`, `"1"`, ...)
- la reprise n'écrase pas les artefacts existants car le parcours se fait avant l'allocation.

Si le répertoire d'artefacts est manquant, le parcours retourne une liste vide et l'allocation commence à `0`.

## IDs de sortie d'agent (`agent://`)

`AgentOutputManager` alloue les IDs pour les sorties de sous-agents sous la forme `<index>-<requestedId>` (optionnellement imbriqués sous un préfixe parent, par ex. `0-Parent.1-Child`). Il parcourt les fichiers `.md` existants à l'initialisation pour continuer à partir de l'index suivant lors de la reprise.

## Flux de données de persistance

## 1) Chemin de réécriture de persistance des entrées de session

Avant que les entrées de session soient écrites (`#rewriteFile` / persistance incrémentale), `SessionManager` appelle `prepareEntryForPersistence()` (via `truncateForPersistence`).

Comportements clés :

1. **Troncation de grandes chaînes** : les chaînes surdimensionnées sont coupées et suffixées avec `"[Session persistence truncated large content]"`.
2. **Suppression des champs transitoires** : `partialJson` et `jsonlEvents` sont supprimés des entrées persistées.
3. **Externalisation des images vers les blobs** :
   - s'applique uniquement aux blocs d'image dans les tableaux `content`,
   - uniquement quand `data` n'est pas déjà une référence blob,
   - uniquement quand la longueur base64 atteint au moins le seuil (`BLOB_EXTERNALIZE_THRESHOLD = 1024`),
   - remplace le base64 en ligne par `blob:sha256:<hash>`.

Cela maintient le JSONL de session compact tout en préservant la récupérabilité.

## 2) Chemin de réhydratation au chargement de session

Lors de l'ouverture d'une session (`setSessionFile`), après les migrations, `SessionManager` exécute `resolveBlobRefsInEntries()`.

Pour chaque bloc d'image message/message-personnalisé avec `blob:sha256:<hash>` :

- lit les octets du blob depuis le magasin de blobs,
- convertit les octets en base64,
- modifie l'entrée en mémoire pour intégrer le base64 en ligne pour les consommateurs du runtime.

Si le blob est manquant :

- `resolveImageData()` journalise un avertissement,
- retourne la chaîne de référence originale inchangée,
- le chargement continue (pas de plantage).

## 3) Chemin de débordement/troncation de sortie d'outil

`OutputSink` alimente la sortie en flux continu dans bash/python/ssh et les exécuteurs associés.

Comportement :

1. Chaque morceau est assaini et ajouté au tampon de queue en mémoire.
2. Quand les octets en mémoire dépassent le seuil de débordement (`DEFAULT_MAX_BYTES`, 50 Ko), le sink marque la sortie comme tronquée.
3. Si un chemin d'artefact est disponible, le sink ouvre un écrivain de fichier et écrit :
   - le contenu tamponné existant une fois,
   - tous les morceaux suivants.
4. Le tampon en mémoire est toujours rogné à la fenêtre de queue pour l'affichage.
5. `dump()` retourne un résumé incluant `artifactId` uniquement quand le sink de fichier a été créé avec succès.

Effet pratique :

- l'UI/le retour d'outil affiche la queue tronquée,
- la sortie complète est préservée dans le fichier d'artefact et référencée comme `artifact://<id>`.

Si la création du sink de fichier échoue (erreur d'E/S, chemin manquant, etc.), le sink bascule silencieusement vers la troncation en mémoire seule ; la sortie complète n'est pas persistée.

## Modèle d'accès par URL

## Références `blob:`

`blob:sha256:<hash>` est une référence de persistance à l'intérieur des charges utiles des entrées de session, pas un schéma d'URL interne géré par le routeur. La résolution est effectuée par `SessionManager` pendant le chargement de session.

## `artifact://<id>`

Géré par `ArtifactProtocolHandler` :

- nécessite un répertoire d'artefacts de session actif,
- l'ID doit être numérique,
- résolu en faisant correspondre le préfixe du nom de fichier `<id>.`,
- retourne du texte brut (`text/plain`) depuis le fichier `.log` correspondant,
- en cas d'absence, l'erreur inclut la liste des IDs d'artefacts disponibles.

Comportement en cas de répertoire manquant :

- si le répertoire d'artefacts n'existe pas, lance `No artifacts directory found`.

## `agent://<id>`

Géré par `AgentProtocolHandler` sur `<artifactsDir>/<id>.md` :

- la forme simple retourne du texte markdown,
- les formes `/path` ou `?q=` effectuent une extraction JSON,
- l'extraction par chemin et par requête ne peuvent pas être combinées,
- si l'extraction est demandée, le contenu du fichier doit pouvoir être analysé comme JSON.

Comportement en cas de répertoire manquant :

- lance `No artifacts directory found`.

Comportement en cas de sortie manquante :

- lance `Not found: <id>` avec les IDs disponibles à partir des fichiers `.md` existants.

Intégration de l'outil read :

- `read` prend en charge la pagination offset/limit pour les lectures d'URL internes sans extraction,
- rejette `offset/limit` quand l'extraction `agent://` est utilisée.

## Sémantique de reprise, fork et déplacement

## Reprise

- `ArtifactManager` parcourt les fichiers `{id}.*.log` existants lors de la première allocation et continue la numérotation.
- `AgentOutputManager` parcourt les IDs de sortie `.md` existants et continue la numérotation.
- `SessionManager` réhydrate les références blob en base64 au chargement.

## Fork

`SessionManager.fork()` crée un nouveau fichier de session avec un nouvel ID de session et un lien `parentSession`, puis retourne les anciens/nouveaux chemins de fichiers. La copie des artefacts est gérée par `AgentSession.fork()` :

- tente une copie récursive de l'ancien répertoire d'artefacts vers le nouveau répertoire d'artefacts,
- l'absence de l'ancien répertoire est tolérée,
- les erreurs de copie non-ENOENT sont journalisées comme avertissements et le fork se termine quand même.

Implications sur les IDs après le fork :

- si la copie a réussi, les compteurs d'artefacts dans la nouvelle session continuent après l'ID maximum copié,
- si la copie a échoué/été ignorée, les IDs d'artefacts de la nouvelle session commencent à `0`.

Implications sur les blobs après le fork :

- les blobs sont globaux et adressés par contenu, donc aucune copie de répertoire de blobs n'est nécessaire.

## Déplacement vers un nouveau répertoire de travail

`SessionManager.moveTo()` renomme à la fois le fichier de session et le répertoire d'artefacts vers le nouveau répertoire de session par défaut, avec une logique de restauration si une étape ultérieure échoue. Cela préserve l'identité des artefacts tout en relocalisent la portée de la session.

## Gestion des échecs et chemins de repli

| Cas | Comportement |
| --- | --- |
| Fichier blob manquant pendant la réhydratation | Avertit et conserve la chaîne de référence `blob:sha256:` en mémoire |
| ENOENT lors de la lecture blob via `BlobStore.get` | Retourne `null` |
| Répertoire d'artefacts manquant (`ArtifactManager.listFiles`) | Retourne une liste vide (l'allocation peut repartir de zéro) |
| Répertoire d'artefacts manquant (`artifact://` / `agent://`) | Lance explicitement `No artifacts directory found` |
| ID d'artefact non trouvé | Lance avec la liste des IDs disponibles |
| Échec d'initialisation de l'écrivain d'artefact OutputSink | Continue avec la troncation de queue seule (pas d'artefact de sortie complète) |
| Pas de fichier de session (certains chemins de tâche) | L'outil task bascule vers un répertoire d'artefacts temporaire pour les sorties de sous-agents |

## Externalisation de blobs binaires vs artefacts de sortie texte

- **L'externalisation de blobs** concerne les charges utiles d'images binaires à l'intérieur du contenu des entrées de session persistées ; elle remplace le base64 en ligne dans le JSONL par des références stables de contenu.
- **Les artefacts** sont des fichiers texte brut pour les sorties d'exécution et les sorties de sous-agents ; ils sont adressables par des IDs locaux à la session via des URLs internes.

Les deux systèmes ne se croisent qu'indirectement (tous deux réduisent le gonflement du JSONL de session) mais ont des chemins d'identité, de durée de vie et de récupération différents.

## Fichiers d'implémentation

- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts) — format de référence blob, hachage, put/get, helpers d'externalisation/résolution.
- [`src/session/artifacts.ts`](../../packages/coding-agent/src/session/artifacts.ts) — modèle de répertoire d'artefacts de session et allocation d'IDs d'artefacts numériques.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — comportement de troncation/débordement vers fichier de `OutputSink` et métadonnées de résumé.
- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts) — transformations de persistance, réhydratation des blobs au chargement, interactions fork/déplacement de session.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — copie du répertoire d'artefacts pendant le fork interactif.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — amorçage du gestionnaire d'artefacts d'outils et allocation de chemin d'artefact par outil.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — résolveur `artifact://`.
- [`src/internal-urls/agent-protocol.ts`](../../packages/coding-agent/src/internal-urls/agent-protocol.ts) — résolveur `agent://` + extraction JSON.
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts) — câblage du routeur d'URL internes et résolveur de répertoire d'artefacts.
- [`src/task/output-manager.ts`](../../packages/coding-agent/src/task/output-manager.ts) — allocation d'IDs de sortie d'agent à portée de session pour `agent://`.
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts) — écritures d'artefacts de sortie de sous-agent (`<id>.md`) et repli vers un répertoire d'artefacts temporaire.
