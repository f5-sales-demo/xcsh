---
title: Runtime du chargeur d'addon natif
description: >-
  N-API addon loader runtime with platform detection, fallback strategies, and
  module resolution.
sidebar:
  order: 3
  label: Chargeur d'addon
i18n:
  sourceHash: 1bcb4f2bbe71
  translator: machine
---

# Runtime du chargeur d'addon natif

Ce document examine en profondeur la couche de chargement/validation des addons dans `@f5xc-salesdemos/pi-natives` : comment `native.ts` décide quel fichier `.node` charger, quand l'extraction de la charge utile embarquée s'exécute, et comment les échecs au démarrage sont signalés.

## Fichiers d'implémentation

- `packages/natives/src/native.ts`
- `packages/natives/src/embedded-addon.ts`
- `packages/natives/src/bindings.ts`
- `packages/natives/package.json`

## Périmètre et responsabilité

Les responsabilités du chargeur/runtime sont intentionnellement restreintes :

- Construire une liste de candidats tenant compte de la plateforme et du CPU pour les noms de fichiers et répertoires des addons.
- Optionnellement matérialiser un addon embarqué dans un répertoire de cache versionné par utilisateur.
- Essayer les candidats dans un ordre déterministe.
- Rejeter les addons obsolètes ou incompatibles via `validateNative` avant d'exposer les bindings.

Hors périmètre ici : le comportement spécifique aux modules grep/text/highlight.

## Entrées du runtime et état dérivé

À l'initialisation du module (`export const native = loadNative();`), `native.ts` calcule le contexte statique :

- **Tag de plateforme** : ``${process.platform}-${process.arch}`` (par exemple `darwin-arm64`).
- **Version du package** : depuis `packages/natives/package.json` (champ `version`).
- **Répertoires principaux** :
  - `nativeDir` : local au package `packages/natives/native`.
  - `execDir` : répertoire contenant `process.execPath`.
  - `versionedDir` : `<getNativesDir()>/<packageVersion>`.
  - Repli `userDataDir` :
    - Windows : `%LOCALAPPDATA%/xcsh` (ou `%USERPROFILE%/AppData/Local/xcsh`).
    - Non-Windows : `~/.local/bin`.
- **Mode binaire compilé** (`isCompiledBinary`) : vrai si l'une des conditions suivantes est remplie :
  - La variable d'environnement `PI_COMPILED` est définie, ou
  - `import.meta.url` contient des marqueurs embarqués Bun (`$bunfs`, `~BUN`, `%7EBUN`).
- **Surcharge de variante** : `PI_NATIVE_VARIANT` (`modern`/`baseline` uniquement ; les valeurs invalides sont ignorées).
- **Variante sélectionnée** : surcharge explicite, sinon détection AVX2 au runtime sur x64 (`modern` si AVX2, sinon `baseline`).

## Support des plateformes et résolution des tags

`SUPPORTED_PLATFORMS` est fixé à :

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

Détail du comportement :

- Les plateformes non supportées ne sont pas rejetées immédiatement.
- Le chargeur essaie d'abord tous les candidats calculés.
- Si rien ne se charge, il lève une erreur explicite de plateforme non supportée listant les tags supportés.

Cela préserve des diagnostics utiles pour les cas presque compatibles tout en échouant de manière ferme pour les cibles véritablement non supportées.

## Sélection de variante (`modern` / `baseline` / défaut)

### Comportement x64

1. Si `PI_NATIVE_VARIANT` est `modern` ou `baseline`, cette valeur prévaut.
2. Sinon, détecter le support AVX2 :
   - Linux : scanner `/proc/cpuinfo` pour `avx2`.
   - macOS : interroger `sysctl` (`machdep.cpu.leaf7_features`, repli sur `machdep.cpu.features`).
   - Windows : exécuter PowerShell `[System.Runtime.Intrinsics.X86.Avx2]::IsSupported`.
3. Résultat :
   - AVX2 disponible -> `modern`
   - AVX2 indisponible/indétectable -> `baseline`

### Comportement non-x64

- Aucune variante n'est utilisée ; le chargeur reste sur le nom de fichier par défaut (`pi_natives.<platform>-<arch>.node`).

### Construction du nom de fichier

Étant donné `tag = <platform>-<arch>` :

- Non-x64 ou pas de variante : `pi_natives.<tag>.node`
- x64 + `modern` : essayer dans l'ordre
  1. `pi_natives.<tag>-modern.node`
  2. `pi_natives.<tag>-baseline.node` (repli intentionnel)
- x64 + `baseline` : uniquement `pi_natives.<tag>-baseline.node`

Le `addonLabel` utilisé dans les messages d'erreur finaux est soit `<tag>` soit `<tag> (<variant>)`.

## Construction des chemins candidats et ordre de repli

`native.ts` construit des pools de candidats avant tout appel `require(...)`.

### Candidats de release

Construits à partir de la liste de noms de fichiers résolus par variante et recherchés dans cet ordre :

- **Runtime non compilé** :
  1. `<nativeDir>/<filename>`
  2. `<execDir>/<filename>`

- **Runtime compilé** (`PI_COMPILED` ou marqueurs embarqués Bun) :
  1. `<versionedDir>/<filename>`
  2. `<userDataDir>/<filename>`
  3. `<nativeDir>/<filename>`
  4. `<execDir>/<filename>`

`dedupedCandidates` supprime les doublons tout en préservant l'ordre de première occurrence.

### Séquence finale au runtime

Au moment du chargement :

1. Le candidat optionnel d'extraction embarquée (s'il a été produit) est inséré en tête.
2. Les candidats dédupliqués restants sont essayés dans l'ordre.
3. Le premier candidat qui réussit à la fois le `require(...)` et passe `validateNative(...)` est retenu.

## Cycle de vie de l'extraction de l'addon embarqué

`embedded-addon.ts` définit une structure de manifeste généré :

- `platformTag`
- `version`
- `files[]` où chaque entrée possède `variant`, `filename`, `filePath`

La valeur par défaut actuellement committée est `embeddedAddon: null` ; les artefacts compilés peuvent remplacer ceci par de véritables métadonnées.

### Machine à états de l'extraction

L'extraction (`maybeExtractEmbeddedAddon`) s'exécute uniquement lorsque toutes les conditions sont remplies :

1. `isCompiledBinary === true`
2. `embeddedAddon !== null`
3. `embeddedAddon.platformTag === platformTag`
4. `embeddedAddon.version === packageVersion`
5. Un fichier embarqué approprié à la variante est trouvé

La sélection du fichier de variante reflète l'intention de variante au runtime :

- Non-x64 : préférer `default`, puis le premier fichier disponible.
- x64 + `modern` : préférer `modern`, repli sur `baseline`.
- x64 + `baseline` : exiger `baseline`.

Comportement de matérialisation :

1. S'assurer que `<versionedDir>` existe (`mkdirSync(..., { recursive: true })`).
2. Si `<versionedDir>/<selected filename>` existe déjà, le réutiliser (pas de réécriture).
3. Sinon, lire le `filePath` source embarqué et écrire le fichier cible.
4. Retourner le chemin cible pour la tentative de chargement de plus haute priorité.

En cas d'échec, l'extraction ne plante pas immédiatement ; elle ajoute une entrée d'erreur (échec de création de répertoire ou d'écriture) et le chargeur passe au sondage normal des candidats.

## Cycle de vie et transitions d'état

```text
Init
  -> Compute platform/version/variant/candidate lists
  -> (Compiled + embedded manifest matches?)
       yes -> Try extract embedded to versionedDir (record errors, continue)
       no  -> Skip extraction
  -> For each runtime candidate in order:
       require(candidate)
       -> success: validateNative
            -> pass: return bindings (READY)
            -> fail: record error, continue
       -> failure: record error, continue
  -> none loaded:
       if unsupported platform tag -> throw Unsupported platform
       else -> throw Failed to load (full tried-path diagnostics + hints)
```

## Vérifications contractuelles de `validateNative`

`validateNative(bindings, source)` applique un contrat exclusivement basé sur les fonctions sur `NativeBindings` au démarrage.

Mécanisme :

- Pour chaque nom d'export requis, il vérifie `typeof bindings[name] === "function"`.
- Les noms manquants sont agrégés.
- Si certains sont manquants, le chargeur lève une erreur contenant :
  - le chemin de l'addon source,
  - la liste des exports manquants,
  - une indication de commande de reconstruction.

Il s'agit d'une barrière de compatibilité stricte contre les binaires obsolètes, les builds partiels et la dérive de symboles/noms.

### Correspondance API JS ↔ exports natifs (barrière de validation)

| Nom du binding JS vérifié dans `validateNative` | Nom d'export natif attendu |
| --- | --- |
| `grep` | `grep` |
| `glob` | `glob` |
| `highlightCode` | `highlightCode` |
| `executeShell` | `executeShell` |
| `PtySession` | `PtySession` |
| `Shell` | `Shell` |
| `visibleWidth` | `visibleWidth` |
| `getSystemInfo` | `getSystemInfo` |
| `getWorkProfile` | `getWorkProfile` |
| `invalidateFsScanCache` | `invalidateFsScanCache` |

Note : `bindings.ts` déclare uniquement le membre de base `cancelWork(id)` ; les fichiers `types.ts` des modules effectuent une fusion de déclarations pour les symboles supplémentaires que `validateNative` impose.

## Comportement en cas d'échec et diagnostics

## Plateforme non supportée

Si tous les candidats échouent et que `platformTag` n'est pas dans `SUPPORTED_PLATFORMS`, le chargeur lève :

- `Unsupported platform: <tag>`
- La liste complète des plateformes supportées
- Des indications explicites pour signaler un problème

## Symptômes de binaire obsolète / incompatible

Signal typique d'incompatibilité obsolète :

- `Native addon missing exports (<candidate>). Missing: ...`

Causes courantes :

- Ancien binaire `.node` provenant d'une version précédente du package/de la forme de l'API.
- Mauvais artefact de variante sélectionné (pour x64).
- Nouvel export Rust absent de l'artefact chargé.

Comportement du chargeur :

- Enregistre les échecs d'exports manquants par candidat.
- Continue le sondage des candidats restants.
- Si aucun candidat n'est validé, l'erreur finale inclut chaque chemin tenté avec chaque message d'échec.

## Échecs de démarrage en mode binaire compilé

En mode compilé, les diagnostics finaux incluent :

- les chemins cibles attendus du cache versionné (`<versionedDir>/<filename>`),
- une remédiation consistant à supprimer le `<versionedDir>` obsolète et relancer,
- des commandes `curl` de téléchargement direct de la release pour chaque nom de fichier attendu.

## Échecs de démarrage en mode non compilé

En mode package/runtime normal, les diagnostics finaux incluent :

- une indication de réinstallation (`bun install @f5xc-salesdemos/pi-natives`),
- une commande de reconstruction locale (`bun --cwd=packages/natives run build`),
- une indication optionnelle de build de variante x64 (`TARGET_VARIANT=baseline|modern ...`).

## Comportement au runtime

- Le chargeur utilise toujours la chaîne de candidats de release.
- Définir `PI_DEV` active uniquement les diagnostics par candidat dans la console (`Loaded native addon...` et les erreurs de chargement).
