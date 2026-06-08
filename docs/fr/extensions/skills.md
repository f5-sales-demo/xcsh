---
title: Skills
description: >-
  Système de compétences pour l'enregistrement, la découverte et l'invocation de
  capacités spécialisées dans l'agent de codage.
sidebar:
  order: 3
  label: Skills
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# Skills

Les skills sont des packs de capacités adossés à des fichiers, découverts au démarrage et exposés au modèle sous forme de :

- métadonnées légères dans le prompt système (nom + description)
- contenu à la demande via `read skill://...`
- commandes interactives optionnelles `/skill:<name>`

Ce document couvre le comportement actuel à l'exécution dans `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` et `src/discovery/agents-md.ts`.

## Ce qu'est un skill dans cette base de code

Un skill découvert est représenté par :

- `name`
- `description`
- `filePath` (le chemin vers `SKILL.md`)
- `baseDir` (répertoire du skill)
- métadonnées de source (`provider`, `level`, chemin)

Le runtime ne requiert que `name` et `path` pour la validité. En pratique, la qualité de la correspondance dépend du caractère significatif de `description`.

## Structure requise et attentes concernant SKILL.md

### Structure des répertoires

Pour la découverte basée sur les providers (providers native/Claude/Codex/Agents/plugin), les skills sont découverts **un niveau sous `skills/`** :

- `<skills-root>/<skill-name>/SKILL.md`

Les patterns imbriqués comme `<skills-root>/group/<skill>/SKILL.md` ne sont pas découverts par les chargeurs de providers.

Pour `skills.customDirectories`, le scan utilise la même structure non récursive (`*/SKILL.md`).

```text
Provider-discovered layout (non-recursive under skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ discovered
  ├─ pdf/
  │   └─ SKILL.md      ✅ discovered
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ not discovered by provider loaders

Custom-directory scanning is also non-recursive, so nested paths are ignored unless you point `customDirectories` at that nested parent.
```

### Frontmatter de `SKILL.md`

Champs de frontmatter pris en charge sur le type skill :

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- les clés supplémentaires sont conservées comme métadonnées inconnues

Comportement actuel à l'exécution :

- `name` prend par défaut le nom du répertoire du skill
- `description` est requis pour :
  - la découverte de skills du provider natif `.xcsh` (`requireDescription: true`)
  - les scans `skills.customDirectories` via `scanSkillsFromDir` dans `src/discovery/helpers.ts` (non récursif)
- les providers non natifs peuvent charger des skills sans description

## Pipeline de découverte

`discoverSkills()` dans `src/extensibility/skills.ts` effectue deux passes :

1. **Providers de capacités** via `loadCapability("skills")`
2. **Répertoires personnalisés** via `scanSkillsFromDir(..., { requireDescription: true })` (énumération de répertoires à un niveau)

Si `skills.enabled` est `false`, la découverte ne retourne aucun skill.

### Providers de skills intégrés et précédence

L'ordre des providers est d'abord par priorité (la plus haute gagne), puis par ordre d'enregistrement en cas d'égalité.

Providers de skills actuellement enregistrés :

1. `native` (priorité 100) — skills utilisateur/projet `.xcsh` via `src/discovery/builtin.ts`
2. `claude` (priorité 80)
3. groupe de priorité 70 (par ordre d'enregistrement) :
   - `claude-plugins`
   - `agents`
   - `codex`

La clé de déduplication est le nom du skill. Le premier élément avec un nom donné l'emporte.

### Bascules de source et filtrage

`discoverSkills()` applique ces contrôles :

- bascules de source : `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- filtres glob sur le nom du skill :
  - `ignoredSkills` (exclusion)
  - `includeSkills` (liste d'inclusion ; vide signifie tout inclure)

L'ordre de filtrage est :

1. source activée
2. non ignoré
3. inclus (si la liste d'inclusion est présente)

Pour les providers autres que codex/claude/native (par exemple `agents`, `claude-plugins`), l'activation retombe actuellement sur : activé si **n'importe quelle** bascule de source intégrée est activée.

### Gestion des collisions et des doublons

- La déduplication des capacités conserve déjà le premier skill par nom (provider de plus haute précédence)
- `extensibility/skills.ts` fait en plus :
  - la déduplication des fichiers identiques par `realpath` (compatible avec les liens symboliques)
  - l'émission d'avertissements de collision lorsqu'un nom de skill ultérieur entre en conflit
  - le maintien de l'API pratique `discoverSkillsFromDir({ dir, source })` comme adaptateur léger sur `scanSkillsFromDir`
- Les skills des répertoires personnalisés sont fusionnés après les skills des providers et suivent le même comportement de collision

## Comportement d'utilisation à l'exécution

### Exposition dans le prompt système

La construction du prompt système (`src/system-prompt.ts`) utilise les skills découverts comme suit :

- si l'outil `read` est disponible :
  - inclure la liste des skills découverts dans le prompt
- sinon :
  - omettre la liste découverte

Les sous-agents de l'outil task reçoivent la liste des skills découverts/fournis de la session via la création normale de session ; il n'y a pas de surcharge de sélection de skills par tâche.

### Commandes interactives `/skill:<name>`

Si `skills.enableSkillCommands` est vrai, le mode interactif enregistre une commande slash par skill découvert.

Comportement de `/skill:<name> [args]` :

- lit le fichier du skill directement depuis `filePath`
- supprime le frontmatter
- injecte le corps du skill comme message personnalisé de suivi
- ajoute les métadonnées (`Skill: <path>`, optionnellement `User: <args>`)

## Comportement de l'URL `skill://`

`src/internal-urls/skill-protocol.ts` prend en charge :

- `skill://<name>` → résout vers le `SKILL.md` de ce skill
- `skill://<name>/<relative-path>` → résout à l'intérieur du répertoire de ce skill

```text
skill:// URL resolution

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Guards:
- reject absolute paths
- reject `..` traversal
- reject any resolved path escaping <pdf-base>
```

Détails de la résolution :

- le nom du skill doit correspondre exactement
- les chemins relatifs sont décodés (URL-decoded)
- les chemins absolus sont rejetés
- la traversée de chemin (`..`) est rejetée
- le chemin résolu doit rester à l'intérieur de `baseDir`
- les fichiers manquants retournent une erreur explicite `File not found`

Type de contenu :

- `.md` => `text/markdown`
- tout le reste => `text/plain`

Aucune recherche de repli n'est effectuée pour les ressources manquantes.

## Skills vs AGENTS.md, commandes, outils, hooks

### Skills vs AGENTS.md

- **Skills** : packs de capacités nommés et optionnels, sélectionnés selon le contexte de la tâche ou explicitement demandés
- **AGENTS.md/fichiers de contexte** : fichiers d'instructions persistants chargés comme capacité de fichier-contexte et fusionnés selon les règles de niveau/profondeur

`src/discovery/agents-md.ts` parcourt spécifiquement les répertoires ancêtres depuis `cwd` pour découvrir les fichiers `AGENTS.md` autonomes (jusqu'à une profondeur de 20), en excluant les segments de répertoires cachés.

### Skills vs commandes slash

- **Skills** : contenu de connaissances/workflow lisible par le modèle
- **Commandes slash** : points d'entrée de commandes invoquées par l'utilisateur
- `/skill:<name>` est un raccourci pratique qui injecte le texte du skill ; il ne modifie pas la sémantique de découverte des skills

### Skills vs outils personnalisés

- **Skills** : contenu de documentation/workflow chargé via le contexte du prompt et `read`
- **Outils personnalisés** : API d'outils exécutables appelables par le modèle avec des schémas et des effets secondaires à l'exécution

### Skills vs hooks

- **Skills** : contenu passif
- **Hooks** : intercepteurs à l'exécution pilotés par événements pouvant bloquer/modifier le comportement pendant l'exécution

## Conseils pratiques de rédaction liés à la logique de découverte

- Placez chaque skill dans son propre répertoire : `<skills-root>/<skill-name>/SKILL.md`
- Incluez toujours un frontmatter explicite avec `name` et `description`
- Conservez les ressources référencées sous le même répertoire de skill et accédez-y avec `skill://<name>/...`
- Pour une taxonomie imbriquée (`team/domain/skill`), pointez `skills.customDirectories` vers le répertoire parent imbriqué ; le scan lui-même reste non récursif
- Évitez les noms de skills dupliqués entre les sources ; la première correspondance l'emporte selon la précédence du provider
