---
title: Gemini Manifest Extensions
description: >-
  Gemini manifest extension format for cross-platform skill and agent
  compatibility.
sidebar:
  order: 7
  label: Manifeste Gemini
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Extensions de manifeste Gemini (`gemini-extension.json`)

Ce document décrit comment le coding-agent découvre et analyse les extensions de manifeste de style Gemini (`gemini-extension.json`) dans la capacité `extensions`.

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

Règle de portée importante : la recherche projet est **limitée au cwd uniquement**. Elle ne remonte pas les répertoires parents.

---

## Règles d'analyse des répertoires

Pour chaque racine (`~/.gemini/extensions` et `<cwd>/.gemini/extensions`), la découverte effectue :

1. `readDirEntries(root)`
2. ne conserve que les répertoires enfants directs (`entry.isDirectory()`)
3. pour chaque enfant `<name>`, tente de lire exactement :
   - `<root>/<name>/gemini-extension.json`

Il n'y a pas d'analyse récursive au-delà d'un niveau de répertoire.

### Répertoires cachés

La découverte de manifeste Gemini ne filtre **pas** les noms de répertoires préfixés par un point. Si un répertoire enfant caché existe et contient `gemini-extension.json`, il est pris en compte.

### Fichiers manquants/illisibles

Si `gemini-extension.json` est manquant ou illisible, ce répertoire est ignoré silencieusement (pas d'avertissement).

---

## Structure du manifeste (telle qu'implémentée)

Le type de capacité définit cette structure de manifeste :

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

Le comportement au moment de la découverte est intentionnellement souple :

- Le succès de l'analyse JSON est requis.
- Il n'y a pas de validation de schéma à l'exécution pour les types/contenus des champs au-delà de la syntaxe JSON.
- L'objet analysé est stocké comme `manifest` sur l'élément de capacité.

### Normalisation du nom

`Extension.name` est défini comme :

1. `manifest.name` s'il n'est pas `null`/`undefined`
2. sinon le nom du répertoire de l'extension

Aucune vérification de type chaîne n'est appliquée ici.

---

## Matérialisation en éléments de capacité

Un manifeste analysé valide crée un élément de capacité `Extension` :

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // attached by capability registry
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

Notes :

- `_source.path` est normalisé en chemin absolu par `createSourceMeta()`.
- La validation de capacité au niveau du registre pour `extensions` vérifie uniquement la présence de `name` et `path`.
- Les éléments internes du manifeste (`mcpServers`, `tools`, `context`) ne sont pas validés lors de la découverte.

---

## Gestion des erreurs et sémantique des avertissements

### Avec avertissement

- JSON invalide dans un fichier de manifeste :
  - format de l'avertissement : `Invalid JSON in <manifestPath>`

### Sans avertissement (ignoré silencieusement)

- Répertoire `extensions` manquant
- Le répertoire enfant n'a pas de `gemini-extension.json`
- Fichier de manifeste illisible
- Le JSON du manifeste est syntaxiquement valide mais sémantiquement étrange/incomplet

Cela signifie que la validité partielle est acceptée : seul un échec syntaxique JSON émet un avertissement.

---

## Précédence et déduplication avec d'autres sources

La capacité `extensions` est agrégée entre les fournisseurs par le registre de capacités.

Fournisseurs actuels pour cette capacité :

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) priorité `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) priorité `60`

La clé de déduplication est `ext.name` (`extensionCapability.key = ext => ext.name`).

### Précédence inter-fournisseurs

Le fournisseur de priorité la plus élevée l'emporte sur les noms d'extension en double.

- Si `native` et `gemini` émettent tous deux le nom d'extension `foo`, l'élément native est conservé.
- Le doublon de priorité inférieure est conservé uniquement dans `result.all` avec `_shadowed = true`.

### Effets d'ordre intra-fournisseur

Comme la déduplication fonctionne sur le principe « premier vu gagne », l'ordre local des éléments du fournisseur est important.

- Le chargeur Gemini ajoute d'abord les éléments **utilisateur**, puis **projet**.
- Par conséquent, les noms en double entre `~/.gemini/extensions` et `<cwd>/.gemini/extensions` conservent l'entrée utilisateur et masquent l'entrée projet.

En revanche, le fournisseur native construit l'ordre des répertoires de configuration différemment (`project` puis `user` dans `getConfigDirs()`), donc le masquage intra-fournisseur native va dans la direction opposée.

---

## Résumé du comportement utilisateur vs projet

Pour les manifestes Gemini spécifiquement :

- Les racines utilisateur et projet sont toutes deux analysées à chaque chargement.
- La racine projet est fixée à `<cwd>/.gemini/extensions` (pas de remontée vers les ancêtres).
- Les noms en double au sein de la source Gemini se résolvent en faveur de l'utilisateur.
- Les noms en double par rapport aux fournisseurs de priorité supérieure (notamment native) perdent par priorité.

---

## Frontière : métadonnées de découverte vs chargement d'extension à l'exécution

La découverte de `gemini-extension.json` alimente actuellement les métadonnées de capacité (éléments `Extension`). Elle ne charge **pas** directement des modules d'extension TS/JS exécutables.

Le chargement de modules à l'exécution (`discoverAndLoadExtensions()` / `loadExtensions()`) utilise `extension-modules` et des chemins explicites, et filtre actuellement les modules auto-découverts uniquement pour le fournisseur `native`.

Implication pratique :

- Les extensions de manifeste Gemini sont découvrables en tant qu'enregistrements de capacité.
- Elles ne sont pas, en elles-mêmes, exécutées comme modules d'extension à l'exécution par le pipeline de chargement d'extensions.

Cette frontière est intentionnelle dans l'implémentation actuelle et explique pourquoi la découverte de manifeste et le chargement de modules exécutables peuvent diverger.
