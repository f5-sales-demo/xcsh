---
title: Compactación y Resúmenes de Rama
description: >-
  Compactación de la ventana de contexto y generación de resúmenes de rama para
  sesiones de larga duración.
sidebar:
  order: 5
  label: Compactación
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# Compactación y Resúmenes de Rama

La compactación y los resúmenes de rama son los dos mecanismos que mantienen las sesiones largas utilizables sin perder el contexto de trabajo previo.

- **Compactación** reescribe el historial antiguo en un resumen dentro de la rama actual.
- **Resumen de rama** captura el contexto de ramas abandonadas durante la navegación con `/tree`.

Ambos se persisten como entradas de sesión y se convierten de nuevo en mensajes de contexto de usuario al reconstruir la entrada del LLM.

## Archivos de implementación clave

- `src/session/compaction/compaction.ts`
- `src/session/compaction/branch-summarization.ts`
- `src/session/compaction/pruning.ts`
- `src/session/compaction/utils.ts`
- `src/session/session-manager.ts`
- `src/session/agent-session.ts`
- `src/session/messages.ts`
- `src/extensibility/hooks/types.ts`
- `src/config/settings-schema.ts`

## Modelo de entradas de sesión

La compactación y los resúmenes de rama son entradas de sesión de primera clase, no mensajes simples de asistente/usuario.

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`, `shortSummary` opcional
  - `firstKeptEntryId` (límite de compactación)
  - `tokensBefore`
  - `details`, `preserveData`, `fromExtension` opcionales
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`, `summary`
  - `details`, `fromExtension` opcionales

Cuando se reconstruye el contexto (`buildSessionContext`):

1. La última compactación en la ruta activa se convierte en un mensaje `compactionSummary`.
2. Las entradas conservadas desde `firstKeptEntryId` hasta el punto de compactación se reincluyen.
3. Las entradas posteriores en la ruta se agregan al final.
4. Las entradas `branch_summary` se convierten en mensajes `branchSummary`.
5. Las entradas `custom_message` se convierten en mensajes `custom`.

Esos roles personalizados se transforman luego en mensajes de usuario orientados al LLM en `convertToLlm()` usando las plantillas estáticas:

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## Pipeline de compactación

### Disparadores

La compactación puede ejecutarse de tres formas:

1. **Manual**: `/compact [instrucciones]` llama a `AgentSession.compact(...)`.
2. **Recuperación automática por desbordamiento**: después de un error del asistente que coincide con desbordamiento de contexto.
3. **Compactación automática por umbral**: después de un turno exitoso cuando el contexto excede el umbral.

### Forma de la compactación (visual)

```text
Antes de la compactación:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

Después de la compactación (nueva entrada agregada):

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 no se envía al LLM                  se envía al LLM
                                                         ↑
                                              comienza desde firstKeptEntryId

Lo que ve el LLM:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          mensajes desde firstKeptEntryId
```

### Compactación por desbordamiento-reintento vs por umbral

Las dos rutas automáticas son intencionalmente diferentes:

- **Compactación por desbordamiento-reintento**
  - Disparador: se detecta que el error del asistente del modelo actual es un desbordamiento de contexto.
  - El mensaje de error del asistente fallido se elimina del estado activo del agente antes del reintento.
  - La compactación automática se ejecuta con `reason: "overflow"` y `willRetry: true`.
  - Si tiene éxito, el agente continúa automáticamente (`agent.continue()`) después de la compactación.

- **Compactación por umbral**
  - Disparador: `contextTokens > contextWindow - compaction.reserveTokens`.
  - Se ejecuta con `reason: "threshold"` y `willRetry: false`.
  - Si tiene éxito, si `compaction.autoContinue !== false`, inyecta un prompt sintético:
    - `"Continue if you have next steps."`

### Poda pre-compactación

Antes de las verificaciones de compactación, puede ejecutarse la poda de resultados de herramientas (`pruneToolOutputs`).

Política de poda predeterminada:

- Proteger los `40_000` tokens más recientes de salida de herramientas.
- Requerir al menos `20_000` tokens totales de ahorro estimado.
- Nunca podar resultados de herramientas de `skill` o `read`.

Los resultados de herramientas podados se reemplazan con:

- `[Output truncated - N tokens]`

Si la poda modifica entradas, el almacenamiento de sesión se reescribe y el estado de mensajes del agente se actualiza antes de las decisiones de compactación.

### Lógica de límite y punto de corte

`prepareCompaction()` solo considera entradas desde la última entrada de compactación (si existe).

1. Encontrar el índice de compactación anterior.
2. Calcular `boundaryStart = prevCompactionIndex + 1`.
3. Adaptar `keepRecentTokens` usando la relación de uso medida cuando esté disponible.
4. Ejecutar `findCutPoint()` sobre la ventana de límite.

Los puntos de corte válidos incluyen:

- Entradas de mensaje con roles: `user`, `assistant`, `bashExecution`, `hookMessage`, `branchSummary`, `compactionSummary`
- Entradas `custom_message`
- Entradas `branch_summary`

Regla estricta: nunca cortar en `toolResult`.

Si hay entradas de metadatos que no son mensajes inmediatamente antes del punto de corte (`model_change`, `thinking_level_change`, etiquetas, etc.), se incorporan a la región conservada moviendo el índice de corte hacia atrás hasta que se encuentre un mensaje o un límite de compactación.

### Manejo de turnos divididos

Si el punto de corte no está al inicio de un turno de usuario, la compactación lo trata como un turno dividido.

La detección de inicio de turno trata estos como límites de turno de usuario:

- `message.role === "user"`
- `message.role === "bashExecution"`
- Entrada `custom_message`
- Entrada `branch_summary`

La compactación de turno dividido genera dos resúmenes:

1. Resumen del historial (`messagesToSummarize`)
2. Resumen del prefijo del turno (`turnPrefixMessages`)

El resumen final almacenado se fusiona como:

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### Generación de resúmenes

`compact(...)` construye resúmenes a partir de texto de conversación serializado:

1. Convertir mensajes via `convertToLlm()`.
2. Serializar con `serializeConversation()`.
3. Envolver en `<conversation>...</conversation>`.
4. Opcionalmente incluir `<previous-summary>...</previous-summary>`.
5. Opcionalmente inyectar contexto de hook como lista `<additional-context>`.
6. Ejecutar el prompt de resumen con `SUMMARIZATION_SYSTEM_PROMPT`.

Selección de prompt:

- primera compactación: `compaction-summary.md`
- compactación iterativa con resumen previo: `compaction-update-summary.md`
- segunda pasada de turno dividido: `compaction-turn-prefix.md`
- resumen corto para UI: `compaction-short-summary.md`

Modo de resumen remoto:

- Si `compaction.remoteEndpoint` está configurado, la compactación envía POST:
  - `{ systemPrompt, prompt }`
- Espera JSON que contenga al menos `{ summary }`.

### Contexto de operaciones de archivo en resúmenes

La compactación rastrea la actividad acumulativa de archivos usando llamadas a herramientas del asistente:

- `read(path)` → conjunto de lectura
- `write(path)` → conjunto de modificados
- `edit(path)` → conjunto de modificados

Comportamiento acumulativo:

- Incluye detalles de compactación anterior solo cuando la entrada previa es generada por pi (`fromExtension !== true`).
- En turnos divididos, incluye también las operaciones de archivo del prefijo del turno.
- `readFiles` excluye archivos que también fueron modificados.

El texto del resumen recibe etiquetas de archivo agregadas via plantilla de prompt:

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### Persistir y recargar

Después de la generación del resumen (o resumen proporcionado por hook), la sesión del agente:

1. Agrega `CompactionEntry` con `appendCompaction(...)`.
2. Reconstruye el contexto via `buildSessionContext()`.
3. Reemplaza los mensajes activos del agente con el contexto reconstruido.
4. Emite el evento de hook `session_compact`.

## Pipeline de resumen de rama

El resumen de rama está vinculado a la navegación del árbol, no al desbordamiento de tokens.

### Disparador

Durante `navigateTree(...)`:

1. Calcular las entradas abandonadas desde la hoja antigua hasta el ancestro común usando `collectEntriesForBranchSummary(...)`.
2. Si el llamador solicitó resumen (`options.summarize`), generar el resumen antes de cambiar de hoja.
3. Si existe resumen, adjuntarlo en el destino de navegación usando `branchWithSummary(...)`.

Operacionalmente esto es comúnmente impulsado por el flujo `/tree` cuando `branchSummary.enabled` está habilitado.

### Forma del cambio de rama (visual)

```text
Árbol antes de la navegación:

         ┌─ B ─ C ─ D (hoja antigua, siendo abandonada)
    A ───┤
         └─ E ─ F (destino)

Ancestro común: A
Entradas a resumir: B, C, D

Después de la navegación con resumen:

         ┌─ B ─ C ─ D ─ [resumen de B,C,D]
    A ───┤
         └─ E ─ F (nueva hoja)
```

### Preparación y presupuesto de tokens

`generateBranchSummary(...)` calcula el presupuesto como:

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` luego:

1. Primera pasada: recopilar operaciones de archivo acumulativas de todas las entradas resumidas, incluyendo detalles previos de `branch_summary` generados por pi.
2. Segunda pasada: recorrer desde la más reciente → más antigua, agregando mensajes hasta alcanzar el presupuesto de tokens.
3. Preferir preservar el contexto reciente.
4. Puede aún incluir entradas de resumen grandes cerca del límite del presupuesto para continuidad.

Las entradas de compactación se incluyen como mensajes (`compactionSummary`) durante la entrada del resumen de rama.

### Generación y persistencia del resumen

Resumen de rama:

1. Convierte y serializa los mensajes seleccionados.
2. Envuelve en `<conversation>`.
3. Usa instrucciones personalizadas si se proporcionan, de lo contrario `branch-summary.md`.
4. Llama al modelo de resumen con `SUMMARIZATION_SYSTEM_PROMPT`.
5. Antepone `branch-summary-preamble.md`.
6. Agrega etiquetas de operaciones de archivo.

El resultado se almacena como `BranchSummaryEntry` con detalles opcionales (`readFiles`, `modifiedFiles`).

## Puntos de contacto de extensión y hooks

### `session_before_compact`

Hook pre-compactación.

Puede:

- cancelar la compactación (`{ cancel: true }`)
- proporcionar un payload de compactación personalizado completo (`{ compaction: CompactionResult }`)

### `session.compacting`

Hook de personalización de prompt/contexto para la compactación predeterminada.

Puede devolver:

- `prompt` (sobreescribir el prompt base de resumen)
- `context` (líneas de contexto extra inyectadas en `<additional-context>`)
- `preserveData` (almacenado en la entrada de compactación)

### `session_compact`

Notificación post-compactación con `compactionEntry` guardado y flag `fromExtension`.

### `session_before_tree`

Se ejecuta en la navegación del árbol antes de la generación predeterminada del resumen de rama.

Puede:

- cancelar la navegación
- proporcionar `{ summary: { summary, details } }` personalizado usado cuando el usuario solicitó resumen

### `session_tree`

Evento post-navegación que expone la hoja nueva/antigua y la entrada de resumen opcional.

## Comportamiento en tiempo de ejecución y semántica de fallos

- La compactación manual aborta primero la operación actual del agente.
- `abortCompaction()` cancela tanto los controladores de compactación manual como automática.
- La compactación automática emite eventos de sesión de inicio/fin para actualizaciones de UI/estado.
- La compactación automática puede intentar múltiples modelos candidatos y reintentar fallos transitorios.
- Los errores de desbordamiento se excluyen de la ruta de reintento genérica porque son manejados por la compactación.
- Si la compactación automática falla:
  - la ruta de desbordamiento emite `Context overflow recovery failed: ...`
  - la ruta de umbral emite `Auto-compaction failed: ...`
- El resumen de rama puede cancelarse via señal de aborto (por ejemplo, Escape), devolviendo un resultado de navegación cancelado/abortado.

## Configuración y valores predeterminados

Desde `settings-schema.ts`:

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

Estos valores son consumidos en tiempo de ejecución por `AgentSession` y los módulos de compactación/resumen de rama.
