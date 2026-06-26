---
title: 'Natifs Shell, PTY, Processus et Gestion des touches internes'
description: >-
  Exécution Shell, gestion PTY, cycle de vie des processus et gestion des
  événements clavier dans la couche native.
sidebar:
  order: 4
  label: 'Shell, PTY & processus'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# Natifs Shell, PTY, Processus et Gestion des touches internes

Ce document couvre les **primitives d'exécution/processus/terminal** dans `@f5-sales-demo/pi-natives` : `shell`, `pty`, `ps`, et `keys`, en utilisant les termes architecturaux de `docs/natives-architecture.md`.

## Fichiers d'implémentation

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs` (Windows uniquement)
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs` (comportement d'annulation partagé utilisé par shell/pty)
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/bindings.ts`

## Responsabilité des couches

- **Couche wrapper/API TS** (`packages/natives/src/*`) : points d'entrée typés, surface d'annulation (`timeoutMs`, `AbortSignal`), et ergonomie JS.
- **Couche module Rust N-API** (`crates/pi-natives/src/*`) : exécution des processus shell/PTY, traversée/terminaison de l'arborescence de processus, et analyse des séquences de touches.
- **Porte de validation** (`native.ts`, niveau architectural) : garantit que les exports requis (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, helpers de touches) existent avant l'utilisation des wrappers.

## Sous-système Shell (`shell`)

### Modèle d'API

Deux modes d'exécution sont exposés :

1. **One-shot** via `executeShell(options, onChunk?)`.
2. **Session persistante** via `new Shell(options?)` puis `shell.run(...)` de manière répétée.

Les deux diffusent la sortie via un callback threadsafe et retournent `{ exitCode?, cancelled, timedOut }`.

### Création de session et modèle d'environnement

Rust crée `brush_core::Shell` avec :

- mode non-interactif,
- `do_not_inherit_env: true`,
- reconstruction explicite de l'environnement à partir de l'env hôte,
- liste d'exclusion pour les variables sensibles au shell (`PS1`, `PWD`, `SHLVL`, exports de fonctions bash, etc.).

Comportement de l'env de session :

- `ShellOptions.sessionEnv` est appliqué une fois à la création de la session.
- `ShellRunOptions.env` est limité à la commande (`EnvironmentScope::Command`) et retiré après chaque exécution.
- `PATH` est fusionné de manière spéciale sous Windows avec une déduplication insensible à la casse.

Enrichissement de chemin spécifique à Windows (`shell/windows.rs`) : les chemins Git-for-Windows découverts (`cmd`, `bin`, `usr/bin`) sont ajoutés s'ils sont présents et non déjà inclus.

### Cycle de vie d'exécution et transitions d'état

Le shell persistant (`Shell.run`) utilise cette machine à états :

- **Inactif/Non initialisé** : `session: None`.
- **En cours d'exécution** : le premier `run()` crée la session paresseusement, stocke le token `current_abort`, et exécute la commande.
- **Terminé + maintien actif** : si le flux de contrôle d'exécution est `Normal`, `current_abort` est effacé et la session est réutilisée.
- **Terminé + arrêt** : si le flux de contrôle est lié à une boucle/script/sortie du shell (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), la session est abandonnée (`session: None`).
- **Annulé/Expiré** : la tâche d'exécution est annulée, attente gracieuse (2s), puis abandon forcé ; la session est abandonnée.
- **Erreur** : la session est abandonnée.

Le shell one-shot (`executeShell`) crée et abandonne toujours une nouvelle session à chaque appel.

### Comportement de streaming/sortie

- Stdout/stderr sont acheminés dans un pipe partagé et lus de manière concurrente.
- Le lecteur décode l'UTF-8 de manière incrémentielle ; les séquences d'octets invalides émettent des chunks de remplacement `U+FFFD`.
- Après la complétion du processus, le drain de sortie dispose de gardes d'inactivité/maximum (`250ms` d'inactivité, `2s` maximum) pour éviter les blocages dus aux tâches de fond maintenant les descripteurs ouverts.

### Annulation, expiration et tâches de fond

- `CancelToken` est construit à partir de `timeoutMs` et d'un `AbortSignal` optionnel.
- En cas d'annulation/expiration, le token d'annulation du shell est déclenché, puis la tâche dispose d'une fenêtre gracieuse de 2s avant l'abandon forcé.
- Si l'annulation se produit, les tâches de fond sont terminées (`TERM`, puis `KILL` différé) en utilisant les métadonnées de job de brush.

Comportement de `Shell.abort()` :

- annule uniquement la commande en cours d'exécution pour cette instance `Shell`,
- opération nulle en cas de succès lorsque rien n'est en cours d'exécution.

### Comportement en cas d'échec

Les erreurs courantes incluent :

- échecs d'initialisation de session (`Failed to initialize shell`),
- erreurs de répertoire courant (`Failed to set cwd`),
- échecs de définition/retrait d'env,
- échecs de source de snapshot,
- échecs de création/clonage de pipe,
- échec d'exécution (`Shell execution failed: ...`),
- échecs du wrapper de tâche (`Shell execution task failed: ...`).

Indicateurs d'annulation au niveau du résultat :

- expiration -> `exitCode: undefined`, `timedOut: true`.
- signal d'abandon -> `exitCode: undefined`, `cancelled: true`.

## Sous-système PTY (`pty`)

### Modèle d'API

`new PtySession()` expose :

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### Cycle de vie d'exécution et transitions d'état

Machine à états de `PtySession` :

- **Inactif** : `core: None`.
- **Réservé** : `start()` installe le canal de contrôle de manière synchrone (`core: Some`) avant que le travail asynchrone ne commence, de sorte que `write/resize/kill` deviennent immédiatement valides.
- **En cours d'exécution** : la boucle PTY bloquante gère l'état du processus enfant, les événements du lecteur, le battement de cœur d'annulation, et les messages de contrôle.
- **Terminal fermé** : sortie du processus enfant + complétion du lecteur.
- **Finalisé** : `core` est toujours réinitialisé à `None` après la complétion de la tâche de démarrage (succès ou erreur).

Garde de concurrence :

- démarrer alors qu'une session est déjà en cours retourne `PTY session already running`.

### Patterns de spawn/attach/write/read/terminate

- PTY ouvert via `portable_pty::native_pty_system().openpty(...)`.
- La commande s'exécute actuellement comme `sh -lc <command>` avec `cwd` et des substitutions d'env optionnels.
- `write()` envoie des octets bruts vers stdin du PTY.
- `resize()` limite les dimensions (`cols 20..400`, `rows 5..200`) et appelle le redimensionnement du maître.
- `kill()` marque l'exécution comme annulée et tue le processus enfant.

Chemin de sortie :

- un thread lecteur dédié lit le flux maître,
- décodage UTF-8 incrémentiel avec remplacement `U+FFFD` sur les octets invalides,
- chunks transmis via le callback threadsafe N-API.

### Sémantique d'annulation et d'expiration

- `timeoutMs` et `AbortSignal` alimentent un `CancelToken`.
- la boucle appelle `ct.heartbeat()` périodiquement ; l'abandon déclenche le kill du processus enfant.
- la classification de l'expiration est basée sur une chaîne (sous-chaîne `"Timeout"` dans l'erreur de battement de cœur).

### Comportement en cas d'échec

Les surfaces d'erreur comprennent :

- échec d'allocation/ouverture PTY,
- échec de spawn PTY,
- échec d'acquisition du writer/reader,
- échecs de statut/attente du processus enfant,
- empoisonnement de verrou,
- déconnexion du canal de contrôle (`PTY session is no longer available`).

Échecs d'appels de contrôle lorsqu'inactif :

- `write/resize/kill` retournent `PTY session is not running`.

## Sous-système d'arborescence de processus (`ps`)

### Modèle d'API

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

Le wrapper TS enregistre également l'intégration native de kill-tree dans les utils partagés via `setNativeKillTree(native.killTree)`.

### Implémentation spécifique à la plateforme

- **Linux** : lit récursivement `/proc/<pid>/task/<pid>/children`.
- **macOS** : utilise `libproc` `proc_listchildpids`.
- **Windows** : capture l'état de la table des processus avec `CreateToolhelp32Snapshot`, construit une carte parent->enfants, termine avec `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### Comportement de kill-tree

- Les descendants sont collectés récursivement.
- L'ordre de kill est de bas en haut (descendants les plus profonds en premier) pour réduire le re-parentage des orphelins.
- Le pid racine est tué en dernier.
- La valeur de retour est le nombre de terminaisons réussies.

Comportement des signaux :

- POSIX : le `signal` fourni est passé à `kill`.
- Windows : `signal` est ignoré ; la terminaison est un arrêt de processus inconditionnel.

### Comportement en cas d'échec

Ce module est intentionnellement non-lançant au niveau de la surface API :

- les branches d'arborescence de processus manquantes/inaccessibles sont ignorées,
- les échecs de kill par pid sont comptés comme non réussis (pas comme des erreurs),
- un échec de recherche retourne typiquement `[]` de `listDescendants` et `0` de `killTree`.

## Sous-système d'analyse des touches (`keys`)

### Modèle d'API

Helpers exposés :

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### Modèle d'analyse

L'analyseur combine :

- mappages directs sur un seul octet (`enter`, `tab`, `ctrl+<lettre>`, ASCII imprimable),
- recherche O(1) de séquences d'échappement legacy (carte PHF),
- analyse de `modifyOtherKeys` xterm,
- analyse du protocole Kitty (`CSI u`, `CSI ~`, `CSI 1;...<lettre>`),
- normalisation vers des identifiants de touches (`ctrl+c`, `shift+tab`, `pageUp`, `f5`, etc.).

Gestion des modificateurs :

- seuls les bits shift/alt/ctrl sont comparés pour la correspondance de touches,
- les bits de verrouillage sont masqués avant les comparaisons.

Comportement de disposition :

- le repli sur la disposition de base est intentionnellement limité afin que les dispositions remappées ne créent pas de fausses correspondances pour les lettres/symboles ASCII.

### Comportement en cas d'échec

- Les séquences non reconnues ou invalides produisent `null` depuis les fonctions d'analyse.
- Les fonctions de correspondance retournent `false` en cas d'échec d'analyse ou de non-correspondance.
- Aucune surface d'erreur levée pour les entrées de touches malformées.

## Correspondance API wrapper JS ↔ export Rust

### Shell + PTY + Processus

| API wrapper TS | Export Rust N-API | Notes |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | Exécution shell one-shot |
| `new Shell(options?)` | classe `Shell` | Session shell persistante |
| `shell.run(options, onChunk?)` | `Shell::run` | Réutilise la session lors d'un maintien actif du flux de contrôle |
| `shell.abort()` | `Shell::abort` | Annule l'exécution active pour cette instance shell |
| `new PtySession()` | classe `PtySession` | Session PTY avec état |
| `pty.start(options, onChunk?)` | `PtySession::start` | Exécution PTY interactive |
| `pty.write(data)` | `PtySession::write` | Transmission brute vers stdin |
| `pty.resize(cols, rows)` | `PtySession::resize` | Dimensions du terminal limitées |
| `pty.kill()` | `PtySession::kill` | Force la terminaison du processus enfant PTY actif |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | Terminaison de l'arborescence de processus en commençant par les enfants |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | Liste récursive des descendants |

### Touches

| API wrapper TS | Export Rust N-API | Notes |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Correspondance Kitty codepoint+modificateur |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Analyseur d'identifiant de touche normalisé |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | Vérification exacte dans la carte de séquences legacy |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | Résultat d'analyse Kitty structuré |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | Correspondant de touches de haut niveau |

## Notes sur le nettoyage des sessions abandonnées et la finalisation

- **Session shell persistante** : si une exécution est annulée/expirée/en erreur/hors flux de maintien actif, Rust abandonne explicitement l'état interne de la session. Les exécutions normales réussies conservent la session pour réutilisation.
- **Session PTY** : `core` est toujours effacé après la fin de `start()`, y compris sur les chemins d'échec.
- **Aucun contrat de kill piloté par un finaliseur JS explicite** n'est exposé par les wrappers ; le nettoyage est principalement lié aux chemins de complétion/annulation d'exécution. Les appelants doivent utiliser `timeoutMs`, `AbortSignal`, `shell.abort()`, ou `pty.kill()` pour un arrêt déterministe.
