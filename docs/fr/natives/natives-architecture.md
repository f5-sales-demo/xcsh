---
title: Architecture des Natives
description: >-
  Rust N-API native addon architecture bridging TypeScript and platform-specific
  operations.
sidebar:
  order: 1
  label: Architecture
i18n:
  sourceHash: ff6d5d83a9a7
  translator: machine
---

# Architecture des Natives

`@f5xc-salesdemos/pi-natives` est une pile à trois couches :

1. **Couche wrapper/API TypeScript** expose des points d'entrée JS/TS stables.
2. **Couche de chargement/validation de l'addon** résout et valide le binaire `.node` pour le runtime courant.
3. **Couche module Rust N-API** implémente les primitives critiques en termes de performance exportées vers JS.

Ce document constitue la base pour la documentation plus approfondie au niveau des modules.

## Fichiers d'implémentation

- `packages/natives/src/index.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `crates/pi-natives/src/lib.rs`

## Couche 1 : Couche wrapper/API TypeScript

`packages/natives/src/index.ts` est le barrel public. Il regroupe les exports par domaine de fonctionnalité et réexporte des wrappers typés plutôt que d'exposer directement les bindings N-API bruts.

Groupes de niveau supérieur actuels :

- **Primitives de recherche/texte** : `grep`, `glob`, `text`, `highlight`
- **Primitives d'exécution/processus/terminal** : `shell`, `pty`, `ps`, `keys`
- **Primitives système/média/conversion** : `image`, `html`, `clipboard`, `system-info`, `work`

`packages/natives/src/bindings.ts` définit le contrat d'interface de base :

- `NativeBindings` commence par les membres partagés (`cancelWork(id: number)`)
- les bindings spécifiques aux modules sont ajoutés par fusion de déclarations depuis le `types.ts` de chaque module
- `Cancellable` standardise les options de timeout et de signal d'abandon pour les wrappers qui exposent l'annulation

**Contrat garanti (côté API) :** les consommateurs importent depuis `@f5xc-salesdemos/pi-natives` et utilisent des wrappers typés.

**Détail d'implémentation (susceptible de changer) :** la fusion de déclarations et l'organisation interne des wrappers (`src/<module>/index.ts`, `src/<module>/types.ts`).

## Couche 2 : Chargement et validation de l'addon

`packages/natives/src/native.ts` gère la sélection de l'addon au runtime, l'extraction optionnelle et la validation des exports.

### Modèle de résolution des candidats

- Le tag de plateforme est `"${process.platform}-${process.arch}"`.
- Les tags supportés sont actuellement :
  - `linux-x64`
  - `linux-arm64`
  - `darwin-x64`
  - `darwin-arm64`
  - `win32-x64`
- x64 peut utiliser des variantes CPU :
  - `modern` (compatible AVX2)
  - `baseline` (solution de repli)
- Les architectures non-x64 utilisent le nom de fichier par défaut (sans suffixe de variante).

Stratégie de nommage des fichiers :

- Release : `pi_natives.<platform>-<arch>.node`
- Release avec variante x64 : `pi_natives.<platform>-<arch>-modern.node` et/ou `...-baseline.node`
- `PI_DEV` active les diagnostics du chargeur mais ne modifie pas les noms de fichiers de l'addon

### Détection de variante spécifique à la plateforme

Pour x64, la sélection de variante utilise :

- **Linux** : `/proc/cpuinfo`
- **macOS** : `sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows** : vérification PowerShell de `System.Runtime.Intrinsics.X86.Avx2`

`PI_NATIVE_VARIANT` peut forcer explicitement `modern` ou `baseline`.

### Modèle de distribution et d'extraction des binaires

`packages/natives/package.json` inclut à la fois `src` et `native` dans les fichiers publiés. Le répertoire `native/` stocke les artefacts précompilés par plateforme.

Pour les binaires compilés (marqueurs de runtime `PI_COMPILED` ou Bun embarqué), le comportement du chargeur est :

1. Vérifier le chemin de cache utilisateur versionné : `<getNativesDir()>/<packageVersion>/...`
2. Vérifier l'emplacement hérité des binaires compilés :
   - Windows : `%LOCALAPPDATA%/xcsh` (repli sur `%USERPROFILE%/AppData/Local/xcsh`)
   - non-Windows : `~/.local/bin`
3. Se replier sur le répertoire `native/` du package et les candidats du répertoire de l'exécutable

Si un manifeste d'addon embarqué est présent (`embedded-addon.ts` généré par `scripts/embed-native.ts`), `native.ts` peut matérialiser le binaire embarqué correspondant dans le répertoire de cache versionné avant le chargement.

### Validation et modes d'échec

Après `require(candidate)`, `validateNative(...)` vérifie les exports requis (par exemple `grep`, `glob`, `highlightCode`, `PtySession`, `Shell`, `getSystemInfo`, `getWorkProfile`, `invalidateFsScanCache`).

Les chemins d'échec sont explicites :

- **Tag de plateforme non supporté** : lève une exception avec la liste des plateformes supportées
- **Aucun candidat chargeable** : lève une exception avec tous les chemins tentés et des indications de remédiation
- **Exports manquants** : lève une exception avec les noms exacts manquants et la commande de reconstruction
- **Erreurs d'extraction embarquée** : enregistre les échecs de répertoire/écriture et les inclut dans les diagnostics finaux de chargement

**Contrat garanti (côté API) :** le chargement de l'addon réussit avec un ensemble de bindings validé ou échoue rapidement avec un texte d'erreur exploitable.

**Détail d'implémentation (susceptible de changer) :** l'ordre exact de recherche des candidats et l'ordonnancement du chemin de repli des binaires compilés.

## Couche 3 : Couche module Rust N-API

`crates/pi-natives/src/lib.rs` est le module d'entrée Rust qui déclare la propriété des modules exportés :

- `clipboard`
- `fd`
- `fs_cache`
- `glob`
- `glob_util`
- `grep`
- `highlight`
- `html`
- `image`
- `keys`
- `prof`
- `ps`
- `pty`
- `shell`
- `system_info`
- `task`
- `text`

Ces modules implémentent les symboles N-API consommés et validés par `native.ts`. Les noms côté JS sont exposés à travers les wrappers TS dans `packages/natives/src`.

**Contrat garanti (côté API) :** les exports des modules Rust doivent correspondre aux noms de bindings attendus par `validateNative` et les modules wrappers.

**Détail d'implémentation (susceptible de changer) :** la décomposition interne des modules Rust et les frontières des modules utilitaires (`glob_util`, `task`, etc.).

## Frontières de responsabilité

Au niveau de l'architecture, la responsabilité est répartie comme suit :

- **Responsabilité du wrapper/API TS (`packages/natives/src`)**
  - regroupement de l'API publique, typage des options et ergonomie JS stable
  - surface d'annulation (`timeoutMs`, `AbortSignal`) exposée aux appelants
- **Responsabilité du chargeur (`packages/natives/src/native.ts`)**
  - sélection du binaire au runtime
  - sélection de variante CPU et gestion des surcharges
  - extraction des binaires compilés et sondage des candidats
  - validation stricte des exports natifs requis
- **Responsabilité Rust (`crates/pi-natives/src`)**
  - implémentation algorithmique et au niveau système
  - comportement natif à la plateforme et logique sensible aux performances
  - implémentation des symboles N-API que les wrappers TS consomment

## Flux d'exécution (haut niveau)

1. Le consommateur importe depuis `@f5xc-salesdemos/pi-natives`.
2. Le module wrapper appelle le binding singleton `native`.
3. `native.ts` sélectionne le binaire candidat pour la plateforme/architecture/variante.
4. L'extraction optionnelle du binaire embarqué a lieu pour les distributions compilées.
5. L'addon est chargé et l'ensemble des exports est validé.
6. Le wrapper retourne des résultats typés à l'appelant.

## Glossaire

- **Addon natif** : Un binaire `.node` chargé via Node-API (N-API).
- **Tag de plateforme** : Tuple d'exécution `platform-arch` (par exemple `darwin-arm64`).
- **Variante** : Déclinaison de build spécifique au CPU x64 (`modern` AVX2, `baseline` solution de repli).
- **Wrapper** : Fonction/classe TS qui fournit une API typée par-dessus les exports natifs bruts.
- **Fusion de déclarations** : Technique TS utilisée par les fichiers `types.ts` des modules pour étendre `NativeBindings`.
- **Mode binaire compilé** : Mode d'exécution où le CLI est intégré et les addons natifs sont résolus depuis des chemins extraits/mis en cache au lieu des seuls chemins locaux au package.
- **Addon embarqué** : Métadonnées d'artefact de build et références de fichiers générées dans `embedded-addon.ts` afin que les binaires compilés puissent extraire les charges utiles `.node` correspondantes.
- **Porte de validation** : Vérification `validateNative(...)` qui rejette les binaires obsolètes/incompatibles auxquels il manque des exports requis.
