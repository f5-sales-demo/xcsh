---
title: Notebook Tool Runtime Internals
description: >-
  Jupyter notebook tool runtime with cell execution, kernel lifecycle, and
  output rendering.
sidebar:
  order: 2
  label: Notebook tool
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# Fonctionnement interne du runtime de l'outil notebook

Ce document décrit l'implémentation actuelle de l'outil `notebook` et sa relation avec le runtime Python basé sur un kernel.

La distinction essentielle : **`notebook` est un éditeur JSON de notebooks, pas un exécuteur de notebooks**. Il modifie directement les sources des cellules `.ipynb` ; il ne démarre pas et ne communique pas avec un kernel Python.

## Fichiers d'implémentation

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) Frontière du runtime : édition vs exécution

## Outil `notebook` (`src/tools/notebook.ts`)

- Prend en charge `action: edit | insert | delete` sur un fichier `.ipynb`.
- Résout le chemin relativement au CWD de la session (`resolveToCwd`).
- Charge le JSON du notebook, valide le tableau `cells`, valide les limites de `cell_index`.
- Applique les modifications de source en mémoire et réécrit le JSON complet du notebook avec `JSON.stringify(notebook, null, 1)`.
- Retourne un résumé textuel + des `details` structurés (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`).

Aucun cycle de vie de kernel n'existe dans cet outil :

- pas d'acquisition de gateway
- pas d'ID de session kernel
- pas de `execute_request`
- pas de chunks de flux provenant des canaux du kernel
- pas de capture d'affichage riche (`image/png`, affichage JSON, MIME de statut)

## Chemin d'exécution de type notebook (`src/tools/python.ts` + `src/ipy/*`)

Lorsque l'agent a besoin d'exécuter du code Python de type cellule (cellules séquentielles, état persistant, affichages riches), cela passe par l'outil **`python`**, pas par `notebook`.

C'est dans ce chemin que résident les modes kernel, le comportement de redémarrage/annulation, le streaming par chunks et la troncature des artefacts de sortie.

## 2) Sémantique de gestion des cellules du notebook (outil `notebook`)

## Normalisation des sources

`content` est découpé en `source: string[]` avec préservation des retours à la ligne :

- chaque ligne non finale conserve le `\n` de fin
- la ligne finale n'a pas de retour à la ligne forcé en fin

Cela reflète les conventions JSON des notebooks et évite la concaténation accidentelle de lignes lors d'éditions ultérieures.

## Comportement des actions

- `edit`
  - remplace `cells[cell_index].source`
  - préserve le `cell_type` existant
- `insert`
  - insère à la position `[0..cellCount]`
  - `cell_type` par défaut à `code`
  - les cellules de code initialisent `execution_count: null` et `outputs: []`
  - les cellules markdown initialisent uniquement `metadata` + `source`
- `delete`
  - supprime `cells[cell_index]`
  - retourne la `source` supprimée dans les détails pour l'aperçu du renderer

## Surfaces d'erreurs

Des erreurs fatales sont levées pour :

- fichier notebook manquant
- JSON invalide
- `cells` manquant ou non-tableau
- index hors limites (les plages valides diffèrent entre insertion et non-insertion)
- `content` manquant pour `edit`/`insert`

Celles-ci deviennent des réponses d'outil `Error:` en amont ; le renderer utilise le chemin du notebook + le texte d'erreur formaté.

## 3) Sémantique des sessions kernel (là où elles existent réellement)

La sémantique du kernel est implémentée dans `executePython` / `PythonKernel` et s'applique à l'outil `python`.

## Modes

`PythonKernelMode` :

- `session` (par défaut)
  - kernels mis en cache dans la map `kernelSessions`
  - maximum 4 sessions ; la plus ancienne est évincée en cas de dépassement
  - nettoyage des sessions inactives/mortes toutes les 30s, timeout après 5 minutes
  - file d'attente par session sérialisant l'exécution (`session.queue`)
- `per-call`
  - crée un kernel pour la requête
  - exécute
  - arrête toujours le kernel dans le `finally`

## Comportement de réinitialisation

L'outil `python` passe `reset` uniquement pour la première cellule dans un appel multi-cellules ; les cellules suivantes s'exécutent toujours avec `reset: false`.

## Mort du kernel / redémarrage / nouvelle tentative

En mode session (`withKernelSession`) :

- le kernel mort est détecté par le heartbeat (vérification `kernel.isAlive()` toutes les 5s) ou par un échec d'exécution.
- un état mort pré-exécution déclenche `restartKernelSession`.
- un crash pendant l'exécution réessaie une fois : redémarre le kernel, relance le handler.
- `restartCount > 1` dans la même session lève `Python kernel restarted too many times in this session`.

Comportement de nouvelle tentative au démarrage :

- la création de kernel via gateway partagé réessaie une fois en cas de `SharedGatewayCreateError` avec HTTP 5xx.

Récupération en cas d'épuisement des ressources :

- détecte les échecs de type `EMFILE`/`ENFILE`/"Too many open files"
- vide les sessions suivies
- appelle `shutdownSharedGateway()`
- réessaie la création de session kernel une fois

## 4) Injection de variables d'environnement/session

Le démarrage du kernel reçoit une map d'environnement optionnelle depuis l'exécuteur :

- `PI_SESSION_FILE` (chemin du fichier d'état de session)
- `ARTIFACTS` (répertoire des artefacts)

`PythonKernel.#initializeKernelEnvironment(...)` exécute ensuite un script d'initialisation à l'intérieur du kernel pour :

- `os.chdir(cwd)`
- injecter les entrées d'environnement dans `os.environ`
- ajouter cwd en tête de `sys.path` si absent

Implication :

- les helpers de prélude qui lisent le contexte de session ou d'artefacts dépendent de ces variables d'environnement dans l'état du processus Python.

## 5) Gestion du streaming/chunks et de l'affichage (chemin basé sur le kernel)

Le client kernel traite les messages du protocole Jupyter par exécution :

- `stream` -> chunk de texte vers `onChunk`
- `execute_result` / `display_data` ->
  - le texte d'affichage est choisi par ordre de priorité MIME : `text/markdown` > `text/plain` > `text/html` converti
  - les sorties structurées sont capturées séparément :
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (pas d'émission de texte)
- `error` -> le texte du traceback est poussé dans le flux de chunks + métadonnées d'erreur structurées
- `input_request` -> émet un texte d'avertissement stdin, envoie un `input_reply` vide, marque la demande stdin
- la complétion attend à la fois `execute_reply` et le `status=idle` du kernel

Annulation/timeout :

- le signal d'abandon déclenche `interrupt()` (REST `/interrupt` + `interrupt_request` sur le canal de contrôle)
- le résultat marque `cancelled=true`
- le chemin de timeout annote la sortie avec `Command timed out after <n> seconds`

## 6) Comportement de troncature et d'artefacts

`OutputSink` dans `src/session/streaming-output.ts` est utilisé par les chemins d'exécution du kernel (`executeWithKernel`) :

- assainit chaque chunk (`sanitizeText`)
- suit le nombre total de lignes/sorties et d'octets
- fichier de débordement d'artefact optionnel (`artifactPath`, `artifactId`)
- lorsque le buffer en mémoire dépasse le seuil (`DEFAULT_MAX_BYTES` sauf surcharge) :
  - marque comme tronqué
  - conserve les octets de fin en mémoire (frontière UTF-8 sûre)
  - peut déverser le flux complet vers le récepteur d'artefacts

`dump()` retourne :

- le texte de sortie visible (éventuellement tronqué en fin)
- l'indicateur de troncature + les compteurs
- l'ID d'artefact (pour les références `artifact://<id>`)

L'outil `python` convertit ces métadonnées en avis de troncature du résultat et avertissements TUI.

L'outil `notebook` n'utilise **pas** `OutputSink` ; il n'a pas de pipeline de troncature de flux/artefacts car il n'exécute pas de code.

## 7) Hypothèses du renderer et formatage

## Renderer du notebook (`notebookToolRenderer`)

- vue d'appel : ligne de statut avec action + chemin du notebook + métadonnées de cellule/type
- vue de résultat :
  - résumé de succès dérivé des `details`
  - `cellSource` rendu via `renderCodeCell`
  - les cellules markdown définissent l'indication de langage `markdown` ; les autres cellules n'ont pas de surcharge explicite de langage
  - la limite d'aperçu réduit est `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - prend en charge le mode étendu via les options de rendu partagées
  - utilise un cache de rendu indexé par largeur + état d'expansion

Hypothèse de rendu des erreurs :

- si le premier contenu textuel commence par `Error:`, le renderer formate comme un bloc d'erreur notebook.

## Renderer Python (pour la sortie d'exécution réelle)

Le rendu d'exécution basé sur le kernel attend :

- des transitions de statut par cellule (`pending/running/complete/error`)
- une section optionnelle d'événement de statut structuré
- des arbres de sortie JSON optionnels
- des avertissements de troncature + pointeur optionnel `artifact://<id>`

Ce comportement du renderer n'est pas lié aux résultats d'édition JSON de `notebook`, sauf que les deux réutilisent des primitives TUI partagées.

## 8) Divergence par rapport au comportement de l'outil Python simple

Si « outil Python simple » désigne le chemin d'exécution `python` :

- `python` exécute du code dans un kernel, persiste l'état selon le mode, diffuse des chunks en streaming, capture les affichages riches, gère les interruptions/timeouts, et prend en charge la troncature de sortie/artefacts.
- `notebook` effectue uniquement des mutations JSON déterministes du notebook ; pas d'exécution, pas d'état kernel, pas de flux de chunks, pas de sorties d'affichage, pas de pipeline d'artefacts.

Si un workflow nécessite les deux :

1. éditer la source du notebook avec `notebook`
2. exécuter les cellules de code via `python` (en passant le code manuellement), pas via `notebook`

L'implémentation actuelle ne fournit pas un outil unique qui à la fois modifie le `.ipynb` et exécute les cellules du notebook dans un contexte kernel.
