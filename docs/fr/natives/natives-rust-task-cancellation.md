---
title: Exécution de tâches Rust native et annulation
description: >-
  Modèle d'exécution de tâches asynchrones Rust avec annulation coopérative et
  sémantiques de nettoyage.
sidebar:
  order: 5
  label: Annulation de tâche
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# Exécution de tâches Rust native et annulation (`pi-natives`)

Ce document décrit la manière dont `crates/pi-natives` planifie le travail natif et la façon dont l'annulation se propage depuis les options JS (`timeoutMs`, `AbortSignal`) jusqu'à l'exécution Rust.

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
   - `compute()` s'exécute sur les threads de travail libuv (pour les appels système liés au CPU ou bloquants/synchrones).
   - Retourne une `Promise<T>` JS.

2. `task::future(env, tag, work)`
   - Encapsule `env.spawn_future(...)`.
   - Exécute le travail asynchrone sur le runtime Tokio.
   - Retourne `PromiseRaw<'env, T>`.

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` combine une échéance et un `AbortSignal` optionnel.
   - `CancelToken::heartbeat()` est l'annulation coopérative pour les boucles bloquantes.
   - `CancelToken::wait()` est l'attente d'annulation asynchrone (`Signal` / `Timeout` / `User` Ctrl-C).
   - `AbortToken` permet au code externe de demander une annulation (`abort(reason)`).

## `blocking` vs `future` : modèle d'exécution et sélection

### Utiliser `task::blocking`

À utiliser lorsque le travail est intensif en CPU ou fondamentalement synchrone/bloquant :

- analyse regex/fichiers (`grep`, `glob`, `fuzzy_find`)
- parties internes de la boucle PTY synchrone (`run_pty_sync` via `spawn_blocking`)
- conversions presse-papiers/image/html

Comportement :

- La fermeture de travail reçoit un `CancelToken` cloné.
- L'annulation n'est observée qu'aux endroits où le code vérifie `ct.heartbeat()?`.
- Une fermeture `Err(...)` rejette la promesse JS.

### Utiliser `task::future`

À utiliser lorsque le travail doit `await` des opérations asynchrones :

- orchestration de sessions shell (`shell.run`, `executeShell`)
- course de tâches (`tokio::select!`) entre la complétion et l'annulation

Comportement :

- Le future peut mettre en compétition la complétion normale contre `ct.wait()`.
- Sur le chemin d'annulation, les implémentations asynchrones propagent généralement l'annulation vers les sous-systèmes internes (ex. : `tokio_util::CancellationToken`) et forcent éventuellement l'abandon à l'expiration du délai de grâce.

## Correspondance API JS ↔ export Rust (pertinente pour les tâches/annulations)

| API côté JS | Export Rust (`#[napi]`) | Planificateur | Branchement d'annulation |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` dans la boucle de filtre |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` dans la boucle de notation |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` en compétition avec la tâche d'exécution ; pont vers le `CancellationToken` Tokio |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | identique à ci-dessus |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + `spawn_blocking` interne | `CancelToken` vérifié dans la boucle PTY synchrone via `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | aucun (jeton `()`) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | aucun (jeton `()`) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | aucun (jeton `()`) |

`text.rs` et `ps.rs` n'utilisent actuellement pas `task::blocking`/`task::future` et ne participent donc pas à ce chemin d'annulation.

## Cycle de vie de l'annulation et transitions d'état

### Cycle de vie de `CancelToken`

`CancelToken` est coopératif et à état :

```text
Créé
  ├─ pas de signal + pas de délai d'expiration  -> jeton passif (n'annule jamais sauf placement externe)
  ├─ signal enregistré                           -> attend le rappel AbortSignal
  └─ échéance définie                            -> la vérification du délai d'expiration devient active

En cours
  ├─ heartbeat()/wait() détecte le signal   -> AbortReason::Signal
  ├─ heartbeat()/wait() détecte l'échéance  -> AbortReason::Timeout
  ├─ wait() détecte Ctrl-C                  -> AbortReason::User
  └─ pas d'annulation                       -> continuer

Annulé (terminal)
  └─ la première raison d'annulation l'emporte (drapeau atomique + notificateur)
```

### Annulation avant démarrage vs en cours d'exécution

- **Avant le démarrage / avant la première vérification d'annulation** :
  - Les utilisateurs de `task::future` qui font une course sur `ct.wait()` peuvent résoudre l'annulation immédiatement dès qu'ils entrent dans `select!`.
  - Les utilisateurs de `task::blocking` n'observent l'annulation que lorsque le code de la fermeture atteint `heartbeat()`. Si la fermeture n'effectue pas de heartbeat tôt, l'annulation est retardée.

- **En cours d'exécution** :
  - `blocking` : le prochain `heartbeat()` retourne `Err("Aborted: ...")`.
  - `future` : la branche `ct.wait()` remporte le `select!`, puis le code annule la machinerie asynchrone subordonnée (pour shell : annule le jeton Tokio, attend jusqu'à 2s, puis abandonne la tâche).

## Exigences de heartbeat pour les boucles longues

`heartbeat()` doit s'exécuter à une cadence prévisible dans les boucles avec des ensembles de travail illimités ou importants.

Patterns observés :

- `glob::filter_entries` : vérification de chaque entrée avant filtrage/correspondance.
- `fd::score_entries` : vérification de chaque candidat analysé.
- `grep_sync` : vérification d'annulation explicite avant la phase de recherche intensive, ainsi que les appels au cache fs qui reçoivent également le jeton.
- `run_pty_sync` : vérification à chaque tick de boucle (cadence de sommeil ~16ms) et destruction du processus enfant en cas d'annulation.

Règle pratique : aucune boucle sur une entrée de taille externe ne doit dépasser un court intervalle délimité sans heartbeat.

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

1. Le corps asynchrone retourne `Err(napi::Error)` ou l'échec de jointure est mappé (`... task failed: {err}`).
2. La promesse générée par `task::future` est rejetée.
3. Certaines API retournent intentionnellement des résultats d'annulation structurés au lieu d'un rejet (`ShellRunResult`/`ShellExecuteResult` avec les drapeaux `cancelled`/`timed_out` et `exit_code: None`).

### Séparation du rapport d'annulation

- **Annulation comme erreur** : la plupart des exports bloquants utilisant `heartbeat()?`.
- **Annulation comme résultat typé** : API de commandes de style shell/pty qui modélisent l'annulation dans des structures de résultat.

Choisir un seul modèle par API et le documenter explicitement.

## Pièges courants

1. **Heartbeat manquant dans les boucles bloquantes**
   - Symptôme : le délai d'expiration/signal semble ignoré jusqu'à la fin de la boucle.
   - Correction : ajouter `ct.heartbeat()?` en tête de boucle et avant les étapes coûteuses par élément.

2. **Longues sections non annulables**
   - Symptôme : pics de latence d'annulation lors d'un seul appel volumineux (décodage, tri, compression, etc.).
   - Correction : diviser le travail en blocs avec des points de heartbeat ; si impossible, documenter la latence.

3. **Blocage de l'exécuteur asynchrone**
   - Symptôme : l'API asynchrone se bloque lorsque du code intensif en synchrone s'exécute directement dans un future.
   - Correction : déplacer les blocs CPU/synchrones vers `task::blocking` ou `tokio::task::spawn_blocking`.

4. **Sémantiques d'annulation incohérentes**
   - Symptôme : une API rejette en cas d'annulation, une autre résout avec des drapeaux, ce qui perturbe les appelants.
   - Correction : standardiser par domaine et maintenir l'alignement de la documentation des wrappers.

5. **Oubli du pont d'annulation dans les tâches asynchrones imbriquées**
   - Symptôme : le jeton externe est annulé mais les lecteurs/tâches de sous-processus internes continuent de fonctionner.
   - Correction : relier l'annulation au jeton/signal interne et appliquer un délai de grâce avec repli sur abandon forcé.

## Liste de contrôle pour les nouveaux exports annulables

1. Classifier correctement le travail :
   - Lié au CPU ou blocage synchrone -> `task::blocking`
   - I/O asynchrone / orchestration `await` -> `task::future`

2. Exposer les entrées d'annulation si nécessaire :
   - inclure `timeoutMs` et `signal` dans les options `#[napi(object)]`
   - créer `let ct = task::CancelToken::new(timeout_ms, signal);`

3. Relier l'annulation à travers toutes les couches :
   - boucles bloquantes : `ct.heartbeat()?` à intervalles stables
   - orchestration asynchrone : course avec `ct.wait()` et annulation des sous-tâches/jetons

4. Définir le contrat d'annulation :
   - rejeter la promesse avec une erreur d'annulation, ou
   - résoudre un type structuré `{ cancelled, timedOut, ... }`
   - maintenir ce contrat cohérent pour la famille d'API

5. Propager les échecs avec contexte :
   - mapper les erreurs via `Error::from_reason(format!("...: {err}"))`
   - inclure des préfixes spécifiques à l'étape (`spawn`, `decode`, `wait`, etc.)

6. Gérer l'annulation avant démarrage et en cours d'exécution :
   - la vérification/attente d'annulation doit avoir lieu avant le corps coûteux et durant une longue exécution

7. Valider l'absence d'utilisation incorrecte de l'exécuteur :
   - pas de long travail synchrone directement dans des futures asynchrones sans `spawn_blocking`/wrapper de tâche bloquante
