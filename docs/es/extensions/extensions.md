---
title: Extensiones
description: >-
  Descripción general del runtime de extensiones que cubre tipos, ciclo de vida
  del runner, registro y descubrimiento.
sidebar:
  order: 1
  label: Descripción general
i18n:
  sourceHash: 14cc16dbd98b
  translator: machine
---

# Extensiones

Guía principal para crear extensiones de runtime en `packages/coding-agent`.

Este documento cubre el runtime de extensiones actual en:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/extensibility/extensions/wrapper.ts`
- `src/extensibility/extensions/index.ts`
- `src/modes/controllers/extension-ui-controller.ts`

Para rutas de descubrimiento y reglas de carga del sistema de archivos, consulte `docs/extension-loading.md`.

## Qué es una extensión

Una extensión es un módulo TS/JS que exporta una fábrica predeterminada:

```ts
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";

export default function myExtension(pi: ExtensionAPI) {
 // register handlers/tools/commands/renderers
}
```

Las extensiones pueden combinar todo lo siguiente en un solo módulo:

- manejadores de eventos (`pi.on(...)`)
- herramientas invocables por LLM (`pi.registerTool(...)`)
- comandos de barra diagonal (`pi.registerCommand(...)`)
- atajos de teclado e indicadores
- renderización personalizada de mensajes
- APIs de inyección de sesión/mensaje (`sendMessage`, `sendUserMessage`, `appendEntry`)

## Modelo de runtime

1. Las extensiones se importan y se ejecutan sus funciones de fábrica.
2. Durante esa fase de carga, los métodos de registro son válidos; los métodos de acción de runtime aún no están inicializados.
3. `ExtensionRunner.initialize(...)` conecta acciones/contextos activos para el modo activo.
4. Los eventos de ciclo de vida de sesión/agente/herramienta se emiten a los manejadores.
5. Cada ejecución de herramienta se envuelve con intercepción de extensión (`tool_call` / `tool_result`).

```text
Extension lifecycle (simplified)

load paths
   │
   ▼
import module + run factory (registration only)
   │
   ▼
ExtensionRunner.initialize(mode/session/tool registry)
   │
   ├─ emit session/agent events to handlers
   ├─ wrap tool execution (tool_call/tool_result)
   └─ expose runtime actions (sendMessage, setActiveTools, ...)
```

Restricción importante de `loader.ts`:

- llamar a métodos de acción como `pi.sendMessage()` durante la carga de la extensión lanza `ExtensionRuntimeNotInitializedError`
- registre primero; realice el comportamiento de runtime desde eventos/comandos/herramientas

## Inicio rápido

```ts
import type { ExtensionAPI } from "@f5-sales-demo/xcsh";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
 pi.setLabel("Safety + Utilities");

 pi.on("session_start", async (_event, ctx) => {
  ctx.ui.notify(`Extension loaded in ${ctx.cwd}`, "info");
 });

 pi.on("tool_call", async (event) => {
  if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
   return { block: true, reason: "Blocked by extension policy" };
  }
 });

 pi.registerTool({
  name: "hello_extension",
  label: "Hello Extension",
  description: "Return a greeting",
  parameters: Type.Object({ name: Type.String() }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
   return {
    content: [{ type: "text", text: `Hello, ${params.name}` }],
    details: { greeted: params.name },
   };
  },
 });

 pi.registerCommand("hello-ext", {
  description: "Show queue state",
  handler: async (_args, ctx) => {
   ctx.ui.notify(`pending=${ctx.hasPendingMessages()}`, "info");
  },
 });
}
```

## Superficies de la API de extensión

## 1) Registro y acciones (`ExtensionAPI`)

Métodos principales:

- `on(event, handler)`
- `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`
- `registerMessageRenderer`
- `sendMessage`, `sendUserMessage`, `appendEntry`
- `getActiveTools`, `getAllTools`, `setActiveTools`
- `getSessionName`, `setSessionName`
- `setModel`, `getThinkingLevel`, `setThinkingLevel`
- `registerProvider`
- `events` (bus de eventos compartido)

En el modo interactivo, los manejadores `input` se ejecutan antes de la verificación automática de título del primer mensaje incorporada. Las extensiones que llaman a `await pi.setSessionName(...)` desde `input` pueden establecer el nombre de sesión persistente e impedir que el título autogenerado predeterminado se ejecute para esa sesión.

También expuesto:

- `pi.logger`
- `pi.typebox`
- `pi.pi` (exportaciones del paquete)

### Semántica de entrega de mensajes

`pi.sendMessage(message, options)` admite:

- `deliverAs: "steer"` (predeterminado) — interrumpe la ejecución actual
- `deliverAs: "followUp"` — en cola para ejecutarse después de la ejecución actual
- `deliverAs: "nextTurn"` — almacenado e inyectado en el siguiente prompt del usuario
- `triggerTurn: true` — inicia un turno cuando está inactivo (`nextTurn` ignora esto)

`pi.sendUserMessage(content, { deliverAs })` siempre pasa por el flujo de prompt; mientras hace streaming, se pone en cola como steer/follow-up.

## 2) Contexto del manejador (`ExtensionContext`)

Los manejadores y `execute` de herramientas reciben `ctx` con:

- `ui`
- `hasUI`
- `cwd`
- `sessionManager` (solo lectura)
- `modelRegistry`, `model`
- `getContextUsage()`
- `compact(...)`
- `isIdle()`, `hasPendingMessages()`, `abort()`
- `shutdown()`
- `getSystemPrompt()`

## 3) Contexto de comando (`ExtensionCommandContext`)

Los manejadores de comandos también obtienen:

- `waitForIdle()`
- `newSession(...)`
- `switchSession(...)`
- `branch(entryId)`
- `navigateTree(targetId, { summarize })`
- `reload()`

Use el contexto de comando para flujos de control de sesión; estos métodos están separados intencionalmente de los manejadores de eventos generales.

## Superficie de eventos (nombres y comportamiento actuales)

Las uniones de eventos canónicas y los tipos de carga útil están en `types.ts`.

### Ciclo de vida de sesión

- `session_start`
- `session_before_switch` / `session_switch`
- `session_before_branch` / `session_branch`
- `session_before_compact` / `session.compacting` / `session_compact`
- `session_before_tree` / `session_tree`
- `session_shutdown`

Eventos previos cancelables:

- `session_before_switch` → `{ cancel?: boolean }`
- `session_before_branch` → `{ cancel?: boolean; skipConversationRestore?: boolean }`
- `session_before_compact` → `{ cancel?: boolean; compaction?: CompactionResult }`
- `session_before_tree` → `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }`

### Ciclo de vida de prompt y turno

- `input`
- `before_agent_start`
- `context`
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`

### Ciclo de vida de herramienta

- `tool_call` (pre-ejecución, puede bloquear)
- `tool_result` (post-ejecución, puede modificar content/details/isError)
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` (Observabilidad)

`tool_result` es de estilo middleware: los manejadores se ejecutan en orden de extensión y cada uno ve las modificaciones anteriores.

### Señales de confiabilidad/runtime

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

### Intercepción de comandos del usuario

- `user_bash` (anular con `{ result }`)
- `user_python` (anular con `{ result }`)

### `resources_discover`

`resources_discover` existe en los tipos de extensión y en `ExtensionRunner`.
Nota del runtime actual: `ExtensionRunner.emitResourcesDiscover(...)` está implementado, pero no hay sitios de llamada en `AgentSession` que lo invoquen en el código base actual.

## Detalles de creación de herramientas

`registerTool` usa `ToolDefinition` de `types.ts`.

Firma actual de `execute`:

```ts
execute(
 toolCallId,
 params,
 signal,
 onUpdate,
 ctx,
): Promise<AgentToolResult>
```

Plantilla:

```ts
pi.registerTool({
 name: "my_tool",
 label: "My Tool",
 description: "...",
 parameters: Type.Object({}),
 async execute(_id, _params, signal, onUpdate, ctx) {
  if (signal?.aborted) {
   return { content: [{ type: "text", text: "Cancelled" }] };
  }
  onUpdate?.({ content: [{ type: "text", text: "Working..." }] });
  return { content: [{ type: "text", text: "Done" }], details: {} };
 },
 onSession(event, ctx) {
  // reason: start|switch|branch|tree|shutdown
 },
 renderCall(args, theme) {
  // optional TUI render
 },
 renderResult(result, options, theme, args) {
  // optional TUI render
 },
});
```

`tool_call`/`tool_result` intercepta todas las herramientas una vez que el registro se envuelve en `sdk.ts`, incluidas las incorporadas y las herramientas personalizadas/de extensión.

## Puntos de integración de la interfaz de usuario

`ctx.ui` implementa la interfaz `ExtensionUIContext`. El soporte difiere según el modo.

### Modo interactivo (`extension-ui-controller.ts`)

Compatible:

- diálogos: `select`, `confirm`, `input`, `editor`
- notificaciones/estado/texto del editor/entrada de terminal/superposiciones personalizadas
- listado/carga de temas por nombre (`setTheme` admite nombres de cadena)
- alternancia de herramientas expandidas

Métodos sin operación actuales en este controlador:

- `setFooter`
- `setHeader`
- `setEditorComponent`

También tenga en cuenta: `setWidget` actualmente enruta al texto de la línea de estado mediante `setHookWidget(...)`.

### Modo RPC (`rpc-mode.ts`)

`ctx.ui` está respaldado por eventos RPC `extension_ui_request`:

- los métodos de diálogo (`select`, `confirm`, `input`, `editor`) van y vienen a las respuestas del cliente
- los métodos de disparar y olvidar emiten solicitudes (`notify`, `setStatus`, `setWidget` para matrices de cadenas, `setTitle`, `setEditorText`)

No compatible/sin operación en la implementación RPC:

- `onTerminalInput`
- `custom`
- `setFooter`, `setHeader`, `setEditorComponent`
- `setWorkingMessage`
- cambio/carga de temas (`setTheme` devuelve fallo)
- los controles de expansión de herramientas son inertes

### Rutas de impresión/sin cabecera/subagente

Cuando no se suministra contexto de interfaz de usuario al inicio del runner, `ctx.hasUI` es `false` y los métodos son sin operación/con valor predeterminado.

### Modo interactivo en segundo plano

El modo en segundo plano instala un objeto de contexto de interfaz de usuario no interactivo. En la implementación actual, `ctx.hasUI` puede seguir siendo `true` mientras que los diálogos interactivos devuelven valores predeterminados/comportamiento sin operación.

## Patrones de sesión y estado

Para el estado de extensión duradero:

1. Persistir con `pi.appendEntry(customType, data)`.
2. Reconstruir el estado desde `ctx.sessionManager.getBranch()` en `session_start`, `session_branch`, `session_tree`.
3. Mantener los `details` del resultado de la herramienta estructurados cuando el estado deba ser visible/reconstruible desde el historial de resultados de la herramienta.

Ejemplo de patrón de reconstrucción:

```ts
pi.on("session_start", async (_event, ctx) => {
 let latest;
 for (const entry of ctx.sessionManager.getBranch()) {
  if (entry.type === "custom" && entry.customType === "my-state") {
   latest = entry.data;
  }
 }
 // restore from latest
});
```

## Puntos de extensión de renderización

## Renderizador de mensajes personalizado

```ts
pi.registerMessageRenderer("my-type", (message, { expanded }, theme) => {
 // return pi-tui Component
});
```

Utilizado por la renderización interactiva cuando se muestran mensajes personalizados.

## Renderizador de llamada/resultado de herramienta

Proporcione `renderCall` / `renderResult` en las definiciones de `registerTool` para la visualización personalizada de herramientas en TUI.

## Restricciones y errores comunes

- Las acciones de runtime no están disponibles durante la carga de la extensión.
- Los errores de `tool_call` bloquean la ejecución (fallo cerrado).
- Los conflictos de nombre de comando con los incorporados se omiten con diagnósticos.
- Los atajos reservados se ignoran (`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`).
- Trate `ctx.reload()` como terminal para el marco del manejador de comandos actual.

## Extensiones vs hooks vs herramientas personalizadas

Use la superficie correcta:

- **Extensiones** (`src/extensibility/extensions/*`): sistema unificado (eventos + herramientas + comandos + renderizadores + registro de proveedor).
- **Hooks** (`src/extensibility/hooks/*`): API de evento heredada independiente.
- **Herramientas personalizadas** (`src/extensibility/custom-tools/*`): módulos orientados a herramientas; cuando se cargan junto con extensiones, se adaptan y aún pasan por los wrappers de intercepción de extensión.

Si necesita un paquete que gestione política, herramientas, UX de comandos y renderización de forma conjunta, use extensiones.
