---
title: 'Internes natifs Shell, PTY, Processus et Touches'
description: >-
  Exécution shell, gestion PTY, cycle de vie des processus et gestion des
  événements clavier dans la couche native.
sidebar:
  order: 4
  label: 'Shell, PTY et processus'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# Internes natifs Shell, PTY, Processus et Touches

Ce document couvre les **primitives d'exécution/processus/terminal** dans `@f5xc-salesdemos/pi-natives` : `shell`, `pty`, `ps` et `keys`, en utilisant les termes d'architecture de `docs/natives-architecture.md`.

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

- **Couche wrapper/API TS** (`packages/natives/src/*`) : points d'entrée typés, surface d'annulation (`timeoutMs`, `AbortSignal`) et ergonomie JS.
- **Couche module Rust N-API** (`crates/pi-natives/src/*`) : exécution shell/PTY des processus, parcours/terminaison de l'arbre de processus et analyse des séquences de touches.
- **Porte de validation** (`native.ts`, niveau architecture) : vérifie que les exports requis (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, utilitaires de touches) existent avant que les wrappers soient utilisés.

## Sous-système Shell (`shell`)

### Modèle d'API

Deux modes d'exécution sont exposés :

1. **Exécution unique** via `executeShell(options, onChunk?)`.
2. **Session persistante** via `new Shell(options?)` puis `shell.run(...)` de manière répétée.

Les deux diffusent la sortie via un callback thread-safe et retournent `{ exitCode?, cancelled, timedOut }`.

### Création de session et modèle d'environnement

Rust crée `brush_core::Shell` avec :

- le mode non interactif,
- `do_not_inherit_env: true`,
- une reconstruction explicite de l'environnement à partir de l'env hôte,
- une liste d'exclusion pour les variables sensibles au shell (`PS1`, `PWD`, `SHLVL`, exports de fonctions bash, etc.).

Comportement de l'environnement de session :

- `ShellOptions.sessionEnv` est appliqué une seule fois à la création de la session.
- `ShellRunOptions.env` a une portée par commande (`EnvironmentScope::Command`) et est dépilé après chaque exécution.
- `PATH` est fusionné de manière spéciale sur Windows avec dédoublonnage insensible à la casse.

Enrichissement de chemin spécifique à Windows (`shell/windows.rs`) : les chemins Git-for-Windows découverts (`cmd`, `bin`, `usr/bin`) sont ajoutés s'ils sont présents et pas déjà inclus.

### Cycle de vie d'exécution et transitions d'état

Le shell persistant (`Shell.run`) utilise cette machine à états :

- **Inactif/Non initialisé** : `session: None`.
- **En cours d'exécution** : le premier `run()` crée paresseusement la session, stocke le jeton `current_abort`, exécute la commande.
- **Terminé + maintien en vie** : si le flux de contrôle d'exécution est `Normal`, `current_abort` est effacé et la session est réutilisée.
- **Terminé + démontage** : si le flux de contrôle est lié à une boucle/script/sortie de shell (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), la session est libérée (`session: None`).
- **Annulé/Expiré** : la tâche en cours est annulée, attente gracieuse (2s), puis abandon forcé ; la session est libérée.
- **Erreur** : la session est libérée.

Le shell à exécution unique (`executeShell`) crée et libère toujours une session fraîche par appel.

### Comportement de diffusion/sortie

- Stdout/stderr sont routés dans un pipe partagé et lus de manière concurrente.
- Le lecteur décode l'UTF-8 de manière incrémentale ; les séquences d'octets invalides émettent des chunks de remplacement `U+FFFD`.
- Après la fin du processus, le drainage de la sortie dispose de gardes d'inactivité/maximum (`250ms` d'inactivité, `2s` maximum) pour éviter le blocage sur les jobs en arrière-plan gardant les descripteurs ouverts.

### Annulation, délai d'expiration et jobs en arrière-plan

- `CancelToken` est construit à partir de `timeoutMs` et d'un `AbortSignal` optionnel.
- En cas d'annulation/expiration, le jeton d'annulation du shell est déclenché, puis la tâche obtient une fenêtre gracieuse de 2s avant l'abandon forcé.
- Si l'annulation se produit, les jobs en arrière-plan sont terminés (`TERM`, puis `KILL` différé) en utilisant les métadonnées de jobs de brush.

Comportement de `Shell.abort()` :

- annule uniquement la commande en cours d'exécution pour cette instance de `Shell`,
- succès sans effet lorsque rien n'est en cours d'exécution.

### Comportement en cas d'erreur

Les erreurs couramment exposées incluent :

- échecs d'initialisation de session (`Failed to initialize shell`),
- erreurs de cwd (`Failed to set cwd`),
- échecs de définition/dépilage d'environnement,
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
- **Réservé** : `start()` installe le canal de contrôle de manière synchrone (`core: Some`) avant le début du travail asynchrone, de sorte que `write/resize/kill` deviennent immédiatement valides.
- **En cours d'exécution** : la boucle bloquante PTY gère l'état du processus enfant, les événements du lecteur, le heartbeat d'annulation et les messages de contrôle.
- **Terminal fermé** : sortie du processus enfant + fin du lecteur.
- **Finalisé** : `core` est toujours réinitialisé à `None` après la fin de la tâche start (succès ou erreur).

Garde de concurrence :

- démarrer alors qu'une session est déjà en cours retourne `PTY session already running`.

### Patterns de spawn/attachement/écriture/lecture/terminaison

- Le PTY est ouvert via `portable_pty::native_pty_system().openpty(...)`.
- La commande s'exécute actuellement en tant que `sh -lc <command>` avec `cwd` optionnel et surcharges d'environnement.
- `write()` envoie des octets bruts vers le stdin du PTY.
- `resize()` contraint les dimensions (`cols 20..400`, `rows 5..200`) et appelle le redimensionnement du maître.
- `kill()` marque l'exécution comme annulée et tue le processus enfant.

Chemin de sortie :

- un thread lecteur dédié lit le flux maître,
- décodage UTF-8 incrémental avec remplacement `U+FFFD` sur les octets invalides,
- les chunks sont transmis via le callback thread-safe N-API.

### Sémantiques d'annulation et de délai d'expiration

- `timeoutMs` et `AbortSignal` alimentent un `CancelToken`.
- la boucle appelle `ct.heartbeat()` périodiquement ; l'abandon déclenche la terminaison du processus enfant.
- la classification du délai d'expiration est basée sur les chaînes de caractères (sous-chaîne `"Timeout"` dans l'erreur du heartbeat).

### Comportement en cas d'erreur

Les surfaces d'erreur incluent :

- échec d'allocation/ouverture du PTY,
- échec de spawn du PTY,
- échec d'acquisition du writer/reader,
- échecs de statut/attente du processus enfant,
- empoisonnement de verrou,
- déconnexion du canal de contrôle (`PTY session is no longer available`).

Échecs des appels de contrôle lorsque non en cours d'exécution :

- `write/resize/kill` retournent `PTY session is not running`.

## Sous-système d'arbre de processus (`ps`)

### Modèle d'API

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

Le wrapper TS enregistre également l'intégration native de kill-tree dans les utilitaires partagés via `setNativeKillTree(native.killTree)`.

### Implémentation spécifique à la plateforme

- **Linux** : lit récursivement `/proc/<pid>/task/<pid>/children`.
- **macOS** : utilise `libproc` `proc_listchildpids`.
- **Windows** : prend un instantané de la table de processus avec `CreateToolhelp32Snapshot`, construit une correspondance parent->enfants, termine avec `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### Comportement du kill-tree

- Les descendants sont collectés récursivement.
- L'ordre de terminaison est ascendant (les descendants les plus profonds en premier) pour réduire le re-parentage des orphelins.
- Le pid racine est tué en dernier.
- La valeur de retour est le nombre de terminaisons réussies.

Comportement du signal :

- POSIX : le `signal` fourni est passé à `kill`.
- Windows : `signal` est ignoré ; la terminaison est une terminaison inconditionnelle du processus.

### Comportement en cas d'erreur

Ce module est intentionnellement non-leveur d'exceptions au niveau de la surface API :

- les branches d'arbre de processus manquantes/inaccessibles sont ignorées,
- les échecs de kill par pid sont comptés comme non réussis (pas comme des erreurs),
- un pid introuvable produit typiquement `[]` depuis `listDescendants` et `0` depuis `killTree`.

## Sous-système d'analyse des touches (`keys`)

### Modèle d'API

Utilitaires exposés :

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### Modèle d'analyse

L'analyseur combine :

- des correspondances directes d'octets uniques (`enter`, `tab`, `ctrl+<lettre>`, ASCII imprimable),
- une recherche O(1) de séquences d'échappement legacy (table PHF),
- l'analyse `modifyOtherKeys` de xterm,
- l'analyse du protocole Kitty (`CSI u`, `CSI ~`, `CSI 1;...<lettre>`),
- la normalisation vers des identifiants de touches (`ctrl+c`, `shift+tab`, `pageUp`, `f5`, etc.).

Gestion des modificateurs :

- seuls les bits shift/alt/ctrl sont comparés pour la correspondance des touches,
- les bits de verrouillage sont masqués avant les comparaisons.

Comportement de disposition :

- le repli sur la disposition de base est intentionnellement contraint afin que les dispositions remappées ne créent pas de fausses correspondances pour les lettres/symboles ASCII.

### Comportement en cas d'erreur

- Les séquences non reconnues ou invalides produisent `null` depuis les fonctions d'analyse.
- Les fonctions de correspondance retournent `false` en cas d'échec d'analyse ou de non-correspondance.
- Aucune surface d'erreur levée pour une entrée de touche malformée.

## Correspondance API wrapper JS ↔ Export Rust

### Shell + PTY + Processus

| API wrapper TS | Export Rust N-API | Notes |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | Exécution shell unique |
| `new Shell(options?)` | Classe `Shell` | Session shell persistante |
| `shell.run(options, onChunk?)` | `Shell::run` | Réutilise la session en cas de flux de contrôle keepalive |
| `shell.abort()` | `Shell::abort` | Abandonne l'exécution active pour cette instance de shell |
| `new PtySession()` | Classe `PtySession` | Session PTY avec état |
| `pty.start(options, onChunk?)` | `PtySession::start` | Exécution PTY interactive |
| `pty.write(data)` | `PtySession::write` | Passage direct du stdin brut |
| `pty.resize(cols, rows)` | `PtySession::resize` | Dimensions du terminal contraintes |
| `pty.kill()` | `PtySession::kill` | Terminaison forcée du processus enfant PTY actif |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | Terminaison de l'arbre de processus enfants d'abord |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | Listage récursif des descendants |

### Touches

| API wrapper TS | Export Rust N-API | Notes |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Correspondance codepoint+modificateur Kitty |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Analyseur d'identifiant de touche normalisé |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | Vérification exacte dans la table de séquences legacy |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | Résultat d'analyse Kitty structuré |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | Correspondance de touche de haut niveau |

## Notes sur le nettoyage et la finalisation des sessions abandonnées

- **Session shell persistante** : si une exécution est annulée/expirée/en erreur/avec un flux de contrôle non-keepalive, Rust libère explicitement l'état interne de la session. Les exécutions normales réussies conservent la session pour réutilisation.
- **Session PTY** : `core` est toujours effacé après la fin de `start()`, y compris sur les chemins d'erreur.
- **Aucun contrat explicite de terminaison piloté par un finaliseur JS** n'est exposé par les wrappers ; le nettoyage est principalement lié aux chemins de complétion/annulation de l'exécution. Les appelants doivent utiliser `timeoutMs`, `AbortSignal`, `shell.abort()` ou `pty.kill()` pour un démontage déterministe.
