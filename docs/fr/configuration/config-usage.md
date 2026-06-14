---
title: Découverte et résolution de la configuration
description: >-
  Comment xcsh découvre, résout et superpose la configuration à partir des
  racines de projet, d'utilisateur et d'entreprise.
sidebar:
  order: 1
  label: Configuration
i18n:
  sourceHash: a8d23493ed0d
  translator: machine
---

# Découverte et résolution de la configuration

Ce document décrit comment le coding-agent résout la configuration : quelles racines sont analysées, comment fonctionne la priorité, et comment la configuration résolue est consommée par les paramètres, les compétences, les hooks, les outils et les extensions.

## Périmètre

Implémentation principale :

- `src/config.ts`
- `src/config/settings.ts`
- `src/config/settings-schema.ts`
- `src/discovery/builtin.ts`
- `src/discovery/helpers.ts`

Points d'intégration clés :

- `src/capability/index.ts`
- `src/discovery/index.ts`
- `src/extensibility/skills.ts`
- `src/extensibility/hooks/loader.ts`
- `src/extensibility/custom-tools/loader.ts`
- `src/extensibility/extensions/loader.ts`

---

## Flux de résolution (visuel)

```text
         Config roots (ordered)
┌───────────────────────────────────────┐
│ 1) ~/.xcsh/agent + <cwd>/.xcsh          │
│ 2) ~/.claude   + <cwd>/.claude        │
│ 3) ~/.codex    + <cwd>/.codex         │
│ 4) ~/.gemini   + <cwd>/.gemini        │
└───────────────────────────────────────┘
                    │
                    ▼
        config.ts helper resolution
  (getConfigDirs/findConfigFile/findNearest...)
                    │
                    ▼
       capability providers enumerate items
 (native, claude, codex, gemini, agents, etc.)
                    │
                    ▼
      priority sort + per-capability dedup
                    │
                    ▼
          subsystem-specific consumption
   (settings, skills, hooks, tools, extensions)
```

## 1) Racines de configuration et ordre des sources

## Racines canoniques

`src/config.ts` définit une liste de priorités de sources fixe :

1. `.xcsh` (natif)
2. `.claude`
3. `.codex`
4. `.gemini`

Bases au niveau utilisateur :

- `~/.xcsh/agent`
- `~/.claude`
- `~/.codex`
- `~/.gemini`

Bases au niveau projet :

- `<cwd>/.xcsh`
- `<cwd>/.claude`
- `<cwd>/.codex`
- `<cwd>/.gemini`

`CONFIG_DIR_NAME` est `.xcsh` (`packages/utils/src/dirs.ts`).

## Contrainte importante

Les helpers génériques dans `src/config.ts` n'incluent **pas** `.pi` dans l'ordre de découverte des sources.

---

## 2) Helpers de découverte principaux (`src/config.ts`)

## `getConfigDirs(subpath, options)`

Retourne des entrées ordonnées :

- Les entrées au niveau utilisateur en premier (par priorité de source)
- Puis les entrées au niveau projet (selon la même priorité de source)

Options :

- `user` (par défaut `true`)
- `project` (par défaut `true`)
- `cwd` (par défaut `getProjectDir()`)
- `existingOnly` (par défaut `false`)

Cette API est utilisée pour les recherches de configuration basées sur les répertoires (commandes, hooks, outils, agents, etc.).

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

Recherche le premier fichier existant parmi les bases ordonnées, retourne la première correspondance (chemin seul ou chemin + métadonnées).

## `findAllNearestProjectConfigDirs(subpath, cwd)`

Remonte les répertoires parents et retourne le **répertoire existant le plus proche par base source** (`.xcsh`, `.claude`, `.codex`, `.gemini`), puis trie les résultats par priorité de source.

À utiliser lorsque la configuration de projet doit être héritée des répertoires ancêtres (comportement monorepo/espace de travail imbriqué).

---

## 3) Wrapper de fichier de configuration (`ConfigFile<T>` dans `src/config.ts`)

`ConfigFile<T>` est le chargeur avec validation de schéma pour les fichiers de configuration individuels.

Formats pris en charge :

- `.yml` / `.yaml`
- `.json` / `.jsonc`

Comportement :

- Valide les données analysées avec AJV par rapport à un schéma TypeBox fourni.
- Met en cache le résultat du chargement jusqu'à `invalidate()`.
- Retourne un résultat à trois états via `tryLoad()` :
  - `ok`
  - `not-found`
  - `error` (`ConfigError` avec contexte de schéma/analyse)

La migration héritée est toujours prise en charge :

- Si le chemin cible est `.yml`/`.yaml`, un fichier `.json` voisin est automatiquement migré une seule fois (`migrateJsonToYml`).

---

## 4) Modèle de résolution des paramètres (`src/config/settings.ts`)

Le modèle de paramètres d'exécution est superposé :

1. Paramètres globaux : `~/.xcsh/agent/config.yml`
2. Paramètres de projet : découverts via la capacité de paramètres (`settings.json` des fournisseurs)
3. Substitutions d'exécution : en mémoire, non persistantes
4. Valeurs par défaut du schéma : issues de `SETTINGS_SCHEMA`

Chemin de lecture effectif :

`defaults <- global <- project <- overrides`

Comportement en écriture :

- `settings.set(...)` écrit dans la couche **globale** (`config.yml`) et met en file d'attente une sauvegarde en arrière-plan.
- Les paramètres de projet sont en lecture seule depuis la découverte des capacités.

## Comportement de migration toujours actif

Au démarrage, si `config.yml` est absent :

1. Migration depuis `~/.xcsh/agent/settings.json` (renommé en `.bak` en cas de succès)
2. Fusion avec les paramètres hérités de la base de données `agent.db`
3. Écriture du résultat fusionné dans `config.yml`

Migrations au niveau des champs dans `#migrateRawSettings` :

- `queueMode` -> `steeringMode`
- Millisecondes `ask.timeout` -> secondes lorsque l'ancienne valeur ressemble à des ms (`> 1000`)
- Structure `theme: "..."` plate héritée -> `theme.dark/theme.light`

---

## 5) Intégration des capacités/découverte

La plupart des flux de chargement de configuration non essentiels passent par le registre des capacités (`src/capability/index.ts` + `src/discovery/index.ts`).

## Ordonnancement des fournisseurs

Les fournisseurs sont triés par priorité numérique (la plus haute en premier). Exemples de priorités :

- OMP natif (`builtin.ts`) : `100`
- Claude : `80`
- Codex / agents / Claude marketplace : `70`
- Gemini : `60`

```text
Provider precedence (higher wins)

native (.xcsh)          priority 100
claude                 priority  80
codex / agents / ...   priority  70
gemini                 priority  60
```

## Sémantique de déduplication

Les capacités définissent une `key(item)` :

- même clé => le premier élément l'emporte (élément chargé en premier/de priorité plus élevée)
- pas de clé (`undefined`) => pas de déduplication, tous les éléments sont conservés

Clés pertinentes :

- compétences : `name`
- outils : `name`
- hooks : `${type}:${tool}:${name}`
- modules d'extension : `name`
- extensions : `name`
- paramètres : pas de déduplication (tous les éléments sont conservés)

---

## 6) Comportement du fournisseur natif `.xcsh` (`src/discovery/builtin.ts`)

Le fournisseur natif (`id: native`) lit depuis :

- projet : `<cwd>/.xcsh/...`
- utilisateur : `~/.xcsh/agent/...`

### Règle d'admission des répertoires

`builtin.ts` n'inclut une racine de configuration que si le répertoire existe **et est non vide** (`ifNonEmptyDir`).

### Chargement spécifique à la portée

- Compétences : `skills/*/SKILL.md`
- Commandes slash : `commands/*.md`
- Règles : `rules/*.{md,mdc}`
- Invites : `prompts/*.md`
- Instructions : `instructions/*.md`
- Hooks : `hooks/pre/*`, `hooks/post/*`
- Outils : `tools/*.json|*.md` et `tools/<name>/index.ts`
- Modules d'extension : découverts sous `extensions/` (+ tableau de chaînes hérité `settings.json.extensions`)
- Extensions : `extensions/<name>/gemini-extension.json`
- Capacité de paramètres : `settings.json`

### Nuance de la recherche de projet le plus proche

Pour `SYSTEM.md` et `AGENTS.md`, le fournisseur natif utilise la recherche par remontée d'ancêtre du répertoire `.xcsh` de projet le plus proche (walk-up), mais exige toujours que le répertoire `.xcsh` soit non vide.

---

## 7) Comment les principaux sous-systèmes consomment la configuration

## Sous-système des paramètres

- `Settings.init()` charge le `config.yml` global et les éléments de capacité `settings.json` de projet découverts.
- Seuls les éléments de capacité avec `level === "project"` sont fusionnés dans la couche de projet.

## Sous-système des compétences

- `extensibility/skills.ts` charge via `loadCapability(skillCapability.id, { cwd })`.
- Applique les bascules de source et les filtres (`ignoredSkills`, `includeSkills`, répertoires personnalisés).
- Les bascules nommées de manière héritée existent toujours (`skills.enablePiUser`, `skills.enablePiProject`) mais elles conditionnent le fournisseur natif (`provider === "native"`).

## Sous-système des hooks

- `discoverAndLoadHooks()` résout les chemins de hooks depuis la capacité de hook et les chemins configurés explicitement.
- Charge ensuite les modules via l'import Bun.

## Sous-système des outils

- `discoverAndLoadCustomTools()` résout les chemins d'outils depuis la capacité d'outil, les chemins d'outils de plugin et les chemins configurés explicitement.
- Les fichiers d'outils déclaratifs `.md/.json` sont uniquement des métadonnées ; le chargement exécutable attend des modules de code.

## Sous-système des extensions

- `discoverAndLoadExtensions()` résout les modules d'extension depuis la capacité de module d'extension et les chemins explicites.
- L'implémentation actuelle ne conserve intentionnellement que les éléments de capacité avec `_source.provider === "native"` avant le chargement.

---

## 8) Règles de priorité sur lesquelles s'appuyer

Utilisez ce modèle mental :

1. L'ordre des répertoires source issu de `config.ts` détermine l'ordre des chemins candidats.
2. La priorité du fournisseur de capacités détermine la priorité entre fournisseurs.
3. La déduplication par clé de capacité détermine le comportement en cas de collision (le premier l'emporte pour les capacités à clé).
4. La logique de fusion spécifique au sous-système peut modifier davantage la priorité effective (en particulier pour les paramètres).

### Mise en garde spécifique aux paramètres

Les éléments de capacité de paramètres ne sont pas dédupliqués ; `Settings.#loadProjectSettings()` effectue une fusion profonde des éléments de projet dans l'ordre retourné. Étant donné que la fusion applique les valeurs des éléments ultérieurs sur les valeurs antérieures, le comportement de substitution effectif dépend de l'ordre d'émission du fournisseur, et pas seulement de la sémantique des clés de capacité.

---

## 9) Comportements hérités/de compatibilité toujours présents

- Migration `ConfigFile` JSON -> YAML pour les fichiers ciblant le format YAML.
- Migration des paramètres depuis `settings.json` et `agent.db` vers `config.yml`.
- Migrations de clés de paramètres (`queueMode`, `ask.timeout`, `theme` plat).
- Compatibilité des manifestes d'extension : le chargeur accepte les sections de manifeste `package.json.xcsh` et `package.json.pi`.
- Les noms de paramètres hérités `skills.enablePiUser` / `skills.enablePiProject` sont toujours des conditions actives pour la source de compétences native.

Si ces chemins de compatibilité sont supprimés du code, mettez ce document à jour immédiatement ; plusieurs comportements d'exécution en dépendent encore aujourd'hui.
