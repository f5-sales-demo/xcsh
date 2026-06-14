---
title: Extensions de manifeste Gemini
description: >-
  Format d'extension de manifeste Gemini pour la compatibilité des compétences
  et agents multi-plateformes.
sidebar:
  order: 7
  label: Manifeste Gemini
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Extensions de manifeste Gemini (`gemini-extension.json`)

Ce document explique comment l'agent de codage découvre et analyse les extensions de manifeste de style Gemini (`gemini-extension.json`) dans la capacité `extensions`.

Il ne couvre **pas** le chargement des modules d'extension TypeScript/JavaScript (`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`), qui est documenté dans `extension-loading.md`.

## Fichiers d'implémentation

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## Ce qui est découvert

Le fournisseur Gemini (`id: gemini`, priorité `60`) enregistre un chargeur `extensions` qui analyse deux racines fixes :

- Utilisateur : `~/.gemini/extensions`
- Projet : `<cwd>/.gemini/extensions`

La résolution des chemins est directe depuis `ctx.home` et `ctx.cwd` via `getUserPath()` / `getProjectPath()`.

Règle de portée importante : la recherche de projet est **limitée au répertoire courant**. Elle ne remonte pas les répertoires parents.

---

## Règles d'analyse des répertoires

Pour chaque racine (`~/.gemini/extensions` et `<cwd>/.gemini/extensions`), la découverte effectue les opérations suivantes :

1. `readDirEntries(root)`
2. conserver uniquement les répertoires enfants directs (`entry.isDirectory()`)
3. pour chaque enfant `<name>`, tenter de lire exactement :
   - `<root>/<name>/gemini-extension.json`

Il n'existe pas d'analyse récursive au-delà d'un niveau de répertoire.

### Répertoires cachés

La découverte de manifeste Gemini ne filtre **pas** les noms de répertoires préfixés par un point. Si un répertoire enfant caché existe et contient `gemini-extension.json`, il est pris en compte.

### Fichiers manquants ou illisibles

Si `gemini-extension.json` est absent ou illisible, ce répertoire est ignoré silencieusement (sans avertissement).

---

## Structure du manifeste (telle qu'implémentée)

Le type de capacité définit la structure de manifeste suivante :

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

Le comportement au moment de la découverte est intentionnellement permissif :

- La réussite de l'analyse JSON est requise.
- Il n'existe pas de validation de schéma à l'exécution pour les types/contenus des champs au-delà de la syntaxe JSON.
- L'objet analysé est stocké en tant que `manifest` sur l'élément de capacité.

### Normalisation du nom

`Extension.name` est défini selon :

1. `manifest.name` s'il n'est pas `null`/`undefined`
2. sinon le nom du répertoire d'extension

Aucune application du type chaîne de caractères n'est effectuée ici.

---

## Matérialisation en éléments de capacité

Un manifeste correctement analysé crée un élément de capacité `Extension` :

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // attaché par le registre de capacités
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

Remarques :

- `_source.path` est normalisé en chemin absolu par `createSourceMeta()`.
- La validation de capacité au niveau du registre pour `extensions` vérifie uniquement la présence de `name` et `path`.
- Les éléments internes du manifeste (`mcpServers`, `tools`, `context`) ne sont pas validés lors de la découverte.

---

## Gestion des erreurs et sémantique des avertissements

### Avec avertissement

- JSON invalide dans un fichier de manifeste :
  - format de l'avertissement : `Invalid JSON in <manifestPath>`

### Sans avertissement (ignoré silencieusement)

- répertoire `extensions` absent
- le répertoire enfant ne contient pas de `gemini-extension.json`
- fichier de manifeste illisible
- le JSON du manifeste est syntaxiquement valide mais sémantiquement étrange ou incomplet

Cela signifie que la validité partielle est acceptée : seul un échec JSON syntaxique émet un avertissement.

---

## Précédence et déduplication avec d'autres sources

La capacité `extensions` est agrégée entre fournisseurs par le registre de capacités.

Fournisseurs actuels pour cette capacité :

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) priorité `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) priorité `60`

La clé de déduplication est `ext.name` (`extensionCapability.key = ext => ext.name`).

### Précédence inter-fournisseurs

Le fournisseur à priorité plus élevée l'emporte en cas de noms d'extension en double.

- Si `native` et `gemini` émettent tous deux le nom d'extension `foo`, l'élément natif est conservé.
- Le doublon de priorité inférieure n'est conservé que dans `result.all` avec `_shadowed = true`.

### Effets d'ordre intra-fournisseur

Étant donné que la déduplication fonctionne selon le principe « premier arrivé, premier servi », l'ordre des éléments locaux au fournisseur a de l'importance.

- Le chargeur Gemini ajoute **l'utilisateur en premier**, puis **le projet**.
- Par conséquent, les noms en double entre `~/.gemini/extensions` et `<cwd>/.gemini/extensions` conservent l'entrée utilisateur et masquent l'entrée projet.

En revanche, le fournisseur natif construit l'ordre des répertoires de configuration différemment (`project` puis `user` dans `getConfigDirs()`), de sorte que le masquage intra-fournisseur natif s'effectue dans la direction opposée.

---

## Résumé du comportement utilisateur vs projet

Pour les manifestes Gemini spécifiquement :

- Les deux racines utilisateur et projet sont analysées à chaque chargement.
- La racine du projet est fixée à `<cwd>/.gemini/extensions` (sans remontée vers les répertoires ancêtres).
- Les noms en double au sein de la source Gemini se résolvent en faveur de l'utilisateur.
- Les noms en double par rapport aux fournisseurs de priorité plus élevée (notamment natif) sont écartés par priorité.

---

## Frontière : métadonnées de découverte vs chargement d'extensions à l'exécution

La découverte de `gemini-extension.json` alimente actuellement les métadonnées de capacité (éléments `Extension`). Elle ne charge **pas** directement les modules d'extension TS/JS exécutables.

Le chargement des modules à l'exécution (`discoverAndLoadExtensions()` / `loadExtensions()`) utilise `extension-modules` et des chemins explicites, et filtre actuellement les modules découverts automatiquement au fournisseur `native` uniquement.

Implication pratique :

- Les extensions de manifeste Gemini sont découvrables en tant qu'enregistrements de capacité.
- Elles ne sont pas, par elles-mêmes, exécutées en tant que modules d'extension à l'exécution par le pipeline du chargeur d'extensions.

Cette frontière est intentionnelle dans l'implémentation actuelle et explique pourquoi la découverte de manifeste et le chargement de modules exécutables peuvent diverger.
