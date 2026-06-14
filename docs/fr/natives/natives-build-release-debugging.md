---
title: 'Manuel d''exécution — Build, release et débogage des natifs'
description: >-
  Manuel de build, release et débogage pour l'addon natif Rust sur toutes les
  plateformes.
sidebar:
  order: 8
  label: 'Build, release & débogage'
i18n:
  sourceHash: 35e5eb6a16f0
  translator: machine
---

# Manuel d'exécution — Build, Release et Débogage des natifs

Ce manuel décrit comment le pipeline de build `@f5xc-salesdemos/pi-natives` produit des addons `.node`, comment les distributions compilées les chargent, et comment déboguer les échecs de chargement ou de build.

Il suit la terminologie architecturale définie dans `docs/natives-architecture.md` :

- **production d'artefacts au moment du build** (`scripts/build-native.ts`)
- **génération du manifeste d'addon embarqué** (`scripts/embed-native.ts`)
- **chargement de l'addon à l'exécution + validation** (`src/native.ts`)

## Fichiers d'implémentation

- `packages/natives/scripts/build-native.ts`
- `packages/natives/scripts/embed-native.ts`
- `packages/natives/package.json`
- `packages/natives/src/native.ts`
- `crates/pi-natives/Cargo.toml`

## Vue d'ensemble du pipeline de build

### 1) Points d'entrée du build

Scripts de `packages/natives/package.json` :

- `bun scripts/build-native.ts` (`build`) → build en mode release
- `bun scripts/build-native.ts --dev` (`dev:native`) → build avec profil debug/dev (même nommage de sortie)
- `bun scripts/embed-native.ts` (`embed:native`) → génère `src/embedded-addon.ts` à partir des fichiers construits

### 2) Build de l'artefact Rust

`build-native.ts` exécute Cargo dans `crates/pi-natives` :

- commande de base : `cargo build`
- le mode release ajoute `--release` sauf si `--dev` est passé
- la cible croisée ajoute `--target <CROSS_TARGET>`

`crates/pi-natives/Cargo.toml` déclare `crate-type = ["cdylib"]`, ce qui amène Cargo à émettre une bibliothèque partagée (`.so`/`.dylib`/`.dll`) qui est ensuite copiée/renommée en nom de fichier d'addon `.node`.

### 3) Découverte et installation de l'artefact

Une fois Cargo terminé, `build-native.ts` analyse les répertoires de sortie candidats dans l'ordre suivant :

1. `${CARGO_TARGET_DIR}` (si défini)
2. `<repo>/target`
3. `crates/pi-natives/target`

Pour chaque racine, il vérifie les répertoires de profil :

- build croisé : `<root>/<crossTarget>/<profile>` puis `<root>/<profile>`
- build natif : `<root>/<profile>`

Puis il recherche l'un des éléments suivants :

- `libpi_natives.so`
- `libpi_natives.dylib`
- `pi_natives.dll`
- `libpi_natives.dll`

Lorsqu'il est trouvé, il est installé de façon atomique dans `packages/natives/native/` avec la sémantique fichier temporaire + renommage (le repli Windows gère explicitement les échecs de remplacement de DLL verrouillée).

## Modèle de cible/variante et conventions de nommage

## Tag de plateforme

Le build et l'exécution utilisent tous deux le tag de plateforme :

`<platform>-<arch>` (exemple : `darwin-arm64`, `linux-x64`)

## Modèle de variante (x64 uniquement)

x64 prend en charge des variantes CPU :

- `modern` (chemin compatible AVX2)
- `baseline` (repli)

Les architectures non-x64 utilisent un seul artefact par défaut (sans suffixe de variante).

### Noms de fichiers de sortie

Builds release :

- x64 : `pi_natives.<platform>-<arch>-modern.node` ou `...-baseline.node`
- non-x64 : `pi_natives.<platform>-<arch>.node`

Build dev (`--dev`) :

- Utilise les options du profil debug mais conserve le nommage de sortie standard avec tag de plateforme

Ordre des candidats du chargeur d'exécution dans `native.ts` :

- candidats release
- le mode compilé place les candidats extraits/en cache avant les fichiers locaux au paquet

## Options et indicateurs d'environnement

## Indicateurs d'exécution

- `PI_DEV` (comportement du chargeur) : activer les diagnostics du chargeur
- `PI_NATIVE_VARIANT` (comportement du chargeur, x64 uniquement) : forcer la sélection de `modern` ou `baseline` à l'exécution
- `PI_COMPILED` (comportement du chargeur) : activer le comportement de candidat/extraction en mode binaire compilé

## Options/indicateurs au moment du build

- `--dev` (argument de script) : build avec profil debug
- `CROSS_TARGET` : transmis à Cargo via `--target`
- `TARGET_PLATFORM` : remplacer le nommage du tag de plateforme en sortie
- `TARGET_ARCH` : remplacer le nommage de l'architecture en sortie
- `TARGET_VARIANT` (x64 uniquement) : forcer `modern` ou `baseline` pour le nom du fichier de sortie et la politique RUSTFLAGS
- `CARGO_TARGET_DIR` : racine supplémentaire lors de la recherche des sorties Cargo
- `RUSTFLAGS` :
  - si non défini et sans compilation croisée, le script définit :
    - modern : `-C target-cpu=x86-64-v3`
    - baseline : `-C target-cpu=x86-64-v2`
    - non-x64 / sans variante : `-C target-cpu=native`
  - si déjà défini, le script ne le remplace pas

## Transitions d'état/cycle de vie du build

### Cycle de vie du build (`build-native.ts`)

1. **Init** : analyser les arguments/l'environnement (`--dev`, remplacements de cible, indicateurs croisés)
2. **Résolution de la variante** :
   - non-x64 → aucune variante
   - x64 + `TARGET_VARIANT` → variante explicite
   - build croisé x64 sans `TARGET_VARIANT` → erreur bloquante
   - build local x64 sans remplacement → détection de l'AVX2 hôte
3. **Compilation** : exécuter Cargo avec le profil/la cible résolus
4. **Localisation de l'artefact** : analyser les racines cibles/répertoires de profil/noms de bibliothèques
5. **Installation** : copie + renommage atomique dans `packages/natives/native`
6. **Terminé** : addon de sortie prêt pour les candidats du chargeur

Les sorties en échec surviennent à n'importe quelle étape avec un texte d'erreur explicite (variante invalide, échec de build cargo, bibliothèque de sortie manquante, échec d'installation/renommage).

### Cycle de vie de l'embed (`embed-native.ts`)

1. **Init** : calculer le tag de plateforme à partir de `TARGET_PLATFORM`/`TARGET_ARCH` ou des valeurs hôtes
2. **Ensemble de candidats** :
   - x64 attend à la fois `modern` et `baseline`
   - non-x64 attend un seul fichier par défaut
3. **Validation de la disponibilité** dans `packages/natives/native`
4. **Génération du manifeste** (`src/embedded-addon.ts`) avec les imports `file` de Bun et la version du paquet
5. **Extraction à l'exécution prête** pour le mode compilé

`--reset` contourne la validation et écrit un stub de manifeste nul (`embeddedAddon = null`).

## Flux de développement local vs comportement compilé/livré

## Flux de développement local

Boucle locale typique :

1. Construire l'addon :
   - release : `bun --cwd=packages/natives run build`
   - profil debug : `bun --cwd=packages/natives run dev:native`
2. Définir `PI_DEV=1` lors des tests de diagnostics du chargeur
3. Le chargeur dans `native.ts` résout les candidats locaux au paquet `native/` (et le repli par répertoire exécutable)
4. `validateNative` impose la compatibilité des exports avant que les enveloppes utilisent la liaison

## Flux de binaire compilé/livré

En mode compilé (`PI_COMPILED` ou marqueurs embarqués Bun) :

1. Le chargeur calcule le répertoire de cache versionné : `<getNativesDir()>/<packageVersion>` (opérationnellement `~/.xcsh/natives/<version>`)
2. Si le manifeste embarqué correspond à la plateforme+version actuelle, le chargeur peut extraire le fichier embarqué sélectionné dans ce répertoire versionné
3. L'ordre des candidats à l'exécution comprend :
   - le répertoire de cache versionné
   - le répertoire de binaire compilé hérité (`%LOCALAPPDATA%/xcsh` sous Windows, `~/.local/bin` ailleurs)
   - les répertoires de paquet/exécutable
4. Le premier addon chargé avec succès doit tout de même passer `validateNative`

C'est pourquoi les attentes du paquet et du chargeur d'exécution doivent être alignées : les noms de fichiers, les tags de plateforme et les symboles exportés doivent correspondre à ce que `native.ts` sonde et valide.

## Correspondance API JS ↔ export Rust (sous-ensemble de la validation)

`native.ts` exige que ces exports visibles en JS existent sur l'addon chargé. Ils correspondent aux exports N-API Rust dans `crates/pi-natives/src` :

| Nom JS requis par `validateNative` | Déclaration d'export Rust | Fichier source Rust |
| --- | --- | --- |
| `glob` | `#[napi] pub fn glob(...)` | `crates/pi-natives/src/glob.rs` |
| `grep` | `#[napi] pub fn grep(...)` | `crates/pi-natives/src/grep.rs` |
| `search` | `#[napi] pub fn search(...)` | `crates/pi-natives/src/grep.rs` |
| `highlightCode` | `#[napi] pub fn highlight_code(...)` | `crates/pi-natives/src/highlight.rs` |
| `getSystemInfo` | `#[napi] pub fn get_system_info(...)` | `crates/pi-natives/src/system_info.rs` |
| `getWorkProfile` | `#[napi] pub fn get_work_profile(...)` (export en camelCase) | `crates/pi-natives/src/prof.rs` |
| `invalidateFsScanCache` | `#[napi] pub fn invalidate_fs_scan_cache(...)` | `crates/pi-natives/src/fs_cache.rs` |

Si un symbole requis est manquant, le chargeur échoue immédiatement avec une indication de rebuild.

## Comportement en cas d'échec et diagnostics

## Échecs au moment du build

- Configuration de variante invalide :
  - `TARGET_VARIANT` défini sur une architecture non-x64 → erreur immédiate
  - build croisé x64 sans `TARGET_VARIANT` explicite → erreur immédiate
- Échec du build Cargo :
  - le script expose la sortie non nulle et la stderr
- Artefact introuvable :
  - le script affiche chaque répertoire de profil vérifié
- Échec d'installation :
  - message explicite ; Windows inclut une indication de fichier verrouillé

## Échecs du chargeur à l'exécution (`native.ts`)

- Tag de plateforme non pris en charge :
  - lève une exception avec la liste des plateformes prises en charge
- Aucun candidat n'a pu être chargé :
  - lève une exception avec la liste complète des erreurs de candidats et des indications de remédiation spécifiques au mode
- Exports manquants :
  - lève une exception avec les noms de symboles manquants exacts et la commande de rebuild
- Problèmes d'extraction embarquée :
  - les erreurs de mkdir/écriture lors de l'extraction sont enregistrées et incluses dans les diagnostics finaux

## Matrice de dépannage

| Symptôme | Cause probable | Vérification | Correction |
| --- | --- | --- | --- |
| `Native addon missing exports ... Missing: <name>` | Binaire `.node` périmé, incohérence du nom d'export Rust, ou mauvais binaire chargé | Exécuter avec `PI_DEV=1` pour voir le chemin chargé ; inspecter la liste d'exports de ce fichier | Rebuilder avec `build` ; s'assurer que le nom d'export Rust `#[napi]` (ou l'alias explicite si nécessaire) correspond à la clé JS ; supprimer les fichiers en cache/versionnés périmés |
| La machine x64 charge baseline alors que modern est attendu | `PI_NATIVE_VARIANT=baseline`, AVX2 non détecté, ou seul le fichier baseline est présent | Vérifier `PI_NATIVE_VARIANT` ; inspecter `native/` pour le fichier `-modern` | Construire la variante modern (`TARGET_VARIANT=modern ... build`) et s'assurer que le fichier est livré |
| Le build croisé produit un binaire inutilisable ou mal étiqueté | Incohérence entre `CROSS_TARGET` et `TARGET_PLATFORM`/`TARGET_ARCH`, ou `TARGET_VARIANT` manquant pour x64 | Vérifier le tuple d'environnement et le nom du fichier de sortie | Relancer avec des valeurs d'environnement cohérentes et un `TARGET_VARIANT` x64 explicite |
| Le binaire compilé échoue après une mise à jour | Cache extrait périmé (`~/.xcsh/natives/<version-ancienne-ou-incorrecte>`) ou incohérence du manifeste embarqué | Inspecter le répertoire natifs versionné et la liste d'erreurs du chargeur | Supprimer le cache natifs versionné pour la version du paquet et relancer ; régénérer le manifeste embarqué lors du packaging |
| Le chargeur sonde de nombreux chemins et aucun ne fonctionne | Incohérence de plateforme ou artefact release manquant dans `native/` du paquet | Vérifier `platformTag` par rapport aux noms de fichiers réels | S'assurer que le nom du fichier construit correspond exactement à la convention `pi_natives.<platform>-<arch>(-variant).node` et que le paquet inclut `native/` |
| `embed:native` échoue avec « Incomplete native addons » | Les fichiers de variante requis n'ont pas été construits avant l'embedding | Vérifier la liste attendu vs trouvé dans le texte d'erreur | Construire d'abord les fichiers requis (x64 : modern+baseline ; non-x64 : défaut), puis relancer `embed:native` |

## Commandes opérationnelles

```bash
# Artefact release pour l'hôte actuel
bun --cwd=packages/natives run build

# Build d'artefact avec profil debug
bun --cwd=packages/natives run dev:native

# Construire les variantes x64 explicites
TARGET_VARIANT=modern bun --cwd=packages/natives run build
TARGET_VARIANT=baseline bun --cwd=packages/natives run build

# Générer le manifeste d'addon embarqué à partir des fichiers natifs construits
bun --cwd=packages/natives run embed:native

# Réinitialiser le manifeste embarqué à un stub nul
bun --cwd=packages/natives run embed:native -- --reset
```
