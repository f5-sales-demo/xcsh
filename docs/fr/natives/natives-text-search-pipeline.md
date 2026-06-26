---
title: Pipeline natif de texte et de recherche
description: >-
  Pipeline de recherche de texte natif avec indexation du contenu de fichiers
  basée sur grep, glob et ripgrep.
sidebar:
  order: 6
  label: Pipeline texte et recherche
i18n:
  sourceHash: 129496955a03
  translator: machine
---

# Pipeline natif de texte/recherche

Ce document décrit la surface de texte/recherche de `@f5-sales-demo/pi-natives` (`grep`, `glob`, `text`, `highlight`), depuis les wrappers TypeScript jusqu'aux exports N-API Rust et aux objets de résultats JS.

La terminologie suit `docs/natives-architecture.md` :

- **Wrapper** : API TS dans `packages/natives/src/*`
- **Couche module Rust** : exports N-API dans `crates/pi-natives/src/*`
- **Cache de scan partagé** : cache d'entrées de répertoire géré par `fs_cache`, utilisé par les flux de découverte/recherche

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

1. Le wrapper TS transmet les options au module natif :
   - `grep/index.ts` transmet `options` pratiquement sans modification et encapsule le callback de la forme `(match) => void` vers la forme de callback threadsafe napi `(err, match)`.
   - `searchContent` et `hasMatch` transmettent directement une chaîne ou un `Uint8Array`.
2. Les structures d'options Rust dans `grep.rs` désérialisent les champs en camelCase (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`).
3. `grep` crée un `CancelToken` à partir de `timeoutMs` + `AbortSignal` et s'exécute à l'intérieur de `task::blocking("grep", ...)`.

### Branches d'exécution

- **Branche en mémoire (utilitaire pur)**
  - `search` → `search_sync` → `run_search` sur les octets de contenu fournis.
  - Pas d'accès au système de fichiers, pas de `fs_cache`.
- **Branche fichier unique (dépendante du système de fichiers)**
  - `grep_sync` résout le chemin, vérifie que les métadonnées correspondent à un fichier, puis lit jusqu'à `MAX_FILE_BYTES` par fichier (`4 Mio`) à travers le matcher ripgrep.
- **Branche répertoire (dépendante du système de fichiers)**
  - Consultation optionnelle du cache via `fs_cache::get_or_scan` quand `cache: true`.
  - Scan frais via `fs_cache::force_rescan` quand `cache: false`.
  - Vérification optionnelle des résultats vides lorsque l'ancienneté du cache dépasse `empty_recheck_ms()`.
  - Filtrage des entrées : fichiers uniquement + filtre glob optionnel (`glob_util`) + filtre de type optionnel (`js`, `ts`, `rust`, etc.).

### Sémantiques de recherche/collecte

- Moteur de regex : `grep_regex::RegexMatcherBuilder` avec `ignoreCase` et `multiline`.
- Résolution du contexte :
  - `contextBefore/contextAfter` remplacent le champ `context` hérité.
  - Les modes sans contenu remettent à zéro la collecte de contexte.
- Modes de sortie :
  - `content` => un `GrepMatch` par correspondance.
  - `count` et `filesWithMatches` correspondent tous deux à des entrées de type comptage (`lineNumber=0`, `line=""`, `matchCount` défini).
- Limites :
  - Les paramètres globaux `offset` et `maxCount` sont appliqués sur l'ensemble des fichiers.
  - Le chemin parallèle n'est utilisé que lorsque `maxCount` n'est pas défini et que `offset == 0` ; sinon, le chemin séquentiel préserve la sémantique déterministe de décalage/limite global.

### Mise en forme des résultats vers JS

- Les champs Rust `SearchResult`/`GrepResult` sont mappés vers les types TS via la conversion de champs d'objets N-API.
- Les compteurs sont limités à `u32` avant de franchir la frontière N-API.
- Les booléens optionnels sont omis sauf s'ils sont vrais dans certains chemins (`limitReached`).
- Le callback de streaming reçoit chaque `GrepMatch` mis en forme (entrée de contenu ou de comptage).

### Comportement en cas d'échec

- `searchContent` retourne `SearchResult.error` en cas d'échec de regex/recherche au lieu de lever une exception.
- `grep` rejette sur les erreurs fatales (chemin invalide, glob/regex invalide, annulation par timeout/abandon).
- `hasMatch` retourne `Result<bool>` et lève une exception en cas de motif invalide ou d'erreurs de décodage UTF-8.
- Les erreurs d'ouverture/de recherche de fichiers dans les scans multi-fichiers sont ignorées pour chaque fichier ; le scan continue.

### Gestion des expressions régulières malformées

`grep.rs` assainit les accolades avant la compilation de la regex :

- Les accolades ressemblant à des répétitions invalides sont échappées (`{`/`}` -> `\{`/`\}`) lorsqu'elles ne peuvent pas former `{N}`, `{N,}`, `{N,M}`.
- Cela empêche les fragments de gabarit littéraux courants (par exemple `${platform}`) d'échouer en tant que répétitions malformées.
- La syntaxe de regex invalide restante retourne quand même une erreur de regex.

## 2) Découverte de fichiers (`glob`) et recherche floue de chemins (`fuzzyFind`)

`glob` et `fuzzyFind` partagent les scans `fs_cache` ; la logique de correspondance diffère.

### Flux `glob`

1. Wrapper TS (`glob/index.ts`) :
   - `path.resolve(options.path)`.
   - Valeurs par défaut : `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`.
2. Rust `glob` construit `GlobConfig` et compile le motif via `glob_util::compile_glob`.
3. Source d'entrées :
   - `cache=true` => `get_or_scan` + `force_rescan` optionnel en cas de cache vide périmé.
   - `cache=false` => `force_rescan(..., store=false)` (scan frais uniquement).
4. Filtrage :
   - Ignorer `.git` systématiquement.
   - Ignorer `node_modules` sauf si demandé (`includeNodeModules` ou motif mentionnant node_modules).
   - Appliquer la correspondance glob.
   - Appliquer le filtre de type de fichier ; les filtres `file/dir` sur les liens symboliques résolvent les métadonnées de la cible.
5. Tri optionnel par mtime décroissant (`sortByMtime`) avant la troncature à `maxResults`.

### Flux `fuzzyFind` (implémenté dans `fd.rs`)

1. Le wrapper TS est exporté depuis le module `grep`, mais l'implémentation Rust se trouve dans `fd.rs`.
2. Source de scan partagée depuis `fs_cache` avec le même découpage cache/sans-cache et la même politique de revérification en cas de cache vide périmé.
3. Scoring :
   - score flou basé sur exact / commence-par / contient / sous-séquence
   - chemin de scoring normalisé par séparateurs/ponctuation
   - bonus de répertoire et départage déterministe (`score desc`, puis `path asc`)
4. Les entrées de liens symboliques sont exclues des résultats fuzzy.

### Comportement en cas d'échec

- Motif glob invalide => erreur provenant de `glob_util::compile_glob`.
- La racine de recherche doit être un répertoire existant (`resolve_search_path`), sinon erreur.
- Les annulations/timeouts se propagent comme des erreurs d'abandon via les vérifications `CancelToken::heartbeat()` dans les boucles.

### Gestion des globs malformés

`glob_util::build_glob_pattern` est tolérant :

- Normalise `\` en `/`.
- Préfixe automatiquement les motifs récursifs simples avec `**/` quand `recursive=true`.
- Ferme automatiquement les groupes d'alternance `{...` non équilibrés avant la compilation.

## 3) Cycle de vie du scan/cache partagé (`fs_cache`)

`fs_cache` stocke les résultats de scan sous forme d'entrées relatives normalisées (`path`, `fileType`, `mtime` optionnel) indexées par :

- racine de recherche canonique
- `include_hidden`
- `use_gitignore`

### Transitions d'état du cache

1. **Absence / désactivé**
   - TTL est `0` ou la clé est absente/expirée -> `collect_entries` frais.
2. **Présence**
   - Ancienneté de l'entrée `< cache_ttl_ms()` -> retourner les entrées mises en cache + `cache_age_ms`.
3. **Revérification en cas de cache vide périmé** (politique de l'appelant dans `glob`/`grep`/`fd`)
   - Si la requête produit zéro correspondance et `cache_age_ms >= empty_recheck_ms()`, forcer un nouveau scan.
4. **Invalidation**
   - `invalidateFsScanCache(path?)` :
     - sans argument : effacer toutes les clés
     - avec un chemin : supprimer les clés dont la racine préfixe ce chemin cible

### Compromis liés aux résultats périmés

- Le cache favorise les scans répétés à faible latence plutôt que la cohérence immédiate.
- La fenêtre TTL peut retourner des résultats positifs/négatifs périmés.
- La revérification en cas de résultat vide réduit les faux négatifs périmés pour les scans anciens en cache, au coût d'un scan supplémentaire.
- L'invalidation explicite est le mécanisme de correction prévu après les mutations de fichiers.

## 4) Utilitaires de texte ANSI (`text`)

Ce sont des utilitaires purs, en mémoire (sans accès au système de fichiers).

### Périmètre et responsabilités

- **`text.rs` gère la sémantique des cellules de terminal** :
  - analyse des séquences ANSI
  - largeur et découpage prenant en compte les graphèmes
  - comportements de retour à la ligne, troncature et assainissement
- **La troncature de ligne de `grep.rs` (`maxColumns`) est séparée** :
  - troncature simple à la limite des caractères des lignes correspondantes avec `...`
  - ne préserve pas l'état ANSI et ne tient pas compte de la largeur en cellules de terminal

### Comportements clés

- `wrapTextWithAnsi` : effectue le retour à la ligne par largeur visible, transporte les codes SGR actifs sur les lignes encapsulées.
- `truncateToWidth` : troncature par cellules visibles avec politique d'ellipse (`Unicode`, `Ascii`, `Omit`), rembourrage optionnel à droite, et chemin rapide retournant la chaîne JS originale si elle est inchangée.
- `sliceWithWidth` : découpage par colonne avec application optionnelle stricte de la largeur.
- `extractSegments` : extrait les segments avant/après autour d'une superposition tout en restaurant l'état ANSI pour le segment `after`.
- `sanitizeText` : supprime les séquences ANSI et les caractères de contrôle, rejette les surrogats isolés, normalise CR/LF en supprimant `\r`.
- `visibleWidth` : compte les cellules de terminal visibles (les tabulations utilisent `TAB_WIDTH` fixe défini dans l'implémentation Rust).

### Comportement en cas d'échec

Les fonctions texte retournent généralement une sortie transformée déterministe ; les erreurs se limitent aux frontières de conversion des chaînes JS (échecs de conversion d'arguments N-API).

## 5) Coloration syntaxique (`highlight`)

`highlight.rs` est une transformation pure (pas de système de fichiers, pas de cache).

### Flux

1. Le wrapper transmet `code`, le `lang` optionnel et la palette de couleurs ANSI.
2. Rust résout la syntaxe par :
   - recherche par jeton/nom
   - recherche par extension
   - repli sur la table d'alias (`ts/tsx/js -> JavaScript`, etc.)
   - repli sur la syntaxe texte brut si non résolu
3. Analyser chaque ligne avec `ParseState` et la pile de portées de syntect.
4. Mapper les portées vers 11 catégories de couleurs sémantiques et injecter/réinitialiser les codes de couleur ANSI.

### Comportement en cas d'échec

- Un échec d'analyse par ligne n'échoue pas l'appel : cette ligne est ajoutée sans coloration et le traitement continue.
- Un langage inconnu/non pris en charge replie sur la syntaxe texte brut.

## Flux utilitaires purs vs dépendants du système de fichiers

| Flux | Accès au système de fichiers | Cache partagé | Notes |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | Non | Non | regex sur les octets/chaîne fournis uniquement |
| Fonctions du module `text` | Non | Non | ANSI/largeur/assainissement uniquement |
| Fonctions du module `highlight` | Non | Non | coloration syntaxique + ANSI uniquement |
| `glob` | Oui | Optionnel | scans de répertoires + filtrage glob |
| `fuzzyFind` | Oui | Optionnel | scans de répertoires + scoring flou |
| `grep` (chemin fichier/répertoire) | Oui | Optionnel (mode répertoire) | ripgrep sur les fichiers, filtres/callback optionnels |

## Résumé du cycle de vie de bout en bout

1. L'appelant invoque le wrapper TS avec des options typées.
2. Le wrapper normalise les valeurs par défaut (notamment pour `glob`) et transmet à l'export `native.*`.
3. Rust valide/normalise les options et construit la configuration du matcher/de recherche.
4. Pour les flux liés au système de fichiers, les entrées sont scannées (présence/absence en cache/nouveau scan) puis filtrées/scorées.
5. Les boucles de travail appellent périodiquement le heartbeat d'annulation ; le timeout/abandon peut mettre fin à l'exécution.
6. Rust met en forme les sorties en objets N-API (`lineNumber`, `matchCount`, `limitReached`, etc.).
7. Le wrapper TS retourne des objets JS typés (et des callbacks optionnels par correspondance pour `grep`/`glob`).
