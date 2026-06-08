---
title: Arquitectura del árbol de sesión
description: >-
  Arquitectura del árbol de sesión con ramificación, navegación y relaciones de
  conversación padre-hijo.
sidebar:
  order: 2
  label: Arquitectura de árbol
i18n:
  sourceHash: bd8b78d6c33a
  translator: machine
---

# Arquitectura del árbol de sesión (actual)

Referencia: [session.md](./session.md)

Este documento describe cómo funciona actualmente la navegación del árbol de sesión: modelo de árbol en memoria, reglas de movimiento de hoja, comportamiento de ramificación e integración de extensiones/eventos.

## Qué es este subsistema

La sesión se almacena como un registro de entradas de solo anexado, pero el comportamiento en tiempo de ejecución está basado en árbol:

- Cada entrada que no es encabezado tiene `id` y `parentId`.
- La posición activa es `leafId` en `SessionManager`.
- Anexar una entrada siempre crea un hijo de la hoja actual.
- La ramificación **no** reescribe el historial; solo cambia a dónde apunta la hoja antes del siguiente anexado.

Archivos clave:

- `src/session/session-manager.ts` — modelo de datos del árbol, recorrido, movimiento de hoja, extracción de rama/sesión
- `src/session/agent-session.ts` — flujo de navegación `/tree`, resumen, emisión de hooks/eventos
- `src/modes/components/tree-selector.ts` — comportamiento interactivo de la UI del árbol y filtrado
- `src/modes/controllers/selector-controller.ts` — orquestación del selector para `/tree` y `/branch`
- `src/modes/controllers/input-controller.ts` — enrutamiento de comandos (`/tree`, `/branch`, comportamiento de doble escape)
- `src/session/messages.ts` — conversión de entradas `branch_summary`, `compaction` y `custom_message` en mensajes de contexto para el LLM

## Modelo de datos del árbol en `SessionManager`

Índices en tiempo de ejecución:

- `#byId: Map<string, SessionEntry>` — búsqueda rápida de cualquier entrada
- `#leafId: string | null` — posición actual en el árbol
- `#labelsById: Map<string, string>` — etiquetas resueltas por id de entrada objetivo

APIs del árbol:

- `getBranch(fromId?)` recorre los enlaces padre hasta la raíz y devuelve la ruta raíz→nodo
- `getTree()` devuelve `SessionTreeNode[]` (`entry`, `children`, `label`)
  - los enlaces padre se convierten en arrays de hijos
  - las entradas con padres faltantes se tratan como raíces
  - los hijos se ordenan del más antiguo al más reciente por marca de tiempo
- `getChildren(parentId)` devuelve los hijos directos
- `getLabel(id)` resuelve la etiqueta actual desde `labelsById`

`getTree()` es una proyección en tiempo de ejecución; la persistencia permanece como entradas JSONL de solo anexado.

## Semántica del movimiento de hoja

Existen tres primitivas de movimiento de hoja:

1. `branch(entryId)`
   - Valida que la entrada existe
   - Establece `leafId = entryId`
   - No se escribe ninguna entrada nueva

2. `resetLeaf()`
   - Establece `leafId = null`
   - El siguiente anexado crea una nueva entrada raíz (`parentId = null`)

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - Acepta `branchFromId: string | null`
   - Establece `leafId = branchFromId`
   - Anexa una entrada `branch_summary` como hija de esa hoja
   - Cuando `branchFromId` es `null`, `fromId` se persiste como `"root"`

## Comportamiento de navegación `/tree` (mismo archivo de sesión)

`AgentSession.navigateTree()` es navegación, no bifurcación de archivo.

Flujo:

1. Validar el objetivo y calcular la ruta abandonada (`collectEntriesForBranchSummary`)
2. Emitir `session_before_tree` con `TreePreparation`
3. Opcionalmente resumir las entradas abandonadas (resumen proporcionado por hook o resumidor integrado)
4. Calcular el nuevo objetivo de hoja:
   - al seleccionar un mensaje de **usuario**: la hoja se mueve a su padre, y el texto del mensaje se devuelve para prellenar el editor
   - al seleccionar un **custom_message**: misma regla que mensaje de usuario (hoja = padre, el texto prellena el editor)
   - al seleccionar cualquier otra entrada: hoja = id de la entrada seleccionada
5. Aplicar movimiento de hoja:
   - con resumen: `branchWithSummary(newLeafId, ...)`
   - sin resumen y `newLeafId === null`: `resetLeaf()`
   - en caso contrario: `branch(newLeafId)`
6. Reconstruir el contexto del agente desde la nueva hoja y emitir `session_tree`

Importante: las entradas de resumen se adjuntan en la **nueva posición de navegación**, no en la cola de la rama abandonada.

## Comportamiento de `/branch` (nuevo archivo de sesión)

`/branch` y `/tree` son intencionalmente diferentes:

- `/tree` navega dentro del archivo de sesión actual.
- `/branch` crea un nuevo archivo de rama de sesión (o reemplazo en memoria para modo no persistente).

Flujo de `/branch` visible para el usuario (`SelectorController.showUserMessageSelector` → `AgentSession.branch`):

- La fuente de la rama debe ser un **mensaje de usuario**.
- El texto del usuario seleccionado se extrae para prellenar el editor.
- Si el mensaje de usuario seleccionado es raíz (`parentId === null`): iniciar una nueva sesión mediante `newSession({ parentSession: previousSessionFile })`.
- En caso contrario: `createBranchedSession(selectedEntry.parentId)` para bifurcar el historial hasta el límite del prompt seleccionado.

Especificaciones de `SessionManager.createBranchedSession(leafId)`:

- Construye la ruta raíz→hoja mediante `getBranch(leafId)`; lanza error si no se encuentra.
- Excluye las entradas `label` existentes de la ruta copiada.
- Reconstruye entradas de etiqueta nuevas desde `labelsById` resueltas para las entradas que permanecen en la ruta.
- Modo persistente: escribe un nuevo archivo JSONL y cambia el manager a él; devuelve la nueva ruta de archivo.
- Modo en memoria: reemplaza las entradas en memoria; devuelve `undefined`.

## Reconstrucción de contexto e integración de resumen/personalizado

`buildSessionContext()` (en `session-manager.ts`) resuelve la ruta activa raíz→hoja y construye el estado de contexto efectivo del LLM:

- Rastrea el último estado de thinking/model/mode/ttsr en la ruta.
- Maneja la última compactación en la ruta:
  - emite primero el resumen de compactación
  - reproduce los mensajes conservados desde `firstKeptEntryId` hasta el punto de compactación
  - luego reproduce los mensajes posteriores a la compactación
- Incluye las entradas `branch_summary` y `custom_message` como objetos `AgentMessage`.

`session/messages.ts` luego mapea estos tipos de mensaje para la entrada del modelo:

- `branchSummary` y `compactionSummary` se convierten en mensajes de contexto con plantilla de rol usuario
- `custom`/`hookMessage` se convierten en mensajes de contenido con rol usuario

Así que el movimiento en el árbol cambia el contexto al cambiar la ruta activa de la hoja, no al mutar entradas antiguas.

## Etiquetas y comportamiento de la UI del árbol

Persistencia de etiquetas:

- `appendLabelChange(targetId, label?)` escribe entradas `label` en la cadena de hoja actual.
- `labelsById` se actualiza inmediatamente (establecer o eliminar).
- `getTree()` resuelve la etiqueta actual en cada nodo devuelto.

Comportamiento del selector de árbol (`tree-selector.ts`):

- Aplana el árbol para navegación, mantiene el resaltado de la ruta activa y prioriza mostrar la rama activa primero.
- Soporta modos de filtro: `default`, `no-tools`, `user-only`, `labeled-only`, `all`.
- Soporta búsqueda de texto libre sobre el contenido semántico renderizado.
- `Shift+L` abre la edición inline de etiquetas y escribe mediante `appendLabelChange`.

Enrutamiento de comandos:

- `/tree` siempre abre el selector de árbol.
- `/branch` abre el selector de mensajes de usuario a menos que `doubleEscapeAction=tree`, en cuyo caso también usa la UX del selector de árbol.

## Puntos de contacto de extensiones y hooks para operaciones del árbol

API de extensión en tiempo de comando (`ExtensionCommandContext`):

- `branch(entryId)` — crear archivo de sesión ramificada
- `navigateTree(targetId, { summarize? })` — moverse dentro del árbol/archivo actual

Eventos alrededor de la navegación del árbol:

- `session_before_tree`
  - recibe `TreePreparation`:
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - puede cancelar la navegación
  - puede proporcionar payload de resumen usado en lugar del resumidor integrado
  - recibe `signal` de cancelación (ruta de cancelación por Escape)
- `session_tree`
  - emite `newLeafId`, `oldLeafId`
  - incluye `summaryEntry` cuando se creó un resumen
  - `fromExtension` indica el origen del resumen

Hooks de ciclo de vida adyacentes pero relacionados:

- `session_before_branch` / `session_branch` para el flujo de `/branch`
- `session_before_compact`, `session.compacting`, `session_compact` para entradas de compactación que posteriormente afectan la reconstrucción del contexto del árbol

## Restricciones reales y condiciones límite

- `branch()` no puede apuntar a `null`; usar `resetLeaf()` para el estado raíz-antes-de-primera-entrada.
- `branchWithSummary()` soporta objetivo `null` y registra `fromId: "root"`.
- Seleccionar la hoja actual en el selector de árbol es una operación nula.
- El resumen requiere un modelo activo; si está ausente, la navegación con resumen falla rápidamente.
- Si el resumen se cancela, la navegación se cancela y la hoja permanece sin cambios.
- Las sesiones en memoria nunca devuelven una ruta de archivo de rama desde `createBranchedSession`.

## Compatibilidad heredada aún presente

Las migraciones de sesión aún se ejecutan al cargar:

- v1→v2 añade `id`/`parentId` y convierte el ancla de índice de compactación a ancla de id
- v2→v3 migra el rol heredado `hookMessage` a `custom`

El comportamiento actual en tiempo de ejecución es la semántica de árbol de versión 3 después de la migración.
