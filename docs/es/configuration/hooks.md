---
title: Hooks
description: >-
  Sistema de hooks para la automatización de eventos pre/post en el ciclo de
  vida del agente de codificación.
sidebar:
  order: 4
  label: Hooks
i18n:
  sourceHash: 0a29e0d3c134
  translator: machine
---

# Hooks

Este documento describe el **código actual del subsistema de hooks** en `src/extensibility/hooks/*`.

## Estado actual en tiempo de ejecución

El paquete de hooks (`src/extensibility/hooks/`) sigue exportándose y siendo utilizable como superficie de API, pero el tiempo de ejecución predeterminado de la CLI ahora inicializa la ruta del **ejecutor de extensiones**. En el flujo de inicio actual:

- `--hook` se trata como un alias de `--extension` (las rutas de la CLI se fusionan en `additionalExtensionPaths`)
- las herramientas son envueltas por `ExtensionToolWrapper`, no por `HookToolWrapper`
- las transformaciones de contexto y las emisiones del ciclo de vida pasan por `ExtensionRunner`

Por lo tanto, este archivo documenta la implementación del subsistema de hooks en sí (tipos/cargador/ejecutor/envoltorio), incluyendo el comportamiento heredado y sus restricciones.

## Archivos clave

- `src/extensibility/hooks/types.ts` — contexto del hook, tipos de eventos y contratos de resultado
- `src/extensibility/hooks/loader.ts` — carga de módulos y puente de descubrimiento de hooks
- `src/extensibility/hooks/runner.ts` — despacho de eventos, búsqueda de comandos y señalización de errores
- `src/extensibility/hooks/tool-wrapper.ts` — envoltorio de interceptación pre/post de herramientas
- `src/extensibility/hooks/index.ts` — exportaciones/reexportaciones

## Qué es un módulo hook

Un módulo hook debe exportar por defecto una fábrica:

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

La fábrica puede:

- registrar manejadores de eventos con `pi.on(...)`
- enviar mensajes personalizados persistentes con `pi.sendMessage(...)`
- persistir estado no-LLM con `pi.appendEntry(...)`
- registrar comandos slash mediante `pi.registerCommand(...)`
- registrar renderizadores de mensajes personalizados mediante `pi.registerMessageRenderer(...)`
- ejecutar comandos de shell mediante `pi.exec(...)`

## Descubrimiento y carga

`discoverAndLoadHooks(configuredPaths, cwd)` realiza:

1. Cargar los hooks descubiertos desde el registro de capacidades (`loadCapability("hooks")`)
2. Añadir las rutas configuradas explícitamente (deduplicadas por ruta absoluta)
3. Llamar a `loadHooks(allPaths, cwd)`

`loadHooks` luego importa cada ruta y espera una función `default`.

### Resolución de rutas

`loader.ts` resuelve las rutas de los hooks de la siguiente manera:

- ruta absoluta: se utiliza tal cual
- ruta con `~`: se expande
- ruta relativa: se resuelve contra `cwd`

### Discrepancia heredada importante

Los proveedores de descubrimiento para `hookCapability` aún modelan archivos de hooks de estilo shell pre/post (por ejemplo, `.claude/hooks/pre/*`, `.xcsh/.../hooks/pre/*`).

El cargador de hooks aquí utiliza importación dinámica de módulos y requiere una fábrica de hooks predeterminada en JS/TS. Si una ruta de hook descubierta no es importable como módulo, la carga falla y se reporta en `LoadHooksResult.errors`.

## Superficies de eventos

Los eventos de hooks están fuertemente tipados en `types.ts`.

### Eventos de sesión

- `session_start`
- `session_before_switch` → puede retornar `{ cancel?: boolean }`
- `session_switch`
- `session_before_branch` → puede retornar `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_branch`
- `session_before_compact` → puede retornar `{ cancel?: boolean; compaction?: CompactionResult }`
- `session.compacting` → puede retornar `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }`
- `session_compact`
- `session_before_tree` → puede retornar `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`
- `session_tree`
- `session_shutdown`

### Eventos de agente/contexto

- `context` → puede retornar `{ messages?: Message[] }`
- `before_agent_start` → puede retornar `{ message?: { customType; content; display; details } }`
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

### Eventos de herramientas (modelo pre/post)

- `tool_call` (pre-ejecución) → puede retornar `{ block?: boolean; reason?: string }`
- `tool_result` (post-ejecución) → puede retornar `{ content?; details?; isError? }`

Este es el modelo central de interceptación pre/post del subsistema de hooks.

```text
Hook tool interception flow

tool_call handlers
   │
   ├─ any { block: true }? ── yes ──> throw (tool blocked)
   │
   └─ no
      │
      ▼
   execute underlying tool
      │
      ├─ success ──> tool_result handlers can override { content, details }
      │
      └─ error   ──> emit tool_result(isError=true) then rethrow original error
```

## Modelo de ejecución y semántica de mutación

### 1) Pre-ejecución: `tool_call`

`HookToolWrapper.execute()` emite `tool_call` antes de la ejecución de la herramienta.

- si algún manejador retorna `{ block: true }`, la ejecución se detiene
- si el manejador lanza una excepción, el envoltorio falla de forma segura y bloquea la ejecución
- el `reason` retornado se convierte en el texto del error lanzado

### 2) Ejecución de la herramienta

La herramienta subyacente se ejecuta normalmente si no está bloqueada.

### 3) Post-ejecución: `tool_result`

Tras el éxito, el envoltorio emite `tool_result` con:

- `toolName`, `toolCallId`, `input`
- `content`
- `details`
- `isError: false`

Si el manejador retorna sobreescrituras:

- `content` puede reemplazar el contenido del resultado
- `details` puede reemplazar los detalles del resultado

En caso de fallo de la herramienta, el envoltorio emite `tool_result` con `isError: true` y el contenido del texto de error, luego relanza el error original.

### Qué pueden mutar los hooks

- el contexto LLM para una sola llamada mediante `context` (cadena de reemplazo de `messages`)
- el contenido/detalles de salida de la herramienta en llamadas exitosas (ruta `tool_result`)
- el mensaje inyectado pre-agente mediante `before_agent_start`
- el comportamiento de cancelación/compactación personalizada/árbol mediante `session_before_*` y `session.compacting`

### Qué no pueden mutar los hooks en esta implementación

- los parámetros de entrada de la herramienta en su lugar (solo bloquear/permitir en `tool_call`)
- la continuación de la ejecución después de errores lanzados por la herramienta (la ruta de error relanza)
- el estado final de éxito/error en el comportamiento del envoltorio (el `isError` retornado está tipado pero no es aplicado por `HookToolWrapper`)

## Orden y comportamiento en conflictos

### Ordenamiento a nivel de descubrimiento

Los proveedores de capacidades se ordenan por prioridad (mayor primero). La deduplicación es por clave de capacidad, gana el primero.

Para `hooks`, la clave de capacidad es `${type}:${tool}:${name}`. Los duplicados solapados de proveedores de menor prioridad se marcan y excluyen de la lista de descubrimiento efectiva.

### Orden de carga

`discoverAndLoadHooks` construye una lista plana `allPaths`, deduplicada por ruta absoluta resuelta, luego `loadHooks` itera en ese orden.
El orden de los archivos dentro de cada directorio descubierto depende de la salida de `readdir`; el cargador de hooks no realiza una ordenación adicional.

### Orden de manejadores en tiempo de ejecución

Dentro de `HookRunner`, el orden es determinista por secuencia de registro:

1. orden del array de hooks
2. orden de registro del manejador por hook/evento

Comportamiento en conflictos por tipo de evento:

- `tool_call`: gana el último resultado retornado a menos que un manejador bloquee; el primer bloqueo interrumpe el circuito
- `tool_result`: gana la última sobreescritura retornada (sin interrupción de circuito)
- `context`: encadenado; cada manejador recibe la salida de mensajes del manejador anterior
- `before_agent_start`: se conserva el primer mensaje retornado; los mensajes posteriores se ignoran
- `session_before_*`: se rastrea el último resultado retornado; `cancel: true` interrumpe el circuito inmediatamente
- `session.compacting`: gana el último resultado retornado

Conflictos de comandos/renderizadores:

- `getCommand(name)` retorna la primera coincidencia entre todos los hooks (gana el primero cargado)
- `getMessageRenderer(customType)` retorna la primera coincidencia
- `getRegisteredCommands()` retorna todos los comandos (sin deduplicación)

## Interacciones de UI (`HookContext.ui`)

`HookUIContext` incluye:

- `select`, `confirm`, `input`, `editor`
- `notify`
- `setStatus`
- `custom`
- `setEditorText`, `getEditorText`
- getter de `theme`

`ctx.hasUI` indica si la UI interactiva está disponible.

Al ejecutarse sin UI, el comportamiento predeterminado del contexto sin operación es:

- `select/input/editor` retornan `undefined`
- `confirm` retorna `false`
- `notify`, `setStatus`, `setEditorText` son sin operación
- `getEditorText` retorna `""`

### Comportamiento de la línea de estado

El texto de estado del hook establecido mediante `ctx.ui.setStatus(key, text)` es:

- almacenado por clave
- ordenado por nombre de clave
- saneado (`\r`, `\n`, `\t` → espacios; espacios repetidos colapsados)
- unido y truncado por ancho para su visualización

## Propagación de errores y fallback

### En tiempo de carga

- módulo inválido o exportación predeterminada ausente → capturado en `LoadHooksResult.errors`
- la carga continúa para otros hooks

### En tiempo de evento

`HookRunner.emit(...)` captura los errores de los manejadores para la mayoría de los eventos y emite `HookError` a los oyentes (`hookPath`, `event`, `error`), luego continúa.

`emitToolCall(...)` es más estricto: los errores de los manejadores no se absorben allí; se propagan al llamador. En `HookToolWrapper`, esto bloquea la llamada a la herramienta (fail-safe).

## Ejemplos realistas de API

### Bloquear comandos bash peligrosos

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

### Redactar la salida de la herramienta en post-ejecución

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

### Modificar el contexto del modelo por llamada LLM

```ts
import type { HookAPI } from "@f5xc-salesdemos/xcsh/hooks";

export default function (pi: HookAPI): void {
 pi.on("context", async event => {
  const filtered = event.messages.filter(msg => !(msg.role === "custom" && msg.customType === "debug-only"));
  return { messages: filtered };
 });
}
```

### Registrar comando slash con métodos de contexto seguros para comandos

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

## Superficie de exportación

`src/extensibility/hooks/index.ts` exporta:

- APIs de carga (`discoverAndLoadHooks`, `loadHooks`)
- ejecutor y envoltorio (`HookRunner`, `HookToolWrapper`)
- todos los tipos de hooks
- reexportación de `execCommand`

Y la raíz del paquete (`src/index.ts`) reexporta los **tipos** de hooks como superficie de compatibilidad heredada.
