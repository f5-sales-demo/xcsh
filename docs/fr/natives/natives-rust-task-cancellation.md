---
title: Exécution native des tâches Rust et annulation
description: >-
  Modèle d'exécution des tâches asynchrones Rust avec annulation coopérative et
  sémantique de nettoyage.
sidebar:
  order: 5
  label: Annulation des tâches
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# Exécution native des tâches Rust et annulation (`pi-natives`)

Ce document décrit comment `crates/pi-natives` planifie le travail natif et comment l'annulation se propage des options JS (`timeoutMs`, `AbortSignal`) vers l'exécution Rust.

## Fichiers d'implémentation

- `crates/pi-natives/src/task.rs`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/fd.rs`
- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/ps.rs`

## Primitives fondamentales (`task.rs`)

`task.rs` définit trois éléments fondamentaux :

1. `task::blocking(tag, cancel_token, work)`
   - Encapsule `napi::AsyncTask` / `Task`.
   - `compute()` s'exécute sur les threads worker libuv (pour les appels système CPU-intensifs ou bloquants/synchrones).
   - Retourne une `Promise<T>` JS.

2. `task::future(env, tag, work)`
   - Encapsule `env.spawn_future(...)`.
   - Exécute le travail asynchrone sur le runtime Tokio.
   - Retourne `PromiseRaw<'env, T>`.

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` combine une échéance + un `AbortSignal` optionnel.
   - `CancelToken::heartbeat()` est l'annulation coopérative pour les boucles bloquantes.
   - `CancelToken::wait()` est l'attente d'annulation asynchrone (`Signal` / `Timeout` / `User` Ctrl-C).
   - `AbortToken` permet au code externe de demander l'abandon (`abort(reason)`).

## `blocking` vs `future` : modèle d'exécution et sélection

### Utiliser `task::blocking`

À utiliser lorsque le travail est intensif en CPU ou fondamentalement synchrone/bloquant :

- analyse regex/fichiers (`grep`, `glob`, `fuzzy_find`)
- boucles PTY synchrones internes (`run_pty_sync` via `spawn_blocking`)
- conversions clipboard/image/html

Comportement :

- La fermeture reçoit un `CancelToken` cloné.
- L'annulation n'est observée qu'aux endroits où le code vérifie `ct.heartbeat()?`.
- `Err(...)` de la fermeture rejette la promesse JS.

### Utiliser `task::future`

À utiliser lorsque le travail doit faire `await` sur des opérations asynchrones :

- orchestration de session shell (`shell.run`, `executeShell`)
- mise en concurrence des tâches (`tokio::select!`) entre complétion et annulation

Comportement :

- Le future peut mettre en concurrence la complétion normale contre `ct.wait()`.
- Sur le chemin d'annulation, les implémentations asynchrones propagent typiquement l'annulation aux sous-systèmes internes (ex. `tokio_util::CancellationToken`) et forcent optionnellement l'abandon après un délai de grâce.

## Correspondance API JS ↔ export Rust (lié aux tâches/annulation)

| API côté JS | Export Rust (`#[napi]`) | Planificateur | Connexion de l'annulation |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` dans la boucle de filtrage |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` dans la boucle de scoring |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` mis en concurrence contre la tâche d'exécution ; pont vers le `CancellationToken` Tokio |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | identique au précédent |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + `spawn_blocking` interne | `CancelToken` vérifié dans la boucle PTY synchrone via `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | aucune (jeton `()`) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | aucune (jeton `()`) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | aucune (jeton `()`) |

`text.rs` et `ps.rs` n'utilisent actuellement pas `task::blocking`/`task::future` et ne participent donc pas à ce chemin d'annulation.

## Cycle de vie de l'annulation et transitions d'état

### Cycle de vie du `CancelToken`

`CancelToken` est coopératif et à état :

```text
Créé
  ├─ pas de signal + pas de timeout  -> jeton passif (n'abandonne jamais sauf placement externe)
  ├─ signal enregistré               -> attend le callback AbortSignal
  └─ échéance définie                -> la vérification du timeout devient active

En cours d'exécution
  ├─ heartbeat()/wait() détecte signal   -> AbortReason::Signal
  ├─ heartbeat()/wait() détecte échéance -> AbortReason::Timeout
  ├─ wait() détecte Ctrl-C              -> AbortReason::User
  └─ pas d'abandon                       -> continuer

Abandonné (terminal)
  └─ la première raison d'abandon l'emporte (drapeau atomique + notificateur)
```

### Annulation avant démarrage vs en cours d'exécution

- **Avant démarrage / avant la première vérification d'annulation** :
  - Les utilisateurs de `task::future` qui mettent en concurrence via `ct.wait()` peuvent résoudre l'annulation immédiatement dès qu'ils entrent dans `select!`.
  - Les utilisateurs de `task::blocking` n'observent l'annulation que lorsque le code de la fermeture atteint `heartbeat()`. Si la fermeture ne vérifie pas tôt le heartbeat, l'annulation est retardée.

- **En cours d'exécution** :
  - `blocking` : le prochain `heartbeat()` retourne `Err("Aborted: ...")`.
  - `future` : la branche `ct.wait()` gagne le `select!`, puis le code annule la machinerie asynchrone subordonnée (pour shell : annule le jeton Tokio, attend jusqu'à 2s, puis abandonne la tâche).

## Exigences de heartbeat pour les boucles longues

`heartbeat()` doit s'exécuter à une cadence prévisible dans les boucles avec des ensembles de travail importants ou non bornés.

Patterns observés :

- `glob::filter_entries` : vérifier chaque entrée avant filtrage/correspondance.
- `fd::score_entries` : vérifier chaque candidat analysé.
- `grep_sync` : vérification explicite de l'annulation avant la phase de recherche intensive, ainsi que les appels au cache fs qui reçoivent également le jeton.
- `run_pty_sync` : vérifier à chaque tick de boucle (cadence de sleep ~16ms) et tuer l'enfant lors de l'annulation.

Règle pratique : aucune boucle sur des entrées de taille externe ne doit dépasser un court intervalle borné sans heartbeat.

## Comportement en cas d'échec et propagation des erreurs vers JS

### Tâches bloquantes

Chemin d'erreur :

1. La fermeture retourne `Err(napi::Error)` (y compris l'abandon par `heartbeat()`).
2. `Task::compute()` retourne `Err`.
3. `AsyncTask` rejette la promesse JS.

Chaînes d'erreur typiques :

- `Aborted: Timeout`
- `Aborted: Signal`
- erreurs de domaine (`Failed to decode image: ...`, `Conversion error: ...`, etc.)

### Tâches futures

Chemin d'erreur :

1. Le corps asynchrone retourne `Err(napi::Error)` ou un échec de jointure est mappé (`... task failed: {err}`).
2. La promesse générée par `task::future` est rejetée.
3. Certaines API retournent intentionnellement des résultats d'annulation structurés plutôt qu'un rejet (`ShellRunResult`/`ShellExecuteResult` avec les drapeaux `cancelled`/`timed_out` et `exit_code: None`).

### Répartition du signalement des annulations

- **Annulation comme erreur** : la plupart des exports bloquants utilisant `heartbeat()?`.
- **Annulation comme résultat typé** : les API de commandes de style shell/pty qui modélisent l'annulation dans des structures de résultat.

Choisissez un modèle par API et documentez-le explicitement.

## Pièges courants

1. **Heartbeat manquant dans les boucles bloquantes**
   - Symptôme : le timeout/signal semble ignoré jusqu'à la fin de la boucle.
   - Correction : ajouter `ct.heartbeat()?` en tête de boucle et avant les étapes coûteuses par élément.

2. **Sections longues non annulables**
   - Symptôme : pics de latence d'annulation lors d'un seul appel volumineux (décodage, tri, compression, etc.).
   - Correction : diviser le travail en chunks avec des points de heartbeat ; si impossible, documenter la latence.

3. **Blocage de l'exécuteur asynchrone**
   - Symptôme : l'API asynchrone se bloque lorsqu'un code fortement synchrone s'exécute directement dans un future.
   - Correction : déplacer les blocs CPU/synchrones vers `task::blocking` ou `tokio::task::spawn_blocking`.

4. **Sémantique d'annulation incohérente**
   - Symptôme : une API rejette lors de l'annulation, une autre résout avec des drapeaux, ce qui perturbe les appelants.
   - Correction : standardiser par domaine et maintenir l'alignement de la documentation des wrappers.

5. **Oubli du pont d'annulation dans les tâches asynchrones imbriquées**
   - Symptôme : le jeton externe est annulé mais les lecteurs/tâches de sous-processus internes continuent de s'exécuter.
   - Correction : ponter l'annulation vers le jeton/signal interne et appliquer le délai de grâce + secours par abandon forcé.

## Liste de contrôle pour les nouveaux exports annulables

1. Classifier correctement le travail :
   - CPU-intensif ou bloquant synchrone -> `task::blocking`
   - E/S asynchrones / orchestration `await` -> `task::future`

2. Exposer les entrées d'annulation si nécessaire :
   - inclure `timeoutMs` et `signal` dans les options `#[napi(object)]`
   - créer `let ct = task::CancelToken::new(timeout_ms, signal);`

3. Connecter l'annulation à travers toutes les couches :
   - boucles bloquantes : `ct.heartbeat()?` à intervalles stables
   - orchestration asynchrone : mise en concurrence avec `ct.wait()` et annulation des sous-tâches/jetons

4. Définir le contrat d'annulation :
   - rejeter la promesse avec une erreur d'abandon, ou
   - résoudre avec un type `{ cancelled, timedOut, ... }`
   - maintenir ce contrat cohérent pour la famille d'API

5. Propager les échecs avec contexte :
   - mapper les erreurs via `Error::from_reason(format!("...: {err}"))`
   - inclure des préfixes spécifiques à l'étape (`spawn`, `decode`, `wait`, etc.)

6. Gérer l'annulation avant démarrage et en cours d'exécution :
   - la vérification/attente d'annulation doit avoir lieu avant le corps coûteux et pendant l'exécution longue

7. Valider l'absence de mauvaise utilisation de l'exécuteur :
   - aucun travail synchrone long directement dans des futures asynchrones sans wrapper `spawn_blocking`/tâche bloquante
