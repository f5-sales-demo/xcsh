---
title: Native Rust Task Execution and Cancellation
description: >-
  Rust async task execution model with cooperative cancellation and cleanup
  semantics.
sidebar:
  order: 5
  label: Task cancellation
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# Exécution et annulation des tâches Rust natives (`pi-natives`)

Ce document décrit comment `crates/pi-natives` planifie le travail natif et comment l'annulation se propage depuis les options JS (`timeoutMs`, `AbortSignal`) jusqu'à l'exécution Rust.

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
   - `compute()` s'exécute sur les threads worker de libuv (pour les appels système bloquants/synchrones ou intensifs en CPU).
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

- analyse regex/fichier (`grep`, `glob`, `fuzzy_find`)
- boucle PTY synchrone interne (`run_pty_sync` via `spawn_blocking`)
- conversions clipboard/image/html

Comportement :

- La closure de travail reçoit un `CancelToken` cloné.
- L'annulation n'est observée que là où le code vérifie `ct.heartbeat()?`.
- Une closure `Err(...)` rejette la promesse JS.

### Utiliser `task::future`

À utiliser lorsque le travail doit `await` des opérations asynchrones :

- orchestration de session shell (`shell.run`, `executeShell`)
- course de tâches (`tokio::select!`) entre la complétion et l'annulation

Comportement :

- Le future peut mettre en concurrence la complétion normale avec `ct.wait()`.
- Sur le chemin d'annulation, les implémentations asynchrones propagent typiquement l'annulation aux sous-systèmes internes (par ex., `tokio_util::CancellationToken`) et forcent optionnellement l'abandon après un délai de grâce.

## Correspondance API JS ↔ export Rust (pertinente pour task/cancel)

| API côté JS | Export Rust (`#[napi]`) | Planificateur | Branchement de l'annulation |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` dans la boucle de filtrage |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` dans la boucle de scoring |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` mis en concurrence avec la tâche d'exécution ; pont vers le `CancellationToken` Tokio |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | identique au précédent |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + `spawn_blocking` interne | `CancelToken` vérifié dans la boucle PTY synchrone via `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | aucun (token `()`) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | aucun (token `()`) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | aucun (token `()`) |

`text.rs` et `ps.rs` n'utilisent actuellement pas `task::blocking`/`task::future` et ne participent donc pas à ce chemin d'annulation.

## Cycle de vie de l'annulation et transitions d'état

### Cycle de vie du `CancelToken`

`CancelToken` est coopératif et avec état :

```text
Created
  ├─ no signal + no timeout  -> passive token (never aborts unless externally emplaced)
  ├─ signal registered        -> waits for AbortSignal callback
  └─ deadline set             -> timeout check becomes active

Running
  ├─ heartbeat()/wait() sees signal   -> AbortReason::Signal
  ├─ heartbeat()/wait() sees deadline -> AbortReason::Timeout
  ├─ wait() sees Ctrl-C               -> AbortReason::User
  └─ no abort                         -> continue

Aborted (terminal)
  └─ first abort reason wins (atomic flag + notifier)
```

### Annulation avant le démarrage vs en cours d'exécution

- **Avant le démarrage / avant la première vérification d'annulation** :
  - Les utilisateurs de `task::future` qui font une course avec `ct.wait()` peuvent résoudre l'annulation immédiatement dès qu'ils entrent dans `select!`.
  - Les utilisateurs de `task::blocking` n'observent l'annulation que lorsque le code de la closure atteint `heartbeat()`. Si la closure n'appelle pas heartbeat rapidement, l'annulation est retardée.

- **En cours d'exécution** :
  - `blocking` : le prochain `heartbeat()` retourne `Err("Aborted: ...")`.
  - `future` : la branche `ct.wait()` gagne le `select!`, puis le code annule la machinerie asynchrone subordonnée (pour shell : annule le token Tokio, attend jusqu'à 2s, puis abandonne la tâche).

## Attentes de heartbeat pour les boucles longues

`heartbeat()` doit s'exécuter à une cadence prévisible dans les boucles avec des ensembles de travail non bornés ou volumineux.

Patterns observés :

- `glob::filter_entries` : vérification de chaque entrée avant le filtrage/matching.
- `fd::score_entries` : vérification de chaque candidat analysé.
- `grep_sync` : vérification d'annulation explicite avant la phase de recherche intensive, plus les appels au cache du système de fichiers qui reçoivent également le token.
- `run_pty_sync` : vérification à chaque tick de boucle (~16ms de cadence de sleep) et arrêt du processus enfant en cas d'annulation.

Règle pratique : aucune boucle sur des données de taille externe ne devrait dépasser un court intervalle borné sans un heartbeat.

## Comportement en cas d'erreur et propagation des erreurs vers JS

### Tâches bloquantes

Chemin d'erreur :

1. La closure retourne `Err(napi::Error)` (incluant l'abandon via `heartbeat()`).
2. `Task::compute()` retourne `Err`.
3. `AsyncTask` rejette la promesse JS.

Chaînes d'erreur typiques :

- `Aborted: Timeout`
- `Aborted: Signal`
- Erreurs de domaine (`Failed to decode image: ...`, `Conversion error: ...`, etc.)

### Tâches future

Chemin d'erreur :

1. Le corps asynchrone retourne `Err(napi::Error)` ou l'échec du join est transformé (`... task failed: {err}`).
2. La promesse créée par `task::future` est rejetée.
3. Certaines API retournent intentionnellement des résultats d'annulation structurés au lieu d'un rejet (`ShellRunResult`/`ShellExecuteResult` avec les flags `cancelled`/`timed_out` et `exit_code: None`).

### Distinction dans le signalement de l'annulation

- **Abandon comme erreur** : la plupart des exports bloquants utilisant `heartbeat()?`.
- **Abandon comme résultat typé** : les API de style shell/pty qui modélisent l'annulation dans des structures de résultat.

Choisissez un modèle par API et documentez-le explicitement.

## Pièges courants

1. **Heartbeat manquant dans les boucles bloquantes**
   - Symptôme : le timeout/signal semble ignoré jusqu'à la fin de la boucle.
   - Correction : ajoutez `ct.heartbeat()?` en haut de la boucle et avant les étapes coûteuses par élément.

2. **Sections longues non annulables**
   - Symptôme : pics de latence d'annulation pendant un seul appel volumineux (décodage, tri, compression, etc.).
   - Correction : divisez le travail en blocs avec des frontières de heartbeat ; si impossible, documentez la latence.

3. **Blocage de l'exécuteur asynchrone**
   - Symptôme : l'API asynchrone se bloque lorsqu'un code intensif en synchrone s'exécute directement dans un future.
   - Correction : déplacez les blocs CPU/synchrones vers `task::blocking` ou `tokio::task::spawn_blocking`.

4. **Sémantiques d'annulation incohérentes**
   - Symptôme : une API rejette en cas d'annulation, une autre résout avec des flags, ce qui déroute les appelants.
   - Correction : standardisez par domaine et gardez la documentation des wrappers alignée.

5. **Oubli du pont d'annulation dans les tâches asynchrones imbriquées**
   - Symptôme : le token externe est annulé mais les lecteurs/tâches de sous-processus internes continuent de s'exécuter.
   - Correction : propagez l'annulation au token/signal interne et imposez un délai de grâce + abandon forcé en dernier recours.

## Liste de vérification pour les nouveaux exports annulables

1. Classifiez correctement le travail :
   - Intensif en CPU ou bloquant synchrone -> `task::blocking`
   - I/O asynchrone / orchestration `await` -> `task::future`

2. Exposez les entrées d'annulation lorsque nécessaire :
   - incluez `timeoutMs` et `signal` dans les options `#[napi(object)]`
   - créez `let ct = task::CancelToken::new(timeout_ms, signal);`

3. Propagez l'annulation à travers toutes les couches :
   - boucles bloquantes : `ct.heartbeat()?` à intervalles stables
   - orchestration asynchrone : course avec `ct.wait()` et annulation des sous-tâches/tokens

4. Décidez du contrat d'annulation :
   - rejeter la promesse avec une erreur d'abandon, ou
   - résoudre avec un résultat typé `{ cancelled, timedOut, ... }`
   - gardez ce contrat cohérent pour la famille d'API

5. Propagez les échecs avec du contexte :
   - transformez les erreurs via `Error::from_reason(format!("...: {err}"))`
   - incluez des préfixes spécifiques à l'étape (`spawn`, `decode`, `wait`, etc.)

6. Gérez l'annulation avant le démarrage et en cours d'exécution :
   - la vérification/attente d'annulation doit se produire avant le corps coûteux et pendant l'exécution longue

7. Vérifiez qu'il n'y a pas de mauvaise utilisation de l'exécuteur :
   - pas de long travail synchrone directement dans des futures asynchrones sans `spawn_blocking`/wrapper de tâche bloquante
