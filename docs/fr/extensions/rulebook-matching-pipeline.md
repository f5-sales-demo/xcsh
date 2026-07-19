---
title: Pipeline de correspondance du Rulebook
description: >-
  Pipeline de correspondance du rulebook pour la sélection et l'application
  d'ensembles d'instructions spécifiques au contexte dans les sessions d'agent.
sidebar:
  order: 6
  label: Correspondance du rulebook
i18n:
  sourceHash: 6c9ad8adc175
  translator: machine
---

# Pipeline de correspondance du Rulebook

Ce document décrit comment coding-agent découvre les règles à partir des formats de configuration pris en charge, les normalise en une forme `Rule` unique, résout les conflits de précédence et divise le résultat en :

- **Règles du Rulebook** (disponibles pour le modèle via le prompt système + URLs `rule://`)
- **Règles TTSR** (règles d'interruption de flux time-travel)

Il reflète l'implémentation actuelle, y compris les sémantiques partielles et les métadonnées qui sont analysées mais non appliquées.

## Fichiers d'implémentation

- [`../src/capability/rule.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/capability/rule.ts)
- [`../src/capability/index.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/capability/index.ts)
- [`../src/discovery/index.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/discovery/index.ts)
- [`../src/discovery/helpers.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/discovery/helpers.ts)
- [`../src/discovery/builtin.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/cursor.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/discovery/cursor.ts)
- [`../src/discovery/windsurf.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/discovery/windsurf.ts)
- [`../src/discovery/cline.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/discovery/cline.ts)
- [`../src/sdk.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/sdk.ts)
- [`../src/system-prompt.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/system-prompt.ts)
- [`../src/internal-urls/rule-protocol.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/internal-urls/rule-protocol.ts)
- [`../src/utils/frontmatter.ts`](https://github.com/f5-sales-demo/xcsh/blob/main/packages/coding-agent/src/utils/frontmatter.ts)

## 1. Forme canonique de la règle

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

Conséquence : la précédence et la déduplication sont **basées uniquement sur le nom**. Deux fichiers différents portant le même `name` sont considérés comme la même règle logique.

## 2. Sources de découverte et normalisation

`src/discovery/index.ts` enregistre automatiquement les fournisseurs. Pour `rules`, les fournisseurs actuels sont :

- `native` (priorité `100`)
- `cursor` (priorité `50`)
- `windsurf` (priorité `50`)
- `cline` (priorité `40`)

### Fournisseur natif (`builtin.ts`)

Charge les règles `.xcsh` depuis :

- projet : `<cwd>/.xcsh/rules/*.{md,mdc}`
- utilisateur : `~/.xcsh/agent/rules/*.{md,mdc}`

Normalisation :

- `name` = nom de fichier sans `.md`/`.mdc`
- frontmatter analysé via `parseFrontmatter`
- `content` = corps (frontmatter retiré)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` mappés directement

Mise en garde importante : `globs` est converti en `string[] | undefined` sans filtrage des éléments dans ce fournisseur.

### Fournisseur Cursor (`cursor.ts`)

Charge depuis :

- utilisateur : `~/.cursor/rules/*.{mdc,md}`
- projet : `<cwd>/.cursor/rules/*.{mdc,md}`

Normalisation (`transformMDCRule`) :

- `description` : conservé uniquement si chaîne de caractères
- `alwaysApply` : seul `true` est préservé (`false` devient `undefined`)
- `globs` : accepte un tableau (éléments chaîne uniquement) ou une chaîne unique
- `ttsr_trigger` : chaîne uniquement
- `name` à partir du nom de fichier sans extension

### Fournisseur Windsurf (`windsurf.ts`)

Charge depuis :

- utilisateur : `~/.codeium/windsurf/memories/global_rules.md` (nom de règle fixe `global_rules`)
- projet : `<cwd>/.windsurf/rules/*.md`

Normalisation :

- `globs` : tableau de chaînes ou chaîne unique
- `alwaysApply`, `description` convertis depuis le frontmatter
- `ttsr_trigger` : chaîne uniquement
- `name` à partir du nom de fichier pour les règles de projet

### Fournisseur Cline (`cline.ts`)

Recherche en remontant depuis `cwd` le `.clinerules` le plus proche :

- si répertoire : charge les `*.md` qu'il contient
- si fichier : charge le fichier unique comme règle nommée `clinerules`

Normalisation :

- `globs` : tableau de chaînes ou chaîne unique
- `alwaysApply` : uniquement si booléen
- `description` : chaîne uniquement
- `ttsr_trigger` : chaîne uniquement

## 3. Comportement de l'analyse du frontmatter et ambiguïté

Tous les fournisseurs utilisent `parseFrontmatter` (`utils/frontmatter.ts`) avec ces sémantiques :

1. Le frontmatter est analysé uniquement lorsque le contenu commence par `---` et possède un `\n---` de fermeture.
2. Le corps est nettoyé (trim) après l'extraction du frontmatter.
3. Si l'analyse YAML échoue :
   - un avertissement est journalisé,
   - l'analyseur bascule vers une analyse simple ligne par ligne `key: value` (`^(\w+):\s*(.*)$`).

Conséquences liées à l'ambiguïté :

- L'analyseur de repli ne prend pas en charge les tableaux, les objets imbriqués, les règles de citation ou les clés avec tirets.
- Les valeurs de repli deviennent des chaînes (par exemple `alwaysApply: true` devient la chaîne `"true"`), de sorte que les fournisseurs nécessitant des types booléen/chaîne peuvent perdre des métadonnées.
- `ttsr_trigger` fonctionne en mode repli (clé avec underscore) ; des clés comme `thinking-level` ne fonctionneraient pas.
- Les fichiers sans frontmatter valide sont tout de même chargés comme règles avec des métadonnées vides et le contenu complet comme corps.

## 4. Précédence des fournisseurs et déduplication

`loadCapability("rules")` (`capability/index.ts`) fusionne les sorties des fournisseurs puis déduplique par `rule.name`.

### Modèle de précédence

- Les fournisseurs sont ordonnés par priorité décroissante.
- À priorité égale, l'ordre d'enregistrement est conservé (`cursor` avant `windsurf` depuis `discovery/index.ts`).
- La déduplication fonctionne en premier arrivé, premier servi : le premier nom de règle rencontré est conservé ; les éléments ultérieurs portant le même nom sont marqués `_shadowed` dans `all` et exclus de `items`.

L'ordre effectif des fournisseurs de règles est actuellement :

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### Mise en garde sur l'ordre intra-fournisseur

Au sein d'un fournisseur, l'ordre des éléments provient de l'ordre des résultats du glob de `loadFilesFromDir` plus l'ordre explicite d'ajout (push). Ceci est suffisamment déterministe pour une utilisation normale mais n'est pas explicitement trié dans le code.

Différences notables d'ordre selon les sources :

- `native` ajoute les répertoires de configuration du projet puis ceux de l'utilisateur.
- `cursor` ajoute les résultats de l'utilisateur puis ceux du projet.
- `windsurf` ajoute d'abord le `global_rules` de l'utilisateur, puis les règles du projet.
- `cline` charge uniquement la source `.clinerules` la plus proche.

## 5. Répartition dans les catégories Rulebook, Always-Apply et TTSR

Après la découverte des règles dans `createAgentSession` (`sdk.ts`) :

1. Toutes les règles découvertes sont parcourues.
2. Les règles avec `condition` (clé frontmatter ; `ttsr_trigger` / `ttsrTrigger` accepté comme alternative) sont enregistrées dans `TtsrManager`.
3. Une liste `rulebookRules` séparée est construite avec ce prédicat :

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. Une liste `alwaysApplyRules` est construite :

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### Comportement des catégories

- **Catégorie TTSR** : toute règle avec `condition` (description non requise). Prend la priorité sur les autres catégories.
- **Catégorie always-apply** : `alwaysApply === true`, non TTSR. Le contenu complet est injecté dans le prompt système. Résolvable via `rule://`.
- **Catégorie rulebook** : doit avoir une description, ne doit pas être TTSR, ne doit pas être `alwaysApply`. Listée dans le prompt système par nom+description ; le contenu est lu à la demande via `rule://`.
- Une règle ayant à la fois `condition` et `alwaysApply` va uniquement dans TTSR (TTSR a la priorité).
- Une règle ayant à la fois `alwaysApply` et `description` va uniquement dans always-apply (pas dans le rulebook).

## 6. Comment les métadonnées affectent les surfaces d'exécution

### `description`

- Requis pour l'inclusion dans le rulebook.
- Affiché dans le bloc `<rules>` du prompt système.
- L'absence de description signifie que la règle n'est pas disponible via `rule://` et n'est pas listée dans les règles du prompt système.

### `globs`

- Transporté sur `Rule`.
- Affiché comme entrées `<glob>...</glob>` dans le bloc des règles du prompt système.
- Exposé dans l'état UI des règles (liste de mode `extensions`).
- **Non appliqué pour la correspondance automatique dans ce pipeline.** Il n'y a pas de matcher de glob à l'exécution sélectionnant les règles par fichier courant/cible d'outil.

### `alwaysApply`

- Analysé et préservé par les fournisseurs.
- Utilisé dans l'affichage UI (libellé de déclencheur `"always"` dans le gestionnaire d'état des extensions).
- Utilisé comme condition d'exclusion de `rulebookRules`.
- **Le contenu complet de la règle est auto-injecté dans le prompt système** (avant la section des règles du rulebook).
- La règle est également accessible via `rule://<name>` pour relecture.

### `ttsr_trigger`

- Mappé vers `rule.ttsrTrigger`.
- Si présent, la règle est routée vers le gestionnaire TTSR, pas vers le rulebook.

## 7. Chemin d'inclusion dans le prompt système

`buildSystemPromptInternal` reçoit à la fois `rules` (rulebook) et `alwaysApplyRules`.

Les règles always-apply sont rendues en premier, injectant leur contenu brut directement dans le prompt.

Les règles du rulebook sont rendues dans une section `# Rules` avec :

- `Read rule://<name> when working in matching domain`
- Le `name`, la `description` de chaque règle, et la liste optionnelle de `<glob>`

Ceci est consultatif/contextuel : le texte du prompt demande au modèle de lire les règles applicables, mais le code n'applique pas l'applicabilité des globs.

## 8. Comportement de l'URL interne `rule://`

`RuleProtocolHandler` est enregistré avec :

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

Implications :

- `rule://<name>` résout à la fois les **rulebookRules** et les **alwaysApplyRules**.
- Les règles uniquement TTSR et les règles sans description et sans `alwaysApply` ne sont pas accessibles via `rule://`.
- La résolution est une correspondance exacte de nom.
- Les noms inconnus renvoient une erreur listant les noms de règles disponibles.
- Le contenu retourné est le `rule.content` brut (frontmatter retiré), type de contenu `text/markdown`.

## 9. Sémantiques partielles / non appliquées connues

1. Les descriptions des fournisseurs mentionnent des fichiers hérités (`.cursorrules`, `.windsurfrules`), mais les chemins de code de chargement actuels ne lisent pas réellement ces fichiers.
2. Les métadonnées `globs` sont exposées au prompt/UI mais ne sont pas appliquées par la logique de sélection des règles.
3. La sélection de règles pour `rule://` inclut les règles du rulebook et always-apply, mais pas les règles uniquement TTSR.
4. Les avertissements de découverte (`loadCapability("rules").warnings`) sont produits mais `createAgentSession` ne les expose/journalise pas actuellement dans ce chemin.
