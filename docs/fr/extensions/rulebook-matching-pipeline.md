---
title: Pipeline de correspondance du Rulebook
description: >-
  Pipeline de correspondance du rulebook pour la sélection et l'application
  d'ensembles d'instructions spécifiques au contexte dans les sessions d'agent.
sidebar:
  order: 6
  label: Correspondance du rulebook
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# Pipeline de correspondance du Rulebook

Ce document décrit comment coding-agent découvre les règles à partir des formats de configuration pris en charge, les normalise dans une forme unique `Rule`, résout les conflits de précédence, et divise le résultat en :

- **Règles du Rulebook** (disponibles pour le modèle via le prompt système + les URLs `rule://`)
- **Règles TTSR** (règles d'interruption de flux time-travel)

Il reflète l'implémentation actuelle, y compris les sémantiques partielles et les métadonnées qui sont analysées mais non appliquées.

## Fichiers d'implémentation

- [`../src/capability/rule.ts`](../../packages/coding-agent/src/capability/rule.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/discovery/index.ts`](../../packages/coding-agent/src/discovery/index.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/cursor.ts`](../../packages/coding-agent/src/discovery/cursor.ts)
- [`../src/discovery/windsurf.ts`](../../packages/coding-agent/src/discovery/windsurf.ts)
- [`../src/discovery/cline.ts`](../../packages/coding-agent/src/discovery/cline.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/system-prompt.ts`](../../packages/coding-agent/src/system-prompt.ts)
- [`../src/internal-urls/rule-protocol.ts`](../../packages/coding-agent/src/internal-urls/rule-protocol.ts)
- [`../src/utils/frontmatter.ts`](../../packages/coding-agent/src/utils/frontmatter.ts)

## 1. Forme canonique d'une règle

Tous les fournisseurs normalisent les fichiers sources en `Rule` :

```ts
interface Rule {
  name: string;
  path: string;
  content: string;
  globs?: string[];
  alwaysApply?: boolean;
  description?: string;
  ttsrTrigger?: string;
  _source: SourceMeta;
}
```

L'identité de la capacité est `rule.name` (`ruleCapability.key = rule => rule.name`).

Conséquence : la précédence et la déduplication sont **basées uniquement sur le nom**. Deux fichiers différents ayant le même `name` sont considérés comme la même règle logique.

## 2. Sources de découverte et normalisation

`src/discovery/index.ts` enregistre automatiquement les fournisseurs. Pour les `rules`, les fournisseurs actuels sont :

- `native` (priorité `100`)
- `cursor` (priorité `50`)
- `windsurf` (priorité `50`)
- `cline` (priorité `40`)

### Fournisseur natif (`builtin.ts`)

Charge les règles `.xcsh` depuis :

- projet : `<cwd>/.xcsh/rules/*.{md,mdc}`
- utilisateur : `~/.xcsh/agent/rules/*.{md,mdc}`

Normalisation :

- `name` = nom du fichier sans `.md`/`.mdc`
- le frontmatter est analysé via `parseFrontmatter`
- `content` = corps (frontmatter retiré)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` mappés directement

Mise en garde importante : `globs` est casté en `string[] | undefined` sans filtrage des éléments dans ce fournisseur.

### Fournisseur Cursor (`cursor.ts`)

Charge depuis :

- utilisateur : `~/.cursor/rules/*.{mdc,md}`
- projet : `<cwd>/.cursor/rules/*.{mdc,md}`

Normalisation (`transformMDCRule`) :

- `description` : conservée uniquement si c'est une chaîne de caractères
- `alwaysApply` : seul `true` est préservé (`false` devient `undefined`)
- `globs` : accepte un tableau (éléments de type string uniquement) ou une chaîne unique
- `ttsr_trigger` : chaîne de caractères uniquement
- `name` à partir du nom de fichier sans extension

### Fournisseur Windsurf (`windsurf.ts`)

Charge depuis :

- utilisateur : `~/.codeium/windsurf/memories/global_rules.md` (nom de règle fixe `global_rules`)
- projet : `<cwd>/.windsurf/rules/*.md`

Normalisation :

- `globs` : tableau de chaînes ou chaîne unique
- `alwaysApply`, `description` castés depuis le frontmatter
- `ttsr_trigger` : chaîne de caractères uniquement
- `name` à partir du nom de fichier pour les règles de projet

### Fournisseur Cline (`cline.ts`)

Recherche vers le haut depuis `cwd` le `.clinerules` le plus proche :

- si c'est un répertoire : charge les `*.md` à l'intérieur
- si c'est un fichier : charge le fichier unique comme règle nommée `clinerules`

Normalisation :

- `globs` : tableau de chaînes ou chaîne unique
- `alwaysApply` : uniquement si c'est un booléen
- `description` : chaîne de caractères uniquement
- `ttsr_trigger` : chaîne de caractères uniquement

## 3. Comportement de l'analyse du frontmatter et ambiguïtés

Tous les fournisseurs utilisent `parseFrontmatter` (`utils/frontmatter.ts`) avec ces sémantiques :

1. Le frontmatter est analysé uniquement lorsque le contenu commence par `---` et possède un `\n---` de fermeture.
2. Le corps est nettoyé (trimmed) après l'extraction du frontmatter.
3. Si l'analyse YAML échoue :
   - un avertissement est journalisé,
   - l'analyseur se rabat sur une analyse ligne par ligne simple `key: value` (`^(\w+):\s*(.*)$`).

Conséquences des ambiguïtés :

- L'analyseur de repli ne prend pas en charge les tableaux, les objets imbriqués, les règles de guillemets ou les clés avec tirets.
- Les valeurs de repli deviennent des chaînes de caractères (par exemple `alwaysApply: true` devient la chaîne `"true"`), donc les fournisseurs nécessitant des types booléen/chaîne peuvent perdre des métadonnées.
- `ttsr_trigger` fonctionne en mode repli (clé avec underscore) ; des clés comme `thinking-level` ne fonctionneraient pas.
- Les fichiers sans frontmatter valide sont tout de même chargés comme règles avec des métadonnées vides et le corps complet du contenu.

## 4. Précédence des fournisseurs et déduplication

`loadCapability("rules")` (`capability/index.ts`) fusionne les sorties des fournisseurs puis déduplique par `rule.name`.

### Modèle de précédence

- Les fournisseurs sont ordonnés par priorité décroissante.
- En cas de priorité égale, l'ordre d'enregistrement est conservé (`cursor` avant `windsurf` dans `discovery/index.ts`).
- La déduplication fonctionne en « premier arrivé, premier servi » : le premier nom de règle rencontré est conservé ; les éléments ultérieurs portant le même nom sont marqués `_shadowed` dans `all` et exclus de `items`.

L'ordre effectif des fournisseurs de règles est actuellement :

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### Mise en garde sur l'ordre intra-fournisseur

Au sein d'un fournisseur, l'ordre des éléments provient de l'ordonnancement des résultats glob de `loadFilesFromDir` plus l'ordre explicite d'insertion (push). Ceci est suffisamment déterministe pour un usage normal mais n'est pas explicitement trié dans le code.

Différences notables d'ordre des sources :

- `native` ajoute les répertoires de configuration du projet puis de l'utilisateur.
- `cursor` ajoute les résultats de l'utilisateur puis du projet.
- `windsurf` ajoute d'abord le `global_rules` utilisateur, puis les règles du projet.
- `cline` charge uniquement la source `.clinerules` la plus proche.

## 5. Répartition en catégories Rulebook, Always-Apply et TTSR

Après la découverte des règles dans `createAgentSession` (`sdk.ts`) :

1. Toutes les règles découvertes sont analysées.
2. Les règles avec `condition` (clé de frontmatter ; `ttsr_trigger` / `ttsrTrigger` accepté comme alternative) sont enregistrées dans le `TtsrManager`.
3. Une liste distincte `rulebookRules` est construite avec ce prédicat :

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. Une liste `alwaysApplyRules` est construite :

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### Comportement des catégories

- **Catégorie TTSR** : toute règle avec `condition` (description non requise). Prioritaire sur les autres catégories.
- **Catégorie always-apply** : `alwaysApply === true`, non TTSR. Le contenu complet est injecté dans le prompt système. Accessible via `rule://`.
- **Catégorie rulebook** : doit avoir une description, ne doit pas être TTSR, ne doit pas être `alwaysApply`. Listée dans le prompt système par nom+description ; le contenu est lu à la demande via `rule://`.
- Une règle avec à la fois `condition` et `alwaysApply` va uniquement dans TTSR (TTSR est prioritaire).
- Une règle avec à la fois `alwaysApply` et `description` va uniquement dans always-apply (pas dans le rulebook).

## 6. Comment les métadonnées affectent les surfaces d'exécution

### `description`

- Requise pour l'inclusion dans le rulebook.
- Affichée dans le bloc `<rules>` du prompt système.
- En l'absence de description, la règle n'est pas disponible via `rule://` et n'est pas listée dans les règles du prompt système.

### `globs`

- Transporté dans `Rule`.
- Affiché sous forme d'entrées `<glob>...</glob>` dans le bloc des règles du prompt système.
- Exposé dans l'état de l'interface utilisateur des règles (liste de mode `extensions`).
- **Non appliqué pour la correspondance automatique dans ce pipeline.** Il n'y a pas de matcher glob à l'exécution qui sélectionne les règles en fonction du fichier courant ou de la cible de l'outil.

### `alwaysApply`

- Analysé et préservé par les fournisseurs.
- Utilisé dans l'affichage de l'interface utilisateur (libellé de déclencheur `"always"` dans le gestionnaire d'état des extensions).
- Utilisé comme condition d'exclusion de `rulebookRules`.
- **Le contenu complet de la règle est automatiquement injecté dans le prompt système** (avant la section des règles du rulebook).
- La règle est également accessible via `rule://<name>` pour relecture.

### `ttsr_trigger`

- Mappé vers `rule.ttsrTrigger`.
- Si présent, la règle est routée vers le gestionnaire TTSR, pas vers le rulebook.

## 7. Chemin d'inclusion dans le prompt système

`buildSystemPromptInternal` reçoit à la fois `rules` (rulebook) et `alwaysApplyRules`.

Les règles always-apply sont rendues en premier, en injectant leur contenu brut directement dans le prompt.

Les règles du rulebook sont rendues dans une section `# Rules` avec :

- `Read rule://<name> when working in matching domain`
- Le `name`, la `description` et la liste optionnelle de `<glob>` de chaque règle

Ceci est indicatif/contextuel : le texte du prompt demande au modèle de lire les règles applicables, mais le code n'applique pas la correspondance des globs.

## 8. Comportement de l'URL interne `rule://`

`RuleProtocolHandler` est enregistré avec :

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

Implications :

- `rule://<name>` résout contre les **rulebookRules** et les **alwaysApplyRules**.
- Les règles exclusivement TTSR et les règles sans description et sans `alwaysApply` ne sont pas accessibles via `rule://`.
- La résolution est une correspondance exacte du nom.
- Les noms inconnus retournent une erreur listant les noms de règles disponibles.
- Le contenu retourné est le `rule.content` brut (frontmatter retiré), avec le type de contenu `text/markdown`.

## 9. Sémantiques partielles / non appliquées connues

1. Les descriptions des fournisseurs mentionnent des fichiers hérités (`.cursorrules`, `.windsurfrules`), mais les chemins de code du chargeur actuel ne lisent pas réellement ces fichiers.
2. Les métadonnées `globs` sont exposées au prompt/à l'interface utilisateur mais ne sont pas appliquées par la logique de sélection des règles.
3. La sélection de règles pour `rule://` inclut les règles du rulebook et always-apply, mais pas les règles exclusivement TTSR.
4. Les avertissements de découverte (`loadCapability("rules").warnings`) sont produits mais `createAgentSession` ne les expose/journalise pas actuellement dans ce chemin.
