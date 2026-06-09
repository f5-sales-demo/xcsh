---
title: Stockage de session et modèle d'entrée
description: >-
  Modèle de stockage de session en ajout uniquement avec types d'entrées,
  persistance et migration entre formats.
sidebar:
  order: 1
  label: Stockage et modèle d'entrée
i18n:
  sourceHash: 42fe17549e00
  translator: machine
---

# Stockage de session et modèle d'entrée

Ce document constitue la source de vérité concernant la représentation, la persistance, la migration et la reconstruction à l'exécution des sessions de l'agent de codage.

## Portée

Couvre :

- Le format JSONL de session et le versionnage
- La taxonomie des entrées et la sémantique arborescente (`id`/`parentId` + pointeur de feuille)
- Le comportement de migration/compatibilité lors du chargement de fichiers anciens ou malformés
- La reconstruction de contexte (`buildSessionContext`)
- Les garanties de persistance, le comportement en cas d'échec, la troncature/externalisation en blobs
- Les abstractions de stockage (`FileSessionStorage`, `MemorySessionStorage`) et utilitaires associés

Ne couvre pas le comportement de rendu de l'interface `/tree` au-delà des sémantiques qui affectent les données de session.

## Fichiers d'implémentation

- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`src/session/messages.ts`](../../packages/coding-agent/src/session/messages.ts)
- [`src/session/session-storage.ts`](../../packages/coding-agent/src/session/session-storage.ts)
- [`src/session/history-storage.ts`](../../packages/coding-agent/src/session/history-storage.ts)
- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts)

## Organisation sur le disque

Emplacement par défaut du fichier de session :

```text
~/.xcsh/agent/sessions/--<cwd-encoded>--/<timestamp>_<sessionId>.jsonl
```

`<cwd-encoded>` est dérivé du répertoire de travail en supprimant le slash initial et en remplaçant `/`, `\\` et `:` par `-`.

Emplacement du magasin de blobs :

```text
~/.xcsh/agent/blobs/<sha256>
```

Les fichiers de fil d'Ariane du terminal sont écrits sous :

```text
~/.xcsh/agent/terminal-sessions/<terminal-id>
```

Le contenu du fil d'Ariane comprend deux lignes : le répertoire de travail original, puis le chemin du fichier de session. `continueRecent()` privilégie ce pointeur rattaché au terminal avant de rechercher le mtime le plus récent.

## Format de fichier

Les fichiers de session sont en JSONL : un objet JSON par ligne.

- La ligne 1 est toujours l'en-tête de session (`type: "session"`).
- Les lignes restantes sont des valeurs `SessionEntry`.
- Les entrées sont en ajout uniquement à l'exécution ; la navigation entre branches déplace un pointeur (`leafId`) plutôt que de modifier les entrées existantes.

### En-tête (`SessionHeader`)

```json
{
  "type": "session",
  "version": 3,
  "id": "1f9d2a6b9c0d1234",
  "timestamp": "2026-02-16T10:20:30.000Z",
  "cwd": "/work/pi",
  "title": "optional session title",
  "parentSession": "optional lineage marker"
}
```

Notes :

- `version` est optionnel dans les fichiers v1 ; l'absence signifie v1.
- `parentSession` est une chaîne de lignée opaque. Le code actuel écrit soit un identifiant de session, soit un chemin de session selon le flux (`fork`, `forkFrom`, `createBranchedSession`, ou `newSession({ parentSession })` explicite). À traiter comme métadonnée, pas comme clé étrangère typée.

### Base d'entrée (`SessionEntryBase`)

Toutes les entrées non-en-tête incluent :

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

`parentId` peut être `null` pour une entrée racine (premier ajout, ou après `resetLeaf()`).

## Taxonomie des entrées

`SessionEntry` est l'union de :

- `message`
- `thinking_level_change`
- `model_change`
- `compaction`
- `branch_summary`
- `custom`
- `custom_message`
- `label`
- `ttsr_injection`
- `session_init`
- `mode_change`

### `message`

Stocke directement un `AgentMessage`.

```json
{
  "type": "message",
  "id": "a1b2c3d4",
  "parentId": null,
  "timestamp": "2026-02-16T10:21:00.000Z",
  "message": {
    "role": "assistant",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "content": [{ "type": "text", "text": "Done." }],
    "usage": { "input": 100, "output": 20, "cacheRead": 0, "cacheWrite": 0, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } },
    "timestamp": 1760000000000
  }
}
```

### `model_change`

```json
{
  "type": "model_change",
  "id": "b1c2d3e4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:21:30.000Z",
  "model": "openai/gpt-4o",
  "role": "default"
}
```

`role` est optionnel ; l'absence est traitée comme `default` lors de la reconstruction de contexte.

### `thinking_level_change`

```json
{
  "type": "thinking_level_change",
  "id": "c1d2e3f4",
  "parentId": "b1c2d3e4",
  "timestamp": "2026-02-16T10:22:00.000Z",
  "thinkingLevel": "high"
}
```

### `compaction`

```json
{
  "type": "compaction",
  "id": "d1e2f3a4",
  "parentId": "c1d2e3f4",
  "timestamp": "2026-02-16T10:23:00.000Z",
  "summary": "Conversation summary",
  "shortSummary": "Short recap",
  "firstKeptEntryId": "a1b2c3d4",
  "tokensBefore": 42000,
  "details": { "readFiles": ["src/a.ts"] },
  "preserveData": { "hookState": true },
  "fromExtension": false
}
```

### `branch_summary`

```json
{
  "type": "branch_summary",
  "id": "e1f2a3b4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:24:00.000Z",
  "fromId": "a1b2c3d4",
  "summary": "Summary of abandoned path",
  "details": { "note": "optional" },
  "fromExtension": true
}
```

Si le branchement se fait depuis la racine (`branchFromId === null`), `fromId` est la chaîne littérale `"root"`.

### `custom`

Persistance d'état d'extension ; ignoré par `buildSessionContext`.

```json
{
  "type": "custom",
  "id": "f1a2b3c4",
  "parentId": "e1f2a3b4",
  "timestamp": "2026-02-16T10:25:00.000Z",
  "customType": "my-extension",
  "data": { "state": 1 }
}
```

### `custom_message`

Message fourni par une extension qui participe au contexte LLM.

```json
{
  "type": "custom_message",
  "id": "a2b3c4d5",
  "parentId": "f1a2b3c4",
  "timestamp": "2026-02-16T10:26:00.000Z",
  "customType": "my-extension",
  "content": "Injected context",
  "display": true,
  "details": { "debug": false }
}
```

### `label`

```json
{
  "type": "label",
  "id": "b2c3d4e5",
  "parentId": "a2b3c4d5",
  "timestamp": "2026-02-16T10:27:00.000Z",
  "targetId": "a1b2c3d4",
  "label": "checkpoint"
}
```

`label: undefined` efface un label pour `targetId`.

### `ttsr_injection`

```json
{
  "type": "ttsr_injection",
  "id": "c2d3e4f5",
  "parentId": "b2c3d4e5",
  "timestamp": "2026-02-16T10:28:00.000Z",
  "injectedRules": ["ruleA", "ruleB"]
}
```

### `session_init`

```json
{
  "type": "session_init",
  "id": "d2e3f4a5",
  "parentId": "c2d3e4f5",
  "timestamp": "2026-02-16T10:29:00.000Z",
  "systemPrompt": "...",
  "task": "...",
  "tools": ["read", "edit"],
  "outputSchema": { "type": "object" }
}
```

### `mode_change`

```json
{
  "type": "mode_change",
  "id": "e2f3a4b5",
  "parentId": "d2e3f4a5",
  "timestamp": "2026-02-16T10:30:00.000Z",
  "mode": "plan",
  "data": { "planFile": "/tmp/plan.md" }
}
```

## Versionnage et migration

Version actuelle de session : `3`.

### v1 -> v2

Appliquée lorsque le `version` de l'en-tête est absent ou `< 2` :

- Ajoute `id` et `parentId` à chaque entrée non-en-tête.
- Reconstruit une chaîne parentale linéaire en utilisant l'ordre du fichier.
- Migre le champ de compaction `firstKeptEntryIndex` -> `firstKeptEntryId` lorsqu'il est présent.
- Définit `version = 2` dans l'en-tête.

### v2 -> v3

Appliquée lorsque le `version` de l'en-tête est `< 3` :

- Pour les entrées `message` : réécrit l'ancien `message.role === "hookMessage"` en `"custom"`.
- Définit `version = 3` dans l'en-tête.

### Déclenchement de migration et persistance

- Les migrations s'exécutent pendant le chargement de session (`setSessionFile`).
- Si une migration a été exécutée, le fichier entier est réécrit sur le disque immédiatement.
- La migration modifie d'abord les entrées en mémoire, puis persiste le JSONL réécrit.

## Comportement de chargement et compatibilité

Comportement de `loadEntriesFromFile(path)` :

- Fichier manquant (`ENOENT`) -> retourne `[]`.
- Les lignes non analysables sont gérées par le parseur JSONL tolérant (`parseJsonlLenient`).
- Si la première entrée analysée n'est pas un en-tête de session valide (`type !== "session"` ou `id` de type chaîne manquant) -> retourne `[]`.

Comportement de `SessionManager.setSessionFile()` :

- `[]` du chargeur est traité comme une session vide/inexistante et remplacé par un nouveau fichier de session initialisé à ce chemin.
- Les fichiers valides sont chargés, migrés si nécessaire, les références blob résolues, puis indexés.

## Sémantique de l'arbre et des feuilles

Le modèle sous-jacent est un arbre en ajout uniquement + pointeur de feuille mutable :

- Chaque méthode d'ajout crée exactement une nouvelle entrée dont le `parentId` est le `leafId` actuel.
- La nouvelle entrée devient le nouveau `leafId`.
- `branch(entryId)` déplace uniquement `leafId` ; les entrées existantes restent inchangées.
- `resetLeaf()` définit `leafId = null` ; le prochain ajout crée une nouvelle entrée racine (`parentId: null`).
- `branchWithSummary()` définit la feuille sur la cible de branchement et ajoute une entrée `branch_summary`.

`getEntries()` retourne toutes les entrées non-en-tête dans l'ordre d'insertion. Les entrées existantes ne sont pas supprimées en fonctionnement normal ; les réécritures préservent l'historique logique tout en mettant à jour la représentation (migrations, déplacement, utilitaires de réécriture ciblée).

## Reconstruction de contexte (`buildSessionContext`)

`buildSessionContext(entries, leafId, byId?)` résout ce qui est envoyé au modèle.

Algorithme :

1. Déterminer la feuille :
   - `leafId === null` -> retourner un contexte vide.
   - `leafId` explicite -> utiliser cette entrée si trouvée.
   - sinon se rabattre sur la dernière entrée.
2. Parcourir la chaîne `parentId` de la feuille à la racine et inverser pour obtenir le chemin racine->feuille.
3. Dériver l'état d'exécution le long du chemin :
   - `thinkingLevel` depuis le dernier `thinking_level_change` (par défaut `"off"`)
   - Table de correspondance des modèles depuis les entrées `model_change` (`role ?? "default"`)
   - `models.default` de secours depuis le provider/modèle du message assistant si aucun changement de modèle explicite
   - `injectedTtsrRules` dédupliquées depuis toutes les entrées `ttsr_injection`
   - mode/modeData depuis le dernier `mode_change` (mode par défaut `"none"`)
4. Construire la liste de messages :
   - Les entrées `message` passent directement
   - Les entrées `custom_message` deviennent des AgentMessages `custom` via `createCustomMessage`
   - Les entrées `branch_summary` deviennent des AgentMessages `branchSummary` via `createBranchSummaryMessage`
   - Si une `compaction` existe sur le chemin :
     - Émettre d'abord le résumé de compaction (`createCompactionSummaryMessage`)
     - Émettre les entrées du chemin à partir de `firstKeptEntryId` jusqu'à la frontière de compaction
     - Émettre les entrées après la frontière de compaction

Les entrées `custom` et `session_init` n'injectent pas directement de contexte de modèle.

## Garanties de persistance et modèle de défaillance

### Persistance vs en mémoire

- `SessionManager.create/open/continueRecent/forkFrom` -> mode persistant (`persist = true`).
- `SessionManager.inMemory` -> mode non persistant (`persist = false`) avec `MemorySessionStorage`.

### Pipeline d'écriture

Les écritures sont sérialisées via une chaîne de promesses interne (`#persistChain`) et `NdjsonFileWriter`.

- `append*` met à jour l'état en mémoire immédiatement.
- La persistance est différée jusqu'à ce qu'au moins un message assistant existe.
  - Avant le premier assistant : les entrées sont conservées en mémoire ; aucun ajout au fichier n'a lieu.
  - Lorsque le premier assistant existe : la session complète en mémoire est vidée vers le fichier.
  - Par la suite : les nouvelles entrées sont ajoutées de manière incrémentale.

Justification dans le code : éviter de persister des sessions qui n'ont jamais produit de réponse assistant.

### Opérations de durabilité

- `flush()` vide l'écrivain et appelle `fsync()`.
- Les réécritures complètes atomiques (`#rewriteFile`) écrivent dans un fichier temporaire, vident+fsync, ferment, puis renomment par-dessus la cible.
- Utilisées pour les migrations, `setSessionName`, `rewriteEntries`, les opérations de déplacement et les réécritures d'arguments d'appels d'outils.

### Comportement en cas d'erreur

- Les erreurs de persistance sont verrouillées (`#persistError`) et relancées lors des opérations suivantes.
- La première erreur est journalisée une seule fois avec le contexte du fichier de session.
- La fermeture de l'écrivain est en best-effort mais propage la première erreur significative.

## Contrôles de taille des données et externalisation en blobs

Avant de persister les entrées :

- Les chaînes volumineuses sont tronquées à `MAX_PERSIST_CHARS` (500 000 caractères) avec mention :
  - `"[Session persistence truncated large content]"`
- Les champs transitoires `partialJson` et `jsonlEvents` sont supprimés.
- Si l'objet possède à la fois `content` et `lineCount`, le nombre de lignes est recalculé après troncature.
- Les blocs image dans les tableaux `content` avec une longueur base64 >= 1024 sont externalisés en références blob :
  - stockés sous la forme `blob:sha256:<hash>`
  - les octets bruts sont écrits dans le magasin de blobs (`BlobStore.put`)

Au chargement, les références blob sont résolues en base64 pour les blocs image des entrées message/custom_message.

## Abstractions de stockage

L'interface `SessionStorage` fournit toutes les opérations de système de fichiers utilisées par `SessionManager` :

- synchrones : `ensureDirSync`, `existsSync`, `writeTextSync`, `statSync`, `listFilesSync`
- asynchrones : `exists`, `readText`, `readTextPrefix`, `writeText`, `rename`, `unlink`, `openWriter`

Implémentations :

- `FileSessionStorage` : système de fichiers réel (Bun + node fs)
- `MemorySessionStorage` : implémentation en mémoire basée sur une map pour les tests/sessions non persistantes

`SessionStorageWriter` expose `writeLine`, `flush`, `fsync`, `close`, `getError`.

## Utilitaires de découverte de sessions

Définis dans `session-manager.ts` :

- `getRecentSessions(sessionDir, limit)` -> métadonnées légères pour l'interface/sélecteur de session
- `findMostRecentSession(sessionDir)` -> la plus récente par mtime
- `list(cwd, sessionDir?)` -> sessions dans un périmètre de projet
- `listAll()` -> sessions à travers tous les périmètres de projet sous `~/.xcsh/agent/sessions`

L'extraction de métadonnées ne lit qu'un préfixe (`readTextPrefix(..., 4096)`) lorsque c'est possible.

## Connexe mais distinct : stockage de l'historique des prompts

`HistoryStorage` (`history-storage.ts`) est un sous-système SQLite séparé pour le rappel/recherche de prompts, pas pour la relecture de session.

- Base de données : `~/.xcsh/agent/history.db`
- Table : `history(id, prompt, created_at, cwd)`
- Index FTS5 : `history_fts` avec synchronisation maintenue par déclencheur
- Déduplique les prompts identiques consécutifs en utilisant un cache du dernier prompt en mémoire
- Insertion asynchrone (`setImmediate`) pour que la capture de prompt ne bloque pas l'exécution du tour

Utilisez les fichiers de session pour la relecture du graphe de conversation/état ; utilisez `HistoryStorage` pour l'expérience utilisateur de l'historique des prompts.
