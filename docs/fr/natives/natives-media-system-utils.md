---
title: Utilitaires natifs pour les médias et le système
description: >-
  Utilitaires natifs de traitement multimédia pour les captures d'écran, la
  gestion d'images et les informations système.
sidebar:
  order: 7
  label: Utilitaires médias & système
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# Utilitaires natifs médias + système

Ce document est une analyse approfondie du sous-système pour la couche de **primitives système/médias/conversion** décrite dans [`docs/natives-architecture.md`](./natives-architecture.md) : `image`, `html`, `clipboard` et le profilage `work`.

## Fichiers d'implémentation

- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/prof.rs`
- `crates/pi-natives/src/task.rs`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/work/index.ts`
- `packages/natives/src/work/types.ts`

> Note : il n'y a pas de `crates/pi-natives/src/work.rs` ; le profilage work est implémenté dans `prof.rs` et alimenté par l'instrumentation dans `task.rs`.

## Correspondance API TS ↔ export/module Rust

| Export TS (packages/natives)                | Export N-API Rust                                                       | Module Rust                           |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + logique de repli TS                                | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## Frontières de format de données et conversions

### Image (`image`)

- **Frontière d'entrée JS** : octets d'image encodés en `Uint8Array`.
- **Frontière de décodage Rust** : les octets sont copiés dans un `Vec<u8>`, le format est deviné avec `ImageReader::with_guessed_format()`, puis décodé en `DynamicImage`.
- **État en mémoire** : `PhotonImage` stocke un `Arc<DynamicImage>`.
- **Frontière de sortie** : `encode(format, quality)` retourne `Promise<Uint8Array>` (`Vec<u8>` côté Rust).

Les identifiants de format sont numériques :

- `0` : PNG
- `1` : JPEG
- `2` : WebP (encodeur sans perte)
- `3` : GIF

Contraintes :

- `quality` n'est utilisé que pour JPEG.
- PNG/WebP/GIF ignorent `quality`.
- Les identifiants de format non supportés échouent (`Invalid image format: <id>`).

### Conversion HTML (`html`)

- **Frontière d'entrée JS** : `string` HTML + objet optionnel `{ cleanContent?: boolean; skipImages?: boolean }`.
- **Frontière de conversion Rust** : l'entrée `String` est convertie par `html_to_markdown_rs::convert`.
- **Frontière de sortie** : `string` Markdown.

Comportement de conversion :

- `cleanContent` vaut `false` par défaut.
- Lorsque `cleanContent=true`, le prétraitement est activé avec `PreprocessingPreset::Aggressive` et des indicateurs de suppression stricte pour la navigation/les formulaires.
- `skipImages` vaut `false` par défaut.

### Presse-papiers (`clipboard`)

- **Chemin texte** :
  - TS émet d'abord OSC 52 (`\x1b]52;c;<base64>\x07`) lorsque stdout est un TTY.
  - Le même texte est ensuite tenté via l'API native du presse-papiers (`native.copyToClipboard`) en mode « meilleur effort ».
  - Sur Termux, TS tente d'abord `termux-clipboard-set`.
- **Chemin de lecture d'image** :
  - Rust lit l'image brute depuis `arboard`.
  - Rust la ré-encode en octets PNG (crate `image`), retourne `{ data: Uint8Array, mimeType: "image/png" }`.
  - TS retourne `null` immédiatement sur Termux ou les sessions Linux sans serveur d'affichage (`DISPLAY`/`WAYLAND_DISPLAY` absents).

### Profilage work (`work`)

- **Frontière de collecte** : les échantillons de profilage sont produits par les gardes `profile_region(tag)` dans `task::blocking` et `task::future`.
- **Format de stockage** : tampon circulaire de taille fixe (`MAX_SAMPLES = 10_000`) stockant le chemin de pile + la durée (`μs`) + l'horodatage (`μs depuis le démarrage du processus`).
- **Frontière de sortie** : `getWorkProfile(lastSeconds)` retourne un objet :
  - `folded` : texte de pile repliée (entrée pour flamegraph)
  - `summary` : tableau résumé en markdown
  - `svg` : SVG flamegraph optionnel
  - `totalMs`, `sampleCount`

## Cycle de vie et transitions d'état

### Cycle de vie de l'image

1. `PhotonImage.parse(bytes)` planifie une tâche bloquante de décodage (`image.decode`).
2. En cas de succès, un handle natif `PhotonImage` existe côté JS.
3. `resize(...)` crée un nouveau handle natif (`image.resize`), l'ancien et le nouveau handle peuvent coexister.
4. `encode(...)` matérialise les octets (`image.encode`) sans modifier les dimensions de l'image.

Transitions d'échec :

- L'échec de détection de format/décodage rejette la promesse de parse.
- L'échec d'encodage rejette la promesse d'encode.
- Un identifiant de format invalide rejette la promesse d'encode.

### Cycle de vie HTML

1. `htmlToMarkdown(html, options)` planifie une tâche bloquante de conversion.
2. La conversion s'exécute avec les options par défaut (`cleanContent=false`, `skipImages=false`) sauf spécification contraire.
3. Retourne une chaîne markdown ou rejette.

Transitions d'échec :

- L'échec du convertisseur retourne une promesse rejetée (`Conversion error: ...`).

### Cycle de vie du presse-papiers

`copyToClipboard(text)` est intentionnellement en mode « meilleur effort » et multi-chemin :

1. Si TTY : tentative d'écriture OSC 52 (payload base64).
2. Tentative de la commande Termux lorsque `TERMUX_VERSION` est défini.
3. Tentative de copie texte native via `arboard`.
4. Les erreurs sont absorbées au niveau de la couche TS.

`readImageFromClipboard()` diffère en rigueur selon l'étape :

1. TS bloque strictement les contextes d'exécution non supportés (Termux/Linux sans interface graphique) en retournant `null`.
2. La lecture Rust `arboard` ne s'exécute que lorsque TS l'autorise.
3. `ContentNotAvailable` est mappé vers `null`.
4. Les autres erreurs Rust rejettent.

### Cycle de vie du profilage work

1. Pas de démarrage explicite : le profilage est toujours actif lorsque les helpers de tâches s'exécutent.
2. Chaque portée de tâche instrumentée enregistre un échantillon lors de la destruction du garde.
3. Les échantillons écrasent les entrées les plus anciennes une fois la capacité du tampon atteinte.
4. `getWorkProfile(lastSeconds)` lit une fenêtre temporelle et dérive les artefacts folded/summary/svg.

Transitions d'échec :

- L'échec de génération SVG est un échec souple (`svg: null`), tandis que folded et summary sont toujours retournés.
- Une fenêtre d'échantillons vide retourne des données folded vides et `svg: null`, ce n'est pas une erreur.

## Opérations non supportées et propagation des erreurs

### Image

- Entrée de décodage non supportée ou octets corrompus : échec strict (rejet de la promesse).
- Identifiant de format d'encodage non supporté : échec strict.
- Pas de chemin de repli « meilleur effort » dans le wrapper TS.

### HTML

- Les erreurs de conversion sont des échecs stricts (rejet).
- L'omission d'options utilise les valeurs par défaut en mode « meilleur effort », ce n'est pas un échec.

### Presse-papiers

- La copie de texte est en mode « meilleur effort » au niveau de la couche TS : les échecs opérationnels sont supprimés.
- La lecture d'image distingue « pas d'image » (`null`) d'un échec opérationnel (rejet).
- Termux/Linux sans interface graphique sont traités comme des contextes non supportés pour la lecture d'image (`null`).

### Profilage work

- La récupération est stricte pour l'appel de fonction lui-même, mais la génération d'artefacts est partiellement en mode « meilleur effort » (`svg` nullable).
- La troncature du tampon est un comportement attendu (tampon circulaire), pas un bug de perte de données.

## Particularités par plateforme

- **Texte du presse-papiers** : OSC 52 dépend du support du terminal ; l'accès natif au presse-papiers dépend de l'environnement de bureau/session.
- **Lecture d'image du presse-papiers** : bloquée côté TS pour Termux et Linux sans serveur d'affichage.
