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

La résolution de chemin s'effectue directement depuis `ctx.home` et `ctx.cwd` via `getUserPath()` / `getProjectPath()`.

Règle de portée importante : la recherche dans le projet est **limitée au répertoire courant (cwd)**. Elle ne remonte pas les répertoires parents.

---

## Règles d'analyse des répertoires

Pour chaque racine (`~/.gemini/extensions` et `<cwd>/.gemini/extensions`), la découverte effectue les opérations suivantes :

1. `readDirEntries(root)`
2. ne conserver que les sous-répertoires directs (`entry.isDirectory()`)
3. pour chaque enfant `<name>`, tenter de lire exactement :
   - `<root>/<name>/gemini-extension.json`

Il n'y a pas d'analyse récursive au-delà d'un niveau de répertoire.

### Répertoires cachés

La découverte de manifestes Gemini ne filtre **pas** les noms de répertoires préfixés par un point. Si un sous-répertoire caché existe et contient un fichier `gemini-extension.json`, il est pris en compte.

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
- Il n'y a pas de validation de schéma à l'exécution pour les types/contenus des champs au-delà de la syntaxe JSON.
- L'objet analysé est stocké en tant que `manifest` sur l'élément de capacité.

### Normalisation du nom

`Extension.name` est défini comme suit :

1. `manifest.name` s'il n'est pas `null`/`undefined`
2. sinon, le nom du répertoire de l'extension

Aucun contrôle de type chaîne n'est appliqué ici.

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
- La validation des capacités au niveau du registre pour `extensions` vérifie uniquement la présence de `name` et `path`.
- Les éléments internes du manifeste (`mcpServers`, `tools`, `context`) ne sont pas validés lors de la découverte.

---

## Gestion des erreurs et sémantique des avertissements

### Avec avertissement

- JSON invalide dans un fichier manifeste :
  - format d'avertissement : `Invalid JSON in <manifestPath>`

### Sans avertissement (ignoré silencieusement)

- répertoire `extensions` absent
- le sous-répertoire ne contient pas de fichier `gemini-extension.json`
- fichier manifeste illisible
- le JSON du manifeste est syntaxiquement valide mais sémantiquement incomplet ou inhabituel

Cela signifie que la validité partielle est acceptée : seul un échec syntaxique JSON déclenche un avertissement.

---

## Priorité et déduplication avec d'autres sources

La capacité `extensions` est agrégée entre les fournisseurs par le registre de capacités.

Fournisseurs actuels pour cette capacité :

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) priorité `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) priorité `60`

La clé de déduplication est `ext.name` (`extensionCapability.key = ext => ext.name`).

### Priorité entre fournisseurs

Le fournisseur de priorité supérieure l'emporte en cas de noms d'extensions identiques.

- Si `native` et `gemini` émettent tous deux le nom d'extension `foo`, l'élément natif est conservé.
- Le doublon de priorité inférieure est conservé uniquement dans `result.all` avec `_shadowed = true`.

### Effets de l'ordre intra-fournisseur

Étant donné que la déduplication fonctionne selon le principe « premier arrivé, premier servi », l'ordre des éléments au sein d'un fournisseur a son importance.

- Le chargeur Gemini ajoute d'abord les entrées **utilisateur**, puis les entrées **projet**.
- Par conséquent, les noms en double entre `~/.gemini/extensions` et `<cwd>/.gemini/extensions` conservent l'entrée utilisateur et masquent l'entrée projet.

En revanche, le fournisseur natif construit l'ordre des répertoires de configuration différemment (`project` puis `user` dans `getConfigDirs()`), de sorte que le masquage intra-fournisseur natif s'effectue dans la direction opposée.

---

## Résumé du comportement utilisateur vs projet

Pour les manifestes Gemini spécifiquement :

- Les deux racines, utilisateur et projet, sont analysées à chaque chargement.
- La racine du projet est fixée à `<cwd>/.gemini/extensions` (sans remontée des répertoires parents).
- Les noms en double au sein de la source Gemini sont résolus en faveur de l'utilisateur.
- Les noms en double face aux fournisseurs de priorité supérieure (notamment natif) sont perdants par priorité.

---

## Limite : métadonnées de découverte vs chargement d'extension à l'exécution

La découverte de `gemini-extension.json` alimente actuellement les métadonnées de capacité (éléments `Extension`). Elle ne charge **pas** directement les modules d'extension TS/JS exécutables.

Le chargement des modules à l'exécution (`discoverAndLoadExtensions()` / `loadExtensions()`) utilise `extension-modules` et des chemins explicites, et filtre actuellement les modules découverts automatiquement au seul fournisseur `native`.

Implication pratique :

- Les extensions de manifeste Gemini sont découvrables en tant qu'enregistrements de capacités.
- Elles ne sont pas, à elles seules, exécutées en tant que modules d'extension à l'exécution par le pipeline de chargement des extensions.

Cette limite est intentionnelle dans l'implémentation actuelle et explique pourquoi la découverte de manifestes et le chargement de modules exécutables peuvent diverger.
