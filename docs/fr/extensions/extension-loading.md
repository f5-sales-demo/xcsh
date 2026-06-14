---
title: Chargement des extensions (modules TypeScript/JavaScript)
description: >-
  Pipeline de chargement des modules TypeScript et JavaScript pour les
  extensions, incluant la résolution, la validation et la mise en cache.
sidebar:
  order: 2
  label: Chargement des extensions
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# Chargement des extensions (modules TypeScript/JavaScript)

Ce document explique comment l'agent de codage découvre et charge les **modules d'extension** (`.ts`/`.js`) au démarrage.

Il ne couvre **pas** les extensions de manifeste `gemini-extension.json` (documentées séparément).

## Rôle de ce sous-système

Le chargement des extensions constitue une liste de fichiers d'entrée de modules, importe chaque module avec Bun, exécute sa fabrique et retourne :

- les définitions d'extensions chargées
- les erreurs de chargement par chemin (sans interrompre l'ensemble du chargement)
- un objet d'exécution d'extension partagé, utilisé ultérieurement par `ExtensionRunner`

## Fichiers d'implémentation principaux

- `src/extensibility/extensions/loader.ts` — découverte des chemins + import/exécution
- `src/extensibility/extensions/index.ts` — exports publics
- `src/extensibility/extensions/runner.ts` — exécution du runtime/événements après chargement
- `src/discovery/builtin.ts` — fournisseur de découverte automatique natif pour les modules d'extension
- `src/config/settings.ts` — charge les paramètres fusionnés `extensions` / `disabledExtensions`

---

## Entrées du chargement des extensions

### 1) Modules d'extension natifs auto-découverts

`discoverAndLoadExtensions()` interroge d'abord les fournisseurs de découverte pour les éléments de capacité `extension-module`, puis ne conserve que les éléments du fournisseur `native`.

Emplacements natifs effectifs :

- Projet : `<cwd>/.xcsh/extensions`
- Utilisateur : `~/.xcsh/agent/extensions`

Les racines de chemin proviennent du fournisseur natif (`SOURCE_PATHS.native`).

Remarques :

- La découverte automatique native est actuellement basée sur `.xcsh`.
- L'ancien `.pi` est toujours accepté dans les clés de manifeste `package.json` (`pi.extensions`), mais pas comme racine native ici.

### 2) Chemins configurés explicitement

Après la découverte automatique, les chemins configurés sont ajoutés et résolus.

Sources de chemins configurés dans le chemin de démarrage de session principal (`sdk.ts`) :

1. Chemins fournis par la CLI (`--extension/-e`, et `--hook` est également traité comme un chemin d'extension)
2. Tableau `extensions` des paramètres (paramètres globaux + projet fusionnés)

Fichier de paramètres global :

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

Comportement selon le contexte :

- SDK : lorsque `disableExtensionDiscovery=true`, il charge quand même `additionalExtensionPaths` via `loadExtensions()`.
- La construction de chemins CLI (`main.ts`) efface actuellement les chemins d'extension CLI lorsque `--no-extensions` est défini, donc les `-e/--hook` explicites ne sont pas transmis dans ce mode.

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

1. Normaliser les espaces unicode
2. Développer `~`
3. Si relatif, résoudre par rapport au `cwd` courant

### Si le chemin configuré est un fichier

Il est utilisé directement comme candidat d'entrée de module.

### Si le chemin configuré est un répertoire

Ordre de résolution :

1. `package.json` dans ce répertoire avec `xcsh.extensions` (ou l'ancien `pi.extensions`) -> utiliser les entrées déclarées
2. `index.ts`
3. `index.js`
4. Sinon, analyser un niveau pour les entrées d'extension :
   - `*.ts` / `*.js` directs
   - `index.ts` / `index.js` de sous-répertoire
   - `package.json` de sous-répertoire avec `xcsh.extensions` / `pi.extensions`

Règles et contraintes :

- pas de découverte récursive au-delà d'un niveau de sous-répertoire
- les entrées du manifeste `extensions` déclarées sont résolues par rapport à ce répertoire de paquet
- les entrées déclarées ne sont incluses que si le fichier existe et si l'accès est autorisé
- dans les paires `*/index.{ts,js}`, TypeScript est préféré à JavaScript
- les liens symboliques sont traités comme des fichiers/répertoires éligibles

### Le comportement d'ignorance diffère selon la source

- La découverte automatique native (`discoverExtensionModulePaths` dans les helpers de découverte) utilise le glob natif avec `gitignore: true` et `hidden: false`.
- L'analyse de répertoire configuré explicitement dans `loader.ts` utilise les règles `readdir` et n'applique **pas** le filtrage gitignore.

---

## Ordre de chargement et précédence

`discoverAndLoadExtensions()` construit une liste ordonnée unique, puis appelle `loadExtensions()`.

Ordre :

1. Modules auto-découverts natifs
2. Chemins configurés explicitement (dans l'ordre fourni)

Dans `sdk.ts`, l'ordre configuré est :

1. Chemins supplémentaires CLI
2. Paramètres `extensions`

Déduplication :

- basée sur le chemin absolu
- le premier chemin rencontré est retenu
- les doublons ultérieurs sont ignorés

Implication : si le même chemin de module est à la fois auto-découvert et configuré explicitement, il est chargé une seule fois à la première position (étape auto-découverte).

---

## Import de module et contrat de fabrique

Chaque chemin candidat est chargé avec un import dynamique :

- `await import(resolvedPath)`
- la fabrique est `module.default ?? module`
- la fabrique doit être une fonction (`ExtensionFactory`)

Si l'export n'est pas une fonction, ce chemin échoue avec une erreur structurée et le chargement continue.

---

## Gestion des échecs et isolation

### Pendant le chargement

Par chemin d'extension, les échecs sont capturés sous la forme `{ path, error }` et n'empêchent pas le chargement des autres chemins.

Cas courants :

- échec d'import / fichier manquant
- export de fabrique invalide (non-fonction)
- exception levée lors de l'exécution de la fabrique

### Modèle d'isolation à l'exécution

- Les extensions ne sont **pas isolées dans un bac à sable** (même processus/runtime).
- Elles partagent un seul `EventBus` et une seule instance `ExtensionRuntime`.
- Pendant le chargement, les méthodes d'action du runtime lèvent intentionnellement `ExtensionRuntimeNotInitializedError` ; le câblage des actions se produit ultérieurement dans `ExtensionRunner.initialize()`.

### Après le chargement

Lorsque les événements s'exécutent via `ExtensionRunner`, les exceptions des gestionnaires sont capturées et émises sous forme d'erreurs d'extension au lieu de faire planter la boucle du runner.

---

## Exemples de structures minimales utilisateur/projet

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

Clé de manifeste héritée toujours acceptée :

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
