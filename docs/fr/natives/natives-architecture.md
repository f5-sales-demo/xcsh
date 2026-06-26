---
title: Architecture des natifs
description: >-
  Architecture d'addon natif Rust N-API reliant TypeScript et les opérations
  spécifiques à la plateforme.
sidebar:
  order: 1
  label: Architecture
i18n:
  sourceHash: ff6d5d83a9a7
  translator: machine
---

# Architecture des natifs

`@f5-sales-demo/pi-natives` est une pile à trois couches :

1. **Couche wrapper/API TypeScript** expose des points d'entrée JS/TS stables.
2. **Couche de chargement/validation de l'addon** résout et valide le binaire `.node` pour l'environnement d'exécution courant.
3. **Couche module Rust N-API** implémente les primitives critiques en termes de performances exportées vers JS.

Ce document constitue le fondement des documentations approfondies au niveau des modules.

## Fichiers d'implémentation

- `packages/natives/src/index.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `crates/pi-natives/src/lib.rs`

## Couche 1 : couche wrapper/API TypeScript

`packages/natives/src/index.ts` est le barrel public. Il regroupe les exports par domaine de capacité et réexporte des wrappers typés plutôt que d'exposer directement les liaisons N-API brutes.

Groupes de premier niveau actuels :

- **Primitives de recherche/texte** : `grep`, `glob`, `text`, `highlight`
- **Primitives d'exécution/processus/terminal** : `shell`, `pty`, `ps`, `keys`
- **Primitives système/média/conversion** : `image`, `html`, `clipboard`, `system-info`, `work`

`packages/natives/src/bindings.ts` définit le contrat d'interface de base :

- `NativeBindings` commence par des membres partagés (`cancelWork(id: number)`)
- les liaisons spécifiques aux modules sont ajoutées par fusion de déclarations depuis le fichier `types.ts` de chaque module
- `Cancellable` standardise les options de délai d'expiration et de signal d'abandon pour les wrappers qui exposent l'annulation

**Contrat garanti (côté API) :** les consommateurs importent depuis `@f5-sales-demo/pi-natives` et utilisent des wrappers typés.

**Détail d'implémentation (susceptible de changer) :** la fusion de déclarations et la disposition interne des wrappers (`src/<module>/index.ts`, `src/<module>/types.ts`).

## Couche 2 : chargement et validation de l'addon

`packages/natives/src/native.ts` gère la sélection de l'addon à l'exécution, l'extraction optionnelle et la validation des exports.

### Modèle de résolution des candidats

- Le tag de Plateforme est `"${process.platform}-${process.arch}"`.
- Les tags pris en charge sont actuellement :
  - `linux-x64`
  - `linux-arm64`
  - `darwin-x64`
  - `darwin-arm64`
  - `win32-x64`
- x64 peut utiliser des variantes CPU :
  - `modern` (compatible AVX2)
  - `baseline` (repli)
- Les architectures non-x64 utilisent le nom de fichier par défaut (sans suffixe de variante).

Stratégie de nommage des fichiers :

- Version release : `pi_natives.<platform>-<arch>.node`
- Version release avec variante x64 : `pi_natives.<platform>-<arch>-modern.node` et/ou `...-baseline.node`
- `PI_DEV` active les diagnostics du chargeur mais ne modifie pas les noms de fichiers des addons

### Détection de variante spécifique à la Plateforme

Pour x64, la sélection de variante utilise :

- **Linux** : `/proc/cpuinfo`
- **macOS** : `sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows** : vérification PowerShell de `System.Runtime.Intrinsics.X86.Avx2`

`PI_NATIVE_VARIANT` peut forcer explicitement `modern` ou `baseline`.

### Modèle de distribution et d'extraction des binaires

`packages/natives/package.json` inclut à la fois `src` et `native` dans les fichiers publiés. Le répertoire `native/` stocke les artefacts précompilés par Plateforme.

Pour les binaires compilés (marqueurs d'environnement d'exécution `PI_COMPILED` ou Bun embarqué), le comportement du chargeur est le suivant :

1. Vérifier le chemin de cache utilisateur versionné : `<getNativesDir()>/<packageVersion>/...`
2. Vérifier l'emplacement hérité des binaires compilés :
   - Windows : `%LOCALAPPDATA%/xcsh` (repli : `%USERPROFILE%/AppData/Local/xcsh`)
   - non-Windows : `~/.local/bin`
3. Se rabattre sur les candidats du répertoire `native/` packagé et du répertoire de l'exécutable

Si un manifeste d'addon embarqué est présent (`embedded-addon.ts` généré par `scripts/embed-native.ts`), `native.ts` peut matérialiser le binaire embarqué correspondant dans le répertoire de cache versionné avant le chargement.

### Validation et modes d'échec

Après `require(candidate)`, `validateNative(...)` vérifie les exports requis (par exemple `grep`, `glob`, `highlightCode`, `PtySession`, `Shell`, `getSystemInfo`, `getWorkProfile`, `invalidateFsScanCache`).

Les chemins d'échec sont explicites :

- **Tag de Plateforme non pris en charge** : lève une exception avec la liste des Plateformes prises en charge
- **Aucun candidat chargeable** : lève une exception avec tous les chemins tentés et des indications de remédiation
- **Exports manquants** : lève une exception avec les noms manquants exacts et la commande de reconstruction
- **Erreurs d'extraction de l'addon embarqué** : enregistre les échecs de répertoire/écriture et les inclut dans les diagnostics de chargement final

**Contrat garanti (côté API) :** le chargement de l'addon soit réussit avec un ensemble de liaisons validées, soit échoue rapidement avec un message d'erreur actionnable.

**Détail d'implémentation (susceptible de changer) :** l'ordre exact de recherche des candidats et l'ordre des chemins de repli pour les binaires compilés.

## Couche 3 : couche module Rust N-API

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

Ces modules implémentent les symboles N-API consommés et validés par `native.ts`. Les noms au niveau JS sont exposés via les wrappers TS dans `packages/natives/src`.

**Contrat garanti (côté API) :** les exports du module Rust doivent correspondre aux noms de liaisons attendus par `validateNative` et les modules wrapper.

**Détail d'implémentation (susceptible de changer) :** la décomposition interne des modules Rust et les frontières des modules auxiliaires (`glob_util`, `task`, etc.).

## Délimitation des responsabilités

Au niveau architectural, les responsabilités sont réparties comme suit :

- **Responsabilité du wrapper/API TS (`packages/natives/src`)**
  - groupement de l'API publique, typage des options et ergonomie JS stable
  - surface d'annulation (`timeoutMs`, `AbortSignal`) exposée aux appelants
- **Responsabilité du chargeur (`packages/natives/src/native.ts`)**
  - sélection du binaire à l'exécution
  - sélection de la variante CPU et gestion des substitutions
  - extraction des binaires compilés et sondage des candidats
  - validation stricte des exports natifs requis
- **Responsabilité Rust (`crates/pi-natives/src`)**
  - implémentation algorithmique et au niveau système
  - comportement natif à la Plateforme et logique sensible aux performances
  - implémentation des symboles N-API consommés par les wrappers TS

## Flux d'exécution (vue d'ensemble)

1. Le consommateur importe depuis `@f5-sales-demo/pi-natives`.
2. Le module wrapper appelle la liaison `native` singleton.
3. `native.ts` sélectionne le binaire candidat pour la Plateforme/architecture/variante.
4. L'extraction optionnelle du binaire embarqué s'effectue pour les distributions compilées.
5. L'addon est chargé et l'ensemble des exports est validé.
6. Le wrapper retourne des résultats typés à l'appelant.

## Glossaire

- **Addon natif** : un binaire `.node` chargé via Node-API (N-API).
- **Tag de Plateforme** : tuple d'exécution `platform-arch` (par exemple `darwin-arm64`).
- **Variante** : saveur de compilation spécifique au CPU x64 (`modern` AVX2, `baseline` repli).
- **Wrapper** : fonction/classe TS qui fournit une API typée au-dessus des exports natifs bruts.
- **Fusion de déclarations** : technique TS utilisée par les fichiers `types.ts` des modules pour étendre `NativeBindings`.
- **Mode binaire compilé** : mode d'exécution dans lequel le CLI est regroupé et les addons natifs sont résolus depuis des chemins extraits/de cache plutôt que depuis les seuls chemins locaux au package.
- **Addon embarqué** : métadonnées d'artefact de build et références de fichiers générées dans `embedded-addon.ts` afin que les binaires compilés puissent extraire les charges utiles `.node` correspondantes.
- **Porte de validation** : vérification `validateNative(...)` qui rejette les binaires obsolètes ou non concordants dont il manque des exports requis.
