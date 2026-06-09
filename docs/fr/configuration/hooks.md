---
title: Hooks
description: >-
  Système de hooks pour l'automatisation pré/post événement dans le cycle de vie
  de l'agent de codage.
sidebar:
  order: 4
  label: Hooks
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# Hooks

Ce document décrit le **code actuel du sous-système de hooks** dans `src/extensibility/hooks/*`.

## État actuel dans le runtime

Le package de hooks (`src/extensibility/hooks/`) est toujours exporté et utilisable en tant que surface d'API, mais le runtime CLI par défaut initialise désormais le chemin du **extension runner**. Dans le flux de démarrage actuel :

- `--hook` est traité comme un alias pour `--extension` (les chemins CLI sont fusionnés dans `additionalExtensionPaths`)
- les outils sont encapsulés par `ExtensionToolWrapper`, et non par `HookToolWrapper`
- les transformations de contexte et les émissions de cycle de vie passent par `ExtensionRunner`

Ce fichier documente donc l'implémentation du sous-système de hooks en elle-même (types/loader/runner/wrapper), y compris le comportement hérité et les contraintes.

## Fichiers clés

- `src/extensibility/hooks/types.ts` — contexte des hooks, types d'événements et contrats de résultats
- `src/extensibility/hooks/loader.ts` — chargement de modules et pont de découverte des hooks
- `src/extensibility/hooks/runner.ts` — dispatch d'événements, recherche de commandes, signalisation d'erreurs
- `src/extensibility/hooks/tool-wrapper.ts` — wrapper d'interception pré/post outil
- `src/extensibility/hooks/index.ts` — exports/ré-exports

## Qu'est-ce qu'un module de hook

Un module de hook doit exporter par défaut une factory :

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function hook(pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf")) {
   return { block: true, reason: "blocked by policy" };
  }
 });
}
```

La factory peut :

- enregistrer des gestionnaires d'événements avec `pi.on(...)`
- envoyer des messages personnalisés persistants avec `pi.sendMessage(...)`
- persister un état non-LLM avec `pi.appendEntry(...)`
- enregistrer des commandes slash via `pi.registerCommand(...)`
- enregistrer des renderers de messages personnalisés via `pi.registerMessageRenderer(...)`
- exécuter des commandes shell via `pi.exec(...)`

## Découverte et chargement

`discoverAndLoadHooks(configuredPaths, cwd)` effectue :

1. Chargement des hooks découverts depuis le registre de capacités (`loadCapability("hooks")`)
2. Ajout des chemins explicitement configurés (dédupliqués par chemin absolu)
3. Appel de `loadHooks(allPaths, cwd)`

`loadHooks` importe ensuite chaque chemin et attend une fonction `default`.

### Résolution des chemins

`loader.ts` résout les chemins de hooks comme suit :

- chemin absolu : utilisé tel quel
- chemin `~` : développé
- chemin relatif : résolu par rapport à `cwd`

### Incohérence héritée importante

Les fournisseurs de découverte pour `hookCapability` modélisent encore des fichiers de hooks de style shell pré/post (par exemple `.claude/hooks/pre/*`, `.xcsh/.../hooks/pre/*`).

Le chargeur de hooks ici utilise l'import dynamique de modules et nécessite une factory JS/TS par défaut. Si un chemin de hook découvert n'est pas importable en tant que module, le chargement échoue et est signalé dans `LoadHooksResult.errors`.

## Surfaces d'événements

Les événements de hooks sont fortement typés dans `types.ts`.

### Événements de session

- `session_start`
- `session_before_switch` → peut retourner `{ cancel?: boolean }`
- `session_switch`
- `session_before_branch` → peut retourner `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_branch`
- `session_before_compact` → peut retourner `{ cancel?: boolean; compaction?: CompactionResult }`
- `session.compacting` → peut retourner `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }`
- `session_compact`
- `session_before_tree` → peut retourner `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`
- `session_tree`
- `session_shutdown`

### Événements agent/contexte

- `context` → peut retourner `{ messages?: Message[] }`
- `before_agent_start` → peut retourner `{ message?: { customType; content; display; details } }`
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `auto_compaction_start`
- `auto_compaction_end`
- `auto_retry_start`
- `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### Événements d'outils (modèle pré/post)

- `tool_call` (pré-exécution) → peut retourner `{ block?: boolean; reason?: string }`
- `tool_result` (post-exécution) → peut retourner `{ content?; details?; isError? }`

C'est le modèle d'interception pré/post central du sous-système de hooks.

```text
Flux d'interception d'outil par les hooks

gestionnaires tool_call
   │
   ├─ un { block: true } ? ── oui ──> throw (outil bloqué)
   │
   └─ non
      │
      ▼
   exécuter l'outil sous-jacent
      │
      ├─ succès ──> les gestionnaires tool_result peuvent remplacer { content, details }
      │
      └─ erreur ──> émettre tool_result(isError=true) puis relancer l'erreur originale
```

## Modèle d'exécution et sémantique de mutation

### 1) Pré-exécution : `tool_call`

`HookToolWrapper.execute()` émet `tool_call` avant l'exécution de l'outil.

- si un gestionnaire retourne `{ block: true }`, l'exécution s'arrête
- si un gestionnaire lève une exception, le wrapper échoue de manière sûre et bloque l'exécution
- la `reason` retournée devient le texte de l'erreur levée

### 2) Exécution de l'outil

L'outil sous-jacent s'exécute normalement s'il n'est pas bloqué.

### 3) Post-exécution : `tool_result`

Après le succès, le wrapper émet `tool_result` avec :

- `toolName`, `toolCallId`, `input`
- `content`
- `details`
- `isError: false`

Si un gestionnaire retourne des remplacements :

- `content` peut remplacer le contenu du résultat
- `details` peut remplacer les détails du résultat

En cas d'échec de l'outil, le wrapper émet `tool_result` avec `isError: true` et le texte de l'erreur comme contenu, puis relance l'erreur originale.

### Ce que les hooks peuvent muter

- Le contexte LLM pour un seul appel via `context` (chaîne de remplacement de `messages`)
- Le contenu/détails de sortie de l'outil lors d'appels d'outils réussis (chemin `tool_result`)
- Le message injecté pré-agent via `before_agent_start`
- Le comportement d'annulation/compaction personnalisée/arbre via `session_before_*` et `session.compacting`

### Ce que les hooks ne peuvent pas muter dans cette implémentation

- Les paramètres d'entrée bruts de l'outil en place (seulement bloquer/autoriser sur `tool_call`)
- La continuation de l'exécution après des erreurs d'outil levées (le chemin d'erreur relance)
- Le statut final succès/erreur dans le comportement du wrapper (`isError` retourné est typé mais non appliqué par `HookToolWrapper`)

## Ordre et comportement en cas de conflit

### Ordre au niveau de la découverte

Les fournisseurs de capacités sont triés par priorité (la plus haute en premier). La déduplication se fait par clé de capacité, le premier trouvé gagne.

Pour `hooks`, la clé de capacité est `${type}:${tool}:${name}`. Les doublons masqués provenant de fournisseurs de priorité inférieure sont marqués et exclus de la liste effective découverte.

### Ordre de chargement

`discoverAndLoadHooks` construit une liste plate `allPaths`, dédupliquée par chemin absolu résolu, puis `loadHooks` itère dans cet ordre.
L'ordre des fichiers au sein de chaque répertoire découvert dépend de la sortie de `readdir` ; le chargeur de hooks n'effectue pas de tri supplémentaire.

### Ordre des gestionnaires au runtime

Au sein de `HookRunner`, l'ordre est déterministe selon la séquence d'enregistrement :

1. ordre du tableau de hooks
2. ordre d'enregistrement des gestionnaires par hook/événement

Comportement en cas de conflit par type d'événement :

- `tool_call` : le dernier résultat retourné gagne sauf si un gestionnaire bloque ; le premier blocage court-circuite
- `tool_result` : le dernier remplacement retourné gagne (pas de court-circuit)
- `context` : chaîné ; chaque gestionnaire reçoit la sortie de messages du gestionnaire précédent
- `before_agent_start` : le premier message retourné est conservé ; les messages suivants sont ignorés
- `session_before_*` : le dernier résultat retourné est suivi ; `cancel: true` court-circuite immédiatement
- `session.compacting` : le dernier résultat retourné gagne

Conflits de commandes/renderers :

- `getCommand(name)` retourne la première correspondance parmi les hooks (le premier chargé gagne)
- `getMessageRenderer(customType)` retourne la première correspondance
- `getRegisteredCommands()` retourne toutes les commandes (sans déduplication)

## Interactions UI (`HookContext.ui`)

`HookUIContext` inclut :

- `select`, `confirm`, `input`, `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`, `getEditorText`
- getter `theme`

`ctx.hasUI` indique si l'UI interactive est disponible.

Lors de l'exécution sans UI, le comportement par défaut du contexte no-op est :

- `select/input/editor` retournent `undefined`
- `confirm` retourne `false`
- `notify`, `setStatus`, `setEditorText` sont des no-ops
- `getEditorText` retourne `""`

### Comportement de la ligne de statut

Le texte de statut du hook défini via `ctx.ui.setStatus(key, text)` est :

- stocké par clé
- trié par nom de clé
- assaini (`\r`, `\n`, `\t` → espaces ; espaces répétés regroupés)
- joint et tronqué en largeur pour l'affichage

## Propagation des erreurs et fallback

### Au chargement

- module invalide ou export par défaut manquant → capturé dans `LoadHooksResult.errors`
- le chargement continue pour les autres hooks

### Au moment de l'événement

`HookRunner.emit(...)` capture les erreurs des gestionnaires pour la plupart des événements et émet `HookError` aux listeners (`hookPath`, `event`, `error`), puis continue.

`emitToolCall(...)` est plus strict : les erreurs des gestionnaires ne sont pas absorbées ici ; elles se propagent à l'appelant. Dans `HookToolWrapper`, cela bloque l'appel d'outil (sécurité par défaut).

## Exemples d'API réalistes

### Bloquer les commandes bash dangereuses

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "bash") return;
  const cmd = String(event.input.command ?? "");
  if (!cmd.includes("rm -rf")) return;

  if (!ctx.hasUI) return { block: true, reason: "rm -rf blocked (no UI)" };
  const ok = await ctx.ui.confirm("Dangerous command", `Allow: ${cmd}`);
  if (!ok) return { block: true, reason: "user denied command" };
 });
}
```

### Masquer la sortie d'un outil en post-exécution

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("tool_result", async event => {
  if (event.toolName !== "read" || event.isError) return;

  const redacted = event.content.map(chunk => {
   if (chunk.type !== "text") return chunk;
   return { ...chunk, text: chunk.text.replaceAll(/API_KEY=\S+/g, "API_KEY=[REDACTED]") };
  });

  return { content: redacted };
 });
}
```

### Modifier le contexte du modèle par appel LLM

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### Enregistrer une commande slash avec des méthodes de contexte sûres pour les commandes

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.registerCommand("handoff", {
  description: "Create a new session with setup message",
  handler: async (_args, ctx) => {
   await ctx.waitForIdle();
   await ctx.newSession({
    parentSession: ctx.sessionManager.getSessionFile(),
    setup: async sm => {
     sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Continue from prior session summary." }],
      timestamp: Date.now(),
     });
    },
   });
  },
 });
}
```

## Surface d'export

`src/extensibility/hooks/index.ts` exporte :

- API de chargement (`discoverAndLoadHooks`, `loadHooks`)
- runner et wrapper (`HookRunner`, `HookToolWrapper`)
- tous les types de hooks
- ré-export de `execCommand`

Et la racine du package (`src/index.ts`) ré-exporte les **types** de hooks en tant que surface de compatibilité héritée.
