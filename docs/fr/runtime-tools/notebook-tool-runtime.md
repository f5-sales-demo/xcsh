---
title: Fonctionnement interne de l'outil Notebook
description: >-
  Environnement d'exécution de l'outil notebook Jupyter avec exécution de
  cellules, cycle de vie du noyau et rendu des sorties.
sidebar:
  order: 2
  label: Outil Notebook
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# Fonctionnement interne de l'outil notebook

Ce document décrit l'implémentation actuelle de l'outil `notebook` et sa relation avec l'environnement d'exécution Python adossé au noyau.

La distinction essentielle : **`notebook` est un éditeur JSON de notebooks, pas un exécuteur de notebooks**. Il modifie directement les sources de cellules `.ipynb` ; il ne démarre pas et ne communique pas avec un noyau Python.

## Fichiers d'implémentation

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) Frontière d'exécution : édition vs exécution

## Outil `notebook` (`src/tools/notebook.ts`)

- Prend en charge `action: edit | insert | delete` sur un fichier `.ipynb`.
- Résout le chemin relativement au répertoire de travail de la session (`resolveToCwd`).
- Charge le JSON du notebook, valide le tableau `cells`, valide les limites de `cell_index`.
- Applique les modifications de source en mémoire et réécrit l'intégralité du JSON du notebook avec `JSON.stringify(notebook, null, 1)`.
- Retourne un résumé textuel + des `details` structurés (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`).

Aucun cycle de vie de noyau n'existe dans cet outil :

- pas d'acquisition de passerelle
- pas d'identifiant de session noyau
- pas d'`execute_request`
- pas de fragments de flux depuis les canaux du noyau
- pas de capture d'affichage enrichi (`image/png`, affichage JSON, MIME de statut)

## Chemin d'exécution de type notebook (`src/tools/python.ts` + `src/ipy/*`)

Lorsque l'agent a besoin d'exécuter du code Python de type cellule (cellules séquentielles, état persistant, affichages enrichis), cela passe par l'outil **`python`**, pas par `notebook`.

C'est dans ce chemin que résident les modes noyau, le comportement de redémarrage/annulation, le streaming par fragments et la troncature des artefacts de sortie.

## 2) Sémantique de gestion des cellules du notebook (outil `notebook`)

## Normalisation des sources

`content` est découpé en `source: string[]` avec préservation des retours à la ligne :

- chaque ligne non finale conserve son `\n` de fin
- la ligne finale n'a pas de retour à la ligne forcé en fin

Cela reflète les conventions JSON des notebooks et évite la concaténation accidentelle de lignes lors de modifications ultérieures.

## Comportement des actions

- `edit`
  - remplace `cells[cell_index].source`
  - préserve le `cell_type` existant
- `insert`
  - insère à l'index `[0..cellCount]`
  - `cell_type` est par défaut `code`
  - les cellules de code initialisent `execution_count: null` et `outputs: []`
  - les cellules markdown initialisent uniquement `metadata` + `source`
- `delete`
  - supprime `cells[cell_index]`
  - retourne le `source` supprimé dans les détails pour l'aperçu du rendu

## Surfaces d'erreur

Des échecs critiques sont levés pour :

- fichier notebook manquant
- JSON invalide
- `cells` manquant ou non-tableau
- index hors limites (les plages valides diffèrent entre insertion et non-insertion)
- `content` manquant pour `edit`/`insert`

Ceux-ci deviennent des réponses d'outil `Error:` en amont ; le moteur de rendu utilise le chemin du notebook + le texte d'erreur formaté.

## 3) Sémantique des sessions noyau (là où elles existent réellement)

La sémantique du noyau est implémentée dans `executePython` / `PythonKernel` et s'applique à l'outil `python`.

## Modes

`PythonKernelMode` :

- `session` (par défaut)
  - noyaux mis en cache dans la map `kernelSessions`
  - maximum 4 sessions ; la plus ancienne est évincée en cas de dépassement
  - nettoyage inactif/mort toutes les 30 s, expiration après 5 minutes
  - file d'attente par session sérialisant l'exécution (`session.queue`)
- `per-call`
  - crée un noyau pour la requête
  - exécute
  - arrête toujours le noyau dans le bloc `finally`

## Comportement de réinitialisation

L'outil `python` passe `reset` uniquement pour la première cellule dans un appel multi-cellules ; les cellules suivantes s'exécutent toujours avec `reset: false`.

## Mort du noyau / redémarrage / réessai

En mode session (`withKernelSession`) :

- la mort du noyau est détectée par le heartbeat (vérification `kernel.isAlive()` toutes les 5 s) ou par un échec d'exécution.
- un état mort pré-exécution déclenche `restartKernelSession`.
- le chemin de crash à l'exécution réessaie une fois : redémarre le noyau, relance le handler.
- `restartCount > 1` dans la même session lève `Python kernel restarted too many times in this session`.

Comportement de réessai au démarrage :

- la création de noyau via passerelle partagée réessaie une fois en cas de `SharedGatewayCreateError` avec HTTP 5xx.

Récupération après épuisement des ressources :

- détecte les échecs de type `EMFILE`/`ENFILE`/"Too many open files"
- vide les sessions suivies
- appelle `shutdownSharedGateway()`
- réessaie la création de session noyau une fois

## 4) Injection des variables d'environnement/session

Le démarrage du noyau reçoit une map d'environnement optionnelle depuis l'exécuteur :

- `PI_SESSION_FILE` (chemin du fichier d'état de session)
- `ARTIFACTS` (répertoire des artefacts)

`PythonKernel.#initializeKernelEnvironment(...)` exécute ensuite un script d'initialisation à l'intérieur du noyau pour :

- `os.chdir(cwd)`
- injecter les entrées d'environnement dans `os.environ`
- ajouter cwd en tête de `sys.path` s'il est absent

Implication :

- les helpers de prélude qui lisent le contexte de session ou d'artefact dépendent de ces variables d'environnement dans l'état du processus Python.

## 5) Gestion du streaming/fragments et de l'affichage (chemin adossé au noyau)

Le client noyau traite les messages du protocole Jupyter par exécution :

- `stream` -> fragment de texte vers `onChunk`
- `execute_result` / `display_data` ->
  - texte d'affichage choisi par priorité MIME : `text/markdown` > `text/plain` > `text/html` converti
  - sorties structurées capturées séparément :
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (pas d'émission de texte)
- `error` -> texte de traceback poussé vers le flux de fragments + métadonnées d'erreur structurées
- `input_request` -> émet un texte d'avertissement stdin, envoie un `input_reply` vide, marque stdin comme demandé
- la complétion attend à la fois `execute_reply` et le `status=idle` du noyau

Annulation/expiration :

- le signal d'abandon déclenche `interrupt()` (REST `/interrupt` + `interrupt_request` sur le canal de contrôle)
- le résultat est marqué `cancelled=true`
- le chemin d'expiration annote la sortie avec `Command timed out after <n> seconds`

## 6) Comportement de troncature et d'artefacts

`OutputSink` dans `src/session/streaming-output.ts` est utilisé par les chemins d'exécution noyau (`executeWithKernel`) :

- assainit chaque fragment (`sanitizeText`)
- suit le nombre total de lignes/sorties et d'octets
- fichier de déversement d'artefact optionnel (`artifactPath`, `artifactId`)
- lorsque le tampon en mémoire dépasse le seuil (`DEFAULT_MAX_BYTES` sauf surcharge) :
  - marque comme tronqué
  - conserve les octets de fin en mémoire (frontière UTF-8 sûre)
  - peut déverser le flux complet vers le récepteur d'artefacts

`dump()` retourne :

- le texte de sortie visible (éventuellement tronqué en fin)
- l'indicateur de troncature + compteurs
- l'identifiant d'artefact (pour les références `artifact://<id>`)

L'outil `python` convertit ces métadonnées en notices de troncature de résultat et en avertissements TUI.

L'outil `notebook` **n'utilise pas** `OutputSink` ; il ne dispose d'aucun pipeline de troncature flux/artefact car il n'exécute pas de code.

## 7) Hypothèses du moteur de rendu et formatage

## Rendu du notebook (`notebookToolRenderer`)

- vue d'appel : ligne de statut avec action + chemin du notebook + métadonnées cellule/type
- vue de résultat :
  - résumé de succès dérivé des `details`
  - `cellSource` rendu via `renderCodeCell`
  - les cellules markdown définissent l'indicateur de langage `markdown` ; les autres cellules n'ont pas de surcharge de langage explicite
  - la limite d'aperçu replié est `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - prend en charge le mode déplié via les options de rendu partagées
  - utilise un cache de rendu indexé par largeur + état déplié

Hypothèse de rendu d'erreur :

- si le premier contenu textuel commence par `Error:`, le moteur de rendu formate en bloc d'erreur notebook.

## Rendu Python (pour la sortie d'exécution réelle)

Le rendu d'exécution adossé au noyau attend :

- des transitions de statut par cellule (`pending/running/complete/error`)
- une section optionnelle d'événements de statut structurés
- des arbres de sortie JSON optionnels
- des avertissements de troncature + un pointeur optionnel `artifact://<id>`

Ce comportement de rendu est sans rapport avec les résultats d'édition JSON du `notebook`, sauf que les deux réutilisent les primitives TUI partagées.

## 8) Divergence par rapport au comportement de l'outil Python simple

Si « outil Python simple » désigne le chemin d'exécution `python` :

- `python` exécute du code dans un noyau, persiste l'état selon le mode, diffuse des fragments en streaming, capture les affichages enrichis, gère les interruptions/expirations et prend en charge la troncature de sortie/les artefacts.
- `notebook` effectue uniquement des mutations JSON déterministes sur le notebook ; pas d'exécution, pas d'état noyau, pas de flux de fragments, pas de sorties d'affichage, pas de pipeline d'artefacts.

Si un workflow nécessite les deux :

1. modifier la source du notebook avec `notebook`
2. exécuter les cellules de code via `python` (en passant le code manuellement), pas via `notebook`

L'implémentation actuelle ne fournit pas un outil unique qui à la fois modifie le `.ipynb` et exécute les cellules du notebook via un contexte noyau.
