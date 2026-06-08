---
title: Pipeline native de texte et de recherche
description: >-
  Native text search pipeline with grep, glob, and ripgrep-based file content
  indexing.
sidebar:
  order: 6
  label: Pipeline texte et recherche
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# Pipeline natif de texte/recherche

Ce document cartographie la surface de texte/recherche de `@f5xc-salesdemos/pi-natives` (`grep`, `glob`, `text`, `highlight`), des wrappers TypeScript aux exports Rust N-API et retour vers les objets de résultat JS.

La terminologie suit `docs/natives-architecture.md` :

- **Wrapper** : API TS dans `packages/natives/src/*`
- **Couche module Rust** : exports N-API dans `crates/pi-natives/src/*`
- **Cache de scan partagé** : cache d'entrées de répertoire basé sur `fs_cache` utilisé par les flux de découverte/recherche

## Fichiers d'implémentation

- `packages/natives/src/grep/index.ts`
- `packages/natives/src/grep/types.ts`
- `packages/natives/src/glob/index.ts`
- `packages/natives/src/glob/types.ts`
- `packages/natives/src/text/index.ts`
- `packages/natives/src/text/types.ts`
- `packages/natives/src/highlight/index.ts`
- `packages/natives/src/highlight/types.ts`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/glob_util.rs`
- `crates/pi-natives/src/fs_cache.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/highlight.rs`
- `crates/pi-natives/src/fd.rs`

## Correspondance API JS ↔ export Rust

| API wrapper JS | Export Rust (`#[napi]`, snake_case -> camelCase) | Module Rust |
| --- | --- | --- |
| `grep(options, onMatch?)` | `grep` | `grep.rs` |
| `searchContent(content, options)` | `search` | `grep.rs` |
| `hasMatch(content, pattern, options?)` | `hasMatch` | `grep.rs` |
| `fuzzyFind(options)` | `fuzzyFind` | `fd.rs` |
| `glob(options, onMatch?)` | `glob` | `glob.rs` |
| `invalidateFsScanCache(path?)` | `invalidateFsScanCache` | `fs_cache.rs` |
| `wrapTextWithAnsi(text, width)` | `wrapTextWithAnsi` | `text.rs` |
| `truncateToWidth(text, maxWidth, ellipsis, pad)` | `truncateToWidth` | `text.rs` |
| `sliceWithWidth(line, startCol, length, strict?)` | `sliceWithWidth` | `text.rs` |
| `extractSegments(line, beforeEnd, afterStart, afterLen, strictAfter)` | `extractSegments` | `text.rs` |
| `sanitizeText(text)` | `sanitizeText` | `text.rs` |
| `visibleWidth(text)` | `visibleWidth` | `text.rs` |
| `highlightCode(code, lang, colors)` | `highlightCode` | `highlight.rs` |
| `supportsLanguage(lang)` | `supportsLanguage` | `highlight.rs` |
| `getSupportedLanguages()` | `getSupportedLanguages` | `highlight.rs` |

## Vue d'ensemble du pipeline par sous-système

## 1) Recherche par expression régulière (`grep`, `searchContent`, `hasMatch`)

### Flux d'entrée/options

1. Le wrapper TS transmet les options au natif :
   - `grep/index.ts` passe `options` quasiment inchangé et encapsule le callback de `(match) => void` vers la forme de callback threadsafe napi `(err, match)`.
   - `searchContent` et `hasMatch` passent directement une chaîne/`Uint8Array`.
2. Les structures d'options Rust dans `grep.rs` désérialisent les champs en camelCase (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`).
3. `grep` crée un `CancelToken` à partir de `timeoutMs` + `AbortSignal` et s'exécute à l'intérieur de `task::blocking("grep", ...)`.

### Branches d'exécution

- **Branche en mémoire (utilitaire pur)**
  - `search` → `search_sync` → `run_search` sur les octets de contenu fournis.
  - Pas de scan du système de fichiers, pas de `fs_cache`.
- **Branche fichier unique (dépendante du système de fichiers)**
  - `grep_sync` résout le chemin, vérifie que les métadonnées correspondent à un fichier, traite en flux jusqu'à `MAX_FILE_BYTES` par fichier (`4 MiB`) via le matcher ripgrep.
- **Branche répertoire (dépendante du système de fichiers)**
  - Recherche optionnelle dans le cache via `fs_cache::get_or_scan` lorsque `cache: true`.
  - Scan frais via `fs_cache::force_rescan` lorsque `cache: false`.
  - Revérification optionnelle des résultats vides lorsque l'âge du cache dépasse `empty_recheck_ms()`.
  - Filtrage des entrées : fichiers uniquement + filtre glob optionnel (`glob_util`) + mappage de filtre de type optionnel (`js`, `ts`, `rust`, etc.).

### Sémantiques de recherche/collecte

- Moteur regex : `grep_regex::RegexMatcherBuilder` avec `ignoreCase` et `multiline`.
- Résolution du contexte :
  - `contextBefore/contextAfter` remplacent l'ancien `context`.
  - Les modes non-contenu annulent la collecte de contexte.
- Modes de sortie :
  - `content` => un `GrepMatch` par correspondance.
  - `count` et `filesWithMatches` produisent tous deux des entrées de style comptage (`lineNumber=0`, `line=""`, `matchCount` défini).
- Limites :
  - `offset` global et `maxCount` appliqués à travers les fichiers.
  - Le chemin parallèle n'est utilisé que lorsque `maxCount` n'est pas défini et `offset == 0` ; sinon le chemin séquentiel préserve la sémantique déterministe d'offset/limite globale.

### Mise en forme des résultats vers JS

- Les champs `SearchResult`/`GrepResult` Rust correspondent aux types TS via la conversion de champs d'objets N-API.
- Les compteurs sont limités à `u32` avant de traverser N-API.
- Les booléens optionnels sont omis sauf si vrais dans certains chemins (`limitReached`).
- Le callback en streaming reçoit chaque `GrepMatch` mis en forme (entrée de contenu ou de comptage).

### Comportement en cas d'échec

- `searchContent` retourne `SearchResult.error` pour les échecs de regex/recherche au lieu de lever une exception.
- `grep` rejette sur les erreurs critiques (chemin invalide, glob/regex invalide, timeout/annulation d'abandon).
- `hasMatch` retourne `Result<bool>` et lève une exception sur les erreurs de pattern invalide/décodage UTF-8.
- Les erreurs d'ouverture/recherche de fichier dans les scans multi-fichiers sont ignorées par fichier ; le scan continue.

### Gestion des expressions régulières malformées

`grep.rs` assainit les accolades avant la compilation regex :

- Les accolades ressemblant à des répétitions invalides sont échappées (`{`/`}` -> `\{`/`\}`) lorsqu'elles ne peuvent pas former `{N}`, `{N,}`, `{N,M}`.
- Cela empêche les fragments courants de template littéral (par exemple `${platform}`) d'échouer comme répétition malformée.
- La syntaxe regex invalide restante retourne toujours une erreur regex.

## 2) Découverte de fichiers (`glob`) et recherche floue de chemins (`fuzzyFind`)

`glob` et `fuzzyFind` partagent les scans `fs_cache` ; la logique de correspondance diffère.

### Flux `glob`

1. Wrapper TS (`glob/index.ts`) :
   - `path.resolve(options.path)`.
   - Valeurs par défaut : `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`.
2. Rust `glob` construit `GlobConfig` et compile le pattern via `glob_util::compile_glob`.
3. Source des entrées :
   - `cache=true` => `get_or_scan` + `force_rescan` optionnel si vide et périmé.
   - `cache=false` => `force_rescan(..., store=false)` (frais uniquement).
4. Filtrage :
   - Ignore toujours `.git`.
   - Ignore `node_modules` sauf si demandé (`includeNodeModules` ou pattern mentionnant node_modules).
   - Applique la correspondance glob.
   - Applique le filtre de type de fichier ; les filtres `file/dir` de liens symboliques résolvent les métadonnées de la cible.
5. Tri optionnel par mtime décroissant (`sortByMtime`) avant troncature à `maxResults`.

### Flux `fuzzyFind` (implémenté dans `fd.rs`)

1. Le wrapper TS est exporté depuis le module `grep`, mais l'implémentation Rust réside dans `fd.rs`.
2. Source de scan partagée depuis `fs_cache` avec la même séparation cache/sans-cache et la politique de revérification des résultats vides périmés.
3. Scoring :
   - score basé sur exact / commence-par / contient / sous-séquence floue
   - chemin de scoring normalisé par séparateur/ponctuation
   - bonus de répertoire et départage déterministe (`score desc`, puis `path asc`)
4. Les entrées de liens symboliques sont exclues des résultats flous.

### Comportement en cas d'échec

- Pattern glob invalide => erreur depuis `glob_util::compile_glob`.
- La racine de recherche doit être un répertoire existant (`resolve_search_path`), sinon erreur.
- Les annulations/timeouts se propagent comme erreurs d'abandon via les vérifications `CancelToken::heartbeat()` dans les boucles.

### Gestion des globs malformés

`glob_util::build_glob_pattern` est tolérant :

- Normalise `\` en `/`.
- Préfixe automatiquement les patterns récursifs simples avec `**/` lorsque `recursive=true`.
- Ferme automatiquement les groupes d'alternation `{...` non équilibrés avant la compilation.

## 3) Cycle de vie du scan/cache partagé (`fs_cache`)

`fs_cache` stocke les résultats de scan comme entrées relatives normalisées (`path`, `fileType`, `mtime` optionnel) indexées par :

- racine de recherche canonique
- `include_hidden`
- `use_gitignore`

### Transitions d'état du cache

1. **Miss / désactivé**
   - Le TTL est `0` ou la clé est absente/expirée -> `collect_entries` frais.
2. **Hit**
   - Âge de l'entrée `< cache_ttl_ms()` -> retourne les entrées en cache + `cache_age_ms`.
3. **Revérification des résultats vides périmés** (politique de l'appelant dans `glob`/`grep`/`fd`)
   - Si la requête ne produit aucune correspondance et `cache_age_ms >= empty_recheck_ms()`, force un rescan.
4. **Invalidation**
   - `invalidateFsScanCache(path?)` :
     - sans argument : efface toutes les clés
     - avec argument path : supprime les clés dont la racine préfixe ce chemin cible

### Compromis sur les résultats périmés

- Le cache favorise la faible latence des scans répétés plutôt que la cohérence immédiate.
- La fenêtre de TTL peut retourner des faux positifs/négatifs périmés.
- La revérification des résultats vides réduit les faux négatifs périmés pour les scans en cache plus anciens au prix d'un scan supplémentaire.
- L'invalidation explicite est le mécanisme de correction prévu après les mutations de fichiers.

## 4) Utilitaires de texte ANSI (`text`)

Ce sont des utilitaires purs, en mémoire (pas de scan du système de fichiers).

### Limites et responsabilités

- **`text.rs` gère la sémantique des cellules terminales** :
  - Analyse des séquences ANSI
  - Largeur et découpage tenant compte des graphèmes
  - Comportement de retour à la ligne/troncature/assainissement
- **La troncature de ligne de `grep.rs` (`maxColumns`) est séparée** :
  - Troncature simple aux limites de caractères des lignes correspondantes avec `...`
  - Ne préserve pas l'état ANSI et ne tient pas compte de la largeur des cellules terminales

### Comportements clés

- `wrapTextWithAnsi` : effectue le retour à la ligne par largeur visible, transporte les codes SGR actifs à travers les lignes découpées.
- `truncateToWidth` : troncature par cellule visible avec politique d'ellipse (`Unicode`, `Ascii`, `Omit`), remplissage droit optionnel, et chemin rapide retournant la chaîne JS originale lorsqu'inchangée.
- `sliceWithWidth` : découpage par colonne avec application stricte optionnelle de la largeur.
- `extractSegments` : extrait les segments avant/après autour d'une superposition tout en restaurant l'état ANSI pour le segment `after`.
- `sanitizeText` : supprime les échappements ANSI + caractères de contrôle, élimine les surrogates isolés, normalise CR/LF en supprimant `\r`.
- `visibleWidth` : compte les cellules terminales visibles (les tabulations utilisent un `TAB_WIDTH` fixe depuis l'implémentation Rust).

### Comportement en cas d'échec

Les fonctions de texte retournent généralement une sortie transformée déterministe ; les erreurs se limitent aux frontières de conversion de chaînes JS (échecs de conversion d'arguments N-API).

## 5) Coloration syntaxique (`highlight`)

`highlight.rs` est une transformation pure (pas de système de fichiers, pas de cache).

### Flux

1. Le wrapper transmet `code`, un `lang` optionnel, et la palette de couleurs ANSI.
2. Rust résout la syntaxe par :
   - recherche par token/nom
   - recherche par extension
   - table d'alias en repli (`ts/tsx/js -> JavaScript`, etc.)
   - repli vers la syntaxe texte brut lorsque non résolu
3. Analyse chaque ligne avec `ParseState` syntect et la pile de portées.
4. Fait correspondre les portées à 11 catégories sémantiques de couleurs et injecte/réinitialise les codes couleur ANSI.

### Comportement en cas d'échec

- Un échec d'analyse par ligne ne fait pas échouer l'appel : cette ligne est ajoutée sans coloration et le traitement continue.
- Un langage inconnu/non supporté bascule vers la syntaxe texte brut.

## Flux utilitaires purs vs dépendants du système de fichiers

| Flux | Accès au système de fichiers | Cache partagé | Notes |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | Non | Non | regex sur les octets/chaîne fournis uniquement |
| Fonctions du module `text` | Non | Non | ANSI/largeur/assainissement uniquement |
| Fonctions du module `highlight` | Non | Non | syntaxe + coloration ANSI uniquement |
| `glob` | Oui | Optionnel | scans de répertoires + filtrage glob |
| `fuzzyFind` | Oui | Optionnel | scans de répertoires + scoring flou |
| `grep` (chemin fichier/répertoire) | Oui | Optionnel (mode répertoire) | ripgrep sur les fichiers, filtres/callback optionnels |

## Résumé du cycle de vie de bout en bout

1. L'appelant invoque le wrapper TS avec des options typées.
2. Le wrapper normalise les valeurs par défaut (notamment `glob`) et transmet à l'export `native.*`.
3. Rust valide/normalise les options et construit le matcher/la configuration de recherche.
4. Pour les flux liés au système de fichiers, les entrées sont scannées (hit/miss/rescan du cache) puis filtrées/scorées.
5. Les boucles de workers appellent périodiquement le heartbeat d'annulation ; le timeout/abandon peut interrompre l'exécution.
6. Rust met en forme les sorties en objets N-API (`lineNumber`, `matchCount`, `limitReached`, etc.).
7. Le wrapper TS retourne des objets JS typés (et des callbacks optionnels par correspondance pour `grep`/`glob`).
