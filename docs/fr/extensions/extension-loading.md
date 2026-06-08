---
title: Extension Loading (TypeScript/JavaScript Modules)
description: >-
  TypeScript and JavaScript module loading pipeline for extensions with
  resolution, validation, and caching.
sidebar:
  order: 2
  label: Chargement des extensions
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# Chargement des extensions (modules TypeScript/JavaScript)

Ce document couvre la manière dont l'agent de codage découvre et charge les **modules d'extension** (`.ts`/`.js`) au démarrage.

Il ne couvre **pas** les extensions de manifeste `gemini-extension.json` (documentées séparément).

## Ce que fait ce sous-système

Le chargement des extensions construit une liste de fichiers d'entrée de modules, importe chaque module avec Bun, exécute sa factory et retourne :

- les définitions d'extensions chargées
- les erreurs de chargement par chemin (sans interrompre l'ensemble du chargement)
- un objet runtime d'extension partagé, utilisé ultérieurement par `ExtensionRunner`

## Fichiers d'implémentation principaux

- `src/extensibility/extensions/loader.ts` — découverte des chemins + import/exécution
- `src/extensibility/extensions/index.ts` — exports publics
- `src/extensibility/extensions/runner.ts` — runtime/exécution des événements après le chargement
- `src/discovery/builtin.ts` — fournisseur natif de découverte automatique pour les modules d'extension
- `src/config/settings.ts` — charge les paramètres fusionnés `extensions` / `disabledExtensions`

---

## Entrées du chargement des extensions

### 1) Modules d'extension natifs découverts automatiquement

`discoverAndLoadExtensions()` interroge d'abord les fournisseurs de découverte pour les éléments de capacité `extension-module`, puis ne conserve que les éléments du fournisseur `native`.

Emplacements natifs effectifs :

- Projet : `<cwd>/.xcsh/extensions`
- Utilisateur : `~/.xcsh/agent/extensions`

Les racines de chemin proviennent du fournisseur natif (`SOURCE_PATHS.native`).

Notes :

- La découverte automatique native est actuellement basée sur `.xcsh`.
- L'ancien format `.pi` est toujours accepté dans les clés de manifeste `package.json` (`pi.extensions`), mais pas comme racine native ici.

### 2) Chemins configurés explicitement

Après la découverte automatique, les chemins configurés sont ajoutés et résolus.

Sources des chemins configurés dans le chemin de démarrage de session principal (`sdk.ts`) :

1. Chemins fournis via CLI (`--extension/-e`, et `--hook` est également traité comme un chemin d'extension)
2. Tableau `extensions` des paramètres (paramètres globaux + projet fusionnés)

Fichier de paramètres globaux :

- `~/.xcsh/agent/config.yml` (ou répertoire d'agent personnalisé via `PI_CODING_AGENT_DIR`)

Fichier de paramètres du projet :

- `<cwd>/.xcsh/settings.json`

Exemples :

```yaml
# ~/.xcsh/agent/config.yml
extensions:
  - ~/my-exts/safety.ts
  - ./local/ext-pack
```

```json
{
  "extensions": ["./.xcsh/extensions/my-extra"]
}
```

---

## Contrôles d'activation/désactivation

### Désactiver la découverte

- CLI : `--no-extensions`
- Option SDK : `disableExtensionDiscovery`

Comportement différencié :

- SDK : lorsque `disableExtensionDiscovery=true`, il charge toujours les `additionalExtensionPaths` via `loadExtensions()`.
- La construction des chemins CLI (`main.ts`) efface actuellement les chemins d'extension CLI lorsque `--no-extensions` est défini, donc les `-e/--hook` explicites ne sont pas transmis dans ce mode.

### Désactiver des modules d'extension spécifiques

Le paramètre `disabledExtensions` filtre par format d'identifiant d'extension :

- `extension-module:<derivedName>`

`derivedName` est basé sur le chemin d'entrée (`getExtensionNameFromPath`), par exemple :

- `/x/foo.ts` -> `foo`
- `/x/bar/index.ts` -> `bar`

Exemple :

```yaml
disabledExtensions:
  - extension-module:foo
```

---

## Résolution des chemins et des entrées

### Normalisation des chemins

Pour les chemins configurés :

1. Normaliser les espaces Unicode
2. Développer `~`
3. Si relatif, résoudre par rapport au `cwd` courant

### Si le chemin configuré est un fichier

Il est utilisé directement comme candidat d'entrée de module.

### Si le chemin configuré est un répertoire

Ordre de résolution :

1. `package.json` dans ce répertoire avec `xcsh.extensions` (ou l'ancien `pi.extensions`) -> utiliser les entrées déclarées
2. `index.ts`
3. `index.js`
4. Sinon, scanner un niveau pour les entrées d'extension :
   - fichiers directs `*.ts` / `*.js`
   - sous-répertoire `index.ts` / `index.js`
   - sous-répertoire `package.json` avec `xcsh.extensions` / `pi.extensions`

Règles et contraintes :

- pas de découverte récursive au-delà d'un niveau de sous-répertoire
- les entrées de manifeste `extensions` déclarées sont résolues relativement à ce répertoire de package
- les entrées déclarées sont incluses uniquement si le fichier existe/l'accès est autorisé
- dans les paires `*/index.{ts,js}`, TypeScript est préféré à JavaScript
- les liens symboliques sont traités comme des fichiers/répertoires éligibles

### Le comportement d'ignorance diffère selon la source

- La découverte automatique native (`discoverExtensionModulePaths` dans les helpers de découverte) utilise un glob natif avec `gitignore: true` et `hidden: false`.
- Le scan de répertoire configuré explicitement dans `loader.ts` utilise les règles `readdir` et **n'applique pas** le filtrage gitignore.

---

## Ordre de chargement et priorité

`discoverAndLoadExtensions()` construit une liste ordonnée unique puis appelle `loadExtensions()`.

Ordre :

1. Modules découverts automatiquement (natifs)
2. Chemins configurés explicitement (dans l'ordre fourni)

Dans `sdk.ts`, l'ordre configuré est :

1. Chemins supplémentaires CLI
2. `extensions` des paramètres

Dédoublonnage :

- basé sur le chemin absolu
- le premier chemin rencontré l'emporte
- les doublons ultérieurs sont ignorés

Implication : si le même chemin de module est à la fois découvert automatiquement et configuré explicitement, il est chargé une seule fois à la première position (étape de découverte automatique).

---

## Import du module et contrat de factory

Chaque chemin candidat est chargé avec un import dynamique :

- `await import(resolvedPath)`
- la factory est `module.default ?? module`
- la factory doit être une fonction (`ExtensionFactory`)

Si l'export n'est pas une fonction, ce chemin échoue avec une erreur structurée et le chargement continue.

---

## Gestion des erreurs et isolation

### Pendant le chargement

Par chemin d'extension, les échecs sont capturés sous forme de `{ path, error }` et n'empêchent pas le chargement des autres chemins.

Cas courants :

- échec d'import / fichier manquant
- export de factory invalide (non-fonction)
- exception levée lors de l'exécution de la factory

### Modèle d'isolation à l'exécution

- Les extensions ne sont **pas sandboxées** (même processus/runtime).
- Elles partagent un seul `EventBus` et une seule instance `ExtensionRuntime`.
- Pendant le chargement, les méthodes d'action du runtime lèvent intentionnellement `ExtensionRuntimeNotInitializedError` ; le câblage des actions se produit ultérieurement dans `ExtensionRunner.initialize()`.

### Après le chargement

Lorsque les événements s'exécutent via `ExtensionRunner`, les exceptions des handlers sont capturées et émises comme erreurs d'extension au lieu de faire planter la boucle du runner.

---

## Exemples minimaux de disposition utilisateur/projet

### Niveau utilisateur

```text
~/.xcsh/agent/
  config.yml
  extensions/
    guardrails.ts
    audit/
      index.ts
```

### Niveau projet

```text
<repo>/
  .xcsh/
    settings.json
    extensions/
      checks/
        package.json
      lint-gates.ts
```

`checks/package.json` :

```json
{
  "xcsh": {
    "extensions": ["./src/check-a.ts", "./src/check-b.js"]
  }
}
```

Clé de manifeste ancienne toujours acceptée :

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
