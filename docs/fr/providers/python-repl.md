---
title: Outil Python et environnement d'exécution IPython
description: >-
  Environnement d'exécution de l'outil Python REPL avec gestion du noyau
  IPython, exécution et capture de la sortie.
sidebar:
  order: 3
  label: Python & IPython
i18n:
  sourceHash: 70f0a034ecef
  translator: machine
---

# Outil Python et environnement d'exécution IPython

Ce document décrit la pile d'exécution Python actuelle dans `packages/coding-agent`.
Il couvre le comportement de l'outil, le cycle de vie du noyau/de la passerelle, la gestion de l'environnement, la sémantique d'exécution, le rendu de la sortie et les modes de défaillance opérationnels.

## Portée et fichiers clés

- Surface de l'outil : `src/tools/python.ts`
- Orchestration du noyau par session/appel : `src/ipy/executor.ts`
- Protocole du noyau + intégration de la passerelle : `src/ipy/kernel.ts`
- Coordinateur de passerelle locale partagée : `src/ipy/gateway-coordinator.ts`
- Rendu en mode interactif pour les exécutions Python déclenchées par l'utilisateur : `src/modes/components/python-execution.ts`
- Filtrage de l'environnement d'exécution et résolution Python : `src/ipy/runtime.ts`

## Ce qu'est l'outil Python

L'outil `python` exécute une ou plusieurs cellules Python via un noyau adossé à un Jupyter Kernel Gateway (et non en lançant directement `python -c` pour chaque cellule).

Paramètres de l'outil :

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // secondes, limité à 1..600, par défaut 30
  cwd?: string;
  reset?: boolean; // réinitialise le noyau avant la première cellule uniquement
}
```

L'outil est `concurrency = "exclusive"` pour une session, les appels ne se chevauchent donc pas.

## Cycle de vie de la passerelle

### Modes

Il existe deux chemins de passerelle :

1. **Passerelle externe** (`PI_PYTHON_GATEWAY_URL` défini)
   - Utilise directement l'URL configurée.
   - Authentification optionnelle avec `PI_PYTHON_GATEWAY_TOKEN`.
   - Aucun processus de passerelle locale n'est lancé ni géré.

2. **Passerelle locale partagée** (chemin par défaut)
   - Utilise un processus partagé unique coordonné sous `~/.xcsh/agent/python-gateway`.
   - Fichier de métadonnées : `gateway.json`
   - Fichier de verrouillage : `gateway.lock`
   - Commande de lancement :
     - `python -m kernel_gateway`
     - lié à `127.0.0.1:<port-alloué>`
     - vérification de santé au démarrage : `GET /api/kernelspecs`

### Coordination de la passerelle locale partagée

`acquireSharedGateway()` :

- Prend un verrou de fichier (`gateway.lock`) avec battement de cœur.
- Réutilise `gateway.json` si le PID est actif et la vérification de santé passe.
- Nettoie les informations/PID obsolètes si nécessaire.
- Démarre une nouvelle passerelle quand aucune passerelle saine n'existe.

`releaseSharedGateway()` est actuellement une opération sans effet (l'arrêt du noyau ne supprime pas la passerelle partagée).

`shutdownSharedGateway()` termine explicitement le processus partagé et efface les métadonnées de la passerelle.

### Contrainte importante

`python.sharedGateway=false` est rejeté au démarrage du noyau :

- Erreur : `Shared Python gateway required; local gateways are disabled`
- Il n'existe pas de mode passerelle locale non partagée par processus.

## Cycle de vie du noyau

Chaque exécution utilise un noyau créé via `POST /api/kernels` sur la passerelle sélectionnée.

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
- Appelle le hook de libération de la passerelle partagée (sans effet aujourd'hui)

## Sémantique de persistance de session

`python.kernelMode` contrôle la réutilisation du noyau :

- `session` (par défaut)
  - Réutilise les sessions de noyau identifiées par l'identité de session + cwd.
  - L'exécution est sérialisée par session via une file d'attente.
  - Les sessions inactives sont évincées après 5 minutes.
  - Au maximum 4 sessions ; la plus ancienne est évincée en cas de dépassement.
  - Les vérifications par battement de cœur détectent les noyaux morts.
  - Un redémarrage automatique est autorisé une fois ; un crash répété => échec définitif.

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

`reset=true` ne s'applique qu'à la première exécution de cellule dans cet appel.

## Filtrage de l'environnement et résolution de l'environnement d'exécution

L'environnement est filtré avant le lancement de la passerelle/du noyau :

- La liste d'autorisation inclut les variables essentielles comme `PATH`, `HOME`, les variables de locale, `VIRTUAL_ENV`, `PYTHONPATH`, etc.
- Préfixes autorisés : `LC_`, `XDG_`, `PI_`
- La liste de refus supprime les clés API courantes (OpenAI/Anthropic/Gemini/etc.)

Ordre de sélection de l'environnement d'exécution :

1. Venv actif/détecté (`VIRTUAL_ENV`, puis `<cwd>/.venv`, `<cwd>/venv`)
2. Venv géré à `~/.xcsh/python-env`
3. `python` ou `python3` dans le PATH

Quand un venv est sélectionné, son chemin bin/Scripts est ajouté en tête du `PATH`.

L'initialisation de l'environnement du noyau à l'intérieur de Python effectue également :

- `os.chdir(cwd)`
- injecte la carte d'environnement fournie dans `os.environ`
- s'assure que cwd est dans `sys.path`

## Disponibilité de l'outil et sélection du mode

`python.toolMode` (par défaut `both`) + le remplacement optionnel `PI_PY` contrôlent l'exposition :

- `ipy-only`
- `bash-only`
- `both`

Valeurs acceptées pour `PI_PY` :

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

Si la vérification préliminaire Python échoue, la création de l'outil se dégrade en bash-only pour cette session.

## Flux d'exécution et annulation/délai d'attente

### Délai d'attente au niveau de l'outil

Le délai d'attente de l'outil `python` est en secondes, par défaut 30, limité à `1..600`.

L'outil combine :

- le signal d'abandon de l'appelant
- le signal d'abandon du délai d'attente

avec `AbortSignal.any(...)`.

### Annulation de l'exécution du noyau

En cas d'abandon/délai d'attente :

- L'exécution est marquée comme annulée.
- Une interruption du noyau est tentée via REST (`POST /interrupt`) et `interrupt_request` sur le canal de contrôle.
- Le résultat inclut `cancelled=true`.
- Le chemin de délai d'attente annote la sortie avec `Command timed out after <n> seconds`.

### Comportement stdin

L'entrée stdin interactive n'est pas prise en charge.

Si le noyau émet une `input_request` :

- L'outil enregistre `stdinRequested=true`
- Émet un texte explicatif
- Envoie une `input_reply` vide
- L'exécution est traitée comme un échec au niveau de la couche exécuteur

## Capture et rendu de la sortie

### Classes de sortie capturées

Depuis les messages du noyau :

- `stream` -> morceaux de texte brut
- `display_data`/`execute_result` -> gestion de l'affichage riche
- `error` -> texte de trace d'erreur
- MIME personnalisé `application/x-xcsh-status` -> événements de statut structurés

Priorité des MIME d'affichage :

1. `text/markdown`
2. `text/plain`
3. `text/html` (converti en markdown basique)

Également capturés en tant que sorties structurées :

- `application/json` -> données d'arbre JSON
- `image/png` -> charges utiles d'image
- `application/x-xcsh-status` -> événements de statut

### Stockage et troncature

La sortie est transmise en flux via `OutputSink` et peut être persistée dans le stockage d'artefacts.

Les résultats de l'outil peuvent inclure des métadonnées de troncature et `artifact://<id>` pour la récupération de la sortie complète.

### Comportement du rendu

- Rendu de l'outil (`python.ts`) :
  - affiche les blocs de cellules de code avec le statut par cellule
  - l'aperçu réduit est par défaut à 10 lignes
  - prend en charge le mode étendu pour la sortie complète et les détails de statut enrichis
- Rendu interactif (`python-execution.ts`) :
  - utilisé pour l'exécution Python déclenchée par l'utilisateur dans le TUI
  - l'aperçu réduit est par défaut à 20 lignes
  - limite les lignes individuelles très longues à 4000 caractères pour la sécurité d'affichage
  - affiche les avis d'annulation/erreur/troncature

## Prise en charge de la passerelle externe

Définir :

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# Optionnel :
export PI_PYTHON_GATEWAY_TOKEN="..."
```

Différences de comportement par rapport à la passerelle locale partagée :

- Pas de fichiers de verrouillage/information de passerelle locale
- Pas de lancement/terminaison de processus local
- Les vérifications de santé et les opérations CRUD du noyau s'exécutent contre le point de terminaison externe
- Les échecs d'authentification sont signalés avec des indications explicites sur le jeton

## Dépannage opérationnel (modes de défaillance actuels)

- **Outil Python non disponible**
  - Vérifier `python.toolMode` / `PI_PY`.
  - Si la vérification préliminaire échoue, l'environnement d'exécution se replie sur bash-only.

- **Erreurs de disponibilité du noyau**
  - Le mode local nécessite que `kernel_gateway` et `ipykernel` soient importables dans l'environnement d'exécution Python résolu.
  - Installer avec :

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` provoque un échec de démarrage**
  - C'est le comportement attendu avec l'implémentation actuelle.

- **Échecs d'authentification/accessibilité de la passerelle externe**
  - 401/403 -> définir `PI_PYTHON_GATEWAY_TOKEN`.
  - délai d'attente/inaccessible -> vérifier l'URL/le réseau et la santé de la passerelle.

- **L'exécution se bloque puis expire**
  - Augmenter le `timeout` de l'outil (max 600s) si la charge de travail est légitime.
  - Pour du code bloqué, l'annulation déclenche une interruption du noyau mais le code utilisateur peut nécessiter une refactorisation.

- **Invites stdin/input dans le code Python**
  - `input()` n'est pas pris en charge de manière interactive dans ce chemin d'exécution ; transmettez les données de manière programmatique.

- **Épuisement des ressources (`EMFILE` / trop de fichiers ouverts)**
  - Le gestionnaire de session déclenche la récupération de la passerelle partagée (démontage de la session + redémarrage de la passerelle partagée).

- **Erreurs de répertoire de travail**
  - L'outil valide que `cwd` existe et est un répertoire avant l'exécution.

## Variables d'environnement pertinentes

- `PI_PY` — remplacement de l'exposition de l'outil (correspondance `bash-only`/`ipy-only`/`both` ci-dessus)
- `PI_PYTHON_GATEWAY_URL` — utiliser une passerelle externe
- `PI_PYTHON_GATEWAY_TOKEN` — jeton d'authentification optionnel pour la passerelle externe
- `PI_PYTHON_SKIP_CHECK=1` — contourner les vérifications préliminaires/de préchauffage Python
- `PI_PYTHON_IPC_TRACE=1` — journaliser les traces d'envoi/réception IPC du noyau
- `PI_DEBUG_STARTUP=1` — émettre des marqueurs de débogage des étapes de démarrage
