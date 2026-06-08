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
   - `compute()` s'exécute sur les threads workers libuv (pour les appels système CPU-intensifs ou bloquants/synchrones).
   - Retourne une `Promise<T>` JS.

2. `task::future(env, tag, work)`
   - Encapsule `env.spawn_future(...)`.
   - Exécute le travail asynchrone sur le runtime Tokio.
   - Retourne `PromiseRaw<'env, T>`.

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` combine une échéance + un `AbortSignal` optionnel.
   - `CancelToken::heartbeat()` est l'annulation coopérative pour les boucles bloquantes.
   - `CancelToken::wait()` est l'attente d'annulation asynchrone (`Signal` / `Timeout` / `User` Ctrl-C).
   - `AbortToken` permet au code externe de demander une interruption (`abort(reason)`).

## `blocking` vs `future` : modèle d'exécution et sélection

### Utiliser `task::blocking`

À utiliser lorsque le travail est CPU-intensif ou fondamentalement synchrone/bloquant :

- analyse regex/fichiers (`grep`, `glob`, `fuzzy_find`)
- boucle PTY synchrone interne (`run_pty_sync` via `spawn_blocking`)
- conversions clipboard/image/html

Comportement :

- La closure de travail reçoit un `CancelToken` cloné.
- L'annulation n'est observée que là où le code vérifie `ct.heartbeat()?`.
- Une `Err(...)` de la closure rejette la promesse JS.

### Utiliser `task::future`

À utiliser lorsque le travail doit `await` des opérations asynchrones :

- orchestration de sessions shell (`shell.run`, `executeShell`)
- course de tâches (`tokio::select!`) entre l'achèvement et l'annulation

Comportement :

- Le future peut faire la course entre l'achèvement normal et `ct.wait()`.
- Sur le chemin d'annulation, les implémentations asynchrones propagent typiquement l'annulation aux sous-systèmes internes (par ex., `tokio_util::CancellationToken`) et forcent optionnellement l'interruption après un délai de grâce.

## Correspondance API JS ↔ export Rust (pertinent pour task/cancel)

| API côté JS | Export Rust (`#[napi]`) | Planificateur | Branchement de l'annulation |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` dans la boucle de filtrage |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` dans la boucle de scoring |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` en course contre la tâche d'exécution ; pont vers le `CancellationToken` Tokio |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | identique à ci-dessus |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + `spawn_blocking` interne | `CancelToken` vérifié dans la boucle PTY synchrone via `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | aucun (token `()`) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | aucun (token `()`) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | aucun (token `()`) |

`text.rs` et `ps.rs` n'utilisent actuellement pas `task::blocking`/`task::future` et ne participent donc pas à ce chemin d'annulation.

## Cycle de vie de l'annulation et transitions d'état

### Cycle de vie du `CancelToken`

`CancelToken` est coopératif et à état :

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
  - Les utilisateurs de `task::future` qui font la course sur `ct.wait()` peuvent résoudre l'annulation immédiatement dès qu'ils entrent dans `select!`.
  - Les utilisateurs de `task::blocking` n'observent l'annulation que lorsque le code de la closure atteint `heartbeat()`. Si la closure ne fait pas de heartbeat tôt, l'annulation est retardée.

- **En cours d'exécution** :
  - `blocking` : le prochain `heartbeat()` retourne `Err("Aborted: ...")`.
  - `future` : la branche `ct.wait()` gagne le `select!`, puis le code annule la machinerie asynchrone subordonnée (pour shell : annule le token Tokio, attend jusqu'à 2 secondes, puis interrompt la tâche de force).

## Attentes en matière de heartbeat pour les boucles longues

`heartbeat()` doit s'exécuter à une cadence prévisible dans les boucles avec des ensembles de travail non bornés ou volumineux.

Patterns observés :

- `glob::filter_entries` : vérification de chaque entrée avant le filtrage/matching.
- `fd::score_entries` : vérification de chaque candidat analysé.
- `grep_sync` : vérification explicite de l'annulation avant la phase de recherche intensive, plus les appels au cache fs qui reçoivent également le token.
- `run_pty_sync` : vérification à chaque tick de boucle (cadence de ~16ms de sleep) et arrêt du processus enfant en cas d'annulation.

Règle pratique : aucune boucle sur des entrées de taille externe ne devrait dépasser un court intervalle borné sans un heartbeat.

## Comportement en cas d'échec et propagation des erreurs vers JS

### Tâches bloquantes

Chemin d'erreur :

1. La closure retourne `Err(napi::Error)` (y compris l'interruption de `heartbeat()`).
2. `Task::compute()` retourne `Err`.
3. `AsyncTask` rejette la promesse JS.

Chaînes d'erreur typiques :

- `Aborted: Timeout`
- `Aborted: Signal`
- erreurs de domaine (`Failed to decode image: ...`, `Conversion error: ...`, etc.)

### Tâches futures

Chemin d'erreur :

1. Le corps asynchrone retourne `Err(napi::Error)` ou l'échec de join est transformé (`... task failed: {err}`).
2. La promesse générée par `task::future` est rejetée.
3. Certaines APIs retournent intentionnellement des résultats d'annulation structurés au lieu d'un rejet (`ShellRunResult`/`ShellExecuteResult` avec les drapeaux `cancelled`/`timed_out` et `exit_code: None`).

### Séparation du signalement d'annulation

- **Interruption comme erreur** : la plupart des exports bloquants utilisant `heartbeat()?`.
- **Interruption comme résultat typé** : APIs de style shell/pty qui modélisent l'annulation dans des structures de résultat.

Choisissez un modèle par API et documentez-le explicitement.

## Pièges courants

1. **Heartbeat manquant dans les boucles bloquantes**
   - Symptôme : le timeout/signal semble ignoré jusqu'à la fin de la boucle.
   - Correction : ajouter `ct.heartbeat()?` en haut de la boucle et avant les étapes coûteuses par élément.

2. **Sections longues non annulables**
   - Symptôme : pics de latence d'annulation pendant un seul appel volumineux (décodage, tri, compression, etc.).
   - Correction : découper le travail en morceaux avec des points de heartbeat ; si impossible, documenter la latence.

3. **Blocage de l'exécuteur asynchrone**
   - Symptôme : l'API asynchrone se bloque lorsque du code synchrone intensif s'exécute directement dans un future.
   - Correction : déplacer les blocs CPU/synchrones vers `task::blocking` ou `tokio::task::spawn_blocking`.

4. **Sémantiques d'annulation incohérentes**
   - Symptôme : une API rejette en cas d'annulation, une autre résout avec des drapeaux, ce qui prête à confusion pour les appelants.
   - Correction : standardiser par domaine et garder la documentation des wrappers alignée.

5. **Oubli du pont d'annulation dans les tâches asynchrones imbriquées**
   - Symptôme : le token externe est annulé mais les tâches internes de lecture/sous-processus continuent de s'exécuter.
   - Correction : propager l'annulation au token/signal interne et imposer un délai de grâce + interruption forcée en dernier recours.

## Liste de vérification pour les nouveaux exports annulables

1. Classifier correctement le travail :
   - CPU-intensif ou bloquant synchrone -> `task::blocking`
   - I/O asynchrone / orchestration `await` -> `task::future`

2. Exposer les entrées d'annulation si nécessaire :
   - inclure `timeoutMs` et `signal` dans les options `#[napi(object)]`
   - créer `let ct = task::CancelToken::new(timeout_ms, signal);`

3. Propager l'annulation à travers toutes les couches :
   - boucles bloquantes : `ct.heartbeat()?` à intervalles stables
   - orchestration asynchrone : course avec `ct.wait()` et annulation des sous-tâches/tokens

4. Décider du contrat d'annulation :
   - rejeter la promesse avec une erreur d'interruption, ou
   - résoudre avec un type `{ cancelled, timedOut, ... }`
   - garder ce contrat cohérent pour la famille d'API

5. Propager les échecs avec du contexte :
   - transformer les erreurs via `Error::from_reason(format!("...: {err}"))`
   - inclure des préfixes spécifiques à l'étape (`spawn`, `decode`, `wait`, etc.)

6. Gérer l'annulation avant le démarrage et en cours d'exécution :
   - la vérification/attente d'annulation doit avoir lieu avant le corps coûteux et pendant l'exécution longue

7. Valider l'absence de mauvaise utilisation de l'exécuteur :
   - pas de travail synchrone long directement dans les futures asynchrones sans `spawn_blocking`/wrapper de tâche bloquante
