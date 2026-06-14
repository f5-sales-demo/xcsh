---
title: Componentes internos del tiempo de ejecución de la herramienta Resolve
description: >-
  Tiempo de ejecución de la herramienta Resolve para resolución de rutas de
  archivo, obtención de contenido y acceso a recursos basados en URL.
sidebar:
  order: 3
  label: Herramienta Resolve
i18n:
  sourceHash: 73d084ed389a
  translator: machine
---

# Componentes internos del tiempo de ejecución de la herramienta Resolve

Este documento explica cómo se modelan los flujos de trabajo de vista previa/aplicación en el agente de codificación y cómo las herramientas personalizadas pueden participar mediante `pushPendingAction`.

## Alcance y archivos clave

- [`src/tools/resolve.ts`](../../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)

## Qué hace `resolve`

`resolve` es una herramienta oculta que finaliza una acción de vista previa pendiente.

- `action: "apply"` ejecuta `apply(reason)` sobre la acción pendiente y persiste los cambios.
- `action: "discard"` invoca `reject(reason)` si se proporciona; de lo contrario, descarta la acción con un mensaje predeterminado "Descartado".

Si no existe ninguna acción pendiente, `resolve` falla con:

- `No pending action to resolve. Nothing to apply or discard.`

## Las acciones pendientes son una pila (LIFO)

Las acciones pendientes se almacenan en `PendingActionStore` como una pila push/pop:

- `push(action)` agrega una nueva acción pendiente en la cima.
- `peek()` inspecciona la acción actual en la cima.
- `pop()` elimina y devuelve la acción en la cima.
- `hasPending` indica si la pila no está vacía.

`resolve` siempre consume primero la acción pendiente **más reciente** (`pop()`), por lo que las herramientas que producen múltiples vistas previas se resuelven en orden inverso al de registro.

## Ejemplo de productor integrado (`ast_edit`)

`ast_edit` previsualiza primero los reemplazos estructurales. Cuando la vista previa tiene reemplazos y aún no ha sido aplicada, inserta una acción pendiente que contiene:

- etiqueta (resumen legible por humanos)
- `sourceToolName` (`ast_edit`)
- Callback `apply(reason: string)` que vuelve a ejecutar la edición AST con `dryRun: false`

`resolve(action="apply", reason="...")` pasa `reason` a este callback.

## Herramientas personalizadas: `pushPendingAction`

Las herramientas personalizadas pueden registrar acciones pendientes compatibles con resolve a través de `CustomToolAPI.pushPendingAction(...)`.

`CustomToolPendingAction`:

- `label: string` (obligatorio)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (obligatorio) — invocado al aplicar; `reason` es la cadena pasada a `resolve`
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (opcional) — invocado al descartar; el valor de retorno reemplaza el mensaje predeterminado "Descartado" si se proporciona
- `details?: unknown` (opcional)
- `sourceToolName?: string` (opcional, por defecto `"custom_tool"`)

### Ejemplo de uso mínimo

```ts
import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh";

const factory: CustomToolFactory = pi => ({
 name: "batch_rename_preview",
 label: "Batch Rename Preview",
 description: "Previews renames and defers commit to resolve",
 parameters: pi.typebox.Type.Object({
  files: pi.typebox.Type.Array(pi.typebox.Type.String()),
 }),

 async execute(_toolCallId, params) {
  const previewSummary = `Prepared rename plan for ${params.files.length} files`;

  pi.pushPendingAction({
   label: `Batch rename: ${params.files.length} files`,
   sourceToolName: "batch_rename_preview",
   apply: async (reason) => {
    // apply writes here
    return {
     content: [{ type: "text", text: `Applied batch rename. Reason: ${reason}` }],
    };
   },
   reject: async (reason) => {
    // optional: cleanup or notify on discard
    return {
     content: [{ type: "text", text: `Discarded batch rename. Reason: ${reason}` }],
    };
   },
  });

  return {
   content: [{ type: "text", text: `${previewSummary}. Call resolve to apply or discard.` }],
  };
 },
});

export default factory;
```

## Disponibilidad del tiempo de ejecución y fallos

`pushPendingAction` es conectado por el cargador de herramientas personalizadas utilizando el `PendingActionStore` de la sesión activa.

Si el tiempo de ejecución no tiene un almacén de acciones pendientes, `pushPendingAction` lanza:

- `Pending action store unavailable for custom tools in this runtime.`

## Comportamiento de selección de herramientas

Cuando `PendingActionStore.hasPending` es verdadero, el tiempo de ejecución del agente orienta la selección de herramientas hacia `resolve`, de modo que las vistas previas pendientes se finalicen explícitamente antes de que continúe el flujo normal de herramientas.

## Orientación para desarrolladores

- Utilice acciones pendientes únicamente para operaciones destructivas o de alto impacto que deban admitir aplicación/descarte explícito.
- Mantenga `label` conciso y específico; se muestra en la salida del renderizador de resolve.
- Asegúrese de que `apply(reason)` sea determinista e idempotente para una ejecución de un solo intento; `reason` es informativo y no debe modificar el comportamiento.
- Implemente `reject(reason)` cuando el descarte requiera limpieza (estado temporal, bloqueos, notificaciones); omítalo en vistas previas sin estado donde el mensaje predeterminado sea suficiente.
- Si su herramienta puede preparar múltiples vistas previas, recuerde la semántica LIFO: la última acción insertada se resuelve primero.
