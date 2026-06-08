---
title: RPC Protocol Reference
description: >-
  JSON-RPC protocol reference for inter-process communication between xcsh
  components.
sidebar:
  order: 5
  label: Protocole RPC
i18n:
  sourceHash: b4a3ddaf08ab
  translator: machine
---

# Référence du protocole RPC

Le mode RPC exécute l'agent de codage en tant que protocole JSON délimité par des retours à la ligne via stdio.

- **stdin** : commandes (`RpcCommand`) et réponses d'interface utilisateur d'extensions
- **stdout** : réponses aux commandes (`RpcResponse`), événements de session/agent, requêtes d'interface utilisateur d'extensions

Implémentation principale :

- `src/modes/rpc/rpc-mode.ts`
- `src/modes/rpc/rpc-types.ts`
- `src/session/agent-session.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`

## Démarrage

```bash
xcsh --mode rpc [regular CLI options]
```

Notes de comportement :

- Les arguments CLI `@file` sont rejetés en mode RPC.
- Le mode RPC désactive par défaut la génération automatique du titre de session pour éviter un appel modèle supplémentaire.
- Le mode RPC réinitialise les paramètres `todo.*`, `task.*` et `async.*` modifiant le workflow à leurs valeurs par défaut intégrées au lieu d'hériter des surcharges utilisateur.
- Le processus lit stdin en JSONL (`readJsonl(Bun.stdin.stream())`).
- Lorsque stdin se ferme, le processus se termine avec le code `0`.
- Les réponses/événements sont écrits sous forme d'un objet JSON par ligne.

## Transport et cadrage

Chaque trame est un objet JSON unique suivi de `\n`.

Il n'y a pas d'enveloppe au-delà de la forme de l'objet lui-même.

### Catégories de trames sortantes (stdout)

1. `RpcResponse` (`{ type: "response", ... }`)
2. Objets `AgentSessionEvent` (`agent_start`, `message_update`, etc.)
3. `RpcExtensionUIRequest` (`{ type: "extension_ui_request", ... }`)
4. Erreurs d'extension (`{ type: "extension_error", extensionPath, event, error }`)

### Catégories de trames entrantes (stdin)

1. `RpcCommand`
2. `RpcExtensionUIResponse` (`{ type: "extension_ui_response", ... }`)

## Corrélation requête/réponse

Toutes les commandes acceptent un `id?: string` optionnel.

- S'il est fourni, les réponses normales aux commandes renvoient le même `id`.
- `RpcClient` s'appuie sur ceci pour la résolution des requêtes en attente.

Comportement important en cas de limites à l'exécution :

- Les réponses aux commandes inconnues sont émises avec `id: undefined` (même si la requête avait un `id`).
- Les exceptions d'analyse/de gestionnaire dans la boucle d'entrée émettent `command: "parse"` avec `id: undefined`.
- `prompt` et `abort_and_prompt` retournent un succès immédiat, puis peuvent émettre une réponse d'erreur ultérieure avec le **même** id si la planification asynchrone du prompt échoue.

## Schéma des commandes (canonique)

`RpcCommand` est défini dans `src/modes/rpc/rpc-types.ts` :

### Prompting

- `{ id?, type: "prompt", message: string, images?: ImageContent[], streamingBehavior?: "steer" | "followUp" }`
- `{ id?, type: "steer", message: string, images?: ImageContent[] }`
- `{ id?, type: "follow_up", message: string, images?: ImageContent[] }`
- `{ id?, type: "abort" }`
- `{ id?, type: "abort_and_prompt", message: string, images?: ImageContent[] }`
- `{ id?, type: "new_session", parentSession?: string }`

### État

- `{ id?, type: "get_state" }`
- `{ id?, type: "set_todos", phases: TodoPhase[] }`
- `{ id?, type: "set_host_tools", tools: RpcHostToolDefinition[] }`

### Modèle

- `{ id?, type: "set_model", provider: string, modelId: string }`
- `{ id?, type: "cycle_model" }`
- `{ id?, type: "get_available_models" }`

### Réflexion

- `{ id?, type: "set_thinking_level", level: ThinkingLevel }`
- `{ id?, type: "cycle_thinking_level" }`

### Modes de file d'attente

- `{ id?, type: "set_steering_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_follow_up_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_interrupt_mode", mode: "immediate" | "wait" }`

### Compaction

- `{ id?, type: "compact", customInstructions?: string }`
- `{ id?, type: "set_auto_compaction", enabled: boolean }`

### Réessai

- `{ id?, type: "set_auto_retry", enabled: boolean }`
- `{ id?, type: "abort_retry" }`

### Bash

- `{ id?, type: "bash", command: string }`
- `{ id?, type: "abort_bash" }`

### Session

- `{ id?, type: "get_session_stats" }`
- `{ id?, type: "export_html", outputPath?: string }`
- `{ id?, type: "switch_session", sessionPath: string }`
- `{ id?, type: "branch", entryId: string }`
- `{ id?, type: "get_branch_messages" }`
- `{ id?, type: "get_last_assistant_text" }`
- `{ id?, type: "set_session_name", name: string }`

### Messages

- `{ id?, type: "get_messages" }`

## Schéma des réponses

Tous les résultats de commandes utilisent `RpcResponse` :

- Succès : `{ id?, type: "response", command: <command>, success: true, data?: ... }`
- Échec : `{ id?, type: "response", command: string, success: false, error: string }`

Les données utiles sont spécifiques à chaque commande et définies dans `rpc-types.ts`.

### Données utiles de `get_state`

```json
{
  "model": { "provider": "...", "id": "..." },
  "thinkingLevel": "off|minimal|low|medium|high|xhigh",
  "isStreaming": false,
  "isCompacting": false,
  "steeringMode": "all|one-at-a-time",
  "followUpMode": "all|one-at-a-time",
  "interruptMode": "immediate|wait",
  "sessionFile": "...",
  "sessionId": "...",
  "sessionName": "...",
  "autoCompactionEnabled": true,
  "messageCount": 0,
  "queuedMessageCount": 0,
  "todoPhases": [
    {
      "id": "phase-1",
      "name": "Todos",
      "tasks": [
        {
          "id": "task-1",
          "content": "Map the tool surface",
          "status": "in_progress"
        }
      ]
    }
  ]
}
```

### Données utiles de `set_todos`

Remplace l'état des tâches en mémoire pour la session en cours et retourne la liste normalisée des phases :

```json
{
  "id": "req_2",
  "type": "set_todos",
  "phases": [
    {
      "id": "phase-1",
      "name": "Evaluation",
      "tasks": [
        {
          "id": "task-1",
          "content": "Map the read tool surface",
          "status": "in_progress"
        },
        {
          "id": "task-2",
          "content": "Exercise edit operations",
          "status": "pending"
        }
      ]
    }
  ]
}
```

Ceci est utile pour les hôtes qui souhaitent pré-alimenter un plan avant le premier prompt.

### Données utiles de `set_host_tools`

Remplace l'ensemble actuel d'outils appartenant à l'hôte que le serveur RPC peut rappeler via stdio :

```json
{
  "id": "req_3",
  "type": "set_host_tools",
  "tools": [
    {
      "name": "echo_host",
      "label": "Echo Host",
      "description": "Echo a value from the embedding host",
      "parameters": {
        "type": "object",
        "properties": {
          "message": { "type": "string" }
        },
        "required": ["message"],
        "additionalProperties": false
      }
    }
  ]
}
```

Les données utiles de la réponse sont :

```json
{
  "toolNames": ["echo_host"]
}
```

Ces outils sont ajoutés au registre d'outils de la session active avant le prochain appel au modèle. Renvoyer `set_host_tools` remplace l'ensemble précédent d'outils appartenant à l'hôte.

## Schéma du flux d'événements

Le mode RPC transmet les objets `AgentSessionEvent` depuis `AgentSession.subscribe(...)`.

Types d'événements courants :

- `agent_start`, `agent_end`
- `turn_start`, `turn_end`
- `message_start`, `message_update`, `message_end`
- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`
- `todo_auto_clear`

Les erreurs du lanceur d'extensions sont émises séparément sous la forme :

```json
{ "type": "extension_error", "extensionPath": "...", "event": "...", "error": "..." }
```

`message_update` inclut les deltas de streaming dans `assistantMessageEvent` (deltas de texte/réflexion/appel d'outil).

## Concurrence et ordonnancement des prompts/files d'attente

C'est le comportement opérationnel le plus important.

### Accusé de réception immédiat vs complétion

`prompt` et `abort_and_prompt` sont **acquittés immédiatement** :

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
```

Cela signifie :

- l'acceptation de la commande != la complétion de l'exécution
- la complétion finale est observée via `agent_end`

### Pendant le streaming

`AgentSession.prompt()` nécessite `streamingBehavior` pendant le streaming actif :

- `"steer"` => message de guidage mis en file d'attente (chemin d'interruption)
- `"followUp"` => message de suivi mis en file d'attente (chemin post-tour)

Si omis pendant le streaming, le prompt échoue.

### Valeurs par défaut des files d'attente

Depuis le schéma de paramètres de l'agent de codage (`packages/coding-agent/src/config/settings-schema.ts`) :

- `steeringMode` : `"one-at-a-time"`
- `followUpMode` : `"one-at-a-time"`
- `interruptMode` : `"wait"`

### Sémantique des modes

- `set_steering_mode` / `set_follow_up_mode`
  - `"one-at-a-time"` : retire un message de la file d'attente par tour
  - `"all"` : retire toute la file d'attente en une fois
- `set_interrupt_mode`
  - `"immediate"` : l'exécution d'outils vérifie le guidage entre les appels d'outils ; un guidage en attente peut annuler les appels d'outils restants dans le tour
  - `"wait"` : reporte le guidage jusqu'à la complétion du tour

## Sous-protocole d'interface utilisateur des extensions

Les extensions en mode RPC utilisent des trames requête/réponse d'interface utilisateur.

### Requête sortante

Méthodes `RpcExtensionUIRequest` (`type: "extension_ui_request"`) :

- `select`, `confirm`, `input`, `editor`
- `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`

Note d'exécution :

- La génération automatique du titre de session est désactivée en mode RPC, et les requêtes d'interface utilisateur `setTitle` sont également supprimées par défaut car la plupart des hôtes ne disposent pas d'une surface de titre de terminal significative. Définissez `PI_RPC_EMIT_TITLE=1` pour réactiver uniquement l'événement d'interface utilisateur.

Exemple :

```json
{ "type": "extension_ui_request", "id": "123", "method": "confirm", "title": "Confirm", "message": "Continue?", "timeout": 30000 }
```

### Réponse entrante

`RpcExtensionUIResponse` (`type: "extension_ui_response"`) :

- `{ type: "extension_ui_response", id: string, value: string }`
- `{ type: "extension_ui_response", id: string, confirmed: boolean }`
- `{ type: "extension_ui_response", id: string, cancelled: true }`

Si un dialogue a un délai d'expiration, le mode RPC résout vers une valeur par défaut lorsque le délai/l'annulation se déclenche.

## Sous-protocole des outils hôte

Les hôtes RPC peuvent exposer des outils personnalisés à l'agent en envoyant `set_host_tools`, puis en servant les requêtes d'exécution sur le même transport.

### Requête sortante

Lorsque l'agent souhaite que l'hôte exécute l'un de ces outils, le mode RPC émet :

```json
{
  "type": "host_tool_call",
  "id": "host_1",
  "toolCallId": "toolu_123",
  "toolName": "echo_host",
  "arguments": { "message": "hello" }
}
```

Si l'exécution de l'outil est annulée par la suite, le mode RPC émet :

```json
{
  "type": "host_tool_cancel",
  "id": "host_cancel_1",
  "targetId": "host_1"
}
```

### Mises à jour entrantes et complétion

Les hôtes peuvent optionnellement transmettre la progression en streaming :

```json
{
  "type": "host_tool_update",
  "id": "host_1",
  "partialResult": {
    "content": [{ "type": "text", "text": "working" }]
  }
}
```

La complétion utilise :

```json
{
  "type": "host_tool_result",
  "id": "host_1",
  "result": {
    "content": [{ "type": "text", "text": "done" }]
  }
}
```

Définissez `isError: true` sur `host_tool_result` pour signaler le contenu retourné comme une erreur d'outil.

## Modèle d'erreurs et récupérabilité

### Échecs au niveau des commandes

Les échecs sont `success: false` avec une chaîne `error`.

```json
{ "id": "req_2", "type": "response", "command": "set_model", "success": false, "error": "Model not found: provider/model" }
```

### Attentes en matière de récupérabilité

- La plupart des échecs de commandes sont récupérables ; le processus reste actif.
- Les JSONL malformés / exceptions de la boucle d'analyse émettent une réponse d'erreur `parse` et continuent la lecture des lignes suivantes.
- Un `set_session_name` vide est rejeté (`Session name cannot be empty`).
- Les réponses d'interface utilisateur d'extensions avec un `id` inconnu sont ignorées.
- Les conditions de terminaison du processus sont la fermeture de stdin ou un arrêt explicitement déclenché par une extension.

## Flux de commandes compacts

### 1) Prompt et streaming

stdin :

```json
{ "id": "req_1", "type": "prompt", "message": "Summarize this repo" }
```

Séquence stdout (typique) :

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
{ "type": "agent_start" }
{ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "delta": "..." }, "message": { "role": "assistant", "content": [] } }
{ "type": "agent_end", "messages": [] }
```

### 2) Prompt pendant le streaming avec politique de file d'attente explicite

stdin :

```json
{ "id": "req_2", "type": "prompt", "message": "Also include risks", "streamingBehavior": "followUp" }
```

### 3) Inspecter et ajuster le comportement de la file d'attente

stdin :

```json
{ "id": "q1", "type": "get_state" }
{ "id": "q2", "type": "set_steering_mode", "mode": "all" }
{ "id": "q3", "type": "set_interrupt_mode", "mode": "wait" }
```

### 4) Aller-retour d'interface utilisateur d'extension

stdout :

```json
{ "type": "extension_ui_request", "id": "ui_7", "method": "input", "title": "Branch name", "placeholder": "feature/..." }
```

stdin :

```json
{ "type": "extension_ui_response", "id": "ui_7", "value": "feature/rpc-host" }
```

## Notes sur l'utilitaire `RpcClient`

`src/modes/rpc/rpc-client.ts` est un wrapper de commodité, pas la définition du protocole.

Caractéristiques actuelles de l'utilitaire :

- Lance `bun <cliPath> --mode rpc`
- Corrèle les réponses par des ids générés `req_<n>`
- Distribue uniquement les types `AgentEvent` reconnus aux écouteurs
- Prend en charge les outils personnalisés appartenant à l'hôte via `setCustomTools()` et la gestion automatique de `host_tool_call` / `host_tool_cancel`
- N'expose **pas** de méthodes utilitaires pour chaque commande du protocole (par exemple, `set_interrupt_mode` et `set_session_name` sont dans les types du protocole mais ne sont pas encapsulés en tant que méthodes dédiées)

Utilisez les trames brutes du protocole si vous avez besoin d'une couverture complète de la surface.
