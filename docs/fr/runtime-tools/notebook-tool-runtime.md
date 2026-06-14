---
title: Internes du runtime de l'outil Notebook
description: >-
  Runtime de l'outil Notebook Jupyter avec exécution de cellules, cycle de vie
  du noyau et rendu des sorties.
sidebar:
  order: 2
  label: Outil Notebook
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# Internes du runtime de l'outil Notebook

Ce document décrit l'implémentation actuelle de l'outil `notebook` et sa relation avec le runtime Python adossé à un noyau.

La distinction essentielle : **`notebook` est un éditeur JSON de notebooks, pas un exécuteur de notebooks**. Il modifie directement les sources des cellules `.ipynb` ; il ne démarre pas de noyau Python et ne communique pas avec lui.

## Fichiers d'implémentation

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) Frontière du runtime : édition vs exécution

## Outil `notebook` (`src/tools/notebook.ts`)

- Prend en charge `action: edit | insert | delete` sur un fichier `.ipynb`.
- Résout le chemin relatif au CWD de la session (`resolveToCwd`).
- Charge le JSON du notebook, valide le tableau `cells`, valide les limites de `cell_index`.
- Applique les modifications de source en mémoire et réécrit l'intégralité du JSON du notebook avec `JSON.stringify(notebook, null, 1)`.
- Retourne un résumé textuel + des `details` structurés (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`).

Aucun cycle de vie de noyau n'existe dans cet outil :

- pas d'acquisition de passerelle
- pas d'ID de session de noyau
- pas d'`execute_request`
- pas de fragments de flux provenant des canaux du noyau
- pas de capture d'affichage enrichi (`image/png`, affichage JSON, MIME de statut)

## Chemin d'exécution de type notebook (`src/tools/python.ts` + `src/ipy/*`)

Lorsque l'agent doit exécuter du code Python en style cellule (cellules séquentielles, état persistant, affichages enrichis), cela passe par l'outil **`python`**, et non par `notebook`.

C'est dans ce chemin que résident les modes de noyau, le comportement de redémarrage/annulation, le streaming par fragments et la troncature des artefacts de sortie.

## 2) Sémantique de gestion des cellules du notebook (outil `notebook`)

## Normalisation de la source

`content` est divisé en `source: string[]` avec préservation des sauts de ligne :

- chaque ligne non finale conserve le `\n` de fin
- la ligne finale n'a pas de saut de ligne forcé en fin

Cela respecte les conventions JSON des notebooks et évite la concaténation accidentelle de lignes lors d'éditions ultérieures.

## Comportement des actions

- `edit`
  - remplace `cells[cell_index].source`
  - préserve le `cell_type` existant
- `insert`
  - insère à `[0..cellCount]`
  - `cell_type` prend par défaut la valeur `code`
  - les cellules de code initialisent `execution_count: null` et `outputs: []`
  - les cellules markdown n'initialisent que `metadata` + `source`
- `delete`
  - supprime `cells[cell_index]`
  - retourne la `source` supprimée dans les détails pour l'aperçu du rendu

## Surfaces d'erreur

Les échecs critiques sont levés pour :

- fichier notebook manquant
- JSON invalide
- `cells` manquant ou non-tableau
- index hors limites (les plages valides diffèrent pour l'insertion et les autres opérations)
- `content` manquant pour `edit`/`insert`

Ces erreurs deviennent des réponses d'outil `Error:` en amont ; le rendu utilise le chemin du notebook + le texte d'erreur formaté.

## 3) Sémantique des sessions de noyau (là où elles existent réellement)

La sémantique des noyaux est implémentée dans `executePython` / `PythonKernel` et s'applique à l'outil `python`.

## Modes

`PythonKernelMode` :

- `session` (par défaut)
  - noyaux mis en cache dans la map `kernelSessions`
  - maximum 4 sessions ; la plus ancienne est évincée en cas de dépassement
  - nettoyage des sessions inactives/mortes toutes les 30s, expiration après 5 minutes
  - la file d'attente par session sérialise l'exécution (`session.queue`)
- `per-call`
  - crée un noyau pour la requête
  - exécute
  - arrête toujours le noyau dans le bloc `finally`

## Comportement de réinitialisation

L'outil `python` passe `reset` uniquement pour la première cellule d'un appel multi-cellules ; les cellules suivantes s'exécutent toujours avec `reset: false`.

## Mort du noyau / redémarrage / nouvelle tentative

En mode session (`withKernelSession`) :

- un noyau mort est détecté par battement de cœur (vérification `kernel.isAlive()` toutes les 5s) ou par échec d'exécution.
- un état mort avant exécution déclenche `restartKernelSession`.
- le chemin de plantage au moment de l'exécution effectue une nouvelle tentative : redémarre le noyau, réexécute le gestionnaire.
- `restartCount > 1` dans la même session lève l'erreur `Python kernel restarted too many times in this session`.

Comportement de nouvelle tentative au démarrage :

- la création de noyau sur passerelle partagée effectue une nouvelle tentative sur `SharedGatewayCreateError` avec un HTTP 5xx.

Récupération en cas d'épuisement des ressources :

- détecte les échecs de type `EMFILE`/`ENFILE`/"Too many open files"
- efface les sessions suivies
- appelle `shutdownSharedGateway()`
- effectue une nouvelle tentative de création de session de noyau

## 4) Injection de variables d'environnement/session

Le démarrage du noyau reçoit une map d'environnement optionnelle de l'exécuteur :

- `PI_SESSION_FILE` (chemin du fichier d'état de session)
- `ARTIFACTS` (répertoire des artefacts)

`PythonKernel.#initializeKernelEnvironment(...)` exécute ensuite le script d'initialisation dans le noyau pour :

- `os.chdir(cwd)`
- injecter les entrées d'environnement dans `os.environ`
- ajouter cwd en tête de `sys.path` s'il est absent

Implication :

- les helpers de préambule qui lisent le contexte de session ou d'artefact s'appuient sur ces variables d'environnement dans l'état du processus Python.

## 5) Gestion du streaming/fragments et des affichages (chemin adossé au noyau)

Le client du noyau traite les messages du protocole Jupyter par exécution :

- `stream` -> fragment de texte vers `onChunk`
- `execute_result` / `display_data` ->
  - texte d'affichage choisi par priorité MIME : `text/markdown` > `text/plain` > `text/html` converti
  - sorties structurées capturées séparément :
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (pas d'émission de texte)
- `error` -> texte de traceback poussé vers le flux de fragments + métadonnées d'erreur structurées
- `input_request` -> émet un texte d'avertissement stdin, envoie une réponse `input_reply` vide, marque stdin comme demandé
- la complétion attend à la fois `execute_reply` et le `status=idle` du noyau

Annulation/expiration :

- le signal d'abandon déclenche `interrupt()` (REST `/interrupt` + `interrupt_request` sur le canal de contrôle)
- le résultat est marqué `cancelled=true`
- le chemin d'expiration annote la sortie avec `Command timed out after <n> seconds`

## 6) Comportement de troncature et d'artefacts

`OutputSink` dans `src/session/streaming-output.ts` est utilisé par les chemins d'exécution du noyau (`executeWithKernel`) :

- assainit chaque fragment (`sanitizeText`)
- suit le total des lignes/octets en sortie
- fichier de déversement d'artefact optionnel (`artifactPath`, `artifactId`)
- lorsque le tampon en mémoire dépasse le seuil (`DEFAULT_MAX_BYTES` sauf dérogation) :
  - marqué comme tronqué
  - conserve les octets de fin en mémoire (limite sûre UTF-8)
  - peut déverser le flux complet vers un récepteur d'artefact

`dump()` retourne :

- texte de sortie visible (éventuellement tronqué en fin)
- indicateur de troncature + compteurs
- ID d'artefact (pour les références `artifact://<id>`)

L'outil `python` convertit ces métadonnées en avis de troncature de résultat et avertissements TUI.

L'outil `notebook` n'utilise **pas** `OutputSink` ; il ne dispose pas de pipeline de troncature de flux/artefact car il n'exécute pas de code.

## 7) Hypothèses du rendu et formatage

## Rendu de notebook (`notebookToolRenderer`)

- vue d'appel : ligne de statut avec action + chemin du notebook + métadonnées de cellule/type
- vue de résultat :
  - résumé de succès dérivé de `details`
  - `cellSource` rendu via `renderCodeCell`
  - les cellules markdown définissent l'indication de langage `markdown` ; les autres cellules n'ont pas de dérogation de langage explicite
  - la limite d'aperçu de code réduit est `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - prend en charge le mode développé via les options de rendu partagées
  - utilise un cache de rendu indexé par largeur + état développé

Hypothèse de rendu d'erreur :

- si le premier contenu textuel commence par `Error:`, le rendu formate un bloc d'erreur de notebook.

## Rendu Python (pour la sortie d'exécution réelle)

Le rendu d'exécution adossé au noyau attend :

- des transitions d'état par cellule (`pending/running/complete/error`)
- une section optionnelle d'événements de statut structurés
- des arborescences de sortie JSON optionnelles
- des avertissements de troncature + un pointeur `artifact://<id>` optionnel

Ce comportement du rendu est sans lien avec les résultats de l'édition JSON de `notebook`, si ce n'est que les deux réutilisent des primitives TUI partagées.

## 8) Divergence par rapport au comportement de l'outil Python simple

Si « outil Python simple » désigne le chemin d'exécution `python` :

- `python` exécute du code dans un noyau, persiste l'état selon le mode, stream les fragments, capture les affichages enrichis, gère les interruptions/expirations et prend en charge la troncature de sortie/artefacts.
- `notebook` effectue uniquement des mutations déterministes du JSON de notebook ; pas d'exécution, pas d'état de noyau, pas de flux de fragments, pas de sorties d'affichage, pas de pipeline d'artefacts.

Si un flux de travail nécessite les deux :

1. modifier la source du notebook avec `notebook`
2. exécuter les cellules de code via `python` (en passant le code manuellement), et non via `notebook`

L'implémentation actuelle ne fournit pas d'outil unique qui à la fois mute le `.ipynb` et exécute les cellules du notebook via un contexte de noyau.
