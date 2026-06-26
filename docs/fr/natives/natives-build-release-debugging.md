---
title: 'Manuel d''exploitation — Compilation, publication et débogage des natifs'
description: >-
  Manuel de compilation, publication et débogage pour le module natif Rust sur
  toutes les plateformes.
sidebar:
  order: 8
  label: 'Compilation, publication et débogage'
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# Manuel d'exploitation — Compilation, publication et débogage des natifs

Ce manuel décrit comment le pipeline de compilation de `@f5-sales-demo/pi-natives` produit des modules `.node`, comment les distributions compilées les chargent, et comment déboguer les échecs de chargeur ou de compilation.

Il suit les termes architecturaux définis dans `docs/natives-architecture.md` :

- **production d'artefacts à la compilation** (`scripts/build-native.ts`)
- **génération du manifeste de module embarqué** (`scripts/embed-native.ts`)
- **chargement du module au moment de l'exécution + validation** (`src/native.ts`)

## Fichiers d'implémentation

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## Vue d'ensemble du pipeline de compilation

### 1) Points d'entrée de la compilation

Scripts de `packages/natives/package.json` :

- `bun scripts/build-native.ts` (`build`) → compilation en mode release
- `bun scripts/build-native.ts --dev` (`dev:native`) → compilation en profil debug/dev (même nommage de sortie)
- `bun scripts/embed-native.ts` (`embed:native`) → génération de `src/embedded-addon.ts` à partir des fichiers compilés

### 2) Compilation de l'artefact Rust

`build-native.ts` exécute Cargo dans `crates/pi-natives` :

- commande de base : `cargo build`
- le mode release ajoute `--release` sauf si `--dev` est passé
- la cible croisée ajoute `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` déclare `crate-type = ["cdylib"]`, ce qui pousse Cargo à émettre une bibliothèque partagée (`.so`/`.dylib`/`.dll`) qui est ensuite copiée et renommée en un nom de fichier de module `.node`.

### 3) Découverte et installation des artefacts

Après l'achèvement de Cargo, `build-native.ts` analyse les répertoires de sortie candidats dans cet ordre :

1. `${CARGO_TARGET_DIR}` (si défini)
2. `<repo>/target`
3. `crates/pi-natives/target`

Pour chaque racine, il vérifie les répertoires de profil :

- compilation croisée : `<root>/<crossTarget>/<profile>` puis `<root>/<profile>`
- compilation native : `<root>/<profile>`

Ensuite, il recherche l'un des fichiers suivants :

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

Une fois trouvé, il est installé de manière atomique dans `packages/natives/native/` avec des sémantiques de fichier temporaire + renommage (le repli Windows gère explicitement les échecs de remplacement de DLL verrouillée).

## Modèle de cible/variante et conventions de nommage

## Tag de plateforme

La compilation et l'exécution utilisent toutes deux un tag de plateforme :

`<platform>-<arch>` (exemples : `darwin-arm64`, `linux-x64`)

## Modèle de variante (x64 uniquement)

x64 prend en charge les variantes CPU :

- `modern` (chemin compatible AVX2)
- `baseline` (repli)

Les architectures non-x64 utilisent un seul artefact par défaut (sans suffixe de variante).

### Noms de fichiers de sortie

Compilations release :

- x64 : `pi_natives.<platform>-<arch>-modern.node` ou `...-baseline.node`
- non-x64 : `pi_natives.<platform>-<arch>.node`

Compilation dev (`--dev`) :

- Utilise les indicateurs de profil debug mais conserve le nommage de sortie standard avec tag de plateforme

Ordre des candidats du chargeur au moment de l'exécution dans `native.ts` :

- candidats release
- le mode compilé fait précéder les candidats extraits/mis en cache avant les fichiers locaux au paquet

## Indicateurs d'environnement et options de compilation

## Indicateurs d'exécution

- `PI_DEV` (comportement du chargeur) : activer les diagnostics du chargeur
- `PI_NATIVE_VARIANT` (comportement du chargeur, x64 uniquement) : forcer la sélection de `modern` ou `baseline` au moment de l'exécution
- `PI_COMPILED` (comportement du chargeur) : activer le comportement candidat/extraction pour les binaires compilés

## Indicateurs/options de compilation

- `--dev` (argument du script) : compiler le profil debug
- `CROSS_TARGET` : passé à Cargo `--target`
- `TARGET_PLATFORM` : remplacer le nommage du tag de plateforme en sortie
- `TARGET_ARCH` : remplacer le nommage de l'architecture en sortie
- `TARGET_VARIANT` (x64 uniquement) : forcer `modern` ou `baseline` pour le nom de fichier de sortie et la politique RUSTFLAGS
- `CARGO_TARGET_DIR` : racine supplémentaire lors de la recherche des sorties Cargo
- `RUSTFLAGS` :
  - si non défini et sans compilation croisée, le script définit :
    - modern : `-C target-cpu=x86-64-v3`
    - baseline : `-C target-cpu=x86-64-v2`
    - non-x64 / sans variante : `-C target-cpu=native`
  - si déjà défini, le script ne remplace pas la valeur

## Transitions d'état/cycle de vie de la compilation

### Cycle de vie de la compilation (`build-native.ts`)

1. **Initialisation** : analyse des arguments/variables d'environnement (`--dev`, remplacements de cible, indicateurs croisés)
2. **Résolution de la variante** :
   - non-x64 → pas de variante
   - x64 + `TARGET_VARIANT` → variante explicite
   - compilation croisée x64 sans `TARGET_VARIANT` → erreur bloquante
   - compilation locale x64 sans remplacement → détection AVX2 sur l'hôte
3. **Compilation** : exécution de Cargo avec le profil/la cible résolus
4. **Localisation de l'artefact** : analyse des racines cibles, des répertoires de profil et des noms de bibliothèque
5. **Installation** : copie + renommage atomique dans `packages/natives/native`
6. **Achèvement** : module prêt pour les candidats du chargeur

Des échecs avec sortie se produisent à n'importe quelle étape avec un message d'erreur explicite (variante invalide, échec de la compilation Cargo, bibliothèque de sortie manquante, échec d'installation/renommage).

### Cycle de vie d'intégration (`embed-native.ts`)

1. **Initialisation** : calcul du tag de plateforme à partir de `TARGET_PLATFORM`/`TARGET_ARCH` ou des valeurs de l'hôte
2. **Ensemble de candidats** :
   - x64 attend à la fois `modern` et `baseline`
   - non-x64 attend un seul fichier par défaut
3. **Validation de la disponibilité** dans `packages/natives/native`
4. **Génération du manifeste** (`src/embedded-addon.ts`) avec les imports de `file` Bun et la version du paquet
5. **Extraction au moment de l'exécution prête** pour le mode compilé

`--reset` contourne la validation et écrit un stub de manifeste null (`embeddedAddon = null`).

## Flux de travail de développement local vs comportement en production/compilé

## Flux de travail de développement local

Boucle locale typique :

1. Compiler le module :
   - release : `bun --cwd=packages/natives run build`
   - profil debug : `bun --cwd=packages/natives run dev:native`
2. Définir `PI_DEV=1` lors du test des diagnostics du chargeur
3. Le chargeur dans `native.ts` résout les candidats locaux au paquet `native/` (et le repli par répertoire d'exécutable)
4. `validateNative` applique la compatibilité des exports avant que les enveloppes n'utilisent le binding

## Flux de travail binaire en production/compilé

En mode compilé (`PI_COMPILED` ou marqueurs embarqués Bun) :

1. Le chargeur calcule le répertoire de cache versionné : `<getNativesDir()>/<packageVersion>` (en pratique `~/.xcsh/natives/<version>`)
2. Si le manifeste embarqué correspond à la plateforme+version actuelle, le chargeur peut extraire le fichier embarqué sélectionné dans ce répertoire versionné
3. L'ordre des candidats au moment de l'exécution comprend :
   - le répertoire de cache versionné
   - le répertoire du binaire compilé hérité (`%LOCALAPPDATA%/xcsh` sous Windows, `~/.local/bin` ailleurs)
   - les répertoires du paquet/exécutable
4. Le premier module chargé avec succès doit toujours passer `validateNative`

C'est pourquoi le packaging et les attentes du chargeur au moment de l'exécution doivent être alignés : les noms de fichiers, les tags de plateforme et les symboles exportés doivent correspondre à ce que `native.ts` sonde et valide.

## Correspondance API JS ↔ export Rust (sous-ensemble de la validation)

`native.ts` exige que ces exports visibles en JS existent sur le module chargé. Ils correspondent aux exports Rust N-API dans `crates/pi-natives/src` :

| Nom JS requis par `validateNative` | Déclaration d'export Rust | Fichier source Rust |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (export en camelCase) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

Si un symbole requis est manquant, le chargeur échoue rapidement avec une indication de recompilation.

## Comportement en cas d'échec et diagnostics

## Échecs à la compilation

- Configuration de variante invalide :
  - `TARGET_VARIANT` défini sur non-x64 → erreur immédiate
  - compilation croisée x64 sans `TARGET_VARIANT` explicite → erreur immédiate
- Échec de la compilation Cargo :
  - le script signale le code de sortie non nul et la sortie d'erreur standard
- Artefact non trouvé :
  - le script affiche chaque répertoire de profil vérifié
- Échec d'installation :
  - message explicite ; Windows inclut une indication de fichier verrouillé

## Échecs du chargeur au moment de l'exécution (`native.ts`)

- Tag de plateforme non pris en charge :
  - lève une exception avec la liste des plateformes prises en charge
- Aucun candidat n'a pu être chargé :
  - lève une exception avec la liste complète des erreurs des candidats et des indications de remédiation spécifiques au mode
- Exports manquants :
  - lève une exception avec les noms exacts des symboles manquants et la commande de recompilation
- Problèmes d'extraction embarquée :
  - les erreurs de création de répertoire/écriture lors de l'extraction sont enregistrées et incluses dans les diagnostics finaux

## Matrice de dépannage

| Symptôme | Cause probable | Vérification | Correction |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | Binaire `.node` obsolète, incompatibilité de nom d'export Rust, ou chargement du mauvais binaire | Exécuter avec `PI_DEV=1` pour voir le chemin chargé ; inspecter la liste des exports de ce fichier | Recompiler avec `build` ; vérifier que le nom de l'export Rust `#[napi]` (ou l'alias explicite si nécessaire) correspond à la clé JS ; supprimer les fichiers en cache/versionnés obsolètes |
| Une machine x64 charge baseline alors que modern est attendu | `PI_NATIVE_VARIANT=baseline`, AVX2 non détecté, ou seul le fichier baseline est présent | Vérifier `PI_NATIVE_VARIANT` ; inspecter `native/` pour le fichier `-modern` | Compiler la variante modern (`TARGET_VARIANT=modern ... build`) et s'assurer que le fichier est distribué |
| La compilation croisée produit un binaire inutilisable ou mal étiqueté | Incompatibilité entre `CROSS_TARGET` et `TARGET_PLATFORM`/`TARGET_ARCH`, ou `TARGET_VARIANT` manquant pour x64 | Confirmer le tuple d'environnement et le nom du fichier de sortie | Relancer avec des valeurs d'environnement cohérentes et un `TARGET_VARIANT` x64 explicite |
| Le binaire compilé échoue après une mise à niveau | Cache extrait obsolète (`~/.xcsh/natives/<ancienne-version-ou-version-incompatible>`) ou incompatibilité du manifeste embarqué | Inspecter le répertoire des natifs versionné et la liste des erreurs du chargeur | Supprimer le cache des natifs versionné pour la version du paquet concernée et relancer ; regénérer le manifeste embarqué lors du packaging |
| Le chargeur sonde de nombreux chemins sans succès | Incompatibilité de plateforme ou artefact release manquant dans `native/` du paquet | Vérifier `platformTag` par rapport au(x) nom(s) de fichier(s) réel(s) | S'assurer que le nom du fichier compilé correspond exactement à la convention `pi_natives.<platform>-<arch>(-variant).node` et que le paquet inclut `native/` |
| `embed:native` échoue avec « Incomplete native addons » | Les fichiers de variante requis n'ont pas été compilés avant l'intégration | Vérifier la liste des fichiers attendus vs trouvés dans le texte d'erreur | Compiler d'abord les fichiers requis (x64 : à la fois modern+baseline ; non-x64 : défaut), puis relancer `embed:native` |

## Commandes opérationnelles

```bash
# Artefact release pour l'hôte actuel
bun --cwd=packages/natives run build

# Compilation d'artefact en profil debug
bun --cwd=packages/natives run dev:native

# Compilation des variantes x64 explicites
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# Génération du manifeste de module embarqué à partir des fichiers natifs compilés
bun --cwd=packages/natives run embed:native

# Réinitialisation du manifeste embarqué en stub null
bun --cwd=packages/natives run embed:native -- --reset
```
