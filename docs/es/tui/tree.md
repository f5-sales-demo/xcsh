---
title: Referencia del Comando Tree
description: >-
  Referencia del comando /tree para visualizar el historial de sesión y las
  ramas de conversación.
sidebar:
  order: 4
  label: /tree command
i18n:
  sourceHash: ee0e412fe993
  translator: machine
---

# Referencia del Comando `/tree`

`/tree` abre el navegador interactivo **Session Tree**. Le permite saltar a cualquier entrada en el archivo de sesión actual y continuar desde ese punto.

Este es un movimiento de hoja dentro del archivo, no una exportación de nueva sesión.

## Qué hace `/tree`

- Construye un árbol a partir de las entradas de la sesión actual (`SessionManager.getTree()`)
- Abre `TreeSelectorComponent` con navegación por teclado, filtros y búsqueda
- Al seleccionar, llama a `AgentSession.navigateTree(targetId, { summarize, customInstructions })`
- Reconstruye el chat visible desde la nueva ruta de hoja
- Opcionalmente rellena el editor con texto al seleccionar un mensaje de usuario/personalizado

Implementación principal:

- `src/modes/controllers/input-controller.ts` (`/tree`, asignación de atajos de teclado, comportamiento de doble escape)
- `src/modes/controllers/selector-controller.ts` (lanzamiento de UI del árbol + flujo de solicitud de resumen)
- `src/modes/components/tree-selector.ts` (navegación, filtros, búsqueda, etiquetas, renderizado)
- `src/session/agent-session.ts` (`navigateTree` cambio de hoja + resumen opcional)
- `src/session/session-manager.ts` (`getTree`, `branch`, `branchWithSummary`, `resetLeaf`, persistencia de etiquetas)

## Cómo abrirlo

Cualquiera de las siguientes opciones abre el mismo selector:

- `/tree`
- acción de atajo de teclado configurada `tree`
- doble escape con el editor vacío cuando `doubleEscapeAction = "tree"` (predeterminado)
- `/branch` cuando `doubleEscapeAction = "tree"` (redirige al selector de árbol en lugar del selector de ramas solo de usuario)

## Modelo de UI del árbol

El árbol se renderiza a partir de los punteros de entrada padre de la sesión (`id` / `parentId`).

- Los hijos se ordenan por marca de tiempo ascendente (los más antiguos primero, los más nuevos abajo)
- La rama activa (ruta desde la raíz hasta la hoja actual) se marca con una viñeta
- Las etiquetas (si están presentes) se renderizan como `[label]` antes del texto del nodo
- Si existen múltiples raíces (cadenas de padres huérfanas/rotas), se muestran bajo una raíz de ramificación virtual

```text
Example tree view (active path marked with •):

├─ user: "Start task"
│  └─ assistant: "Plan"
│     ├─ • user: "Try approach A"
│     │  └─ • assistant: "A result"
│     │     └─ • [milestone] user: "Continue A"
│     └─ user: "Try approach B"
│        └─ assistant: "B result"
```

El selector se recentra alrededor de la selección actual y muestra hasta:

- `max(5, floor(terminalHeight / 2))` filas

## Atajos de teclado dentro del selector de árbol

- `Up` / `Down`: mover selección (con ciclo)
- `Left` / `Right`: página arriba / página abajo
- `Enter`: seleccionar nodo
- `Esc`: limpiar búsqueda si está activa; de lo contrario cerrar selector
- `Ctrl+C`: cerrar selector
- `Type`: agregar a la consulta de búsqueda
- `Backspace`: eliminar carácter de búsqueda
- `Shift+L`: editar/limpiar etiqueta en la entrada seleccionada
- `Ctrl+O`: ciclar filtro hacia adelante
- `Shift+Ctrl+O`: ciclar filtro hacia atrás
- `Alt+D/T/U/L/A`: saltar directamente a un modo de filtro específico

## Filtros y semántica de búsqueda

Modos de filtro (`TreeList`):

1. `default`
2. `no-tools`
3. `user-only`
4. `labeled-only`
5. `all`

### `default`

Muestra la mayoría de los nodos conversacionales, pero oculta los tipos de entrada de mantenimiento:

- `label`
- `custom`
- `model_change`
- `thinking_level_change`

### `no-tools`

Igual que `default`, además oculta los mensajes `toolResult`.

### `user-only`

Solo entradas `message` donde el rol es `user`.

### `labeled-only`

Solo entradas que actualmente resuelven a una etiqueta.

### `all`

Todo en el árbol de sesión, incluyendo entradas de mantenimiento/personalizadas.

### Comportamiento de nodos de asistente solo con herramientas

Los mensajes del asistente que contienen **solo llamadas a herramientas** (sin texto) están ocultos por defecto en todas las vistas filtradas a menos que:

- el mensaje sea error/abortado (`stopReason` no es `stop`/`toolUse`), o
- sea la hoja actual (siempre se mantiene visible)

### Comportamiento de búsqueda

- La consulta se tokeniza por espacios
- La coincidencia no distingue mayúsculas de minúsculas
- Todos los tokens deben coincidir (semántica AND)
- El texto buscable incluye etiqueta, rol y contenido específico del tipo (texto del mensaje, texto de resumen de rama, tipo personalizado, fragmentos de comandos de herramientas, etc.)

## Resultados de selección (importante)

`navigateTree` calcula el nuevo comportamiento de hoja a partir del tipo de entrada seleccionada:

### Seleccionar mensaje de `user`

- La nueva hoja se convierte en el `parentId` de la entrada seleccionada
- Si el padre es `null` (mensaje de usuario raíz), la hoja se restablece a la raíz (`resetLeaf()`)
- El texto del mensaje seleccionado se copia al editor para edición/reenvío

### Seleccionar `custom_message`

- Misma regla de hoja que los mensajes de usuario (`parentId`)
- El contenido de texto se extrae y se copia al editor

### Seleccionar nodo que no es de usuario (asistente/herramienta/resumen/compactación/mantenimiento personalizado/etc.)

- La nueva hoja se convierte en el id del nodo seleccionado
- El editor no se rellena previamente

### Seleccionar la hoja actual

- Sin operación; el selector se cierra con "Already at this point"

```text
Selection decision (simplified):

selected node
   │
   ├─ is current leaf? ── yes ──> close selector (no-op)
   │
   ├─ is user/custom_message? ── yes ──> leaf := parentId (or resetLeaf for root)
   │                                     + prefill editor text
   │
   └─ otherwise ──> leaf := selected node id
                    + no editor prefill
```

## Flujo de resumen al cambiar

El indicador de resumen se controla con `branchSummary.enabled` (predeterminado: `false`).

Cuando está habilitado, después de elegir un nodo, la UI pregunta:

- `No summary`
- `Summarize`
- `Summarize with custom prompt`

Detalles del flujo:

- Escape en el indicador de resumen reabre el selector de árbol
- La cancelación del indicador personalizado regresa al bucle de elección de resumen
- Durante la generación del resumen, la UI muestra un cargador y vincula `Esc` a `abortBranchSummary()`
- Si el resumen se aborta, el selector de árbol se reabre y no se aplica ningún movimiento

Internos de `navigateTree`:

- Recopila las entradas de la rama abandonada desde la hoja antigua hasta el ancestro común
- Emite `session_before_tree` (las extensiones pueden cancelar o inyectar resumen)
- Usa el resumidor predeterminado solo si se solicita y es necesario
- Aplica el movimiento con:
  - `branchWithSummary(...)` cuando existe un resumen
  - `branch(newLeafId)` para movimiento no raíz sin resumen
  - `resetLeaf()` para movimiento a la raíz sin resumen
- Reemplaza la conversación del agente con el contexto de sesión reconstruido
- Emite `session_tree`

Nota: si el usuario solicita un resumen pero no hay nada que resumir, la navegación procede sin crear una entrada de resumen.

## Etiquetas

Las ediciones de etiquetas en la UI del árbol llaman a `appendLabelChange(targetId, label)`.

- Una etiqueta no vacía establece/actualiza la etiqueta resuelta
- Una etiqueta vacía la elimina
- Las etiquetas se almacenan como entradas `label` de solo adición
- Los nodos del árbol muestran el estado de etiqueta resuelto, no el historial crudo de entradas de etiquetas

## `/tree` vs operaciones adyacentes

| Operación | Alcance | Resultado |
|---|---|---|
| `/tree` | Archivo de sesión actual | Mueve la hoja al punto seleccionado (mismo archivo) |
| `/branch` | Generalmente archivo de sesión actual -> nuevo archivo de sesión | Por defecto crea una rama desde el mensaje de **usuario** seleccionado hacia un nuevo archivo de sesión; si `doubleEscapeAction = "tree"`, `/branch` abre la UI de navegación de árbol en su lugar |
| `/fork` | Sesión actual completa | Duplica la sesión en un nuevo archivo de sesión persistido |
| `/resume` | Lista de sesiones | Cambia a otro archivo de sesión |

Distinción clave: `/tree` es una herramienta de navegación/reposicionamiento dentro de un archivo de sesión. `/branch`, `/fork` y `/resume` cambian el contexto del archivo de sesión.

## Flujos de trabajo del operador

### Volver a ejecutar desde un prompt de usuario anterior sin perder la rama actual

1. `/tree`
2. buscar/seleccionar el mensaje de usuario anterior
3. elegir `No summary` (o resumir si es necesario)
4. editar el texto rellenado en el editor
5. enviar

Efecto: una nueva rama crece desde el punto seleccionado dentro del mismo archivo de sesión.

### Dejar la rama actual con una referencia de contexto

1. habilitar `branchSummary.enabled`
2. `/tree` y seleccionar el nodo objetivo
3. elegir `Summarize` (o indicador personalizado)

Efecto: se agrega una entrada `branch_summary` en la posición objetivo antes de continuar.

### Investigar entradas de mantenimiento ocultas

1. `/tree`
2. presionar `Alt+A` (all)
3. buscar `model`, `thinking`, `custom`, o etiquetas

Efecto: inspeccionar la línea temporal interna completa, no solo los nodos conversacionales.

### Marcar puntos pivote para saltos posteriores

1. `/tree`
2. moverse a la entrada
3. `Shift+L` y establecer etiqueta
4. más tarde usar `Alt+L` (`labeled-only`) para saltar rápidamente

Efecto: navegación rápida entre puntos de referencia duraderos de ramas.
