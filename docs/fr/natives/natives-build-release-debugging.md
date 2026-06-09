---
title: 'Runbook de compilation, publication et débogage des natives'
description: >-
  Runbook de compilation, publication et débogage pour l'addon natif Rust sur
  toutes les plateformes.
sidebar:
  order: 8
  label: 'Compilation, publication et débogage'
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# Runbook de compilation, publication et débogage des natives

Ce runbook décrit comment le pipeline de compilation de `@f5xc-salesdemos/pi-natives` produit les addons `.node`, comment les distributions compilées les chargent, et comment déboguer les échecs de chargement/compilation.

Il suit la terminologie architecturale de `docs/natives-architecture.md` :

- **production d'artefacts au moment de la compilation** (`scripts/build-native.ts`)
- **génération du manifeste d'addon embarqué** (`scripts/embed-native.ts`)
- **chargement de l'addon à l'exécution + porte de validation** (`src/native.ts`)

## Fichiers d'implémentation

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## Vue d'ensemble du pipeline de compilation

### 1) Points d'entrée de compilation

Scripts de `packages/natives/package.json` :

- `bun scripts/build-native.ts` (`build`) → compilation en mode release
- `bun scripts/build-native.ts --dev` (`dev:native`) → compilation en profil debug/dev (même convention de nommage en sortie)
- `bun scripts/embed-native.ts` (`embed:native`) → génère `src/embedded-addon.ts` à partir des fichiers compilés

### 2) Compilation de l'artefact Rust

`build-native.ts` exécute Cargo dans `crates/pi-natives` :

- commande de base : `cargo build`
- le mode release ajoute `--release` sauf si `--dev` est passé
- la cible cross ajoute `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` déclare `crate-type = ["cdylib"]`, donc Cargo produit une bibliothèque partagée (`.so`/`.dylib`/`.dll`) qui est ensuite copiée/renommée avec un nom de fichier d'addon `.node`.

### 3) Découverte et installation de l'artefact

Après la fin de Cargo, `build-native.ts` parcourt les répertoires de sortie candidats dans l'ordre :

1. `${CARGO_TARGET_DIR}` (si défini)
2. `<repo>/target`
3. `crates/pi-natives/target`

Pour chaque racine, il vérifie les répertoires de profil :

- compilation cross : `<root>/<crossTarget>/<profile>` puis `<root>/<profile>`
- compilation native : `<root>/<profile>`

Puis il recherche l'un des fichiers suivants :

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

Une fois trouvé, il installe de manière atomique dans `packages/natives/native/` avec une sémantique fichier temporaire + renommage (le fallback Windows gère explicitement les échecs de remplacement de DLL verrouillées).

## Modèle de cible/variante et conventions de nommage

## Tag de plateforme

La compilation et l'exécution utilisent le tag de plateforme :

`<platform>-<arch>` (exemple : `darwin-arm64`, `linux-x64`)

## Modèle de variante (x64 uniquement)

x64 supporte des variantes CPU :

- `modern` (chemin compatible AVX2)
- `baseline` (fallback)

Les architectures non-x64 utilisent un artefact unique par défaut (sans suffixe de variante).

### Noms de fichiers en sortie

Compilations release :

- x64 : `pi_natives.<platform>-<arch>-modern.node` ou `...-baseline.node`
- non-x64 : `pi_natives.<platform>-<arch>.node`

Compilation dev (`--dev`) :

- Utilise les flags du profil debug mais conserve le nommage standard avec tag de plateforme

Ordre des candidats du chargeur à l'exécution dans `native.ts` :

- candidats release
- le mode compilé ajoute en tête les candidats extraits/en cache avant les fichiers locaux du package

## Variables d'environnement et options de compilation

## Variables d'exécution

- `PI_DEV` (comportement du chargeur) : active les diagnostics du chargeur
- `PI_NATIVE_VARIANT` (comportement du chargeur, x64 uniquement) : force la sélection `modern` ou `baseline` à l'exécution
- `PI_COMPILED` (comportement du chargeur) : active le comportement de candidat/extraction pour binaire compilé

## Variables/options au moment de la compilation

- `--dev` (argument du script) : compile en profil debug
- `CROSS_TARGET` : passé à Cargo `--target`
- `TARGET_PLATFORM` : remplace le tag de plateforme dans le nommage de sortie
- `TARGET_ARCH` : remplace le nommage d'architecture en sortie
- `TARGET_VARIANT` (x64 uniquement) : force `modern` ou `baseline` pour le nom de fichier en sortie et la politique RUSTFLAGS
- `CARGO_TARGET_DIR` : racine supplémentaire lors de la recherche des sorties Cargo
- `RUSTFLAGS` :
  - si non défini et pas de compilation cross, le script définit :
    - modern : `-C target-cpu=x86-64-v3`
    - baseline : `-C target-cpu=x86-64-v2`
    - non-x64 / pas de variante : `-C target-cpu=native`
  - si déjà défini, le script ne le remplace pas

## Transitions d'état/cycle de vie de la compilation

### Cycle de vie de la compilation (`build-native.ts`)

1. **Init** : analyse des arguments/env (`--dev`, substitutions de cible, flags cross)
2. **Résolution de variante** :
   - non-x64 → pas de variante
   - x64 + `TARGET_VARIANT` → variante explicite
   - x64 compilation cross sans `TARGET_VARIANT` → erreur fatale
   - x64 compilation locale sans substitution → détection AVX2 de l'hôte
3. **Compilation** : exécution de Cargo avec le profil/cible résolu
4. **Localisation de l'artefact** : parcours des racines cibles/répertoires de profil/noms de bibliothèque
5. **Installation** : copie + renommage atomique dans `packages/natives/native`
6. **Terminé** : addon prêt pour les candidats du chargeur

Les sorties en échec se produisent à n'importe quelle étape avec un texte d'erreur explicite (variante invalide, échec de compilation cargo, bibliothèque de sortie manquante, échec d'installation/renommage).

### Cycle de vie de l'embarquement (`embed-native.ts`)

1. **Init** : calcul du tag de plateforme à partir de `TARGET_PLATFORM`/`TARGET_ARCH` ou des valeurs de l'hôte
2. **Ensemble de candidats** :
   - x64 attend les deux fichiers `modern` et `baseline`
   - non-x64 attend un seul fichier par défaut
3. **Validation de disponibilité** dans `packages/natives/native`
4. **Génération du manifeste** (`src/embedded-addon.ts`) avec les imports `file` de Bun et la version du package
5. **Prêt pour l'extraction à l'exécution** en mode compilé

`--reset` contourne la validation et écrit un manifeste stub nul (`embeddedAddon = null`).

## Workflow de développement vs comportement en mode livré/compilé

## Workflow de développement local

Boucle locale typique :

1. Compiler l'addon :
   - release : `bun --cwd=packages/natives run build`
   - profil debug : `bun --cwd=packages/natives run dev:native`
2. Définir `PI_DEV=1` lors des tests de diagnostics du chargeur
3. Le chargeur dans `native.ts` résout les candidats locaux au package dans `native/` (et le fallback du répertoire de l'exécutable)
4. `validateNative` vérifie la compatibilité des exports avant que les wrappers n'utilisent le binding

## Workflow en binaire livré/compilé

En mode compilé (`PI_COMPILED` ou marqueurs embarqués Bun) :

1. Le chargeur calcule un répertoire de cache versionné : `<getNativesDir()>/<packageVersion>` (opérationnellement `~/.xcsh/natives/<version>`)
2. Si le manifeste embarqué correspond à la plateforme+version actuelle, le chargeur peut extraire le fichier embarqué sélectionné dans ce répertoire versionné
3. L'ordre des candidats à l'exécution inclut :
   - le répertoire de cache versionné
   - le répertoire legacy de binaire compilé (`%LOCALAPPDATA%/xcsh` sous Windows, `~/.local/bin` ailleurs)
   - les répertoires du package/exécutable
4. Le premier addon chargé avec succès doit toujours passer `validateNative`

C'est pourquoi le packaging et les attentes du chargeur à l'exécution doivent être alignés : les noms de fichiers, les tags de plateforme et les symboles exportés doivent correspondre à ce que `native.ts` sonde et valide.

## Correspondance API JS ↔ exports Rust (sous-ensemble de la porte de validation)

`native.ts` requiert que ces exports visibles côté JS existent sur l'addon chargé. Ils correspondent aux exports N-API Rust dans `crates/pi-natives/src` :

| Nom JS requis par `validateNative` | Déclaration d'export Rust | Fichier source Rust |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (export en camelCase) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

Si un symbole requis est manquant, le chargeur échoue immédiatement avec une indication de recompilation.

## Comportement en cas d'échec et diagnostics

## Échecs au moment de la compilation

- Configuration de variante invalide :
  - `TARGET_VARIANT` défini sur non-x64 → erreur immédiate
  - compilation cross x64 sans `TARGET_VARIANT` explicite → erreur immédiate
- Échec de compilation Cargo :
  - le script remonte le code de sortie non-zéro et stderr
- Artefact non trouvé :
  - le script affiche chaque répertoire de profil vérifié
- Échec d'installation :
  - message explicite ; Windows inclut une indication de fichier verrouillé

## Échecs du chargeur à l'exécution (`native.ts`)

- Tag de plateforme non supporté :
  - lève une exception avec la liste des plateformes supportées
- Aucun candidat n'a pu être chargé :
  - lève une exception avec la liste complète des erreurs de candidats et des indications de remédiation spécifiques au mode
- Exports manquants :
  - lève une exception avec les noms exacts des symboles manquants et la commande de recompilation
- Problèmes d'extraction embarquée :
  - les erreurs de mkdir/écriture à l'extraction sont enregistrées et incluses dans les diagnostics finaux

## Matrice de dépannage

| Symptôme | Cause probable | Vérification | Correction |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | Binaire `.node` obsolète, nom d'export Rust incohérent, ou mauvais binaire chargé | Exécuter avec `PI_DEV=1` pour voir le chemin chargé ; inspecter la liste des exports de ce fichier | Recompiler avec `build` ; s'assurer que le nom d'export Rust `#[napi]` (ou l'alias explicite si nécessaire) correspond à la clé JS ; supprimer les fichiers obsolètes en cache/versionnés |
| La machine x64 charge baseline alors que modern est attendu | `PI_NATIVE_VARIANT=baseline`, AVX2 non détecté, ou seul le fichier baseline est présent | Vérifier `PI_NATIVE_VARIANT` ; inspecter `native/` pour le fichier `-modern` | Compiler la variante modern (`TARGET_VARIANT=modern ... build`) et s'assurer que le fichier est livré |
| La compilation cross produit un binaire inutilisable/mal étiqueté | Incohérence entre `CROSS_TARGET` et `TARGET_PLATFORM`/`TARGET_ARCH`, ou `TARGET_VARIANT` manquant pour x64 | Confirmer le tuple d'env et le nom de fichier en sortie | Relancer avec des valeurs d'env cohérentes et un `TARGET_VARIANT` x64 explicite |
| Le binaire compilé échoue après mise à jour | Cache extrait obsolète (`~/.xcsh/natives/<ancienne-version-ou-version-incohérente>`) ou incohérence du manifeste embarqué | Inspecter le répertoire natives versionné et la liste d'erreurs du chargeur | Supprimer le cache natives versionné pour la version du package et relancer ; régénérer le manifeste embarqué lors du packaging |
| Le chargeur sonde de nombreux chemins et aucun ne fonctionne | Incohérence de plateforme ou artefact release manquant dans `native/` du package | Vérifier `platformTag` vs le(s) nom(s) de fichier réel(s) | S'assurer que le nom de fichier compilé correspond exactement à la convention `pi_natives.<platform>-<arch>(-variant).node` et que le package inclut `native/` |
| `embed:native` échoue avec "Incomplete native addons" | Les fichiers de variante requis n'ont pas été compilés avant l'embarquement | Vérifier la liste attendue vs trouvée dans le texte d'erreur | Compiler d'abord les fichiers requis (x64 : modern+baseline ; non-x64 : défaut), puis relancer `embed:native` |

## Commandes opérationnelles

```bash
# Artefact release pour l'hôte actuel
bun --cwd=packages/natives run build

# Compilation d'artefact en profil debug
bun --cwd=packages/natives run dev:native

# Compiler les variantes x64 explicites
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# Générer le manifeste d'addon embarqué à partir des fichiers natifs compilés
bun --cwd=packages/natives run embed:native

# Réinitialiser le manifeste embarqué avec un stub nul
bun --cwd=packages/natives run embed:native -- --reset
```
