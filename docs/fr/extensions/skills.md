---
title: Compétences
description: >-
  Système de compétences pour l'enregistrement, la découverte et l'invocation de
  capacités spécialisées dans l'agent de codage.
sidebar:
  order: 3
  label: Compétences
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# Compétences

Les compétences sont des packs de capacités adossés à des fichiers, découverts au démarrage et exposés au modèle sous forme de :

- métadonnées légères dans le prompt système (nom + description)
- contenu à la demande via `read skill://...`
- commandes interactives optionnelles `/skill:<name>`

Ce document couvre le comportement actuel à l'exécution dans `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` et `src/discovery/agents-md.ts`.

## Ce qu'est une compétence dans cette base de code

Une compétence découverte est représentée par :

- `name`
- `description`
- `filePath` (le chemin du `SKILL.md`)
- `baseDir` (répertoire de la compétence)
- métadonnées de source (`provider`, `level`, path)

Le runtime ne requiert que `name` et `path` pour la validité. En pratique, la qualité de la correspondance dépend du caractère significatif de `description`.

## Disposition requise et attentes concernant SKILL.md

### Disposition des répertoires

Pour la découverte basée sur les fournisseurs (fournisseurs native/Claude/Codex/Agents/plugin), les compétences sont découvertes **un niveau sous `skills/`** :

- `<skills-root>/<skill-name>/SKILL.md`

Les modèles imbriqués comme `<skills-root>/group/<skill>/SKILL.md` ne sont pas découverts par les chargeurs de fournisseurs.

Pour `skills.customDirectories`, l'analyse utilise la même disposition non récursive (`*/SKILL.md`).

```text
Disposition découverte par les fournisseurs (non récursive sous skills/) :

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ découvert
  ├─ pdf/
  │   └─ SKILL.md      ✅ découvert
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ non découvert par les chargeurs de fournisseurs

L'analyse des répertoires personnalisés est également non récursive, donc les chemins imbriqués sont ignorés sauf si vous pointez `customDirectories` vers ce répertoire parent imbriqué.
```

### Frontmatter de `SKILL.md`

Champs de frontmatter pris en charge sur le type de compétence :

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- les clés supplémentaires sont préservées comme métadonnées inconnues

Comportement actuel à l'exécution :

- `name` prend par défaut le nom du répertoire de la compétence
- `description` est requis pour :
  - la découverte de compétences du fournisseur natif `.xcsh` (`requireDescription: true`)
  - les analyses `skills.customDirectories` via `scanSkillsFromDir` dans `src/discovery/helpers.ts` (non récursif)
- les fournisseurs non natifs peuvent charger des compétences sans description

## Pipeline de découverte

`discoverSkills()` dans `src/extensibility/skills.ts` effectue deux passes :

1. **Fournisseurs de capacités** via `loadCapability("skills")`
2. **Répertoires personnalisés** via `scanSkillsFromDir(..., { requireDescription: true })` (énumération de répertoires à un niveau)

Si `skills.enabled` est `false`, la découverte ne retourne aucune compétence.

### Fournisseurs de compétences intégrés et priorité

L'ordre des fournisseurs est par priorité (la plus haute gagne), puis par ordre d'enregistrement en cas d'égalité.

Fournisseurs de compétences actuellement enregistrés :

1. `native` (priorité 100) — compétences utilisateur/projet `.xcsh` via `src/discovery/builtin.ts`
2. `claude` (priorité 80)
3. groupe de priorité 70 (par ordre d'enregistrement) :
   - `claude-plugins`
   - `agents`
   - `codex`

La clé de déduplication est le nom de la compétence. Le premier élément avec un nom donné l'emporte.

### Bascules de source et filtrage

`discoverSkills()` applique ces contrôles :

- bascules de source : `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- filtres glob sur le nom de compétence :
  - `ignoredSkills` (exclusion)
  - `includeSkills` (liste d'inclusion autorisée ; vide signifie tout inclure)

L'ordre de filtrage est :

1. source activée
2. non ignorée
3. incluse (si une liste d'inclusion est présente)

Pour les fournisseurs autres que codex/claude/native (par exemple `agents`, `claude-plugins`), l'activation se rabat actuellement sur : activé si **n'importe quelle** bascule de source intégrée est activée.

### Gestion des collisions et doublons

- La déduplication des capacités conserve déjà la première compétence par nom (fournisseur de priorité la plus haute)
- `extensibility/skills.ts` effectue en plus :
  - une déduplication des fichiers identiques par `realpath` (compatible avec les liens symboliques)
  - l'émission d'avertissements de collision quand un nom de compétence ultérieur entre en conflit
  - le maintien de l'API pratique `discoverSkillsFromDir({ dir, source })` comme adaptateur léger sur `scanSkillsFromDir`
- Les compétences des répertoires personnalisés sont fusionnées après les compétences des fournisseurs et suivent le même comportement de collision

## Comportement d'utilisation à l'exécution

### Exposition dans le prompt système

La construction du prompt système (`src/system-prompt.ts`) utilise les compétences découvertes comme suit :

- si l'outil `read` est disponible :
  - inclure la liste des compétences découvertes dans le prompt
- sinon :
  - omettre la liste découverte

Les sous-agents de l'outil de tâche reçoivent la liste des compétences découvertes/fournies de la session via la création normale de session ; il n'y a pas de surcharge de sélection de compétence par tâche.

### Commandes interactives `/skill:<name>`

Si `skills.enableSkillCommands` est vrai, le mode interactif enregistre une commande slash par compétence découverte.

Comportement de `/skill:<name> [args]` :

- lit le fichier de compétence directement depuis `filePath`
- supprime le frontmatter
- injecte le corps de la compétence comme message personnalisé de suivi
- ajoute les métadonnées (`Skill: <path>`, optionnellement `User: <args>`)

## Comportement de l'URL `skill://`

`src/internal-urls/skill-protocol.ts` prend en charge :

- `skill://<name>` → résout vers le `SKILL.md` de cette compétence
- `skill://<name>/<relative-path>` → résout à l'intérieur du répertoire de cette compétence

```text
Résolution d'URL skill://

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Gardes :
- rejeter les chemins absolus
- rejeter la traversée `..`
- rejeter tout chemin résolu s'échappant de <pdf-base>
```

Détails de la résolution :

- le nom de la compétence doit correspondre exactement
- les chemins relatifs sont décodés en URL
- les chemins absolus sont rejetés
- la traversée de chemin (`..`) est rejetée
- le chemin résolu doit rester à l'intérieur de `baseDir`
- les fichiers manquants retournent une erreur explicite `File not found`

Type de contenu :

- `.md` => `text/markdown`
- tout le reste => `text/plain`

Aucune recherche de repli n'est effectuée pour les ressources manquantes.

## Compétences vs AGENTS.md, commandes, outils, hooks

### Compétences vs AGENTS.md

- **Compétences** : packs de capacités nommés et optionnels, sélectionnés par le contexte de la tâche ou demandés explicitement
- **AGENTS.md/fichiers de contexte** : fichiers d'instructions persistants chargés comme capacité de fichier de contexte et fusionnés par règles de niveau/profondeur

`src/discovery/agents-md.ts` parcourt spécifiquement les répertoires ancêtres depuis `cwd` pour découvrir les fichiers `AGENTS.md` autonomes (jusqu'à une profondeur de 20), en excluant les segments de répertoires cachés.

### Compétences vs commandes slash

- **Compétences** : contenu de connaissances/workflow lisible par le modèle
- **Commandes slash** : points d'entrée de commandes invoquées par l'utilisateur
- `/skill:<name>` est un raccourci pratique qui injecte le texte de la compétence ; il ne modifie pas la sémantique de découverte des compétences

### Compétences vs outils personnalisés

- **Compétences** : contenu de documentation/workflow chargé via le contexte du prompt et `read`
- **Outils personnalisés** : API d'outils exécutables appelables par le modèle avec des schémas et des effets secondaires à l'exécution

### Compétences vs hooks

- **Compétences** : contenu passif
- **Hooks** : intercepteurs à l'exécution pilotés par événements qui peuvent bloquer/modifier le comportement pendant l'exécution

## Conseils pratiques de rédaction liés à la logique de découverte

- Placez chaque compétence dans son propre répertoire : `<skills-root>/<skill-name>/SKILL.md`
- Incluez toujours un frontmatter explicite `name` et `description`
- Conservez les ressources référencées dans le même répertoire de compétence et accédez-y avec `skill://<name>/...`
- Pour une taxonomie imbriquée (`team/domain/skill`), pointez `skills.customDirectories` vers le répertoire parent imbriqué ; l'analyse elle-même reste non récursive
- Évitez les noms de compétence en double entre les sources ; la première correspondance l'emporte par priorité de fournisseur
