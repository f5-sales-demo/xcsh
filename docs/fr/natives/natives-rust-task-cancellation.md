---
title: Exécution et annulation native des tâches Rust
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

# Exécution et annulation native des tâches Rust (`pi-natives`)

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
   - `compute()` s'exécute sur les threads worker libuv (pour les appels système bloquants/synchrones ou gourmands en CPU).
   - Retourne une `Promise<T>` JS.

2. `task::future(env, tag, work)`
   - Encapsule `env.spawn_future(...)`.
   - Exécute le travail asynchrone sur le runtime Tokio.
   - Retourne `PromiseRaw<'env, T>`.

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` combine une échéance + un `AbortSignal` optionnel.
   - `CancelToken::heartbeat()` assure l'annulation coopérative pour les boucles bloquantes.
   - `CancelToken::wait()` permet l'attente asynchrone d'annulation (`Signal` / `Timeout` / `User` Ctrl-C).
   - `AbortToken` permet au code externe de demander l'abandon (`abort(reason)`).

## `blocking` vs `future` : modèle d'exécution et sélection

### Utiliser `task::blocking`

À utiliser lorsque le travail est gourmand en CPU ou fondamentalement synchrone/bloquant :

- analyse regex/fichiers (`grep`, `glob`, `fuzzy_find`)
- mécanismes internes de boucle PTY synchrone (`run_pty_sync` via `spawn_blocking`)
- conversions presse-papiers/image/html

Comportement :

- La fermeture de travail reçoit un `CancelToken` cloné.
- L'annulation n'est observée que là où le code vérifie `ct.heartbeat()?`.
- Si la fermeture retourne `Err(...)`, la promesse JS est rejetée.

### Utiliser `task::future`

À utiliser lorsque le travail doit utiliser `await` sur des opérations asynchrones :

- orchestration de session shell (`shell.run`, `executeShell`)
- course de tâches (`tokio::select!`) entre complétion et annulation

Comportement :

- Le future peut mettre en concurrence la complétion normale avec `ct.wait()`.
- Sur le chemin d'annulation, les implémentations asynchrones propagent typiquement l'annulation aux sous-systèmes internes (par ex., `tokio_util::CancellationToken`) et forcent optionnellement l'abandon après un délai de grâce.

## Correspondance API JS ↔ export Rust (pertinent pour tâche/annulation)

| API côté JS | Export Rust (`#[napi]`) | Planificateur | Branchement de l'annulation |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` dans la boucle de filtrage |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` dans la boucle de scoring |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` mis en concurrence avec la tâche d'exécution ; pont vers le `CancellationToken` Tokio |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | identique à ci-dessus |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + `spawn_blocking` interne | `CancelToken` vérifié dans la boucle PTY synchrone via `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | aucun (token `()`) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | aucun (token `()`) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | aucun (token `()`) |

`text.rs` et `ps.rs` n'utilisent actuellement pas `task::blocking`/`task::future` et ne participent donc pas à ce chemin d'annulation.

## Cycle de vie de l'annulation et transitions d'état

### Cycle de vie du `CancelToken`

Le `CancelToken` est coopératif et avec état :

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

### Annulation avant démarrage vs en cours d'exécution

- **Avant le démarrage / avant la première vérification d'annulation** :
  - Les utilisateurs de `task::future` qui concourent sur `ct.wait()` peuvent résoudre l'annulation immédiatement dès qu'ils entrent dans `select!`.
  - Les utilisateurs de `task::blocking` n'observent l'annulation que lorsque le code de la fermeture atteint `heartbeat()`. Si la fermeture n'appelle pas heartbeat tôt, l'annulation est retardée.

- **En cours d'exécution** :
  - `blocking` : le prochain `heartbeat()` retourne `Err("Aborted: ...")`.
  - `future` : la branche `ct.wait()` remporte le `select!`, puis le code annule la machinerie asynchrone subordonnée (pour le shell : annule le token Tokio, attend jusqu'à 2s, puis abandonne la tâche de force).

## Attentes de heartbeat pour les boucles de longue durée

`heartbeat()` doit s'exécuter à une cadence prévisible dans les boucles avec des ensembles de travail non bornés ou volumineux.

Schémas observés :

- `glob::filter_entries` : vérification de chaque entrée avant le filtrage/la correspondance.
- `fd::score_entries` : vérification de chaque candidat analysé.
- `grep_sync` : vérification explicite de l'annulation avant la phase de recherche intensive, plus les appels au cache FS qui reçoivent également le token.
- `run_pty_sync` : vérification à chaque tick de boucle (cadence de sleep ~16ms) et arrêt du processus enfant en cas d'annulation.

Règle pratique : aucune boucle sur une entrée de taille externe ne devrait dépasser un court intervalle borné sans un heartbeat.

## Comportement en cas d'échec et propagation des erreurs vers JS

### Tâches bloquantes

Chemin d'erreur :

1. La fermeture retourne `Err(napi::Error)` (y compris l'abandon via `heartbeat()`).
2. `Task::compute()` retourne `Err`.
3. `AsyncTask` rejette la promesse JS.

Chaînes d'erreur typiques :

- `Aborted: Timeout`
- `Aborted: Signal`
- erreurs de domaine (`Failed to decode image: ...`, `Conversion error: ...`, etc.)

### Tâches futures

Chemin d'erreur :

1. Le corps asynchrone retourne `Err(napi::Error)` ou l'échec de join est converti (`... task failed: {err}`).
2. La promesse créée par `task::future` est rejetée.
3. Certaines API retournent intentionnellement des résultats d'annulation structurés au lieu d'un rejet (`ShellRunResult`/`ShellExecuteResult` avec des indicateurs `cancelled`/`timed_out` et `exit_code: None`).

### Séparation du signalement de l'annulation

- **Abandon comme erreur** : la plupart des exports bloquants utilisant `heartbeat()?`.
- **Abandon comme résultat typé** : les API de style commande shell/pty qui modélisent l'annulation dans des structures de résultat.

Choisissez un modèle par API et documentez-le explicitement.

## Pièges courants

1. **Heartbeat manquant dans les boucles bloquantes**
   - Symptôme : le timeout/signal semble ignoré jusqu'à la fin de la boucle.
   - Correction : ajouter `ct.heartbeat()?` en haut de boucle et avant les étapes coûteuses par élément.

2. **Sections longues non annulables**
   - Symptôme : pics de latence d'annulation pendant un seul appel volumineux (décodage, tri, compression, etc.).
   - Correction : découper le travail en morceaux avec des frontières de heartbeat ; si impossible, documenter la latence.

3. **Blocage de l'exécuteur asynchrone**
   - Symptôme : l'API asynchrone se bloque lorsque du code fortement synchrone s'exécute directement dans le future.
   - Correction : déplacer les blocs CPU/synchrones vers `task::blocking` ou `tokio::task::spawn_blocking`.

4. **Sémantique d'annulation incohérente**
   - Symptôme : une API rejette en cas d'annulation, une autre résout avec des indicateurs, ce qui prête à confusion pour les appelants.
   - Correction : standardiser par domaine et maintenir la documentation des wrappers alignée.

5. **Oubli du pont d'annulation dans les tâches asynchrones imbriquées**
   - Symptôme : le token externe est annulé mais les lecteurs internes/tâches de sous-processus continuent de s'exécuter.
   - Correction : propager l'annulation vers le token/signal interne et imposer un délai de grâce + abandon forcé en dernier recours.

## Liste de vérification pour les nouveaux exports annulables

1. Classifier correctement le travail :
   - Gourmand en CPU ou bloquant synchrone -> `task::blocking`
   - I/O asynchrone / orchestration `await` -> `task::future`

2. Exposer les entrées d'annulation si nécessaire :
   - inclure `timeoutMs` et `signal` dans les options `#[napi(object)]`
   - créer `let ct = task::CancelToken::new(timeout_ms, signal);`

3. Propager l'annulation à travers toutes les couches :
   - boucles bloquantes : `ct.heartbeat()?` à intervalles stables
   - orchestration asynchrone : mise en concurrence avec `ct.wait()` et annulation des sous-tâches/tokens

4. Décider du contrat d'annulation :
   - rejeter la promesse avec une erreur d'abandon, ou
   - résoudre avec un type `{ cancelled, timedOut, ... }`
   - maintenir ce contrat cohérent pour la famille d'API

5. Propager les échecs avec du contexte :
   - mapper les erreurs via `Error::from_reason(format!("...: {err}"))`
   - inclure des préfixes spécifiques à l'étape (`spawn`, `decode`, `wait`, etc.)

6. Gérer l'annulation avant démarrage et en cours d'exécution :
   - la vérification/attente d'annulation doit avoir lieu avant le corps coûteux et pendant l'exécution prolongée

7. Valider l'absence de mauvais usage de l'exécuteur :
   - pas de travail synchrone prolongé directement dans les futures asynchrones sans wrapper `spawn_blocking`/tâche bloquante
