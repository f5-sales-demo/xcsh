---
title: Architecture du cache de scan du système de fichiers
description: >-
  Contrat du cache de scan du système de fichiers pour une découverte rapide de
  fichiers avec une sémantique de type stale-while-revalidate.
sidebar:
  order: 8
  label: Cache de scan du système de fichiers
i18n:
  sourceHash: 2a2bde1726ac
  translator: machine
---

# Contrat d'architecture du cache de scan du système de fichiers

Ce document définit le contrat actuel pour le cache partagé de scan du système de fichiers implémenté en Rust (`crates/pi-natives/src/fs_cache.rs`) et consommé par les API natives de découverte/recherche exposées à `packages/coding-agent`.

## Ce qu'est ce cache

Le cache stocke des listes complètes d'entrées de scan de répertoires (`GlobMatch[]`) indexées par portée de scan et politique de traversée, puis permet aux opérations de niveau supérieur (filtrage par glob, scoring flou, sélection de fichiers grep) de s'exécuter sur ces entrées en cache.

Objectifs principaux :

- éviter les parcours répétés du système de fichiers pour des appels de découverte/recherche répétés
- maintenir la cohérence entre `glob`, `fuzzyFind` et `grep` lorsqu'ils partagent la même politique de scan
- permettre une récupération explicite en cas d'obsolescence pour les résultats vides et une invalidation explicite après des mutations de fichiers

## Propriété et surface publique

- Implémentation et politique du cache : `crates/pi-natives/src/fs_cache.rs`
- Consommateurs natifs :
  - `crates/pi-natives/src/glob.rs`
  - `crates/pi-natives/src/fd.rs` (`fuzzyFind`)
  - `crates/pi-natives/src/grep.rs`
- Liaison/export JS :
  - `packages/natives/src/glob/index.ts` (`invalidateFsScanCache`)
  - `packages/natives/src/glob/types.ts`
  - `packages/natives/src/grep/types.ts`
- Helpers d'invalidation lors des mutations du coding-agent :
  - `packages/coding-agent/src/tools/fs-cache-invalidation.ts`

## Partitionnement des clés de cache (contrat strict)

Chaque entrée est indexée par :

- chemin canonicalisé du répertoire `root`
- booléen `include_hidden`
- booléen `use_gitignore`

Implications :

- Les scans avec et sans fichiers cachés ne partagent **pas** les mêmes entrées.
- Les scans respectant le gitignore et ceux ignorant le gitignore ne partagent **pas** les mêmes entrées.
- Les consommateurs doivent passer une sémantique stable pour le comportement hidden/gitignore ; changer l'un ou l'autre drapeau crée une partition de cache différente.

L'inclusion de `node_modules` n'est **pas** dans la clé de cache. Le cache stocke les entrées avec `node_modules` inclus ; le filtrage par consommateur est appliqué après la récupération.

## Comportement de collecte du scan

Le peuplement du cache utilise un walker déterministe (`ignore::WalkBuilder`) configuré par `include_hidden` et `use_gitignore` :

- `follow_links(false)`
- trié par chemin de fichier
- `.git` est toujours ignoré
- `node_modules` est toujours collecté au moment du scan du cache (et optionnellement filtré ensuite)
- le type de fichier de l'entrée + `mtime` sont capturés via `symlink_metadata`

Les racines de recherche sont résolues par `resolve_search_path` :

- les chemins relatifs sont résolus par rapport au cwd actuel
- la cible doit être un répertoire existant
- la racine est canonicalisée lorsque possible

## Politique de fraîcheur et d'éviction

Politique globale (remplaçable par variable d'environnement) :

- `FS_SCAN_CACHE_TTL_MS` (défaut `1000`)
- `FS_SCAN_EMPTY_RECHECK_MS` (défaut `200`)
- `FS_SCAN_CACHE_MAX_ENTRIES` (défaut `16`)

Comportement :

- `get_or_scan(...)`
  - si le TTL est `0` : contourne entièrement le cache, toujours un scan frais (`cache_age_ms = 0`)
  - en cas de hit de cache dans le TTL : retourne les entrées en cache + `cache_age_ms` non nul
  - en cas de hit expiré : évicte la clé, rescanne, stocke une nouvelle entrée
- l'application de la limite maximale d'entrées se fait par éviction des plus anciennes selon `created_at`

## Re-vérification rapide des résultats vides (séparée des hits normaux)

Hit de cache normal :

- un hit de cache dans le TTL retourne les entrées en cache et ne fait rien d'autre.

Re-vérification rapide des résultats vides :

- il s'agit d'une politique **côté appelant** utilisant `ScanResult.cache_age_ms`
- si le résultat filtré/requêté est vide et que l'âge du scan en cache est au moins `empty_recheck_ms()`, l'appelant effectue un `force_rescan(...)` et réessaie
- destiné à réduire les résultats faux négatifs obsolètes lorsque des fichiers ont été récemment ajoutés mais que le cache est encore dans le TTL

Consommateurs actuels :

- `glob` : re-vérifie lorsque les correspondances filtrées sont vides et que l'âge du scan dépasse le seuil
- `fuzzyFind` (`fd.rs`) : re-vérifie uniquement lorsque la requête est non vide et que les correspondances scorées sont vides
- `grep` : re-vérifie lorsque la liste de fichiers candidats sélectionnés est vide

## Valeurs par défaut des consommateurs et utilisation du cache

Le cache est optionnel sur toutes les API exposées (`cache?: boolean`, défaut `false`).

Valeurs par défaut actuelles dans les API natives :

- `glob` : `hidden=false`, `gitignore=true`, `cache=false`
- `fuzzyFind` : `hidden=false`, `gitignore=true`, `cache=false`
- `grep` : `hidden=true`, `cache=false`, et le scan du cache utilise toujours `use_gitignore=true`

Appelants du coding-agent aujourd'hui :

- La découverte de candidats à forte volumétrie de mentions active le cache :
  - `packages/coding-agent/src/utils/file-mentions.ts`
  - profil : `hidden=true`, `gitignore=true`, `includeNodeModules=true`, `cache=true`
- L'intégration `grep` au niveau outil désactive actuellement le cache de scan (`cache: false`) :
  - `packages/coding-agent/src/tools/grep.ts`

## Contrat d'invalidation

Point d'entrée natif d'invalidation :

- `invalidateFsScanCache(path?: string)`
  - avec `path` : supprime les entrées de cache dont la racine est un préfixe du chemin cible
  - sans chemin : vide toutes les entrées du cache de scan

Détails du traitement des chemins :

- les chemins d'invalidation relatifs sont résolus par rapport au cwd
- l'invalidation tente la canonicalisation
- si la cible n'existe pas (par exemple, suppression), le fallback canonicalise le parent et rattache le nom de fichier lorsque possible
- cela préserve le comportement d'invalidation pour les créations/suppressions/renommages où un côté peut ne pas exister

## Responsabilités du flux de mutation du coding-agent

Le code du coding-agent doit invalider après les mutations réussies du système de fichiers.

Helpers centraux :

- `invalidateFsScanAfterWrite(path)`
- `invalidateFsScanAfterDelete(path)`
- `invalidateFsScanAfterRename(oldPath, newPath)` (invalide les deux côtés lorsque les chemins diffèrent)

Points d'appel actuels des outils de mutation :

- `packages/coding-agent/src/tools/write.ts`
- `packages/coding-agent/src/patch/index.ts` (flux hashline/patch/replace)

Règle : si un flux modifie le contenu ou l'emplacement du système de fichiers et contourne ces helpers, des bugs d'obsolescence du cache sont attendus.

## Ajouter un nouveau consommateur de cache en toute sécurité

Lors de l'introduction de l'utilisation du cache dans un nouveau chemin de scanner/recherche :

1. **Utiliser des entrées de politique de scan stables**
   - décider d'abord de la sémantique hidden/gitignore
   - les passer de manière cohérente à `get_or_scan`/`force_rescan` pour que les partitions de cache soient intentionnelles

2. **Traiter les données du cache comme pré-filtrées uniquement par la politique de traversée**
   - appliquer le filtrage spécifique à l'outil (patterns glob, filtres de type, règles node_modules) après la récupération
   - ne jamais supposer que les entrées en cache reflètent déjà vos filtres de niveau supérieur

3. **Implémenter la re-vérification rapide des résultats vides uniquement pour le risque de faux négatifs obsolètes**
   - utiliser `scan.cache_age_ms >= empty_recheck_ms()`
   - réessayer une fois avec `force_rescan(..., store=true, ...)`
   - garder ce chemin séparé de la logique normale de hit de cache

4. **Respecter explicitement le mode sans cache**
   - lorsque l'appelant désactive le cache, appeler `force_rescan(..., store=false, ...)`
   - ne pas peupler le cache partagé dans un chemin de requête sans cache

5. **Brancher l'invalidation des mutations pour tout nouveau chemin d'écriture**
   - après une écriture/édition/suppression/renommage réussi, appeler le helper d'invalidation du coding-agent
   - pour un renommage/déplacement, invalider à la fois l'ancien et le nouveau chemin

6. **Ne pas ajouter de paramètres TTL par appel**
   - le contrat actuel est une politique globale uniquement (configurée par variable d'environnement), pas de surcharge TTL par requête

## Limites connues

- La portée du cache est locale au processus en mémoire (`DashMap`), non persistée entre les redémarrages de processus.
- Le cache stocke les entrées de scan, pas les résultats finaux des outils.
- `glob`/`fuzzyFind`/`grep` partagent les entrées de scan uniquement lorsque les dimensions clés (`root`, `hidden`, `gitignore`) correspondent.
- `.git` est toujours exclu au moment de la collecte du scan, indépendamment des options de l'appelant.
