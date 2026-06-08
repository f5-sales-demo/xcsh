---
title: Referencia del Protocolo RPC
description: >-
  Referencia del protocolo JSON-RPC para la comunicación entre procesos de los
  componentes de xcsh.
sidebar:
  order: 5
  label: Protocolo RPC
i18n:
  sourceHash: b4a3ddaf08ab
  translator: machine
---

# Referencia del Protocolo RPC

El modo RPC ejecuta el agente de codificación como un protocolo JSON delimitado por saltos de línea sobre stdio.

- **stdin**: comandos (`RpcCommand`) y respuestas de UI de extensiones
- **stdout**: respuestas a comandos (`RpcResponse`), eventos de sesión/agente, solicitudes de UI de extensiones

Implementación principal:

- `src/modes/rpc/rpc-mode.ts`
- `src/modes/rpc/rpc-types.ts`
- `src/session/agent-session.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`

## Inicio

```bash
xcsh --mode rpc [regular CLI options]
```

Notas de comportamiento:

- Los argumentos CLI `@file` se rechazan en modo RPC.
- El modo RPC deshabilita la generación automática de títulos de sesión por defecto para evitar una llamada adicional al modelo.
- El modo RPC restablece las configuraciones que alteran el flujo de trabajo `todo.*`, `task.*` y `async.*` a sus valores predeterminados integrados en lugar de heredar las personalizaciones del usuario.
- El proceso lee stdin como JSONL (`readJsonl(Bun.stdin.stream())`).
- Cuando stdin se cierra, el proceso termina con código `0`.
- Las respuestas/eventos se escriben como un objeto JSON por línea.

## Transporte y Enmarcado

Cada trama es un único objeto JSON seguido de `\n`.

No hay envolvente más allá de la forma del objeto en sí.

### Categorías de tramas salientes (stdout)

1. `RpcResponse` (`{ type: "response", ... }`)
2. Objetos `AgentSessionEvent` (`agent_start`, `message_update`, etc.)
3. `RpcExtensionUIRequest` (`{ type: "extension_ui_request", ... }`)
4. Errores de extensión (`{ type: "extension_error", extensionPath, event, error }`)

### Categorías de tramas entrantes (stdin)

1. `RpcCommand`
2. `RpcExtensionUIResponse` (`{ type: "extension_ui_response", ... }`)

## Correlación de Solicitud/Respuesta

Todos los comandos aceptan un `id?: string` opcional.

- Si se proporciona, las respuestas normales a comandos repiten el mismo `id`.
- `RpcClient` depende de esto para la resolución de solicitudes pendientes.

Comportamiento importante en casos límite del runtime:

- Las respuestas a comandos desconocidos se emiten con `id: undefined` (incluso si la solicitud tenía un `id`).
- Las excepciones de análisis/manejador en el bucle de entrada emiten `command: "parse"` con `id: undefined`.
- `prompt` y `abort_and_prompt` retornan éxito inmediato, y luego pueden emitir una respuesta de error posterior con el **mismo** id si la programación asíncrona del prompt falla.

## Esquema de Comandos (canónico)

`RpcCommand` está definido en `src/modes/rpc/rpc-types.ts`:

### Prompting

- `{ id?, type: "prompt", message: string, images?: ImageContent[], streamingBehavior?: "steer" | "followUp" }`
- `{ id?, type: "steer", message: string, images?: ImageContent[] }`
- `{ id?, type: "follow_up", message: string, images?: ImageContent[] }`
- `{ id?, type: "abort" }`
- `{ id?, type: "abort_and_prompt", message: string, images?: ImageContent[] }`
- `{ id?, type: "new_session", parentSession?: string }`

### Estado

- `{ id?, type: "get_state" }`
- `{ id?, type: "set_todos", phases: TodoPhase[] }`
- `{ id?, type: "set_host_tools", tools: RpcHostToolDefinition[] }`

### Modelo

- `{ id?, type: "set_model", provider: string, modelId: string }`
- `{ id?, type: "cycle_model" }`
- `{ id?, type: "get_available_models" }`

### Pensamiento

- `{ id?, type: "set_thinking_level", level: ThinkingLevel }`
- `{ id?, type: "cycle_thinking_level" }`

### Modos de cola

- `{ id?, type: "set_steering_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_follow_up_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_interrupt_mode", mode: "immediate" | "wait" }`

### Compactación

- `{ id?, type: "compact", customInstructions?: string }`
- `{ id?, type: "set_auto_compaction", enabled: boolean }`

### Reintento

- `{ id?, type: "set_auto_retry", enabled: boolean }`
- `{ id?, type: "abort_retry" }`

### Bash

- `{ id?, type: "bash", command: string }`
- `{ id?, type: "abort_bash" }`

### Sesión

- `{ id?, type: "get_session_stats" }`
- `{ id?, type: "export_html", outputPath?: string }`
- `{ id?, type: "switch_session", sessionPath: string }`
- `{ id?, type: "branch", entryId: string }`
- `{ id?, type: "get_branch_messages" }`
- `{ id?, type: "get_last_assistant_text" }`
- `{ id?, type: "set_session_name", name: string }`

### Mensajes

- `{ id?, type: "get_messages" }`

## Esquema de Respuestas

Todos los resultados de comandos utilizan `RpcResponse`:

- Éxito: `{ id?, type: "response", command: <command>, success: true, data?: ... }`
- Fallo: `{ id?, type: "response", command: string, success: false, error: string }`

Los datos de respuesta son específicos de cada comando y están definidos en `rpc-types.ts`.

### Payload de `get_state`

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

### Payload de `set_todos`

Reemplaza el estado de tareas en memoria para la sesión actual y devuelve la lista normalizada de fases:

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

Esto es útil para hosts que desean pre-cargar un plan antes del primer prompt.

### Payload de `set_host_tools`

Reemplaza el conjunto actual de herramientas propiedad del host que el servidor RPC puede invocar de vuelta a través de stdio:

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

El payload de respuesta es:

```json
{
  "toolNames": ["echo_host"]
}
```

Estas herramientas se agregan al registro de herramientas de la sesión activa antes de la siguiente llamada al modelo. Reenviar `set_host_tools` reemplaza el conjunto anterior propiedad del host.

## Esquema del Flujo de Eventos

El modo RPC reenvía objetos `AgentSessionEvent` desde `AgentSession.subscribe(...)`.

Tipos de eventos comunes:

- `agent_start`, `agent_end`
- `turn_start`, `turn_end`
- `message_start`, `message_update`, `message_end`
- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`
- `todo_auto_clear`

Los errores del ejecutor de extensiones se emiten por separado como:

```json
{ "type": "extension_error", "extensionPath": "...", "event": "...", "error": "..." }
```

`message_update` incluye deltas de streaming en `assistantMessageEvent` (deltas de texto/pensamiento/llamada de herramienta).

## Concurrencia y Ordenamiento de Prompt/Cola

Este es el comportamiento operacional más importante.

### Confirmación inmediata vs completación

`prompt` y `abort_and_prompt` se **confirman inmediatamente**:

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
```

Esto significa:

- aceptación del comando != completación de la ejecución
- la completación final se observa mediante `agent_end`

### Durante el streaming

`AgentSession.prompt()` requiere `streamingBehavior` durante el streaming activo:

- `"steer"` => mensaje de dirección en cola (ruta de interrupción)
- `"followUp"` => mensaje de seguimiento en cola (ruta post-turno)

Si se omite durante el streaming, el prompt falla.

### Valores predeterminados de la cola

Del esquema de configuraciones del agente de codificación (`packages/coding-agent/src/config/settings-schema.ts`):

- `steeringMode`: `"one-at-a-time"`
- `followUpMode`: `"one-at-a-time"`
- `interruptMode`: `"wait"`

### Semántica de los modos

- `set_steering_mode` / `set_follow_up_mode`
  - `"one-at-a-time"`: desencola un mensaje en cola por turno
  - `"all"`: desencola toda la cola de una vez
- `set_interrupt_mode`
  - `"immediate"`: la ejecución de herramientas verifica la dirección entre llamadas de herramientas; la dirección pendiente puede abortar las llamadas de herramientas restantes en el turno
  - `"wait"`: posterga la dirección hasta la completación del turno

## Sub-Protocolo de UI de Extensiones

Las extensiones en modo RPC utilizan tramas de solicitud/respuesta de UI.

### Solicitud saliente

Métodos de `RpcExtensionUIRequest` (`type: "extension_ui_request"`):

- `select`, `confirm`, `input`, `editor`
- `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`

Nota del runtime:

- La generación automática de títulos de sesión está deshabilitada en modo RPC, y las solicitudes de UI `setTitle` también se suprimen por defecto porque la mayoría de los hosts no tienen una superficie significativa de título de terminal. Configure `PI_RPC_EMIT_TITLE=1` para volver a habilitar solo el evento de UI.

Ejemplo:

```json
{ "type": "extension_ui_request", "id": "123", "method": "confirm", "title": "Confirm", "message": "Continue?", "timeout": 30000 }
```

### Respuesta entrante

`RpcExtensionUIResponse` (`type: "extension_ui_response"`):

- `{ type: "extension_ui_response", id: string, value: string }`
- `{ type: "extension_ui_response", id: string, confirmed: boolean }`
- `{ type: "extension_ui_response", id: string, cancelled: true }`

Si un diálogo tiene un tiempo de espera, el modo RPC resuelve a un valor predeterminado cuando el tiempo de espera/cancelación se activa.

## Sub-Protocolo de Herramientas del Host

Los hosts RPC pueden exponer herramientas personalizadas al agente enviando `set_host_tools`, y luego atendiendo las solicitudes de ejecución a través del mismo transporte.

### Solicitud saliente

Cuando el agente necesita que el host ejecute una de esas herramientas, el modo RPC emite:

```json
{
  "type": "host_tool_call",
  "id": "host_1",
  "toolCallId": "toolu_123",
  "toolName": "echo_host",
  "arguments": { "message": "hello" }
}
```

Si la ejecución de la herramienta se cancela posteriormente, el modo RPC emite:

```json
{
  "type": "host_tool_cancel",
  "id": "host_cancel_1",
  "targetId": "host_1"
}
```

### Actualizaciones entrantes y completación

Los hosts pueden opcionalmente transmitir progreso:

```json
{
  "type": "host_tool_update",
  "id": "host_1",
  "partialResult": {
    "content": [{ "type": "text", "text": "working" }]
  }
}
```

La completación utiliza:

```json
{
  "type": "host_tool_result",
  "id": "host_1",
  "result": {
    "content": [{ "type": "text", "text": "done" }]
  }
}
```

Establezca `isError: true` en `host_tool_result` para exponer el contenido devuelto como un error de herramienta.

## Modelo de Errores y Recuperabilidad

### Fallos a nivel de comando

Los fallos son `success: false` con un `error` de tipo string.

```json
{ "id": "req_2", "type": "response", "command": "set_model", "success": false, "error": "Model not found: provider/model" }
```

### Expectativas de recuperabilidad

- La mayoría de los fallos de comandos son recuperables; el proceso permanece activo.
- Las excepciones de JSONL malformado / bucle de análisis emiten una respuesta de error `parse` y continúan leyendo las líneas siguientes.
- Un `set_session_name` vacío se rechaza (`Session name cannot be empty`).
- Las respuestas de UI de extensiones con `id` desconocido se ignoran.
- Las condiciones de terminación del proceso son el cierre de stdin o un apagado explícito desencadenado por una extensión.

## Flujos de Comandos Compactos

### 1) Prompt y streaming

stdin:

```json
{ "id": "req_1", "type": "prompt", "message": "Summarize this repo" }
```

Secuencia de stdout (típica):

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
{ "type": "agent_start" }
{ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "delta": "..." }, "message": { "role": "assistant", "content": [] } }
{ "type": "agent_end", "messages": [] }
```

### 2) Prompt durante streaming con política de cola explícita

stdin:

```json
{ "id": "req_2", "type": "prompt", "message": "Also include risks", "streamingBehavior": "followUp" }
```

### 3) Inspeccionar y ajustar el comportamiento de la cola

stdin:

```json
{ "id": "q1", "type": "get_state" }
{ "id": "q2", "type": "set_steering_mode", "mode": "all" }
{ "id": "q3", "type": "set_interrupt_mode", "mode": "wait" }
```

### 4) Ida y vuelta de UI de extensión

stdout:

```json
{ "type": "extension_ui_request", "id": "ui_7", "method": "input", "title": "Branch name", "placeholder": "feature/..." }
```

stdin:

```json
{ "type": "extension_ui_response", "id": "ui_7", "value": "feature/rpc-host" }
```

## Notas sobre el helper `RpcClient`

`src/modes/rpc/rpc-client.ts` es un wrapper de conveniencia, no la definición del protocolo.

Características actuales del helper:

- Inicia `bun <cliPath> --mode rpc`
- Correlaciona respuestas mediante ids generados `req_<n>`
- Despacha solo tipos de `AgentEvent` reconocidos a los listeners
- Soporta herramientas personalizadas propiedad del host mediante `setCustomTools()` y manejo automático de `host_tool_call` / `host_tool_cancel`
- **No** expone métodos helper para todos los comandos del protocolo (por ejemplo, `set_interrupt_mode` y `set_session_name` están en los tipos del protocolo pero no están envueltos como métodos dedicados)

Utilice tramas de protocolo sin procesar si necesita cobertura completa de la superficie.
