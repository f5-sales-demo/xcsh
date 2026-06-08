---
title: RPC Protocol Reference
description: >-
  Riferimento del protocollo JSON-RPC per la comunicazione inter-processo tra i
  componenti di xcsh.
sidebar:
  order: 5
  label: Protocollo RPC
i18n:
  sourceHash: b4a3ddaf08ab
  translator: machine
---

# Riferimento del Protocollo RPC

La modalità RPC esegue l'agente di codifica come protocollo JSON delimitato da newline su stdio.

- **stdin**: comandi (`RpcCommand`) e risposte dell'interfaccia utente delle estensioni
- **stdout**: risposte ai comandi (`RpcResponse`), eventi di sessione/agente, richieste dell'interfaccia utente delle estensioni

Implementazione principale:

- `src/modes/rpc/rpc-mode.ts`
- `src/modes/rpc/rpc-types.ts`
- `src/session/agent-session.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`

## Avvio

```bash
xcsh --mode rpc [regular CLI options]
```

Note sul comportamento:

- Gli argomenti CLI `@file` vengono rifiutati in modalità RPC.
- La modalità RPC disabilita per impostazione predefinita la generazione automatica del titolo della sessione per evitare una chiamata extra al modello.
- La modalità RPC ripristina le impostazioni `todo.*`, `task.*` e `async.*` che alterano il flusso di lavoro ai valori predefiniti integrati invece di ereditare le personalizzazioni dell'utente.
- Il processo legge stdin come JSONL (`readJsonl(Bun.stdin.stream())`).
- Quando stdin viene chiuso, il processo termina con codice `0`.
- Le risposte/eventi vengono scritti come un oggetto JSON per riga.

## Trasporto e Framing

Ogni frame è un singolo oggetto JSON seguito da `\n`.

Non esiste alcun involucro oltre alla forma dell'oggetto stesso.

### Categorie di frame in uscita (stdout)

1. `RpcResponse` (`{ type: "response", ... }`)
2. Oggetti `AgentSessionEvent` (`agent_start`, `message_update`, ecc.)
3. `RpcExtensionUIRequest` (`{ type: "extension_ui_request", ... }`)
4. Errori delle estensioni (`{ type: "extension_error", extensionPath, event, error }`)

### Categorie di frame in entrata (stdin)

1. `RpcCommand`
2. `RpcExtensionUIResponse` (`{ type: "extension_ui_response", ... }`)

## Correlazione Richiesta/Risposta

Tutti i comandi accettano un `id?: string` opzionale.

- Se fornito, le risposte normali ai comandi restituiscono lo stesso `id`.
- `RpcClient` si basa su questo per la risoluzione delle richieste in sospeso.

Comportamento limite importante dal runtime:

- Le risposte a comandi sconosciuti vengono emesse con `id: undefined` (anche se la richiesta aveva un `id`).
- Le eccezioni di parsing/handler nel ciclo di input emettono `command: "parse"` con `id: undefined`.
- `prompt` e `abort_and_prompt` restituiscono un successo immediato, poi possono emettere una risposta di errore successiva con lo **stesso** id se la pianificazione asincrona del prompt fallisce.

## Schema dei Comandi (canonico)

`RpcCommand` è definito in `src/modes/rpc/rpc-types.ts`:

### Prompting

- `{ id?, type: "prompt", message: string, images?: ImageContent[], streamingBehavior?: "steer" | "followUp" }`
- `{ id?, type: "steer", message: string, images?: ImageContent[] }`
- `{ id?, type: "follow_up", message: string, images?: ImageContent[] }`
- `{ id?, type: "abort" }`
- `{ id?, type: "abort_and_prompt", message: string, images?: ImageContent[] }`
- `{ id?, type: "new_session", parentSession?: string }`

### Stato

- `{ id?, type: "get_state" }`
- `{ id?, type: "set_todos", phases: TodoPhase[] }`
- `{ id?, type: "set_host_tools", tools: RpcHostToolDefinition[] }`

### Modello

- `{ id?, type: "set_model", provider: string, modelId: string }`
- `{ id?, type: "cycle_model" }`
- `{ id?, type: "get_available_models" }`

### Ragionamento

- `{ id?, type: "set_thinking_level", level: ThinkingLevel }`
- `{ id?, type: "cycle_thinking_level" }`

### Modalità coda

- `{ id?, type: "set_steering_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_follow_up_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_interrupt_mode", mode: "immediate" | "wait" }`

### Compattazione

- `{ id?, type: "compact", customInstructions?: string }`
- `{ id?, type: "set_auto_compaction", enabled: boolean }`

### Ripetizione

- `{ id?, type: "set_auto_retry", enabled: boolean }`
- `{ id?, type: "abort_retry" }`

### Bash

- `{ id?, type: "bash", command: string }`
- `{ id?, type: "abort_bash" }`

### Sessione

- `{ id?, type: "get_session_stats" }`
- `{ id?, type: "export_html", outputPath?: string }`
- `{ id?, type: "switch_session", sessionPath: string }`
- `{ id?, type: "branch", entryId: string }`
- `{ id?, type: "get_branch_messages" }`
- `{ id?, type: "get_last_assistant_text" }`
- `{ id?, type: "set_session_name", name: string }`

### Messaggi

- `{ id?, type: "get_messages" }`

## Schema delle Risposte

Tutti i risultati dei comandi utilizzano `RpcResponse`:

- Successo: `{ id?, type: "response", command: <command>, success: true, data?: ... }`
- Fallimento: `{ id?, type: "response", command: string, success: false, error: string }`

I payload dei dati sono specifici per ogni comando e definiti in `rpc-types.ts`.

### Payload di `get_state`

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

### Payload di `set_todos`

Sostituisce lo stato dei todo in memoria per la sessione corrente e restituisce l'elenco normalizzato delle fasi:

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

Questo è utile per gli host che desiderano pre-caricare un piano prima del primo prompt.

### Payload di `set_host_tools`

Sostituisce l'insieme corrente di strumenti di proprietà dell'host che il server RPC può richiamare tramite stdio:

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

Il payload della risposta è:

```json
{
  "toolNames": ["echo_host"]
}
```

Questi strumenti vengono aggiunti al registro degli strumenti della sessione attiva prima della successiva chiamata al modello. L'invio ripetuto di `set_host_tools` sostituisce l'insieme precedente di proprietà dell'host.

## Schema del Flusso di Eventi

La modalità RPC inoltra gli oggetti `AgentSessionEvent` da `AgentSession.subscribe(...)`.

Tipi di eventi comuni:

- `agent_start`, `agent_end`
- `turn_start`, `turn_end`
- `message_start`, `message_update`, `message_end`
- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`
- `todo_auto_clear`

Gli errori dell'esecutore delle estensioni vengono emessi separatamente come:

```json
{ "type": "extension_error", "extensionPath": "...", "event": "...", "error": "..." }
```

`message_update` include i delta di streaming in `assistantMessageEvent` (delta di testo/ragionamento/chiamate a strumenti).

## Concorrenza e Ordinamento di Prompt/Coda

Questo è il comportamento operativo più importante.

### Conferma immediata vs completamento

`prompt` e `abort_and_prompt` vengono **confermati immediatamente**:

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
```

Ciò significa:

- accettazione del comando != completamento dell'esecuzione
- il completamento finale viene osservato tramite `agent_end`

### Durante lo streaming

`AgentSession.prompt()` richiede `streamingBehavior` durante lo streaming attivo:

- `"steer"` => messaggio di steering accodato (percorso di interruzione)
- `"followUp"` => messaggio di follow-up accodato (percorso post-turno)

Se omesso durante lo streaming, il prompt fallisce.

### Valori predefiniti della coda

Dallo schema delle impostazioni del coding-agent (`packages/coding-agent/src/config/settings-schema.ts`):

- `steeringMode`: `"one-at-a-time"`
- `followUpMode`: `"one-at-a-time"`
- `interruptMode`: `"wait"`

### Semantica delle modalità

- `set_steering_mode` / `set_follow_up_mode`
  - `"one-at-a-time"`: estrae un messaggio accodato per turno
  - `"all"`: estrae l'intera coda in una volta
- `set_interrupt_mode`
  - `"immediate"`: l'esecuzione degli strumenti controlla lo steering tra le chiamate agli strumenti; lo steering in sospeso può interrompere le chiamate agli strumenti rimanenti nel turno
  - `"wait"`: rimanda lo steering fino al completamento del turno

## Sotto-Protocollo UI delle Estensioni

Le estensioni in modalità RPC utilizzano frame di richiesta/risposta per l'interfaccia utente.

### Richiesta in uscita

Metodi di `RpcExtensionUIRequest` (`type: "extension_ui_request"`):

- `select`, `confirm`, `input`, `editor`
- `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`

Nota sul runtime:

- La generazione automatica del titolo della sessione è disabilitata in modalità RPC, e le richieste UI `setTitle` vengono anch'esse soppresse per impostazione predefinita perché la maggior parte degli host non dispone di una superficie significativa per il titolo del terminale. Impostare `PI_RPC_EMIT_TITLE=1` per riattivare solo l'evento UI.

Esempio:

```json
{ "type": "extension_ui_request", "id": "123", "method": "confirm", "title": "Confirm", "message": "Continue?", "timeout": 30000 }
```

### Risposta in entrata

`RpcExtensionUIResponse` (`type: "extension_ui_response"`):

- `{ type: "extension_ui_response", id: string, value: string }`
- `{ type: "extension_ui_response", id: string, confirmed: boolean }`
- `{ type: "extension_ui_response", id: string, cancelled: true }`

Se un dialogo ha un timeout, la modalità RPC risolve con un valore predefinito quando il timeout/abort viene attivato.

## Sotto-Protocollo degli Strumenti Host

Gli host RPC possono esporre strumenti personalizzati all'agente inviando `set_host_tools`, per poi gestire le richieste di esecuzione sullo stesso trasporto.

### Richiesta in uscita

Quando l'agente vuole che l'host esegua uno di quegli strumenti, la modalità RPC emette:

```json
{
  "type": "host_tool_call",
  "id": "host_1",
  "toolCallId": "toolu_123",
  "toolName": "echo_host",
  "arguments": { "message": "hello" }
}
```

Se l'esecuzione dello strumento viene successivamente interrotta, la modalità RPC emette:

```json
{
  "type": "host_tool_cancel",
  "id": "host_cancel_1",
  "targetId": "host_1"
}
```

### Aggiornamenti in entrata e completamento

Gli host possono opzionalmente trasmettere il progresso in streaming:

```json
{
  "type": "host_tool_update",
  "id": "host_1",
  "partialResult": {
    "content": [{ "type": "text", "text": "working" }]
  }
}
```

Il completamento utilizza:

```json
{
  "type": "host_tool_result",
  "id": "host_1",
  "result": {
    "content": [{ "type": "text", "text": "done" }]
  }
}
```

Impostare `isError: true` su `host_tool_result` per far emergere il contenuto restituito come errore dello strumento.

## Modello degli Errori e Recuperabilità

### Fallimenti a livello di comando

I fallimenti sono `success: false` con `error` di tipo stringa.

```json
{ "id": "req_2", "type": "response", "command": "set_model", "success": false, "error": "Model not found: provider/model" }
```

### Aspettative di recuperabilità

- La maggior parte dei fallimenti dei comandi è recuperabile; il processo rimane attivo.
- JSONL malformato / eccezioni nel ciclo di parsing emettono una risposta di errore `parse` e continuano a leggere le righe successive.
- Un `set_session_name` vuoto viene rifiutato (`Session name cannot be empty`).
- Le risposte UI delle estensioni con `id` sconosciuto vengono ignorate.
- Le condizioni di terminazione del processo sono la chiusura di stdin o lo shutdown esplicito attivato da un'estensione.

## Flussi di Comandi Compatti

### 1) Prompt e streaming

stdin:

```json
{ "id": "req_1", "type": "prompt", "message": "Summarize this repo" }
```

Sequenza stdout (tipica):

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
{ "type": "agent_start" }
{ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "delta": "..." }, "message": { "role": "assistant", "content": [] } }
{ "type": "agent_end", "messages": [] }
```

### 2) Prompt durante lo streaming con policy di coda esplicita

stdin:

```json
{ "id": "req_2", "type": "prompt", "message": "Also include risks", "streamingBehavior": "followUp" }
```

### 3) Ispezionare e regolare il comportamento della coda

stdin:

```json
{ "id": "q1", "type": "get_state" }
{ "id": "q2", "type": "set_steering_mode", "mode": "all" }
{ "id": "q3", "type": "set_interrupt_mode", "mode": "wait" }
```

### 4) Ciclo completo UI delle estensioni

stdout:

```json
{ "type": "extension_ui_request", "id": "ui_7", "method": "input", "title": "Branch name", "placeholder": "feature/..." }
```

stdin:

```json
{ "type": "extension_ui_response", "id": "ui_7", "value": "feature/rpc-host" }
```

## Note sull'helper `RpcClient`

`src/modes/rpc/rpc-client.ts` è un wrapper di convenienza, non la definizione del protocollo.

Caratteristiche attuali dell'helper:

- Avvia `bun <cliPath> --mode rpc`
- Correla le risposte tramite id generati `req_<n>`
- Invia ai listener solo i tipi `AgentEvent` riconosciuti
- Supporta strumenti personalizzati di proprietà dell'host tramite `setCustomTools()` e gestione automatica di `host_tool_call` / `host_tool_cancel`
- **Non** espone metodi helper per ogni comando del protocollo (ad esempio, `set_interrupt_mode` e `set_session_name` sono nei tipi del protocollo ma non incapsulati come metodi dedicati)

Utilizzare i frame grezzi del protocollo se è necessaria una copertura completa della superficie.
