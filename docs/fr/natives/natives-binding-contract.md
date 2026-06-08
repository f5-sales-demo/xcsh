---
title: Contrat de liaison natif (côté TypeScript)
description: >-
  Contrat de liaison côté TypeScript pour l'appel des fonctions natives Rust via
  N-API.
sidebar:
  order: 2
  label: Contrat de liaison
i18n:
  sourceHash: f5b74267cdd5
  translator: machine
---

# Contrat de liaison natif (côté TypeScript)

Ce document définit le contrat côté TypeScript qui se situe entre les appelants de `@f5xc-salesdemos/pi-natives` et l'addon N-API chargé.

Il se concentre sur trois éléments :

1. la forme du contrat (`NativeBindings` + augmentation de module),
2. le comportement des wrappers (`src/<module>/index.ts`),
3. la surface d'export publique (`src/index.ts`).

## Fichiers d'implémentation

- `packages/natives/src/bindings.ts`
- `packages/natives/src/native.ts`
- `packages/natives/src/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/grep/index.ts`
- `packages/natives/src/highlight/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/system-info/types.ts`
- `packages/natives/src/system-info/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/work/types.ts`
- `packages/natives/src/work/index.ts`

## Modèle de contrat

`packages/natives/src/bindings.ts` définit le contrat de base :

- `NativeBindings` (interface de base, inclut actuellement `cancelWork(id: number): void`)
- `Cancellable` (`timeoutMs?: number`, `signal?: AbortSignal`)
- `TsFunc<T>` forme de callback utilisée par les callbacks threadsafe N-API

Chaque module ajoute ses propres champs par fusion de déclarations :

```ts
// packages/natives/src/<module>/types.ts
declare module "../bindings" {
 interface NativeBindings {
  grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
 }
}
```

Cela maintient une interface de liaison agrégée unique sans fichier de types central monolithique.

## Cycle de vie de la fusion de déclarations et transitions d'état

### 1) Assemblage des types à la compilation

- `bindings.ts` fournit le symbole `NativeBindings` de base.
- Chaque `src/<module>/types.ts` augmente `NativeBindings`.
- `src/native.ts` importe tous les fichiers `./<module>/types` pour leurs effets de bord afin que le contrat fusionné soit dans la portée où `NativeBindings` est utilisé.

Transition d'état : **Contrat de base** → **Contrat fusionné**.

### 2) Chargement de l'addon à l'exécution et porte de validation

- `src/native.ts` charge les binaires `.node` candidats.
- L'objet chargé est traité comme `NativeBindings` et immédiatement passé à travers `validateNative(...)`.
- `validateNative` vérifie les clés d'export requises via `typeof bindings[name] === "function"`.

Transition d'état : **Objet addon non fiable** → **Objet de liaison natif validé** (ou échec définitif).

### 3) Invocation des wrappers

- Les wrappers de module dans `src/<module>/index.ts` appellent `native.<export>`.
- Les wrappers adaptent les valeurs par défaut et la forme des callbacks (`(err, value)` vers des patterns de callback à valeur uniquement dans les API JS).
- `src/index.ts` ré-exporte les wrappers/types de module comme API publique du package.

Transition d'état : **Liaisons brutes validées** → **API publique ergonomique**.

## Responsabilités des wrappers

Les wrappers sont intentionnellement minces ; ils ne ré-implémentent pas la logique native.

Responsabilités principales :

- **Normalisation/valeurs par défaut des arguments**
  - `glob()` résout `options.path` en chemin absolu et définit les valeurs par défaut pour `hidden`, `gitignore`, `recursive`.
  - `hasMatch()` remplit les drapeaux par défaut (`ignoreCase`, `multiline`) avant l'appel natif.
- **Adaptation des callbacks**
  - `grep()`, `glob()`, `executeShell()` convertissent `TsFunc<T>` (`error, value`) en callback utilisateur recevant uniquement les valeurs réussies.
- **Comportement d'environnement ou de politique autour des appels natifs**
  - Le wrapper du presse-papiers ajoute la gestion OSC52/Termux/headless et traite la copie comme un effort au mieux.
- **Nommage public et curation des ré-exports**
  - `searchContent()` correspond à l'export natif `search`.

## Organisation de la surface d'export publique

`packages/natives/src/index.ts` est le barrel public canonique. Il regroupe les exports par domaine de capacité :

- Recherche/texte : `grep`, `glob`, `text`, `highlight`
- Exécution/processus/terminal : `shell`, `pty`, `ps`, `keys`
- Système/média/conversion : `image`, `html`, `clipboard`, `system-info`, `work`

Règle pour les mainteneurs : si un wrapper n'est pas ré-exporté depuis `src/index.ts`, il ne fait pas partie de la surface publique prévue du package.

## Correspondance API JS ↔ export natif (représentatif)

Le côté Rust utilise des noms d'export N-API (typiquement issus de la conversion `#[napi]` snake_case -> camelCase, avec des alias explicites occasionnels) qui doivent correspondre à ces clés de liaison.

| Catégorie | API JS publique (wrapper) | Clé de liaison native | Type de retour | Async ? |
|---|---|---|---|---|
| Grep | `grep(options, onMatch?)` | `grep` | `Promise<GrepResult>` | Oui |
| Grep | `searchContent(content, options)` | `search` | `SearchResult` | Non |
| Grep | `hasMatch(content, pattern, opts?)` | `hasMatch` | `boolean` | Non |
| Grep | `fuzzyFind(options)` | `fuzzyFind` | `Promise<FuzzyFindResult>` | Oui |
| Glob | `glob(options, onMatch?)` | `glob` | `Promise<GlobResult>` | Oui |
| Glob | `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `void` | Non |
| Shell | `executeShell(options, onChunk?)` | `executeShell` | `Promise<ShellExecuteResult>` | Oui |
| Shell | `Shell` | `Shell` | constructeur de classe | N/A |
| PTY | `PtySession` | `PtySession` | constructeur de classe | N/A |
| Text | `truncateToWidth(...)` | `truncateToWidth` | `string` | Non |
| Text | `sliceWithWidth(...)` | `sliceWithWidth` | `SliceWithWidthResult` | Non |
| Text | `visibleWidth(text)` | `visibleWidth` | `number` | Non |
| Highlight | `highlightCode(code, lang, colors)` | `highlightCode` | `string` | Non |
| HTML | `htmlToMarkdown(html, options?)` | `htmlToMarkdown` | `Promise<string>` | Oui |
| System | `getSystemInfo()` | `getSystemInfo` | `SystemInfo` | Non |
| Work | `getWorkProfile(lastSeconds)` | `getWorkProfile` | `WorkProfile` | Non |
| Process | `killTree(pid, signal)` | `killTree` | `number` | Non |
| Process | `listDescendants(pid)` | `listDescendants` | `number[]` | Non |
| Clipboard | `copyToClipboard(text)` | `copyToClipboard` | `Promise<void>` (comportement wrapper au mieux) | Oui |
| Clipboard | `readImageFromClipboard()` | `readImageFromClipboard` | `Promise<ClipboardImage \| null>` | Oui |
| Keys | `parseKey(data, kittyProtocolActive)` | `parseKey` | `string \| null` | Non |

## Différences de contrat synchrone vs asynchrone

Le contrat mélange des API synchrones et asynchrones ; les wrappers préservent le style d'appel natif plutôt que de forcer un modèle unique :

- **Exports asynchrones basés sur les Promise** pour les E/S ou les travaux de longue durée (`grep`, `glob`, `htmlToMarkdown`, `executeShell`, presse-papiers, opérations sur les images).
- **Exports synchrones** pour les transformations/parseurs déterministes en mémoire (`search`, `hasMatch`, coloration syntaxique, largeur/découpage de texte, analyse de touches, requêtes de processus).
- **Exports de constructeurs** pour les objets runtime à état (`Shell`, `PtySession`, `PhotonImage`).

Implication pour les mainteneurs : changer synchrone ↔ asynchrone pour un export existant constitue un changement d'API et de contrat cassant à travers les wrappers et les appelants.

## Patterns de typage pour les objets et les enums

### Patterns d'objets (objets JS style `#[napi(object)]`)

TS modélise les valeurs natives de forme objet comme des interfaces, par exemple :

- `GrepResult`, `SearchResult`, `GlobResult`
- `SystemInfo`, `WorkProfile`
- `ClipboardImage`, `ParsedKittyResult`

Ce sont des contrats structurels à la compilation ; la correction de la forme à l'exécution est de la responsabilité de l'implémentation native.

### Patterns d'enums

Les enums natifs numériques sont représentés comme des valeurs `const enum` en TS :

- `FileType` (`1=file`, `2=dir`, `3=symlink`)
- `ImageFormat` (`0=PNG`, `1=JPEG`, `2=WEBP`, `3=GIF`)
- `SamplingFilter`, `Ellipsis`, `KeyEventType`

Les appelants voient les membres nommés de l'enum ; la frontière de liaison transmet des nombres.

## Comment les incohérences sont détectées

La détection des incohérences se fait à deux niveaux :

1. **Vérifications du contrat TypeScript à la compilation**
   - Les wrappers appellent `native.<name>` contre `NativeBindings` fusionné.
   - Les clés de liaison manquantes/renommées cassent la vérification de types TS dans les wrappers.

2. **Validation à l'exécution dans `validateNative`**
   - Après le chargement, `native.ts` vérifie les exports requis et lève une exception si l'un d'eux est manquant.
   - Le message d'erreur inclut les clés manquantes et les instructions de reconstruction.

Cela détecte la dérive courante de binaire obsolète : le wrapper/type existe mais le `.node` chargé ne possède pas l'export.

## Comportement en cas d'échec et avertissements

### Échecs de chargement/validation (échecs définitifs)

- L'échec de chargement de l'addon ou une plateforme non supportée lève une exception lors de l'initialisation du module dans `native.ts`.
- Les exports requis manquants lèvent une exception avant que les wrappers soient utilisables.

Effet : le package échoue rapidement plutôt que de différer l'échec au premier appel.

### Différences de comportement au niveau des wrappers

- Certains wrappers adoucissent intentionnellement les échecs (`copyToClipboard` fonctionne au mieux et absorbe les échecs natifs).
- Les callbacks de streaming ignorent les charges d'erreur des callbacks et ne transmettent que les événements de valeurs réussies.

### Avertissements au niveau des types (l'exécution est plus stricte que TS)

- Les champs optionnels TS ne garantissent pas la validité sémantique ; la couche native peut toujours rejeter des valeurs malformées.
- Le typage `const enum` n'empêche pas les valeurs numériques hors limites provenant d'appelants non typés à l'exécution.
- `validateNative` vérifie uniquement la présence/nature de fonction des exports requis, pas la compatibilité profonde des formes d'arguments/retours.
- `bindings.ts` inclut `cancelWork(id)` dans l'interface de base, mais la liste de validation à l'exécution actuelle n'impose pas cette clé.

## Liste de contrôle pour les mainteneurs lors de changements de liaison

Lors de l'ajout/modification d'un export, mettez à jour tous les éléments suivants :

1. `src/<module>/types.ts` (augmentation + types de contrat)
2. `src/<module>/index.ts` (comportement du wrapper)
3. Imports de `src/native.ts` pour les types du module (si nouveau module)
4. Vérifications des exports requis dans `validateNative`
5. Ré-exports publics dans `src/index.ts`

Sauter l'une de ces étapes crée soit une dérive à la compilation, soit un échec à l'exécution au moment du chargement.
