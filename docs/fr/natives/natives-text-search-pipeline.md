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

# Pipeline natif de texte et de recherche

Ce document décrit la surface texte/recherche de `@f5xc-salesdemos/pi-natives` (`grep`, `glob`, `text`, `highlight`), des wrappers TypeScript jusqu'aux exports N-API en Rust et aux objets de résultats JS.

La terminologie suit `docs/natives-architecture.md` :

- **Wrapper** : API TS dans `packages/natives/src/*`
- **Couche module Rust** : exports N-API dans `crates/pi-natives/src/*`
- **Cache de scan partagé** : cache d'entrées de répertoire adossé à `fs_cache`, utilisé par les flux de découverte et de recherche

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

### Flux d'entrée et d'options

1. Le wrapper TS transmet les options au module natif :
   - `grep/index.ts` transmet `options` pratiquement sans modification et encapsule le callback de la forme `(match) => void` vers la forme de callback napi threadsafe `(err, match)`.
   - `searchContent` et `hasMatch` transmettent directement une chaîne ou un `Uint8Array`.
2. Les structures d'options Rust dans `grep.rs` désérialisent les champs en camelCase (`ignoreCase`, `maxCount`, `contextBefore`, `contextAfter`, `maxColumns`, `timeoutMs`).
3. `grep` crée un `CancelToken` à partir de `timeoutMs` + `AbortSignal` et s'exécute dans `task::blocking("grep", ...)`.

### Branches d'exécution

- **Branche en mémoire (utilitaire pur)**
  - `search` → `search_sync` → `run_search` sur les octets de contenu fournis.
  - Aucun scan du système de fichiers, aucun `fs_cache`.
- **Branche fichier unique (dépendante du système de fichiers)**
  - `grep_sync` résout le chemin, vérifie que les métadonnées correspondent à un fichier, et lit en flux jusqu'à `MAX_FILE_BYTES` par fichier (`4 Mio`) via le matcher ripgrep.
- **Branche répertoire (dépendante du système de fichiers)**
  - Consultation optionnelle du cache via `fs_cache::get_or_scan` lorsque `cache: true`.
  - Scan forcé via `fs_cache::force_rescan` lorsque `cache: false`.
  - Revérification optionnelle des résultats vides lorsque l'âge du cache dépasse `empty_recheck_ms()`.
  - Filtrage des entrées : fichiers uniquement + filtre glob optionnel (`glob_util`) + filtre de type optionnel (`js`, `ts`, `rust`, etc.).

### Sémantique de recherche et de collecte

- Moteur de regex : `grep_regex::RegexMatcherBuilder` avec `ignoreCase` et `multiline`.
- Résolution du contexte :
  - `contextBefore/contextAfter` remplacent le `context` hérité.
  - Les modes sans contenu annulent la collecte de contexte.
- Modes de sortie :
  - `content` => un `GrepMatch` par correspondance.
  - `count` et `filesWithMatches` sont tous deux mappés vers des entrées de type comptage (`lineNumber=0`, `line=""`, `matchCount` défini).
- Limites :
  - `offset` global et `maxCount` appliqués sur l'ensemble des fichiers.
  - Le traitement parallèle n'est utilisé que lorsque `maxCount` n'est pas défini et `offset == 0` ; sinon, le traitement séquentiel préserve la sémantique déterministe de décalage/limite global.

### Mise en forme des résultats vers JS

- Les champs Rust `SearchResult`/`GrepResult` sont mappés vers les types TS via la conversion de champs d'objet N-API.
- Les compteurs sont limités à `u32` avant de traverser la frontière N-API.
- Les booléens optionnels sont omis sauf s'ils sont vrais dans certains chemins (`limitReached`).
- Le callback de streaming reçoit chaque `GrepMatch` mis en forme (entrée de contenu ou de comptage).

### Comportement en cas d'échec

- `searchContent` retourne `SearchResult.error` en cas d'échec regex/recherche au lieu de lever une exception.
- `grep` rejette en cas d'erreurs graves (chemin invalide, glob/regex invalide, annulation par délai d'attente ou abandon).
- `hasMatch` retourne `Result<bool>` et lève une exception en cas de motif invalide ou d'erreurs de décodage UTF-8.
- Les erreurs d'ouverture ou de recherche dans les scans multi-fichiers sont ignorées fichier par fichier ; le scan continue.

### Gestion des expressions régulières malformées

`grep.rs` assainit les accolades avant la compilation de la regex :

- Les accolades ressemblant à des répétitions invalides sont échappées (`{`/`}` -> `\{`/`\}`) lorsqu'elles ne peuvent pas former `{N}`, `{N,}`, `{N,M}`.
- Cela évite que des fragments littéraux courants de templates (par exemple `${platform}`) échouent en tant que répétitions malformées.
- La syntaxe de regex invalide restante continue de retourner une erreur de regex.

## 2) Découverte de fichiers (`glob`) et recherche de chemins approximative (`fuzzyFind`)

`glob` et `fuzzyFind` partagent les scans `fs_cache` ; la logique de correspondance diffère.

### Flux `glob`

1. Wrapper TS (`glob/index.ts`) :
   - `path.resolve(options.path)`.
   - Valeurs par défaut : `pattern="*"`, `hidden=false`, `gitignore=true`, `recursive=true`.
2. Rust `glob` construit `GlobConfig` et compile le motif via `glob_util::compile_glob`.
3. Source des entrées :
   - `cache=true` => `get_or_scan` + `force_rescan` optionnel en cas de cache vide périmé.
   - `cache=false` => `force_rescan(..., store=false)` (nouvelle analyse uniquement).
4. Filtrage :
   - `.git` toujours ignoré.
   - `node_modules` ignoré sauf si demandé (`includeNodeModules` ou motif mentionnant node_modules).
   - Application du filtre glob.
   - Application du filtre de type de fichier ; les filtres `file/dir` sur les liens symboliques résolvent les métadonnées de la cible.
5. Tri optionnel par mtime décroissant (`sortByMtime`) avant troncature à `maxResults`.

### Flux `fuzzyFind` (implémenté dans `fd.rs`)

1. Le wrapper TS est exporté depuis le module `grep`, mais l'implémentation Rust réside dans `fd.rs`.
2. Source de scan partagée depuis `fs_cache` avec la même politique de cache/sans-cache et de revérification des entrées périmées vides.
3. Calcul du score :
   - score exact / commence-par / contient / correspondance floue basée sur les sous-séquences
   - chemin de calcul normalisé par séparateurs/ponctuation
   - bonus répertoire et tri déterministe en cas d'égalité (`score desc`, puis `path asc`)
4. Les entrées de liens symboliques sont exclues des résultats flous.

### Comportement en cas d'échec

- Motif glob invalide => erreur de `glob_util::compile_glob`.
- La racine de recherche doit être un répertoire existant (`resolve_search_path`), sinon erreur.
- Les annulations/délais d'attente se propagent comme erreurs d'abandon via les vérifications `CancelToken::heartbeat()` dans les boucles.

### Gestion des motifs glob malformés

`glob_util::build_glob_pattern` est tolérant :

- Normalise `\` en `/`.
- Préfixe automatiquement les motifs récursifs simples avec `**/` lorsque `recursive=true`.
- Ferme automatiquement les groupes d'alternance `{...` non équilibrés avant la compilation.

## 3) Cycle de vie du scan et du cache partagés (`fs_cache`)

`fs_cache` stocke les résultats des scans sous forme d'entrées relatives normalisées (`path`, `fileType`, `mtime` optionnel) indexées par :

- racine de recherche canonique
- `include_hidden`
- `use_gitignore`

### Transitions d'état du cache

1. **Absence / désactivé**
   - TTL est `0` ou clé absente/expirée -> nouveau `collect_entries`.
2. **Correspondance**
   - Âge de l'entrée `< cache_ttl_ms()` -> retourne les entrées en cache + `cache_age_ms`.
3. **Revérification en cas de cache vide périmé** (politique de l'appelant dans `glob`/`grep`/`fd`)
   - Si la requête retourne zéro correspondance et `cache_age_ms >= empty_recheck_ms()`, forcer un nouveau scan.
4. **Invalidation**
   - `invalidateFsScanCache(path?)` :
     - sans argument : vider toutes les clés
     - avec argument path : supprimer les clés dont la racine est un préfixe du chemin cible

### Compromis sur les résultats périmés

- Le cache privilégie la faible latence pour les scans répétés plutôt que la cohérence immédiate.
- La fenêtre TTL peut retourner des faux positifs ou négatifs périmés.
- La revérification des résultats vides réduit les faux négatifs périmés pour les scans en cache anciens, au prix d'un scan supplémentaire.
- L'invalidation explicite est le mécanisme de correction prévu après des mutations de fichiers.

## 4) Utilitaires de texte ANSI (`text`)

Ce sont des utilitaires purs, en mémoire (sans scan du système de fichiers).

### Limites et responsabilités

- **`text.rs` gère la sémantique des cellules terminal** :
  - Analyse des séquences ANSI
  - Largeur et découpage tenant compte des graphèmes
  - Comportement de retour à la ligne, troncature et assainissement
- **La troncature de ligne dans `grep.rs` (`maxColumns`) est séparée** :
  - troncature simple aux limites de caractères des lignes correspondantes avec `...`
  - non préservante de l'état ANSI et non consciente de la largeur en cellules terminal

### Comportements clés

- `wrapTextWithAnsi` : effectue le retour à la ligne selon la largeur visible, en portant les codes SGR actifs sur les lignes découpées.
- `truncateToWidth` : troncature en cellules visibles avec politique d'ellipse (`Unicode`, `Ascii`, `Omit`), remplissage droit optionnel, et chemin rapide retournant la chaîne JS d'origine si inchangée.
- `sliceWithWidth` : découpage par colonnes avec application optionnelle de la largeur stricte.
- `extractSegments` : extrait les segments avant/après autour d'une superposition tout en restaurant l'état ANSI pour le segment `after`.
- `sanitizeText` : supprime les échappements ANSI et les caractères de contrôle, élimine les substituts isolés, normalise CR/LF en supprimant `\r`.
- `visibleWidth` : compte les cellules terminal visibles (les tabulations utilisent `TAB_WIDTH` fixe de l'implémentation Rust).

### Comportement en cas d'échec

Les fonctions de texte retournent généralement une sortie transformée déterministe ; les erreurs se limitent aux frontières de conversion des chaînes JS (échecs de conversion des arguments N-API).

## 5) Coloration syntaxique (`highlight`)

`highlight.rs` est une transformation pure (sans FS, sans cache).

### Flux

1. Le wrapper transmet `code`, `lang` optionnel et la palette de couleurs ANSI.
2. Rust résout la syntaxe par :
   - recherche par jeton/nom
   - recherche par extension
   - repli sur la table d'alias (`ts/tsx/js -> JavaScript`, etc.)
   - repli sur la syntaxe texte brut en cas d'échec de résolution
3. Analyse de chaque ligne avec `ParseState` syntect et la pile de portées.
4. Mappage des portées vers 11 catégories sémantiques de couleurs et injection/réinitialisation des codes de couleur ANSI.

### Comportement en cas d'échec

- L'échec d'analyse d'une ligne ne fait pas échouer l'appel : la ligne est ajoutée sans coloration et le traitement continue.
- Le langage inconnu ou non pris en charge bascule vers la syntaxe texte brut.

## Utilitaires purs vs flux dépendants du système de fichiers

| Flux | Accès système de fichiers | Cache partagé | Notes |
| --- | --- | --- | --- |
| `searchContent` / `hasMatch` | Non | Non | regex sur les octets/chaîne fournis uniquement |
| Fonctions du module `text` | Non | Non | ANSI/largeur/assainissement uniquement |
| Fonctions du module `highlight` | Non | Non | coloration syntaxique + ANSI uniquement |
| `glob` | Oui | Optionnel | scans de répertoire + filtrage glob |
| `fuzzyFind` | Oui | Optionnel | scans de répertoire + score flou |
| `grep` (chemin fichier/répertoire) | Oui | Optionnel (mode répertoire) | ripgrep sur les fichiers, filtres/callback optionnels |

## Résumé du cycle de vie de bout en bout

1. L'appelant invoque le wrapper TS avec des options typées.
2. Le wrapper normalise les valeurs par défaut (notamment pour `glob`) et les transmet à l'export `native.*`.
3. Rust valide et normalise les options, puis construit la configuration matcher/recherche.
4. Pour les flux système de fichiers, les entrées sont scannées (hit/miss/rescan du cache) puis filtrées/scorées.
5. Les boucles de traitement appellent périodiquement le heartbeat d'annulation ; le délai d'attente ou l'abandon peut terminer l'exécution.
6. Rust met en forme les sorties en objets N-API (`lineNumber`, `matchCount`, `limitReached`, etc.).
7. Le wrapper TS retourne des objets JS typés (et des callbacks optionnels par correspondance pour `grep`/`glob`).
