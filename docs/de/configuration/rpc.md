---
title: RPC-Protokollreferenz
description: >-
  JSON-RPC-Protokollreferenz für die Inter-Prozess-Kommunikation zwischen
  xcsh-Komponenten.
sidebar:
  order: 5
  label: RPC-Protokoll
i18n:
  sourceHash: b4a3ddaf08ab
  translator: machine
---

# RPC-Protokollreferenz

Der RPC-Modus führt den Coding-Agenten als zeilengetrennt-JSON-Protokoll über stdio aus.

- **stdin**: Befehle (`RpcCommand`) und Extension-UI-Antworten
- **stdout**: Befehlsantworten (`RpcResponse`), Sitzungs-/Agenten-Events, Extension-UI-Anfragen

Primäre Implementierung:

- `src/modes/rpc/rpc-mode.ts`
- `src/modes/rpc/rpc-types.ts`
- `src/session/agent-session.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`

## Start

```bash
xcsh --mode rpc [reguläre CLI-Optionen]
```

Verhaltenshinweise:

- `@file`-CLI-Argumente werden im RPC-Modus abgelehnt.
- Der RPC-Modus deaktiviert standardmäßig die automatische Sitzungstitel-Generierung, um einen zusätzlichen Modellaufruf zu vermeiden.
- Der RPC-Modus setzt workflow-verändernde Einstellungen für `todo.*`, `task.*` und `async.*` auf ihre eingebauten Standardwerte zurück, anstatt Benutzerüberschreibungen zu übernehmen.
- Der Prozess liest stdin als JSONL (`readJsonl(Bun.stdin.stream())`).
- Wenn stdin geschlossen wird, beendet sich der Prozess mit dem Exit-Code `0`.
- Antworten/Events werden als ein JSON-Objekt pro Zeile geschrieben.

## Transport und Framing

Jeder Frame ist ein einzelnes JSON-Objekt gefolgt von `\n`.

Es gibt keinen Umschlag über die Objektstruktur hinaus.

### Ausgehende Frame-Kategorien (stdout)

1. `RpcResponse` (`{ type: "response", ... }`)
2. `AgentSessionEvent`-Objekte (`agent_start`, `message_update`, usw.)
3. `RpcExtensionUIRequest` (`{ type: "extension_ui_request", ... }`)
4. Extension-Fehler (`{ type: "extension_error", extensionPath, event, error }`)

### Eingehende Frame-Kategorien (stdin)

1. `RpcCommand`
2. `RpcExtensionUIResponse` (`{ type: "extension_ui_response", ... }`)

## Anfrage/Antwort-Korrelation

Alle Befehle akzeptieren ein optionales `id?: string`.

- Wenn angegeben, geben normale Befehlsantworten dieselbe `id` zurück.
- `RpcClient` verlässt sich darauf für die Auflösung ausstehender Anfragen.

Wichtiges Randverhalten zur Laufzeit:

- Unbekannte Befehlsantworten werden mit `id: undefined` ausgegeben (auch wenn die Anfrage eine `id` hatte).
- Parse-/Handler-Ausnahmen in der Eingabeschleife geben `command: "parse"` mit `id: undefined` aus.
- `prompt` und `abort_and_prompt` geben sofort Erfolg zurück und können dann eine spätere Fehlerantwort mit der **gleichen** ID ausgeben, wenn die asynchrone Prompt-Planung fehlschlägt.

## Befehlsschema (kanonisch)

`RpcCommand` ist definiert in `src/modes/rpc/rpc-types.ts`:

### Prompting

- `{ id?, type: "prompt", message: string, images?: ImageContent[], streamingBehavior?: "steer" | "followUp" }`
- `{ id?, type: "steer", message: string, images?: ImageContent[] }`
- `{ id?, type: "follow_up", message: string, images?: ImageContent[] }`
- `{ id?, type: "abort" }`
- `{ id?, type: "abort_and_prompt", message: string, images?: ImageContent[] }`
- `{ id?, type: "new_session", parentSession?: string }`

### Zustand

- `{ id?, type: "get_state" }`
- `{ id?, type: "set_todos", phases: TodoPhase[] }`
- `{ id?, type: "set_host_tools", tools: RpcHostToolDefinition[] }`

### Modell

- `{ id?, type: "set_model", provider: string, modelId: string }`
- `{ id?, type: "cycle_model" }`
- `{ id?, type: "get_available_models" }`

### Denken

- `{ id?, type: "set_thinking_level", level: ThinkingLevel }`
- `{ id?, type: "cycle_thinking_level" }`

### Warteschlangenmodi

- `{ id?, type: "set_steering_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_follow_up_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_interrupt_mode", mode: "immediate" | "wait" }`

### Komprimierung

- `{ id?, type: "compact", customInstructions?: string }`
- `{ id?, type: "set_auto_compaction", enabled: boolean }`

### Wiederholung

- `{ id?, type: "set_auto_retry", enabled: boolean }`
- `{ id?, type: "abort_retry" }`

### Bash

- `{ id?, type: "bash", command: string }`
- `{ id?, type: "abort_bash" }`

### Sitzung

- `{ id?, type: "get_session_stats" }`
- `{ id?, type: "export_html", outputPath?: string }`
- `{ id?, type: "switch_session", sessionPath: string }`
- `{ id?, type: "branch", entryId: string }`
- `{ id?, type: "get_branch_messages" }`
- `{ id?, type: "get_last_assistant_text" }`
- `{ id?, type: "set_session_name", name: string }`

### Nachrichten

- `{ id?, type: "get_messages" }`

## Antwortschema

Alle Befehlsergebnisse verwenden `RpcResponse`:

- Erfolg: `{ id?, type: "response", command: <command>, success: true, data?: ... }`
- Fehler: `{ id?, type: "response", command: string, success: false, error: string }`

Daten-Payloads sind befehlsspezifisch und in `rpc-types.ts` definiert.

### `get_state`-Payload

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

### `set_todos`-Payload

Ersetzt den In-Memory-Todo-Zustand für die aktuelle Sitzung und gibt die normalisierte Phasenliste zurück:

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

Dies ist nützlich für Hosts, die vor dem ersten Prompt einen Plan vorbelegen möchten.

### `set_host_tools`-Payload

Ersetzt den aktuellen Satz host-eigener Tools, die der RPC-Server über stdio zurückrufen kann:

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

Das Antwort-Payload ist:

```json
{
  "toolNames": ["echo_host"]
}
```

Diese Tools werden vor dem nächsten Modellaufruf zur aktiven Sitzungs-Tool-Registry hinzugefügt. Ein erneutes Senden von `set_host_tools` ersetzt den vorherigen host-eigenen Satz.

## Event-Stream-Schema

Der RPC-Modus leitet `AgentSessionEvent`-Objekte von `AgentSession.subscribe(...)` weiter.

Häufige Event-Typen:

- `agent_start`, `agent_end`
- `turn_start`, `turn_end`
- `message_start`, `message_update`, `message_end`
- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`
- `todo_auto_clear`

Extension-Runner-Fehler werden separat ausgegeben als:

```json
{ "type": "extension_error", "extensionPath": "...", "event": "...", "error": "..." }
```

`message_update` enthält Streaming-Deltas in `assistantMessageEvent` (Text-/Denk-/Tool-Call-Deltas).

## Prompt/Warteschlangen-Nebenläufigkeit und Reihenfolge

Dies ist das wichtigste operative Verhalten.

### Sofortige Bestätigung vs. Abschluss

`prompt` und `abort_and_prompt` werden **sofort bestätigt**:

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
```

Das bedeutet:

- Befehlsannahme != Ausführungsabschluss
- Der endgültige Abschluss wird über `agent_end` beobachtet

### Während des Streamings

`AgentSession.prompt()` erfordert `streamingBehavior` während des aktiven Streamings:

- `"steer"` => in die Warteschlange gestellte Steering-Nachricht (Unterbrechungspfad)
- `"followUp"` => in die Warteschlange gestellte Follow-up-Nachricht (Post-Turn-Pfad)

Wenn während des Streamings nicht angegeben, schlägt der Prompt fehl.

### Warteschlangen-Standardwerte

Aus dem Coding-Agent-Einstellungsschema (`packages/coding-agent/src/config/settings-schema.ts`):

- `steeringMode`: `"one-at-a-time"`
- `followUpMode`: `"one-at-a-time"`
- `interruptMode`: `"wait"`

### Modus-Semantik

- `set_steering_mode` / `set_follow_up_mode`
  - `"one-at-a-time"`: eine Nachricht pro Turn aus der Warteschlange entnehmen
  - `"all"`: gesamte Warteschlange auf einmal entnehmen
- `set_interrupt_mode`
  - `"immediate"`: Tool-Ausführung prüft Steering zwischen Tool-Aufrufen; ausstehende Steering-Nachrichten können verbleibende Tool-Aufrufe im Turn abbrechen
  - `"wait"`: Steering bis zum Turn-Abschluss aufschieben

## Extension-UI-Unterprotokoll

Extensions im RPC-Modus verwenden Anfrage/Antwort-UI-Frames.

### Ausgehende Anfrage

`RpcExtensionUIRequest` (`type: "extension_ui_request"`) Methoden:

- `select`, `confirm`, `input`, `editor`
- `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`

Laufzeithinweis:

- Die automatische Sitzungstitel-Generierung ist im RPC-Modus deaktiviert, und `setTitle`-UI-Anfragen werden standardmäßig ebenfalls unterdrückt, da die meisten Hosts keine sinnvolle Terminal-Titel-Oberfläche haben. Setzen Sie `PI_RPC_EMIT_TITLE=1`, um das UI-Event wieder zu aktivieren.

Beispiel:

```json
{ "type": "extension_ui_request", "id": "123", "method": "confirm", "title": "Confirm", "message": "Continue?", "timeout": 30000 }
```

### Eingehende Antwort

`RpcExtensionUIResponse` (`type: "extension_ui_response"`):

- `{ type: "extension_ui_response", id: string, value: string }`
- `{ type: "extension_ui_response", id: string, confirmed: boolean }`
- `{ type: "extension_ui_response", id: string, cancelled: true }`

Wenn ein Dialog ein Timeout hat, löst der RPC-Modus bei Timeout/Abbruch auf einen Standardwert auf.

## Host-Tool-Unterprotokoll

RPC-Hosts können dem Agenten benutzerdefinierte Tools bereitstellen, indem sie `set_host_tools` senden und dann Ausführungsanfragen über denselben Transport bedienen.

### Ausgehende Anfrage

Wenn der Agent möchte, dass der Host eines dieser Tools ausführt, gibt der RPC-Modus Folgendes aus:

```json
{
  "type": "host_tool_call",
  "id": "host_1",
  "toolCallId": "toolu_123",
  "toolName": "echo_host",
  "arguments": { "message": "hello" }
}
```

Wenn die Tool-Ausführung später abgebrochen wird, gibt der RPC-Modus Folgendes aus:

```json
{
  "type": "host_tool_cancel",
  "id": "host_cancel_1",
  "targetId": "host_1"
}
```

### Eingehende Aktualisierungen und Abschluss

Hosts können optional Fortschritt streamen:

```json
{
  "type": "host_tool_update",
  "id": "host_1",
  "partialResult": {
    "content": [{ "type": "text", "text": "working" }]
  }
}
```

Der Abschluss verwendet:

```json
{
  "type": "host_tool_result",
  "id": "host_1",
  "result": {
    "content": [{ "type": "text", "text": "done" }]
  }
}
```

Setzen Sie `isError: true` bei `host_tool_result`, um den zurückgegebenen Inhalt als Tool-Fehler darzustellen.

## Fehlermodell und Wiederherstellbarkeit

### Fehler auf Befehlsebene

Fehler sind `success: false` mit einem String `error`.

```json
{ "id": "req_2", "type": "response", "command": "set_model", "success": false, "error": "Model not found: provider/model" }
```

### Erwartungen zur Wiederherstellbarkeit

- Die meisten Befehlsfehler sind wiederherstellbar; der Prozess bleibt aktiv.
- Fehlerhaftes JSONL / Parse-Schleifen-Ausnahmen geben eine `parse`-Fehlerantwort aus und lesen die nachfolgenden Zeilen weiter.
- Ein leerer `set_session_name` wird abgelehnt (`Session name cannot be empty`).
- Extension-UI-Antworten mit unbekannter `id` werden ignoriert.
- Prozessbeendigungsbedingungen sind das Schließen von stdin oder ein explizit durch Extensions ausgelöstes Herunterfahren.

## Kompakte Befehlsabläufe

### 1) Prompt und Stream

stdin:

```json
{ "id": "req_1", "type": "prompt", "message": "Summarize this repo" }
```

stdout-Sequenz (typisch):

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
{ "type": "agent_start" }
{ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "delta": "..." }, "message": { "role": "assistant", "content": [] } }
{ "type": "agent_end", "messages": [] }
```

### 2) Prompt während des Streamings mit expliziter Warteschlangen-Richtlinie

stdin:

```json
{ "id": "req_2", "type": "prompt", "message": "Also include risks", "streamingBehavior": "followUp" }
```

### 3) Warteschlangenverhalten prüfen und anpassen

stdin:

```json
{ "id": "q1", "type": "get_state" }
{ "id": "q2", "type": "set_steering_mode", "mode": "all" }
{ "id": "q3", "type": "set_interrupt_mode", "mode": "wait" }
```

### 4) Extension-UI-Roundtrip

stdout:

```json
{ "type": "extension_ui_request", "id": "ui_7", "method": "input", "title": "Branch name", "placeholder": "feature/..." }
```

stdin:

```json
{ "type": "extension_ui_response", "id": "ui_7", "value": "feature/rpc-host" }
```

## Hinweise zum `RpcClient`-Helfer

`src/modes/rpc/rpc-client.ts` ist ein Komfort-Wrapper, nicht die Protokolldefinition.

Aktuelle Helfer-Eigenschaften:

- Startet `bun <cliPath> --mode rpc`
- Korreliert Antworten über generierte `req_<n>`-IDs
- Leitet nur erkannte `AgentEvent`-Typen an Listener weiter
- Unterstützt host-eigene benutzerdefinierte Tools über `setCustomTools()` und automatische Behandlung von `host_tool_call` / `host_tool_cancel`
- Stellt **keine** Hilfsmethoden für jeden Protokollbefehl bereit (zum Beispiel sind `set_interrupt_mode` und `set_session_name` in den Protokolltypen vorhanden, aber nicht als dedizierte Methoden gewrappt)

Verwenden Sie rohe Protokoll-Frames, wenn Sie die vollständige Oberfläche abdecken müssen.
