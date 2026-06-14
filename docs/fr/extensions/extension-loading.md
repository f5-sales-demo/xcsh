---
title: Chargement des extensions (Modules TypeScript/JavaScript)
description: >-
  Pipeline de chargement des modules TypeScript et JavaScript pour les
  extensions, avec résolution, validation et mise en cache.
sidebar:
  order: 2
  label: Chargement des extensions
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# Chargement des extensions (Modules TypeScript/JavaScript)

Ce document explique comment l'agent de codage découvre et charge les **modules d'extension** (`.ts`/`.js`) au démarrage.

Il ne couvre **pas** les extensions de manifeste `gemini-extension.json` (documentées séparément).

## Rôle de ce sous-système

Le chargement des extensions construit une liste de fichiers d'entrée de modules, importe chaque module avec Bun, exécute sa fabrique et retourne :

- les définitions d'extensions chargées
- les erreurs de chargement par chemin (sans interrompre l'ensemble du chargement)
- un objet de runtime d'extension partagé, utilisé ultérieurement par `ExtensionRunner`

## Fichiers d'implémentation principaux

- `src/extensibility/extensions/loader.ts` — découverte des chemins + import/exécution
- `src/extensibility/extensions/index.ts` — exports publics
- `src/extensibility/extensions/runner.ts` — exécution du runtime/des événements après le chargement
- `src/discovery/builtin.ts` — fournisseur de découverte automatique natif pour les modules d'extension
- `src/config/settings.ts` — charge les paramètres fusionnés `extensions` / `disabledExtensions`

---

## Entrées du chargement des extensions

### 1) Modules d'extension natifs découverts automatiquement

`discoverAndLoadExtensions()` interroge d'abord les fournisseurs de découverte pour les éléments de capacité `extension-module`, puis ne conserve que les éléments du fournisseur `native`.

Emplacements natifs effectifs :

- Projet : `<cwd>/.xcsh/extensions`
- Utilisateur : `~/.xcsh/agent/extensions`

Les racines de chemins proviennent du fournisseur natif (`SOURCE_PATHS.native`).

Remarques :

- La découverte automatique native est actuellement basée sur `.xcsh`.
- Le format `.pi` hérité est toujours accepté dans les clés de manifeste `package.json` (`pi.extensions`), mais pas en tant que racine native ici.

### 2) Chemins configurés explicitement

Après la découverte automatique, les chemins configurés sont ajoutés et résolus.

Sources de chemins configurés dans le chemin de démarrage de session principale (`sdk.ts`) :

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

- SDK : lorsque `disableExtensionDiscovery=true`, il charge tout de même les `additionalExtensionPaths` via `loadExtensions()`.
- La construction des chemins CLI (`main.ts`) efface actuellement les chemins d'extension CLI lorsque `--no-extensions` est défini, de sorte que les options explicites `-e/--hook` ne sont pas transmises dans ce mode.

### Désactiver des modules d'extension spécifiques

Le paramètre `disabledExtensions` filtre selon le format d'identifiant d'extension :

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

1. Normalisation des espaces unicode
2. Expansion de `~`
3. Si relatif, résolution par rapport au `cwd` courant

### Si le chemin configuré est un fichier

Il est utilisé directement comme candidat d'entrée de module.

### Si le chemin configuré est un répertoire

Ordre de résolution :

1. `package.json` dans ce répertoire avec `xcsh.extensions` (ou `pi.extensions` hérité) -> utilise les entrées déclarées
2. `index.ts`
3. `index.js`
4. Sinon, analyse d'un niveau pour les entrées d'extension :
   - `*.ts` / `*.js` directs
   - `index.ts` / `index.js` dans un sous-répertoire
   - `package.json` dans un sous-répertoire avec `xcsh.extensions` / `pi.extensions`

Règles et contraintes :

- pas de découverte récursive au-delà d'un niveau de sous-répertoire
- les entrées de manifeste `extensions` déclarées sont résolues par rapport à ce répertoire de paquet
- les entrées déclarées ne sont incluses que si le fichier existe et si l'accès est autorisé
- dans les paires `*/index.{ts,js}`, TypeScript est préféré à JavaScript
- les liens symboliques sont traités comme des fichiers/répertoires éligibles

### Le comportement d'ignorance diffère selon la source

- La découverte automatique native (`discoverExtensionModulePaths` dans les assistants de découverte) utilise un glob natif avec `gitignore: true` et `hidden: false`.
- L'analyse de répertoire configuré explicitement dans `loader.ts` utilise les règles `readdir` et n'applique **pas** le filtrage gitignore.

---

## Ordre de chargement et priorité

`discoverAndLoadExtensions()` construit une liste ordonnée unique, puis appelle `loadExtensions()`.

Ordre :

1. Modules découverts automatiquement en mode natif
2. Chemins configurés explicitement (dans l'ordre fourni)

Dans `sdk.ts`, l'ordre configuré est :

1. Chemins supplémentaires de la CLI
2. `extensions` des paramètres

Déduplication :

- basée sur le chemin absolu
- le premier chemin rencontré est conservé
- les doublons ultérieurs sont ignorés

Implication : si le même chemin de module est à la fois découvert automatiquement et configuré explicitement, il est chargé une seule fois à la première position (étape de découverte automatique).

---

## Import du module et contrat de fabrique

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

### Modèle d'isolation du runtime

- Les extensions ne sont **pas isolées** (même processus/runtime).
- Elles partagent un `EventBus` et une instance `ExtensionRuntime`.
- Pendant le chargement, les méthodes d'action du runtime lèvent intentionnellement `ExtensionRuntimeNotInitializedError` ; le câblage des actions intervient ultérieurement dans `ExtensionRunner.initialize()`.

### Après le chargement

Lorsque les événements transitent par `ExtensionRunner`, les exceptions des gestionnaires sont interceptées et émises en tant qu'erreurs d'extension plutôt que de faire planter la boucle du runner.

---

## Exemples de structures minimales utilisateur/projet

### Au niveau utilisateur

```text
~/.xcsh/agent/
  config.yml
  extensions/
    guardrails.ts
    audit/
      index.ts
```

### Au niveau projet

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
