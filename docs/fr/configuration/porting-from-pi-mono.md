---
title: 'Portage depuis pi-mono : Guide pratique de fusion'
description: >-
  Guide pratique pour migrer du code depuis le monorepo pi-mono vers la base de
  code xcsh.
sidebar:
  order: 9
  label: Portage depuis pi-mono
i18n:
  sourceHash: fd4e8c09303d
  translator: machine
---

# Portage depuis pi-mono : Guide pratique de fusion

Ce guide est une liste de vérification reproductible pour porter des modifications de pi-mono vers ce dépôt.
Utilisez-le pour toute fusion : fichier unique, branche de fonctionnalité ou synchronisation complète d'une version.

## Dernier point de synchronisation

**Commit :** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`
**Date :** 2026-03-22

Mettez à jour cette section après chaque synchronisation ; ne réutilisez pas la plage précédente.

Lorsque vous démarrez une nouvelle synchronisation, générez les patches depuis ce commit :

```bash
git format-patch b21b42d032919de2f2e6920a76fa9a37c3920c0a..HEAD --stdout > changes.patch
```

## 0) Définir le périmètre

- Identifiez la référence amont (commit, tag ou PR).
- Listez les packages ou dossiers que vous prévoyez de modifier.
- Décidez quelles fonctionnalités sont dans le périmètre et lesquelles sont intentionnellement exclues.

## 1) Importer le code en toute sécurité

- Privilégiez un diff propre et ciblé plutôt qu'une copie en bloc.
- Évitez de copier les artéfacts de build ou les fichiers générés.
- Si l'amont a ajouté de nouveaux fichiers, ajoutez-les explicitement et vérifiez leur contenu.

## 2) Respecter les conventions d'extensions d'import

La plupart des sources TypeScript de production omettent `.js` dans les imports internes, mais certains points d'entrée de test/benchmark conservent `.js` pour la compatibilité ESM à l'exécution. Suivez le style existant du package local ; ne supprimez pas systématiquement les extensions.

- Dans les sources de production de `packages/coding-agent`, gardez les imports internes sans extension sauf pour l'import d'assets non-TS.
- Dans `packages/tui/test` et `packages/natives/bench`, conservez `.js` là où les fichiers environnants l'utilisent déjà.
- Conservez les vraies extensions de fichier lorsque l'outillage l'exige (par ex. `.json`, `.css`, intégrations de texte `.md`).
- Exemple : `import { x } from "./foo.js";` → `import { x } from "./foo";` (uniquement lorsque la convention du package est sans extension).

## 3) Remplacer les scopes d'import

L'amont utilise des scopes de package différents. Remplacez-les de manière cohérente.

- Remplacez les anciens scopes par le scope local utilisé ici.
- Exemples (ajustez en fonction des packages réellement portés) :
  - `@mariozechner/pi-coding-agent` → `@f5-sales-demo/xcsh`
  - `@mariozechner/pi-agent-core` → `@f5-sales-demo/pi-agent-core`
  - `@mariozechner/pi-tui` → `@f5-sales-demo/pi-tui`
  - `@mariozechner/pi-ai` → `@f5-sales-demo/pi-ai`

## 4) Utiliser les API Bun lorsqu'elles améliorent celles de Node

Nous fonctionnons sur Bun. Remplacez les API Node uniquement lorsque Bun fournit une meilleure alternative.

**À REMPLACER :**

- Lancement de processus : `child_process.spawn` → Bun Shell `$` pour les commandes simples, `Bun.spawn`/`Bun.spawnSync` pour le streaming ou les tâches longues
- E/S fichier : `fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- Clients HTTP : `node-fetch`, `axios` → `fetch` natif
- Hachage crypto : `node:crypto` → Web Crypto ou `Bun.hash`
- SQLite : `better-sqlite3` → `bun:sqlite`
- Chargement d'env : `dotenv` → Bun charge `.env` automatiquement

**NE PAS REMPLACER (ces API fonctionnent correctement dans Bun) :**

- `os.homedir()` — NE PAS remplacer par `Bun.env.HOME`, `Bun.env.HOME`, ou le littéral `"~"`
- `os.tmpdir()` — NE PAS remplacer par `Bun.env.TMPDIR || "/tmp"` ou des chemins codés en dur
- `fs.mkdtempSync()` — NE PAS remplacer par une construction manuelle de chemin
- `path.join()`, `path.resolve()`, etc. — ces fonctions conviennent

**Style d'import :** Utilisez le préfixe `node:` avec des imports de namespace uniquement (pas d'imports nommés depuis `node:fs` ou `node:path`).

**Conventions Bun supplémentaires :**

- Privilégiez Bun Shell `$` pour les commandes courtes sans streaming ; utilisez `Bun.spawn` uniquement lorsque vous avez besoin d'E/S en streaming ou de contrôle du processus.
- Utilisez `Bun.file()`/`Bun.write()` pour les fichiers et `node:fs/promises` pour les répertoires.
- Évitez les vérifications `Bun.file().exists()` ; utilisez la gestion `isEnoent` dans un try/catch.
- Préférez `Bun.sleep(ms)` aux wrappers `setTimeout`.

**Incorrect :**

```typescript
// CASSÉ : les variables d'env peuvent être undefined, "~" n'est pas résolu
const home = Bun.env.HOME || "~";
const tmp = Bun.env.TMPDIR || "/tmp";
```

**Correct :**

```typescript
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

const configDir = path.join(os.homedir(), ".config", "myapp");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myapp-"));
```

## 5) Privilégier les intégrations Bun (pas de copie)

Ne copiez pas les assets d'exécution ni les fichiers vendors au moment du build.

- Si l'amont copie des assets dans un dossier dist, remplacez par des intégrations compatibles Bun.
- Les prompts sont des fichiers `.md` statiques ; utilisez les imports texte Bun (`with { type: "text" }`) et Handlebars au lieu de chaînes de prompt inline.
- Utilisez `import.meta.dir` + `Bun.file` pour charger les ressources non-texte adjacentes.
- Gardez les assets dans le dépôt et laissez le bundler les inclure.
- Éliminez les scripts de copie sauf si l'utilisateur les demande explicitement.
- Si l'amont lit un fichier de repli bundlé à l'exécution, remplacez les lectures du système de fichiers par un import d'intégration texte Bun.
  - Exemple (repli des instructions Codex) :
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` -> supprimé
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - Utilisez `return FALLBACK_INSTRUCTIONS;` au lieu de `readFileSync(FALLBACK_PROMPT_PATH, "utf8")`

## 6) Porter `package.json` avec précaution

Traitez `package.json` comme un contrat. Fusionnez intentionnellement.

- Conservez les `name`, `version`, `type`, `exports` et `bin` existants sauf si le portage nécessite des modifications.
- Remplacez les scripts npm/node par des équivalents Bun (par ex. `bun check`, `bun test`).
- Assurez-vous que les dépendances utilisent le bon scope.
- Ne rétrogradez pas les dépendances pour corriger des erreurs de type ; mettez à jour à la place.
- Validez les liens de packages workspace et les `peerDependencies`.

## 7) Aligner le style de code et l'outillage

- Conservez les conventions de formatage existantes.
- N'introduisez pas de `any` sauf si nécessaire.
- Évitez les imports dynamiques et les imports de type inline ; utilisez uniquement des imports de premier niveau.
- Ne construisez jamais de prompts dans le code ; les prompts sont des fichiers `.md` statiques rendus avec Handlebars.
- Dans coding-agent, n'utilisez jamais `console.log`/`console.warn`/`console.error` ; utilisez `logger` depuis `@f5-sales-demo/pi-utils`.
- Utilisez `Promise.withResolvers()` au lieu de `new Promise((resolve, reject) => ...)`.
- **Pas de mots-clés `private`/`protected`/`public` sur les champs ou méthodes de classe.** Utilisez les champs privés ES `#` pour l'encapsulation ; laissez les membres accessibles sans mot-clé. La seule exception concerne les propriétés de paramètre de constructeur (`constructor(private readonly x: T)`), où le mot-clé est requis par TypeScript. Lors du portage de code amont utilisant `private foo` ou `protected bar`, convertissez en `#foo` (privé) ou `bar` nu (accessible).
- Privilégiez les helpers et utilitaires existants plutôt que du code ad-hoc nouveau.
- Préservez les modifications d'infrastructure Bun-first déjà réalisées dans ce dépôt :
  - Le runtime est Bun (pas de points d'entrée Node).
  - Le gestionnaire de packages est Bun (pas de lockfiles npm).
  - Les API Node lourdes (`child_process`, `readline`) sont remplacées par des équivalents Bun.
  - Les API Node légères (`os.homedir`, `os.tmpdir`, `fs.mkdtempSync`, `path.*`) sont conservées.
  - Les shebangs CLI utilisent `bun` (ni `node`, ni `tsx`).
  - Les packages utilisent directement les fichiers sources (pas d'étape de build TypeScript).
  - Les workflows CI exécutent Bun pour install/check/test.

## 8) Supprimer les anciennes couches de compatibilité

Sauf demande contraire, supprimez les shims de compatibilité amont.

- Supprimez les anciennes API qui ont été remplacées.
- Mettez à jour tous les sites d'appel vers la nouvelle API directement.
- Ne conservez pas de versions `*_v2` ou parallèles.

## 9) Mettre à jour la documentation et les références

- Remplacez les liens vers le dépôt pi-mono là où c'est approprié.
- Mettez à jour les exemples pour utiliser Bun et les bons scopes de package.
- Assurez-vous que les instructions du README correspondent toujours au comportement actuel du dépôt.

## 10) Valider le portage

Exécutez les vérifications standard après les modifications :

- `bun check`

Si le dépôt a déjà des vérifications en échec sans rapport avec vos modifications, signalez-le.
Les tests utilisent le runner de Bun (pas Vitest), mais n'exécutez `bun test` que sur demande explicite.

## 11) Protéger les fonctionnalités améliorées (liste des pièges de régression)

Si vous avez déjà amélioré un comportement localement, traitez ces améliorations comme **non négociables**. Avant le portage, notez
les améliorations et ajoutez des vérifications explicites pour qu'elles ne se perdent pas dans la fusion.

- **Figez le comportement attendu** : ajoutez une note courte « avant/après » pour chaque amélioration (entrées, sorties,
  valeurs par défaut, cas limites). Cela empêche un retour arrière silencieux.
- **Mappez ancien → nouveau API** : si l'amont a renommé des concepts (hooks → extensions, custom tools → tools, etc.),
  assurez-vous que chaque ancien point d'entrée est toujours connecté. Un flag ou export manqué équivaut à une fonctionnalité perdue.
- **Vérifiez les exports** : contrôlez les `exports` de `package.json`, les types publics et les fichiers barrel. Les portages amont
  oublient souvent de ré-exporter les ajouts locaux.
- **Couvrez les chemins non nominaux** : si vous avez corrigé la gestion d'erreurs, les timeouts ou la logique de repli, ajoutez un test ou au
  moins une checklist manuelle qui exerce ces chemins.
- **Vérifiez les valeurs par défaut et l'ordre de fusion des configurations** : les améliorations résident souvent dans les valeurs par défaut. Confirmez que les nouvelles valeurs par défaut
  n'ont pas été rétablies (par ex. nouvelle préséance de configuration, fonctionnalités désactivées, listes d'outils).
- **Auditez le comportement env/shell** : si vous avez corrigé l'exécution ou le sandboxing, vérifiez que le nouveau chemin utilise toujours votre
  environnement assaini et ne réintroduit pas de surcharges d'alias/fonctions.
- **Ré-exécutez des exemples ciblés** : gardez un ensemble minimal d'exemples « connus comme bons » et exécutez-les après le portage
  (flags CLI, enregistrement d'extensions, exécution d'outils).

## 12) Détecter et gérer le code remanié

Avant de porter un fichier, vérifiez si l'amont l'a significativement refactorisé :

```bash
# Comparez le fichier que vous êtes sur le point de porter avec ce que vous avez localement
git diff HEAD upstream/main -- path/to/file.ts
```

Si le diff montre que le fichier a été **remanié** (pas simplement corrigé) :

- Nouvelles abstractions, concepts renommés, modules fusionnés, flux de données modifié

Alors vous devez **lire la nouvelle implémentation en détail** avant de porter. La fusion aveugle de code remanié fait perdre des fonctionnalités car :

Note : le mode interactif a récemment été découpé en controllers/utils/types. Lors du rétro-portage de modifications associées, portez les mises à jour dans les fichiers individuels que nous avons créés et assurez-vous que le câblage de `interactive-mode.ts` reste synchronisé.

1. **Les valeurs par défaut changent silencieusement** - Une nouvelle variable `defaultFoo = [a, b]` peut remplacer un ancien `getAllFoo()` qui retournait `[a, b, c, d, e]`.

2. **Les options d'API sont supprimées** - Lorsque des systèmes fusionnent (par ex. `hooks` + `customTools` → `extensions`), les anciennes options peuvent ne pas être connectées à la nouvelle implémentation.

3. **Des chemins de code deviennent obsolètes** - Un concept renommé (par ex. `hookMessage` → `custom`) nécessite des mises à jour dans chaque instruction switch, garde de type et gestionnaire — pas seulement dans la définition.

4. **Le contexte/les capacités se réduisent** - Les anciennes API pouvaient exposer `{ logger, typebox, pi }` que les nouvelles API ont oublié d'inclure.

### Processus de portage sémantique

Lorsque l'amont a remanié un module :

1. **Lisez l'ancienne implémentation** - Comprenez ce qu'elle faisait, quelles options elle acceptait, ce qu'elle exposait.

2. **Lisez la nouvelle implémentation** - Comprenez les nouvelles abstractions et comment elles correspondent à l'ancien comportement.

3. **Vérifiez la parité fonctionnelle** - Pour chaque capacité de l'ancien code, confirmez que le nouveau code la préserve ou la supprime explicitement.

4. **Cherchez les oublis** - Recherchez les anciens noms/concepts qui ont pu être manqués dans les instructions switch, gestionnaires, composants UI.

5. **Testez les frontières** - Flags CLI, options SDK, gestionnaires d'événements, valeurs par défaut — c'est là que les régressions se cachent.

### Vérifications rapides

```bash
# Trouver toutes les utilisations d'un ancien concept qui pourrait nécessiter une mise à jour
rg "oldConceptName" --type ts

# Comparer les valeurs par défaut entre les versions
git show upstream/main:path/to/file.ts | rg "default|DEFAULT"

# Vérifier si toutes les valeurs d'enum/union ont des gestionnaires
rg "case \"" path/to/file.ts
```

## 13) Checklist d'audit rapide

Utilisez ceci comme passe finale avant de terminer :

- [ ] Les extensions d'import suivent la convention du package local (pas de suppression systématique de `.js`)
- [ ] Pas d'API exclusives à Node dans le code nouveau/porté
- [ ] Tous les scopes de package mis à jour
- [ ] Les scripts de `package.json` utilisent Bun
- [ ] Les prompts sont des imports texte `.md` (pas de chaînes de prompt inline)
- [ ] Pas de `console.*` dans coding-agent (utiliser `logger`)
- [ ] Les assets sont chargés via les patterns d'intégration Bun (pas de scripts de copie)
- [ ] Les tests ou vérifications s'exécutent (ou sont explicitement signalés comme bloqués)
- [ ] Pas de régressions fonctionnelles (voir sections 11-12)

## 14) Format des messages de commit

Lors du commit d'un rétro-portage, suivez le format du dépôt `<type>(scope): <description au passé>` et conservez la plage de commits
dans le titre.

```
fix(coding-agent): backported pi-mono changes (<from>..<to>)

packages/<package>:
- <type>: <description>
- <type>: <description> (#<issue> by @<contributor>)

packages/<other-package>:
- <type>: <description>
```

**Exemple :**

```
fix(coding-agent): backported pi-mono changes (9f3eef65f..52532c7c0)

packages/ai:
- fix: handle "sensitive" stop reason from Anthropic API
- fix: normalize tool call IDs with special characters for Responses API
- fix: add overflow detection for Bedrock, MiniMax, Kimi providers
- fix: 429 status is rate limiting, not context overflow

packages/tui:
- fix: refactored autocomplete state tracking
- fix: file autocomplete should not trigger on empty text
- fix: configurable autocomplete max visible items
- fix: improved table column width calculation with word-aware wrapping

packages/coding-agent:
- fix: preserve external config.yml edits on save (#1046 by @nicobailonMD)
- fix: resolve macOS NFD and curly quote variants in file paths
```

**Règles :**

- Regroupez les modifications par package
- Utilisez les types de commit conventionnels (`fix`, `feat`, `refactor`, `perf`, `docs`)
- Incluez les numéros d'issue/PR amont et l'attribution des contributeurs pour les contributions externes
- La plage de commits dans le titre aide à suivre les points de synchronisation

## 15) Divergences intentionnelles

Notre fork a des décisions architecturales qui diffèrent de l'amont. **Ne portez pas ces patterns amont :**

### Architecture UI

| Amont                                       | Notre fork                                                | Raison                                                                |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| Classe `FooterDataProvider`                 | `StatusLineComponent`                                     | Ligne de statut plus simple et intégrée                               |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | Stub en modes non-TUI                                     | Implémenté dans TUI, no-op ailleurs                                   |
| `ctx.ui.setEditorComponent()`               | Stub en modes non-TUI                                     | Implémenté dans TUI, no-op ailleurs                                   |
| Objet d'options `InteractiveModeOptions`    | Arguments positionnels de constructeur (le type d'options reste exporté) | Conserver la signature du constructeur ; mettre à jour le type lorsque l'amont ajoute des champs |

### Nommage des composants

| Amont                        | Notre fork              |
| ---------------------------- | ----------------------- |
| `extension-input.ts`         | `hook-input.ts`         |
| `extension-selector.ts`      | `hook-selector.ts`      |
| `ExtensionInputComponent`    | `HookInputComponent`    |
| `ExtensionSelectorComponent` | `HookSelectorComponent` |

### Nommage des API

| Amont                                    | Notre fork                               | Notes                                     |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)`    | Nous utilisons `sessionName` partout      |
| `sessionManager.getSessionName()`        | `sessionManager.getSessionName()`        | Identique (nous avons unifié pour correspondre au RPC de l'amont) |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | Identique                                 |

### Consolidation de fichiers

| Amont                                              | Notre fork                              | Raison                                  |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts` (fichiers d'outils) | Module clipboard de `@f5-sales-demo/pi-natives` | Fusionné dans l'implémentation native N-API |

### Framework de test

| Amont                     | Notre fork                    |
| ------------------------- | ----------------------------- |
| `vitest` avec `vi.mock()` | `bun:test` avec `vi` de bun  |
| Assertions `node:test`    | Matchers `expect()`           |

### Architecture des outils

| Amont                               | Notre fork                                                        | Notes                                                     |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `createTool(cwd: string, options?)` | `createTools(session: ToolSession)` via le registre `BUILTIN_TOOLS` | Les factories d'outils acceptent `ToolSession` et peuvent retourner `null` |
| Interfaces `*Operations` par outil  | Les interfaces par outil restent (`FindOperations`, `GrepOperations`) | Utilisées pour les surcharges SSH/distantes              |
| `fs/promises` Node.js partout       | `Bun.file()`/`Bun.write()` pour les fichiers ; `node:fs/promises` pour les répertoires | Privilégier les API Bun quand elles simplifient          |

### Stockage de l'authentification

| Amont                           | Notre fork                                  | Notes                                        |
| ------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `proper-lockfile` + `auth.json` | `agent.db` (bun:sqlite)                     | Identifiants stockés exclusivement dans `agent.db` |
| Un seul identifiant par fournisseur | Multi-identifiants avec sélection round-robin | Affinité de session et logique de backoff préservées |

### Extensions

| Amont                             | Notre fork                                 |
| --------------------------------- | ------------------------------------------ |
| `jiti` pour le chargement TypeScript | `import()` natif de Bun                   |
| Champ de manifeste `pkg.pi`       | `pkg.xcsh ?? pkg.pi` (privilégier notre namespace) |

### Ignorer ces fonctionnalités amont

Lors du portage, **ignorez** ces fichiers/fonctionnalités entièrement :

- `footer-data-provider.ts` — nous utilisons StatusLineComponent
- `clipboard-image.ts` — le clipboard est dans le module N-API `@f5-sales-demo/pi-natives`
- Fichiers de workflow GitHub — nous avons notre propre CI
- `models.generated.ts` — auto-généré, regénérer localement (sous forme de models.json à la place)

### Fonctionnalités que nous avons ajoutées (à préserver)

Celles-ci existent dans notre fork mais pas dans l'amont. **Ne jamais écraser :**

- `StatusLineComponent` en mode interactif
- Authentification multi-identifiants avec affinité de session
- Système de découverte basé sur les capacités (`defineCapability`, `registerProvider`, `loadCapability`, `skillCapability`, etc.)
- Intégrations MCP/Exa/SSH
- Writethrough LSP pour le formatage à la sauvegarde
- Interception Bash (`checkBashInterception`)
- Suggestions de chemin floues dans l'outil de lecture
