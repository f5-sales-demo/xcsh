---
title: Slash Command Internals
description: >-
  Slash command system internals with registration, argument parsing, and
  execution dispatch.
sidebar:
  order: 5
  label: Slash commands
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# Componentes internos de los comandos slash

Este documento describe cómo se descubren, deduplican, presentan en modo interactivo y expanden los comandos slash en tiempo de prompt en `coding-agent`.

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

Los comandos slash son una capacidad (`id: "slash-commands"`) indexada por nombre de comando (`key: cmd => cmd.name`).

El registro de capacidades carga todos los proveedores registrados, ordenados por prioridad de proveedor en orden descendente, y deduplica por clave con semántica de **el primero gana**.

### Precedencia de proveedores

Proveedores actuales de comandos slash y sus prioridades:

1. `native` (OMP) — prioridad `100`
2. `claude` — prioridad `80`
3. `claude-plugins` — prioridad `70`
4. `codex` — prioridad `70`

Comportamiento en empate: los proveedores con igual prioridad mantienen el orden de registro. El orden de importación actual registra `claude-plugins` antes que `codex`, por lo que los comandos de plugins tienen precedencia sobre los comandos de codex en colisiones de nombres.

### Comportamiento en colisiones de nombres

Para `slash-commands`, las colisiones se resuelven estrictamente mediante la deduplicación de capacidades:

- el elemento con mayor precedencia se mantiene en `result.items`
- los duplicados de menor precedencia permanecen solo en `result.all` y se marcan como `_shadowed = true`

Esto aplica entre proveedores y también dentro de un proveedor si este devuelve nombres duplicados.

### Comportamiento de escaneo de archivos

Los proveedores utilizan principalmente `loadFilesFromDir(...)`, que actualmente:

- utiliza por defecto coincidencia no recursiva (`*.md`)
- usa glob nativo con `gitignore: true`, `hidden: false`
- lee cada archivo coincidente y lo transforma en un `SlashCommand`

Por lo tanto, los archivos/directorios ocultos no se cargan y las rutas ignoradas se omiten.

## 2) Rutas de origen específicas por proveedor y precedencia local

## Proveedor `native` (`builtin.ts`)

Las raíces de búsqueda provienen de los directorios `.xcsh`:

- proyecto: `<cwd>/.xcsh/commands/*.md`
- usuario: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` devuelve primero el proyecto, luego el usuario, por lo que **los comandos nativos de proyecto tienen precedencia sobre los comandos nativos de usuario** cuando los nombres colisionan.

## Proveedor `claude` (`claude.ts`)

Carga:

- usuario: `~/.claude/commands/*.md`
- proyecto: `<cwd>/.claude/commands/*.md`

El proveedor inserta los elementos de usuario antes que los de proyecto, por lo que **los comandos Claude de usuario tienen precedencia sobre los comandos Claude de proyecto** en colisiones de nombres dentro de este proveedor.

## Proveedor `codex` (`codex.ts`)

Carga:

- usuario: `~/.codex/commands/*.md`
- proyecto: `<cwd>/.codex/commands/*.md`

Ambos lados se cargan y luego se aplanan en orden usuario-primero, por lo que **los comandos Codex de usuario tienen precedencia sobre los comandos Codex de proyecto** en colisiones.

El contenido de los comandos Codex se analiza con eliminación de frontmatter (`parseFrontmatter`), y el nombre del comando puede ser sobreescrito por el frontmatter `name`; de lo contrario, se usa el nombre del archivo.

## Proveedor `claude-plugins` (`claude-plugins.ts`)

Carga las raíces de comandos de plugins desde `~/.claude/plugins/installed_plugins.json`, luego escanea `<pluginRoot>/commands/*.md`.

El orden sigue el orden de iteración del registro y el orden de entrada por plugin de esos datos JSON. No hay un paso de ordenamiento adicional.

## 3) Materialización a `FileSlashCommand` en tiempo de ejecución

`loadSlashCommands()` en `src/extensibility/slash-commands.ts` convierte los elementos de capacidad en objetos `FileSlashCommand` utilizados en tiempo de prompt.

Para cada comando:

1. analiza frontmatter/cuerpo (`parseFrontmatter`)
2. origen de la descripción:
   - `frontmatter.description` si está presente
   - de lo contrario, la primera línea no vacía del cuerpo (recortada, máximo 60 caracteres con `...`)
3. mantiene el cuerpo analizado como contenido de plantilla ejecutable
4. calcula una cadena de origen de visualización como `via Claude Code Project`

La severidad del análisis de frontmatter depende del origen:

- nivel `native` -> los errores de análisis son `fatal`
- niveles `user`/`project` -> los errores de análisis son `warn` con análisis de respaldo

### Comandos de respaldo incluidos

Después de los comandos del sistema de archivos/proveedores, se añaden plantillas de comandos embebidas (`EMBEDDED_COMMAND_TEMPLATES`) si sus nombres aún no están presentes.

El conjunto embebido actual proviene de `src/task/commands.ts` y se usa como respaldo (`source: "bundled"`).

## 4) Modo interactivo: de dónde provienen las listas de comandos

El modo interactivo combina múltiples fuentes de comandos para el autocompletado y el enrutamiento de comandos.

En el momento de la construcción, crea una lista pendiente de comandos a partir de:

- comandos integrados (`BUILTIN_SLASH_COMMANDS`, incluye completado de argumentos y sugerencias en línea para comandos seleccionados)
- comandos slash registrados por extensiones (`extensionRunner.getRegisteredCommands(...)`)
- comandos personalizados de TypeScript (`session.customCommands`), mapeados a etiquetas de comandos slash
- comandos de habilidades opcionales (`/skill:<name>`) cuando `skills.enableSkillCommands` está habilitado

Luego `init()` llama a `refreshSlashCommandState(...)` para cargar los comandos basados en archivos e instalar un `CombinedAutocompleteProvider` que contiene:

- los comandos pendientes mencionados anteriormente
- los comandos descubiertos basados en archivos

`refreshSlashCommandState(...)` también actualiza `session.setSlashCommands(...)` para que la expansión de prompts use el mismo conjunto de comandos de archivo descubiertos.

### Ciclo de vida del refresco

El estado de los comandos slash se refresca:

- durante la inicialización interactiva
- después de que `/move` cambia el directorio de trabajo (`handleMoveCommand` llama a `resetCapabilities()` y luego a `refreshSlashCommandState(newCwd)`)

No hay un observador continuo de archivos para los directorios de comandos.

### Otra presentación

El panel de Extensiones también carga la capacidad `slash-commands` y muestra las entradas de comandos activos/sombreados, incluyendo los duplicados `_shadowed`.

## 5) Ubicación en el pipeline de prompts

Orden de manejo de slash en `AgentSession.prompt(...)` (cuando `expandPromptTemplates !== false`):

1. **Comandos de extensión** (`#tryExecuteExtensionCommand`)  
   Si `/name` coincide con un comando registrado por extensión, el manejador se ejecuta inmediatamente y el prompt retorna.
2. **Comandos personalizados de TypeScript** (`#tryExecuteCustomCommand`)  
   Solo en el límite: si coincide, se ejecuta y puede retornar:
   - `string` -> reemplaza el texto del prompt con esa cadena
   - `void/undefined` -> se trata como manejado; no se envía prompt al LLM
3. **Comandos slash basados en archivos** (`expandSlashCommand`)  
   Si el texto aún comienza con `/`, se intenta la expansión de comando markdown.
4. **Plantillas de prompt** (`expandPromptTemplate`)  
   Se aplican después del procesamiento de slash/personalizados.
5. **Entrega**
   - inactivo: el prompt se envía inmediatamente al agente
   - en streaming: el prompt se pone en cola como steer/follow-up dependiendo de `streamingBehavior`

Por esto la expansión de comandos slash se sitúa antes de la expansión de plantillas de prompt, y por esto los comandos personalizados pueden transformar y eliminar la barra inicial antes de la coincidencia con comandos de archivo.

## 6) Semántica de expansión para comandos slash basados en archivos

Comportamiento de `expandSlashCommand(text, fileCommands)`:

- solo se ejecuta cuando el texto comienza con `/`
- analiza el nombre del comando desde el primer token después de `/`
- analiza los argumentos del texto restante mediante `parseCommandArgs`
- busca una coincidencia exacta de nombre en los `fileCommands` cargados
- si coincide, aplica:
  - reemplazo posicional: `$1`, `$2`, ...
  - reemplazo agregado: `$ARGUMENTS` y `$@`
  - luego renderizado de plantilla mediante `prompt.render` con `{ args, ARGUMENTS, arguments }`
- si no coincide, devuelve el texto original sin cambios

### Consideraciones de `parseCommandArgs`

El analizador es un divisor simple con reconocimiento de comillas:

- soporta comillas `'simples'` y `"dobles"` para conservar espacios
- elimina los delimitadores de comillas
- no implementa reglas de escape con barra invertida
- una comilla sin cerrar no es un error; el analizador consume hasta el final

## 7) Comportamiento de `/...` desconocido

La entrada slash desconocida **no es rechazada** por la lógica central de slash.

Si el comando no es manejado por las capas de extensión/personalizado/archivo, `expandSlashCommand` devuelve el texto original, y el prompt literal `/...` continúa a través de la expansión normal de plantillas de prompt y la entrega al LLM.

El modo interactivo maneja directamente muchos comandos integrados por separado en `InputController` (por ejemplo `/settings`, `/model`, `/mcp`, `/move`, `/exit`). Estos se consumen antes de `session.prompt(...)` y por lo tanto nunca llegan a la expansión de comandos de archivo en esa ruta.

## 8) Diferencias en tiempo de streaming vs inactivo

## Ruta inactiva

- `session.prompt("/x ...")` ejecuta el pipeline de comandos y, o bien ejecuta el comando inmediatamente, o envía el texto expandido directamente.

## Ruta de streaming (`session.isStreaming === true`)

- `prompt(...)` aún ejecuta primero las transformaciones de extensión/personalizado/archivo/plantilla
- luego requiere `streamingBehavior`:
  - `"steer"` -> pone en cola un mensaje de interrupción (`agent.steer`)
  - `"followUp"` -> pone en cola un mensaje post-turno (`agent.followUp`)
- si `streamingBehavior` se omite, el prompt lanza un error

### Comportamiento importante de streaming específico por comando

- Los comandos de extensión se ejecutan inmediatamente incluso durante el streaming (no se ponen en cola como texto).
- Los métodos auxiliares `steer(...)`/`followUp(...)` rechazan los comandos de extensión (`#throwIfExtensionCommand`) para evitar poner en cola texto de comando para manejadores que deben ejecutarse sincrónicamente.
- La reproducción de la cola de compactación usa `isKnownSlashCommand(...)` para decidir si las entradas en cola deben reproducirse mediante `session.prompt(...)` (para comandos slash conocidos) o mediante métodos raw de steer/follow-up.

## 9) Manejo de errores y superficies de fallo

- Los fallos de carga de proveedores están aislados; el registro recopila advertencias y continúa con los demás proveedores.
- Los elementos de comandos slash inválidos (sin nombre/ruta/contenido o con nivel inválido) se descartan por la validación de capacidades.
- Fallos en el análisis de frontmatter:
  - comandos nativos: el error fatal de análisis se propaga
  - comandos no nativos: advertencia + análisis de respaldo clave/valor
- Las excepciones de manejadores de comandos de extensión/personalizados se capturan y reportan mediante el canal de errores de extensión (o el logger como respaldo para comandos personalizados sin extension runner), y se tratan como manejados (sin ejecución de respaldo no intencionada).
