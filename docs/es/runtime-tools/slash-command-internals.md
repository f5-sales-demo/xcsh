---
title: Aspectos internos de los comandos de barra
description: >-
  Aspectos internos del sistema de comandos de barra con registro, análisis de
  argumentos y despacho de ejecución.
sidebar:
  order: 5
  label: Comandos de barra
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# Aspectos internos de los comandos de barra

Este documento describe cómo los comandos de barra se descubren, deduplicación, se presentan en modo interactivo y se expanden en el momento del prompt en `coding-agent`.

## Archivos de implementación

- [`src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)
- [`src/capability/slash-command.ts`](../../packages/coding-agent/src/capability/slash-command.ts)
- [`src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`src/discovery/claude.ts`](../../packages/coding-agent/src/discovery/claude.ts)
- [`src/discovery/codex.ts`](../../packages/coding-agent/src/discovery/codex.ts)
- [`src/discovery/claude-plugins.ts`](../../packages/coding-agent/src/discovery/claude-plugins.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)

## 1) Modelo de descubrimiento

Los comandos de barra son una capacidad (`id: "slash-commands"`) indexada por nombre de comando (`key: cmd => cmd.name`).

El registro de capacidades carga todos los proveedores registrados, ordenados por prioridad de proveedor de forma descendente, y elimina duplicados por clave con semántica de **el primero gana**.

### Precedencia de proveedores

Proveedores actuales de comandos de barra y sus prioridades:

1. `native` (OMP) — prioridad `100`
2. `claude` — prioridad `80`
3. `claude-plugins` — prioridad `70`
4. `codex` — prioridad `70`

Comportamiento en empates: los proveedores con igual prioridad mantienen el orden de registro. El orden de importación actual registra `claude-plugins` antes que `codex`, por lo que los comandos de plugin prevalecen sobre los comandos de codex en colisiones de nombres.

### Comportamiento en colisiones de nombres

Para `slash-commands`, las colisiones se resuelven estrictamente mediante deduplicación de capacidades:

- el elemento de mayor precedencia se conserva en `result.items`
- los duplicados de menor precedencia permanecen únicamente en `result.all` y se marcan con `_shadowed = true`

Esto se aplica entre proveedores y también dentro de un proveedor si devuelve nombres duplicados.

### Comportamiento de análisis de archivos

Los proveedores utilizan principalmente `loadFilesFromDir(...)`, que actualmente:

- tiene como valor predeterminado la coincidencia no recursiva (`*.md`)
- utiliza glob nativo con `gitignore: true`, `hidden: false`
- lee cada archivo coincidente y lo transforma en un `SlashCommand`

Por lo tanto, los archivos y directorios ocultos no se cargan, y las rutas ignoradas se omiten.

## 2) Rutas de origen específicas del proveedor y precedencia local

## Proveedor `native` (`builtin.ts`)

Las raíces de búsqueda provienen de directorios `.xcsh`:

- proyecto: `<cwd>/.xcsh/commands/*.md`
- usuario: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` devuelve primero el proyecto y luego el usuario, por lo que **los comandos nativos del proyecto prevalecen sobre los comandos nativos del usuario** cuando los nombres colisionan.

## Proveedor `claude` (`claude.ts`)

Carga:

- usuario: `~/.claude/commands/*.md`
- proyecto: `<cwd>/.claude/commands/*.md`

El proveedor inserta los elementos del usuario antes que los del proyecto, por lo que **los comandos Claude del usuario prevalecen sobre los comandos Claude del proyecto** en colisiones de mismo nombre dentro de este proveedor.

## Proveedor `codex` (`codex.ts`)

Carga:

- usuario: `~/.codex/commands/*.md`
- proyecto: `<cwd>/.codex/commands/*.md`

Ambos lados se cargan y luego se aplanan en orden del usuario primero, por lo que **los comandos Codex del usuario prevalecen sobre los comandos Codex del proyecto** en colisiones.

El contenido de los comandos Codex se analiza con eliminación de frontmatter (`parseFrontmatter`), y el nombre del comando puede ser reemplazado por el frontmatter `name`; de lo contrario, se utiliza el nombre del archivo.

## Proveedor `claude-plugins` (`claude-plugins.ts`)

Carga las raíces de comandos de plugins desde `~/.claude/plugins/installed_plugins.json`, luego analiza `<pluginRoot>/commands/*.md`.

El orden sigue el orden de iteración del registro y el orden de entrada por plugin de ese dato JSON. No hay un paso de ordenación adicional.

## 3) Materialización al `FileSlashCommand` en tiempo de ejecución

`loadSlashCommands()` en `src/extensibility/slash-commands.ts` convierte los elementos de capacidad en objetos `FileSlashCommand` utilizados en el momento del prompt.

Para cada comando:

1. analizar frontmatter/cuerpo (`parseFrontmatter`)
2. fuente de descripción:
   - `frontmatter.description` si está presente
   - de lo contrario, la primera línea no vacía del cuerpo (recortada, máximo 60 caracteres con `...`)
3. conservar el cuerpo analizado como contenido de plantilla ejecutable
4. calcular una cadena de fuente de visualización como `via Claude Code Project`

La severidad del análisis de frontmatter depende de la fuente:

- nivel `native` -> los errores de análisis son `fatal`
- niveles `user`/`project` -> los errores de análisis son `warn` con análisis de respaldo

### Comandos de respaldo integrados

Después de los comandos del sistema de archivos/proveedor, se añaden plantillas de comandos integrados (`EMBEDDED_COMMAND_TEMPLATES`) si sus nombres no están ya presentes.

El conjunto integrado actual proviene de `src/task/commands.ts` y se utiliza como respaldo (`source: "bundled"`).

## 4) Modo interactivo: de dónde provienen las listas de comandos

El modo interactivo combina múltiples fuentes de comandos para el autocompletado y el enrutamiento de comandos.

En el momento de construcción, genera una lista de comandos pendientes a partir de:

- comandos integrados (`BUILTIN_SLASH_COMMANDS`, incluye completado de argumentos e indicaciones en línea para comandos seleccionados)
- comandos de barra registrados por extensiones (`extensionRunner.getRegisteredCommands(...)`)
- comandos personalizados TypeScript (`session.customCommands`), mapeados a etiquetas de comandos de barra
- comandos de habilidad opcionales (`/skill:<name>`) cuando `skills.enableSkillCommands` está habilitado

Luego, `init()` llama a `refreshSlashCommandState(...)` para cargar los comandos basados en archivos e instala un `CombinedAutocompleteProvider` que contiene:

- los comandos pendientes anteriores
- los comandos basados en archivos descubiertos

`refreshSlashCommandState(...)` también actualiza `session.setSlashCommands(...)` para que la expansión del prompt utilice el mismo conjunto de comandos de archivo descubiertos.

### Ciclo de vida de actualización

El estado de los comandos de barra se actualiza:

- durante la inicialización interactiva
- después de que `/move` cambia el directorio de trabajo (`handleMoveCommand` llama a `resetCapabilities()` y luego a `refreshSlashCommandState(newCwd)`)

No existe un observador de archivos continuo para los directorios de comandos.

### Otras superficies de presentación

El panel de Extensiones también carga la capacidad `slash-commands` y muestra las entradas de comandos activos/sombreados, incluidos los duplicados `_shadowed`.

## 5) Posición en el pipeline de prompt

Orden de manejo de barras en `AgentSession.prompt(...)` (cuando `expandPromptTemplates !== false`):

1. **Comandos de extensión** (`#tryExecuteExtensionCommand`)  
   Si `/name` coincide con un comando registrado por extensión, el manejador se ejecuta inmediatamente y el prompt retorna.
2. **Comandos personalizados TypeScript** (`#tryExecuteCustomCommand`)  
   Solo límite: si hay coincidencia, se ejecuta y puede retornar:
   - `string` -> reemplaza el texto del prompt con esa cadena
   - `void/undefined` -> se trata como manejado; no hay prompt LLM
3. **Comandos de barra basados en archivos** (`expandSlashCommand`)  
   Si el texto aún comienza con `/`, se intenta la expansión del comando markdown.
4. **Plantillas de prompt** (`expandPromptTemplate`)  
   Se aplican después del procesamiento de barra/personalizado.
5. **Entrega**
   - inactivo: el prompt se envía inmediatamente al agente
   - en streaming: el prompt se pone en cola como steer/follow-up dependiendo de `streamingBehavior`

Por eso la expansión de comandos de barra se sitúa antes de la expansión de plantillas de prompt, y por eso los comandos personalizados pueden transformar la barra inicial antes de la coincidencia de comandos de archivo.

## 6) Semántica de expansión para comandos de barra basados en archivos

Comportamiento de `expandSlashCommand(text, fileCommands)`:

- solo se ejecuta cuando el texto comienza con `/`
- analiza el nombre del comando a partir del primer token después de `/`
- analiza los argumentos del texto restante mediante `parseCommandArgs`
- busca una coincidencia exacta de nombre en los `fileCommands` cargados
- si hay coincidencia, aplica:
  - reemplazo posicional: `$1`, `$2`, ...
  - reemplazo agregado: `$ARGUMENTS` y `$@`
  - luego renderizado de plantilla mediante `prompt.render` con `{ args, ARGUMENTS, arguments }`
- si no hay coincidencia, devuelve el texto original sin cambios

### Advertencias de `parseCommandArgs`

El analizador es una división simple con reconocimiento de comillas:

- admite comillas `'simples'` y `"dobles"` para mantener los espacios
- elimina los delimitadores de comillas
- no implementa reglas de escape con barra invertida
- una comilla sin cerrar no es un error; el analizador consume hasta el final

## 7) Comportamiento desconocido de `/...`

La entrada de barra desconocida **no es rechazada** por la lógica central de comandos de barra.

Si el comando no es manejado por las capas de extensión/personalizado/archivo, `expandSlashCommand` devuelve el texto original, y el prompt literal `/...` continúa a través de la expansión normal de plantillas de prompt y la entrega al LLM.

El modo interactivo maneja directamente muchos comandos integrados en `InputController` (por ejemplo `/settings`, `/model`, `/mcp`, `/move`, `/exit`). Estos se consumen antes de `session.prompt(...)` y por lo tanto nunca llegan a la expansión de comandos de archivo en esa ruta.

## 8) Diferencias en el camino de streaming frente al camino inactivo

## Camino inactivo

- `session.prompt("/x ...")` ejecuta el pipeline de comandos y ya sea ejecuta el comando inmediatamente o envía el texto expandido directamente.

## Camino de streaming (`session.isStreaming === true`)

- `prompt(...)` aún ejecuta las transformaciones de extensión/personalizado/archivo/plantilla primero
- luego requiere `streamingBehavior`:
  - `"steer"` -> pone en cola un mensaje de interrupción (`agent.steer`)
  - `"followUp"` -> pone en cola un mensaje post-turno (`agent.followUp`)
- si se omite `streamingBehavior`, el prompt lanza un error

### Comportamiento de streaming específico por comando importante

- Los comandos de extensión se ejecutan inmediatamente incluso durante el streaming (no se ponen en cola como texto).
- Los métodos auxiliares `steer(...)`/`followUp(...)` rechazan los comandos de extensión (`#throwIfExtensionCommand`) para evitar poner en cola texto de comandos para manejadores que deben ejecutarse de forma síncrona.
- La reproducción de la cola de compactación utiliza `isKnownSlashCommand(...)` para decidir si las entradas en cola deben reproducirse mediante `session.prompt(...)` (para comandos de barra conocidos) frente a los métodos raw steer/follow-up.

## 9) Manejo de errores y superficies de fallo

- Los fallos de carga del proveedor están aislados; el registro recopila advertencias y continúa con otros proveedores.
- Los elementos de comandos de barra inválidos (nombre/ruta/contenido faltante o nivel inválido) son descartados por la validación de capacidades.
- Fallos de análisis de frontmatter:
  - comandos nativos: el error de análisis fatal se propaga
  - comandos no nativos: advertencia + análisis de respaldo clave/valor
- Las excepciones de los manejadores de comandos de extensión/personalizado son capturadas y reportadas a través del canal de error de extensión (o el respaldo de logger para comandos personalizados sin ejecutor de extensión), y se tratan como manejadas (sin ejecución de respaldo no intencionada).
