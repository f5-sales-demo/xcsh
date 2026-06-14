---
title: Architecture des natifs
description: >-
  Architecture de l'addon natif Rust N-API faisant le pont entre TypeScript et
  les opérations spécifiques à la plateforme.
sidebar:
  order: 1
  label: Architecture
i18n:
  sourceHash: ff6d5d83a9a7
  translator: machine
---

# Architecture des natifs

`@f5xc-salesdemos/pi-natives` est une pile à trois couches :

1. **Couche wrapper/API TypeScript** expose des points d'entrée JS/TS stables.
2. **Couche de chargement/validation de l'addon** résout et valide le binaire `.node` pour le runtime courant.
3. **Couche module Rust N-API** implémente les primitives critiques en termes de performance exportées vers JS.

Ce document constitue la base pour des documentations plus approfondies au niveau des modules.

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

`packages/natives/src/index.ts` est le barrel public. Il regroupe les exports par domaine de capacité et réexporte des wrappers typés plutôt que d'exposer directement les liaisons N-API brutes.

Groupes de premier niveau actuels :

- **Primitives de recherche/texte** : `grep`, `glob`, `text`, `highlight`
- **Primitives d'exécution/processus/terminal** : `shell`, `pty`, `ps`, `keys`
- **Primitives système/média/conversion** : `image`, `html`, `clipboard`, `system-info`, `work`

`packages/natives/src/bindings.ts` définit le contrat d'interface de base :

- `NativeBindings` commence avec des membres partagés (`cancelWork(id: number)`)
- les liaisons spécifiques aux modules sont ajoutées par fusion de déclarations depuis le fichier `types.ts` de chaque module
- `Cancellable` standardise les options de délai d'attente et de signal d'abandon pour les wrappers qui exposent l'annulation

**Contrat garanti (orienté API) :** les consommateurs importent depuis `@f5xc-salesdemos/pi-natives` et utilisent des wrappers typés.

**Détail d'implémentation (susceptible de changer) :** la fusion de déclarations et la disposition interne des wrappers (`src/<module>/index.ts`, `src/<module>/types.ts`).

## Couche 2 : Chargement et validation de l'addon

`packages/natives/src/native.ts` gère la sélection de l'addon au runtime, l'extraction optionnelle et la validation des exports.

### Modèle de résolution des candidats

- L'étiquette de Plateforme est `"${process.platform}-${process.arch}"`.
- Les étiquettes prises en charge sont actuellement :
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

- Release : `pi_natives.<platform>-<arch>.node`
- Release avec variante x64 : `pi_natives.<platform>-<arch>-modern.node` et/ou `...-baseline.node`
- `PI_DEV` active les diagnostics du chargeur mais ne modifie pas les noms de fichiers des addons

### Détection de variante spécifique à la Plateforme

Pour x64, la sélection de variante utilise :

- **Linux** : `/proc/cpuinfo`
- **macOS** : `sysctl machdep.cpu.leaf7_features` / `machdep.cpu.features`
- **Windows** : vérification PowerShell pour `System.Runtime.Intrinsics.X86.Avx2`

`PI_NATIVE_VARIANT` peut forcer explicitement `modern` ou `baseline`.

### Modèle de distribution et d'extraction des binaires

`packages/natives/package.json` inclut `src` et `native` dans les fichiers publiés. Le répertoire `native/` stocke les artefacts précompilés par Plateforme.

Pour les binaires compilés (marqueurs de runtime `PI_COMPILED` ou embarqués dans Bun), le comportement du chargeur est :

1. Vérifier le chemin du cache utilisateur versionné : `<getNativesDir()>/<packageVersion>/...`
2. Vérifier l'emplacement hérité des binaires compilés :
   - Windows : `%LOCALAPPDATA%/xcsh` (repli `%USERPROFILE%/AppData/Local/xcsh`)
   - non-Windows : `~/.local/bin`
3. Se replier sur les candidats du répertoire `native/` packagé et du répertoire de l'exécutable

Si un manifeste d'addon embarqué est présent (`embedded-addon.ts` généré par `scripts/embed-native.ts`), `native.ts` peut matérialiser le binaire embarqué correspondant dans le répertoire de cache versionné avant le chargement.

### Validation et modes d'échec

Après `require(candidate)`, `validateNative(...)` vérifie les exports requis (par exemple `grep`, `glob`, `highlightCode`, `PtySession`, `Shell`, `getSystemInfo`, `getWorkProfile`, `invalidateFsScanCache`).

Les chemins d'échec sont explicites :

- **Étiquette de Plateforme non prise en charge** : lève une exception avec la liste des plateformes prises en charge
- **Aucun candidat chargeable** : lève une exception avec tous les chemins tentés et des indications de remédiation
- **Exports manquants** : lève une exception avec les noms exacts manquants et la commande de reconstruction
- **Erreurs d'extraction embarquée** : enregistre les échecs de répertoire/écriture et les inclut dans les diagnostics finaux de chargement

**Contrat garanti (orienté API) :** le chargement de l'addon réussit avec un ensemble de liaisons validé ou échoue rapidement avec un message d'erreur exploitable.

**Détail d'implémentation (susceptible de changer) :** l'ordre exact de recherche des candidats et l'ordre des chemins de repli pour les binaires compilés.

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

Ces modules implémentent les symboles N-API consommés et validés par `native.ts`. Les noms au niveau JS sont exposés via les wrappers TS dans `packages/natives/src`.

**Contrat garanti (orienté API) :** les exports du module Rust doivent correspondre aux noms de liaisons attendus par `validateNative` et les modules wrappers.

**Détail d'implémentation (susceptible de changer) :** la décomposition interne des modules Rust et les limites des modules auxiliaires (`glob_util`, `task`, etc.).

## Limites de propriété

Au niveau architectural, la propriété est répartie comme suit :

- **Propriété du wrapper/API TS (`packages/natives/src`)**
  - regroupement de l'API publique, typage des options et ergonomie JS stable
  - surface d'annulation (`timeoutMs`, `AbortSignal`) exposée aux appelants
- **Propriété du chargeur (`packages/natives/src/native.ts`)**
  - sélection du binaire au runtime
  - sélection de la variante CPU et gestion des substitutions
  - extraction des binaires compilés et sondage des candidats
  - validation stricte des exports natifs requis
- **Propriété Rust (`crates/pi-natives/src`)**
  - implémentation algorithmique et au niveau système
  - comportement natif à la Plateforme et logique sensible aux performances
  - implémentation des symboles N-API consommés par les wrappers TS

## Flux d'exécution (vue générale)

1. Le consommateur importe depuis `@f5xc-salesdemos/pi-natives`.
2. Le module wrapper appelle la liaison `native` singleton.
3. `native.ts` sélectionne le binaire candidat pour la plateforme/architecture/variante.
4. L'extraction optionnelle du binaire embarqué se produit pour les distributions compilées.
5. L'addon est chargé et l'ensemble des exports est validé.
6. Le wrapper retourne des résultats typés à l'appelant.

## Glossaire

- **Addon natif** : Un binaire `.node` chargé via Node-API (N-API).
- **Étiquette de Plateforme** : Tuple runtime `platform-arch` (par exemple `darwin-arm64`).
- **Variante** : Déclinaison de build spécifique au CPU x64 (`modern` AVX2, `baseline` repli).
- **Wrapper** : Fonction/classe TS fournissant une API typée sur les exports natifs bruts.
- **Fusion de déclarations** : Technique TS utilisée par les fichiers `types.ts` des modules pour étendre `NativeBindings`.
- **Mode binaire compilé** : Mode d'exécution dans lequel l'interface CLI est empaquetée et les addons natifs sont résolus depuis des chemins extraits/en cache plutôt que depuis les seuls chemins locaux au package.
- **Addon embarqué** : Métadonnées d'artefact de build et références de fichiers générées dans `embedded-addon.ts` pour permettre aux binaires compilés d'extraire les charges utiles `.node` correspondantes.
- **Porte de validation** : Vérification `validateNative(...)` qui rejette les binaires obsolètes/non concordants dont les exports requis sont manquants.
