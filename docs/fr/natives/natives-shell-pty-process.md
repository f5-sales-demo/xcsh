---
title: 'Natifs Shell, PTY, Processus et Internals des touches'
description: >-
  Exécution de shell, gestion PTY, cycle de vie des processus et gestion des
  événements clavier dans la couche native.
sidebar:
  order: 4
  label: 'Shell, PTY & processus'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# Natifs Shell, PTY, Processus et Internals des touches

Ce document couvre les **primitives d'exécution/processus/terminal** dans `@f5xc-salesdemos/pi-natives` : `shell`, `pty`, `ps` et `keys`, en utilisant les termes architecturaux définis dans `docs/natives-architecture.md`.

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

## Propriété par couche

- **Couche wrapper/API TS** (`packages/natives/src/*`) : points d'entrée typés, surface d'annulation (`timeoutMs`, `AbortSignal`) et ergonomie JS.
- **Couche module N-API Rust** (`crates/pi-natives/src/*`) : exécution de processus shell/PTY, traversée/terminaison de l'arbre de processus et analyse des séquences de touches.
- **Passerelle de validation** (`native.ts`, niveau architecture) : garantit que les exports requis (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, helpers de touches) existent avant l'utilisation des wrappers.

## Sous-système Shell (`shell`)

### Modèle API

Deux modes d'exécution sont exposés :

1. **Exécution ponctuelle** via `executeShell(options, onChunk?)`.
2. **Session persistante** via `new Shell(options?)` puis `shell.run(...)` de manière répétée.

Les deux diffusent la sortie via un callback thread-safe et retournent `{ exitCode?, cancelled, timedOut }`.

### Création de session et modèle d'environnement

Rust crée `brush_core::Shell` avec :

- mode non interactif,
- `do_not_inherit_env: true`,
- reconstruction explicite de l'environnement à partir de l'env hôte,
- liste d'exclusion pour les variables sensibles au shell (`PS1`, `PWD`, `SHLVL`, exports de fonctions bash, etc.).

Comportement de l'env de session :

- `ShellOptions.sessionEnv` est appliqué une fois à la création de la session.
- `ShellRunOptions.env` est limité à la commande (`EnvironmentScope::Command`) et extrait après chaque exécution.
- `PATH` est fusionné de manière spéciale sous Windows avec déduplication insensible à la casse.

Enrichissement de chemin spécifique à Windows (`shell/windows.rs`) : les chemins Git-for-Windows découverts (`cmd`, `bin`, `usr/bin`) sont ajoutés s'ils sont présents et non déjà inclus.

### Cycle de vie d'exécution et transitions d'état

Le shell persistant (`Shell.run`) utilise cette machine à états :

- **Inactif/Non initialisé** : `session: None`.
- **En cours** : le premier `run()` crée la session de manière paresseuse, stocke le jeton `current_abort` et exécute la commande.
- **Terminé + keepalive** : si le flux de contrôle d'exécution est `Normal`, `current_abort` est effacé et la session est réutilisée.
- **Terminé + démontage** : si le flux de contrôle est lié à une boucle/script/sortie de shell (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), la session est supprimée (`session: None`).
- **Annulé/Délai dépassé** : la tâche d'exécution est annulée, attente gracieuse (2s), puis abandon forcé ; la session est supprimée.
- **Erreur** : la session est supprimée.

Le shell ponctuel (`executeShell`) crée et supprime toujours une nouvelle session par appel.

### Comportement de diffusion/sortie

- Stdout/stderr sont acheminés vers un pipe partagé et lus de manière concurrente.
- Le lecteur décode l'UTF-8 de manière incrémentale ; les séquences d'octets invalides émettent des chunks de remplacement `U+FFFD`.
- Après la fin du processus, le vidage de sortie dispose de gardes d'inactivité/maximum (`250ms` d'inactivité, `2s` maximum) pour éviter les blocages dus aux tâches d'arrière-plan maintenant les descripteurs ouverts.

### Annulation, délai d'expiration et tâches d'arrière-plan

- `CancelToken` est construit à partir de `timeoutMs` et d'un `AbortSignal` optionnel.
- En cas d'annulation/délai d'expiration, le jeton d'annulation du shell est déclenché, puis la tâche dispose d'une fenêtre gracieuse de 2s avant l'abandon forcé.
- Si l'annulation se produit, les tâches d'arrière-plan sont terminées (`TERM`, puis `KILL` différé) en utilisant les métadonnées de tâche brush.

Comportement de `Shell.abort()` :

- annule uniquement la commande en cours d'exécution pour cette instance `Shell`,
- opération sans effet si rien n'est en cours d'exécution.

### Comportement en cas d'échec

Les erreurs couramment remontées incluent :

- échecs d'initialisation de session (`Failed to initialize shell`),
- erreurs de répertoire courant (`Failed to set cwd`),
- échecs de définition/extraction d'environnement,
- échecs de source de snapshot,
- échecs de création/clonage de pipe,
- échec d'exécution (`Shell execution failed: ...`),
- échecs du wrapper de tâche (`Shell execution task failed: ...`).

Indicateurs d'annulation au niveau du résultat :

- délai d'expiration -> `exitCode: undefined`, `timedOut: true`.
- signal d'abandon -> `exitCode: undefined`, `cancelled: true`.

## Sous-système PTY (`pty`)

### Modèle API

`new PtySession()` expose :

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### Cycle de vie d'exécution et transitions d'état

Machine à états de `PtySession` :

- **Inactif** : `core: None`.
- **Réservé** : `start()` installe le canal de contrôle de manière synchrone (`core: Some`) avant le début du travail asynchrone, de sorte que `write/resize/kill` deviennent immédiatement valides.
- **En cours** : la boucle PTY bloquante gère l'état de l'enfant, les événements du lecteur, le heartbeat d'annulation et les messages de contrôle.
- **Terminal fermé** : sortie de l'enfant + fin du lecteur.
- **Finalisé** : `core` est toujours réinitialisé à `None` après la fin de la tâche de démarrage (succès ou erreur).

Garde de concurrence :

- démarrer alors qu'une session est déjà en cours retourne `PTY session already running`.

### Modèles de spawn/attach/write/read/terminate

- PTY ouvert via `portable_pty::native_pty_system().openpty(...)`.
- La commande s'exécute actuellement sous la forme `sh -lc <command>` avec `cwd` et surcharges d'env optionnels.
- `write()` envoie des octets bruts vers l'entrée standard du PTY.
- `resize()` contraint les dimensions (`cols 20..400`, `rows 5..200`) et appelle le redimensionnement du maître.
- `kill()` marque l'exécution comme annulée et tue le processus enfant.

Chemin de sortie :

- un thread de lecture dédié lit le flux maître,
- décodage UTF-8 incrémental avec remplacement `U+FFFD` pour les octets invalides,
- les chunks sont transmis via le callback thread-safe N-API.

### Sémantique d'annulation et de délai d'expiration

- `timeoutMs` et `AbortSignal` alimentent un `CancelToken`.
- la boucle appelle `ct.heartbeat()` périodiquement ; l'abandon déclenche le kill de l'enfant.
- la classification du délai d'expiration est basée sur une chaîne (sous-chaîne `"Timeout"` dans l'erreur de heartbeat).

### Comportement en cas d'échec

Les surfaces d'erreur incluent :

- échec d'allocation/ouverture PTY,
- échec de spawn PTY,
- échec d'acquisition du writer/reader,
- échecs de statut/attente de l'enfant,
- empoisonnement de verrou,
- déconnexion du canal de contrôle (`PTY session is no longer available`).

Échecs d'appel de contrôle quand la session n'est pas en cours :

- `write/resize/kill` retournent `PTY session is not running`.

## Sous-système d'arbre de processus (`ps`)

### Modèle API

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

Le wrapper TS enregistre également l'intégration native kill-tree dans les utilitaires partagés via `setNativeKillTree(native.killTree)`.

### Implémentation spécifique à la plateforme

- **Linux** : lit récursivement `/proc/<pid>/task/<pid>/children`.
- **macOS** : utilise `libproc` `proc_listchildpids`.
- **Windows** : prend un snapshot de la table des processus avec `CreateToolhelp32Snapshot`, construit une map parent->enfants, termine avec `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### Comportement de kill-tree

- Les descendants sont collectés récursivement.
- L'ordre de kill est de bas en haut (descendants les plus profonds en premier) pour réduire la réadoption des orphelins.
- Le pid racine est tué en dernier.
- La valeur de retour est le nombre de terminaisons réussies.

Comportement des signaux :

- POSIX : le `signal` fourni est passé à `kill`.
- Windows : `signal` est ignoré ; la terminaison est un arrêt de processus inconditionnel.

### Comportement en cas d'échec

Ce module est intentionnellement non-leveur d'exceptions au niveau de la surface API :

- les branches de l'arbre de processus manquantes/inaccessibles sont ignorées,
- les échecs de kill par pid sont comptés comme non réussis (pas comme des erreurs),
- une recherche manquée retourne typiquement `[]` depuis `listDescendants` et `0` depuis `killTree`.

## Sous-système d'analyse des touches (`keys`)

### Modèle API

Helpers exposés :

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### Modèle d'analyse

L'analyseur combine :

- mappages directs d'octets uniques (`enter`, `tab`, `ctrl+<lettre>`, ASCII imprimable),
- lookup de séquence d'échappement legacy en O(1) (carte PHF),
- analyse `modifyOtherKeys` xterm,
- analyse du protocole Kitty (`CSI u`, `CSI ~`, `CSI 1;...<lettre>`),
- normalisation vers des identifiants de touches (`ctrl+c`, `shift+tab`, `pageUp`, `f5`, etc.).

Gestion des modificateurs :

- seuls les bits shift/alt/ctrl sont comparés pour la correspondance de touches,
- les bits de verrouillage sont masqués avant les comparaisons.

Comportement de disposition :

- le repli sur la disposition de base est intentionnellement contraint afin que les dispositions remappées ne créent pas de fausses correspondances pour les lettres/symboles ASCII.

### Comportement en cas d'échec

- Les séquences non reconnues ou invalides produisent `null` depuis les fonctions d'analyse.
- Les fonctions de correspondance retournent `false` en cas d'échec d'analyse ou de non-correspondance.
- Aucune surface d'erreur levée pour les entrées de touches malformées.

## Correspondance API wrapper JS ↔ export Rust

### Shell + PTY + Processus

| API wrapper TS | Export N-API Rust | Notes |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | Exécution de shell ponctuelle |
| `new Shell(options?)` | classe `Shell` | Session de shell persistante |
| `shell.run(options, onChunk?)` | `Shell::run` | Réutilise la session en flux de contrôle keepalive |
| `shell.abort()` | `Shell::abort` | Annule l'exécution active pour cette instance de shell |
| `new PtySession()` | classe `PtySession` | Session PTY avec état |
| `pty.start(options, onChunk?)` | `PtySession::start` | Exécution PTY interactive |
| `pty.write(data)` | `PtySession::write` | Passage direct vers stdin |
| `pty.resize(cols, rows)` | `PtySession::resize` | Dimensions du terminal contraintes |
| `pty.kill()` | `PtySession::kill` | Force-kill du processus enfant PTY actif |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | Terminaison de l'arbre de processus en partant des enfants |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | Liste récursive des descendants |

### Touches

| API wrapper TS | Export N-API Rust | Notes |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Correspondance codepoint+modificateur Kitty |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Analyseur d'identifiant de touche normalisé |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | Vérification exacte dans la carte de séquences legacy |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | Résultat d'analyse Kitty structuré |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | Correspondance de touche de haut niveau |

## Notes de nettoyage des sessions abandonnées et de finalisation

- **Session de shell persistante** : si une exécution est annulée/délai dépassé/en erreur/flux de contrôle non-keepalive, Rust supprime explicitement l'état de session interne. Les exécutions normales réussies conservent la session pour réutilisation.
- **Session PTY** : `core` est toujours effacé après la fin de `start()`, y compris en cas d'échec.
- **Aucun contrat de kill piloté par finaliseur JS explicite** n'est exposé par les wrappers ; le nettoyage est principalement lié aux chemins de fin d'exécution/annulation. Les appelants doivent utiliser `timeoutMs`, `AbortSignal`, `shell.abort()` ou `pty.kill()` pour un démontage déterministe.
