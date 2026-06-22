---
title: Compétences
description: >-
  Système de compétences pour enregistrer, découvrir et invoquer des capacités
  spécialisées dans l'agent de codage.
sidebar:
  order: 3
  label: Compétences
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# Compétences

Les compétences sont des packs de capacités stockés dans des fichiers, découverts au démarrage et exposés au modèle sous la forme :

- de métadonnées légères dans le prompt système (nom + description)
- de contenu à la demande via `read skill://...`
- de commandes interactives optionnelles `/skill:<name>`

Ce document décrit le comportement actuel du moteur d'exécution dans `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` et `src/discovery/agents-md.ts`.

## Ce qu'est une compétence dans cette base de code

Une compétence découverte est représentée par :

- `name`
- `description`
- `filePath` (le chemin `SKILL.md`)
- `baseDir` (répertoire de la compétence)
- métadonnées de source (`provider`, `level`, chemin)

Le moteur d'exécution exige uniquement `name` et `path` pour la validité. En pratique, la qualité de la correspondance dépend du caractère significatif de la `description`.

## Structure requise et attentes relatives à SKILL.md

### Structure des répertoires

Pour la découverte basée sur les fournisseurs (fournisseurs natifs/Claude/Codex/Agents/plugin), les compétences sont découvertes à **un niveau sous `skills/`** :

- `<skills-root>/<skill-name>/SKILL.md`

Les structures imbriquées telles que `<skills-root>/group/<skill>/SKILL.md` ne sont pas découvertes par les chargeurs de fournisseurs.

Pour `skills.customDirectories`, l'analyse utilise la même structure non récursive (`*/SKILL.md`).

```text
Structure découverte par les fournisseurs (non récursive sous skills/) :

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ découvert
  ├─ pdf/
  │   └─ SKILL.md      ✅ découvert
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ non découvert par les chargeurs de fournisseurs

L'analyse des répertoires personnalisés est également non récursive, les chemins imbriqués sont donc ignorés, sauf si vous faites pointer `customDirectories` vers ce répertoire parent imbriqué.
```

### Frontmatter de `SKILL.md`

Champs frontmatter pris en charge sur le type de compétence :

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- les clés supplémentaires sont conservées en tant que métadonnées inconnues

Comportement actuel du moteur d'exécution :

- `name` prend par défaut le nom du répertoire de la compétence
- `description` est requise pour :
  - la découverte de compétences du fournisseur `.xcsh` natif (`requireDescription: true`)
  - les analyses `skills.customDirectories` via `scanSkillsFromDir` dans `src/discovery/helpers.ts` (non récursif)
- les fournisseurs non natifs peuvent charger des compétences sans description

## Pipeline de découverte

`discoverSkills()` dans `src/extensibility/skills.ts` effectue deux passes :

1. **Fournisseurs de capacités** via `loadCapability("skills")`
2. **Répertoires personnalisés** via `scanSkillsFromDir(..., { requireDescription: true })` (énumération de répertoires à un niveau)

Si `skills.enabled` est `false`, la découverte ne renvoie aucune compétence.

### Fournisseurs de compétences intégrés et précédence

L'ordre des fournisseurs est prioritaire (la valeur la plus élevée l'emporte), puis l'ordre d'enregistrement pour les égalités.

Fournisseurs de compétences actuellement enregistrés :

1. `native` (priorité 100) — compétences utilisateur/projet `.xcsh` via `src/discovery/builtin.ts`
2. `claude` (priorité 80)
3. groupe de priorité 70 (dans l'ordre d'enregistrement) :
   - `claude-plugins`
   - `agents`
   - `codex`

La clé de déduplication est le nom de la compétence. Le premier élément portant un nom donné l'emporte.

### Bascules de source et filtrage

`discoverSkills()` applique ces contrôles :

- bascules de source : `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- filtres glob sur le nom de compétence :
  - `ignoredSkills` (exclusion)
  - `includeSkills` (liste d'autorisation d'inclusion ; vide signifie tout inclure)

L'ordre des filtres est :

1. source activée
2. non ignorée
3. incluse (si la liste d'inclusion est présente)

Pour les fournisseurs autres que codex/claude/native (par exemple `agents`, `claude-plugins`), l'activation revient actuellement à : activé si **n'importe quelle** bascule de source intégrée est activée.

### Gestion des collisions et des doublons

- La déduplication des capacités conserve déjà la première compétence par nom (fournisseur de priorité la plus élevée)
- `extensibility/skills.ts` en outre :
  - déduplique les fichiers identiques par `realpath` (compatible avec les liens symboliques)
  - émet des avertissements de collision lorsqu'un nom de compétence ultérieur est en conflit
  - conserve l'API pratique `discoverSkillsFromDir({ dir, source })` comme adaptateur allégé sur `scanSkillsFromDir`
- Les compétences des répertoires personnalisés sont fusionnées après les compétences des fournisseurs et suivent le même comportement de collision

## Comportement d'utilisation au moment de l'exécution

### Exposition dans le prompt système

La construction du prompt système (`src/system-prompt.ts`) utilise les compétences découvertes comme suit :

- si l'outil `read` est disponible :
  - inclure la liste des compétences découvertes dans le prompt
- sinon :
  - omettre la liste découverte

Les sous-agents d'outils de tâche reçoivent la liste de compétences découvertes/fournies de la session via la création de session normale ; il n'existe pas de remplacement d'épinglage de compétences par tâche.

### Commandes interactives `/skill:<name>`

Si `skills.enableSkillCommands` est true, le mode interactif enregistre une commande slash par compétence découverte.

Comportement de `/skill:<name> [args]` :

- lit le fichier de compétence directement depuis `filePath`
- supprime le frontmatter
- injecte le corps de la compétence en tant que message personnalisé de suivi
- ajoute des métadonnées (`Skill: <path>`, `User: <args>` optionnel)

## Comportement des URL `skill://`

`src/internal-urls/skill-protocol.ts` prend en charge :

- `skill://<name>` → résout vers le `SKILL.md` de cette compétence
- `skill://<name>/<relative-path>` → résout à l'intérieur du répertoire de cette compétence

```text
Résolution des URL skill://

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Protections :
- rejette les chemins absolus
- rejette la traversée `..`
- rejette tout chemin résolu qui sort de <pdf-base>
```

Détails de résolution :

- le nom de la compétence doit correspondre exactement
- les chemins relatifs sont décodés en URL
- les chemins absolus sont rejetés
- la traversée de chemin (`..`) est rejetée
- le chemin résolu doit rester dans `baseDir`
- les fichiers manquants renvoient une erreur explicite `File not found`

Type de contenu :

- `.md` => `text/markdown`
- tout le reste => `text/plain`

Aucune recherche de secours n'est effectuée pour les ressources manquantes.

## Compétences vs XCSH.md, commandes, outils, hooks

### Compétences vs XCSH.md

- **Compétences** : packs de capacités nommés et optionnels, sélectionnés par le contexte de la tâche ou explicitement demandés
- **XCSH.md/fichiers de contexte** : fichiers d'instructions persistants chargés en tant que capacité de fichier de contexte et fusionnés selon les règles de niveau/profondeur

`src/discovery/agents-md.ts` parcourt spécifiquement les répertoires ancêtres depuis `cwd` pour découvrir les fichiers `XCSH.md` autonomes (jusqu'à une profondeur de 20), en excluant les segments de répertoires cachés.

### Compétences vs commandes slash

- **Compétences** : contenu de connaissances/flux de travail lisible par le modèle
- **Commandes slash** : points d'entrée de commandes invoquées par l'utilisateur
- `/skill:<name>` est un raccourci pratique qui injecte le texte de la compétence ; il ne modifie pas la sémantique de découverte des compétences

### Compétences vs outils personnalisés

- **Compétences** : contenu de documentation/flux de travail chargé via le contexte du prompt et `read`
- **Outils personnalisés** : API d'outils exécutables appelables par le modèle avec des schémas et des effets secondaires au moment de l'exécution

### Compétences vs hooks

- **Compétences** : contenu passif
- **Hooks** : intercepteurs d'exécution pilotés par événements pouvant bloquer/modifier le comportement durant l'exécution

## Conseils de création pratiques liés à la logique de découverte

- Placez chaque compétence dans son propre répertoire : `<skills-root>/<skill-name>/SKILL.md`
- Incluez toujours un frontmatter explicite `name` et `description`
- Conservez les ressources référencées sous le même répertoire de compétence et accédez-y avec `skill://<name>/...`
- Pour une taxonomie imbriquée (`team/domain/skill`), faites pointer `skills.customDirectories` vers le répertoire parent imbriqué ; l'analyse elle-même reste non récursive
- Évitez les noms de compétences dupliqués entre les sources ; la première correspondance l'emporte selon la précédence du fournisseur
