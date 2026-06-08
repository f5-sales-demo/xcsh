---
title: Descubrimiento y Selección de Agentes de Tarea
description: >-
  Lógica de descubrimiento y selección de agentes de tarea para enrutar trabajo
  a tipos de subagentes especializados.
sidebar:
  order: 6
  label: Descubrimiento de agentes de tarea
i18n:
  sourceHash: 8cf42457c672
  translator: machine
---

# Descubrimiento y Selección de Agentes de Tarea

Este documento describe cómo el subsistema de tareas descubre definiciones de agentes, fusiona múltiples fuentes y resuelve un agente solicitado en tiempo de ejecución.

Cubre el comportamiento en tiempo de ejecución tal como está implementado actualmente, incluyendo precedencia, manejo de definiciones inválidas y restricciones de generación/profundidad que pueden hacer que un agente sea efectivamente no disponible.

## Archivos de implementación

- [`src/task/discovery.ts`](../../packages/coding-agent/src/task/discovery.ts)
- [`src/task/agents.ts`](../../packages/coding-agent/src/task/agents.ts)
- [`src/task/types.ts`](../../packages/coding-agent/src/task/types.ts)
- [`src/task/index.ts`](../../packages/coding-agent/src/task/index.ts)
- [`src/task/commands.ts`](../../packages/coding-agent/src/task/commands.ts)
- [`src/prompts/agents/task.md`](../../packages/coding-agent/src/prompts/agents/task.md)
- [`src/prompts/tools/task.md`](../../packages/coding-agent/src/prompts/tools/task.md)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/config.ts`](../../packages/coding-agent/src/config.ts)
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts)

---

## Forma de la definición de agente

Los agentes de tarea se normalizan en `AgentDefinition` (`src/task/types.ts`):

- `name`, `description`, `systemPrompt` (requeridos para un agente cargado válido)
- opcionales: `tools`, `spawns`, `model`, `thinkingLevel`, `output`
- `source`: `"bundled" | "user" | "project"`
- `filePath` opcional

El análisis proviene del frontmatter mediante `parseAgentFields()` (`src/discovery/helpers.ts`):

- `name` o `description` faltantes => inválido (`null`), el llamador lo trata como fallo de análisis
- `tools` acepta CSV o array; si se proporciona, `submit_result` se agrega automáticamente
- `spawns` acepta `*`, CSV o array
- comportamiento de compatibilidad hacia atrás: si `spawns` falta pero `tools` incluye `task`, `spawns` se convierte en `*`
- `output` se pasa tal cual como datos de esquema opacos

## Agentes integrados

Los agentes integrados se incrustan en tiempo de compilación (`src/task/agents.ts`) usando importaciones de texto.

`EMBEDDED_AGENT_DEFS` define:

- `explore`, `plan`, `designer`, `reviewer` desde archivos de prompt
- `task` y `quick_task` desde el cuerpo compartido `task.md` más frontmatter inyectado

Ruta de carga:

1. `loadBundledAgents()` analiza el markdown incrustado con `parseAgent(..., "bundled", "fatal")`
2. los resultados se almacenan en caché en memoria (`bundledAgentsCache`)
3. `clearBundledAgentsCache()` es un reinicio de caché solo para pruebas

Dado que el análisis de los integrados usa `level: "fatal"`, un frontmatter mal formado en los integrados lanza una excepción y puede hacer fallar el descubrimiento por completo.

## Descubrimiento desde sistema de archivos y plugins

`discoverAgents(cwd, home)` (`src/task/discovery.ts`) fusiona agentes de múltiples lugares antes de agregar las definiciones integradas.

### Entradas de descubrimiento

1. Directorios de agentes de la configuración de usuario desde `getConfigDirs("agents", { project: false })`
2. Directorios de agentes del proyecto más cercano desde `findAllNearestProjectConfigDirs("agents", cwd)`
3. Raíces de plugins de Claude (`listClaudePluginRoots(home)`) con subdirectorios `agents/`
4. Agentes integrados (`loadBundledAgents()`)

### Orden real de las fuentes

El orden de las familias de fuentes proviene de `getConfigDirs("", { project: false })`, que se deriva de `priorityList` en `src/config.ts`:

1. `.xcsh`
2. `.claude`
3. `.codex`
4. `.gemini`

Para cada familia de fuentes, el orden de descubrimiento es:

1. directorio del proyecto más cercano para esa fuente (si se encuentra)
2. directorio de usuario para esa fuente

Después de todos los directorios de familias de fuentes, se agregan los directorios `agents/` de plugins (primero plugins de ámbito de proyecto, luego de ámbito de usuario).

Los agentes integrados se agregan al final.

### Advertencia importante: comentarios desactualizados vs código actual

Los comentarios de encabezado de `discovery.ts` aún mencionan `.pi` y no mencionan `.codex`/`.gemini`. El orden real en tiempo de ejecución está controlado por `src/config.ts` y actualmente usa `.xcsh`, `.claude`, `.codex`, `.gemini`.

## Reglas de fusión y colisión

El descubrimiento usa deduplicación por primera aparición basada en el `agent.name` exacto:

- Un `Set<string>` rastrea los nombres ya vistos.
- Los agentes cargados se aplanan en orden de directorio y se mantienen solo si el nombre no se ha visto.
- Los agentes integrados se filtran contra el mismo conjunto y solo se agregan si aún no se han visto.

Implicaciones:

- El proyecto sobrescribe al usuario para la misma familia de fuentes.
- La familia de fuentes de mayor prioridad sobrescribe a la de menor prioridad (`.xcsh` antes que `.claude`, etc.).
- Los agentes no integrados sobrescriben a los agentes integrados con el mismo nombre.
- La coincidencia de nombres es sensible a mayúsculas y minúsculas (`Task` y `task` son distintos).
- Dentro de un directorio, los archivos markdown se leen en orden lexicográfico de nombre de archivo antes de la deduplicación.

## Comportamiento ante archivos de agente inválidos/faltantes

Por directorio (`loadAgentsFromDir`):

- directorio ilegible/faltante: tratado como vacío (`readdir(...).catch(() => [])`)
- fallo en lectura o análisis de archivo: se registra advertencia, se omite el archivo
- la ruta de análisis usa `parseAgent(..., level: "warn")`

El comportamiento ante fallos de frontmatter proviene de `parseFrontmatter`:

- error de análisis en nivel `warn` registra una advertencia
- el analizador recurre a un analizador simple línea por línea de `key: value`
- si los campos requeridos siguen faltando, `parseAgentFields` falla, entonces se lanza `AgentParsingError` y es capturado por el llamador (se omite el archivo)

Efecto neto: un archivo de agente personalizado defectuoso no aborta el descubrimiento de otros archivos.

## Búsqueda y selección de agentes

La búsqueda es una búsqueda lineal por nombre exacto:

- `getAgent(agents, name)` => `agents.find(a => a.name === name)`

En la ejecución de tareas (`TaskTool.execute`):

1. los agentes se redescubren en el momento de la llamada (`discoverAgents(this.session.cwd)`)
2. el `params.agent` solicitado se resuelve a través de `getAgent`
3. un agente faltante devuelve una respuesta inmediata de la herramienta:
   - `Unknown agent "...". Available: ...`
   - no se ejecuta ningún subproceso

### Descripción vs descubrimiento en tiempo de ejecución

`TaskTool.create()` construye la descripción de la herramienta a partir de los resultados de descubrimiento en el momento de la inicialización (`buildDescription`).

`execute()` redescubre los agentes nuevamente. Por lo tanto, el conjunto en tiempo de ejecución puede diferir de lo que se listó en la descripción anterior de la herramienta si los archivos de agente cambiaron durante la sesión.

## Guardarraíles de salida estructurada y precedencia de esquema

Precedencia del esquema de salida en tiempo de ejecución en `TaskTool.execute`:

1. `output` del frontmatter del agente
2. `params.schema` de la llamada a la tarea
3. `outputSchema` de la sesión padre

(`effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema`)

El texto de guardarraíl en el prompt en `src/prompts/tools/task.md` advierte sobre el comportamiento de desajuste para agentes de salida estructurada (`explore`, `reviewer`): las instrucciones de formato de salida en prosa pueden entrar en conflicto con el esquema integrado y producir salidas `null`.

Esto es orientación, no lógica de validación en tiempo de ejecución dentro de `discoverAgents`.

## Interacción con el descubrimiento de comandos

`src/task/commands.ts` es infraestructura paralela para comandos de flujo de trabajo (no definiciones de agentes), pero sigue el mismo patrón general:

- descubrir primero desde proveedores de capacidades
- deduplicar por nombre con primera aparición gana
- agregar comandos integrados si aún no se han visto
- búsqueda por nombre exacto mediante `getCommand`

En `src/task/index.ts`, los helpers de comandos se re-exportan junto con los helpers de descubrimiento de agentes. El descubrimiento de agentes en sí no depende del descubrimiento de comandos en tiempo de ejecución.

## Restricciones de disponibilidad más allá del descubrimiento

Un agente puede ser descubrible pero aún no estar disponible para ejecutarse debido a guardarraíles de ejecución.

### Política de generación del padre

`TaskTool.execute` verifica `session.getSessionSpawns()`:

- `"*"` => permitir cualquiera
- `""` => denegar todos
- lista CSV => permitir solo los nombres listados

Si se deniega: respuesta inmediata `Cannot spawn '...'. Allowed: ...`.

### Guardia de entorno para auto-recursión bloqueada

`PI_BLOCKED_AGENT` se lee en la construcción de la herramienta. Si la solicitud coincide, la ejecución se rechaza con un mensaje de prevención de recursión.

### Control de profundidad de recursión (disponibilidad de herramienta task dentro de sesiones hijas)

En `runSubprocess` (`src/task/executor.ts`):

- la profundidad se calcula a partir de `taskDepth`
- `task.maxRecursionDepth` controla el límite
- cuando se alcanza la profundidad máxima:
  - la herramienta `task` se elimina de la lista de herramientas del hijo
  - el `spawns` del entorno hijo se establece como vacío

Por lo tanto, los niveles más profundos no pueden generar más tareas incluso si la definición del agente incluye `spawns`.

## Advertencia sobre el modo plan (implementación actual)

`TaskTool.execute` calcula un `effectiveAgent` para el modo plan (antepone el prompt del modo plan, fuerza un subconjunto de herramientas de solo lectura, limpia spawns), pero `runSubprocess` se llama con `agent` en lugar de `effectiveAgent`.

Efecto actual:

- la sobrescritura del modelo / nivel de pensamiento / esquema de salida se derivan de `effectiveAgent`
- el prompt del sistema y las restricciones de herramientas/spawns de `effectiveAgent` no se pasan a través de esta ruta de llamada

Esta es una advertencia de implementación que vale la pena conocer al leer las expectativas de comportamiento del modo plan.
