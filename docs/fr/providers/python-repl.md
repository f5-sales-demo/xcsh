---
title: Outil Python et runtime IPython
description: >-
  Outil REPL Python avec gestion du noyau IPython, exécution et capture de
  sortie.
sidebar:
  order: 3
  label: Python & IPython
i18n:
  sourceHash: 70f0a034ecef
  translator: machine
---

# Outil Python et runtime IPython

Ce document décrit la pile d'exécution Python actuelle dans `packages/coding-agent`.
Il couvre le comportement de l'outil, le cycle de vie du noyau/gateway, la gestion de l'environnement, la sémantique d'exécution, le rendu des sorties et les modes de défaillance opérationnels.

## Portée et fichiers clés

- Surface de l'outil : `src/tools/python.ts`
- Orchestration du noyau par session/appel : `src/ipy/executor.ts`
- Protocole du noyau + intégration gateway : `src/ipy/kernel.ts`
- Coordinateur de gateway local partagé : `src/ipy/gateway-coordinator.ts`
- Rendu en mode interactif pour les exécutions Python déclenchées par l'utilisateur : `src/modes/components/python-execution.ts`
- Filtrage runtime/environnement et résolution Python : `src/ipy/runtime.ts`

## Qu'est-ce que l'outil Python

L'outil `python` exécute une ou plusieurs cellules Python via un noyau adossé à un Jupyter Kernel Gateway (et non en lançant directement `python -c` pour chaque cellule).

Paramètres de l'outil :

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // secondes, borné entre 1 et 600, par défaut 30
  cwd?: string;
  reset?: boolean; // réinitialise le noyau avant la première cellule uniquement
}
```

L'outil est `concurrency = "exclusive"` pour une session, les appels ne se chevauchent donc pas.

## Cycle de vie du gateway

### Modes

Il existe deux chemins de gateway :

1. **Gateway externe** (`PI_PYTHON_GATEWAY_URL` défini)
   - Utilise directement l'URL configurée.
   - Authentification optionnelle avec `PI_PYTHON_GATEWAY_TOKEN`.
   - Aucun processus de gateway local n'est lancé ni géré.

2. **Gateway local partagé** (chemin par défaut)
   - Utilise un processus partagé unique coordonné sous `~/.xcsh/agent/python-gateway`.
   - Fichier de métadonnées : `gateway.json`
   - Fichier de verrou : `gateway.lock`
   - Commande de lancement :
     - `python -m kernel_gateway`
     - lié à `127.0.0.1:<port-alloué>`
     - vérification de santé au démarrage : `GET /api/kernelspecs`

### Coordination du gateway local partagé

`acquireSharedGateway()` :

- Prend un verrou de fichier (`gateway.lock`) avec battement de cœur.
- Réutilise `gateway.json` si le PID est actif et que la vérification de santé réussit.
- Nettoie les informations/PIDs obsolètes si nécessaire.
- Démarre un nouveau gateway lorsqu'aucun gateway sain n'existe.

`releaseSharedGateway()` est actuellement une opération sans effet (l'arrêt du noyau ne détruit pas le gateway partagé).

`shutdownSharedGateway()` termine explicitement le processus partagé et efface les métadonnées du gateway.

### Contrainte importante

`python.sharedGateway=false` est rejeté au démarrage du noyau :

- Erreur : `Shared Python gateway required; local gateways are disabled`
- Il n'existe pas de mode gateway local non partagé par processus.

## Cycle de vie du noyau

Chaque exécution utilise un noyau créé via `POST /api/kernels` sur le gateway sélectionné.

Séquence de démarrage du noyau :

1. Vérification de disponibilité (`checkPythonKernelAvailability`)
2. Création du noyau (`/api/kernels`)
3. Ouverture du websocket (`/api/kernels/:id/channels`)
4. Initialisation de l'environnement du noyau (`cwd`, variables d'environnement, `sys.path`)
5. Exécution du `PYTHON_PRELUDE`
6. Chargement des modules d'extension depuis :
   - utilisateur : `~/.xcsh/agent/modules/*.py`
   - projet : `<cwd>/.xcsh/modules/*.py` (remplace un module utilisateur de même nom)

Arrêt du noyau :

- Supprime le noyau distant via `DELETE /api/kernels/:id`
- Ferme le websocket
- Appelle le hook de libération du gateway partagé (sans effet aujourd'hui)

## Sémantique de persistance de session

`python.kernelMode` contrôle la réutilisation du noyau :

- `session` (par défaut)
  - Réutilise les sessions de noyau indexées par identité de session + cwd.
  - L'exécution est sérialisée par session via une file d'attente.
  - Les sessions inactives sont évincées après 5 minutes.
  - Maximum 4 sessions ; la plus ancienne est évincée en cas de dépassement.
  - Les vérifications par battement de cœur détectent les noyaux morts.
  - Le redémarrage automatique est autorisé une fois ; un crash répété entraîne une défaillance définitive.

- `per-call`
  - Crée un noyau neuf pour chaque requête d'exécution.
  - Arrête le noyau après la requête.
  - Aucune persistance d'état entre les appels.

### Comportement multi-cellules dans un seul appel d'outil

Les cellules s'exécutent séquentiellement dans la même instance de noyau pour cet appel d'outil.

Si une cellule intermédiaire échoue :

- L'état des cellules précédentes reste en mémoire.
- L'outil retourne une erreur ciblée indiquant quelle cellule a échoué.
- Les cellules suivantes ne sont pas exécutées.

`reset=true` ne s'applique qu'à l'exécution de la première cellule dans cet appel.

## Filtrage de l'environnement et résolution du runtime

L'environnement est filtré avant de lancer le runtime gateway/noyau :

- La liste d'autorisation inclut les variables essentielles comme `PATH`, `HOME`, les variables de locale, `VIRTUAL_ENV`, `PYTHONPATH`, etc.
- Préfixes autorisés : `LC_`, `XDG_`, `PI_`
- La liste de refus supprime les clés API courantes (OpenAI/Anthropic/Gemini/etc.)

Ordre de sélection du runtime :

1. Venv actif/détecté (`VIRTUAL_ENV`, puis `<cwd>/.venv`, `<cwd>/venv`)
2. Venv géré à `~/.xcsh/python-env`
3. `python` ou `python3` dans le PATH

Lorsqu'un venv est sélectionné, son chemin bin/Scripts est ajouté en tête du `PATH`.

L'initialisation de l'environnement du noyau à l'intérieur de Python effectue également :

- `os.chdir(cwd)`
- injection de la map d'environnement fournie dans `os.environ`
- ajout du cwd dans `sys.path`

## Disponibilité de l'outil et sélection du mode

`python.toolMode` (par défaut `both`) + remplacement optionnel `PI_PY` contrôle l'exposition :

- `ipy-only`
- `bash-only`
- `both`

Valeurs acceptées pour `PI_PY` :

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

Si la vérification préalable Python échoue, la création de l'outil se dégrade en bash-only pour cette session.

## Flux d'exécution et annulation/timeout

### Timeout au niveau de l'outil

Le timeout de l'outil `python` est en secondes, par défaut 30, borné entre `1..600`.

L'outil combine :

- le signal d'abandon de l'appelant
- le signal d'abandon du timeout

avec `AbortSignal.any(...)`.

### Annulation de l'exécution du noyau

En cas d'abandon/timeout :

- L'exécution est marquée comme annulée.
- Une interruption du noyau est tentée via REST (`POST /interrupt`) et `interrupt_request` sur le canal de contrôle.
- Le résultat inclut `cancelled=true`.
- Le chemin de timeout annote la sortie avec `Command timed out after <n> seconds`.

### Comportement stdin

Le stdin interactif n'est pas pris en charge.

Si le noyau émet `input_request` :

- L'outil enregistre `stdinRequested=true`
- Émet un texte explicatif
- Envoie un `input_reply` vide
- L'exécution est traitée comme un échec au niveau de la couche d'exécution

## Capture et rendu des sorties

### Classes de sortie capturées

À partir des messages du noyau :

- `stream` -> fragments de texte brut
- `display_data`/`execute_result` -> gestion de l'affichage enrichi
- `error` -> texte de traceback
- MIME personnalisé `application/x-xcsh-status` -> événements de statut structurés

Priorité des MIME d'affichage :

1. `text/markdown`
2. `text/plain`
3. `text/html` (converti en markdown basique)

Également capturés comme sorties structurées :

- `application/json` -> données en arbre JSON
- `image/png` -> données d'image
- `application/x-xcsh-status` -> événements de statut

### Stockage et troncature

La sortie est transmise en flux via `OutputSink` et peut être persistée dans le stockage d'artefacts.

Les résultats de l'outil peuvent inclure des métadonnées de troncature et `artifact://<id>` pour la récupération de la sortie complète.

### Comportement du rendu

- Rendu de l'outil (`python.ts`) :
  - affiche les blocs de cellules de code avec le statut par cellule
  - l'aperçu réduit est limité par défaut à 10 lignes
  - prend en charge le mode étendu pour une sortie complète et un détail de statut plus riche
- Rendu interactif (`python-execution.ts`) :
  - utilisé pour l'exécution Python déclenchée par l'utilisateur dans le TUI
  - l'aperçu réduit est limité par défaut à 20 lignes
  - limite les lignes individuelles très longues à 4000 caractères pour la sécurité d'affichage
  - affiche les notifications d'annulation/erreur/troncature

## Support du gateway externe

Configurer :

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# Optionnel :
export PI_PYTHON_GATEWAY_TOKEN="..."
```

Différences de comportement par rapport au gateway local partagé :

- Pas de fichiers de verrou/informations de gateway local
- Pas de lancement/terminaison de processus local
- Les vérifications de santé et les opérations CRUD sur les noyaux s'exécutent contre le point de terminaison externe
- Les échecs d'authentification sont signalés avec des indications explicites sur le token

## Dépannage opérationnel (modes de défaillance actuels)

- **Outil Python non disponible**
  - Vérifiez `python.toolMode` / `PI_PY`.
  - Si la vérification préalable échoue, le runtime se rabat sur bash-only.

- **Erreurs de disponibilité du noyau**
  - Le mode local nécessite que `kernel_gateway` et `ipykernel` soient importables dans le runtime Python résolu.
  - Installer avec :

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` provoque un échec au démarrage**
  - C'est le comportement attendu avec l'implémentation actuelle.

- **Échecs d'authentification/accessibilité du gateway externe**
  - 401/403 -> définissez `PI_PYTHON_GATEWAY_TOKEN`.
  - timeout/inaccessible -> vérifiez l'URL/le réseau et la santé du gateway.

- **L'exécution se bloque puis expire**
  - Augmentez le `timeout` de l'outil (max 600s) si la charge de travail est légitime.
  - Pour du code bloqué, l'annulation déclenche une interruption du noyau mais le code utilisateur peut nécessiter une refactorisation.

- **Invites stdin/input dans le code Python**
  - `input()` n'est pas pris en charge de manière interactive dans ce chemin d'exécution ; transmettez les données de manière programmatique.

- **Épuisement des ressources (`EMFILE` / trop de fichiers ouverts)**
  - Le gestionnaire de sessions déclenche la récupération du gateway partagé (démontage de session + redémarrage du gateway partagé).

- **Erreurs de répertoire de travail**
  - L'outil valide que `cwd` existe et est un répertoire avant l'exécution.

## Variables d'environnement pertinentes

- `PI_PY` — remplacement de l'exposition de l'outil (correspondance `bash-only`/`ipy-only`/`both` ci-dessus)
- `PI_PYTHON_GATEWAY_URL` — utiliser un gateway externe
- `PI_PYTHON_GATEWAY_TOKEN` — token d'authentification optionnel pour le gateway externe
- `PI_PYTHON_SKIP_CHECK=1` — contourner les vérifications préalables/de préchauffage Python
- `PI_PYTHON_IPC_TRACE=1` — journaliser les traces d'envoi/réception IPC du noyau
- `PI_DEBUG_STARTUP=1` — émettre des marqueurs de débogage des étapes de démarrage
